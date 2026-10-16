// Personalizado: a page switched to Foto while the display runs (the editor's preview, or a saved change pushed to the
// screen) shows a photo at once. The photo list came while the page was Animado (photos off), and the slideshow only
// waited for its timer: a black page for a whole interval. In headless Chrome on the demo (skipped without a browser).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome, launchChrome, startWeb } from './browser.js';

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the slideshow shows a photo when photos come on, not after the interval', () => {
  const src = read('web/display/widgets/photos.ts');
  assert.match(src, /const turnedOn = b\.enabled && this\.wasOn === false;/);
  assert.match(src, /if \(b\.enabled && \(turnedOn \|\| !this\.shown\) && this\.list\.length && !this\.loading\) void this\.next\(\);/);
  assert.match(src, /if \(first \|\| !this\.shown\) void this\.next\(\);/);
});

const chrome = findChrome();
describe('Personalizado: Animado to Foto on a running display', { skip: !chrome && 'no Chrome' }, () => {
  let web, browser;
  before(async () => {
    web = await startWeb();
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    await web?.close();
  });

  const STATE = `(() => ({ app: document.getElementById('app').className, shown: document.querySelectorAll('.photo-area .ph-stack .ph').length }))()`;
  // the editor's preview: the draft config posted to the page (main.ts, marco:preview-draft) with another page background
  const draft = (bg) => `import('/display/store.ts').then(({ state }) => {
    const c = structuredClone(state.config);
    c.canvas = { ...c.canvas, background: '${bg}' };
    window.postMessage({ type: 'marco:preview-draft', config: c }, '*');
  })`;

  test('the photo is on screen right after Foto is chosen', async () => {
    // 'starter' is Animado (the default interval is two minutes)
    const p = await browser.page(`${web.url}/?demo=1&preview=1&preset=canvas&shot=starter&photo=half&transition=fade&lite=0`);
    try {
      await p.eval('new Promise((r) => setTimeout(r, 1500))');
      const off = await p.eval(STATE);
      assert.match(off.app, /\bno-photo\b/);
      assert.equal(off.shown, 0);
      await p.eval(draft('photo'));
      await p.eval('new Promise((r) => setTimeout(r, 2500))');
      const on = await p.eval(STATE);
      assert.match(on.app, /\bhas-photo\b/);
      assert.match(on.app, /\bbg-screen\b/);
      assert.ok(on.shown >= 1, 'a photo is on screen');
      const errors = p.errors().map((e) => JSON.stringify(e.params)).filter((s) => !/vite|Vite/.test(s));
      assert.deepEqual(errors, []);
    } finally {
      await p.close();
    }
  });
});
