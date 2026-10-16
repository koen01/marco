// Camera pictures from Home Assistant, shared by the doorbell overlay (server/doorbell.js) and the Cámara cards of
// Personalizado screens (routes/ha.js). The stored token stays here: displays only ever get image bytes.
//
// - Snapshots: GET /api/camera_proxy/<entity> (the path is built from a validated camera entity id, never from an
//   entity_picture), no redirects, 6 s, at most 4 MB, JPEG/PNG/WebP/GIF only (SVG and anything else is refused, so
//   nothing scriptable is ever served from Marco's origin). One frame per camera is reused for FRAME_CACHE_MS by every
//   display that asks, and requests that arrive while one is on its way share it, so a house full of screens asks
//   Home Assistant for about two frames a second at most. Failures are cached the same way.
// - Live pictures: GET /api/camera_proxy_stream/<entity> (MJPEG). One upstream per camera, shared by every screen that
//   shows it (fan-out), at most LIVE_LIMITS.upstreams cameras and LIVE_LIMITS.clients viewers per server. Marco reads
//   each part, checks its type and its size (2 MB a frame) and frames it again with its own boundary, so whatever
//   Home Assistant or the camera sends is never passed on as it is. The upstream closes when the last viewer leaves,
//   when it stops sending for LIVE_LIMITS.stallMs, or when it breaks; viewers are then told the stream ended. Screens
//   get at most one picture every LIVE_LIMITS.minFrameMs (10 a second), always the newest one.
import { haSettings } from './homeassistant.js';
import { frameType } from './core/doorbellCore.js';

/** A frame is reused for this long by every display that asks. */
export const FRAME_CACHE_MS = 500;
/** Biggest frame accepted from the camera. */
export const FRAME_MAX_BYTES = 4 * 1024 * 1024;
/** Home Assistant must answer within this. */
export const FRAME_TIMEOUT_MS = 6000;

/** Live pictures: cameras streamed at once, viewers in all, the biggest frame, silence before giving up. */
const LIVE_DEFAULTS = Object.freeze({
  upstreams: 4,
  clients: 8,
  partMaxBytes: 2 * 1024 * 1024,
  stallMs: 15_000,
  connectMs: 8000,
  /** the shortest gap between two pictures sent to the screens (10 a second): some cameras send 60 or more, megabytes
   *  a second that a Raspberry Pi would spend its time downloading and reading */
  minFrameMs: 100,
  /** a part's headers must fit in this */
  headMaxBytes: 8 * 1024,
});
export const LIVE_LIMITS = { ...LIVE_DEFAULTS };

/** Testing helper: shorter timers (`over`), or the defaults again (no argument). */
export function _setLiveLimits(over = null) {
  Object.assign(LIVE_LIMITS, LIVE_DEFAULTS, over ?? {});
}
/** The boundary of the multipart stream Marco sends (never the camera's own). */
export const LIVE_BOUNDARY = 'marcoframe';

const fail = (message, status, code) => Object.assign(new Error(message), { status, code });
const unavailable = (message) => fail(message, 502, 'camera_unavailable');

// ---------------------------------------------------------------------------------------------------- snapshots

/** camera entity → { at, type, body } | { at, error } of the last fetch */
const frames = new Map();
/** camera entity → the fetch running now */
const pending = new Map();

function settingsOrThrow() {
  const { url, token, enabled } = haSettings();
  if (!enabled || !url || !token) throw fail('Home Assistant is not set up', 503, 'homeassistant_off');
  return { url, token };
}

/** Fetch one frame from Home Assistant. Throws { status, code } on failure. */
async function fetchFrame(camera) {
  const { url, token } = settingsOrThrow();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FRAME_TIMEOUT_MS);
  try {
    const r = await fetch(`${url}/api/camera_proxy/${encodeURIComponent(camera)}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'image/*' },
      signal: ctl.signal,
      redirect: 'error',
    });
    if (!r.ok) {
      r.body?.cancel().catch(() => {});
      throw unavailable(`HTTP ${r.status}`);
    }
    const type = frameType(r.headers.get('content-type'));
    const len = Number(r.headers.get('content-length') || 0);
    if (!type || len > FRAME_MAX_BYTES) {
      r.body?.cancel().catch(() => {});
      throw unavailable(type ? 'frame too large' : 'not an image');
    }
    const reader = r.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FRAME_MAX_BYTES) {
        reader.cancel().catch(() => {});
        throw unavailable('frame too large');
      }
      chunks.push(value);
    }
    return { type, body: Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))) };
  } catch (err) {
    if (err.status) throw err;
    throw unavailable(err.name === 'AbortError' ? 'timeout' : 'could not reach Home Assistant');
  } finally {
    clearTimeout(timer);
  }
}

/** The latest frame of `camera`: the cached one when it is fresh, else one fetch shared by everyone who asks. */
export async function cameraFrame(camera, now = Date.now()) {
  const c = frames.get(camera);
  if (c && now - c.at < FRAME_CACHE_MS) {
    if (c.error) throw c.error;
    return c;
  }
  if (pending.has(camera)) return pending.get(camera);
  const p = (async () => {
    try {
      const f = await fetchFrame(camera);
      const entry = { at: Date.now(), ...f };
      frames.set(camera, entry);
      forgetLater(camera, entry);
      return entry;
    } catch (err) {
      // failures are cached too, so a dead camera is not asked once per display
      const entry = { at: Date.now(), error: err };
      frames.set(camera, entry);
      forgetLater(camera, entry);
      throw err;
    } finally {
      pending.delete(camera);
      if (frames.size > 32) pruneFrames();
    }
  })();
  pending.set(camera, p);
  return p;
}

/** A frame is dropped once it is too old to be served, so pictures (up to 4 MB each) are not kept for nothing. */
function forgetLater(camera, entry) {
  const t = setTimeout(() => {
    if (frames.get(camera) === entry) frames.delete(camera);
  }, FRAME_CACHE_MS + 50);
  t.unref?.();
}

/** Forget frames that are too old to be served again (they are never kept longer than that). */
export function pruneFrames(now = Date.now()) {
  for (const [cam, f] of frames) if (now - f.at >= FRAME_CACHE_MS) frames.delete(cam);
}

// ---------------------------------------------------------------------------------------------------- live MJPEG

/**
 * Reads a multipart/x-mixed-replace body part by part. `onPart({ type, body })` gets each picture (type '' when the
 * part is not an image Marco accepts), `onError(err)` is called once when the stream cannot be read any more (a part
 * too large, headers that never end). Parts with a Content-Length are cut by it, others at the next boundary.
 */
export class MultipartReader {
  constructor(boundary, { onPart, onError, maxPart = LIVE_LIMITS.partMaxBytes, maxHead = LIVE_LIMITS.headMaxBytes }) {
    const b = String(boundary || '').trim();
    // some servers put the leading dashes in the parameter itself
    this.delims = [...new Set([`--${b}`, b.startsWith('--') ? b : `--${b}`])].map((x) => Buffer.from(x, 'latin1'));
    this.buf = Buffer.alloc(0);
    this.state = 'seek';
    this.part = null;
    this.onPart = onPart;
    this.onError = onError;
    this.maxPart = maxPart;
    this.maxHead = maxHead;
    this.dead = false;
  }

  /** The first boundary in the buffer from `from`: { at, len } or null. */
  find(from = 0) {
    let best = null;
    for (const d of this.delims) {
      const at = this.buf.indexOf(d, from);
      if (at >= 0 && (!best || at < best.at)) best = { at, len: d.length };
    }
    return best;
  }

  die(message) {
    if (this.dead) return;
    this.dead = true;
    this.buf = Buffer.alloc(0);
    this.onError(unavailable(message));
  }

  push(chunk) {
    if (this.dead) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk);
    for (;;) {
      if (this.state === 'seek') {
        const hit = this.find();
        if (!hit) {
          // keep only what could still be the start of a boundary
          if (this.buf.length > this.maxPart) return this.die('no boundary');
          return;
        }
        this.buf = this.buf.subarray(hit.at + hit.len);
        this.state = 'head';
      }
      if (this.state === 'head') {
        const end = this.buf.indexOf('\r\n\r\n');
        if (end < 0) {
          if (this.buf.length > this.maxHead) return this.die('part headers too long');
          return;
        }
        const lines = this.buf.subarray(0, end).toString('latin1').split('\r\n');
        const head = {};
        for (const line of lines) {
          const i = line.indexOf(':');
          if (i > 0) head[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
        }
        const len = head['content-length'] !== undefined && /^\d+$/.test(head['content-length']) ? Number(head['content-length']) : null;
        if (len !== null && len > this.maxPart) return this.die('frame too large');
        this.part = { type: frameType(head['content-type']), len };
        this.buf = this.buf.subarray(end + 4);
        this.state = 'body';
      }
      if (this.state === 'body') {
        const { type, len } = this.part;
        let body;
        if (len !== null) {
          if (this.buf.length < len) return;
          body = this.buf.subarray(0, len);
          this.buf = this.buf.subarray(len);
        } else {
          const hit = this.find();
          if (!hit) {
            if (this.buf.length > this.maxPart) return this.die('frame too large');
            return;
          }
          let stop = hit.at;
          if (stop >= 2 && this.buf[stop - 2] === 13 && this.buf[stop - 1] === 10) stop -= 2;
          body = this.buf.subarray(0, stop);
          this.buf = this.buf.subarray(hit.at);
        }
        this.state = 'seek';
        this.part = null;
        // a copy: the buffer it came from is reused for the next parts
        this.onPart({ type, body: Buffer.from(body) });
        if (this.dead) return;
      }
    }
  }
}

/** One part of Marco's own multipart stream. */
export function livePart({ type, body }) {
  return Buffer.concat([Buffer.from(`--${LIVE_BOUNDARY}\r\nContent-Type: ${type}\r\nContent-Length: ${body.length}\r\n\r\n`, 'latin1'), body, Buffer.from('\r\n', 'latin1')]);
}

/** camera entity → { camera, ctl, sinks: Set, last: { type, body, at } | null, stall, held (timer), sentAt } */
const streams = new Map();
let viewers = 0;

/** How many cameras are streamed and how many viewers watch them (tests, the status page). */
export function liveStats() {
  return { upstreams: streams.size, clients: viewers, cameras: [...streams.values()].map((s) => ({ camera: s.camera, clients: s.sinks.size })) };
}

function closeStream(s, reason) {
  if (streams.get(s.camera) !== s) return;
  streams.delete(s.camera);
  clearTimeout(s.stall);
  clearTimeout(s.held);
  s.ctl.abort();
  const sinks = [...s.sinks];
  s.sinks.clear();
  viewers -= sinks.length;
  for (const k of sinks) {
    try {
      k.end(reason);
    } catch { /* a viewer that went away */ }
  }
}

/** Send the newest picture of a stream to its viewers. */
function sendLast(s) {
  clearTimeout(s.held);
  s.held = null;
  if (streams.get(s.camera) !== s || !s.last) return;
  s.sentAt = Date.now();
  const bytes = livePart(s.last);
  for (const k of s.sinks) k.frame(bytes);
}

function armStall(s) {
  clearTimeout(s.stall);
  s.stall = setTimeout(() => closeStream(s, 'stall'), LIVE_LIMITS.stallMs);
  s.stall.unref?.();
}

async function runUpstream(s) {
  // never close a stream before watchLive() has added its first viewer
  await null;
  let settings;
  try {
    settings = settingsOrThrow();
  } catch {
    return closeStream(s, 'homeassistant_off');
  }
  const connect = setTimeout(() => s.ctl.abort(), LIVE_LIMITS.connectMs);
  try {
    const r = await fetch(`${settings.url}/api/camera_proxy_stream/${encodeURIComponent(s.camera)}`, {
      headers: { authorization: `Bearer ${settings.token}`, accept: 'multipart/x-mixed-replace' },
      signal: s.ctl.signal,
      redirect: 'error',
    });
    clearTimeout(connect);
    const ct = String(r.headers.get('content-type') || '');
    const m = /^multipart\/x-mixed-replace\s*;.*boundary\s*=\s*"?([^";]+)"?/i.exec(ct);
    if (!r.ok || !m) {
      r.body?.cancel().catch(() => {});
      return closeStream(s, 'camera_unavailable');
    }
    const reader = new MultipartReader(m[1], {
      onPart: (part) => {
        armStall(s);
        // anything that is not a picture Marco accepts is dropped, never passed on
        if (!part.type || !part.body.length) return;
        s.last = { ...part, at: Date.now() };
        // at most one picture every minFrameMs: the newest one, the others in between are skipped
        const wait = s.sentAt + LIVE_LIMITS.minFrameMs - Date.now();
        if (wait > 0) {
          if (!s.held) {
            s.held = setTimeout(() => sendLast(s), wait);
            s.held.unref?.();
          }
          return;
        }
        sendLast(s);
      },
      onError: () => closeStream(s, 'camera_unavailable'),
    });
    armStall(s);
    for await (const chunk of r.body) {
      if (streams.get(s.camera) !== s) break;
      reader.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    closeStream(s, 'ended');
  } catch {
    closeStream(s, 'camera_unavailable');
  } finally {
    clearTimeout(connect);
  }
}

/**
 * Watch the live picture of `camera`. `sink` = { frame(bytes), end(reason) }: `frame` gets each part of Marco's own
 * multipart stream (livePart), `end` is called once when the stream stops (the viewer should end its response).
 * Returns { ok: true, leave() } or { ok: false, error: 'busy' | 'homeassistant_off' }. `leave()` is safe to call
 * more than once; the upstream closes when its last viewer leaves.
 */
export function watchLive(camera, sink) {
  try {
    settingsOrThrow();
  } catch {
    return { ok: false, error: 'homeassistant_off' };
  }
  let s = streams.get(camera);
  if (viewers >= LIVE_LIMITS.clients || (!s && streams.size >= LIVE_LIMITS.upstreams)) return { ok: false, error: 'busy' };
  if (!s) {
    s = { camera, ctl: new AbortController(), sinks: new Set(), last: null, stall: null, held: null, sentAt: 0 };
    streams.set(camera, s);
    void runUpstream(s);
  }
  const stream = s;
  stream.sinks.add(sink);
  viewers++;
  let gone = false;
  // a viewer that joins a running stream sees its latest picture at once (once the caller has sent its headers)
  setImmediate(() => {
    if (!gone && stream.sinks.has(sink) && stream.last && Date.now() - stream.last.at < 5000) sink.frame(livePart(stream.last));
  });
  return {
    ok: true,
    leave() {
      if (gone) return;
      gone = true;
      if (!stream.sinks.delete(sink)) return;
      viewers--;
      if (!stream.sinks.size) closeStream(stream, 'idle');
    },
  };
}

/** Testing helper: forget every frame and close every stream. */
export function _resetHaCamera() {
  frames.clear();
  pending.clear();
  for (const s of [...streams.values()]) closeStream(s, 'reset');
  viewers = 0;
}
