// Golden HTML of the display widgets (Clock, MonthCalendar, Agenda, Weather, News, Countdowns, Highlights, the Today
// and Per person views, the kids layouts), rendered from the demo data with a frozen clock. scripts/golden.mjs writes
// the fixtures (server/test/fixtures/golden/*.html); display-golden.test.js renders them again and compares byte for byte, so a
// refactor of the widgets (the per-instance cfg() getter of the canvas builder) is proven to change nothing.
import { launchChrome, startWeb } from './browser.js';

/** A fixed past moment: the weather's "sunset or sunrise" choice compares with the real clock. */
const NOW = '2026-03-04T10:43';

/** name → query string (always on top of demo=1, the frozen clock, no photos and no animation). */
export const GOLDEN_CASES = {
  'modern-bigCalendar': 'preset=bigCalendar&style=modern',
  'classic-bigCalendar': 'preset=bigCalendar&style=classic',
  'modern-analog-light': 'preset=bigCalendar&style=modern&clock=analog&theme=light',
  'modern-agenda': 'preset=agenda&style=modern',
  'classic-agenda': 'preset=agenda&style=classic',
  'modern-leftRight': 'preset=leftRight&style=modern',
  'classic-week': 'preset=bigCalendar&style=classic&view=week',
  'modern-cards': 'preset=planner&style=modern&cards=1&weeks=auto',
  'modern-today': 'preset=today&style=modern',
  'modern-people': 'preset=people&style=modern',
  'modern-topBottom-es': 'preset=topBottom&style=modern&lang=es&h12=1',
  'classic-twoWeeks-pt': 'preset=twoWeeks&style=classic&lang=pt',
  // the kids layouts (their renderers are shared with the Personalizado family cards)
  'modern-kidsRoutines': 'preset=kidsRoutines&style=modern',
  'modern-kidsFamily': 'preset=kidsFamily&style=modern',
  'modern-kidsMeals-light': 'preset=kidsMeals&style=modern&theme=light',
  'modern-kidsFamily-private': 'preset=kidsFamily&style=modern&private=1',
  'modern-kidsRoutines-portrait': { q: 'preset=kidsRoutines&style=modern', width: 1080, height: 1920 },
  'modern-kidsMeals-portrait': { q: 'preset=kidsMeals&style=modern&members=6', width: 1080, height: 1920 },
};

export const GOLDEN_SELECTORS = ['#clock', '#calendar', '#agenda', '#side-agenda', '#weather', '#news', '#countdowns', '#cd-strip', '#message', '#todo', '#view', '#highlights', '#kids'];

const SNAP = `(async () => {
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 1500));
  const out = [];
  for (const sel of ${JSON.stringify(GOLDEN_SELECTORS)}) {
    const el = document.querySelector(sel);
    out.push('<!-- ' + sel + ' -->\\n' + (el ? el.outerHTML : ''));
  }
  return out.join('\\n');
})()`;

/** Render every case and return { name: html }. */
export async function renderGolden(cases = GOLDEN_CASES) {
  const web = await startWeb();
  const chrome = await launchChrome();
  try {
    const out = {};
    for (const [name, c] of Object.entries(cases)) {
      const { q, width = 1920, height = 1080 } = typeof c === 'string' ? { q: c } : c;
      const p = await chrome.page(`${web.url}/?demo=1&now=${NOW}&shot=1&lite=1&photos=0&${q}`, { width, height });
      try {
        // the news item's slide deadline is real time (Date.now), not the frozen clock
        out[name] = (await p.eval(SNAP)).replace(/data-mq-until="\d+"/g, 'data-mq-until="*"');
      } finally {
        await p.close();
      }
    }
    return out;
  } finally {
    await chrome.close();
    await web.close();
  }
}
