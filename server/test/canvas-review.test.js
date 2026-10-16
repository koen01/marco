// Final review of the Personalizado screens (fixes found in the screenshots): each one checked in the source, the
// browser checks live in display-canvas.test.js and html-widget.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('custom HTML frames take their document colour scheme (no grey box behind a frame on a light screen)', () => {
  const src = read('web/display/widgets/canvas/html.ts');
  assert.match(src, /nextScheme = scheme;/);
  assert.match(src, /if \(nextScheme\) f\.style\.colorScheme = nextScheme;/);
});

test('a slider label reads on the fill and on the track, upright', () => {
  const ui = read('web/display/widgets/ha/haui.ts');
  assert.match(ui, /on\.className = 'cv-slider-t is-on';/);
  assert.doesNotMatch(ui, /is-low/);
  const css = read('web/display/styles-ha.css');
  assert.match(css, /\.cv-slider-t \{[^}]*font-style: normal;[^}]*color: var\(--fg\);/);
  assert.match(css, /\.cv-slider-t\.is-on \{ color: #1c1c1e; \}/);
});

test('light cards: dark weather icons, dark text on a light sidebar, a long Today title cut, world clock offsets that fit', () => {
  const css = read('web/display/styles-canvas.css');
  assert.match(css, /\.theme-light #app\.preset-canvas \.cv-card\.is-glass:not\(\.has-own\) \.cv-wx svg \[stroke='#eef2f7'\]/);
  assert.match(css, /\.theme-light #app#app\.preset-canvas\.cv-fill-glass > \.side \.cv-card\.is-none,/);
  assert.match(css, /#app\.preset-canvas \.cv-view \.td-title \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/);
  assert.match(css, /\.cv-zone \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto calc\(3rem \* var\(--wk, 1\)\);/);
});

test('a price widget in a wide card shrinks its price to its half; the full-screen layout is untouched', () => {
  const src = read('web/display/widgets/prices.ts');
  assert.match(src, /else if \(mode === 'full' && card\.parentElement\?\.classList\.contains\('uw-in-canvas'\)\) this\.fitWide\(pk\);/);
});

test('builder: a tap on a card while placing places the new one; the home panel template when Home Assistant is on', () => {
  const stage = read('web/admin/builder/Stage.tsx');
  assert.match(stage, /onTap: \(ev\) => \{\n\s+\/\/ "modo colocar"[^]*?const pl2 = live\.current\.placing;\n\s+if \(pl2\) \{/);
  assert.match(stage, /if \(ro \|\| live\.current\.placing\) return false;/);
  const tp = read('web/admin/builder/TemplatePicker.tsx');
  assert.match(tp, /!tp\.requires\?\.ha \|\| props\.ha/);
  assert.match(read('web/admin/builder/BuilderModal.tsx'), /ha=\{fieldEnv\.ha\}/);
});
