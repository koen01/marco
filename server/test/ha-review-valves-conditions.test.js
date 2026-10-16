// Security review of the Entidad rows and "Mostrar solo si": a gas valve its device class does not name (many
// integrations set none) is known by "gas" in its id or name and is never driven from a screen, nor from the
// builder's Probar; and a reading of a condition's entity that does not change what is hidden sends the screens
// nothing (a display never learns when an entity it does not show changes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig } from '../core/defaults.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { aliasControls, controlsFor, isGasValve, isHighRisk, slim, snapshotStates } from '../core/haCore.js';
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
import { invalidateEntityCache } from '../homeassistant.js';
import { fakeHa, FAKE_HA_TOKEN } from './fakeHa.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await wait(20);
  }
}

const M = (x, y, size) => ({ zone: 'main', x, y, size });
const item = (id, kind, pos, props = {}, extra = {}) => ({ id, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra });
const alias = (entity, extra = {}) => ({ entity, itemId: 'cv_x0000001', kind: 'ha.tile', slot: 0, interactive: true, confirm: false, ack: false, name: '', props: {}, ...extra });

test('a gas valve without a device class: known by its id, its friendly name or the card name, never controlled', () => {
  const m = (attrs) => ({ slim: slim('valve', 'open', attrs), attrs, at: 1 });
  assert.equal(isGasValve('valve', {}, 'valve.gas_main'), true);
  assert.equal(isGasValve('valve', { friendly_name: 'Llave del gas' }, 'valve.v1'), true);
  assert.equal(isGasValve('valve', { friendly_name: 'Gás da cozinha' }, 'valve.v2'), true);
  assert.equal(isGasValve('valve', {}, 'valve.v3', 'Gas'), true);
  assert.equal(isGasValve('valve', { device_class: 'gas' }, 'valve.v4'), true);
  // other words, other domains
  assert.equal(isGasValve('valve', { friendly_name: 'Riego jardín' }, 'valve.garden'), false);
  assert.equal(isGasValve('valve', {}, 'valve.gasket_test'), false);
  assert.equal(isGasValve('switch', {}, 'switch.gas_heater'), false);
  assert.equal(isHighRisk('valve', {}, 'valve.gas_main'), true);
  // the screen offers nothing, even ticked and with the card's name
  for (const [entity, attrs, name] of [['valve.gas_main', { supported_features: 15 }, ''], ['valve.v1', { supported_features: 3, friendly_name: 'Llave del gas' }, ''], ['valve.v3', { supported_features: 3 }, 'Gas']]) {
    assert.deepEqual(aliasControls(alias(entity, { name, ack: true }), m(attrs), true), { c: [], cf: false }, entity);
  }
  // a friendly name is enough for controlsFor (it sees only the attributes) and for the drawing
  assert.deepEqual(controlsFor('ha.tile', 'valve', { supported_features: 15, friendly_name: 'Gas' }), []);
  assert.equal(slim('valve', 'open', { friendly_name: 'Gas' }).readOnly, true);
  // drawn as one that is only shown when only the id says so
  const st = snapshotStates(new Map([['cv_x0000001:0', alias('valve.gas_main')]]), () => m({ supported_features: 3 }), { touch: true });
  assert.deepEqual([st['cv_x0000001:0'].c, st['cv_x0000001:0'].readOnly], [[], true]);
  // an ordinary valve keeps its buttons
  assert.deepEqual(aliasControls(alias('valve.garden'), m({ supported_features: 3 }), true).c, ['open', 'close']);
});

const STATES = [
  { entity_id: 'sensor.power', state: '200', attributes: { unit_of_measurement: 'W' } },
  { entity_id: 'switch.hall', state: 'off', attributes: {} },
  { entity_id: 'valve.gas_main', state: 'open', attributes: { supported_features: 3 } },
  { entity_id: 'valve.kitchen', state: 'open', attributes: { supported_features: 3, friendly_name: 'Gas cocina' } },
  { entity_id: 'valve.garden', state: 'closed', attributes: { supported_features: 3 } },
];

async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-harev-'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opts) => (/^https?:\/\/127\.0\.0\.1[:/]/.test(String(url)) ? realFetch(url, opts) : Promise.reject(new Error('offline test')));
  const ha = await fakeHa({ states: structuredClone(STATES) });
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  c.security.displayAccess = 'private';
  const main = c.screens[0];
  main.layout.preset = 'canvas';
  main.canvas = {
    ...defaultCanvas(),
    touch: true,
    items: [
      item('cv_gasv0001', 'ha.tile', M(0, 0, 's'), { entity: 'valve.gas_main' }, { ack: true }),
      item('cv_gasv0002', 'ha.tile', M(3, 0, 's'), { entity: 'valve.kitchen' }, { ack: true }),
      item('cv_valv0001', 'ha.tile', M(6, 0, 's'), { entity: 'valve.garden' }),
      item('cv_cond0001', 'ha.tile', M(0, 3, 's'), { entity: 'switch.hall' }, { when: { src: 'ha', entity: 'sensor.power', op: 'gt', value: '1000' } }),
    ],
  };
  c.homeassistant = { enabled: true, url: ha.url, doorbell: { camera: '', seconds: 60, screenIds: [], sound: true } };
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
  invalidateEntityCache();
  setServerVersion('0.5.0');
  await ensurePassword();
  syncDisplayKeys();
  startHomeAssistantLive({ timing: { backoffMin: 30, backoffMax: 100, pollMs: 80, failuresBeforePoll: 3, pingMs: 60_000 }, coalesceMs: 30 });
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const key = listDisplayLinks().find((l) => l.slug === store.getConfig().screens[0].slug).key;
  const call = async (method, url, { body, headers = {} } = {}) => {
    const r = await realFetch(base + url, { method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, setCookie: r.headers.getSetCookie?.() || [] };
  };
  const stream = async () => {
    const ctl = new AbortController();
    const r = await realFetch(`${base}/api/stream?client=test-review&k=${encodeURIComponent(key)}`, { signal: ctl.signal });
    assert.equal(r.status, 200);
    const events = [];
    const reader = r.body.getReader();
    let buf = '';
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += Buffer.from(value).toString('utf8');
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (ev) events.push({ event: ev, data: data ? JSON.parse(data) : null });
          }
        }
      } catch { /* aborted */ }
    })();
    return { events, close: () => ctl.abort() };
  };
  try {
    await until(() => ha.connections().some((x) => x.subs.length), 4000, 'mirror subscribed');
    await wait(120);
    await fn({ call, key, stream, ha });
  } finally {
    stopHomeAssistantLive();
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await ha.close();
    fs.rmSync(dir, { recursive: true, force: true });
    globalThis.fetch = realFetch;
  }
}

test('a gas valve named so: no buttons, every tap and the builder\'s Probar refused, nothing reaches Home Assistant', async () => {
  await withApp(async ({ call, key, ha }) => {
    const services = () => ha.hits.filter((h) => h.method === 'POST' && h.url.startsWith('/api/services/'));
    const s = (await until(async () => {
      const x = (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': key } })).json;
      return x?.states?.['cv_valv0001:0']?.c?.length ? x : null;
    }, 4000, 'mirrored')).states;
    assert.deepEqual([s['cv_gasv0001:0'].c, s['cv_gasv0001:0'].readOnly], [[], true]);
    assert.deepEqual([s['cv_gasv0002:0'].c, s['cv_gasv0002:0'].readOnly], [[], true]);
    let seq = 0;
    for (const id of ['cv_gasv0001', 'cv_gasv0002']) {
      for (const control of ['open', 'close']) {
        _resetHaRoutes();
        const r = await call('POST', '/api/display/ha/action', { body: { item: id, slot: 0, control, confirm: true, seq: ++seq }, headers: { 'x-marco-key': key } });
        assert.equal(r.status, 403, `${id} ${control}: ${r.text}`);
        assert.equal(r.json.error, 'not_allowed');
      }
    }
    const login = await call('POST', '/api/auth/login', { body: { password: 'secret-pass-123' } });
    const cookie = login.setCookie.map((x) => x.split(';')[0]).join('; ');
    for (const entity of ['valve.gas_main', 'valve.kitchen']) {
      _resetHaRoutes();
      const r = await call('POST', '/api/admin/homeassistant/action', { body: { kind: 'ha.tile', entity, control: 'close' }, headers: { cookie } });
      assert.equal(r.status, 403, `${entity}: ${r.text}`);
    }
    // the builder draws them as only shown
    const sl = await call('POST', '/api/admin/homeassistant/slim', { body: { entities: ['valve.gas_main'] }, headers: { cookie } });
    assert.equal(sl.json.states['valve.gas_main'].readOnly, true);
    assert.equal(services().length, 0);
    // an ordinary valve still works
    _resetHaRoutes();
    const ok = await call('POST', '/api/display/ha/action', { body: { item: 'cv_valv0001', slot: 0, control: 'open', seq: ++seq }, headers: { 'x-marco-key': key } });
    assert.equal(ok.status, 200, ok.text);
  });
});

test('a reading of a condition\'s entity that hides and shows the same items sends the screen nothing', async () => {
  await withApp(async ({ call, key, stream, ha }) => {
    await until(async () => {
      const x = (await call('GET', '/api/display/ha', { headers: { 'x-marco-key': key } })).json;
      return x?.states?.['cv_valv0001:0'] ? x : null;
    }, 4000, 'mirrored');
    const st = await stream();
    try {
      await until(() => st.events.find((e) => e.event === 'ha'), 4000, 'hello');
      const evs = () => st.events.filter((e) => e.event === 'ha' || e.event === 'values');
      // the first reading after the start may go out once (nothing to compare with yet)
      ha.set('sensor.power', '210');
      await wait(250);
      const n = evs().length;
      // the power climbs below the threshold: the card stays hidden, the screen hears nothing
      for (const w of ['300', '450', '700', '999']) {
        ha.set('sensor.power', w);
        await wait(120);
      }
      assert.equal(evs().length, n, `events while nothing changed: ${JSON.stringify(evs().slice(n))}`);
      // over the threshold: the card shows, with its state
      ha.set('sensor.power', '1500');
      const ev = await until(() => evs().slice(n).find((e) => e.event === 'ha' && Array.isArray(e.data.hide) && !e.data.hide.includes('cv_cond0001')), 4000, 'shown');
      assert.ok(ev.data.states['cv_cond0001:0']);
      const m = evs().length;
      ha.set('sensor.power', '1600');
      await wait(250);
      assert.equal(evs().filter((e) => e.event === 'ha').length, evs().slice(0, m).filter((e) => e.event === 'ha').length, 'still shown: nothing sent');
      // back under: hidden again, the screen hears it
      ha.set('sensor.power', '20');
      await until(() => evs().slice(m).find((e) => e.event === 'ha' && e.data.hide?.includes('cv_cond0001')), 4000, 'hidden again');
      // the entity itself never reaches the display
      for (const e of st.events) assert.equal(JSON.stringify(e.data ?? '').includes('sensor.power'), false);
    } finally {
      st.close();
    }
  });
});
