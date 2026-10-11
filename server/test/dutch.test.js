// Dutch (nl) as a screen language: accepted by the config, and the display and server-generated text have it.
// The admin panel has no Dutch (web/admin/i18n.ts AdminLang).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { LANGS, countChanged, countNoun, langFromHeader, summaryWord, t, windDirLabel, wmoDescription } from '../core/lib/i18n.js';
import { translateHoliday } from '../rules.js';

let i18n = null;
try {
  i18n = await import('../../web/shared/i18n.ts');
} catch {
  i18n = null;
}
const ts = { skip: i18n ? false : 'TypeScript imports need Node ≥ 22.18' };
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('nl is a valid screen language and an unknown one is still rejected', () => {
  assert.ok(LANGS.includes('nl'));
  const c = defaultConfig();
  c.screens[0].screen.language = 'nl';
  const r = validateConfig(c);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.screens[0].screen.language, 'nl');
  const bad = defaultConfig();
  bad.screens[0].screen.language = 'xx';
  assert.ok(validateConfig(bad).errors.some((e) => e.path === 'screens[0].screen.language'));
});

test('server text in Dutch: weather, wind, Airbnb titles, import summaries, holidays', () => {
  const src = read('server/core/lib/i18n.js');
  const codes = [...src.matchAll(/^  (\d+): \[/gm)].map((m) => Number(m[1]));
  assert.ok(codes.length >= 30);
  for (const code of codes) assert.ok(wmoDescription(code, 'nl'), `no Dutch for weather code ${code}`);
  assert.equal(wmoDescription(63, 'nl'), 'Regen');
  assert.equal(windDirLabel(135, 'nl'), 'ZO');
  assert.equal(t('busy', 'nl'), 'Bezet');
  assert.equal(countNoun(1, 'screen', 'nl'), '1 scherm');
  assert.equal(countNoun(3, 'screen', 'nl'), '3 schermen');
  assert.equal(countChanged(2, 'source', 'nl'), '2 gewijzigd');
  assert.equal(summaryWord('unchanged', 'nl'), 'ongewijzigd');
  assert.equal(langFromHeader('nl-NL,nl;q=0.9,en;q=0.8'), 'nl');
  assert.equal(translateHoliday('Easter Monday', 'nl'), 'Tweede paasdag');
  assert.equal(translateHoliday('Some local feast', 'nl'), 'Some local feast');
  // every holiday has the three translations (es, pt, nl)
  const rules = read('server/rules.js');
  const table = rules.slice(rules.indexOf('const HOLIDAYS = {'), rules.indexOf('export function translateHoliday'));
  const rows = table.split('\n').filter((l) => /^  ['"]/.test(l));
  assert.ok(rows.length > 20);
  for (const row of rows) assert.match(row, /: \['.*', '.*', '.*'\],$/, row);
});

test('display text in Dutch: every key, the date line and the weekday header', ts, () => {
  const { DICTS, LOCALES, formatCountdown, formatDateLine, normLang, weekdayNames } = i18n;
  assert.deepEqual(Object.keys(DICTS.nl).sort(), Object.keys(DICTS.en).sort());
  assert.equal(LOCALES.nl, 'nl-NL');
  assert.equal(normLang('nl'), 'nl');
  assert.equal(normLang('de'), 'en');
  assert.equal(formatDateLine('nl', '2026-10-11'), 'Zondag 11 oktober');
  assert.equal(weekdayNames('nl', 1, 'short')[0], 'Ma');
  assert.equal(i18n.t('nl', 'cdDays', { n: 12 }), 'Nog 12 dagen');
  assert.equal(formatCountdown('nl', 3 * 86400000), 'Over 3 dagen');
});

test('the pairing and welcome screens have Dutch, and the admin offers it for a screen only', () => {
  for (const f of ['web/display/widgets/pairing.ts', 'web/display/widgets/welcome.ts']) assert.match(read(f), /^  nl: \{$/m, f);
  assert.match(read('web/admin/sections/Screen.tsx'), /value: 'nl', label: 'Nederlands'/);
  assert.match(read('web/admin/i18n.ts'), /export type AdminLang = Exclude<Lang, 'nl'>/);
});
