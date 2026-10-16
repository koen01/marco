// Home Assistant on Personalizado screens, the pure part (server/core/haCore.js): slim states per domain from
// recorded HA states, the aliases a screen has and the set the server watches, the control allowlist (allowed and
// refused pairs, with the item's options), clamping of every value, the service each control becomes, the "looks like
// a door" check and the owner's tick, snapshots, history and statistics parsing, and LTTB downsampling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  slim, pickAttrs, fromRestState, aliasesFor, watchedEntities, controlsFor, isHighRisk, CONTROL_TABLE, snapshotStates,
  parseHistory, parseStatistics, downsample, periodRange, roundPoints, MAX_POINTS, clampValue, serviceCall, needsConfirm, aliasControls,
} from '../core/haCore.js';
import { canvasDefaults, defaultCanvas, defaultItemStyle, itemAliases, projectCanvas } from '../core/canvasCore.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';

const M = (x, y, size) => ({ zone: 'main', x, y, size });
let n = 0;
const item = (kind, pos, props = {}, extra = {}) => ({
  id: `cv_core${String(n++).padStart(4, '0')}`, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra,
});

test('haCore is pure: no node:* imports (the Cloud build copies server/core)', () => {
  const src = fs.readFileSync(new URL('../core/haCore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:|require\(/);
});

test('slim: one shape per domain, from recorded Home Assistant states', () => {
  const light = slim('light', 'on', {
    friendly_name: 'Salón', brightness: 128, color_mode: 'color_temp', supported_color_modes: ['color_temp', 'xy'],
    color_temp_kelvin: 2700, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, rgb_color: [255, 167, 87],
  });
  assert.deepEqual(light, { d: 'light', on: true, bri: 50, ct: 2700, ctMin: 2000, ctMax: 6500, rgb: [255, 167, 87], col: true, n: 'Salón' });
  assert.deepEqual(slim('light', 'off', { supported_color_modes: ['onoff'], brightness: null }), { d: 'light', on: false, bri: null, ct: null, rgb: null, onoff: true });
  // old lights report mireds only
  assert.equal(slim('light', 'on', { color_temp: 370, brightness: 255 }).ct, 2703);
  assert.deepEqual(slim('switch', 'on', {}), { d: 'switch', on: true, dc: null });
  assert.deepEqual(slim('input_boolean', 'off', {}), { d: 'switch', on: false, dc: null });
  assert.deepEqual(slim('fan', 'on', { percentage: 66.7 }), { d: 'switch', on: true, dc: null, pct: 67 });
  const climate = slim('climate', 'heat_cool', {
    hvac_modes: ['off', 'heat', 'cool', 'heat_cool'], hvac_action: 'heating', current_temperature: 20.46, temperature: null,
    target_temp_low: 19, target_temp_high: 24, min_temp: 7, max_temp: 35, target_temp_step: 0.5, fan_mode: 'auto', fan_modes: ['auto', 'low', 'high'], current_humidity: 46.6,
  });
  assert.deepEqual(climate, {
    d: 'climate', mode: 'heat_cool', modes: ['off', 'heat', 'cool', 'heat_cool'], action: 'heating', cur: 20.5, target: null, lo: 19, hi: 24,
    min: 7, max: 35, step: 0.5, unit: 'C', fan: 'auto', fans: ['auto', 'low', 'high'], hum: 47,
  });
  assert.equal(slim('climate', 'cool', { max_temp: 90, min_temp: 50 }).unit, 'F');
  assert.deepEqual(slim('cover', 'open', { current_position: 60, device_class: 'shutter' }), { d: 'cover', state: 'open', pos: 60, readOnly: false, dc: 'shutter' });
  // a cover that does not take all of up, down, stop and a position says which it takes (the editor's preview)
  assert.deepEqual(slim('cover', 'open', { current_position: 60, supported_features: 7 }), { d: 'cover', state: 'open', pos: 60, readOnly: false, dc: null, sf: 7 });
  assert.equal(slim('cover', 'open', { supported_features: 15 }).sf, undefined);
  assert.equal(slim('cover', 'closed', { device_class: 'garage' }).readOnly, true);
  assert.equal(slim('cover', 'closed', { device_class: 'gate' }).readOnly, true);
  assert.deepEqual(slim('media_player', 'playing', { media_title: 'Song', media_artist: 'Band', volume_level: 0.345, entity_picture: '/api/media_player_proxy/media_player.x?token=abc&cache=1', source: 'Spotify' }),
    { d: 'media', state: 'playing', title: 'Song', artist: 'Band', vol: 0.35, art: true, source: 'Spotify' });
  // a picture on another host is never offered (the art route only fetches HA's own proxy)
  assert.equal(slim('media_player', 'playing', { entity_picture: 'https://cdn.example.com/a.jpg' }).art, false);
  assert.deepEqual(slim('sensor', '21.46', { unit_of_measurement: '°C', device_class: 'temperature' }), { d: 'sensor', v: '21.46', num: 21.46, unit: '°C', dc: 'temperature' });
  assert.deepEqual(slim('sensor', 'Sunny', {}), { d: 'sensor', v: 'Sunny', num: null, unit: '', dc: null });
  assert.deepEqual(slim('binary_sensor', 'on', { device_class: 'door' }), { d: 'binary', on: true, dc: 'door' });
  assert.deepEqual(slim('scene', '2026-10-14T08:00:00+00:00', {}), { d: 'scene' });
  assert.deepEqual(slim('script', 'unknown', {}), { d: 'scene' }, 'a script never run still runs');
  assert.deepEqual(slim('lock', 'locked', {}), { d: 'lock', state: 'locked' });
  assert.deepEqual(slim('alarm_control_panel', 'armed_away', {}), { d: 'alarm', state: 'armed_away' });
  assert.deepEqual(slim('person', 'home', { friendly_name: 'Ana' }), { d: 'other', v: 'home', n: 'Ana' });
  for (const [d, s] of [['light', 'unavailable'], ['sensor', 'unknown'], ['binary_sensor', 'unknown'], ['switch', 'unavailable']]) {
    assert.equal(slim(d, s, {}).d, 'unavailable', `${d} ${s}`);
  }
});

test('slim never carries an entity id, a URL or a picture', () => {
  const s = JSON.stringify([
    slim('media_player', 'playing', { entity_picture: '/api/media_player_proxy/media_player.secret_room?token=t0k', friendly_name: 'Room', media_title: 'x' }),
    fromRestState({ entity_id: 'camera.garden', state: 'idle', attributes: { entity_picture: '/api/camera_proxy/camera.garden?token=t0k', access_token: 't0k' } }).slim,
  ]);
  for (const bad of ['media_player.secret_room', 'camera.garden', 't0k', '/api/', 'http']) assert.equal(s.includes(bad), false, bad);
  assert.equal('access_token' in pickAttrs({ access_token: 'x', brightness: 3 }), false);
  assert.deepEqual(pickAttrs({ brightness: 3, foo: 1 }), { brightness: 3 });
});

test('fromRestState: slim, whitelisted attributes and when it changed', () => {
  const r = fromRestState({ entity_id: 'sensor.t', state: '7', attributes: { unit_of_measurement: 'kWh', friendly_name: 'Solar', secret: 1 }, last_changed: '2026-10-14T10:00:00Z' });
  assert.deepEqual(r, { state: '7', attrs: { friendly_name: 'Solar', unit_of_measurement: 'kWh' }, slim: { d: 'sensor', v: '7', num: 7, unit: 'kWh', dc: null, n: 'Solar' }, at: Date.parse('2026-10-14T10:00:00Z') });
});

test('aliases: the same numbering as the display projection; hidden items have none; the watched set', () => {
  const room = item('ha.room', M(3, 0, 'm'), { title: 'Salón', rows: [{ entity: 'switch.lamp', name: '', interactive: true }, { entity: '', name: '', interactive: true }, { entity: 'sensor.temp', name: '', interactive: false }] });
  const items = [
    item('ha.tile', M(0, 0, 'xs'), { entity: 'light.kitchen' }),
    room,
    item('ha.chart', M(7, 0, 'm'), { series: [{ entity: 'sensor.out', label: '', color: null }, { entity: 'sensor.temp', label: '', color: null }] }),
    item('ha.sensor', M(0, 3, 'xs'), { entity: 'sensor.hidden' }, { hidden: true }),
    item('clock.digital', M(0, 5, 'm')),
  ];
  const c = defaultConfig();
  c.screens[0].layout.preset = 'canvas';
  c.screens[0].canvas = { ...defaultCanvas(), touch: true, items };
  c.weather.haIndoorTempEntity = 'sensor.indoor';
  const v = validateConfig(c);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const screen = v.value.screens[0];
  const al = aliasesFor(screen);
  // the projection numbers them the same way
  const proj = projectCanvas(screen);
  for (const it of proj.items) {
    const p = it.props;
    const refs = [p.entity, ...(p.rows ?? []).map((r) => r.entity), ...(p.series ?? []).map((s) => s.entity)].filter((x) => x && x.a);
    for (const r of refs) assert.ok(al.has(r.a), `${r.a} in aliasesFor`);
  }
  assert.equal(al.get(`${room.id}:0`).entity, 'switch.lamp');
  assert.equal(al.get(`${room.id}:0`).interactive, true);
  assert.equal(al.get(`${room.id}:1`).entity, 'sensor.temp', 'the empty row is skipped');
  assert.equal(al.get(`${room.id}:1`).interactive, false, 'a room row has its own switch');
  assert.equal([...al.values()].some((a) => a.entity === 'sensor.hidden'), false, 'hidden items are not sent, so not watched');
  assert.deepEqual([...watchedEntities(v.value)].sort(), ['light.kitchen', 'sensor.indoor', 'sensor.out', 'sensor.temp', 'switch.lamp']);
  // other layouts have no aliases
  assert.equal(aliasesFor({ ...screen, layout: { ...screen.layout, preset: 'month' } }).size, 0);
  assert.deepEqual(itemAliases({ id: 'cv_x0000000', kind: 'clock.digital', props: {} }), []);
});

test('controls: the allowlist matrix, allowed and refused pairs', () => {
  const allowed = [
    ['ha.tile', 'light', { supported_color_modes: ['onoff'] }, ['toggle', 'on', 'off']],
    // an Entidad card's own rows: the colours of a light (warm to cool here), unless the owner chose others
    ['ha.tile', 'light', { supported_color_modes: ['color_temp'] }, ['toggle', 'on', 'off', 'colorTemp']],
    ['ha.tile', 'light', { supported_color_modes: ['color_temp', 'hs'] }, ['toggle', 'on', 'off', 'rgb', 'colorTemp']],
    ['ha.light', 'light', { supported_color_modes: ['color_temp'] }, ['toggle', 'on', 'off', 'brightness', 'colorTemp']],
    ['ha.light', 'light', { supported_color_modes: ['xy'] }, ['toggle', 'on', 'off', 'brightness', 'rgb', 'colorTemp']],
    ['ha.light', 'light', { supported_color_modes: ['onoff'] }, ['toggle', 'on', 'off']],
    ['ha.switch', 'fan', { supported_features: 1 }, ['toggle', 'on', 'off', 'fanPct']],
    ['ha.switch', 'input_boolean', {}, ['toggle', 'on', 'off']],
    ['ha.climate', 'climate', { hvac_modes: ['off', 'heat', 'heat_cool'], fan_modes: ['auto'] }, ['setpoint', 'setpointRange', 'hvacMode', 'fanMode']],
    ['ha.cover', 'cover', { supported_features: 15 }, ['open', 'close', 'stop', 'position']],
    // a cover offers only what it takes: no stop, no position (all three buttons when it says nothing)
    ['ha.cover', 'cover', { supported_features: 3 }, ['open', 'close']],
    ['ha.cover', 'cover', { supported_features: 7 }, ['open', 'close', 'position']],
    ['ha.cover', 'cover', {}, ['open', 'close', 'stop']],
    ['ha.tile', 'cover', { supported_features: 3 }, ['open', 'close']],
    ['ha.media', 'media_player', {}, ['playPause', 'next', 'prev', 'volume']],
    ['ha.scene', 'scene', {}, ['run']],
    ['ha.scene', 'script', {}, ['run']],
    ['ha.tile', 'button', {}, ['run']],
    ['ha.room', 'switch', {}, ['toggle', 'on', 'off']],
  ];
  for (const [kind, domain, attrs, want] of allowed) assert.deepEqual(controlsFor(kind, domain, attrs), want, `${kind} ${domain}`);
  const refused = [
    ['ha.tile', 'lock', {}], ['ha.room', 'lock', {}], ['ha.tile', 'alarm_control_panel', {}], ['ha.cover', 'cover', { device_class: 'garage' }],
    ['ha.cover', 'cover', { device_class: 'gate', supported_features: 15 }], ['ha.tile', 'valve', { device_class: 'gas', supported_features: 15 }], ['ha.sensor', 'sensor', {}], ['ha.chart', 'sensor', {}],
    ['ha.camera', 'camera', {}], ['ha.tile', 'automation', {}], ['ha.tile', 'shell_command', {}], ['ha.tile', 'sensor', {}], ['ha.media', 'light', {}],
  ];
  for (const [kind, domain, attrs] of refused) assert.deepEqual(controlsFor(kind, domain, attrs), [], `${kind} ${domain} ${JSON.stringify(attrs)}`);
  assert.equal(isHighRisk('lock'), true);
  assert.equal(isHighRisk('cover', { device_class: 'garage' }), true);
  assert.equal(isHighRisk('cover', { device_class: 'shutter' }), false);
  // every control names its service; nothing in the table reaches a lock, an alarm or Home Assistant itself
  const domains = new Set(Object.values(CONTROL_TABLE).flatMap((c) => c.domains));
  for (const d of ['lock', 'alarm_control_panel', 'homeassistant', 'automation', 'shell_command', 'rest_command', 'notify', 'python_script']) assert.equal(domains.has(d), false, d);
  assert.equal(isHighRisk('valve', { device_class: 'gas' }), true);
  assert.equal(isHighRisk('valve', { device_class: 'water' }), false, 'a water valve needs the owner\'s tick instead');
  assert.equal(CONTROL_TABLE.run.service('button'), 'press');
  assert.equal(CONTROL_TABLE.run.service('scene'), 'turn_on');
});

test('snapshotStates: controls only with touch and an interactive item; missing entities', () => {
  const aliases = new Map([
    ['cv_a0000000:0', { entity: 'light.a', itemId: 'cv_a0000000', kind: 'ha.tile', slot: 0, interactive: true }],
    ['cv_b0000000:0', { entity: 'switch.b', itemId: 'cv_b0000000', kind: 'ha.room', slot: 0, interactive: false }],
    ['cv_c0000000:0', { entity: 'sensor.gone', itemId: 'cv_c0000000', kind: 'ha.sensor', slot: 0, interactive: true }],
  ]);
  const mirror = { 'light.a': { slim: slim('light', 'on', { supported_color_modes: ['onoff'] }), attrs: { supported_color_modes: ['onoff'] }, at: 5 }, 'switch.b': { slim: slim('switch', 'off', {}), attrs: {}, at: 6 } };
  const look = (e) => mirror[e] ?? null;
  const off = snapshotStates(aliases, look);
  assert.deepEqual(off['cv_a0000000:0'].c, []);
  assert.equal('cv_c0000000:0' in off, false, 'not there yet');
  const on = snapshotStates(aliases, look, { touch: true, missing: 'unavailable' });
  assert.deepEqual(on['cv_a0000000:0'].c, ['toggle', 'on', 'off']);
  assert.deepEqual(on['cv_b0000000:0'].c, [], 'a row without its switch offers nothing');
  assert.deepEqual(on['cv_c0000000:0'], { d: 'unavailable', at: 0, c: [] });
  assert.deepEqual(Object.keys(snapshotStates(aliases, look, { only: new Set(['cv_b0000000:0']) })), ['cv_b0000000:0']);
});

test('history and statistics: numeric points in time order; periods', () => {
  const raw = [
    [{ entity_id: 'sensor.a', state: '1.5', last_changed: '2026-10-14T10:00:00Z', attributes: {} }, { state: 'unavailable', last_changed: '2026-10-14T10:05:00Z' }, { state: '2', last_changed: '2026-10-14T10:10:00Z' }],
    [{ entity_id: 'sensor.b', state: 'x', last_changed: '2026-10-14T10:00:00Z' }],
    'junk',
  ];
  const h = parseHistory(raw);
  assert.deepEqual(h.get('sensor.a'), [[Date.parse('2026-10-14T10:00:00Z'), 1.5], [Date.parse('2026-10-14T10:10:00Z'), 2]]);
  assert.deepEqual(h.get('sensor.b'), []);
  assert.equal(parseHistory(null).size, 0);
  const st = parseStatistics({ 'sensor.a': [{ start: 2000, mean: 3 }, { start: 1000, mean: null, state: 4 }, { start: '2026-10-14T10:00:00Z', mean: 5 }] });
  assert.deepEqual(st.get('sensor.a'), [[1000, 4], [2000, 3], [Date.parse('2026-10-14T10:00:00Z'), 5]]);
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.deepEqual(periodRange('6h', now), { start: now - 6 * 3600_000, end: now, source: 'history' });
  assert.equal(periodRange('7d', now).source, 'statistics');
  assert.equal(periodRange('bogus', now).start, now - 24 * 3600_000);
  assert.deepEqual(roundPoints([[1234, 1.23456]]), [[1000, 1.235]]);
});

test('downsample (LTTB): at most 200 points, the ends kept, the peaks kept', () => {
  const pts = Array.from({ length: 5000 }, (_, i) => [i * 1000, Math.sin(i / 200) * 10 + (i === 2500 ? 100 : 0)]);
  const out = downsample(pts, MAX_POINTS);
  assert.equal(out.length, MAX_POINTS);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out.at(-1), pts.at(-1));
  assert.ok(out.some((p) => p[1] > 90), 'a spike survives');
  for (let i = 1; i < out.length; i++) assert.ok(out[i][0] > out[i - 1][0], 'time order');
  assert.deepEqual(downsample(pts.slice(0, 10)), pts.slice(0, 10));
  assert.deepEqual(downsample(null), []);
});

test('allowlist matrix: every control against every domain, only the table\'s pairs get a service', () => {
  const DOMAINS = ['light', 'switch', 'input_boolean', 'fan', 'climate', 'cover', 'media_player', 'scene', 'script', 'button', 'lock', 'alarm_control_panel',
    'valve', 'sensor', 'binary_sensor', 'automation', 'homeassistant', 'shell_command', 'rest_command', 'notify', 'python_script', 'camera', 'vacuum',
    'select', 'input_select', 'number', 'input_number', 'update'];
  const OK = {
    toggle: ['light', 'switch', 'input_boolean', 'fan'], on: ['light', 'switch', 'input_boolean', 'fan'], off: ['light', 'switch', 'input_boolean', 'fan'],
    brightness: ['light'], colorTemp: ['light'], rgb: ['light'], fanPct: ['fan'], setpoint: ['climate'], setpointRange: ['climate'], hvacMode: ['climate'], fanMode: ['climate'],
    open: ['cover', 'valve'], close: ['cover', 'valve'], stop: ['cover', 'valve'], position: ['cover', 'valve'], playPause: ['media_player'], next: ['media_player'], prev: ['media_player'],
    volume: ['media_player'], run: ['scene', 'script', 'button'],
    selectOption: ['select', 'input_select'], numberSet: ['number', 'input_number'], start: ['vacuum'], pause: ['vacuum'], dock: ['vacuum'],
  };
  assert.deepEqual(Object.keys(CONTROL_TABLE).sort(), Object.keys(OK).sort());
  const SAMPLE = { brightness: 50, colorTemp: 3000, rgb: [255, 0, 0], fanPct: 50, setpoint: 21, setpointRange: [19, 24], hvacMode: 'heat', fanMode: 'auto', position: 50, volume: 0.5, selectOption: 'Eco', numberSet: 3 };
  for (const control of [...Object.keys(OK), 'unlock', 'disarm', 'reload', 'turn_on']) {
    for (const d of DOMAINS) {
      const call = serviceCall(control, d, SAMPLE[control] ?? null);
      assert.equal(!!call, (OK[control] ?? []).includes(d), `${control} on ${d}`);
      if (call) assert.equal(call.domain, d);
    }
  }
  // every kind with controls, against every domain and its richest attributes: never outside the table
  const rich = { supported_color_modes: ['color_temp', 'hs'], supported_features: 16383, hvac_modes: ['off', 'heat', 'heat_cool'], fan_modes: ['auto'], options: ['Eco', 'Comfort'], min: 0, max: 10 };
  const everyFeature = { features: ['brightness', 'colorTemp', 'color', 'cover', 'position', 'hvacModes', 'target', 'valve', 'select', 'number', 'vacuum', 'update', 'gauge'] };
  for (const kind of ['ha.tile', 'ha.light', 'ha.switch', 'ha.climate', 'ha.cover', 'ha.room', 'ha.media', 'ha.scene', 'ha.sensor', 'ha.chart', 'ha.camera', 'ha.gauge', 'ha.statistic']) {
    for (const d of DOMAINS) {
      for (const props of [{}, everyFeature]) for (const c of controlsFor(kind, d, rich, props)) assert.ok(OK[c].includes(d), `${kind} offers ${c} on ${d}`);
    }
  }
  for (const d of ['lock', 'alarm_control_panel']) for (const k of ['ha.tile', 'ha.room']) assert.deepEqual(controlsFor(k, d, rich, everyFeature), []);
  for (const k of ['ha.tile', 'ha.room']) assert.deepEqual(controlsFor(k, 'valve', { ...rich, device_class: 'gas' }, everyFeature), [], 'a gas valve is only shown');
  for (const k of ['ha.gauge', 'ha.statistic', 'ha.sensor']) assert.deepEqual(controlsFor(k, 'number', rich, everyFeature), [], `${k} is read-only`);
  // the services, with their data
  assert.deepEqual(serviceCall('brightness', 'light', 40), { domain: 'light', service: 'turn_on', data: { brightness_pct: 40 } });
  // a colour: three whole numbers 0..255, only for a light that takes any colour
  assert.deepEqual(serviceCall('rgb', 'light', [255, 59, 48]), { domain: 'light', service: 'turn_on', data: { rgb_color: [255, 59, 48] } });
  assert.deepEqual(clampValue('rgb', [300, -4, 47.6], 'light', { supported_color_modes: ['hs'] }), { value: [255, 0, 48] });
  assert.equal(clampValue('rgb', [255, 0, 0], 'light', { supported_color_modes: ['color_temp'] }), undefined, 'a white light takes no colour');
  assert.equal(clampValue('rgb', [255, 0], 'light', { supported_color_modes: ['hs'] }), undefined);
  assert.equal(clampValue('rgb', ['255', 0, 0], 'light', { supported_color_modes: ['hs'] }), undefined);
  assert.deepEqual(serviceCall('colorTemp', 'light', 3000), { domain: 'light', service: 'turn_on', data: { color_temp_kelvin: 3000 } });
  assert.deepEqual(serviceCall('fanPct', 'fan', 50), { domain: 'fan', service: 'set_percentage', data: { percentage: 50 } });
  assert.deepEqual(serviceCall('setpoint', 'climate', 21.5), { domain: 'climate', service: 'set_temperature', data: { temperature: 21.5 } });
  assert.deepEqual(serviceCall('setpointRange', 'climate', [19, 24]), { domain: 'climate', service: 'set_temperature', data: { target_temp_low: 19, target_temp_high: 24 } });
  assert.deepEqual(serviceCall('hvacMode', 'climate', 'cool'), { domain: 'climate', service: 'set_hvac_mode', data: { hvac_mode: 'cool' } });
  assert.deepEqual(serviceCall('fanMode', 'climate', 'low'), { domain: 'climate', service: 'set_fan_mode', data: { fan_mode: 'low' } });
  assert.deepEqual(serviceCall('position', 'cover', 30), { domain: 'cover', service: 'set_cover_position', data: { position: 30 } });
  assert.deepEqual(serviceCall('volume', 'media_player', 0.4), { domain: 'media_player', service: 'volume_set', data: { volume_level: 0.4 } });
  assert.deepEqual(serviceCall('run', 'button', null), { domain: 'button', service: 'press', data: {} });
  assert.deepEqual(serviceCall('run', 'script', null), { domain: 'script', service: 'turn_on', data: {} });
  assert.deepEqual(serviceCall('toggle', 'fan', null), { domain: 'fan', service: 'toggle', data: {} });
  assert.equal(serviceCall('setpointRange', 'climate', 21), null, 'a range needs two values');
  // the new services: valves, selects, numbers, vacuums
  assert.deepEqual(serviceCall('open', 'valve', null), { domain: 'valve', service: 'open_valve', data: {} });
  assert.deepEqual(serviceCall('close', 'valve', null), { domain: 'valve', service: 'close_valve', data: {} });
  assert.deepEqual(serviceCall('stop', 'valve', null), { domain: 'valve', service: 'stop_valve', data: {} });
  assert.deepEqual(serviceCall('position', 'valve', 30), { domain: 'valve', service: 'set_valve_position', data: { position: 30 } });
  assert.deepEqual(serviceCall('open', 'cover', null), { domain: 'cover', service: 'open_cover', data: {} });
  assert.deepEqual(serviceCall('selectOption', 'input_select', 'Eco'), { domain: 'input_select', service: 'select_option', data: { option: 'Eco' } });
  assert.deepEqual(serviceCall('numberSet', 'number', 3.5), { domain: 'number', service: 'set_value', data: { value: 3.5 } });
  assert.deepEqual(serviceCall('start', 'vacuum', null), { domain: 'vacuum', service: 'start', data: {} });
  assert.deepEqual(serviceCall('pause', 'vacuum', null), { domain: 'vacuum', service: 'pause', data: {} });
  assert.deepEqual(serviceCall('dock', 'vacuum', null), { domain: 'vacuum', service: 'return_to_base', data: {} });
});

test('controls follow the item: a light without its slider, the climate modes the owner kept, no fan modes', () => {
  const a = { supported_color_modes: ['color_temp'] };
  assert.deepEqual(controlsFor('ha.light', 'light', a, { brightness: false, colorTemp: true }), ['toggle', 'on', 'off', 'colorTemp']);
  assert.deepEqual(controlsFor('ha.light', 'light', a, { brightness: true, colorTemp: false }), ['toggle', 'on', 'off', 'brightness']);
  const c = { hvac_modes: ['off', 'heat', 'heat_cool'], fan_modes: ['auto', 'low'] };
  assert.deepEqual(controlsFor('ha.climate', 'climate', c, { modes: ['heat'], fan: false }), ['setpoint', 'hvacMode']);
  assert.deepEqual(controlsFor('ha.climate', 'climate', c, { modes: [], fan: true }), ['setpoint', 'fanMode']);
});

test('clampValue: numbers clamped and snapped, modes from the entity and the card, no value for plain taps', () => {
  const cl = { min_temp: 16, max_temp: 30, target_temp_step: 0.5, hvac_modes: ['off', 'heat', 'cool'], fan_modes: ['auto', 'low'] };
  assert.deepEqual(clampValue('toggle', undefined, 'light'), { value: null });
  assert.equal(clampValue('toggle', 5, 'light'), undefined, 'a tap takes no value');
  assert.deepEqual(clampValue('brightness', 0, 'light'), { value: 1 });
  assert.deepEqual(clampValue('brightness', 140, 'light'), { value: 100 });
  assert.deepEqual(clampValue('brightness', 42.6, 'light'), { value: 43 });
  assert.equal(clampValue('brightness', '50', 'light'), undefined, 'a string is not a number');
  assert.equal(clampValue('brightness', NaN, 'light'), undefined);
  assert.deepEqual(clampValue('colorTemp', 9000, 'light', { min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 }), { value: 6500 });
  assert.deepEqual(clampValue('colorTemp', 1000, 'light', { min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 }), { value: 2200 });
  assert.deepEqual(clampValue('setpoint', 21.3, 'climate', cl), { value: 21.5 });
  assert.deepEqual(clampValue('setpoint', 40, 'climate', cl), { value: 30 });
  assert.deepEqual(clampValue('setpoint', 3, 'climate', cl), { value: 16 });
  assert.deepEqual(clampValue('setpoint', 21.4, 'climate', { ...cl, target_temp_step: 1 }), { value: 21 });
  assert.deepEqual(clampValue('setpoint', 21.26, 'climate', {}), { value: 21.5 }, 'Home Assistant\'s default step of 0.5');
  assert.deepEqual(clampValue('setpointRange', [18.2, 24.9], 'climate', cl), { value: [18, 25] });
  assert.equal(clampValue('setpointRange', [24, 20], 'climate', cl), undefined, 'low below high');
  assert.equal(clampValue('setpointRange', [21, 21.1], 'climate', cl), undefined, 'the same after snapping');
  assert.equal(clampValue('setpointRange', 21, 'climate', cl), undefined);
  assert.deepEqual(clampValue('hvacMode', 'cool', 'climate', cl), { value: 'cool' });
  assert.equal(clampValue('hvacMode', 'turbo', 'climate', cl), undefined, 'a mode the entity does not have');
  assert.equal(clampValue('hvacMode', 'cool', 'climate', cl, { modes: ['off', 'heat'] }), undefined, 'a mode the owner left out');
  assert.deepEqual(clampValue('fanMode', 'low', 'climate', cl), { value: 'low' });
  assert.equal(clampValue('fanMode', 'max', 'climate', cl), undefined);
  assert.deepEqual(clampValue('position', 120, 'cover'), { value: 100 });
  assert.deepEqual(clampValue('fanPct', -3, 'fan'), { value: 0 });
  assert.deepEqual(clampValue('volume', 1.7, 'media_player'), { value: 1 });
  assert.deepEqual(clampValue('volume', 0.333, 'media_player'), { value: 0.33 });
  assert.equal(clampValue('unlock', null, 'lock'), undefined);
});

test('needsConfirm: doors, gates, locks and garages by device class, id or name, in the five languages', () => {
  for (const [d, attrs, id, name] of [
    ['switch', {}, 'switch.garage_door', ''], ['script', {}, 'script.abrir_puerta', ''], ['button', {}, 'button.open_gate', ''],
    ['switch', { friendly_name: 'Portón' }, 'switch.relay_1', ''], ['switch', {}, 'switch.relay_2', 'Cerradura'], ['switch', {}, 'switch.portao', 'Portão'],
    ['switch', {}, 'switch.x', 'Voordeur'], ['switch', {}, 'switch.x', 'Garagepoort'], ['switch', {}, 'switch.x', 'Hoveddør'], ['switch', {}, 'switch.x', 'Lås'],
    ['switch', {}, 'switch.x', 'Slot voordeur'], ['switch', {}, 'switch.x', 'Port'], ['cover', { device_class: 'door' }, 'cover.x', ''],
    ['cover', { device_class: 'window' }, 'cover.x', ''], ['switch', {}, 'switch.alarm_siren', ''], ['script', {}, 'script.x', 'Fechadura'],
    ['switch', {}, 'switch.portao', ''],
  ]) assert.equal(needsConfirm(d, attrs, id, name), true, `${id} ${name} ${JSON.stringify(attrs)}`);
  for (const [d, attrs, id, name] of [
    ['light', {}, 'light.outdoor', 'Outdoor lights'], ['switch', {}, 'switch.clock_radio', 'Clock'], ['switch', {}, 'switch.tv', 'Sports'],
    ['switch', {}, 'switch.x', 'Report'], ['cover', { device_class: 'shutter' }, 'cover.living', 'Persiana'], ['light', {}, 'light.kitchen', 'Cocina'],
  ]) assert.equal(needsConfirm(d, attrs, id, name), false, `${id} ${name}`);
});

test('aliasControls: a door-like entity offers nothing until the owner ticked it, then always two taps', () => {
  const base = { entity: 'switch.garage', itemId: 'cv_a0000000', kind: 'ha.switch', slot: 0, interactive: true, confirm: false, ack: false, name: '', props: {} };
  const m = { slim: slim('switch', 'off', {}), attrs: {} };
  assert.deepEqual(aliasControls(base, m, true), { c: [], cf: true });
  assert.deepEqual(aliasControls({ ...base, ack: true }, m, true), { c: ['toggle', 'on', 'off'], cf: true });
  assert.deepEqual(aliasControls({ ...base, entity: 'switch.lamp' }, m, true), { c: ['toggle', 'on', 'off'], cf: false });
  assert.deepEqual(aliasControls({ ...base, entity: 'switch.lamp', confirm: true }, m, true), { c: ['toggle', 'on', 'off'], cf: true });
  assert.deepEqual(aliasControls({ ...base, entity: 'switch.lamp' }, m, false), { c: [], cf: false }, 'no touch, nothing');
  // the friendly name from Home Assistant counts as well
  assert.deepEqual(aliasControls({ ...base, entity: 'switch.relay' }, { ...m, attrs: { friendly_name: 'Puerta del jardín' } }, true).c, []);
  const snap = snapshotStates(new Map([['cv_a0000000:0', { ...base, ack: true }]]), () => ({ ...m, at: 1 }), { touch: true });
  assert.equal(snap['cv_a0000000:0'].cf, true);
});

test('validation: an item bound to a door-like entity always asks for two taps; the tick is kept', () => {
  const c = defaultConfig();
  c.screens[0].layout.preset = 'canvas';
  c.screens[0].canvas = {
    ...defaultCanvas(), touch: true,
    items: [
      item('ha.switch', M(0, 0, 'xs'), { entity: 'switch.garage_door' }, { confirm: false, ack: true }),
      item('ha.scene', M(2, 0, 's'), { buttons: [{ entity: 'scene.movie', label: '', icon: '' }, { entity: 'script.x', label: 'Abrir portón', icon: '' }] }),
      item('ha.light', M(5, 0, 's'), { entity: 'light.kitchen' }, { confirm: false, ack: 'yes' }),
    ],
  };
  const v = validateConfig(c);
  assert.equal(v.ok, false, 'a non-boolean tick is an error');
  c.screens[0].canvas.items[2].ack = false;
  const ok = validateConfig(c);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const [sw, sc, li] = ok.value.screens[0].canvas.items;
  assert.equal(sw.confirm, true);
  assert.equal(sw.ack, true);
  assert.equal(sc.confirm, true, 'a button named like a gate');
  assert.equal(li.confirm, false);
  assert.equal('ack' in li, false);
  // the tick never reaches a display
  assert.equal(JSON.stringify(projectCanvas(ok.value.screens[0])).includes('"ack"'), false);
});
