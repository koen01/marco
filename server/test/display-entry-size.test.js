// Entry size (calendar.fontScale): the grid entries (chips, cards, compact lines) have their own size, separate from
// screen.fontScale: validation, defaults, and the CSS and the grid planning using the same factor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('entry size: 1 by default and for older screens, per screen, limited to 0.4..1.5', () => {
  assert.equal(validateConfig(defaultConfig()).value.screens[0].calendar.fontScale, 1);
  const c = defaultConfig();
  delete c.screens[0].calendar.fontScale;
  assert.equal(validateConfig(mergeDefaults(c)).value.screens[0].calendar.fontScale, 1);
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('fontScale'));
  assert.match(read('web/shared/screens.ts'), /'agendaDays', 'fontScale'/);
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
  // cards: the planned sizes (--card-*) come from the scaled chip font, the paddings in the CSS follow --cs
  assert.match(cal, /const rem = rootRem \* this\.scale;/);
  assert.match(read('web/display/styles-planner.css'), /margin: 0 calc\(0\.35rem \* var\(--cs, 1\)\)/);
  assert.match(read('web/display/main.ts'), /params\.get\('calfs'\)/);
  for (const f of ['README.md', 'README.es.md']) assert.match(read(f), /\?calfs=/, f);
});
