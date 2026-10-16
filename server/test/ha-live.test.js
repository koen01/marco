// The live Home Assistant mirror (server/haLive.js) against a fake Home Assistant (fakeHa.js, REST + WebSocket):
// auth, subscribe_entities with exactly the watched set (never get_states, never the whole house), changes, a new
// watched set, reconnect with backoff, REST polling after failures, for old Home Assistant versions and without a
// global WebSocket, and the `ha` event: per screen, coalesced, aliases only, never through the poll channel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeHa } from './fakeHa.js';
import { createHaLive, startHaLive, stopHaLive, haConfigChanged, screenSnapshot, haStatus } from '../haLive.js';
import { fromRestState } from '../core/haCore.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle } from '../core/canvasCore.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import * as pollHub from '../pollHub.js';
import { hasWebSocket } from '../haWs.js';

// the live mirror needs Node's global WebSocket (Node 22 and later); on Node 20 the server polls over REST instead
// ("no global WebSocket" in ha-live.test.js), and these tests are skipped
const NEEDS_WS = { skip: hasWebSocket() ? false : 'needs a global WebSocket (Node 22 or later)' };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000, what = 'condition') {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await wait(15);
  }
}

const STATES = [
  { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen', brightness: 255, supported_color_modes: ['brightness'] } },
  { entity_id: 'sensor.temp', state: '21.5', attributes: { unit_of_measurement: '°C', device_class: 'temperature', friendly_name: 'Living room' } },
  { entity_id: 'switch.fan', state: 'off', attributes: {} },
  { entity_id: 'sensor.not_watched', state: '1', attributes: {} },
];
const FAST = { backoffMin: 30, backoffMax: 120, pollMs: 60, failuresBeforePoll: 3, pingMs: 60_000 };

/** A REST getter on the fake (the mirror's polling fallback). */
const restGetter = (ha) => async (id) => {
  const r = await fetch(`${ha.url}/api/states/${id}`, { headers: { authorization: `Bearer ${ha.token}` } });
  if (r.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function mirror(ha, { watched = ['light.kitchen', 'sensor.temp'], token, WebSocketImpl, timing = FAST } = {}) {
  const changes = [];
  const w = { set: new Set(watched) };
  const logs = [];
  const live = createHaLive({
    settings: () => ({ url: ha.url, token: token ?? ha.token, enabled: true }),
    watched: () => w.set,
    onChange: (e, kind) => changes.push({ kind, e }),
    fetchState: restGetter(ha),
    ...(WebSocketImpl !== undefined ? { WebSocketImpl } : {}),
    timing,
    log: { warn: (m) => logs.push(m) },
  });
  return { live, changes, w, logs };
}

test('auth, then subscribe_entities with exactly the watched set: no get_states, no other entity mirrored', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  const { live, changes } = mirror(ha);
  try {
    live.start();
    await until(() => live.status().state === 'connected', 3000, 'connected');
    await until(() => live.get('sensor.temp'));
    assert.deepEqual(ha.wsLog.map((m) => m.type), ['auth', 'subscribe_entities']);
    assert.equal(ha.wsLog[0].tokenOk, true);
    assert.deepEqual(ha.wsLog[1].entity_ids.sort(), ['light.kitchen', 'sensor.temp']);
    assert.equal(live.get('sensor.not_watched'), null);
    assert.deepEqual(live.get('light.kitchen').slim, { d: 'light', on: true, bri: 100, ct: null, rgb: null, n: 'Kitchen' });
    assert.equal(live.synced, true);
    assert.ok(changes.some((c) => c.kind === 'state' && c.e.includes('sensor.temp')));
    // a change: only the changed entity, the new state and when it changed
    const before = changes.length;
    ha.set('sensor.temp', '22.25');
    await until(() => live.get('sensor.temp').slim.num === 22.25);
    assert.deepEqual(changes.slice(before).filter((c) => c.kind === 'state').map((c) => c.e), [['sensor.temp']]);
    // an attribute change only: the state is the same and so is last_changed
    const at = live.get('light.kitchen').at;
    ha.set('light.kitchen', 'on', { friendly_name: 'Kitchen', brightness: 128, supported_color_modes: ['brightness'] });
    await until(() => live.get('light.kitchen').slim.bri === 50);
    assert.equal(live.get('light.kitchen').at, at);
    // a watched entity removed from Home Assistant
    ha.remove('sensor.temp');
    await until(() => !live.get('sensor.temp'));
    // an unwatched entity changing sends nothing
    const n = changes.length;
    ha.set('sensor.not_watched', '5');
    await wait(80);
    assert.equal(changes.length, n);
    assert.equal(ha.wsLog.some((m) => m.type === 'get_states' || m.type === 'subscribe_events'), false, 'never the whole house');
  } finally {
    live.stop();
    await ha.close();
  }
});

test('a new watched set: unsubscribe, subscribe to the new one, forget the old entities; nothing watched, nothing subscribed', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  const { live, w } = mirror(ha);
  try {
    live.start();
    await until(() => live.get('sensor.temp'));
    w.set = new Set(['switch.fan']);
    live.watchedChanged();
    await until(() => live.get('switch.fan'));
    assert.equal(live.get('sensor.temp'), null);
    const types = ha.wsLog.map((m) => m.type);
    assert.deepEqual(types.slice(0, 4), ['auth', 'subscribe_entities', 'unsubscribe_events', 'subscribe_entities']);
    assert.deepEqual(ha.wsLog.filter((m) => m.type === 'subscribe_entities').at(-1).entity_ids, ['switch.fan']);
    // the same set again: nothing sent
    const n = ha.wsLog.length;
    live.watchedChanged();
    await wait(50);
    assert.equal(ha.wsLog.length, n);
    // nothing watched: no subscribe_entities with an empty list (that would mean every entity)
    w.set = new Set();
    live.watchedChanged();
    await wait(80);
    assert.equal(ha.wsLog.filter((m) => m.type === 'subscribe_entities' && !m.entity_ids?.length).length, 0);
    assert.equal(live.status().count, 0);
  } finally {
    live.stop();
    await ha.close();
  }
});

test('reconnects after Home Assistant drops the connection, and subscribes again', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  const { live } = mirror(ha);
  try {
    live.start();
    await until(() => live.status().state === 'connected');
    ha.dropAll();
    await until(() => live.status().state !== 'connected', 2000, 'noticed');
    await until(() => live.status().state === 'connected', 3000, 'back');
    assert.equal(ha.wsLog.filter((m) => m.type === 'subscribe_entities').length, 2);
    ha.set('sensor.temp', '19');
    await until(() => live.get('sensor.temp')?.slim.num === 19);
  } finally {
    live.stop();
    await ha.close();
  }
});

test('a refused token: error "auth", no polling with that token, logs carry no token', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  const { live, logs } = mirror(ha, { token: 'wrong-token-123456' });
  try {
    live.start();
    await until(() => live.status().state === 'error');
    assert.equal(live.status().reason, 'auth');
    await wait(300);
    assert.notEqual(live.status().state, 'polling');
    assert.equal(ha.hits.filter((h) => h.url.startsWith('/api/states')).length, 0);
    assert.equal(logs.join('\n').includes('wrong-token-123456'), false);
    assert.equal(logs.join('\n').includes(ha.token), false);
  } finally {
    live.stop();
    await ha.close();
  }
});

test('WebSocket unreachable: backoff, then REST polling of the watched set after 3 failures; back to live when it returns', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  ha.state.wsDown = true;
  const { live } = mirror(ha);
  try {
    live.start();
    await until(() => live.status().state === 'polling', 3000, 'polling');
    assert.equal(live.status().reason, 'unreachable');
    await until(() => live.get('sensor.temp'));
    // only the watched entities, one by one, never /api/states
    const rest = ha.hits.filter((h) => h.method === 'GET' && h.url.startsWith('/api/states'));
    assert.ok(rest.length >= 2);
    assert.equal(rest.some((h) => h.url === '/api/states'), false);
    assert.equal(rest.some((h) => h.url.includes('not_watched')), false);
    ha.set('sensor.temp', '23');
    await until(() => live.get('sensor.temp').slim.num === 23);
    // the WebSocket comes back: live again, polling stops
    ha.state.wsDown = false;
    await until(() => live.status().state === 'connected', 3000, 'connected again');
    const n = ha.hits.filter((h) => h.url.startsWith('/api/states/')).length;
    await wait(200);
    assert.equal(ha.hits.filter((h) => h.url.startsWith('/api/states/')).length, n, 'no more polling');
  } finally {
    live.stop();
    await ha.close();
  }
});

test('Home Assistant down altogether (WebSocket and REST): the screens never hear it is fine until a poll reads it', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  ha.state.wsDown = true;
  ha.state.restDown = true;
  const seen = [];
  const live = createHaLive({
    settings: () => ({ url: ha.url, token: ha.token, enabled: true }),
    watched: () => new Set(['light.kitchen', 'sensor.temp']),
    onChange: (_e, kind) => { if (kind === 'conn') seen.push(live.status().state); },
    fetchState: restGetter(ha),
    timing: FAST,
    log: { warn() {} },
  });
  try {
    live.start();
    // several retries and polls: always 'error', never 'polling' (the dot on the cards would go away)
    await until(() => ha.hits.filter((h) => h.url.startsWith('/api/states/')).length >= 4, 3000, 'polls');
    await wait(150);
    assert.deepEqual([...new Set(seen)], ['error']);
    // REST is back (the WebSocket still is not): polling, with the reason
    ha.state.restDown = false;
    await until(() => live.status().state === 'polling', 3000, 'polling');
    assert.equal(live.status().reason, 'unreachable');
    await until(() => live.get('sensor.temp'));
    // the next failed WebSocket retry keeps 'polling' (REST still reads the house): no flicker to 'error'
    const n = seen.length;
    await wait(300);
    assert.deepEqual(seen.slice(n), []);
    ha.state.wsDown = false;
    await until(() => live.status().state === 'connected', 3000, 'connected');
  } finally {
    live.stop();
    await ha.close();
  }
});

test('Home Assistant older than 2022.4 (no subscribe_entities): REST polling, never the state_changed firehose', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES, noSubscribeEntities: true });
  const { live } = mirror(ha);
  try {
    live.start();
    await until(() => live.status().state === 'polling');
    assert.equal(live.status().reason, 'old_version');
    await until(() => live.get('light.kitchen'));
    assert.equal(ha.wsLog.some((m) => m.type === 'subscribe_events' || m.type === 'get_states'), false);
  } finally {
    live.stop();
    await ha.close();
  }
});

test('no global WebSocket (Node 20): REST polling, with the reason', async () => {
  const ha = await fakeHa({ states: STATES });
  const { live } = mirror(ha, { WebSocketImpl: null });
  try {
    live.start();
    await until(() => live.get('sensor.temp'));
    assert.deepEqual([live.status().state, live.status().reason], ['polling', 'no_websocket']);
    assert.equal(ha.hits.some((h) => h.method === 'WS'), false);
  } finally {
    live.stop();
    await ha.close();
  }
});

test('a WebSocket command over the mirror connection (registry, statistics)', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES, areas: [{ area_id: 'k', name: 'Kitchen' }] });
  const { live } = mirror(ha);
  try {
    assert.equal(await live.command({ type: 'config/area_registry/list' }), undefined, 'not connected yet');
    live.start();
    await until(() => live.status().state === 'connected');
    assert.deepEqual(await live.command({ type: 'config/area_registry/list' }), { value: [{ area_id: 'k', name: 'Kitchen' }] });
  } finally {
    live.stop();
    await ha.close();
  }
});

// ------------------------------------------------------------------------------------------------ the `ha` event

const M = (x, y, size) => ({ zone: 'main', x, y, size });
let n = 0;
const item = (kind, pos, props = {}) => ({ id: `cv_live${String(n++).padStart(4, '0')}`, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props } });

function canvasConfig() {
  const c = defaultConfig();
  c.screens[0].layout.preset = 'canvas';
  c.screens[0].canvas = { ...defaultCanvas(), items: [item('ha.tile', M(0, 0, 'xs'), { entity: 'light.kitchen' }), item('ha.sensor', M(2, 0, 'xs'), { entity: 'sensor.temp' })] };
  const second = defaultScreenProfile({ id: 's_hall', slug: 'hall', name: 'Hall' });
  second.layout.preset = 'canvas';
  second.canvas = { ...defaultCanvas(), items: [item('ha.tile', M(0, 0, 'xs'), { entity: 'switch.fan' })] };
  c.screens.push(second);
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  return v.value;
}

test('publishHa: one event per screen, coalesced, aliases only, private screens get nothing, never via pollHub', NEEDS_WS, async () => {
  const ha = await fakeHa({ states: STATES });
  let cfg = canvasConfig();
  const sent = [];
  const priv = new Set();
  pollHub._resetPoll();
  const ringBefore = pollHub.readSince(pollHub.currentCursor(), { clientId: 'x', screenId: cfg.screens[0].id, anonymous: false }, () => null).commands.length;
  startHaLive({
    getConfig: () => cfg,
    settings: () => ({ url: ha.url, token: ha.token, enabled: true }),
    fetchState: restGetter(ha),
    broadcast: (event, data, target) => sent.push({ event, data, target }),
    isPrivate: (_c, s) => priv.has(s.id),
    timing: FAST,
    coalesceMs: 60,
  });
  try {
    await until(() => sent.some((s) => s.data.full === false || Object.keys(s.data.states).length), 3000, 'first event');
    const main = cfg.screens[0];
    const [tile, sensor] = main.canvas.items;
    await until(() => Object.keys(screenSnapshot(cfg, main).states).length === 2);
    const snap = screenSnapshot(cfg, main);
    assert.deepEqual(Object.keys(snap.states).sort(), [`${tile.id}:0`, `${sensor.id}:0`].sort());
    assert.equal(snap.conn, 'ok');
    assert.equal(JSON.stringify(snap).includes('light.kitchen'), false, 'no entity id');
    sent.length = 0;
    // three quick changes on one screen: one event; the other screen gets nothing
    ha.set('sensor.temp', '20');
    ha.set('sensor.temp', '20.5');
    ha.set('light.kitchen', 'off');
    await until(() => sent.length);
    await wait(150);
    assert.equal(sent.length, 1, JSON.stringify(sent));
    const ev = sent[0];
    assert.equal(ev.event, 'ha');
    assert.deepEqual(ev.target, { screenIds: [main.id] });
    assert.equal(ev.data.full, false);
    assert.equal(ev.data.screenId, main.id);
    assert.deepEqual(Object.keys(ev.data.states).sort(), [`${tile.id}:0`, `${sensor.id}:0`].sort());
    assert.equal(ev.data.states[`${sensor.id}:0`].num, 20.5);
    assert.equal(ev.data.states[`${tile.id}:0`].on, false);
    assert.equal(JSON.stringify(sent).includes('sensor.temp'), false);
    // a private screen: no states at all
    priv.add(main.id);
    sent.length = 0;
    ha.set('sensor.temp', '18');
    await wait(200);
    assert.equal(sent.length, 0);
    assert.deepEqual(screenSnapshot(cfg, main).states, {});
    priv.clear();
    // never written to the poll channel, never made polls faster
    assert.equal(pollHub.readSince(pollHub.currentCursor(), { clientId: 'x', screenId: main.id, anonymous: false }, () => null).commands.length, ringBefore);
    assert.equal(pollHub.nextDelay(false), pollHub.POLL_NEXT_MS);
    // a config save that adds an entity: watched again, the new one mirrored
    cfg = structuredClone(cfg);
    cfg.screens[1].canvas.items.push(item('ha.sensor', M(4, 0, 'xs'), { entity: 'sensor.not_watched' }));
    haConfigChanged(cfg);
    await until(() => Object.keys(screenSnapshot(cfg, cfg.screens[1]).states).length === 2, 3000, 'new entity');
    assert.equal(haStatus().watched, 4);
    // the connection goes down: a full snapshot with conn 'down' to every screen with Home Assistant cards
    sent.length = 0;
    ha.state.wsDown = true;
    ha.dropAll();
    await until(() => sent.some((s) => s.data.conn === 'down'), 3000, 'down event');
    const down = sent.filter((s) => s.data.conn === 'down');
    assert.deepEqual([...new Set(down.map((s) => s.target.screenIds[0]))].sort(), [cfg.screens[0].id, 's_hall'].sort());
    assert.ok(down.every((s) => s.data.full === true));
  } finally {
    stopHaLive();
    await ha.close();
  }
});

test('Home Assistant not set up: the snapshot says off (a calm note on the cards, no offline dot); set up, it does not', async () => {
  const cfg = canvasConfig();
  const main = cfg.screens[0];
  const settings = { url: '', token: '', enabled: false };
  startHaLive({ getConfig: () => cfg, settings: () => settings, fetchState: async () => null, broadcast: () => 0, isPrivate: () => false, timing: FAST, coalesceMs: 20 });
  try {
    const off = screenSnapshot(cfg, main);
    assert.equal(off.off, true);
    assert.equal(off.conn, 'down');
    // switched on but no token yet: still not set up
    settings.enabled = true;
    settings.url = 'http://127.0.0.1:9';
    haConfigChanged(cfg);
    assert.equal(screenSnapshot(cfg, main).off, true);
  } finally {
    stopHaLive();
  }
  const ha = await fakeHa({ states: STATES });
  startHaLive({ getConfig: () => cfg, settings: () => ({ url: ha.url, token: ha.token, enabled: true }), fetchState: restGetter(ha), broadcast: () => 0, isPrivate: () => false, timing: FAST, coalesceMs: 20 });
  try {
    await until(() => screenSnapshot(cfg, main).conn === 'ok', 3000, 'connected');
    assert.equal('off' in screenSnapshot(cfg, main), false);
  } finally {
    stopHaLive();
    await ha.close();
  }
});

test('fromRestState of the fake matches the WebSocket view', async () => {
  const ha = await fakeHa({ states: STATES });
  try {
    const r = fromRestState(await restGetter(ha)('light.kitchen'));
    assert.deepEqual(r.slim, { d: 'light', on: true, bri: 100, ct: null, rgb: null, n: 'Kitchen' });
  } finally {
    await ha.close();
  }
});
