// Planner options: calendar.weeks = 'auto', calendar.eventStyle = 'cards' and the 'planner' layout. Validation,
// defaults for new and older screens, the setup wizard, and the pure helpers that pick the weeks and plan the cards
// (web/display/cards.ts, loaded through Vite like the admin modules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, mergeDefaults, LAYOUT_PRESETS, EVENT_STYLES, PLANNER_BARS } from '../core/validate.js';
import { defaultConfig, defaultScreenProfile, PLANNER_CALENDAR, SCREEN_SPLIT_KEYS } from '../core/defaults.js';
import { displayConfig } from '../core/screens.js';
import { applySetup, parseSetupBody } from '../setup.js';
import { loadWebModules } from './webModules.js';

const [cards, displayDefaults] = await loadWebModules('/web/display/cards.ts', '/web/display/defaults.ts');
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('weeks accepts a number or "auto"; anything else is rejected with its path', () => {
  for (const ok of ['auto', 1, 3, 6, 8]) {
    const c = defaultConfig();
    c.screens[0].calendar.weeks = ok;
    const r = validateConfig(c);
    assert.equal(r.ok, true, `${ok}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.value.screens[0].calendar.weeks, ok);
    assert.equal(displayConfig(r.value, r.value.screens[0]).calendar.weeks, ok);
  }
  for (const bad of ['Auto', 'automatic', 0, 9, 'x', true]) {
    const c = defaultConfig();
    c.screens[0].calendar.weeks = bad;
    const r = validateConfig(c);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].calendar.weeks'), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].calendar.weeks, 5);
  }
});

test('eventStyle is lines or cards, per screen; anything else is rejected with its path', () => {
  assert.deepEqual(EVENT_STYLES, ['lines', 'cards']);
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('eventStyle'));
  assert.match(read('web/shared/screens.ts'), /'eventStyle'/);
  for (const ok of EVENT_STYLES) {
    const c = defaultConfig();
    c.screens[0].calendar.eventStyle = ok;
    const r = validateConfig(c);
    assert.equal(r.ok, true);
    assert.equal(displayConfig(r.value, r.value.screens[0]).calendar.eventStyle, ok);
  }
  for (const bad of ['card', 'Cards', 1, null, '']) {
    const c = defaultConfig();
    c.screens[0].calendar.eventStyle = bad;
    const r = validateConfig(c);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].calendar.eventStyle'), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].calendar.eventStyle, 'lines');
  }
});

test('defaults are unchanged: new and older screens keep one-line chips and their number of weeks', () => {
  const cal = defaultScreenProfile().calendar;
  assert.equal(cal.weeks, 5);
  assert.equal(cal.eventStyle, 'lines');
  assert.equal(defaultScreenProfile().layout.preset, 'bigCalendar');
  // a stored config from before the options (no eventStyle, a number of weeks) keeps what it had
  for (const weeks of [1, 2, 4, 6]) {
    const c = defaultConfig();
    c.screens[0].calendar.weeks = weeks;
    delete c.screens[0].calendar.eventStyle;
    const r = validateConfig(mergeDefaults(c));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].calendar.weeks, weeks);
    assert.equal(r.value.screens[0].calendar.eventStyle, 'lines');
    // and so does one validated without the defaults merged in
    assert.equal(validateConfig(c).value.screens[0].calendar.eventStyle, 'lines');
  }
});

test('the display reads the options the same way: old configs keep lines and their weeks, "auto" survives', () => {
  const { normalizeConfig } = displayDefaults;
  const old = normalizeConfig({ calendar: { weeks: 4, maxEventsPerDay: 4 } });
  assert.equal(old.calendar.weeks, 4);
  assert.equal(old.calendar.eventStyle, 'lines');
  assert.equal(normalizeConfig({}).calendar.weeks, 5);
  assert.equal(normalizeConfig({ calendar: { weeks: 12 } }).calendar.weeks, 8);
  const auto = normalizeConfig({ calendar: { weeks: 'auto', eventStyle: 'cards' } });
  assert.equal(auto.calendar.weeks, 'auto');
  assert.equal(auto.calendar.eventStyle, 'cards');
  assert.equal(normalizeConfig({ calendar: { eventStyle: 'tiles' } }).calendar.eventStyle, 'lines');
  // URL overrides for screenshots and tests
  const main = read('web/display/main.ts');
  assert.match(main, /params\.get\('weeks'\) === 'auto'/);
  assert.match(main, /params\.get\('cards'\)/);
});

test('first paint: the month grid shows the configured weeks from the start, also when a carousel switches', () => {
  const main = read('web/display/main.ts');
  // the first tick, the resize observer and cached events come before the config: nothing is drawn with the
  // default 5 weeks (their extra rows used to fade out for half a second while the screen faded in)
  const body = main.slice(main.indexOf('function renderCalendar('));
  assert.match(body, /^function renderCalendar\(tick: Tick\): void \{\s*(\/\/[^\n]*\n\s*)*if \(!state\.config\) return;/);
  // a carousel screen goes in with its own rows at once, none of the old screen fading out over it
  assert.match(main, /calendar\.still = true;\s*try \{\s*set\('config', b\.config\);\s*\} finally \{\s*calendar\.still = false;\s*\}/);
  const cal = read('web/display/widgets/calendar.ts');
  assert.match(cal, /reconcile\(this\.weeks, weekSpecs, \{ flip: true, animate: !this\.still \}\);/);
  // a number of weeks never waits for a measure: the first render already has it
  assert.equal(cards.resolveWeeks(3, 0, 0), 3);
});

test('the planner layout: accepted everywhere, and picking it sets automatic weeks and cards', () => {
  assert.ok(LAYOUT_PRESETS.includes('planner'));
  assert.deepEqual(PLANNER_CALENDAR, { weeks: 'auto', eventStyle: 'cards' });
  // the admin applies the same values when the layout is picked
  const fields = read('web/admin/components/PlannerFields.tsx');
  assert.match(fields, /PLANNER_CALENDAR[^=]*= \{ weeks: 'auto', eventStyle: 'cards' \}/);
  const layout = read('web/admin/sections/Layout.tsx');
  assert.match(layout, /p\.id === 'planner' && d\.layout\.preset !== 'planner'\) \{\s*Object\.assign\(d\.calendar, PLANNER_CALENDAR\);/);
  // and the time and the weather start in the strip on top
  assert.match(layout, /Object\.assign\(d\.calendar, PLANNER_CALENDAR\);[^}]*d\.layout\.plannerBar = 'top';/);
  // the setup wizard too, and only for this layout
  const { value } = parseSetupBody({ layout: 'planner' });
  assert.equal(value.layout, 'planner');
  const base = { screenName: 'Cocina', language: 'en', calendars: [] };
  const planned = applySetup(defaultConfig(), { ...base, layout: 'planner' });
  const scr = planned.screens[0];
  assert.equal(scr.layout.preset, 'planner');
  assert.equal(scr.calendar.weeks, 'auto');
  assert.equal(scr.calendar.eventStyle, 'cards');
  assert.equal(validateConfig(planned).ok, true);
  for (const layout of LAYOUT_PRESETS.filter((p) => p !== 'planner')) {
    const other = applySetup(defaultConfig(), { ...base, layout }).screens[0];
    assert.equal(other.calendar.weeks, 5, layout);
    assert.equal(other.calendar.eventStyle, 'lines', layout);
  }
});

test('leaving the planner before saving gives the other layouts back their weeks and event style', async () => {
  const [{ undoPlannerPick, PLANNER_CALENDAR: picked }] = await loadWebModules('/web/admin/components/PlannerFields.tsx');
  const saved = { weeks: 5, eventStyle: 'lines' };
  // picked and left as it was: both go back
  const cal = { ...saved, ...picked };
  undoPlannerPick(cal, saved);
  assert.deepEqual(cal, saved);
  // changed by hand on the planner: that one stays
  const changed = { ...saved, ...picked, weeks: 3 };
  undoPlannerPick(changed, saved);
  assert.deepEqual(changed, { weeks: 3, eventStyle: 'lines' });
  // the Layout page only does it when the saved screen was not on the planner already
  assert.match(read('web/admin/sections/Layout.tsx'), /was\.layout\.preset !== 'planner'\) undoPlannerPick\(d\.calendar, was\.calendar\)/);
});

test('automatic weeks: between 2 and the cap, fewer rows when each day must fit more events', () => {
  const { autoWeeks, resolveWeeks, rangeWeeks, cardRowNeed, lineRowNeed, AUTO_WEEKS_MIN, AUTO_WEEKS_MAX } = cards;
  assert.equal(AUTO_WEEKS_MIN, 2);
  assert.equal(AUTO_WEEKS_MAX, 6);
  assert.equal(autoWeeks(1000, 250), 4);
  assert.equal(autoWeeks(1000, 600), 2); // never fewer than 2
  assert.equal(autoWeeks(5000, 100), 6); // never more than 6
  assert.equal(autoWeeks(5000, 100, 4), 4); // a layout's cap
  assert.equal(autoWeeks(0, 250), 4); // not laid out yet
  const m = { pad: 4, timeH: 17, lineH: 19, gap: 4, border: 2 };
  const area = 1300; // a portrait 1080×1920 planner
  let prev = Infinity;
  for (let perDay = 1; perDay <= 8; perDay++) {
    const w = autoWeeks(area, cardRowNeed(39, 4, perDay, m));
    assert.ok(w <= prev, `more events per day must not add rows (${perDay})`);
    assert.ok(w >= 2 && w <= 6);
    prev = w;
  }
  assert.ok(autoWeeks(area, lineRowNeed(50, 29, 4, 4)) >= autoWeeks(area, cardRowNeed(50, 4, 4, m)));
  // the event range covers the most weeks 'auto' can show
  assert.equal(rangeWeeks('auto'), 6);
  assert.equal(rangeWeeks(3), 3);
  assert.equal(resolveWeeks('auto', area, cardRowNeed(39, 4, 6, m)), autoWeeks(area, cardRowNeed(39, 4, 6, m)));
});

test('regression: a number of weeks is drawn exactly as before, whatever the screen size or the events', () => {
  const { resolveWeeks, rangeWeeks } = cards;
  // the default display path (eventStyle 'lines', a number of weeks) on a busy calendar: the old code used
  // c.weeks as it was, for the rows and for the range of events fetched
  const sizes = [[0, 0], [850, 194], [1300, 270], [640, 900], [3000, 50]];
  for (let weeks = 1; weeks <= 8; weeks++) {
    for (const [h, need] of sizes) assert.equal(resolveWeeks(weeks, h, need), weeks);
    assert.equal(rangeWeeks(weeks), weeks);
  }
  // the lines path of the month grid keeps its own lane and compact planning (only cards skip compact busy days)
  const cal = read('web/display/widgets/calendar.ts');
  assert.match(cal, /const L = Math\.max\(1, Math\.min\(wantL, m \? this\.lanesFor\(m\.h \/ nWeeks - 1, m\) : 99\)\);/);
  assert.match(cal, /const compact = c\.compactBusyDays === true && !cards;/);
  assert.match(cal, /className: cards \? 'wk cards' : 'wk'/);
  // card styles only touch the cards and the planner layout
  const css = read('web/display/styles-planner.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    for (const sel of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      assert.match(sel, /\.ev-cards|\.wk\.cards|\.cstack\.cards|\.preset-planner/, sel);
    }
  }
});

test('cards: heights, title lines and how a busy day is split into pages', () => {
  const { cardHeight, titleLines, planCardPages, planDayCards, barLanesFor, CARD_MAX_LINES } = cards;
  const m = { pad: 4, timeH: 17, lineH: 19, gap: 4, border: 2 };
  assert.equal(CARD_MAX_LINES, 2);
  assert.equal(cardHeight(1, true, m), 8 + 2 + 17 + 19);
  assert.equal(cardHeight(2, true, m), 8 + 2 + 17 + 38);
  assert.equal(cardHeight(1, false, m), 8 + 2 + 19);
  assert.equal(cardHeight(1, true, { ...m, border: 0 }), 8 + 17 + 19); // the border counts in the plan
  assert.equal(cardHeight(5, true, m), cardHeight(2, true, m)); // at most two title lines
  assert.equal(titleLines(80, 120), 1);
  assert.equal(titleLines(200, 120), 2);
  assert.equal(titleLines(900, 120), 2);
  assert.equal(titleLines(50, 0), 1);
  // a sample busy day: 7 cards of 44 or 63 px in 240 px
  const hs = [27, 44, 63, 44, 44, 63, 44];
  const pages = planCardPages(hs, 240, 4);
  assert.deepEqual(pages.flat(), [0, 1, 2, 3, 4, 5, 6]); // every card once, in order
  for (const p of pages) {
    const used = p.reduce((s, i) => s + hs[i], 0) + 4 * (p.length - 1);
    assert.ok(used <= 240, `page ${p} uses ${used}`);
  }
  assert.deepEqual(pages, [[0, 1, 2, 3, 4], [5, 6]]);
  // everything fits: one page
  assert.deepEqual(planCardPages([44, 44], 240, 4), [[0, 1]]);
  assert.deepEqual(planCardPages([], 240, 4), [[]]);
  // a card taller than the space still gets a page
  assert.deepEqual(planCardPages([300, 44], 240, 4), [[0], [1]]);
  // rotation on: pages; off: the first page and "+N"
  assert.deepEqual(planDayCards(hs, 240, 4, true), { pages, more: 0 });
  assert.deepEqual(planDayCards(hs, 240, 4, false), { pages: [pages[0]], more: 2 });
  assert.deepEqual(planDayCards([44], 240, 4, false), { pages: [[0]], more: 0 });
  // bars above the cards: at most a few lanes, and always room for one card below them
  assert.equal(barLanesFor(300, 40, 29, 4, 44), 4);
  assert.equal(barLanesFor(150, 40, 29, 4, 44), 1);
  assert.equal(barLanesFor(60, 40, 29, 4, 44), 1);
});

test('fitBusyDays: per screen, off by default and for screens stored without it, rejected when not a boolean', () => {
  assert.ok(SCREEN_SPLIT_KEYS.calendar.includes('fitBusyDays'));
  assert.match(read('web/shared/screens.ts'), /'fitBusyDays'/);
  assert.equal(displayDefaults.DEFAULT_CONFIG.calendar.fitBusyDays, false);
  const fresh = validateConfig(defaultConfig());
  assert.equal(fresh.value.screens[0].calendar.fitBusyDays, false);
  const old = defaultConfig();
  delete old.screens[0].calendar.fitBusyDays;
  assert.equal(validateConfig(mergeDefaults(old)).value.screens[0].calendar.fitBusyDays, false);
  const on = defaultConfig();
  on.screens[0].calendar.fitBusyDays = true;
  const r = validateConfig(on);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(displayConfig(r.value, r.value.screens[0]).calendar.fitBusyDays, true);
  const bad = defaultConfig();
  bad.screens[0].calendar.fitBusyDays = 'yes';
  const rb = validateConfig(bad);
  assert.equal(rb.ok, false);
  assert.ok(rb.errors.some((e) => e.path === 'screens[0].calendar.fitBusyDays'), JSON.stringify(rb.errors));
});

test('fitBusyDays: the largest scale at which a busy day fits, never below the minimum', () => {
  const { cardHeight, fitScale, scaleCards, planCardPages, FIT_MIN_SCALE } = cards;
  const m = { pad: 4, timeH: 17, lineH: 19, gap: 4, border: 2 };
  assert.deepEqual(scaleCards(m, 0.5), { pad: 2, timeH: 8.5, lineH: 9.5, gap: 2, border: 2 });
  const lines = [1, 1, 2, 1, 1, 2, 1];
  const heightsAt = (s) => lines.map((n) => cardHeight(n, true, scaleCards(m, s)));
  const gapAt = (s) => m.gap * s;
  // everything fits already: normal size
  assert.equal(fitScale(heightsAt, 1000, gapAt), 1);
  // 7 cards (365 px at full size) in 300 px: a smaller size that fits, and the next step up would not
  const s = fitScale(heightsAt, 300, gapAt);
  assert.ok(s < 1 && s >= FIT_MIN_SCALE, String(s));
  assert.equal(planCardPages(heightsAt(s), 300, gapAt(s)).length, 1);
  assert.ok(planCardPages(heightsAt(s + 0.05), 300, gapAt(s + 0.05)).length > 1);
  // far too many: the minimum (the caller pages or shows "+N" for the rest)
  assert.equal(fitScale(heightsAt, 60, gapAt), FIT_MIN_SCALE);
  // titles that take fewer lines when smaller are counted
  const wrapAt = (sc) => [0, 1].map(() => cardHeight(sc < 0.9 ? 1 : 2, true, scaleCards(m, sc)));
  assert.equal(fitScale(wrapAt, 83, gapAt), 0.85);
});

test('the planner has texts in Spanish, English and Portuguese, and the docs mention it', () => {
  const dict = read('web/admin/i18n-dict-planner.ts');
  assert.match(read('web/admin/i18n-dict.ts'), /\.\.\.ROWS_PLANNER[,\]]/);
  for (const m of read('web/admin/components/PlannerFields.tsx').matchAll(/t\('([^']+)'\)/g)) {
    if (['Semanas a mostrar', 'Auto', 'Automático'].includes(m[1])) continue; // older rows
    assert.ok(dict.includes(`'${m[1]}'`), `no row for "${m[1]}"`);
  }
  for (const f of ['README.md', 'README.es.md', 'docs/API.md', 'docs/ARCHITECTURE.md', 'CHANGELOG.md']) {
    assert.match(read(f), /eventStyle|planner|Planificador/i, f);
  }
});

test('portrait top band: the pills under the clock never widen its column (the weather card stays on screen)', () => {
  // Regression: a long next-event title made the pill as wide as its text, which widened the clock column of
  // the topBottom grid (Planner on a portrait screen) and pushed the weather card off the right edge. The pills
  // take the width of the column (width 0, min-width 100%) and the title is cut with an ellipsis or slides.
  // Checked visually with ?demo=1&busy=2&planner=1 at 1080x1920, Modern and Classic, dark and light.
  const css = read('web/display/styles.css');
  assert.match(css, /\.preset-topBottom \.highlights \{ width: 0; min-width: 100%; \}/);
  assert.match(css, /\.preset-topBottom \.side \{ display: grid; grid-template-columns: 1fr auto;/);
  assert.match(css, /\.hl-tt \{ overflow: hidden; text-overflow: ellipsis; min-width: 0;/);
  assert.match(css, /\.hl-pill \{[^}]*max-width: 100%;/);
  assert.match(read('web/display/marquee.ts'), /'\.hl-tt'/);
});

// GitHub issue #2: the planner on a landscape screen with the time and the weather above or below the month.
test('plannerBar is side, top or bottom, per screen; anything else is rejected with its path', () => {
  assert.deepEqual(PLANNER_BARS, ['side', 'top', 'bottom']);
  assert.equal(defaultScreenProfile().layout.plannerBar, 'side');
  for (const ok of PLANNER_BARS) {
    const c = defaultConfig();
    c.screens[0].layout.preset = 'planner';
    c.screens[0].layout.plannerBar = ok;
    const r = validateConfig(c);
    assert.equal(r.ok, true, `${ok}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.value.screens[0].layout.plannerBar, ok);
    // the display gets it with the rest of the layout
    assert.equal(displayConfig(r.value, r.value.screens[0]).layout.plannerBar, ok);
  }
  for (const bad of ['Top', 'left', 'above', 1, true, '']) {
    const c = defaultConfig();
    c.screens[0].layout.plannerBar = bad;
    const r = validateConfig(c);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(r.errors.some((e) => e.path === 'screens[0].layout.plannerBar'), JSON.stringify(r.errors));
    assert.equal(r.value.screens[0].layout.plannerBar, 'side');
  }
});

test('plannerBar: screens saved before it keep the side column, on the server and on the display', () => {
  const c = defaultConfig();
  c.screens[0].layout.preset = 'planner';
  delete c.screens[0].layout.plannerBar;
  for (const v of [validateConfig(mergeDefaults(structuredClone(c))), validateConfig(structuredClone(c))]) {
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.equal(v.value.screens[0].layout.plannerBar, 'side');
  }
  const { normalizeConfig } = displayDefaults;
  assert.equal(normalizeConfig({}).layout.plannerBar, 'side');
  assert.equal(normalizeConfig({ layout: { preset: 'planner' } }).layout.plannerBar, 'side');
  assert.equal(normalizeConfig({ layout: { plannerBar: 'nowhere' } }).layout.plannerBar, 'side');
  assert.equal(normalizeConfig({ layout: { plannerBar: 'bottom' } }).layout.plannerBar, 'bottom');
});

test('plannerBar on the display: a landscape planner with top / bottom uses the top / bottom frame and a low strip', () => {
  const main = read('web/display/main.ts');
  // portrait is unchanged (always the top band); landscape: side column, or the top / bottom frame
  assert.match(main, /if \(preset === 'planner'\) return portrait \|\| bar !== 'side' \? 'topBottom' : 'bigCalendar';/);
  assert.match(main, /function plannerBar\(cfg: DisplayConfig, preset: string, portrait: boolean\): PlannerBar \{\s*if \(preset !== 'planner' \|\| portrait\) return 'side';/);
  assert.match(main, /bar !== 'side' \? `pbar pbar-\$\{bar\}` : ''/);
  // ?bar=top|bottom|side for screenshots and tests
  assert.match(main, /params\.get\('bar'\) \|\| cfg\.layout\.plannerBar/);
  // a shorter grid: at most four rows, like the top / bottom layout; the weather row drops what does not fit
  assert.match(main, /if \(plannerBar\(cfg, effectivePreset\(cfg\), isPortrait\(cfg\)\) !== 'side'\) capWeeks\(4\);/);
  assert.match(main, /fitStrip\(\);\s*fitPlannerBar\(\);/);
  const css = read('web/display/styles-planner.css').replace(/\/\*[\s\S]*?\*\//g, '');
  // a low strip (18% of the height, more with a bigger font scale)
  assert.match(css, /#app\.preset-planner\.pbar \{ grid-template-rows: min\(30%, calc\(18% \* var\(--fs\)\)\) minmax\(0, 1fr\); \}/);
  assert.match(css, /#app\.preset-planner\.pbar-bottom \{ grid-template-rows: minmax\(0, 1fr\) min\(30%, calc\(18% \* var\(--fs\)\)\); \}/);
  assert.match(css, /#app\.preset-planner\.pbar-bottom \.photo-area, #app\.preset-planner\.pbar-bottom \.side \{ grid-row: 2; \}/);
  assert.match(css, /\.preset-planner\.pbar \.weather \.fit-hide \{ display: none !important; \}/);
  // Modern: a long place name is cut, it does not push the forecast out of the row
  assert.match(css, /\.style-modern \.preset-planner\.pbar \.wxm-main \{ max-width: 22rem; \}/);
  // the strip centres its content: a few px into its padding is not an overflow (the hourly forecast stays)
  assert.match(main, /const slack = app\.classList\.contains\('pbar'\) \? parseFloat\(getComputedStyle\(sideEl\)\.paddingBottom\) \|\| 0 : 0;/);
  // a screen that turns gets its week-row caps worked out again from the saved config
  assert.match(main, /if \(state\.config && frameKey\(\) !== lastFrameKey\) \{\s*applyConfig\(state\.config\);/);
  assert.match(main, /setCtxConfig\(cfg\);\s*lastFrameKey = frameKey\(\);/);
});

test('plannerBar in the admin: the option in the Planner card, the side panel card muted, texts in es / en / pt', () => {
  const admin = read('web/admin/sections/Layout.tsx');
  assert.match(admin, /value=\{l\.plannerBar \?\? 'side'\}/);
  assert.match(admin, /d\.layout\.plannerBar = v/);
  assert.match(admin, /const plannerStrip = l\.preset === 'planner' && \(l\.plannerBar \?\? 'side'\) !== 'side';/);
  assert.match(admin, /\.includes\(l\.preset\) && !plannerStrip;/);
  assert.match(admin, /<Schematic id=\{p\.id\} side=\{l\.sidePanel\} plannerBar=\{l\.plannerBar \?\? 'side'\} \/>/);
  const dict = read('web/admin/i18n-dict-planner.ts');
  for (const s of ['Hora y tiempo', 'Al lado', 'Arriba', 'Abajo']) assert.match(dict, new RegExp(`\\['${s}', '[^']+', '[^']+'\\]`), s);
  for (const m of admin.matchAll(/t\('((?:En pantallas horizontales|El Planificador tiene|Con la hora y el tiempo)[^']+)'\)/g)) {
    assert.ok(dict.includes(`'${m[1]}'`), `no row for "${m[1]}"`);
  }
  // with the strip at most 4 weeks are shown: picking Top / Bottom turns 5 or 6 into 4, and the weeks field (here and
  // in Calendars, Calendar view) greys out 5 and 6 with the reason as their tooltip and hint
  assert.match(admin, /d\.layout\.plannerBar = v;\s*\/\/[^\n]*\n\s*const cap = weeksCap\(d\);\s*if \(cap && typeof d\.calendar\.weeks === 'number' && d\.calendar\.weeks > cap\) d\.calendar\.weeks = cap;/);
  const fields = read('web/admin/components/PlannerFields.tsx');
  assert.match(fields, /export const PLANNER_STRIP_WEEKS = 4;/);
  assert.match(fields, /if \(l\.preset !== 'planner' \|\| \(l\.plannerBar \?\? 'side'\) === 'side' \|\| cfg\.screen\.orientation === 'portrait'\) return undefined;/);
  assert.match(fields, /cap && \(v as number\) > cap \? \{ value: v, label: String\(v\), off: true, title: capMsg \}/);
  assert.match(read('web/admin/sections/Calendars.tsx'), /<WeeksField cfg=\{props\.cfg\} set=\{set\}/);
  const ui = read('web/admin/components/ui.tsx');
  assert.match(ui, /aria-disabled=\{o\.off \? 'true' : undefined\}/);
  assert.match(ui, /onClick=\{\(\) => !o\.off && props\.onChange\(o\.value\)\}/);
  for (const m of fields.matchAll(/t\('((?:Auto elige|Con la hora y el tiempo)[^']+)'\)/g)) assert.ok(dict.includes(`'${m[1]}'`), `no row for "${m[1]}"`);
  assert.match(read('web/shared/types.ts'), /plannerBar\?: PlannerBar;/);
});

test('Modern: the today circle stays inside the number row, so the top of the week row never cuts it', () => {
  const css = read('web/display/styles-modern.css');
  // centred on the number's line, at most 1.72em, smaller where the number row is low
  assert.match(css, /\.style-modern \.num \{\s*--num-pt: 1\.2rem;\s*padding: var\(--num-pt\) 1\.2rem 0;/);
  assert.match(css, /--dot: min\(1\.72em, calc\(2 \* \(var\(--num-pt\) \+ 0\.5em - 0\.25rem\)\), calc\(2 \* \(var\(--num-h\) - var\(--num-pt\) - 0\.5em - 0\.25rem\)\)\);/);
  assert.match(css, /margin: calc\(\(1em - var\(--dot\)\) \/ 2\) 0 calc\(\(1em - var\(--dot\)\) \/ 2\) -0\.3em;/);
  // the top / bottom frame (the planner strip, the planner on portrait screens, Top / Bottom): room for the circle
  assert.match(css, /\.style-modern \.preset-topBottom \.cal \{ --num-h: 4\.2rem; \}/);
  assert.match(css, /\.style-modern \.preset-topBottom \.num \{ --num-pt: 0\.9rem; padding-top: var\(--num-pt\); font-size: 2\.4rem; \}/);
  assert.doesNotMatch(css, /margin: -0\.36em 0 -0\.36em -0\.3em/);
});
