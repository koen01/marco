// The display widgets draw exactly what they drew before the canvas builder's per-instance cfg() refactor: every
// golden fixture (server/test/golden.js, written by scripts/golden.mjs) is rendered again in headless Chrome and
// compared byte for byte. Skipped when no Chrome or Chromium is installed (set CHROME_PATH to point at one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome } from './browser.js';
import { GOLDEN_CASES, renderGolden } from './golden.js';

const dir = new URL('./fixtures/golden/', import.meta.url);

test('every golden case has a fixture', () => {
  for (const name of Object.keys(GOLDEN_CASES)) assert.ok(fs.existsSync(new URL(`${name}.html`, dir)), name);
});

test('the widgets render byte-identical to the golden fixtures', { skip: !findChrome() && 'no Chrome', timeout: 240_000 }, async () => {
  const out = await renderGolden();
  for (const [name, html] of Object.entries(out)) {
    const want = fs.readFileSync(new URL(`${name}.html`, dir), 'utf8');
    assert.equal(`${html}\n`, want, `${name} differs from its golden fixture`);
  }
});
