// Wall display entry point: wires config, data polling, SSE, the ticker, widgets and WebGL layers.
// Self-hosted fonts (bundled by Vite): the display must render with no Internet.
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '../shared/emoji-font.css';
import './styles.css';
import './styles-views.css';
import './styles-modern.css';
import type {
  Announcement, CountdownsResponse, DisplayConfig, EventsResponse, NewsResponse, NightCommand, StreamHello, WeatherResponse,
} from '../shared/types';
import { addDays, gridWeekStart, startOfWeek } from '../shared/i18n';
import { api, ApiError } from './api';
import { parseColor, toHex } from './color';
import { ctx, setCtxConfig } from './ctx';
import { normalizeConfig } from './defaults';
import { Heartbeat, noteError } from './heartbeat';
import { authHeaders, clearDeviceToken, clientId, credential, credentialKind, screenKey, storedDeviceToken, withScreen } from './identity';
import { $ } from './dom';
import { type NEvent, normalizeEvents } from './eventModel';
import type { AmbientLayer } from './gl/ambientLayer';
import type { Engine } from './gl/engine';
import type { PhotoLayer } from './gl/photoLayer';
import type { PrecipLayer } from './gl/precipLayer';
import type { WeatherFxLayer } from './gl/weatherFxLayer';
import { weatherFxOf } from './icons';
import { mockAnnouncements, mockConfig, mockCountdowns, mockEvents, mockNews, mockPhotos, mockWeather } from './mock';
import { loadCache, on, saveCache, set, state } from './store';
import { detectLiveMode, startConfigPoll, startPoll, type StreamHandlers } from './live';
import { connectStream, pollUrl } from './stream';
import { current, onTick, setClockOffset, setTimezone, startTicker, type Tick } from './time';
import { Agenda } from './widgets/agenda';
import { Announcements, IdentifyOverlay, ScheduleBanners, setServerNow } from './widgets/alerts';
import { Countdowns } from './widgets/countdowns';
import { DoorbellOverlay, type FrameSource } from './widgets/doorbell';
import { mockDoorbellFrame, mockDoorbellRing } from './mockDoorbell';
import { MonthCalendar } from './widgets/calendar';
import { Clock } from './widgets/clock';
import { renderMessage, renderTodo } from './widgets/extras';
import { Highlights } from './widgets/highlights';
import { News } from './widgets/news';
import { Photos, photoStats } from './widgets/photos';
import { glassVars, normalizeGlass } from '../shared/glass';
import { Weather } from './widgets/weather';
import { VIEW_PRESETS, Views } from './widgets/views';
import { checkSetup, showWelcome, waitForSetup } from './widgets/welcome';
import { afterPairUrl, pairHealth, pairingLang, showPairing } from './widgets/pairing';
import { healthOnce, loadEmojiWebFont } from './health';
import { refreshMarquee } from './marquee';

const params = ctx.params;
const forceDemo = params.get('demo') === '1';
const lite = ctx.lite;
if (lite) document.documentElement.classList.add('lite');

// ?now=2026-10-09T10:43 → fixed clock offset (for screenshots / testing)
const nowParam = params.get('now');
if (nowParam) {
  const target = Date.parse(nowParam);
  if (Number.isFinite(target)) setClockOffset(target - Date.now());
}

// ---------------------------------------------------------------------------------------------
// DOM + widgets
// ---------------------------------------------------------------------------------------------
const app = $('#app');
const photoArea = $('.photo-area');
const sideEl = $('.side');
const mainEl = $('.main');
const clock = new Clock($('#clock'));
const highlights = new Highlights($('#highlights'));
const weather = new Weather($('#weather'));
const calendar = new MonthCalendar($('#calendar'));
const agenda = new Agenda($('#agenda'), { days: 14 });
const sideAgenda = new Agenda($('#side-agenda'), { days: 3, compact: true, maxPerDay: 4 });
const news = new News($('#news'));
const photos = new Photos(photoArea, $('.photo-meta'));
const countdowns = new Countdowns($('#countdowns'), $('#cd-strip'));
const schedules = new ScheduleBanners($('#sched'), $('#sched-strip'));
const announcements = new Announcements($('#alerts'));
const identify = new IdentifyOverlay($('#identify'));
/** Doorbell frames: GET /api/display/doorbell/frame (a counter keeps every answer fresh), drawn ones in the demo.
 *  404 and lost access mean there is nothing more to show for this ring. */
const doorbellFrames: FrameSource = async (n, signal) => {
  if (state.demo) return mockDoorbellFrame(n);
  const r = await fetch(withScreen(`/api/display/doorbell/frame?n=${n}`), { headers: authHeaders(), cache: 'no-store', signal });
  if (r.status === 404 || r.status === 401 || r.status === 403) return null;
  if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) throw new Error(`frame: HTTP ${r.status}`);
  return r.blob();
};
const doorbell = new DoorbellOverlay($('#doorbell'), doorbellFrames);
const views = new Views($('#view'));
const screenNote = $('#screen-note');
const statusDot = $('#status');
const night = $('#night');
let customStyle: HTMLStyleElement | null = null;

let nEvents: NEvent[] = [];
let nEventsKey = '';

// ---------------------------------------------------------------------------------------------
// WebGL (optional, never fatal)
// ---------------------------------------------------------------------------------------------
let engine: Engine | null = null;
let photoLayer: PhotoLayer | null = null;
let ambient: AmbientLayer | null = null;
let precip: PrecipLayer | null = null;
let wxfx: WeatherFxLayer | null = null;

let glLoading: Promise<void> | null = null;
/** three.js is loaded lazily so ?lite=1 / no-WebGL screens never download or parse it. */
function initGL(): Promise<void> {
  if (engine || lite) return Promise.resolve();
  if (glLoading) return glLoading;
  glLoading = (async () => {
  try {
    const [{ Engine }, { PhotoLayer }, { PrecipLayer }, { AmbientLayer }, { WeatherFxLayer }] = await Promise.all([
      import('./gl/engine'), import('./gl/photoLayer'), import('./gl/precipLayer'), import('./gl/ambientLayer'), import('./gl/weatherFxLayer'),
    ]);
    engine = Engine.create($('#gl') as HTMLCanvasElement);
    if (!engine) throw new Error('no webgl2');
    photoLayer = new PhotoLayer(() => photoArea);
    precip = new PrecipLayer(() => photoArea);
    wxfx = new WeatherFxLayer(() => photoArea);
    wxfx.night = nightNow;
    ambient = new AmbientLayer(() => mainEl);
    engine.add(ambient);
    engine.add(photoLayer);
    engine.add(precip);
    engine.add(wxfx);
    engine.onLost = () => {
      disableGL();
      scheduleGLRetry();
    };
    photos.setGL(photoLayer);
    document.documentElement.classList.add('gl');
    engine.start();
  } catch (e) {
    console.warn('[gl] disabled', e);
    disableGL();
  }
  })();
  return glLoading;
}

// Context loss / frame failure after long uptime: retry with backoff on a fresh canvas instead of staying
// in DOM-only mode until a manual reload.
let glRetries = 0;
let glRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleGLRetry(): void {
  if (glRetryTimer || glRetries >= 6) return;
  const delay = Math.min(30_000 * 2 ** glRetries, 30 * 60_000);
  glRetries++;
  glRetryTimer = setTimeout(() => {
    glRetryTimer = null;
    const old = document.getElementById('gl');
    if (old) old.replaceWith(old.cloneNode(false)); // a lost context stays bound to its canvas
    glLoading = null;
    glFailed = false;
    if (state.config) applyConfig(state.config);
  }, delay);
}

function disableGL(): void {
  try {
    engine?.dispose();
  } catch { /* ignore */ }
  engine = null;
  photoLayer = null;
  ambient = null;
  precip = null;
  wxfx = null;
  document.documentElement.classList.remove('gl', 'gl-ambient');
  photos.setGL(null);
  photos.applyConfig();
}

// ---------------------------------------------------------------------------------------------
// Config application
// ---------------------------------------------------------------------------------------------
function hueShift(hex: string, deg: number): string {
  const [r, g, b] = parseColor(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]);
}

const PRESETS = ['bigCalendar', 'leftRight', 'topBottom', 'bigTime', 'agenda', 'today', 'people', 'photoFrame', 'twoWeeks', 'board', 'bedside'];
/** Newer layouts built on an older one's frame: they also get its class, so its rules (and the Modern ones) apply. */
const PRESET_BASE: Record<string, string> = { today: 'bigCalendar', twoWeeks: 'bigCalendar', people: 'topBottom', board: 'topBottom' };

function effectivePreset(cfg: DisplayConfig): string {
  const p = params.get('preset') || cfg.layout.preset;
  return PRESETS.includes(p) ? p : 'bigCalendar';
}

function isPortrait(cfg: DisplayConfig): boolean {
  const o = cfg.screen.orientation;
  if (o === 'portrait') return true;
  if (o === 'landscape') return false;
  return window.innerHeight > window.innerWidth * 1.05;
}

function applyLayout(): void {
  const cfg = ctx.cfg;
  const preset = effectivePreset(cfg);
  const portrait = isPortrait(cfg);
  const side = params.get('side') || cfg.layout.sidePanel;
  const corner = params.get('corner') || cfg.layout.corner || 'br';
  app.className = [
    `preset-${preset}`, `side-${side === 'right' ? 'right' : 'left'}`, portrait ? 'portrait' : 'landscape',
    cfg.background.enabled ? 'has-photo' : 'no-photo',
    PRESET_BASE[preset] ? `preset-${PRESET_BASE[preset]}` : '',
    preset === 'photoFrame' ? `corner-${['tl', 'tr', 'bl', 'br'].includes(corner) ? corner : 'br'}` : '',
  ].filter(Boolean).join(' ');
  app.classList.toggle('has-view', VIEW_PRESETS.includes(preset));
  views.setPreset(preset);
  const view = params.get('view') || cfg.calendar.view;
  const showAgendaMain = preset === 'agenda' || view === 'agenda';
  app.classList.toggle('view-agenda', showAgendaMain);
  app.classList.toggle('cal-off', !cfg.calendar.enabled);
  engine?.invalidate();
}

/**
 * Modern style glass: settings + current photo → a few custom properties on <html> (no extra layers).
 * Re-run on every new photo, since Auto and "from the photo" depend on it.
 */
const GLASS_VARS = ['--g-rgb', '--g-solid', '--g-a', '--g-a-wx', '--g-filter', '--g-sheet-rgb', '--g-sheet-a', '--g-sheet-filter', '--g-edge'];
function applyGlass(): void {
  const cfg = ctx.cfg;
  const root = document.documentElement;
  if (cfg.screen.style !== 'modern') {
    for (const k of GLASS_VARS) root.style.removeProperty(k);
    root.classList.remove('glass-ink-dark', 'glass-no-edge', 'glass-thin');
    return;
  }
  const g = glassVars(cfg.screen.glass, cfg.background.enabled ? photoStats : null, { lite, hasPhoto: cfg.background.enabled });
  for (const [k, v] of Object.entries(g.vars)) root.style.setProperty(k, v);
  root.classList.toggle('glass-ink-dark', g.inkDark);
  root.classList.toggle('glass-no-edge', !g.edge);
  root.classList.toggle('glass-thin', g.thin);
}
window.addEventListener('marco:photo-tone', () => applyGlass());

function applyConfig(raw: DisplayConfig): void {
  const cfg = normalizeConfig(raw);
  const v = params.get('view');
  if (v === 'month' || v === 'agenda' || v === 'week') cfg.calendar.view = v;
  // URL overrides (handy for testing a screen without touching the saved config)
  const pc = params.get('clock');
  if (pc === 'analog' || pc === 'digital') cfg.datetime.clock = pc;
  const pt = params.get('theme');
  if (pt === 'light' || pt === 'dark') cfg.screen.theme = pt;
  const ps = params.get('style');
  if (ps === 'classic' || ps === 'modern') cfg.screen.style = ps;
  // glass previews: ?glass=clear|tinted|auto &glassOpacity=0..1 &glassBlur=0..40 &glassTint=dark|light|photo &glassEdge=0|1
  const gq = (k: string) => params.get(k);
  if (gq('glass') || gq('glassOpacity') || gq('glassBlur') || gq('glassTint') || gq('glassEdge')) {
    const g = { ...cfg.screen.glass } as Record<string, unknown>;
    if (gq('glass')) g.appearance = gq('glass');
    if (gq('glassOpacity')) g.opacity = gq('glassOpacity');
    if (gq('glassBlur')) g.blur = gq('glassBlur');
    if (gq('glassTint')) g.tint = gq('glassTint');
    if (gq('glassEdge')) g.edge = gq('glassEdge') !== '0';
    cfg.screen.glass = normalizeGlass(g);
  }
  // ?marquee=0|1 (titles that slide) and ?rotate=0|1 (busy days that page through their events)
  const pm = params.get('marquee');
  if (pm === '0' || pm === '1') cfg.calendar.marquee = pm === '1';
  const pr = params.get('rotate');
  if (pr === '0' || pr === '1') cfg.calendar.rotateBusyDays = pr === '1';
  // ?compact=0|1 (busy days as small one-line entries, rows sized by their events) and ?weeks=1..8
  const pcp = params.get('compact');
  if (pcp === '0' || pcp === '1') cfg.calendar.compactBusyDays = pcp === '1';
  // ?startToday=0|1 (the grid starts on today instead of the first day of the week)
  const pst = params.get('startToday');
  if (pst === '0' || pst === '1') cfg.calendar.startToday = pst === '1';
  // ?calfs=0.4..1.5 (size of the grid entries, relative to the screen's text size)
  const pcs = Number(params.get('calfs'));
  if (params.get('calfs') && pcs >= 0.4 && pcs <= 1.5) cfg.calendar.fontScale = pcs;
  const pw = Number(params.get('weeks'));
  if (Number.isInteger(pw) && pw >= 1 && pw <= 8) cfg.calendar.weeks = pw;
  const pa = params.get('ambient');
  if (pa === 'aurora' || pa === 'particles' || pa === 'none') cfg.background.ambient = pa;
  const ptr = params.get('transition');
  if (ptr === 'webgl' || ptr === 'fade' || ptr === 'none') cfg.background.transition = ptr;
  const pfx = params.get('wxfx');
  if (pfx === 'off' || pfx === 'simple' || pfx === 'rich') cfg.background.weatherFx = pfx;
  // the top-bottom preset has a shorter calendar: cap the number of week rows so chips stay readable
  if (effectivePreset(cfg) === 'topBottom') cfg.calendar.weeks = Math.min(cfg.calendar.weeks, 4);
  // Two weeks: the month grid with two roomy rows (more events per day)
  if (effectivePreset(cfg) === 'twoWeeks') {
    cfg.calendar.view = 'month';
    cfg.calendar.weeks = 2;
    cfg.calendar.maxEventsPerDay = Math.max(cfg.calendar.maxEventsPerDay, 8);
  }
  // Bedside: a dark room, no photo and no animated background
  if (effectivePreset(cfg) === 'bedside') {
    cfg.background.enabled = false;
    cfg.background.ambient = 'none';
  }
  // Small landscape screens (e.g. 1280×720 on the Pi): one week fewer so text can be bigger.
  if (window.innerWidth > window.innerHeight && window.innerHeight <= 820 && effectivePreset(cfg) !== 'twoWeeks') cfg.calendar.weeks = Math.min(cfg.calendar.weeks, 4);
  setCtxConfig(cfg);
  setTimezone(ctx.tz);
  const root = document.documentElement;
  root.lang = ctx.lang;
  const accent = cfg.screen.accent;
  const light = cfg.screen.theme === 'light';
  root.classList.toggle('theme-light', light);
  // Display style (independent of the layout): 'modern' scopes every rule in styles-modern.css; classic adds nothing.
  root.classList.toggle('style-modern', cfg.screen.style === 'modern');
  applyGlass();
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-rgb', parseColor(accent).join(' '));
  root.style.setProperty('--fs', String(cfg.screen.fontScale));
  root.style.setProperty('--panel-blur', String(cfg.background.panelBlur ?? 18));
  root.style.setProperty('--panel-shade', String((cfg.background.panelShade ?? 0.5) * 2));
  root.style.setProperty('--side-w', `${(cfg.layout.sideWidth * 100).toFixed(2)}%`);

  if (cfg.screen.customCss) {
    if (!customStyle) {
      customStyle = document.createElement('style');
      customStyle.id = 'custom-css';
      document.head.appendChild(customStyle);
    }
    if (customStyle.textContent !== cfg.screen.customCss) customStyle.textContent = cfg.screen.customCss;
  } else if (customStyle) customStyle.textContent = '';

  applyLayout();

  // WebGL needs
  const preset = effectivePreset(cfg);
  const wantAmbient = !lite && cfg.background.ambient !== 'none' && ['bigCalendar', 'agenda', 'topBottom', 'today', 'twoWeeks', 'people'].includes(preset);
  const wantGLPhoto = !lite && cfg.background.enabled && cfg.background.transition === 'webgl';
  if ((wantAmbient || wantGLPhoto) && !engine && !glFailed) {
    void initGL().then(() => {
      if (engine) applyGL(wantAmbient, accent, light);
      else glFailed = true;
      photos.applyConfig();
      renderWeather(current());
    });
  }
  applyGL(wantAmbient, accent, light);
  photos.applyConfig();

  announcements.applyConfig(cfg);
  renderScreenNote(raw);
  renderAll();
  revealApp(cfg);
}

/**
 * First paint: with the Modern style over a photo, wait for the photo (or 1.8 s at most) before fading the screen
 * in, so the glass cards appear already blurring the photo instead of a black background that changes a second later.
 */
let revealArmed = false;
function revealApp(cfg: DisplayConfig): void {
  if (!app.classList.contains('booting') || revealArmed) return;
  const waitPhoto = cfg.screen.style === 'modern' && cfg.background.enabled && !lite;
  if (!waitPhoto) return void app.classList.remove('booting');
  revealArmed = true;
  const show = () => app.classList.remove('booting');
  window.addEventListener('marco:photo-tone', show, { once: true });
  setTimeout(show, 1800);
}

/** Small unobtrusive notice when ?screen= did not match any screen (the default one is shown instead). */
function renderScreenNote(raw: DisplayConfig): void {
  const show = !!raw.screenFallback && !!screenKey && !state.demo;
  screenNote.textContent = show ? ctx.t('screenNotFound', { s: screenKey }) : '';
  screenNote.classList.toggle('show', show);
}

let glFailed = false;
function applyGL(wantAmbient: boolean, accent: string, light: boolean): void {
  const cfg = ctx.cfg;
  const root = document.documentElement;
  if (engine) {
    const bg = light ? (cfg.screen.style === 'modern' ? '#f2f2f7' : '#f4f2ee') : '#000000';
    engine.setClearColor(bg);
    if (ambient) {
      ambient.mode = wantAmbient ? cfg.background.ambient : 'none';
      ambient.setColors(accent, hueShift(accent, 165), bg, light);
    }
    root.classList.toggle('gl-ambient', wantAmbient);
    const fx = cfg.background.weatherFx ?? 'simple';
    if (precip) precip.enabled = cfg.background.enabled && fx === 'simple';
    // the drops refract the GL photo, so only with the WebGL transition (a DOM photo would cover the canvas)
    if (wxfx) wxfx.enabled = cfg.background.enabled && fx === 'rich' && cfg.background.transition === 'webgl';
  }
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
function eventsNormalized(): NEvent[] {
  const ev = state.events;
  const key = `${ev?.hash}|${ev?.generatedAt}|${ctx.tz}`;
  if (key !== nEventsKey) {
    nEventsKey = key;
    nEvents = normalizeEvents(ev?.events ?? [], ctx.tz);
  }
  return nEvents;
}

function renderCalendar(tick: Tick): void {
  const evs = eventsNormalized();
  const cfg = ctx.cfg;
  const preset = effectivePreset(cfg);
  renderView(tick);
  if (!cfg.calendar.enabled) return;
  // layouts with their own view (today, people, …) do not show the month grid / agenda
  if (VIEW_PRESETS.includes(preset)) {
    if (preset === 'today') highlights.render(evs, tick);
    return;
  }
  if (app.classList.contains('view-agenda')) agenda.render(evs, tick);
  else {
    calendar.roomy = preset === 'twoWeeks';
    calendar.render(evs, tick);
  }
  if (preset === 'leftRight' || preset === 'bigTime') sideAgenda.render(evs, tick);
  highlights.render(evs, tick);
  refreshMarquee();
}

/** Content of the layouts with their own view (no-op for the others). */
function renderView(tick: Tick): void {
  views.render({ events: ctx.cfg.calendar.enabled ? eventsNormalized() : [], weather: state.weather, countdowns: state.countdowns }, tick);
}

function renderCountdowns(tick: Tick): void {
  // birthdays already shown today as a highlight pill are not repeated as a "¡Hoy!" countdown chip
  const today = tick.dayKey;
  const shown = new Set(
    eventsNormalized()
      .filter((e) => e.allDay && e.ev.kind === 'birthdays' && e.startKey <= today && e.lastKey >= today)
      .map((e) => e.title),
  );
  countdowns.render(state.countdowns, today, shown);
  if (effectivePreset(ctx.cfg) === 'board') renderView(tick);
}

function renderWeather(tick: Tick): void {
  weather.render(state.weather, tick.dayKey);
  const p = effectivePreset(ctx.cfg);
  if (p === 'photoFrame' || p === 'bedside') renderView(tick);
  const cur = ctx.cfg.weather.enabled ? state.weather?.current : undefined;
  const plan = cur ? weatherFxOf(cur.code, cur.isDay) : { mode: null, level: 0, storm: false };
  if (precip) {
    precip.mode = plan.mode === 'rain' || plan.mode === 'snow' ? plan.mode : null;
    precip.level = plan.level;
  }
  if (wxfx) wxfx.set(plan.mode, plan.level, plan.storm);
}

function renderAll(): void {
  const tick = current();
  clock.update(tick);
  renderCalendar(tick);
  renderWeather(tick);
  news.setData(state.news);
  renderMessage($('#message'));
  renderTodo($('#todo'));
  renderCountdowns(tick);
  schedules.render(tick);
  updateNight(tick);
  fitSide();
}

/**
 * Progressively drop secondary side-panel content until everything fits without clipping:
 * hourly strip → countdown chips one by one (keeps the nearest) → extra pills / done to-dos → whole mid area.
 */
const FIT_STEPS = ['fit-1', 'fit-2', 'fit-3'];
function fitSide(): void {
  fitSideContent();
  fitMidRows();
  views.fit();
  photos.reframe(); // what's left uncovered of the photo may have changed
  refreshMarquee(); // titles are measured once everything that does not fit is gone
}
function fitSideContent(): void {
  const mid = sideEl.querySelector('.side-mid') as HTMLElement;
  const cdChips = Array.from(document.querySelectorAll<HTMLElement>('#countdowns > .cd'));
  const overflowing = () => {
    const midHasContent = Array.from(mid.children).some((c) => (c as HTMLElement).style.display !== 'none' && (c as HTMLElement).offsetHeight > 0);
    // bigTime fades its mid column out with a mask: overflowing there is by design (agenda simply fades out)
    const midMasked = app.classList.contains('preset-bigTime');
    return sideEl.scrollHeight > sideEl.clientHeight + 2 || (!midMasked && midHasContent && mid.scrollHeight > mid.clientHeight + 2);
  };
  app.classList.remove(...FIT_STEPS);
  for (const c of cdChips) c.classList.remove('fit-hide');
  fitStrip();
  if (!overflowing()) return;
  // Today: the forecast for the next hours matters more than the countdowns
  if (app.classList.contains('preset-today')) {
    for (let i = cdChips.length - 1; i >= 0 && overflowing(); i--) cdChips[i].classList.add('fit-hide');
    if (!overflowing()) return;
  }
  app.classList.add('fit-1');
  for (let i = cdChips.length - 1; i >= 1 && overflowing(); i--) cdChips[i].classList.add('fit-hide');
  if (!overflowing()) return;
  for (const step of FIT_STEPS.slice(1)) {
    app.classList.add(step);
    if (!overflowing()) break;
  }
}

/**
 * Modern big time (landscape; portrait shows a chip strip): no fade-out mask, so the side agenda shows whole rows only. Drop rows from the end (and days
 * left empty), then countdowns, until the mid column fits. Classic keeps its masked fade and is not touched.
 */
function fitMidRows(): void {
  const mid = sideEl.querySelector('.side-mid') as HTMLElement;
  const rows = Array.from(document.querySelectorAll<HTMLElement>('#side-agenda .ag-ev, #side-agenda .ag-more, #side-agenda .ag-day'));
  for (const r of rows) r.classList.remove('fit-hide');
  const agendaEl = document.getElementById('side-agenda');
  agendaEl?.classList.remove('fit-hide');
  if (!document.documentElement.classList.contains('style-modern') || !app.classList.contains('preset-bigTime') || app.classList.contains('portrait') || !mid) return;
  const over = () => mid.scrollHeight > mid.clientHeight + 1;
  if (!over()) return;
  const days = Array.from(document.querySelectorAll<HTMLElement>('#side-agenda .ag-day')).reverse();
  for (const day of days) {
    const items = Array.from(day.querySelectorAll<HTMLElement>('.ag-ev, .ag-more')).reverse();
    for (const it of items) {
      it.classList.add('fit-hide');
      if (!over()) break;
    }
    // a day header with no rows left goes too
    if (!day.querySelector('.ag-ev:not(.fit-hide)')) day.classList.add('fit-hide');
    if (!over()) return;
  }
  agendaEl?.classList.add('fit-hide');
  if (!over()) return;
  // still too tall (message, to-do and banners take the room): countdowns from the furthest one
  const cds = Array.from(document.querySelectorAll<HTMLElement>('#countdowns > .cd:not(.fit-hide)')).reverse();
  for (const c of cds) {
    c.classList.add('fit-hide');
    if (!over()) return;
  }
}

/** One-line strip of scheduled banners + countdown chips (topBottom): drop what does not fit entirely. */
function fitStrip(): void {
  const strip = document.querySelector('.main-strip') as HTMLElement | null;
  if (!strip || !strip.offsetWidth) return;
  const chips = Array.from(strip.querySelectorAll<HTMLElement>('.sched, .cd'));
  for (const c of chips) c.classList.remove('fit-hide');
  const maxRight = strip.getBoundingClientRect().right + 1;
  let hide = false;
  for (const c of chips) {
    if (!hide && c.getBoundingClientRect().right > maxRight) hide = true;
    if (hide) c.classList.add('fit-hide');
  }
}

function hmToMin(s: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
  return m ? +m[1] * 60 + +m[2] : -1;
}

// Night command (§5.6): 'on'/'off' override the automatic state until it next changes by itself (or 'auto').
let nightOverride: NightCommand = 'auto';
let overrideBase: boolean | null = null;
let nightNow = false;

function autoNight(tick: Tick): boolean {
  const nm = ctx.cfg.screen.nightMode;
  let on = false;
  if (nm.enabled) {
    const f = hmToMin(nm.from), t = hmToMin(nm.to);
    const n = tick.parts.hour * 60 + tick.parts.minute;
    if (f >= 0 && t >= 0 && f !== t) on = f < t ? n >= f && n < t : n >= f || n < t;
  }
  if (params.get('night') === '1') on = true;
  return on;
}

function setNightCommand(mode: NightCommand): void {
  nightOverride = mode;
  overrideBase = mode === 'auto' ? null : autoNight(current());
  updateNight(current());
}

function updateNight(tick: Tick): void {
  const nm = ctx.cfg.screen.nightMode;
  const auto = autoNight(tick);
  if (nightOverride !== 'auto' && overrideBase !== null && auto !== overrideBase) {
    nightOverride = 'auto'; // the schedule moved on: hand control back to it
    overrideBase = null;
    heartbeat.soon();
  }
  const on = nightOverride === 'on' ? true : nightOverride === 'off' ? false : auto;
  nightNow = on;
  const dim = Number.isFinite(nm.dim) ? nm.dim : 0.35;
  night.style.opacity = on ? String(Math.min(0.95, Math.max(0, 1 - dim))) : '0';
  document.documentElement.classList.toggle('night', on);
  if (engine) engine.fps = on ? 15 : 30;
  if (wxfx) wxfx.night = on;
}

function setOnline(ok: boolean): void {
  set('online', ok);
  statusDot.classList.toggle('show', !ok && !state.demo);
}

// ---------------------------------------------------------------------------------------------
// Display access (private links / paired devices): 401 → pairing screen, 403 → "link no longer valid"
// ---------------------------------------------------------------------------------------------
let accessDenied = false;
let liveStream: { close(): void; tick?(): Promise<void> } | null = null;

/** Stop everything, forget cached data and show the pairing / invalid-link screen (no family data). */
function denyAccess(status: number): void {
  if (accessDenied || state.demo) return;
  accessDenied = true;
  // A dead private link (kiosk URL) but this browser was paired since: use the device token instead.
  // Marco Cloud continues at /pair, where "/" is not the display (pairing.ts afterPairUrl).
  if (status === 403 && credentialKind === 'key' && storedDeviceToken()) {
    void pairHealth().then((h) => location.replace(afterPairUrl(h)));
    return;
  }
  if (status === 403 && credentialKind === 'device') clearDeviceToken();
  intervals.forEach(clearInterval);
  intervals.length = 0;
  liveStream?.close();
  heartbeat.stop();
  // keep the language the screen was showing; the browser's language may differ
  const deniedLang = state.config ? ctx.lang : pairingLang(params);
  for (const k of ['config', 'events', 'weather', 'news', 'photos', 'countdowns'] as const) state[k] = null;
  showPairing(status === 403 ? 'invalid' : 'pair', deniedLang);
}

/** True (and the access screen shown) when `e` is a 401 / 403 from the display API. */
function deniedBy(e: unknown): boolean {
  if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
    denyAccess(e.status);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------
function eventsRange(): [string, string] {
  const today = current().dayKey;
  const cal = ctx.cfg.calendar;
  const from = startOfWeek(today, gridWeekStart(today, cal.weekStart, cal.startToday === true));
  const to = addDays(from, Math.max(ctx.cfg.calendar.weeks * 7, 21) + 1);
  return [from, to];
}

async function fetchEvents(): Promise<void> {
  if (state.demo) {
    const m = mockEvents(current().now);
    if (state.events?.hash !== m.hash) set('events', m);
    return;
  }
  try {
    const [from, to] = eventsRange();
    const r = await api.events(from, to);
    setOnline(true);
    if (r.errors?.length) console.warn('[events] source errors', r.errors);
    if (!state.events || state.events.hash !== r.hash) {
      set('events', r);
      saveCache('events', r);
    }
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[events]', (e as Error).message);
    setOnline(false);
  }
}

async function fetchWeather(): Promise<void> {
  if (state.demo) {
    const w = mockWeather(current().now, params.get('wx'));
    return set('weather', w);
  }
  try {
    const r = await api.weather();
    set('weather', r);
    saveCache('weather', r);
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[weather]', (e as Error).message);
  }
}

async function fetchNews(): Promise<void> {
  if (state.demo) return set('news', mockNews());
  try {
    const r = await api.news();
    set('news', r);
    saveCache('news', r);
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[news]', (e as Error).message);
  }
}

async function fetchPhotos(): Promise<void> {
  if (state.demo) return set('photos', mockPhotos());
  try {
    set('photos', await api.photos(20, photos.lastGalleryFile));
  } catch (e) {
    if (deniedBy(e)) return;
    console.warn('[photos]', (e as Error).message);
    if (!state.photos) set('photos', mockPhotos());
  }
}

async function fetchCountdowns(): Promise<void> {
  if (state.demo) return set('countdowns', mockCountdowns(current().now));
  try {
    const r = await api.countdowns();
    if (!state.countdowns || state.countdowns.hash !== r.hash || state.countdowns.today !== r.today) {
      set('countdowns', r);
      saveCache('countdowns', r);
    }
  } catch (e) {
    if (deniedBy(e)) return;
    // older server without /api/countdowns (404) or offline: keep what we have
    console.warn('[countdowns]', (e as Error).message);
  }
}

async function fetchConfig(): Promise<boolean> {
  try {
    const c = await api.config();
    setOnline(true);
    saveCache('config', c);
    set('config', c);
    return true;
  } catch (e) {
    if (deniedBy(e)) return false;
    console.warn('[config]', (e as Error).message);
    setOnline(false);
    return false;
  }
}

let photoSig = '';
let privateSig = '';
on('config', (s) => {
  if (!s.config) return;
  applyConfig(s.config);
  const priv = s.config.privacy;
  const privSig = priv?.active ? 'on' : 'off';
  const privChanged = privateSig !== '' && privSig !== privateSig;
  privateSig = privSig;
  applyPrivacy(priv);
  // photo source changed in the admin → fetch a fresh list right away; privacy mode with "hide photos" also
  // replaces the photo on screen at once
  const b = ctx.cfg.background;
  const sig = `${b.enabled}|${b.source}|${b.stockTopic}|${b.order ?? 'random'}`;
  if (photoSig && sig !== photoSig) void fetchPhotos().then(() => (privChanged ? photos.next() : undefined));
  photoSig = sig;
});

// ---------------------------------------------------------------------------------------------
// Privacy mode: the server already filtered the events; the display shows a small lock and asks again when the
// period ends (or a schedule rule starts) in case the live event is missed (offline, poll delay).
// ---------------------------------------------------------------------------------------------
const privacyLock = $('#privacy-lock');
let privacyTimer: ReturnType<typeof setTimeout> | null = null;
function applyPrivacy(p: DisplayConfig['privacy']): void {
  const on = !!p?.active;
  document.documentElement.classList.toggle('is-private', on);
  privacyLock.classList.toggle('show', on && p?.lock !== false);
  privacyLock.title = on ? ctx.t('privateMode') : '';
  if (privacyTimer) clearTimeout(privacyTimer);
  privacyTimer = null;
  if (state.demo) return;
  const at = [p?.next, on ? p?.until : null].map((x) => (x ? Date.parse(x) : NaN)).filter((x) => Number.isFinite(x));
  if (!at.length) return;
  // a few seconds after the boundary, at most a day ahead (setTimeout limits, clock changes)
  const ms = Math.min(Math.max(Math.min(...at) - Date.now() + 3000, 3000), 24 * 3600_000);
  privacyTimer = setTimeout(() => refreshForPrivacy(), ms);
}
function refreshForPrivacy(): void {
  void fetchConfig().then((ok) => (ok ? Promise.all([fetchEvents(), fetchCountdowns()]) : undefined));
}
on('events', () => {
  renderCalendar(current());
  renderCountdowns(current());
  fitSide();
});
on('weather', () => {
  renderWeather(current());
  fitSide();
});
on('news', (s) => news.setData(s.news));
on('countdowns', () => {
  renderCountdowns(current());
  fitSide();
});
on('photos', (s) => s.photos && photos.setList(s.photos.photos || []));
photos.onExhausted = () => fetchPhotos();

// ---------------------------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------------------------
const intervals: ReturnType<typeof setInterval>[] = [];
function startPolling(): void {
  intervals.forEach(clearInterval);
  intervals.length = 0;
  intervals.push(setInterval(fetchEvents, 60_000));
  intervals.push(setInterval(fetchWeather, 10 * 60_000));
  intervals.push(setInterval(fetchNews, 15 * 60_000));
  intervals.push(setInterval(fetchPhotos, 60 * 60_000));
  intervals.push(setInterval(fetchCountdowns, 30 * 60_000));
}

onTick((tick) => {
  clock.update(tick);
  views.tick(tick);
  if (tick.minuteChanged) {
    renderCalendar(tick);
    renderWeather(tick);
    renderCountdowns(tick);
    schedules.render(tick);
    updateNight(tick);
    fitSide();
  }
  if (tick.dayChanged) {
    void fetchEvents();
    void fetchWeather();
    void fetchCountdowns();
    renderAll();
  }
});

// Chip line-wrapping measures text on a canvas: re-plan once the bundled fonts are really available.
try {
  void document.fonts?.ready.then(() => {
    if (state.config) {
      renderCalendar(current());
      fitSide();
    }
  });
} catch { /* old browser */ }

// Re-layout the grid when the calendar's available height changes (news appearing, fonts loading, …)
let lastWeeksH = 0;
let roT: ReturnType<typeof setTimeout> | null = null;
try {
  const weeksEl = document.querySelector('#calendar .cal-weeks');
  if (weeksEl && 'ResizeObserver' in window) {
    new ResizeObserver((entries) => {
      const h = Math.round(entries[0].contentRect.height);
      if (Math.abs(h - lastWeeksH) < 2) return;
      lastWeeksH = h;
      if (roT) clearTimeout(roT);
      roT = setTimeout(() => renderCalendar(current()), 60);
    }).observe(weeksEl);
  }
} catch { /* ignore */ }

let resizeT: ReturnType<typeof setTimeout> | null = null;
window.addEventListener('resize', () => {
  if (resizeT) clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    applyLayout();
    renderAll();
    photos.reframe();
  }, 150);
});

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
function enterDemo(): void {
  state.demo = true;
  statusDot.classList.remove('show');
  set('config', mockConfig());
  void fetchEvents();
  void fetchWeather();
  void fetchNews();
  void fetchPhotos();
  void fetchCountdowns();
  // ?demo=1&announce=1|info|success|warning|urgent|all → sample announcements; &identify=1 → identify overlay
  const an = params.get('announce');
  if (an) setTimeout(() => mockAnnouncements(an).forEach((a: Announcement) => announcements.show(a)), 900);
  if (params.get('identify') === '1') {
    setTimeout(() => identify.show({ durationSec: 600 }, { name: ctx.cfg.screen.name, slug: ctx.cfg.slug || 'living-room', clientId }), 900);
  }
  // &doorbell=1 → doorbell ring with a drawn camera picture; &doorbell=nocam → a ring without a picture
  const db = params.get('doorbell');
  if (db) setTimeout(() => doorbell.show(mockDoorbellRing(db)), 900);
}

async function boot(): Promise<void> {
  startTicker();
  void healthOnce().then((h) => loadEmojiWebFont(h));
  // ?demo=1&pair=1|invalid (&pairLen=6|8) → preview of the pairing / invalid-link screen with a sample code
  const demoPair = forceDemo ? params.get('pair') : null;
  if (demoPair) {
    heartbeat.stop();
    showPairing(demoPair === 'invalid' ? 'invalid' : 'pair', pairingLang(params), { length: Number(params.get('pairLen')) || 6 });
    return;
  }
  if (forceDemo) {
    enterDemo();
    startPolling();
    return;
  }
  // Fresh install: welcome screen with the admin URL + QR until the setup wizard is completed.
  const setup = await checkSetup();
  if (setup) {
    const pl = params.get('lang');
    heartbeat.stop();
    showWelcome(setup, pl === 'es' || pl === 'en' || pl === 'pt' ? pl : setup.suggestedLanguage);
    waitForSetup();
    return;
  }
  // /pair always shows the pairing screen for a browser without a key (also in open mode).
  if (location.pathname === '/pair' && !credential) {
    heartbeat.stop();
    showPairing('pair', pairingLang(params));
    return;
  }
  // Ask the server first (short timeout): a revoked link or a private install without a key must never flash
  // cached family data. Offline → last known data (offline tolerance), then go live.
  let first: DisplayConfig | null = null;
  try {
    first = await api.configQuick();
  } catch (e) {
    if (deniedBy(e)) return;
  }
  if (first) {
    setOnline(true);
    saveCache('config', first);
    set('config', first);
    void goLive();
    return;
  }
  const cached = loadCache<DisplayConfig>('config');
  if (cached) {
    set('events', loadCache<EventsResponse>('events'));
    set('weather', loadCache<WeatherResponse>('weather'));
    set('news', loadCache<NewsResponse>('news'));
    set('countdowns', loadCache<CountdownsResponse>('countdowns'));
    set('config', cached);
  }
  const ok = await fetchConfig();
  if (accessDenied) return;
  if (!ok && !cached) {
    if (import.meta.env.DEV) {
      console.info('[display] /api unreachable, running with the built-in demo dataset');
      enterDemo();
      startPolling();
      // keep probing the real API; switch over without a reload when it appears
      const probe = setInterval(async () => {
        try {
          const c = await api.config();
          clearInterval(probe);
          state.demo = false;
          set('config', c);
          state.events = null;
          void goLive();
        } catch { /* still down */ }
      }, 30_000);
      return;
    }
    // Production without any data yet: defaults + keep retrying.
    set('config', normalizeConfig({}) as DisplayConfig);
    const retry = setInterval(async () => {
      if (accessDenied) return clearInterval(retry);
      if (await fetchConfig()) {
        clearInterval(retry);
        void goLive();
      }
    }, 10_000);
  }
  void goLive();
}

let streamStarted = false;
async function goLive(): Promise<void> {
  if (accessDenied) return;
  startPolling();
  void fetchEvents();
  void fetchWeather();
  void fetchNews();
  void fetchPhotos();
  void fetchCountdowns();
  if (streamStarted) return;
  streamStarted = true;
  // A server without SSE (live: 'poll' in /api/health) gets the poll channel instead of the stream.
  const mode = await detectLiveMode({
    health: () => api.health(),
    answered: (e) => e instanceof ApiError && e.status > 0,
    cancelled: () => accessDenied,
  });
  if (!mode || accessDenied) return;
  if (mode === 'poll') {
    // The poll answer carries the server time and revision, so the heartbeat only reports what the screen runs.
    heartbeat.start(10 * 60_000);
    liveStream = startPoll({
      poll: (cursor, rev, hidden) => api.poll(pollUrl(cursor, rev, hidden)),
      revision: () => state.config?.revision,
      screenId: () => state.config?.screenId,
      handlers: {
        ...liveHandlers,
        first: onHello,
        screenChanged: () => location.reload(),
        now: (iso) => setServerNow(iso),
        sync: (ids) => announcements.sync(ids),
      },
      denied: (e) => deniedBy(e),
      status: (e) => (e instanceof ApiError ? e.status : 0),
      hidden: () => document.hidden,
      // A server that says 'poll' but has no /api/display/poll: check the config revision every 90 s.
      fallback: () => {
        liveStream = startConfigPoll({
          revision: () => state.config?.revision,
          fetchConfig,
          changed: () => {
            void fetchEvents();
            void fetchCountdowns();
          },
        });
      },
    });
    heartbeat.soon();
    return;
  }
  heartbeat.start();
  liveStream = connectStream({ ...liveHandlers, hello: onHello });
}

/** SSE `hello`, and the first answer (or a reset) of the poll channel. */
function onHello(d: Partial<StreamHello>): void {
  setOnline(true);
  setServerNow(d.now);
  if (Array.isArray(d.activeAnnouncementIds)) announcements.sync(d.activeAnnouncementIds);
  doorbell.sync(d.doorbellId);
  if (typeof d.revision === 'number' && d.revision !== state.config?.revision) void fetchConfig();
  void fetchEvents();
  void fetchCountdowns();
  heartbeat.soon();
  if (d.serverVersion) void maybeReloadForVersion(d.serverVersion);
}

/** What each live event does, whichever transport brought it (live.ts dispatch). */
const liveHandlers: StreamHandlers = {
  // Config can change the event range (weeks/weekStart/startToday), colours, icons and countdowns → refetch them too.
  config: () => void fetchConfig().then((ok) => (ok ? Promise.all([fetchEvents(), fetchCountdowns()]) : undefined)),
  // gallery changed in the admin (upload, replace, delete, focal point, shown / hidden) → fresh list;
  // a photo taken out of the rotation while on screen is replaced right away
  photos: (d) =>
    void fetchPhotos().then(() => {
      if (photos.currentFile && d.hidden?.includes(photos.currentFile)) void photos.next();
    }),
  events: (d) => {
    if (!state.events || d.hash !== state.events.hash) void fetchEvents();
    void fetchCountdowns();
  },
  reload: () => location.reload(),
  announce: (a) => announcements.show(a),
  announceClear: (d) => announcements.clear(d.id),
  identify: (d) => {
    identify.show(d, { name: ctx.cfg.screen.name, slug: state.config?.slug || screenKey, clientId });
    heartbeat.soon();
  },
  night: (d) => {
    setNightCommand(d.mode);
    heartbeat.soon();
  },
  // privacy mode turned on or off: new config (lock, photo source), filtered events and countdowns
  privacy: () => refreshForPrivacy(),
  // Doorbell: full screen above the night layer while it lasts (it wakes a dimmed screen, see widgets/doorbell.ts).
  doorbell: (d) => doorbell.show(d),
  doorbellEnd: (d) => doorbell.end(d.id),
  // Link regenerated / device revoked → "no longer valid"; switched to private without a key → pairing.
  revoked: (d) => denyAccess(d.code === 'key_required' ? 401 : 403),
  open: () => setOnline(true),
  down: () => setOnline(false),
};

// Back on screen after being hidden: poll right away instead of waiting for the hidden-page delay.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void liveStream?.tick?.();
});

/**
 * The server runs a newer build than this page (hello.serverVersion ≠ __APP_VERSION__): reload once, but never
 * more than once per 10 min (sessionStorage guard) and only when /api/health answers.
 */
async function maybeReloadForVersion(serverVersion: string): Promise<void> {
  if (!serverVersion || serverVersion === __APP_VERSION__ || import.meta.env.DEV) return;
  const KEY = 'cs.versionReloadAt';
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10 * 60_000) return;
    const h = await api.health();
    if (!h?.ok) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return;
  }
  console.info(`[display] server ${serverVersion} ≠ page ${__APP_VERSION__} → reloading`);
  location.reload();
}

const heartbeat = new Heartbeat(
  {
    screenId: () => state.config?.screenId || '',
    webgl: () => !!engine,
    lite: () => lite,
    night: () => nightNow,
    nightOverride: () => nightOverride,
    demo: () => state.demo,
    photoFrame: () => photos.frame,
  },
  (now) => setServerNow(now),
);
// The admin's focal-point editor previews the photo with this display's real free band.
photos.onFrameChange = () => heartbeat.soon(3000);

// Nightly soft reload (~04:00 local, page older than 12 h) to reclaim leaked renderer/browser memory on
// long-running kiosks. Only when the server answers, so an offline display never reloads into a blank page.
const bootAt = Date.now();
setInterval(async () => {
  if (state.demo || Date.now() - bootAt < 12 * 3600_000) return;
  const t = current();
  if (t.parts.hour !== 4 || t.parts.minute > 10) return;
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.ok) location.reload();
  } catch { /* offline: try again later */ }
}, 5 * 60_000);

// Never let an unexpected error blank the screen.
window.addEventListener('error', (e) => {
  console.error('[display] error', e.error || e.message);
  noteError(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[display] rejection', e.reason);
  noteError(e.reason);
});

void boot();
