// A screen that becomes Personalizado for the first time starts with the Personalizado card glass
// (core/canvasCore.js CANVAS_GLASS_DEFAULTS) when its glass was never changed: in the admin (startCanvasGlass, called
// by Diseño and "Copiar a otra pantalla") and on an admin save (store.js saveConfig, startCanvasGlassOnSave).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../store.js';
import { defaultConfig, defaultScreenProfile } from '../core/defaults.js';
import { CANVAS_GLASS_DEFAULTS, SCREEN_GLASS_DEFAULTS, defaultCanvas, defaultItemStyle, glassUntouched, startCanvasGlass, startCanvasGlassOnSave } from '../core/canvasCore.js';
import { loadWebModules } from './webModules.js';

const [glassTs] = await loadWebModules('/web/shared/glass.ts');

const clock = () => ({ id: 'cv_clock0001', kind: 'clock.digital', pos: { zone: 'main', x: 0, y: 0, size: 'm' }, style: defaultItemStyle(), props: {} });

test('the defaults: the screen glass of every style, and the lighter one of Personalizado', () => {
  assert.deepEqual({ ...SCREEN_GLASS_DEFAULTS }, glassTs.GLASS_DEFAULTS);
  assert.deepEqual({ ...SCREEN_GLASS_DEFAULTS }, defaultScreenProfile().screen.glass);
  assert.deepEqual({ ...CANVAS_GLASS_DEFAULTS }, { appearance: 'auto', opacity: 0.25, blur: 5, tint: 'dark', edge: true });
  // "Más transparente" on the Transparencia slider, valid for both normalizers
  assert.deepEqual(glassTs.normalizeGlass(CANVAS_GLASS_DEFAULTS), { ...CANVAS_GLASS_DEFAULTS });
  assert.equal(defaultCanvas().background, 'ambient');
});

test('glassUntouched: missing or equal to the defaults; any change counts', () => {
  assert.equal(glassUntouched(undefined), true);
  assert.equal(glassUntouched(null), true);
  assert.equal(glassUntouched({ ...SCREEN_GLASS_DEFAULTS }), true);
  assert.equal(glassUntouched({ opacity: 0.5 }), true, 'missing keys are the defaults');
  assert.equal(glassUntouched({ ...SCREEN_GLASS_DEFAULTS, blur: 17 }), false);
  assert.equal(glassUntouched({ ...SCREEN_GLASS_DEFAULTS, tint: 'photo' }), false);
  assert.equal(glassUntouched({ ...CANVAS_GLASS_DEFAULTS }), false);
});

test('startCanvasGlass: only the first time, only an untouched glass', () => {
  const s = defaultScreenProfile();
  assert.equal(startCanvasGlass(s), true);
  assert.deepEqual(s.screen.glass, { ...CANVAS_GLASS_DEFAULTS });
  // a glass the owner changed stays
  const own = defaultScreenProfile();
  own.screen.glass = { ...SCREEN_GLASS_DEFAULTS, opacity: 0.7 };
  assert.equal(startCanvasGlass(own), false);
  assert.equal(own.screen.glass.opacity, 0.7);
  // already Personalizado, or cards on the grid from an earlier time: not the first time
  const again = defaultScreenProfile();
  again.layout.preset = 'canvas';
  assert.equal(startCanvasGlass(again), false);
  const back = defaultScreenProfile();
  back.canvas.items = [clock()];
  assert.equal(startCanvasGlass(back), false);
  assert.deepEqual(back.screen.glass, { ...SCREEN_GLASS_DEFAULTS });
  // a screen without a glass yet
  const bare = defaultScreenProfile();
  delete bare.screen.glass;
  assert.equal(startCanvasGlass(bare), true);
  assert.equal(bare.screen.glass.blur, 5);
});

test('startCanvasGlassOnSave: screens that became Personalizado in this save; new screens and other layouts untouched', () => {
  const prev = defaultConfig();
  const b = defaultScreenProfile({ id: 's_b', slug: 'b', name: 'B' });
  b.screen.style = 'classic';
  prev.screens.push(b);
  const next = structuredClone(prev);
  next.screens[0].layout.preset = 'canvas';
  next.screens[0].canvas.items = [clock()];
  const fresh = defaultScreenProfile({ id: 's_new', slug: 'new', name: 'New' });
  fresh.layout.preset = 'canvas';
  next.screens.push(fresh);
  assert.deepEqual(startCanvasGlassOnSave(prev, next), ['s_main']);
  assert.deepEqual(next.screens[0].screen.glass, { ...CANVAS_GLASS_DEFAULTS });
  assert.deepEqual(next.screens[1].screen.glass, { ...SCREEN_GLASS_DEFAULTS }, 'Classic screen unchanged');
  assert.deepEqual(next.screens[2].screen.glass, { ...SCREEN_GLASS_DEFAULTS }, 'a new screen (maybe a copy) keeps its glass');
  // saved again: already Personalizado, nothing changes (even a glass set back to the old values)
  const later = structuredClone(next);
  later.screens[0].screen.glass = { ...SCREEN_GLASS_DEFAULTS };
  assert.deepEqual(startCanvasGlassOnSave(next, later), []);
  assert.deepEqual(startCanvasGlassOnSave(null, later), []);
});

test('store: an admin save that turns a screen into Personalizado gives it the Personalizado glass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-glass-'));
  try {
    const c = defaultConfig();
    c.calendar.sources = [];
    c.news.feeds = [];
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
    store.initStore(dir);
    const a = structuredClone(store.getConfig());
    a.screens[0].layout.preset = 'canvas';
    a.screens[0].canvas.items = [clock()];
    const r = store.saveConfig(a, { reason: 'admin', backup: false });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.deepEqual(store.getConfig().screens[0].screen.glass, { ...CANVAS_GLASS_DEFAULTS });
    assert.equal(store.getConfig().screens[0].canvas.background, 'ambient');
    // other saves (a restore, the server itself) are left as they are
    const b = structuredClone(store.getConfig());
    b.screens[0].layout.preset = 'bigCalendar';
    b.screens[0].canvas = defaultCanvas();
    b.screens[0].screen.glass = { ...SCREEN_GLASS_DEFAULTS };
    assert.equal(store.saveConfig(b, { backup: false }).ok, true);
    const d = structuredClone(store.getConfig());
    d.screens[0].layout.preset = 'canvas';
    assert.equal(store.saveConfig(d, { reason: 'restore', backup: false }).ok, true);
    assert.deepEqual(store.getConfig().screens[0].screen.glass, { ...SCREEN_GLASS_DEFAULTS });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
