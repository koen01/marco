// Hardening regressions: server-side admin sessions (logout and expiry end a copied cookie), the CSRF guard (opaque
// origins, multipart without the admin's header), a recent sign-in or the password for exports and imports with
// private data, password checks rate-limited per address and in total, gallery files scoped to what each display may
// show (screen, hidden photos, privacy mode), metadata stripped from every gallery upload, display ids bound to the
// credential that holds them, and pairing codes that a few addresses cannot exhaust. Runs the real createApp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import {
  ensurePassword, hashPassword, _resetLoginLimits, SESSION_MAX_AGE, SESSION_IDLE_MS, RECENT_AUTH_MS, GLOBAL_FAIL_LIMIT,
} from '../auth.js';
import { createApp } from '../app.js';
import { closeAll } from '../sse.js';
import { _resetDisplays, setServerVersion, listDisplays, runCommand } from '../displays.js';
import { _resetPoll } from '../pollHub.js';
import { _resetActivityThrottle } from '../activity.js';
import { syncDisplayKeys, listDisplayLinks, _resetDisplayAccess, mediaScreens } from '../displayAccess.js';
import { _resetPairing, startPairing, MAX_PENDING, START_LIMIT } from '../pairing.js';
import { cleanStoredPhotos } from '../photos.js';

const realFetch = globalThis.fetch;
const offlineFetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
const PASSWORD = 'secret-pass-123';

/** A small JPEG (SOF + EOI) with an EXIF block holding a location, and a comment. */
function jpegWithGps() {
  const exif = Buffer.from('Exif\0\0MM\0\x2a\0\0\0\x08GPSLatitude 40.4168N GPSLongitude 3.7038W SerialNo XYZ123', 'latin1');
  const app1 = Buffer.from([0xff, 0xe1, 0, 0]);
  app1.writeUInt16BE(exif.length + 2, 2);
  const note = Buffer.from('taken at home 123', 'latin1');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, note.length + 2]), note]);
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  sof.writeUInt16BE(600, 5);
  sof.writeUInt16BE(800, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, com, sof, Buffer.from([0xff, 0xd9])]);
}

async function withServer(fn, { mode = 'private' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-hardening-'));
  globalThis.fetch = offlineFetch;
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = mode;
  c.screens[0].background.source = 'gallery';
  c.screens[0].privacy = { ...(c.screens[0].privacy || {}), hidePhotos: true };
  c.screens.push(defaultScreenProfile({ id: 's_guest', slug: 'guest', name: 'Guest' }));
  c.screens[1].background.source = 'stock';
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ passwordHash: await hashPassword(PASSWORD), passwordIsDefault: false }));
  fs.mkdirSync(path.join(dir, 'photos', '.thumbs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'photos', 'img_0042.jpg'), jpegWithGps());
  fs.writeFileSync(path.join(dir, 'photos', 'img_0043.jpg'), jpegWithGps());
  fs.writeFileSync(path.join(dir, 'photos', '.thumbs', 'img_0042.jpg'), 'thumb');
  store.initStore(dir);
  _resetDisplays();
  _resetPoll();
  _resetPairing();
  _resetActivityThrottle();
  _resetDisplayAccess();
  _resetLoginLimits();
  setServerVersion('0.13.0');
  await ensurePassword();
  syncDisplayKeys();
  const app = createApp({ version: '0.13.0', dist: path.join(dir, 'no-dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { body, form, headers = {}, cookie = '' } = {}) => {
    const r = await realFetch(base + url, {
      method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : form,
    });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString()); } catch { /* not json */ }
    return { status: r.status, json, buf, headers: r.headers, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const login = async (headers = {}) => {
    const r = await call('POST', '/api/auth/login', { body: { password: PASSWORD }, headers });
    assert.equal(r.status, 200);
    return r.setCookie.map((x) => x.split(';')[0]).join('; ');
  };
  const keyOf = (slug) => listDisplayLinks().find((l) => l.slug === slug).key;
  try {
    await fn({ call, login, keyOf, dir, base });
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
    _resetLoginLimits();
  }
}

/** Move every stored session's clock back by `ms` (sign-in, last use and last password proof). */
function ageSessions(ms, fields = ['iat', 'seen', 'authAt']) {
  store.updateSecrets((s) => {
    for (const rec of Object.values(s.sessions || {})) for (const f of fields) rec[f] -= ms;
  });
}

test('sessions: logout ends a copied cookie on the server; absolute and idle lifetimes are enforced', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    const copy = cookie;
    assert.equal((await call('GET', '/api/admin/config', { cookie })).status, 200);
    // the cookie names a random id; the server keeps only its hash
    const stored = Object.keys(store.getSecrets().sessions);
    assert.equal(stored.length, 1);
    assert.match(stored[0], /^[0-9a-f]{64}$/);
    assert.equal((await call('POST', '/api/auth/logout', { cookie })).status, 200);
    assert.equal((await call('GET', '/api/admin/config', { cookie: copy })).status, 401, 'a copy of the cookie dies with the logout');
    assert.equal((await call('GET', '/api/auth/me', { cookie: copy })).json.user, null);
    assert.deepEqual(store.getSecrets().sessions, {});

    // past the absolute lifetime (even if used every day)
    const old = await login();
    ageSessions(SESSION_MAX_AGE + 60_000, ['iat']);
    assert.equal((await call('GET', '/api/admin/config', { cookie: old })).status, 401);
    // idle too long
    const idle = await login();
    ageSessions(SESSION_IDLE_MS + 60_000, ['seen']);
    assert.equal((await call('GET', '/api/admin/config', { cookie: idle })).status, 401);
    // a session that is used stays alive; logging out everywhere drops every record
    const a = await login();
    const b = await login();
    assert.equal((await call('GET', '/api/admin/config', { cookie: a })).status, 200);
    assert.equal((await call('POST', '/api/auth/logout-all', { cookie: b })).status, 200);
    assert.equal((await call('GET', '/api/admin/config', { cookie: a })).status, 401);
  });
});

test('CSRF guard: an opaque origin is refused; a multipart upload needs the admin\'s X-Requested-With header', async () => {
  await withServer(async ({ call, login, base }) => {
    const cookie = await login();
    const host = new URL(base).host;
    assert.equal((await call('POST', '/api/admin/family/link', { cookie, headers: { origin: 'null' } })).status, 403);
    assert.equal((await call('POST', '/api/auth/logout-all', { cookie, headers: { origin: 'null' } })).status, 403);
    assert.equal((await call('POST', '/api/admin/backups', { cookie, headers: { origin: 'null' } })).status, 403);
    const form = () => {
      const fd = new FormData();
      fd.append('photos[]', new Blob([jpegWithGps()], { type: 'image/jpeg' }), 'evil.jpg');
      return fd;
    };
    // a form posted by another page (no custom header, even with the right origin)
    assert.equal((await call('POST', '/api/admin/photos', { cookie, form: form(), headers: { origin: `http://${host}` } })).status, 403);
    assert.equal((await call('POST', '/api/admin/photos', { cookie, form: form(), headers: { origin: 'null', 'x-requested-with': 'fetch' } })).status, 403);
    assert.equal(fs.existsSync(path.join(store.paths.photos, 'evil.jpg')), false);
    // the admin's own upload
    const ok = await call('POST', '/api/admin/photos', { cookie, form: form(), headers: { origin: `http://${host}`, 'x-requested-with': 'fetch' } });
    assert.equal(ok.status, 200);
  });
});

test('export and import with private data: a recent sign-in or the password; password checks are rate limited', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    // just signed in: allowed
    const fresh = await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: true } });
    assert.equal(fresh.status, 200);
    assert.ok(fresh.json.secrets.passwordHash);
    // a session that signed in long ago (a copied cookie) needs the password
    ageSessions(RECENT_AUTH_MS + 60_000);
    const stale = await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: true } });
    assert.equal(stale.status, 403);
    assert.equal(stale.json.code, 'password_required');
    assert.equal((await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: false } })).status, 200, 'without secrets as before');
    assert.equal((await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: true, password: 'wrong-one-12' } })).json.code, 'password_incorrect');
    // importing a bundle that replaces the password: refused without the password, nothing changes
    const bundle = structuredClone(fresh.json);
    bundle.secrets = { passwordHash: await hashPassword('attacker-pass-99') };
    const imp = await call('POST', '/api/admin/import/apply', { cookie, body: { bundle, includeSecrets: true } });
    assert.equal(imp.status, 403);
    assert.equal((await call('POST', '/api/auth/login', { body: { password: 'attacker-pass-99' } })).status, 401);
    // the right password works and counts as a recent sign-in for the next minutes
    assert.equal((await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: true, password: PASSWORD } })).status, 200);
    assert.equal((await call('POST', '/api/admin/export', { cookie, body: { includeSecrets: true } })).status, 200);

    // the current password of a change is rate limited like a login
    _resetLoginLimits();
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await call('PUT', '/api/admin/password', { cookie, body: { current: `wrong-${i}-xxxxx`, next: 'brand-new-pass-77' } })).status);
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(statuses[6], 429);
  });
});

test('password changes keep this browser signed in and end every other session', async () => {
  await withServer(async ({ call, login }) => {
    const mine = await login();
    const other = await login();
    const r = await call('PUT', '/api/admin/password', { cookie: mine, body: { current: PASSWORD, next: 'brand-new-pass-77' } });
    assert.equal(r.status, 200);
    const renewed = r.setCookie.map((x) => x.split(';')[0]).join('; ');
    assert.equal((await call('GET', '/api/admin/config', { cookie: renewed })).status, 200);
    assert.equal((await call('GET', '/api/admin/config', { cookie: other })).status, 401);
    assert.equal((await call('GET', '/api/admin/config', { cookie: mine })).status, 401, 'the old cookie of this browser too');
  });
});

test('login: many addresses share one budget of failures from outside the LAN; the LAN is never locked out', async () => {
  await withServer(async ({ call }) => {
    for (let i = 0; i < GLOBAL_FAIL_LIMIT; i++) {
      const r = await call('POST', '/api/auth/login', { body: { password: 'wrong-guess-123' }, headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
      assert.equal(r.status, 401);
    }
    // a new Internet address: refused before the password is checked, even the right one
    assert.equal((await call('POST', '/api/auth/login', { body: { password: PASSWORD }, headers: { 'x-forwarded-for': '198.51.100.7' } })).status, 429);
    assert.equal((await call('POST', '/api/auth/login', { body: { password: PASSWORD }, headers: { 'x-forwarded-for': '2001:db8:77::1' } })).status, 429);
    // a LAN address claimed through a proxy counts as outside (the proxy may pass a client's own X-Forwarded-For on)
    assert.equal((await call('POST', '/api/auth/login', { body: { password: PASSWORD }, headers: { 'x-forwarded-for': '192.168.1.20' } })).status, 429);
    // at home (a direct connection) it still works
    assert.equal((await call('POST', '/api/auth/login', { body: { password: PASSWORD } })).status, 200);
  });
});

test('gallery files: only for a screen that shows the gallery, never hidden photos or while private with hide photos', async () => {
  await withServer(async ({ call, login, keyOf }) => {
    const cookie = await login();
    const main = keyOf('living-room');
    const guest = keyOf('guest');
    const get = (file, k, extra = {}) => call('GET', `/media/photos/${file}?k=${k}`, extra);
    assert.equal((await get('img_0042.jpg', main)).status, 200);
    // a screen that shows stock photos reads no gallery file: the same 404 as a missing one
    assert.equal((await get('img_0042.jpg', guest)).status, 404);
    assert.equal((await get('nope.jpg', guest)).status, 404);
    // hidden photos are out of reach for every display, still there for the admin
    assert.equal((await call('PATCH', '/api/admin/photos/img_0042.jpg', { cookie, body: { hidden: true } })).status, 200);
    assert.equal((await get('img_0042.jpg', main)).status, 404);
    assert.equal((await call('GET', '/media/photos/img_0042.jpg', { cookie })).status, 200);
    assert.equal((await get('img_0043.jpg', main)).status, 200);
    // privacy mode with "hide photos": none of the screen's gallery files
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 2, screens: ['living-room'] } })).status, 200);
    assert.equal((await get('img_0043.jpg', main)).status, 404);
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'off', screens: ['living-room'] } })).status, 200);
    assert.equal((await get('img_0043.jpg', main)).status, 200);
    // thumbnails are for the admin's grid only
    assert.equal((await call('GET', `/media/thumbs/img_0042.jpg?k=${main}`)).status, 404);
    assert.equal((await call('GET', '/media/thumbs/img_0042.jpg', { cookie })).status, 200);
  });
});

test('gallery files of a screen that is private (without "hide photos") are not cached by the browser', async () => {
  await withServer(async ({ call, login, keyOf }) => {
    const cookie = await login();
    const main = keyOf('living-room');
    const cfg = (await call('GET', '/api/admin/config', { cookie })).json;
    cfg.screens[0].privacy = { ...cfg.screens[0].privacy, hidePhotos: false };
    assert.equal((await call('PUT', '/api/admin/config', { cookie, body: cfg })).status, 200);
    const get = () => call('GET', `/media/photos/img_0043.jpg?k=${main}`);
    // normal: kept for 30 days
    assert.match((await get()).headers.get('cache-control'), /max-age=2592000/);
    // private mode: still shown (no "hide photos"), but never kept
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 2, screens: ['living-room'] } })).status, 200);
    const priv = await get();
    assert.equal(priv.status, 200);
    assert.equal(priv.headers.get('cache-control'), 'private, no-store');
    // the admin's own view is not affected
    assert.match((await call('GET', '/media/photos/img_0043.jpg', { cookie })).headers.get('cache-control'), /max-age=2592000/);
    // back to normal when private mode ends
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'off', screens: ['living-room'] } })).status, 200);
    assert.match((await get()).headers.get('cache-control'), /max-age=2592000/);
  });
});

test('hiding a photo tells its name only to displays that show the gallery', async () => {
  await withServer(async ({ call, login, keyOf }) => {
    const cookie = await login();
    const poll = async (k, client, cursor = '') => (await call('GET', `/api/display/poll?client=${client}&cursor=${encodeURIComponent(cursor)}`, { headers: { 'x-marco-key': k } })).json;
    const g0 = await poll(keyOf('guest'), 'guest-tv');
    const m0 = await poll(keyOf('living-room'), 'main-tv');
    assert.equal((await call('PATCH', '/api/admin/photos/img_0042.jpg', { cookie, body: { hidden: true } })).status, 200);
    const g1 = await poll(keyOf('guest'), 'guest-tv', g0.cursor);
    const m1 = await poll(keyOf('living-room'), 'main-tv', m0.cursor);
    const photosOf = (r) => r.commands.filter((c) => c.type === 'photos');
    assert.ok(photosOf(g1).length >= 1);
    assert.ok(photosOf(g1).every((c) => !('hidden' in c)), JSON.stringify(g1.commands));
    assert.ok(photosOf(m1).some((c) => c.hidden?.includes('img_0042.jpg')));
  });
});

test('open mode: privacy with hide photos also covers LAN clients without a credential (gallery and Immich rules)', async () => {
  await withServer(async ({ call, login }) => {
    const cookie = await login();
    assert.equal((await call('GET', '/media/photos/img_0042.jpg')).status, 200);
    assert.equal((await call('POST', '/api/admin/privacy', { cookie, body: { mode: 'on', hours: 2, screens: ['living-room'] } })).status, 200);
    // the only gallery screen is private with "hide photos": no gallery file for an open-mode client
    assert.equal((await call('GET', '/media/photos/img_0042.jpg')).status, 404);
    const cfg = store.getConfig();
    assert.deepEqual(mediaScreens(cfg, { via: 'open' }).map((s) => s.id), ['s_guest']);
    assert.equal(mediaScreens(cfg, { via: 'session' }), null);
  }, { mode: 'open' });
});

test('gallery uploads and stored photos lose their metadata (location, camera, comments); non-images are refused', async () => {
  await withServer(async ({ call, login, base, dir }) => {
    const cookie = await login();
    const host = new URL(base).host;
    const send = (name, buf, type = 'image/jpeg') => {
      const fd = new FormData();
      fd.append('photos[]', new Blob([buf], { type }), name);
      return call('POST', '/api/admin/photos', { cookie, form: fd, headers: { origin: `http://${host}`, 'x-requested-with': 'fetch' } });
    };
    const up = await send('IMG_1000.jpg', jpegWithGps());
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const stored = fs.readFileSync(path.join(dir, 'photos', 'img_1000.jpg')).toString('latin1');
    assert.ok(!stored.includes('GPSLatitude') && !stored.includes('XYZ123') && !stored.includes('taken at home'));
    assert.equal(up.json.files[0].w, 800);
    const served = await call('GET', '/media/photos/img_1000.jpg', { cookie });
    assert.ok(!served.buf.toString('latin1').includes('GPSLatitude'));
    // not an image (or a damaged one): nothing is stored
    const bad = await send('notes.jpg', Buffer.from('this is not a picture at all'));
    assert.equal(bad.status, 415);
    assert.equal(fs.existsSync(path.join(dir, 'photos', 'notes.jpg')), false);
    // photos stored before: cleaned once, keeping their date (gallery order, URLs) and focal point
    const p = path.join(dir, 'photos', 'img_0043.jpg');
    const when = new Date('2024-05-01T10:00:00Z');
    fs.utimesSync(p, when, when);
    assert.equal((await call('PATCH', '/api/admin/photos/img_0043.jpg', { cookie, body: { focusX: 0.25, focusY: 0.75 } })).status, 200);
    assert.ok(cleanStoredPhotos() >= 1);
    assert.ok(!fs.readFileSync(p).toString('latin1').includes('GPSLatitude'));
    assert.equal(fs.statSync(p).mtimeMs, when.getTime());
    const listed = (await call('GET', '/api/admin/photos', { cookie })).json.find((x) => x.file === 'img_0043.jpg');
    assert.equal(listed.focusX, 0.25);
    assert.equal(cleanStoredPhotos(), 0, 'only once');
  });
});

test('display ids: a row live under one credential is not taken over by another; one credential cannot flood the list', async () => {
  await withServer(async ({ call, keyOf }) => {
    const main = keyOf('living-room');
    const guest = keyOf('guest');
    const poll = async (k, client, cursor = '') => (await call('GET', `/api/display/poll?client=${client}&cursor=${encodeURIComponent(cursor)}`, { headers: { 'x-marco-key': k } })).json;
    const real = await poll(main, 'raspberrypi');
    // another credential sends a heartbeat and polls with the same id
    const hb = await call('POST', '/api/display/heartbeat', { headers: { 'x-marco-key': guest }, body: { clientId: 'raspberrypi', lastError: 'Display crashed: open http://evil.example' } });
    assert.notEqual(hb.status, 200);
    const fake = await poll(guest, 'raspberrypi');
    const row = listDisplays().find((d) => d.clientId === 'raspberrypi');
    assert.equal(row.screenId, 's_main');
    assert.equal(row.access, 'key');
    assert.equal(row.lastError, null);
    // a command aimed at that id reaches the real display only
    runCommand({ action: 'reload', clientIds: ['raspberrypi'] });
    assert.ok((await poll(main, 'raspberrypi', real.cursor)).commands.some((c) => c.type === 'reload'));
    assert.ok(!(await poll(guest, 'raspberrypi', fake.cursor)).commands.some((c) => c.type === 'reload'));
    // one credential makes many ids: it keeps a bounded number of rows, the registry never fills for the others
    for (let i = 0; i < 120; i++) await call('POST', '/api/display/heartbeat', { headers: { 'x-marco-key': guest }, body: { clientId: `fake-${i}` } });
    assert.ok(listDisplays().filter((d) => d.clientId.startsWith('fake-')).length <= 24);
    const ok = await call('POST', '/api/display/heartbeat', { headers: { 'x-marco-key': main }, body: { clientId: 'kitchen-tablet' } });
    assert.equal(ok.status, 200);
  });
});

test('pairing: a few addresses cannot fill the waiting table and block a real TV', async () => {
  _resetPairing();
  const t0 = Date.now();
  const at = (ip) => ({ ip, get: () => '' });
  for (let a = 1; a <= 25; a++) for (let i = 0; i < START_LIMIT; i++) startPairing(at(`203.0.113.${a}`), t0);
  const tv = startPairing(at('192.168.1.50'), t0 + 1000);
  assert.ok(tv.code, JSON.stringify(tv));
  assert.ok(MAX_PENDING >= 100);
  _resetPairing();
});
