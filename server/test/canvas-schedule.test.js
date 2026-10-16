// Personalizado: an item's visibility schedule ("Horario"), the time windows of privacy mode. Outside its windows
// an item is left out of the display config (so it gets no data), and the config says when that changes next.
// Also one screen as a file: exported without this household's references, read back like a save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUD_CANVAS_KINDS, exportCanvasFile, readCanvasFile, canvasDataItems, canvasDefaults, canvasWidgetIds, defaultCanvas, defaultItemStyle, ITEM_SCHEDULE_MAX, projectCanvas, readSchedule, scheduleHidden, scheduleNext, scheduleOn } from '../core/canvasCore.js';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { hiddenItems } from '../canvasConditions.js';

const M = (x, y, size) => ({ zone: 'main', x, y, size });
let n = 0;
const item = (kind, pos, props = {}, extra = {}) => ({
  id: `cv_sch${String(n++).padStart(5, '0')}`, kind, pos, style: defaultItemStyle(), props: { ...canvasDefaults(kind), ...props }, ...extra,
});
const collector = () => {
  const errors = [];
  return { errors, err: (path, msg) => errors.push({ path, msg }), warn() {} };
};
const TZ = 'Europe/Madrid';
// Thursday 15 October 2026, 08:30 in Madrid (06:30 UTC)
const THU_0830 = new Date('2026-10-15T06:30:00Z');
const THU_1200 = new Date('2026-10-15T10:00:00Z');
const MORNING = [{ id: 'p_1', enabled: true, days: [1, 2, 3, 4, 5], from: '07:00', to: '09:00' }];

function config(items, mutate = () => {}) {
  const c = defaultConfig();
  c.datetime.timezone = TZ;
  c.screens[0].layout.preset = 'canvas';
  c.screens[0].canvas = { ...defaultCanvas(), items };
  mutate(c);
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
}

test('schedule: read like privacy rules; none or empty is no schedule', () => {
  const c = collector();
  assert.equal(readSchedule(c, 's', undefined), null);
  assert.equal(readSchedule(c, 's', []), null);
  const r = readSchedule(c, 's', [{ id: 'p_a', days: [5, 1, 1, 9], from: '22:00', to: '06:00' }, { enabled: false }]);
  assert.deepEqual(r, [
    { id: 'p_a', enabled: true, days: [1, 5], from: '22:00', to: '06:00' },
    { id: 'p_1', enabled: false, days: [], from: '08:00', to: '20:00' },
  ]);
  assert.deepEqual(c.errors, []);
  readSchedule(c, 's', [{ from: '25:00', to: '10:00' }, { from: '10:00', to: '10:00' }, 'x']);
  assert.deepEqual(c.errors.map((e) => e.path), ['s[0].from', 's[1].to', 's[2]']);
  const many = collector();
  assert.equal(readSchedule(many, 's', Array.from({ length: ITEM_SCHEDULE_MAX + 2 }, () => ({}))).length, ITEM_SCHEDULE_MAX);
  assert.match(many.errors[0].msg, /too many/);
});

test('schedule: kept through validation, an invalid one refuses the save', () => {
  const v = config([item('clock.digital', M(0, 0, 'm'), {}, { schedule: MORNING })]);
  assert.deepEqual(v.screens[0].canvas.items[0].schedule, MORNING);
  const bad = defaultConfig();
  bad.screens[0].layout.preset = 'canvas';
  bad.screens[0].canvas = { ...defaultCanvas(), items: [item('clock.digital', M(0, 0, 'm'), {}, { schedule: [{ from: '09:00', to: '09:00' }] })] };
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /schedule\[0\]\.to/.test(e.path)));
});

test('schedule: on inside a window, off outside; paused windows mean always', () => {
  const it = { schedule: MORNING };
  assert.equal(scheduleOn(it, THU_0830, TZ), true);
  assert.equal(scheduleOn(it, THU_1200, TZ), false);
  // Saturday morning: not one of its days
  assert.equal(scheduleOn(it, new Date('2026-10-17T06:30:00Z'), TZ), false);
  assert.equal(scheduleOn({ schedule: [{ ...MORNING[0], enabled: false }] }, THU_1200, TZ), true);
  assert.equal(scheduleOn({}, THU_1200, TZ), true);
  // across midnight: 22:00 to 06:00 belongs to the day it starts
  const night = { schedule: [{ id: 'p_n', enabled: true, days: [3], from: '22:00', to: '06:00' }] };
  assert.equal(scheduleOn(night, new Date('2026-10-14T19:00:00Z'), TZ), false); // Wednesday 21:00
  assert.equal(scheduleOn(night, new Date('2026-10-15T01:00:00Z'), TZ), true); // Thursday 03:00, inside Wednesday's window
  assert.equal(scheduleOn(night, new Date('2026-10-15T23:00:00Z'), TZ), false); // Friday 01:00, Thursday has no window
});

test('projection: an item outside its schedule is not sent, and `next` says when to ask again', () => {
  const clock = item('clock.digital', M(0, 0, 'm'));
  const menu = item('meals.today', M(4, 0, 'm'), {}, { schedule: MORNING });
  const v = config([clock, menu]);
  const s = v.screens[0];
  const on = projectCanvas(s, { tz: TZ, now: THU_0830 });
  assert.deepEqual(on.items.map((x) => x.id), [clock.id, menu.id]);
  assert.equal(on.next, new Date('2026-10-15T07:00:00Z').toISOString()); // 09:00 in Madrid
  const off = projectCanvas(s, { tz: TZ, now: THU_1200 });
  assert.deepEqual(off.items.map((x) => x.id), [clock.id]);
  assert.equal(off.next, new Date('2026-10-16T05:00:00Z').toISOString()); // Friday 07:00
  assert.equal(JSON.stringify(off).includes('meals'), false);
  // the schedule itself never reaches a display
  assert.equal(JSON.stringify(on).includes('p_1'), false);
  // no schedule anywhere: no `next`
  assert.equal('next' in projectCanvas(config([clock]).screens[0], { tz: TZ, now: THU_1200 }), false);
  // displayConfig uses the configured zone
  assert.equal(displayConfig(v, s).canvas.items.length >= 1, true);
});

test('projection: a hidden item keeps its cell; the derived portrait does not move when its schedule hides it', () => {
  const a = item('clock.digital', M(0, 0, 'm'));
  const b = item('weather.now', M(4, 0, 'm'), {}, { schedule: MORNING });
  const c = item('calendar.agenda', M(8, 0, 'm'));
  const s = config([a, b, c]).screens[0];
  const on = projectCanvas(s, { tz: TZ, now: THU_0830 });
  const off = projectCanvas(s, { tz: TZ, now: THU_1200 });
  assert.deepEqual(off.items.find((x) => x.id === c.id).portrait, on.items.find((x) => x.id === c.id).portrait);
});

test('server side: data, widgets, states and values leave out an item its schedule hides', () => {
  const cfg = config([
    item('market', M(0, 0, 'm'), {}, { schedule: MORNING }),
    item('market', M(4, 0, 'm')),
  ]);
  const s = cfg.screens[0];
  const [first, second] = s.canvas.items;
  assert.deepEqual([...scheduleHidden(s, THU_1200, TZ)], [first.id]);
  assert.deepEqual([...scheduleHidden(s, THU_0830, TZ)], []);
  assert.deepEqual(canvasDataItems(s, { now: THU_1200, tz: TZ }).map((x) => x.id), [second.id]);
  assert.deepEqual(canvasDataItems(s, { now: THU_0830, tz: TZ }).map((x) => x.id), [first.id, second.id]);
  assert.ok(hiddenItems(cfg, s, THU_1200).has(first.id));
  assert.equal(hiddenItems(cfg, s, THU_0830).has(first.id), false);
  assert.equal(scheduleNext(s, THU_1200, TZ), Date.parse('2026-10-16T05:00:00Z'));
  // an item hidden by hand is not counted (nothing to wake up for)
  const hand = config([item('clock.digital', M(0, 0, 'm'), {}, { schedule: MORNING, hidden: true })]).screens[0];
  assert.equal(scheduleNext(hand, THU_1200, TZ), null);
  assert.deepEqual([...scheduleHidden(hand, THU_1200, TZ)], []);
});

test('widget items: a widget its schedule hides is not sent', () => {
  const cfg = config([item('widget', M(0, 0, 'm'), { widgetId: 'w_sched01' }, { schedule: MORNING })], (c) => {
    c.widgets = [{ id: 'w_sched01', type: 'image', name: 'Cam', options: { url: 'https://example.com/a.jpg' } }];
  });
  const s = cfg.screens[0];
  assert.deepEqual(canvasWidgetIds(s, { now: THU_0830, tz: TZ }), ['w_sched01']);
  assert.deepEqual(canvasWidgetIds(s, { now: THU_1200, tz: TZ }), []);
});

// ---- one screen as a file (exportCanvasFile / readCanvasFile)

test('screen file: no calendar, member, entity or widget id leaves; Valor keys and coins stay', () => {
  const cfg = config([
    item('calendar.month', M(0, 0, 'l'), { sourceIds: ['local'] }),
    item('family.routines', M(6, 0, 'm'), {}),
    item('ha.light', M(10, 0, 's'), { entity: 'light.kitchen_ceiling', name: 'Cocina' }, { ack: true, when: { src: 'ha', entity: 'binary_sensor.front_door', op: 'eq', value: 'on' } }),
    item('value', M(0, 6, 's'), { key: 'pool.temp' }, { schedule: MORNING }),
    item('market', M(2, 6, 's')),
    item('html', M(4, 6, 's'), { html: '<b>{{t}}</b>', css: '', bind: [{ name: 't', entity: 'sensor.attic_temperature' }, { name: 'v', value: 'pool.temp' }], refreshSec: 60 }),
  ]);
  const cv = cfg.screens[0].canvas;
  const file = exportCanvasFile(cv, { theme: 'light', glass: { opacity: 0.5 } });
  const text = JSON.stringify(file);
  for (const secret of ['light.kitchen_ceiling', 'binary_sensor.front_door', 'sensor.attic_temperature', '"local"']) assert.equal(text.includes(secret), false, secret);
  assert.equal(file.format, 'marco-screen');
  assert.equal(file.theme, 'light');
  assert.ok(text.includes('pool.temp'));
  assert.ok(text.includes('bitcoin'));
  const ids = cv.items.map((x) => x.id);
  const calId = ids[0];
  const haId = ids[2];
  assert.deepEqual(file.picks[calId], ['calendars']);
  assert.deepEqual(file.picks[haId], ['entities']);
  assert.equal(file.canvas.items[2].ack, undefined);
  assert.deepEqual(file.canvas.items[3].schedule, MORNING);
  assert.equal(file.canvas.items[2].props.name, 'Cocina');
});

test('screen file: import validates like a save, gives new ids and marks what to pick again', () => {
  const cfg = config([
    item('calendar.month', M(0, 0, 'l'), { sourceIds: ['local'] }),
    item('ha.light', M(10, 0, 's'), { entity: 'light.kitchen_ceiling' }),
    item('widget', M(6, 0, 'm'), { widgetId: 'w_file0001' }),
    item('clock.digital', M(0, 6, 's')),
  ], (c) => {
    c.widgets = [{ id: 'w_file0001', type: 'image', name: 'Cam', options: { url: 'https://example.com/a.jpg' } }];
  });
  const file = JSON.parse(JSON.stringify(exportCanvasFile(cfg.screens[0].canvas)));
  const r = readCanvasFile(file);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.canvas.items.length, 4);
  const old = new Set(cfg.screens[0].canvas.items.map((x) => x.id));
  assert.ok(r.canvas.items.every((x) => !old.has(x.id)));
  const byKind = Object.fromEntries(r.canvas.items.map((x) => [x.kind, x]));
  assert.deepEqual(r.picks[byKind['calendar.month'].id], ['calendars']);
  assert.deepEqual(r.picks[byKind['ha.light'].id], ['entities']);
  assert.deepEqual(r.picks[byKind.widget.id], ['widget']);
  assert.equal(byKind.widget.props.widgetId, '');
  assert.equal(r.picks[byKind['clock.digital'].id], undefined);
  // a hand-written file cannot point into this household either
  const forged = structuredClone(file);
  forged.canvas.items[1].props.entity = 'lock.front_door';
  const f2 = readCanvasFile(forged);
  assert.equal(f2.ok, true);
  assert.equal(JSON.stringify(f2).includes('lock.front_door'), false);
  // refused like a save: a bad schedule, not a screen file, a newer format
  const bad = structuredClone(file);
  bad.canvas.items[3].schedule = [{ from: '10:00', to: '10:00' }];
  assert.equal(readCanvasFile(bad).ok, false);
  assert.equal(readCanvasFile({ canvas: {} }).ok, false);
  assert.equal(readCanvasFile({ ...file, version: 99 }).ok, false);
  assert.equal(readCanvasFile(null).ok, false);
});

test('screen file: on Marco Cloud, Home Assistant cards and conditions are left out and counted', () => {
  const cfg = config([
    item('ha.light', M(10, 0, 's'), { entity: 'light.kitchen_ceiling' }),
    item('clock.digital', M(0, 0, 's'), {}, { when: { src: 'ha', entity: 'binary_sensor.front_door', op: 'eq', value: 'on' } }),
    item('value', M(2, 0, 's'), { key: 'pool.temp' }, { when: { src: 'value', key: 'pool.on', op: 'eq', value: 'true' } }),
  ]);
  const file = exportCanvasFile(cfg.screens[0].canvas);
  const r = readCanvasFile(file, {}, { canvasKinds: CLOUD_CANVAS_KINDS, haControls: false });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.canvas.items.map((x) => x.kind), ['clock.digital', 'value']);
  assert.equal(r.dropped, 1);
  assert.equal(r.conditions, 1);
  assert.equal(r.canvas.items[0].when, undefined);
  assert.equal(r.canvas.items[1].when.key, 'pool.on');
});
