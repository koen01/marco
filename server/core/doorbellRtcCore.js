// Pure WebRTC helpers for the doorbell overlay, shared with Marco Cloud: what Marco accepts from a display (an SDP
// offer, ICE candidates) and from Home Assistant (its client configuration, the answer, ICE candidates) before passing
// it on. Home Assistant negotiates WebRTC for cameras that only stream that way (Google Nest battery doorbells and
// cameras): Marco relays the offer and answer (server/doorbellRtc.js) and the display plays the stream itself, so no
// video goes through Marco and the Home Assistant token never leaves the server. See docs/API.md (Doorbell camera).

export const RTC_LIMITS = Object.freeze({
  /** an offer with every candidate of a display fits in a few kB */
  sdpMaxBytes: 32 * 1024,
  candidateMaxChars: 1024,
  /** ICE servers passed on from Home Assistant, and URLs per server */
  iceServers: 8,
  iceUrls: 12,
});

/** The stream types of `camera/capabilities` that mean Home Assistant negotiates WebRTC for the camera. */
export function supportsWebrtc(caps) {
  return Array.isArray(caps?.frontend_stream_types) && caps.frontend_stream_types.includes('web_rtc');
}

const isSdp = (s) => typeof s === 'string' && s.length > 0 && s.length <= RTC_LIMITS.sdpMaxBytes && s.startsWith('v=0') && !s.includes('\0');

/** A display's offer: { ok: true, sdp } or { ok: false, error }. */
export function sanitizeOffer(body) {
  const sdp = body && typeof body === 'object' ? body.sdp : undefined;
  if (typeof sdp !== 'string') return { ok: false, error: 'sdp required' };
  if (!isSdp(sdp)) return { ok: false, error: 'invalid sdp' };
  return { ok: true, sdp };
}

/** Home Assistant's answer SDP, or '' when it is not one. */
export function sanitizeAnswer(sdp) {
  return isSdp(sdp) ? sdp : '';
}

/**
 * One ICE candidate (RTCIceCandidateInit) from either side: { candidate, sdpMid, sdpMLineIndex } with nothing else,
 * or null when it is not one. An empty `candidate` is the end-of-candidates marker and is kept.
 */
export function sanitizeCandidate(c) {
  if (!c || typeof c !== 'object') return null;
  const cand = c.candidate;
  if (typeof cand !== 'string' || cand.length > RTC_LIMITS.candidateMaxChars || /[\r\n\0]/.test(cand)) return null;
  if (cand && !/^(a=)?candidate:/.test(cand)) return null;
  const mid = c.sdpMid;
  const idx = c.sdpMLineIndex;
  const sdpMid = typeof mid === 'string' && mid.length <= 32 && /^[\w.-]*$/.test(mid) ? mid : null;
  const sdpMLineIndex = Number.isInteger(idx) && idx >= 0 && idx < 64 ? idx : null;
  if (sdpMid === null && sdpMLineIndex === null) return null;
  return { candidate: cand.replace(/^a=/, ''), sdpMid, sdpMLineIndex };
}

/**
 * `camera/webrtc/get_client_config` → what a display needs for its RTCPeerConnection: { iceServers, dataChannel }.
 * Only stun:, turn: and turns: URLs pass; `dataChannel` is the label of the data channel the camera wants in the
 * offer (Google Nest refuses an offer without one), or null.
 */
export function clientConfig(result) {
  const servers = Array.isArray(result?.configuration?.iceServers) ? result.configuration.iceServers : [];
  const iceServers = [];
  for (const s of servers.slice(0, RTC_LIMITS.iceServers)) {
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls])
      .filter((u) => typeof u === 'string' && u.length <= 256 && /^(stun|turns?):[^\s]+$/i.test(u))
      .slice(0, RTC_LIMITS.iceUrls);
    if (!urls.length) continue;
    const out = { urls };
    if (typeof s.username === 'string' && s.username.length <= 512) out.username = s.username;
    if (typeof s.credential === 'string' && s.credential.length <= 512) out.credential = s.credential;
    iceServers.push(out);
  }
  const dc = result?.dataChannel;
  return { iceServers, dataChannel: typeof dc === 'string' && /^[\w.-]{1,64}$/.test(dc) ? dc : null };
}
