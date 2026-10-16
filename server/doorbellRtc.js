// Live doorbell video over WebRTC, for cameras Home Assistant can only stream that way (Google Nest battery doorbells
// and cameras give no snapshot and no MJPEG: Home Assistant answers /api/camera_proxy with a grey placeholder). Marco
// only relays the negotiation; the display's browser receives the video straight from the camera's side (Google, or
// Home Assistant's go2rtc), so no video goes through this server.
//
// - Each session has its own Home Assistant WebSocket (haWs.js): `camera/webrtc/offer` is a subscription that keeps
//   the camera's stream open, and closing the socket is what makes Home Assistant end it. The mirror's connection
//   (haLive.js) is never used for this.
// - Only while the display's screen rings, only for the camera of that ring, and bound to the credential that opened
//   it (another display cannot read or close it). A session ends when the ring does (dismissed, expired, its camera
//   changed), when the display closes it, when Home Assistant closes the socket, and after SESSION_MAX_MS at most.
// - At most RTC_SESSION_LIMIT sessions per server; a display that opens a new one for the same screen ends its old one.
// - Node 20 has no global WebSocket (only with --experimental-websocket): there is then no live video and the display
//   falls back to the camera pictures (server/doorbell.js).
import crypto from 'node:crypto';
import { haSettings } from './homeassistant.js';
import { openHaSocket, hasWebSocket } from './haWs.js';
import { ringFor } from './doorbell.js';
import { clientConfig, sanitizeAnswer, sanitizeCandidate, supportsWebrtc } from './core/doorbellRtcCore.js';

/** Sessions open at once on this server. */
export const RTC_SESSION_LIMIT = 4;
/** Home Assistant (and the camera behind it) must answer the offer within this. */
export const ANSWER_TIMEOUT_MS = 20_000;
/** A candidate poll waits this long for a new candidate before answering with none. */
export const CANDIDATE_WAIT_MS = 8000;
/** The longest a session lives, whatever the ring says (a ring lasts 300 s at most). */
export const SESSION_MAX_MS = 6 * 60_000;
/** How often open sessions check that their ring is still on. */
const CHECK_MS = 1000;
/** Candidates kept per session, and candidates of the display passed on per session. */
const CANDIDATES_MAX = 64;

const fail = (status, code) => Object.assign(new Error(code), { status, code });

/** The real opener: no WebSocket in this Node means no live video (404 no_webrtc, the display uses the pictures). */
const realOpener = (o) => {
  if (!hasWebSocket()) throw fail(404, 'no_webrtc');
  return openHaSocket(o);
};
let openSocket = realOpener;
/** sessionId → Session */
const sessions = new Map();
let checkTimer = null;

function settingsOrThrow() {
  const { url, token, enabled } = haSettings();
  if (!enabled || !url || !token) throw fail(503, 'homeassistant_off');
  return { url, token };
}

/** The ring on `screenId` with its camera, or throws 404. */
function ringOrThrow(screenId) {
  const r = ringFor(screenId);
  if (!r) throw fail(404, 'no_ring');
  if (!r.camera) throw fail(404, 'no_camera');
  return r;
}

async function connect() {
  const s = settingsOrThrow();
  try {
    return await openSocket({ url: s.url, token: s.token });
  } catch (err) {
    throw err.status ? err : fail(502, 'camera_unavailable');
  }
}

/**
 * GET /api/display/doorbell/webrtc: whether the camera of the ring on `screenId` streams over WebRTC, and the
 * configuration for the display's RTCPeerConnection. Returns { iceServers, dataChannel } or throws { status, code }:
 * 404 no_ring | no_camera | no_webrtc (the camera has no WebRTC stream, or this Node has no WebSocket: use the
 * pictures), 503 homeassistant_off, 502 camera_unavailable.
 */
export async function rtcConfigFor(screenId) {
  const r = ringOrThrow(screenId);
  const c = await connect();
  try {
    let caps;
    try {
      caps = await c.call({ type: 'camera/capabilities', entity_id: r.camera }, 8000);
    } catch (err) {
      // Home Assistant older than 2024.11 has no camera/capabilities and no WebRTC negotiation Marco can relay
      throw err.code === 'unknown_command' ? fail(404, 'no_webrtc') : fail(502, 'camera_unavailable');
    }
    if (!supportsWebrtc(caps)) throw fail(404, 'no_webrtc');
    try {
      return clientConfig(await c.call({ type: 'camera/webrtc/get_client_config', entity_id: r.camera }, 8000));
    } catch {
      throw fail(502, 'camera_unavailable');
    }
  } finally {
    c.close();
  }
}

/** Live sessions now (tests, the status page). */
export function rtcStats() {
  return { sessions: sessions.size };
}

function closeSession(s, reason = 'closed') {
  if (s.closed) return;
  s.closed = reason;
  sessions.delete(s.id);
  clearTimeout(s.maxTimer);
  try { s.sock?.close(); } catch { /* already closed */ }
  s.abort?.();
  for (const w of [...s.waiters]) w();
  s.waiters.clear();
  if (!sessions.size && checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function pushCandidate(s, c) {
  if (s.candidates.length >= CANDIDATES_MAX) return;
  s.candidates.push(c);
  for (const w of [...s.waiters]) w();
  s.waiters.clear();
}

/** The ring of a session still on, with the same camera? */
function stillRinging(s) {
  const r = ringFor(s.screenId);
  return Boolean(r && r.id === s.ringId && r.camera === s.camera);
}

function armCheck() {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    for (const s of [...sessions.values()]) if (!stillRinging(s)) closeSession(s, 'ring_over');
  }, CHECK_MS);
  checkTimer.unref?.();
}

/** The session `id` if `cred` opened it, else throws 404 (the same answer as for one that does not exist). */
function own(id, cred) {
  const s = sessions.get(String(id || ''));
  if (!s || s.cred !== cred) throw fail(404, 'no_session');
  return s;
}

/**
 * POST /api/display/doorbell/webrtc: send the display's offer to Home Assistant for the camera of the ring on
 * `screenId`. Resolves with { session, answer, candidates, next } once the camera answered (`next` is the index for
 * the next candidate poll), or throws { status, code }: 404 no_ring | no_camera | no_webrtc, 503 busy |
 * homeassistant_off, 502 camera_unavailable (refused, no answer within ANSWER_TIMEOUT_MS), 504 timeout.
 */
export async function startRtcSession(screenId, cred, sdp) {
  const r = ringOrThrow(screenId);
  // a display opening a new session for its screen (a retry, a reload) ends its old one first
  for (const old of [...sessions.values()]) if (old.cred === cred && old.screenId === screenId) closeSession(old, 'replaced');
  if (sessions.size >= RTC_SESSION_LIMIT) throw fail(503, 'busy');
  const s = {
    id: crypto.randomBytes(16).toString('base64url'), cred, screenId, ringId: r.id, camera: r.camera,
    sock: null, haSession: null, candidates: [], outbox: [], sent: 0, waiters: new Set(), abort: null, closed: false, maxTimer: null,
  };
  sessions.set(s.id, s);
  armCheck();
  s.maxTimer = setTimeout(() => closeSession(s, 'max_age'), SESSION_MAX_MS);
  s.maxTimer.unref?.();
  try {
    s.sock = await connect();
    if (s.closed) throw fail(404, 'no_ring');
    s.sock.onClose(() => closeSession(s, 'ha_closed'));
    const answer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fail(504, 'timeout')), ANSWER_TIMEOUT_MS);
      timer.unref?.();
      const done = (fn, v) => {
        clearTimeout(timer);
        fn(v);
      };
      // the ring ended (or the display gave up) while the camera was answering
      s.abort = () => done(reject, fail(404, 'no_ring'));
      s.sock.subscribe({ type: 'camera/webrtc/offer', entity_id: r.camera, offer: sdp }, (ev) => {
        if (ev?.type === 'session' && typeof ev.session_id === 'string') {
          s.haSession = ev.session_id;
          // candidates the display sent before Home Assistant named its session
          for (const c of s.outbox.splice(0)) forward(s, c);
        } else if (ev?.type === 'answer') {
          const a = sanitizeAnswer(ev.answer);
          if (a) done(resolve, a);
          else done(reject, fail(502, 'camera_unavailable'));
        } else if (ev?.type === 'candidate') {
          const c = sanitizeCandidate(ev.candidate);
          if (c) pushCandidate(s, c);
        } else if (ev?.type === 'error') {
          done(reject, fail(502, 'camera_unavailable'));
          closeSession(s, 'ha_error');
        }
      }).catch((err) => done(reject, err.code === 'unknown_command' ? fail(404, 'no_webrtc') : fail(502, 'camera_unavailable')));
    });
    s.abort = null;
    if (s.closed) throw fail(404, 'no_ring');
    return { session: s.id, answer, candidates: [...s.candidates], next: s.candidates.length };
  } catch (err) {
    closeSession(s, 'failed');
    throw err.status ? err : fail(502, 'camera_unavailable');
  }
}

function forward(s, c) {
  s.sock?.call({ type: 'camera/webrtc/candidate', entity_id: s.camera, session_id: s.haSession, candidate: c }, 8000).catch(() => {});
}

/**
 * GET /api/display/doorbell/webrtc/:session?after=n: Home Assistant's candidates from index `after` on, waiting up to
 * CANDIDATE_WAIT_MS for one. Resolves with { candidates, next, closed } (`closed`: the session is over, stop asking).
 */
export async function rtcCandidates(id, cred, after = 0) {
  let s;
  try {
    s = own(id, cred);
  } catch {
    return { candidates: [], next: after, closed: true };
  }
  const from = Math.max(0, Math.min(Number.isInteger(after) ? after : 0, s.candidates.length));
  if (from === s.candidates.length && !s.closed) {
    await new Promise((resolve) => {
      const t = setTimeout(done, CANDIDATE_WAIT_MS);
      t.unref?.();
      function done() {
        clearTimeout(t);
        s.waiters.delete(done);
        resolve();
      }
      s.waiters.add(done);
    });
  }
  return { candidates: s.candidates.slice(from), next: s.candidates.length, closed: Boolean(s.closed) };
}

/** POST /api/display/doorbell/webrtc/:session/candidate: one candidate of the display, passed on to Home Assistant. */
export function rtcAddCandidate(id, cred, candidate) {
  const s = own(id, cred);
  const c = sanitizeCandidate(candidate);
  if (!c) throw fail(400, 'invalid_candidate');
  // a display gathers a few dozen at most; anything beyond is dropped rather than sent on to Home Assistant
  if (++s.sent > CANDIDATES_MAX) return;
  if (s.haSession) forward(s, c);
  else if (s.outbox.length < CANDIDATES_MAX) s.outbox.push(c);
}

/** DELETE /api/display/doorbell/webrtc/:session. Closing one that is gone is fine. */
export function rtcClose(id, cred) {
  try {
    closeSession(own(id, cred), 'display');
  } catch { /* already gone */ }
}

/** Testing helper: a fake Home Assistant socket opener (`null` = the real one); closes every session. */
export function _resetDoorbellRtc(opener = null) {
  for (const s of [...sessions.values()]) closeSession(s, 'reset');
  openSocket = opener ?? realOpener;
}
