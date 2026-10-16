// Doorbell camera: a ring puts the camera picture full screen on the chosen displays for a while (POST
// /api/hooks/doorbell, the admin's test button). Rings live in memory only: after a restart nothing rings. Frames are
// proxied from Home Assistant (/api/camera_proxy/<entity>) with the stored token, only to a display whose screen is
// ringing right now, never written to disk, and shared between displays for FRAME_CACHE_MS so a house full of
// screens asks Home Assistant for at most about two frames a second. The frames come from server/haCamera.js, which
// the Cámara cards of Personalizado screens share. See docs/API.md and docs/ARCHITECTURE.md.
import { getConfig } from './store.js';
import { publish } from './pollHub.js';
import { activeRing, dismiss, pruneRings, ring, ringPayload, targetScreens } from './core/doorbellCore.js';
import { cameraFrame, pruneFrames, _resetHaCamera } from './haCamera.js';

export { FRAME_CACHE_MS, FRAME_MAX_BYTES, FRAME_TIMEOUT_MS, cameraFrame } from './haCamera.js';

/** { [screenId]: Ring } */
let rings = {};

const payloadFor = (r) => ringPayload(r);

/** The ring a display of `screenId` should show now (stream replay, poll reset, hello), or null. */
export function ringFor(screenId, now = Date.now()) {
  return activeRing(rings, screenId, now);
}

/** Payload of the ring on `screenId` for replay, or null. */
export function ringPayloadFor(screenId, now = Date.now()) {
  const r = ringFor(screenId, now);
  return r ? payloadFor(r) : null;
}

/**
 * Run a sanitised doorbell request (core/doorbellCore.js sanitizeDoorbell). Returns { action, screenIds, delivered,
 * rings } where `screenIds` are the screens it reached.
 */
export function runDoorbell(value, now = Date.now()) {
  const cfg = getConfig();
  const screenIds = targetScreens(cfg, value.screenIds);
  let delivered = 0;
  if (value.action === 'dismiss') {
    // dismiss with no screens ends every ring, whatever the settings say
    const ended = dismiss(rings, value.screensGiven ? screenIds : [], now);
    for (const r of ended) delivered += publish('doorbell-end', { id: r.id }, { screenIds: [r.screenId] });
    dropUnusedFrames();
    return { action: 'dismiss', screenIds: ended.map((r) => r.screenId), delivered, rings: ended };
  }
  const changed = ring(rings, { screenIds, seconds: value.seconds, camera: value.camera, sound: value.sound }, now);
  for (const r of changed) delivered += publish('doorbell', payloadFor(r), { screenIds: [r.screenId] });
  return { action: 'ring', screenIds, delivered, rings: changed };
}

/** Config saved: rings of deleted screens end. */
export function pruneDoorbellScreens(cfg) {
  const ids = new Set(cfg.screens.map((s) => s.id));
  for (const sid of Object.keys(rings)) if (!ids.has(sid)) delete rings[sid];
}

function dropUnusedFrames(now = Date.now()) {
  pruneRings(rings, now);
  // the frame cache is shared with the Cámara cards: only frames too old to be served again go
  pruneFrames(now);
}

/**
 * GET /api/display/doorbell/frame for the screen `screenId`. Returns [status, { type, body }] or [status, { error,
 * code }]. Only while that screen rings, and only the camera of its ring.
 */
export async function frameFor(screenId, now = Date.now()) {
  const r = ringFor(screenId, now);
  if (!r) return [404, { error: 'no doorbell ring on this screen', code: 'no_ring' }];
  if (!r.camera) return [404, { error: 'no camera chosen', code: 'no_camera' }];
  try {
    const f = await cameraFrame(r.camera, now);
    // the ring may have been dismissed while Home Assistant answered
    if (!ringFor(screenId)) return [404, { error: 'no doorbell ring on this screen', code: 'no_ring' }];
    return [200, { type: f.type, body: f.body }];
  } catch (err) {
    return [err.status || 502, { error: err.code === 'homeassistant_off' ? 'Home Assistant is not set up' : 'camera unavailable', code: err.code || 'camera_unavailable' }];
  }
}

/** Testing helper. */
export function _resetDoorbell() {
  rings = {};
  _resetHaCamera();
}
