// Live doorbell video over WebRTC (server/doorbellRtc.js): Marco relays the offer and answer with Home Assistant and
// the video comes straight to this browser, from Google for a Nest doorbell or from Home Assistant's go2rtc. Used by
// the doorbell overlay (widgets/doorbell.ts) before it falls back to asking for camera pictures.
//
// GET /api/display/doorbell/webrtc answers 404 when there is nothing to negotiate (the camera has no WebRTC stream,
// an older server, Marco Cloud): the overlay then uses the pictures as before.
import type { DoorbellRtcAnswer, DoorbellRtcCandidates, DoorbellRtcConfig } from '../shared/types';

/** A live session: `close()` ends it (and Home Assistant's stream); `ended` resolves when it stops by itself. */
export interface LiveSession {
  close(): void;
  ended: Promise<void>;
}

/**
 * Starts the live video of the ring on screen into `video`, or resolves with null when this camera has none (use
 * the pictures). Throws when it was offered but could not be set up.
 */
export type LiveSource = (video: HTMLVideoElement, signal: AbortSignal) => Promise<LiveSession | null>;

/** The browser may gather candidates for this long before the offer is sent; later ones follow one by one. */
const GATHER_MS = 1500;
/** No picture this long after the answer: give up (the overlay goes back to the pictures). */
const CONNECT_MS = 15_000;
/** A connection that drops comes back within this, or the session is over. */
const DISCONNECT_MS = 6000;

/** The display's LiveSource; `api(path, init)` is a fetch with the display's credential and screen. */
export function webrtcSource(api: (path: string, init?: RequestInit) => Promise<Response>): LiveSource {
  return async (video, signal) => {
    if (typeof RTCPeerConnection !== 'function') return null;
    const cr = await api('/api/display/doorbell/webrtc', { signal });
    if (cr.status === 404 || cr.status === 401 || cr.status === 403) return null;
    if (!cr.ok) throw new Error(`webrtc config: HTTP ${cr.status}`);
    const cfg = (await cr.json()) as DoorbellRtcConfig;

    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    let session = '';
    let closed = false;
    let endResolve: () => void = () => undefined;
    const ended = new Promise<void>((r) => (endResolve = r));
    const close = () => {
      if (closed) return;
      closed = true;
      try { pc.close(); } catch { /* already closed */ }
      if (video.srcObject) video.srcObject = null;
      if (session) void api(`/api/display/doorbell/webrtc/${encodeURIComponent(session)}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
      endResolve();
    };
    signal.addEventListener('abort', close, { once: true });

    try {
      // audio, video and then the data channel: the order Google Nest asks for (the camera refuses other offers)
      pc.addTransceiver('audio', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
      if (cfg.dataChannel) pc.createDataChannel(cfg.dataChannel);
      pc.ontrack = (ev) => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        if (video.srcObject !== stream) video.srcObject = stream;
        void video.play().catch(() => undefined);
      };
      let drop: ReturnType<typeof setTimeout> | null = null;
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'failed' || st === 'closed') return close();
        if (st === 'disconnected') {
          if (!drop) drop = setTimeout(close, DISCONNECT_MS);
        } else if (drop) {
          clearTimeout(drop);
          drop = null;
        }
      };

      // candidates found before the offer goes out travel in it; the others are sent one by one
      const early: RTCIceCandidateInit[] = [];
      pc.onicecandidate = (ev) => {
        const c = ev.candidate?.toJSON();
        if (!c?.candidate) return;
        if (!session) early.push(c);
        else void sendCandidate(c);
      };
      const sendCandidate = (candidate: RTCIceCandidateInit) =>
        api(`/api/display/doorbell/webrtc/${encodeURIComponent(session)}/candidate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidate }) }).catch(() => undefined);

      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const t = setTimeout(resolve, GATHER_MS);
        pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(t);
            resolve();
          }
        });
      });
      if (closed) throw new Error('aborted');
      const sentIn = pc.localDescription?.sdp ?? '';
      const ar = await api('/api/display/doorbell/webrtc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sdp: sentIn }), signal });
      if (ar.status === 404) {
        close();
        return null;
      }
      if (!ar.ok) throw new Error(`webrtc offer: HTTP ${ar.status}`);
      const answer = (await ar.json()) as DoorbellRtcAnswer;
      session = answer.session;
      if (closed) {
        close();
        throw new Error('aborted');
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: answer.answer });
      for (const c of answer.candidates) await addRemote(pc, c);
      // candidates gathered before the answer that the offer did not carry
      for (const c of early) if (!sentIn.includes(c.candidate ?? '\u0000')) void sendCandidate(c);
      void pollCandidates(api, pc, answer.session, answer.next, () => closed);

      const timer = setTimeout(() => {
        if (!video.videoWidth) close();
      }, CONNECT_MS);
      void ended.then(() => clearTimeout(timer));
      return { close, ended };
    } catch (err) {
      close();
      throw err;
    }
  };
}

async function addRemote(pc: RTCPeerConnection, c: RTCIceCandidateInit): Promise<void> {
  try {
    await pc.addIceCandidate(c.candidate ? c : null);
  } catch { /* a candidate the browser cannot use */ }
}

/** Home Assistant's later candidates, until the connection is up, the session ends or a minute has passed. */
async function pollCandidates(api: (path: string, init?: RequestInit) => Promise<Response>, pc: RTCPeerConnection, session: string, next: number, closed: () => boolean): Promise<void> {
  const until = Date.now() + 60_000;
  while (!closed() && Date.now() < until && pc.connectionState !== 'connected') {
    try {
      const r = await api(`/api/display/doorbell/webrtc/${encodeURIComponent(session)}?after=${next}`);
      if (!r.ok) return;
      const d = (await r.json()) as DoorbellRtcCandidates;
      for (const c of d.candidates) await addRemote(pc, c);
      next = d.next;
      if (d.closed) return;
    } catch {
      return;
    }
  }
}
