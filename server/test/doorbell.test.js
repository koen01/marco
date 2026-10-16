// Doorbell camera: hook validation and ring state (server/core/doorbellCore.js), config validation, and the real app
// (server/app.js createApp) with a fake Home Assistant on a random port: POST /api/hooks/doorbell, the admin test
// route, delivery over the poll channel, and the frame endpoint's access rules (no ring, wrong screen, invalid key,
// throttle, failures). The Home Assistant token must never reach a display.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import {
  sanitizeDoorbell, ring, dismiss, activeRing, targetScreens, ringPayload, clampSeconds, frameType, DOORBELL_MAX_SEC,
} from '../core/doorbellCore.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion, resolveScreenList } from '../displays.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetActivityThrottle, listActivity } from '../activity.js';
import { _resetPairing } from '../pairing.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess } from '../displayAccess.js';
import { _resetPoll } from '../pollHub.js';
import { createToken } from '../tokens.js';
import { _resetDoorbell, FRAME_CACHE_MS } from '../doorbell.js';
import { _resetDoorbellRtc, rtcStats, RTC_SESSION_LIMIT } from '../doorbellRtc.js';
import { sanitizeOffer, sanitizeCandidate, clientConfig, supportsWebrtc } from '../core/doorbellRtcCore.js';

const HA_TOKEN = 'ha-secret-long-lived-token-0123456789';
// A tiny JPEG-looking body (the server checks the content type, never decodes the picture).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

const cfgLike = () => {
  const c = defaultConfig();
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  return c;
};

// ------------------------------------------------------------------------------------------------ core

test('sanitizeDoorbell: defaults from the settings, clamping, overrides and errors', () => {
  const cfg = cfgLike();
  const resolve = (keys) => resolveScreenList(cfg, keys);
  const settings = { camera: 'camera.front_door', seconds: 45, screenIds: ['s_kitchen'], sound: true };
  let v = sanitizeDoorbell({}, settings, resolve);
  assert.deepEqual(v.value, { action: 'ring', seconds: 45, screenIds: ['s_kitchen'], screensGiven: false, camera: 'camera.front_door', sound: true });
  v = sanitizeDoorbell(undefined, settings, resolve);
  assert.equal(v.ok, true, 'an empty body rings with the settings');
  v = sanitizeDoorbell({ action: 'ring', seconds: 5000, screens: ['S_MAIN'], camera: 'camera.garden', sound: false }, settings, resolve);
  assert.deepEqual(v.value, { action: 'ring', seconds: DOORBELL_MAX_SEC, screenIds: ['s_main'], screensGiven: true, camera: 'camera.garden', sound: false });
  assert.equal(sanitizeDoorbell({ seconds: 1 }, settings, resolve).value.seconds, 10);
  assert.equal(sanitizeDoorbell({ action: 'dismiss' }, settings, resolve).value.screensGiven, false);

  const bad = sanitizeDoorbell({ action: 'open', seconds: 'soon', camera: 'sensor.door', sound: 'yes', screens: ['nowhere'] }, settings, resolve);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.details.map((d) => d.path).sort(), ['action', 'camera', 'screens', 'seconds', 'sound']);
  assert.match(bad.details.find((d) => d.path === 'screens').message, /unknown screen: nowhere/);
  for (const camera of ['camera.', 'camera.Front', 'camera.a/b', 'camera.x?y', 'light.x', 42]) {
    assert.equal(sanitizeDoorbell({ camera }, settings, resolve).ok, false, String(camera));
  }
  assert.equal(sanitizeDoorbell([], settings, resolve).ok, false);
  assert.equal(sanitizeDoorbell({ seconds: true }, settings, resolve).ok, false);
  assert.equal(clampSeconds('x'), 60);
});

test('ring state: a second ring extends (never shortens), dismiss ends, expiry, payload without camera', () => {
  const rings = {};
  let n = 0;
  const id = () => `d_${++n}`;
  const t0 = Date.parse('2026-10-11T10:00:00Z');
  const [a] = ring(rings, { screenIds: ['s_main'], seconds: 60, camera: 'camera.door', sound: true }, t0, id);
  assert.equal(a.id, 'd_1');
  assert.equal(a.expiresAt, '2026-10-11T10:01:00.000Z');
  // 20 s later, 10 s more: the later end time wins
  ring(rings, { screenIds: ['s_main'], seconds: 10, camera: 'camera.door', sound: true }, t0 + 20_000, id);
  assert.equal(rings.s_main.expiresAt, '2026-10-11T10:01:00.000Z', 'a shorter ring does not cut the current one');
  const [b] = ring(rings, { screenIds: ['s_main', 's_kitchen'], seconds: 120, camera: 'camera.side', sound: false }, t0 + 30_000, id);
  assert.equal(b.id, 'd_1', 'same ring');
  assert.equal(b.rings, 3);
  assert.equal(b.camera, 'camera.side');
  assert.equal(rings.s_main.expiresAt, '2026-10-11T10:02:30.000Z');
  assert.equal(rings.s_kitchen.id, 'd_2');
  assert.equal(activeRing(rings, 's_main', t0 + 151_000), null, 'over');
  const p = ringPayload(rings.s_kitchen);
  assert.deepEqual(Object.keys(p).sort(), ['expiresAt', 'frames', 'id', 'refreshMs', 'screenId', 'sound', 'startedAt', 'updatedAt']);
  assert.equal(JSON.stringify(p).includes('camera'), false);
  assert.equal(ringPayload({ ...rings.s_kitchen, camera: '' }).frames, false);
  assert.deepEqual(dismiss(rings, ['s_kitchen'], t0 + 31_000).map((r) => r.id), ['d_2']);
  assert.deepEqual(Object.keys(rings), ['s_main']);
  assert.deepEqual(dismiss(rings, [], t0 + 31_000).map((r) => r.id), ['d_1'], 'no screens = every ring');
  assert.deepEqual(rings, {});
  // an expired ring is replaced by a new one, not extended
  ring(rings, { screenIds: ['s_main'], seconds: 10, camera: '', sound: true }, t0, id);
  assert.equal(ring(rings, { screenIds: ['s_main'], seconds: 10, camera: '', sound: true }, t0 + 60_000, id)[0].id, 'd_4');
});

test('targetScreens and frameType', () => {
  const cfg = cfgLike();
  assert.deepEqual(targetScreens(cfg, []), ['s_main', 's_kitchen']);
  assert.deepEqual(targetScreens(cfg, ['s_kitchen', 's_gone']), ['s_kitchen']);
  assert.equal(frameType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(frameType('IMAGE/JPG'), 'image/jpeg');
  assert.equal(frameType('image/png'), 'image/png');
  assert.equal(frameType('text/html'), '');
  assert.equal(frameType('image/svg+xml'), '', 'no SVG (scripts)');
  assert.equal(frameType(undefined), '');
});

test('config: homeassistant.doorbell validation and deleted screens', () => {
  const c = cfgLike();
  let v = validateConfig(c);
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.homeassistant.doorbell, { camera: '', seconds: 60, screenIds: [], sound: true });
  c.homeassistant.doorbell = { camera: 'camera.front_door', seconds: 120, screenIds: ['s_kitchen'], sound: false };
  v = validateConfig(c);
  assert.equal(v.ok, true);
  assert.deepEqual(v.value.homeassistant.doorbell, c.homeassistant.doorbell);
  for (const [k, bad] of [['camera', 'sensor.door'], ['seconds', 5], ['seconds', 301], ['sound', 'yes']]) {
    const x = cfgLike();
    x.homeassistant.doorbell = { ...c.homeassistant.doorbell, [k]: bad };
    const r = validateConfig(x);
    assert.equal(r.ok, false, `${k}=${bad}`);
    assert.ok(r.errors.some((e) => e.path === `homeassistant.doorbell.${k}`), k);
  }
  // the only chosen screen was deleted: the default screen, never "every screen"
  const gone = cfgLike();
  gone.homeassistant.doorbell = { camera: '', seconds: 60, screenIds: ['s_kitchen'], sound: true };
  gone.screens = gone.screens.filter((s) => s.id !== 's_kitchen');
  assert.deepEqual(validateConfig(gone).value.homeassistant.doorbell.screenIds, ['s_main']);
  // configs saved before the doorbell existed get the defaults
  const old = cfgLike();
  delete old.homeassistant.doorbell;
  assert.deepEqual(validateConfig(old).value.homeassistant.doorbell.seconds, 60);
});

// ------------------------------------------------------------------------------------------------ app

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));

/** Fake Home Assistant: GET /api/camera_proxy/<entity> with the bearer token answers JPEG. */
async function fakeHa() {
  const hits = [];
  const state = { mode: 'ok', delay: 0 };
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, auth: req.headers.authorization });
    const send = () => {
      if (req.headers.authorization !== `Bearer ${HA_TOKEN}`) { res.writeHead(401); return res.end('unauthorized'); }
      if (!req.url.startsWith('/api/camera_proxy/camera.')) { res.writeHead(404); return res.end(); }
      if (state.mode === 'down') { res.writeHead(500); return res.end('boom'); }
      if (state.mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<script>alert(1)</script>'); }
      if (state.mode === 'huge') { res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) }); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'x-ha-secret': 'should-not-pass' });
      res.end(JPEG);
    };
    if (state.delay) setTimeout(send, state.delay); else send();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, hits, state, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function withServer(fn, { mode = 'private', rtcHa = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-doorbell-'));
  globalThis.fetch = offlineFetch;
  const ha = await fakeHa();
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = mode;
  c.screens.push(defaultScreenProfile({ id: 's_kitchen', slug: 'kitchen', name: 'Kitchen' }));
  c.homeassistant = { enabled: true, url: ha.url, doorbell: { camera: 'camera.front_door', seconds: 60, screenIds: [], sound: true } };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({
    passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false, homeassistant: { token: HA_TOKEN },
  }));
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetPairing();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPoll();
  _resetDoorbell();
  _resetDoorbellRtc(rtcHa?.open ?? null);
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  const { token } = createToken('Home Assistant');
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, headers = {}, raw } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    return { status: r.status, json, buf, text: buf.toString('utf8'), headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const hook = (body, headers = {}) => call('POST', '/api/hooks/doorbell', { body, headers: { authorization: `Bearer ${token}`, ...headers } });
  const key = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;
  const frame = (slug, n = 1) => call('GET', `/api/display/doorbell/frame?n=${n}`, { headers: slug ? { 'x-marco-key': key(slug) } : {} });
  const poll = async (slug, q = {}) => {
    const r = await call('GET', `/api/display/poll?${new URLSearchParams(q)}`, { headers: { 'x-marco-key': key(slug) } });
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  try {
    await fn({ call, hook, frame, poll, key, ha, login, token });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await ha.close();
    _resetDoorbellRtc();
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

const noToken = (r) => {
  const all = r.text + JSON.stringify([...r.headers.entries()]);
  assert.equal(all.includes(HA_TOKEN), false, 'the Home Assistant token never reaches a display');
  assert.equal(all.includes('should-not-pass'), false, 'Home Assistant headers are not passed through');
};

test('hook: auth, validation, ring, extend, dismiss, activity', async () => {
  await withServer(async ({ call, hook, token }) => {
    assert.equal((await call('POST', '/api/hooks/doorbell', { body: {} })).status, 401);
    assert.equal((await call('POST', '/api/hooks/doorbell', { raw: 'ring', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' } })).status, 415);
    let r = await hook({ action: 'knock' });
    assert.equal(r.status, 400);
    assert.equal(r.json.details[0].path, 'action');
    r = await hook({ camera: '../../api/states' });
    assert.equal(r.status, 400, 'only camera.* entity ids');
    r = await hook({ screens: ['attic'] });
    assert.equal(r.status, 400);

    r = await hook({ action: 'ring', seconds: 30, screens: ['kitchen'] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.action, 'ring');
    assert.deepEqual(r.json.screens, ['kitchen']);
    const first = Date.parse(r.json.expiresAt);
    assert.ok(first > Date.now() + 25_000 && first <= Date.now() + 31_000);
    r = await hook({ seconds: 120, screens: ['kitchen'] });
    assert.ok(Date.parse(r.json.expiresAt) > first + 80_000, 'ringing again extends');
    // no screens = the configured ones (all here)
    r = await hook({});
    assert.deepEqual(r.json.screens.sort(), ['kitchen', 'living-room']);

    r = await hook({ action: 'dismiss', screens: ['kitchen'] });
    assert.deepEqual(r.json, { ok: true, action: 'dismiss', delivered: 0, screens: ['kitchen'] });
    r = await hook({ action: 'dismiss' });
    assert.deepEqual(r.json.screens, ['living-room'], 'dismiss without screens ends every ring');

    const log = listActivity({ type: 'display.doorbell' }).items;
    assert.equal(log.length, 5);
    assert.equal(log.at(-1).data.action, 'ring');
    assert.equal(log.at(-1).data.via, 'hook');
    assert.equal(log.at(-1).actor, 'token:Home Assistant');
    assert.equal(log.at(-2).data.extended, true);
    assert.equal(log[0].data.action, 'dismiss');
  });
});

test('frame: refused without a ring, for another screen and with a bad key; served while ringing, token kept on the server', async () => {
  await withServer(async ({ hook, frame, ha, call }) => {
    let r = await frame('kitchen');
    assert.equal(r.status, 404);
    assert.equal(r.json.code, 'no_ring');
    assert.equal(ha.hits.length, 0, 'Home Assistant is not asked without a ring');
    assert.equal((await frame(null)).status, 401, 'private mode: a credential is required');
    assert.equal((await call('GET', '/api/display/doorbell/frame', { headers: { 'x-marco-key': '3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37' } })).status, 403);

    await hook({ screens: ['kitchen'] });
    r = await frame('kitchen');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.deepEqual(r.buf, JPEG);
    noToken(r);
    assert.equal(ha.hits[0].url, '/api/camera_proxy/camera.front_door');
    assert.equal(ha.hits[0].auth, `Bearer ${HA_TOKEN}`);

    r = await frame('living-room');
    assert.equal(r.status, 404, 'a screen that is not ringing gets nothing');
    noToken(r);

    // the display payload carries no camera id, Home Assistant address or token
    await hook({ action: 'dismiss' });
    assert.equal((await frame('kitchen')).status, 404, 'dismissed: no more frames');
  });
});

test('frame: shared between displays for a moment, camera override, failures', async () => {
  await withServer(async ({ hook, frame, ha }) => {
    await hook({ camera: 'camera.garden' });
    ha.state.delay = 80;
    const all = await Promise.all([frame('kitchen', 1), frame('living-room', 1), frame('kitchen', 2), frame('living-room', 2)]);
    assert.deepEqual(all.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(ha.hits.length, 1, 'one request to Home Assistant for four displays');
    assert.equal(ha.hits[0].url, '/api/camera_proxy/camera.garden');
    ha.state.delay = 0;
    await new Promise((r) => setTimeout(r, FRAME_CACHE_MS + 50));
    await frame('kitchen', 3);
    assert.equal(ha.hits.length, 2, 'a new frame after the cache time');

    for (const mode of ['down', 'html', 'huge']) {
      ha.state.mode = mode;
      await new Promise((r) => setTimeout(r, FRAME_CACHE_MS + 20));
      const r = await frame('kitchen', 9);
      assert.equal(r.status, 502, mode);
      assert.equal(r.json.code, 'camera_unavailable');
      noToken(r);
    }
  });
});

test('frame: no camera chosen, Home Assistant turned off', async () => {
  await withServer(async ({ hook, frame, login, call, poll }) => {
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { headers: { cookie } })).json;
    cfg.homeassistant.doorbell.camera = '';
    const saved = await call('PUT', '/api/admin/config', { body: cfg, headers: { cookie } });
    assert.equal(saved.status, 200, saved.text);
    await hook({ screens: ['kitchen'] });
    const p = await poll('kitchen', { client: 'kiosk-k1' });
    assert.equal(p.commands.find((c) => c.type === 'doorbell').frames, false);
    assert.equal((await frame('kitchen')).json.code, 'no_camera');
    cfg.homeassistant.enabled = false;
    cfg.homeassistant.doorbell.camera = 'camera.front_door';
    const again = (await call('GET', '/api/admin/config', { headers: { cookie } })).json;
    again.homeassistant.enabled = false;
    assert.equal((await call('PUT', '/api/admin/config', { body: again, headers: { cookie } })).status, 200);
    await hook({ screens: ['kitchen'], camera: 'camera.front_door' });
    const r = await frame('kitchen');
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'homeassistant_off');
  });
});

test('delivery: poll reset and commands reach only the ringing screen, without secrets', async () => {
  await withServer(async ({ hook, poll }) => {
    const k0 = await poll('kitchen', { client: 'kiosk-k1' });
    const m0 = await poll('living-room', { client: 'kiosk-m1' });
    assert.equal(k0.doorbellId, null);
    await hook({ screens: ['kitchen'], seconds: 45 });
    const k1 = await poll('kitchen', { client: 'kiosk-k1', cursor: k0.cursor });
    const db = k1.commands.find((c) => c.type === 'doorbell');
    assert.ok(db, JSON.stringify(k1.commands));
    assert.deepEqual(Object.keys(db).sort(), ['expiresAt', 'frames', 'id', 'refreshMs', 'screenId', 'sound', 'startedAt', 'type', 'updatedAt']);
    assert.equal(db.frames, true);
    const text = JSON.stringify(k1);
    for (const secret of [HA_TOKEN, 'camera.front_door', '127.0.0.1']) assert.equal(text.includes(secret), false, secret);
    const m1 = await poll('living-room', { client: 'kiosk-m1', cursor: m0.cursor });
    assert.equal(m1.commands.some((c) => c.type === 'doorbell'), false);
    // a display that starts now gets the ring in its reset
    const fresh = await poll('kitchen', { client: 'kiosk-k2' });
    assert.equal(fresh.doorbellId, db.id);
    assert.equal(fresh.commands.find((c) => c.type === 'doorbell').id, db.id);
    await hook({ action: 'dismiss' });
    const k2 = await poll('kitchen', { client: 'kiosk-k1', cursor: k1.cursor });
    assert.deepEqual(k2.commands.map((c) => [c.type, c.id]), [['doorbell-end', db.id]]);
    assert.equal((await poll('kitchen', { client: 'kiosk-k3' })).doorbellId, null);
  });
});

test('admin: the test button needs a session; health lists the features', async () => {
  await withServer(async ({ call, login }) => {
    const health = (await call('GET', '/api/health')).json;
    assert.equal(health.features.doorbell, true);
    assert.equal(health.features.doorbellLive, true);
    assert.equal((await call('POST', '/api/admin/doorbell', { body: {} })).status, 401);
    const cookie = await login();
    const r = await call('POST', '/api/admin/doorbell', { body: { action: 'ring', seconds: 20, screens: ['s_kitchen'] }, headers: { cookie } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.screens, ['kitchen']);
    assert.equal(listActivity({ type: 'display.doorbell' }).items[0].data.via, 'admin');
    assert.equal((await call('POST', '/api/admin/doorbell', { body: { action: 'dismiss' }, headers: { cookie } })).json.action, 'dismiss');
  });
});

test('open display access: frames only for LAN clients (loopback counts as LAN here)', async () => {
  await withServer(async ({ hook, call }) => {
    await hook({});
    const r = await call('GET', '/api/display/doorbell/frame?screen=kitchen');
    assert.equal(r.status, 200);
    noToken(r);
  }, { mode: 'open' });
});

// ------------------------------------------------------------------------------------------------ live video (WebRTC)

const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const ANSWER = 'v=0\r\no=- 9 2 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const CAND = { candidate: 'candidate:1 1 udp 2122260223 192.168.1.20 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };

test('webrtc core: offers, candidates, client configuration, capabilities', () => {
  assert.deepEqual(sanitizeOffer({ sdp: OFFER }), { ok: true, sdp: OFFER });
  for (const bad of [null, {}, { sdp: 5 }, { sdp: 'hello' }, { sdp: `v=0${'x'.repeat(40_000)}` }, { sdp: 'v=0\0' }]) assert.equal(sanitizeOffer(bad).ok, false, JSON.stringify(bad)?.slice(0, 40));
  assert.deepEqual(sanitizeCandidate({ ...CAND, usernameFragment: 'x', extra: 1 }), CAND);
  assert.deepEqual(sanitizeCandidate({ candidate: 'a=candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMLineIndex: 1 }), { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: null, sdpMLineIndex: 1 });
  assert.deepEqual(sanitizeCandidate({ candidate: '', sdpMid: '0' }), { candidate: '', sdpMid: '0', sdpMLineIndex: null }, 'end of candidates');
  for (const bad of [null, { candidate: 'x', sdpMid: '0' }, { candidate: 'candidate:1\r\na=evil', sdpMid: '0' }, { candidate: 'candidate:1' }, { candidate: 'candidate:1', sdpMid: '<script>' }]) assert.equal(sanitizeCandidate(bad), null, JSON.stringify(bad));
  const cfg = clientConfig({
    configuration: { iceServers: [
      { urls: ['stun:stun.example.org:3478', 'http://evil.example/'] },
      { urls: 'turn:turn.example.org:3478?transport=udp', username: 'u', credential: 'c' },
      { urls: ['javascript:alert(1)'] },
    ] },
    dataChannel: 'dataSendChannel',
  });
  assert.deepEqual(cfg, { iceServers: [{ urls: ['stun:stun.example.org:3478'] }, { urls: ['turn:turn.example.org:3478?transport=udp'], username: 'u', credential: 'c' }], dataChannel: 'dataSendChannel' });
  assert.equal(clientConfig({ dataChannel: 'a b' }).dataChannel, null);
  assert.equal(supportsWebrtc({ frontend_stream_types: ['web_rtc'] }), true);
  assert.equal(supportsWebrtc({ frontend_stream_types: ['hls'] }), false);
  assert.equal(supportsWebrtc(null), false);
});

/** A fake Home Assistant WebSocket for the WebRTC commands. `mode`: 'ok' | 'hls' | 'error' | 'silent' | 'old'. */
function fakeRtcHa() {
  const state = { mode: 'ok', opened: 0, open: 0, calls: [], token: '', subs: [] };
  const open = async ({ token }) => {
    state.token = token;
    state.opened++;
    state.open++;
    const closers = [];
    let closed = false;
    const sock = {
      async call(msg) {
        if (closed) throw Object.assign(new Error('closed'), { code: 'closed' });
        state.calls.push(msg);
        if (state.mode === 'old') throw Object.assign(new Error('unknown'), { code: 'unknown_command' });
        if (msg.type === 'camera/capabilities') return { frontend_stream_types: state.mode === 'hls' ? ['hls'] : ['web_rtc'] };
        if (msg.type === 'camera/webrtc/get_client_config') return { configuration: { iceServers: [{ urls: ['stun:stun.example.org:3478'] }] }, dataChannel: 'dataSendChannel' };
        return null;
      },
      async subscribe(msg, onEvent) {
        await sock.call(msg);
        state.subs.push({ msg, onEvent, sock });
        if (state.mode === 'ok') {
          setTimeout(() => {
            onEvent({ type: 'session', session_id: 'ha-sess-1' });
            onEvent({ type: 'candidate', candidate: { ...CAND, candidate: CAND.candidate.replace('192.168.1.20', '203.0.113.9') } });
            onEvent({ type: 'answer', answer: ANSWER });
          }, 5);
        } else if (state.mode === 'error') {
          setTimeout(() => onEvent({ type: 'error', code: 'webrtc_offer_failed', message: 'nope' }), 5);
        }
        return 1;
      },
      close() {
        if (closed) return;
        closed = true;
        state.open--;
        for (const fn of closers) fn();
      },
      onClose(fn) {
        closers.push(fn);
      },
    };
    return sock;
  };
  return { state, open };
}

test('webrtc: config and negotiation only while ringing, relayed to Home Assistant, bound to the display', async () => {
  const rha = fakeRtcHa();
  await withServer(async ({ hook, call, key }) => {
    const k = (slug) => ({ 'x-marco-key': key(slug) });
    let r = await call('GET', '/api/display/doorbell/webrtc', { headers: k('kitchen') });
    assert.equal(r.status, 404);
    assert.equal(r.json.code, 'no_ring');
    assert.equal(rha.state.opened, 0, 'Home Assistant is not asked without a ring');
    assert.equal((await call('GET', '/api/display/doorbell/webrtc')).status, 401);

    await hook({ screens: ['kitchen'] });
    r = await call('GET', '/api/display/doorbell/webrtc', { headers: k('kitchen') });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { iceServers: [{ urls: ['stun:stun.example.org:3478'] }], dataChannel: 'dataSendChannel' });
    assert.equal(rha.state.token, HA_TOKEN);
    assert.deepEqual(rha.state.calls.map((c) => [c.type, c.entity_id]), [['camera/capabilities', 'camera.front_door'], ['camera/webrtc/get_client_config', 'camera.front_door']]);
    assert.equal(rha.state.open, 0, 'the config socket is closed again');
    noToken(r);
    assert.equal((await call('GET', '/api/display/doorbell/webrtc', { headers: k('living-room') })).json.code, 'no_ring', 'another screen gets nothing');

    assert.equal((await call('POST', '/api/display/doorbell/webrtc', { body: { sdp: 'nope' }, headers: k('kitchen') })).status, 400);
    r = await call('POST', '/api/display/doorbell/webrtc', { body: { sdp: OFFER }, headers: k('kitchen') });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.answer, ANSWER);
    assert.equal(r.json.candidates.length, 1);
    assert.match(r.json.candidates[0].candidate, /203\.0\.113\.9/);
    assert.equal(r.json.next, 1);
    noToken(r);
    const sid = r.json.session;
    assert.match(sid, /^[\w-]{20,}$/);
    const offer = rha.state.subs[0].msg;
    assert.deepEqual(offer, { type: 'camera/webrtc/offer', entity_id: 'camera.front_door', offer: OFFER });
    assert.equal(rtcStats().sessions, 1);

    // the display's candidates go to Home Assistant's session; another display cannot touch the session
    r = await call('POST', `/api/display/doorbell/webrtc/${sid}/candidate`, { body: { candidate: CAND }, headers: k('kitchen') });
    assert.equal(r.status, 200, r.text);
    await new Promise((res) => setTimeout(res, 10));
    assert.deepEqual(rha.state.calls.at(-1), { type: 'camera/webrtc/candidate', entity_id: 'camera.front_door', session_id: 'ha-sess-1', candidate: CAND });
    assert.equal((await call('POST', `/api/display/doorbell/webrtc/${sid}/candidate`, { body: { candidate: { candidate: 'x' } }, headers: k('kitchen') })).status, 400);
    assert.equal((await call('POST', `/api/display/doorbell/webrtc/${sid}/candidate`, { body: { candidate: CAND }, headers: k('living-room') })).status, 404);
    r = await call('GET', `/api/display/doorbell/webrtc/${sid}?after=1`, { headers: k('living-room') });
    assert.equal(r.json.closed, true, 'not its session');

    // a later candidate of Home Assistant reaches a waiting poll
    const poll = call('GET', `/api/display/doorbell/webrtc/${sid}?after=1`, { headers: k('kitchen') });
    await new Promise((res) => setTimeout(res, 20));
    rha.state.subs[0].onEvent({ type: 'candidate', candidate: { candidate: '', sdpMid: '0' } });
    r = await poll;
    assert.deepEqual(r.json, { candidates: [{ candidate: '', sdpMid: '0', sdpMLineIndex: null }], next: 2, closed: false });

    // dismissing the ring ends the session and closes Home Assistant's socket
    assert.equal(rha.state.open, 1);
    await hook({ action: 'dismiss' });
    await new Promise((res) => setTimeout(res, 1100));
    assert.equal(rtcStats().sessions, 0);
    assert.equal(rha.state.open, 0, 'the camera stream is closed with the ring');
    r = await call('GET', `/api/display/doorbell/webrtc/${sid}?after=2`, { headers: k('kitchen') });
    assert.equal(r.json.closed, true);
  }, { rtcHa: rha });
});

test('webrtc: closing, replacing, the limit, cameras without WebRTC, failures', async () => {
  const rha = fakeRtcHa();
  await withServer(async ({ hook, call, key }) => {
    const k = (slug) => ({ 'x-marco-key': key(slug) });
    const offer = (slug) => call('POST', '/api/display/doorbell/webrtc', { body: { sdp: OFFER }, headers: k(slug) });
    await hook({});
    const a = (await offer('kitchen')).json.session;
    const b = (await offer('kitchen')).json.session;
    assert.notEqual(a, b);
    assert.equal(rtcStats().sessions, 1, 'a new offer of the same display ends its old session');
    assert.equal(rha.state.open, 1);
    assert.equal((await call('DELETE', `/api/display/doorbell/webrtc/${b}`, { headers: k('living-room') })).status, 200, 'closing is quiet');
    assert.equal(rtcStats().sessions, 1, 'but only the owner closes it');
    assert.equal((await call('DELETE', `/api/display/doorbell/webrtc/${b}`, { headers: k('kitchen') })).status, 200);
    assert.equal(rtcStats().sessions, 0);
    assert.equal(rha.state.open, 0);

    // one session per display and screen, whichever display asks
    await offer('kitchen');
    await offer('living-room');
    assert.equal(rtcStats().sessions, 2);
    assert.ok(RTC_SESSION_LIMIT >= 2);

    rha.state.mode = 'hls';
    let r = await call('GET', '/api/display/doorbell/webrtc', { headers: k('kitchen') });
    assert.equal(r.status, 404);
    assert.equal(r.json.code, 'no_webrtc', 'a camera without WebRTC: the display keeps the pictures');
    rha.state.mode = 'old';
    assert.equal((await call('GET', '/api/display/doorbell/webrtc', { headers: k('kitchen') })).json.code, 'no_webrtc', 'Home Assistant before 2024.11');
    rha.state.mode = 'error';
    r = await offer('kitchen');
    assert.equal(r.status, 502);
    assert.equal(r.json.code, 'camera_unavailable');
    assert.equal(rtcStats().sessions, 1, 'the failed one is gone, the other display keeps its own');
  }, { rtcHa: rha });
});

test('webrtc: the admin preview and open access from outside get nothing; no WebSocket means no live video', async () => {
  await withServer(async ({ hook, call, login }) => {
    await hook({});
    const cookie = await login();
    const r = await call('GET', '/api/display/doorbell/webrtc?screen=kitchen', { headers: { cookie } });
    assert.equal(r.status, 403);
    assert.equal(r.json.code, 'preview');
  });
  if (typeof globalThis.WebSocket !== 'function') {
    await withServer(async ({ hook, call, key }) => {
      await hook({});
      const r = await call('GET', '/api/display/doorbell/webrtc', { headers: { 'x-marco-key': key('kitchen') } });
      assert.equal(r.status, 404);
      assert.equal(r.json.code, 'no_webrtc');
    });
  }
});
