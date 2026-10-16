// Write the golden HTML fixtures of the display widgets (server/test/golden.js). Run it only when a change to what
// the widgets draw is intended; display-golden.test.js compares against these files.
//   node scripts/golden.mjs
import fs from 'node:fs';
import { renderGolden } from '../server/test/golden.js';
import { findChrome } from '../server/test/browser.js';

if (!findChrome()) {
  console.error('No Chrome or Chromium found (set CHROME_PATH).');
  process.exit(1);
}
const dir = new URL('../server/test/fixtures/golden/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const out = await renderGolden();
for (const [name, html] of Object.entries(out)) fs.writeFileSync(new URL(`${name}.html`, dir), `${html}\n`);
console.log(`wrote ${Object.keys(out).length} fixtures`);
