// Cámara cards and the shared camera module (server/haCamera.js) on the real app with a fake Home Assistant
// (fakeHa.js): the multipart reader, snapshots (shared by every screen and by the doorbell for a moment, one fetch
// for many displays, only JPEG/PNG/WebP/GIF up to 4 MB, Home Assistant's headers never passed on), the home network
// rule (cameraLanOnly), private screens, the showWhen binary sensor, the admin preview route, and live pictures: one
// upstream per camera shared by every viewer, at most 4 cameras and 8 viewers per server, Marco's own boundary, parts
// that are not pictures dropped, a part too large or a silent camera ends the stream, the upstream closes when the
// last viewer leaves, never for an admin session. The doorbell's own tests (doorbell.test.js) stay as they were.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { validateConfig } from '../core/validate.js';
import { ensurePassword, hashPassword } from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion } from '../displays.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetActivityThrottle } from '../activity.js';
import { _resetPairing } from '../pairing.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess } from '../displayAccess.js';
import { _resetPoll } from '../pollHub.js';
import { _resetPrivacy } from '../privacy.js';
import { startHomeAssistantLive, stopHomeAssistantLive } from '../haService.js';
import { _resetHaRoutes } from '../routes/ha.js';
import { _resetDoorbell, FRAME_CACHE_MS as DOORBELL_CACHE_MS } from '../doorbell.js';
import { MultipartReader, livePart, liveStats, watchLive, LIVE_BOUNDARY, LIVE_LIMITS, FRAME_CACHE_MS, _setLiveLimits } from '../haCamera.js';
import { createToken } from '../tokens.js';
import { fakeHa, FAKE_HA_TOKEN, FAKE_JPEG } from './fakeHa.js';
import { hasWebSocket } from '../haWs.js';

// the live mirror needs Node's global WebSocket (Node 22 and later); on Node 20 the server polls over REST instead
// ("no global WebSocket" in ha-live.test.js), and these tests are skipped
const NEEDS_WS = { skip: hasWebSocket() ? false : 'needs a global WebSocket (Node 22 or later)' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await wait(15);
  }
}

// ------------------------------------------------------------------------------------------------ multipart reader

test('MultipartReader: parts cut by length or by the next boundary, any chunking, odd boundaries, caps', () => {
  const jpeg = FAKE_JPEG;
  const withLen = (b, body, type = 'image/jpeg') => Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: ${type}\r\nContent-Length: ${body.length}\r\n\r\n`), body, Buffer.from('\r\n')]);
  const noLen = (b, body, type = 'image/jpeg') => Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: ${type}\r\n\r\n`), body, Buffer.from('\r\n')]);
  const run = (boundary, bytes, step, opts = {}) => {
    const parts = [];
    const errors = [];
    const r = new MultipartReader(boundary, { onPart: (p) => parts.push(p), onError: (e) => errors.push(e), ...opts });
    for (let i = 0; i < bytes.length; i += step) r.push(bytes.subarray(i, i + step));
    return { parts, errors };
  };
  const stream = Buffer.concat([withLen('frame', jpeg), withLen('frame', jpeg), noLen('frame', jpeg), Buffer.from('--frame\r\n')]);
  for (const step of [1, 3, 7, 64, stream.length]) {
    const { parts, errors } = run('frame', stream, step);
    assert.deepEqual(errors, [], `step ${step}`);
    assert.equal(parts.length, 3, `step ${step}`);
    for (const p of parts) {
      assert.equal(p.type, 'image/jpeg');
      assert.deepEqual(p.body, jpeg, 'the picture exactly, without the CRLF before the next boundary');
    }
  }
  // the boundary parameter with its dashes already in it (some cameras do that)
  assert.equal(run('--myboundary', Buffer.concat([Buffer.from('--myboundary\r\nContent-Type: image/jpeg\r\nContent-Length: 14\r\n\r\n'), jpeg, Buffer.from('\r\n--myboundary\r\n')]), 5).parts.length, 1);
  // a part that is not a picture Marco accepts: type '' (the caller drops it)
  assert.equal(run('b', withLen('b', Buffer.from('<svg onload="alert(1)"/>'), 'image/svg+xml'), 4).parts[0].type, '');
  assert.equal(run('b', withLen('b', jpeg, 'text/html'), 4).parts[0].type, '');
  // too large: by its Content-Length, or with no length and no boundary in sight
  let out = run('b', withLen('b', Buffer.alloc(3000)), 512, { maxPart: 2048 });
  assert.equal(out.parts.length, 0);
  assert.equal(out.errors.length, 1);
  out = run('b', Buffer.concat([Buffer.from('--b\r\nContent-Type: image/jpeg\r\n\r\n'), Buffer.alloc(5000)]), 512, { maxPart: 2048 });
  assert.equal(out.errors.length, 1, 'one error, then nothing');
  out = run('b', Buffer.concat([Buffer.from('--b\r\n'), Buffer.alloc(9000, 65)]), 512, { maxHead: 8192 });
  assert.equal(out.errors.length, 1, 'headers that never end');
  // what Marco sends: its own boundary, the part's type and length
  const part = livePart({ type: 'image/png', body: Buffer.from('xyz') }).toString('latin1');
  assert.equal(part, `--${LIVE_BOUNDARY}\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\nxyz\r\n`);
});

// ------------------------------------------------------------------------------------------------ the app

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));

const STATES = [
  { entity_id: 'camera.front', state: 'idle', attributes: { friendly_name: 'Front door', access_token: 'camtoken123', entity_picture: '/api/camera_proxy/camera.front?token=camtoken123' } },
  { entity_id: 'camera.garden', state: 'streaming', attributes: { friendly_name: 'Garden', access_token: 'camtoken456' } },
  { entity_id: 'camera.garage', state: 'idle', attributes: { friendly_name: 'Garage' } },
  { entity_id: 'camera.porch', state: 'idle', attributes: {} },
  { entity_id: 'camera.street', state: 'idle', attributes: {} },
  { entity_id: 'camera.yard', state: 'idle', attributes: {} },
  { entity_id: 'binary_sensor.doorbell_motion', state: 'off', attributes: { device_class: 'motion' } },
];

const M = (x, y, size) => ({ zone: 'main', x, y, size });
const item = (id, kind, pos, props = {}) => ({ id, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props } });

async function withApp(fn, { mutate = () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-cam-'));
  globalThis.fetch = offlineFetch;
  const ha = await fakeHa({ states: structuredClone(STATES) });
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  main.canvas = {
    ...defaultCanvas(),
    items: [
      item('cv_cama0001', 'ha.camera', M(0, 0, 'l'), { entity: 'camera.front' }),
      item('cv_cama0002', 'ha.camera', M(6, 0, 'l'), { entity: 'camera.garden', mode: 'live' }),
      item('cv_cama0003', 'ha.camera', M(0, 4, 'l'), { entity: 'camera.garage', showWhen: 'binary_sensor.doorbell_motion' }),
      item('cv_tile0001', 'ha.tile', M(6, 4, 'xs'), { entity: 'binary_sensor.doorbell_motion' }),
    ],
  };
  const hall = defaultScreenProfile({ id: 's_hall', slug: 'hall', name: 'Hall' });
  hall.layout.preset = 'canvas';
  hall.canvas = { ...defaultCanvas(), items: [item('cv_hall0001', 'ha.camera', M(0, 0, 'l'), { entity: 'camera.garden', mode: 'live' }), item('cv_hall0002', 'ha.camera', M(6, 0, 'l'), { entity: 'camera.front' })] };
  c.screens.push(hall);
  c.homeassistant = { enabled: true, url: ha.url, doorbell: { camera: 'camera.front', seconds: 60, screenIds: [], sound: true } };
  mutate(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({
    passwordHash: await hashPassword('secret-pass-123'), passwordIsDefault: false, homeassistant: { token: FAKE_HA_TOKEN },
  }));
  store.initStore(dir);
  _resetDisplays();
  _resetAnnouncements();
  _resetPairing();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetPoll();
  _resetPrivacy?.();
  _resetHaRoutes();
  _resetDoorbell();
  _setLiveLimits();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  startHomeAssistantLive({ timing: { backoffMin: 30, backoffMax: 100, pollMs: 80, failuresBeforePoll: 3, pingMs: 60_000 }, coalesceMs: 50 });
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bodies = [];
  const call = async (method, url, { body, headers = {} } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ }
    // what a display gets (the admin's own config holds the Home Assistant URL, by design)
    if (!headers.cookie) bodies.push(buf.toString('latin1') + JSON.stringify([...r.headers.entries()]));
    return { status: r.status, json, buf, text: buf.toString('utf8'), headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const key = (slug) => listDisplayLinks().find((l) => l.slug === (slug === 'main' ? store.getConfig().screens[0].slug : slug)).key;
  const display = (url, slug = 'main', headers = {}) => call('GET', url, { headers: { 'x-marco-key': key(slug), ...headers } });
  const login = async () => {
    const r = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  const camHits = (p = '/api/camera_proxy/') => ha.hits.filter((h) => h.url.startsWith(p));
  /** Open a live picture: { status, headers, parts: [{ type, body }], close() } (parts keep coming in the background). */
  const live = async (itemId, slug = 'main', headers = {}) => {
    const ctl = new AbortController();
    const r = await realFetch(`${base}/api/display/ha/camera/${itemId}/live`, { headers: { 'x-marco-key': key(slug), ...headers }, signal: ctl.signal });
    const out = { status: r.status, headers: r.headers, parts: [], raw: '', ended: false, close: () => ctl.abort() };
    if (r.status !== 200) {
      out.json = await r.json().catch(() => null);
      return out;
    }
    const reader = new MultipartReader(LIVE_BOUNDARY, { onPart: (p) => out.parts.push(p), onError: () => undefined, maxPart: 4 * 1024 * 1024 });
    const rd = r.body.getReader();
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          out.raw += Buffer.from(value).toString('latin1').slice(0, 2000);
          bodies.push(Buffer.from(value).toString('latin1'));
          reader.push(Buffer.from(value));
        }
      } catch { /* aborted */ }
      out.ended = true;
    })();
    return out;
  };
  try {
    await until(() => ha.connections().some((x) => x.subs.length), 4000, 'mirror subscribed');
    await wait(80);
    await fn({ call, display, key, login, ha, base, camHits, live });
    for (const b of bodies) {
      assert.equal(b.includes(FAKE_HA_TOKEN), false, 'the Home Assistant token reached a display');
      assert.equal(b.includes('should-not-pass'), false, 'a Home Assistant header was passed on');
      for (const t of ['camtoken123', 'camtoken456', ha.url]) assert.equal(b.includes(t), false, t);
    }
  } finally {
    _setLiveLimits();
    stopHomeAssistantLive();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await ha.close();
    _resetDoorbell();
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

test('cameraLanOnly: on unless set off, stored only when off', () => {
  const c = defaultConfig();
  let v = validateConfig(structuredClone(c));
  assert.equal(v.ok, true);
  assert.equal('cameraLanOnly' in v.value.homeassistant, false, 'configs that never touched it stay as they were');
  c.homeassistant.cameraLanOnly = true;
  assert.equal('cameraLanOnly' in validateConfig(structuredClone(c)).value.homeassistant, false);
  c.homeassistant.cameraLanOnly = false;
  assert.equal(validateConfig(structuredClone(c)).value.homeassistant.cameraLanOnly, false);
  c.homeassistant.cameraLanOnly = 'no';
  assert.equal(validateConfig(structuredClone(c)).ok, false);
});

test('snapshot: the picture of that card only, shared for a moment by every screen, the doorbell too', NEEDS_WS, async () => {
  await withApp(async ({ display, call, ha, camHits, key }) => {
    assert.equal(DOORBELL_CACHE_MS, FRAME_CACHE_MS, 'the doorbell uses the shared cache');
    assert.equal((await call('GET', '/api/display/ha/camera/cv_cama0001')).status, 401, 'a credential is needed');
    let r = await display('/api/display/ha/camera/cv_cama0001?n=1');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control'), /private/);
    assert.match(r.headers.get('cache-control'), /no-store/);
    assert.deepEqual(r.buf, FAKE_JPEG);
    assert.equal(camHits()[0].url, '/api/camera_proxy/camera.front', 'built from the entity id, never from entity_picture');
    assert.equal(camHits()[0].auth, `Bearer ${FAKE_HA_TOKEN}`);
    // an item of another screen, another kind, or none at all
    assert.equal((await display('/api/display/ha/camera/cv_hall0002')).status, 404, 'a card of another screen');
    assert.equal((await display('/api/display/ha/camera/cv_tile0001')).status, 404, 'not a camera');
    assert.equal((await display('/api/display/ha/camera/..%2F..%2Fapi%2Fstates')).status, 404);
    await wait(FRAME_CACHE_MS + 30);

    // four displays of two screens and a doorbell ring at once: one request to Home Assistant
    const { token } = createToken('Doorbell test');
    await call('POST', '/api/hooks/doorbell', { body: { screens: ['hall'] }, headers: { authorization: `Bearer ${token}` } });
    ha.state.cameraDelay = 80;
    const before = camHits().length;
    const all = await Promise.all([
      display('/api/display/ha/camera/cv_cama0001?n=2'), display('/api/display/ha/camera/cv_hall0002?n=2', 'hall'),
      display('/api/display/ha/camera/cv_cama0001?n=3'), call('GET', '/api/display/doorbell/frame?n=1', { headers: { 'x-marco-key': key('hall') } }),
    ]);
    assert.deepEqual(all.map((x) => x.status), [200, 200, 200, 200]);
    assert.equal(camHits().length - before, 1, 'one fetch shared by everyone');
    ha.state.cameraDelay = 0;
    await wait(FRAME_CACHE_MS + 30);
    await display('/api/display/ha/camera/cv_cama0001?n=4');
    assert.equal(camHits().length - before, 2, 'a new picture after the cache time');

    // only pictures, at most 4 MB; a failure is answered without Home Assistant's text
    for (const mode of ['html', 'huge', 'down']) {
      ha.state.camera = mode;
      await wait(FRAME_CACHE_MS + 20);
      r = await display('/api/display/ha/camera/cv_cama0001?n=9');
      assert.equal(r.status, 502, mode);
      assert.equal(r.json.error, 'camera_unavailable');
      assert.equal(r.text.includes('alert'), false);
    }
  });
});

test('home network only by default: a request through a proxy or from outside gets no picture; the owner can lift it', NEEDS_WS, async () => {
  await withApp(async ({ display, call, camHits, login, live }) => {
    for (const xff of ['203.0.113.9', '192.168.1.40']) {
      const r = await display('/api/display/ha/camera/cv_cama0001', 'main', { 'x-forwarded-for': xff });
      assert.equal(r.status, 403, xff);
      assert.equal(r.json.error, 'lan_only');
      const l = await live('cv_cama0002', 'main', { 'x-forwarded-for': xff });
      assert.equal(l.status, 403);
    }
    assert.equal(camHits().length, 0, 'Home Assistant was never asked');
    // the states (GET /api/display/ha) are not pictures: they still work from outside
    assert.equal((await display('/api/display/ha', 'main', { 'x-forwarded-for': '203.0.113.9' })).status, 200);
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { headers: { cookie } })).json;
    cfg.homeassistant.cameraLanOnly = false;
    assert.equal((await call('PUT', '/api/admin/config', { body: cfg, headers: { cookie } })).status, 200);
    const r = await display('/api/display/ha/camera/cv_cama0001', 'main', { 'x-forwarded-for': '203.0.113.9' });
    assert.equal(r.status, 200, r.text);
  });
});

test('private screens and the showWhen binary sensor', NEEDS_WS, async () => {
  await withApp(async ({ display, call, ha, login }) => {
    let r = await display('/api/display/ha/camera/cv_cama0003');
    assert.equal(r.status, 404, 'shown only while the motion sensor is on');
    assert.equal(r.json.error, 'hidden');
    ha.set('binary_sensor.doorbell_motion', 'on');
    await until(async () => (await display('/api/display/ha/camera/cv_cama0003')).status === 200, 3000, 'gate open');
    // a sensor that is unavailable (or not known yet) keeps the card closed, as the screen does: never a picture
    ha.set('binary_sensor.doorbell_motion', 'unavailable');
    await until(async () => (await display('/api/display/ha/camera/cv_cama0003')).status === 404, 3000, 'gate closed when unavailable');
    ha.set('binary_sensor.doorbell_motion', 'on');
    await until(async () => (await display('/api/display/ha/camera/cv_cama0003')).status === 200, 3000, 'gate open again');
    const cookie = await login();
    const p = await call('POST', '/api/admin/privacy', { body: { mode: 'on', screens: [store.getConfig().screens[0].id] }, headers: { cookie } });
    assert.equal(p.status, 200, p.text);
    r = await display('/api/display/ha/camera/cv_cama0001');
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'private');
    // the projection draws a placeholder for it
    const cfg = (await display('/api/display/config')).json;
    assert.ok(cfg.canvas.items.filter((i) => i.kind === 'ha.camera').every((i) => i.disabled === 'privacy'));
  });
});

test('admin preview: one picture by entity for a session, never a live picture', NEEDS_WS, async () => {
  await withApp(async ({ call, login, base }) => {
    assert.equal((await call('GET', '/api/admin/homeassistant/camera?entity=camera.front')).status, 401);
    const cookie = await login();
    let r = await call('GET', '/api/admin/homeassistant/camera?entity=camera.front', { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    for (const bad of ['light.kitchen', 'camera.Front', '../states', '']) assert.equal((await call('GET', `/api/admin/homeassistant/camera?entity=${encodeURIComponent(bad)}`, { headers: { cookie } })).status, 400, bad);
    // the preview frame of a display opened with the admin's session gets no live picture (6-connection budget)
    r = await call('GET', '/api/display/ha/camera/cv_cama0002/live', { headers: { cookie } });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'preview');
    assert.ok(base);
  });
});

test('live: one upstream per camera for every viewer, Marco\'s own framing, closed when the last viewer leaves', NEEDS_WS, async () => {
  await withApp(async ({ live, ha, display }) => {
    assert.equal((await display('/api/display/ha/camera/cv_cama0001/live')).json.error, 'not_live', 'a snapshot card has no live picture');
    const a = await live('cv_cama0002');
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('content-type'), `multipart/x-mixed-replace; boundary=${LIVE_BOUNDARY}`);
    assert.equal(a.headers.get('x-content-type-options'), 'nosniff');
    assert.match(a.headers.get('cache-control'), /no-store/);
    await until(() => a.parts.length >= 3, 3000, 'frames');
    for (const p of a.parts) {
      assert.equal(p.type, 'image/jpeg');
      assert.deepEqual(p.body, FAKE_JPEG);
    }
    assert.equal(a.raw.includes('frameboundary'), false, 'the camera\'s boundary is not passed on');
    // a second screen showing the same camera: still one stream from Home Assistant
    const b = await live('cv_hall0001', 'hall');
    assert.equal(b.status, 200);
    await until(() => b.parts.length >= 2, 3000, 'frames for the second viewer');
    assert.equal(ha.liveStreams().length, 1);
    assert.deepEqual(liveStats(), { upstreams: 1, clients: 2, cameras: [{ camera: 'camera.garden', clients: 2 }] });
    a.close();
    await until(() => liveStats().clients === 1, 2000, 'one viewer left');
    assert.equal(ha.liveStreams().length, 1, 'the other viewer keeps it open');
    b.close();
    await until(() => liveStats().upstreams === 0 && ha.liveStreams().length === 0, 2000, 'upstream closed after the last viewer');
  });
});

test('live: a camera that sends many pictures a second reaches the screens at 10 a second at most, the newest one', NEEDS_WS, async () => {
  await withApp(async ({ live, ha }) => {
    ha.state.cameraEveryMs = 4;
    const a = await live('cv_cama0002');
    assert.equal(a.status, 200);
    await until(() => a.parts.length >= 1, 3000, 'first frame');
    const t0 = Date.now();
    const n0 = a.parts.length;
    await wait(1000);
    const sent = ha.liveStreams()[0].sent;
    const got = a.parts.length - n0;
    assert.ok(sent > 60, `the camera sent ${sent}`);
    assert.ok(got >= 5 && got <= Math.ceil((Date.now() - t0) / LIVE_LIMITS.minFrameMs) + 1, `the screen got ${got}`);
    // a new picture is passed on within one gap, not lost among the skipped ones
    const fresh = Buffer.concat([FAKE_JPEG, Buffer.from('new')]);
    ha.state.cameraJpeg = fresh;
    await until(() => a.parts.at(-1)?.body.equals(fresh), 1000, 'the newest picture');
    a.close();
    await until(() => liveStats().upstreams === 0, 2000, 'closed');
  });
});

test('live: parts that are not pictures are dropped, a part too large or a silent camera ends the stream', NEEDS_WS, async () => {
  await withApp(async ({ live, ha }) => {
    _setLiveLimits({ stallMs: 300 });
    ha.state.camera = 'svg';
    let a = await live('cv_cama0002');
    await wait(300);
    assert.equal(a.parts.length, 0, 'no SVG ever goes out');
    assert.equal(a.raw.includes('svg'), false);
    a.close();
    await until(() => liveStats().upstreams === 0, 2000, 'closed');
    ha.state.camera = 'huge';
    a = await live('cv_cama0002');
    await until(() => a.ended, 3000, 'a 3 MB part ends the stream');
    assert.equal(a.parts.length, 0);
    await until(() => liveStats().upstreams === 0, 2000, 'closed');
    ha.state.camera = 'stall';
    a = await live('cv_cama0002');
    await until(() => a.parts.length === 1, 2000, 'the one frame');
    await until(() => a.ended, 3000, 'a camera that stops sending ends the stream');
    assert.equal(liveStats().upstreams, 0);
    await until(() => ha.liveStreams().length === 0, 2000, 'upstream closed');
  });
});

test('live: one display credential holds at most 2 live pictures, so it cannot take every slot of the house', NEEDS_WS, async () => {
  await withApp(async ({ live }) => {
    const a = await live('cv_cama0002');
    const b = await live('cv_cama0002');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const c = await live('cv_cama0002');
    assert.equal(c.status, 503);
    assert.equal(c.json.error, 'busy');
    // another screen still gets its picture
    const h = await live('cv_hall0001', 'hall');
    assert.equal(h.status, 200);
    // a slot comes back once a picture is closed
    a.close();
    await until(() => liveStats().clients === 2, 2000, 'one viewer left');
    const d = await live('cv_cama0002');
    assert.equal(d.status, 200);
    for (const x of [b, d, h]) x.close();
    await until(() => liveStats().upstreams === 0, 2000, 'closed');
  });
});

test('live: at most 4 cameras and 8 viewers per server; a viewer is cut when its card goes', NEEDS_WS, async () => {
  await withApp(async ({ live, call, login }) => {
    const sinks = [];
    const sink = () => {
      const s = { frames: 0, ended: null, frame() { s.frames++; }, end(why) { s.ended = why; } };
      sinks.push(s);
      return s;
    };
    const w = [];
    for (const cam of ['camera.front', 'camera.garage', 'camera.porch', 'camera.street']) w.push(watchLive(cam, sink()));
    assert.ok(w.every((x) => x.ok));
    assert.deepEqual(watchLive('camera.yard', sink()), { ok: false, error: 'busy' }, 'a fifth camera');
    // more viewers of a camera already streamed are fine up to 8 in all
    for (let i = 0; i < 4; i++) w.push(watchLive('camera.front', sink()));
    assert.equal(liveStats().clients, LIVE_LIMITS.clients);
    assert.deepEqual(watchLive('camera.front', sink()), { ok: false, error: 'busy' }, 'a ninth viewer');
    const r = await live('cv_cama0002');
    assert.equal(r.status, 503, 'the route says busy');
    assert.equal(r.json.error, 'busy');
    for (const x of w) {
      x.leave();
      x.leave();
    }
    assert.deepEqual(liveStats(), { upstreams: 0, clients: 0, cameras: [] }, 'leave() twice counts once');

    // the card is set back to snapshots while a viewer watches: its stream ends within a few seconds
    const a = await live('cv_cama0002');
    await until(() => a.parts.length >= 1, 2000, 'frames');
    const cookie = await login();
    const cfg = (await call('GET', '/api/admin/config', { headers: { cookie } })).json;
    cfg.screens[0].canvas.items.find((i) => i.id === 'cv_cama0002').props.mode = 'snapshot';
    assert.equal((await call('PUT', '/api/admin/config', { body: cfg, headers: { cookie } })).status, 200);
    await until(() => a.ended, 8000, 'the viewer is cut');
    await until(() => liveStats().upstreams === 0, 2000, 'upstream closed');
  });
});
