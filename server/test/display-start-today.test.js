// Start on today (calendar.startToday): validation, defaults, and the helper that picks the first grid column
// (web/shared/i18n.ts, loaded through Node's type stripping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';

let i18n = null;
try {
  i18n = await import('../../web/shared/i18n.ts');
} catch {
  i18n = null;
}
const ts = { skip: i18n ? false : 'TypeScript imports need Node ≥ 22.18' };
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('off by default, for new screens and for screens saved before the option', () => {
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.ok, true);
  assert.equal(fresh.value.screens[0].calendar.startToday, false);
  const c = defaultConfig();
  delete c.screens[0].calendar.startToday;
  const old = validateConfig(mergeDefaults(c));
  assert.equal(old.ok, true, JSON.stringify(old.errors));
  assert.equal(old.value.screens[0].calendar.startToday, false);
});

test('it is per screen, reaches the display, and wrong values are rejected with their path', () => {
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('startToday'));
  assert.match(read('web/shared/screens.ts'), /'startToday'/);
  const c = defaultConfig();
  c.screens[0].calendar.startToday = true;
  const { ok, value } = validateConfig(c);
  assert.equal(ok, true);
  assert.equal(displayConfig(value, value.screens[0]).calendar.startToday, true);
  for (const bad of ['yes', 1, null]) {
    const b = defaultConfig();
    b.screens[0].calendar.startToday = bad;
    const r = validateConfig(b);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].calendar.startToday'), JSON.stringify(r.errors));
  }
});

test('the display reads ?startToday= and both READMEs document it', () => {
  assert.match(read('web/display/main.ts'), /params\.get\('startToday'\)/);
  for (const f of ['README.md', 'README.es.md']) assert.match(read(f), /\?startToday=1/, f);
});

test('the grid starts on today when the option is on, on the first day of the week otherwise', ts, () => {
  const { gridWeekStart, startOfWeek, weekdayNames } = i18n;
  const thu = '2026-10-15'; // a Thursday
  assert.equal(startOfWeek(thu, gridWeekStart(thu, 1, false)), '2026-10-12');
  assert.equal(startOfWeek(thu, gridWeekStart(thu, 0, false)), '2026-10-11');
  for (const ws of [0, 1]) assert.equal(startOfWeek(thu, gridWeekStart(thu, ws, true)), thu);
  // the weekday header follows: Thursday first
  assert.equal(weekdayNames('en', gridWeekStart(thu, 1, true), 'long')[0], 'Thursday');
});

// Entry size (calendar.fontScale): the grid entries have their own size, separate from screen.fontScale
test('entry size: 1 by default and for older screens, per screen, limited to 0.4..1.5', () => {
  assert.equal(validateConfig(defaultConfig()).value.screens[0].calendar.fontScale, 1);
  const c = defaultConfig();
  delete c.screens[0].calendar.fontScale;
  assert.equal(validateConfig(mergeDefaults(c)).value.screens[0].calendar.fontScale, 1);
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('fontScale'));
  assert.match(read('web/shared/screens.ts'), /'startToday', 'fontScale'/);
  const ok = defaultConfig();
  ok.screens[0].calendar.fontScale = 0.6;
  ok.screens[0].screen.fontScale = 1;
  const r = validateConfig(ok);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const shown = displayConfig(r.value, r.value.screens[0]);
  assert.equal(shown.calendar.fontScale, 0.6);
  assert.equal(shown.screen.fontScale, 1);
  for (const bad of [0.2, 3, 'big']) {
    const b = defaultConfig();
    b.screens[0].calendar.fontScale = bad;
    const rb = validateConfig(b);
    assert.equal(rb.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(rb.errors.some((e) => e.path === 'screens[0].calendar.fontScale'), JSON.stringify(rb.errors));
  }
});

test('entry size: the entry styles and the grid planning use the same factor', () => {
  const css = read('web/display/styles.css');
  assert.match(css, /font-size: calc\(var\(--chip-fs\) \* var\(--cs, 1\)\)/);
  assert.match(css, /minmax\(calc\(var\(--lane-min\) \* var\(--cs, 1\)\), calc\(var\(--lane-h\) \* var\(--cs, 1\)\)\)/);
  const cal = read('web/display/widgets/calendar.ts');
  assert.match(cal, /setProperty\('--cs'/);
  assert.match(cal, /v\('--lane-h', 2\.9\) \* s/);
  assert.match(read('web/display/main.ts'), /params\.get\('calfs'\)/);
  for (const f of ['README.md', 'README.es.md']) assert.match(read(f), /\?calfs=/, f);
});
