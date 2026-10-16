// Personalizado screens (layout.preset 'canvas'): the widget registry, the size table, validation, the portrait
// derivation, the display projection and the templates. Pure (no node:* imports): the server, the admin, the display
// and Marco Cloud all run this file. Types: canvasCore.d.ts and web/shared/types.ts. Spec: docs/CANVAS.md.
import { isValidTimeZone } from './lib/tz.js';
import { enabledWindows, nextWindowBoundary, windowState } from './schedules.js';
import { cardErrorText, checkCard, cssProblem } from './cardTemplate.js';
import { COIN_ID_RE, DATA_LIMITS, MARKET_CURRENCIES, MARKET_RANGES, SPORTS_LEAGUES, STOCK_SYMBOL_RE, TEAM_ID_RE } from './dataCore.js';

// ---- grid and sizes ----------------------------------------------------------------------------------------------

/** Cells of the main area: 12×8 on a landscape screen, 8×12 on a portrait one. */
export const CANVAS_GRID = { landscape: { cols: 12, rows: 8 }, portrait: { cols: 8, rows: 12 } };

/**
 * Named sizes: [w, h] in cells per orientation. An item stores one of them, and when its box is not exactly a named
 * size also its own w and h in whole cells, within its kind's range (`cells` in CANVAS_KINDS, cellRange).
 */
export const CANVAS_SIZES = {
  xs: { landscape: [2, 2], portrait: [2, 2] },
  s: { landscape: [3, 2], portrait: [4, 2] },
  m: { landscape: [4, 3], portrait: [4, 3] },
  w: { landscape: [6, 2], portrait: [8, 2] },
  t: { landscape: [3, 4], portrait: [4, 4] },
  l: { landscape: [6, 4], portrait: [8, 4] },
  xl: { landscape: [8, 6], portrait: [8, 6] },
  band: { landscape: [12, 2], portrait: [8, 3] },
  full: { landscape: [12, 8], portrait: [8, 12] },
  // one cell high: a line with an icon, a name and a state (the Entidad card only)
  row: { landscape: [3, 1], portrait: [4, 1] },
  // a square medium (the light card)
  sq: { landscape: [3, 3], portrait: [4, 3] },
};
export const CANVAS_SIZE_IDS = Object.keys(CANVAS_SIZES);

/** Sidebar stack: each item spans 2, 3 or 4 of 8 units, or takes what is left ('fill', at most one). */
export const SIDE_SPANS = [2, 3, 4, 'fill'];
export const SIDE_UNITS = 8;
export const SIDEBAR_SIDES = ['none', 'left', 'right', 'top', 'bottom'];
export const SIDEBAR_SIZES = ['narrow', 'normal', 'wide'];
/** Share of the screen width (left / right) or height (top / bottom) a sidebar takes. */
export const SIDEBAR_SHARE = { narrow: 0.22, normal: 0.28, wide: 0.36 };
export const SIDEBAR_FILLS = ['glass', 'solid', 'photo'];
export const CANVAS_BACKGROUNDS = ['photo', 'ambient', 'solid'];
export const CANVAS_SURFACES = ['glass', 'solid', 'none'];
/** Where "Oscurecer foto" darkens the photo: all over, at the top and bottom, or towards the edges. */
export const CANVAS_SCRIMS = ['uniform', 'topBottom', 'edges'];
/** Corners: square ('sq'), soft ('m', kept for screens saved with it; the editor offers sq, l, xl), round, rounder. */
export const CANVAS_RADII = ['sq', 'm', 'l', 'xl'];

/** Caps per screen. */
export const CANVAS_LIMITS = { items: 24, side: 8, haEntities: 40, liveCameras: 1 };

export const CANVAS_ID_RE = /^cv_[a-z0-9]{8}$/;
export const HA_ENTITY_RE = /^[a-z_]{1,64}\.[a-z0-9_]{1,200}$/;
/** A Valor key: a-z, 0-9, _ . - (never the names of an object's own machinery, so a key is always plain data). */
export const VALUE_KEY_RE = /^(?!(?:__proto__|constructor|prototype)$)[a-z0-9_.-]{1,40}$/;

/**
 * Words that say "this opens a door or a lock" in the five admin languages (whole words for the short Dutch and Danish
 * ones, so "Sports" or "Report" do not match; "outdoor" and "clock" do not count either). "portao" too: Home
 * Assistant makes entity ids without accents, so a "Portão" becomes switch.portao.
 */
const DOORLIKE_RE = /(?<!out)door|(?<![bc])lock|gate|garage|alarm|puerta|cerradura|port[oó]n|garaje|alarma|port[ãa]o|fechadura|deur|poort|dør|lås|(?<![a-z])(?:slot|port)(?![a-z])/i;
const DOORLIKE_DC = ['door', 'garage', 'gate', 'lock', 'opening', 'window'];

/**
 * True when an entity looks like it opens a door, a gate or a lock: its device class, or a word in its id or its
 * name. A switch, a script or a button can open a garage even though those domains are allowed, so such an entity
 * needs two taps on the screen and the owner's explicit tick in the builder. A speed bump, not a boundary.
 */
export function needsConfirm(domain, attrs, entityId = '', name = '') {
  const dc = attrs && typeof attrs.device_class === 'string' ? attrs.device_class : '';
  if (DOORLIKE_DC.includes(dc)) return true;
  // the house's water valve: only shown until the owner ticks it, then two taps
  if (domain === 'valve' && dc === 'water') return true;
  const fname = attrs && typeof attrs.friendly_name === 'string' ? attrs.friendly_name : '';
  const id = String(entityId || '').replace(/_/g, ' ');
  return [id, fname, String(name || '')].some((x) => x && DOORLIKE_RE.test(x));
}

/** [w, h] of a size on an orientation. */
export function sizeCells(size, orientation = 'landscape') {
  const s = CANVAS_SIZES[size] ?? CANVAS_SIZES.m;
  return s[orientation === 'portrait' ? 'portrait' : 'landscape'];
}

const orientOf = (o) => (o === 'portrait' ? 'portrait' : 'landscape');
const kindOf = (kind) => (typeof kind === 'string' ? CANVAS_KINDS[kind] : kind);

/**
 * The smallest and largest box of a kind on an orientation, in cells: the kind's `cells` (written for landscape; on a
 * portrait screen at most 8 wide, and a kind that may take the whole height takes all 12 rows), widened to hold every
 * named size of the kind on that orientation, never past the grid.
 */
export function cellRange(kind, orientation = 'landscape') {
  const o = orientOf(orientation);
  const k = kindOf(kind);
  const { cols, rows } = CANVAS_GRID[o];
  const [a, b, c, d] = k?.cells ?? [1, 1, cols, rows];
  let minW = Math.min(a, cols);
  let minH = Math.min(b, rows);
  let maxW = Math.min(c, cols);
  let maxH = o === 'portrait' && d >= CANVAS_GRID.landscape.rows ? rows : Math.min(d, rows);
  for (const s of k?.sizes ?? []) {
    const [w, h] = sizeCells(s, o);
    minW = Math.min(minW, w);
    minH = Math.min(minH, h);
    maxW = Math.max(maxW, w);
    maxH = Math.max(maxH, h);
  }
  return { minW, minH, maxW, maxH };
}

/** [w, h] of a main-grid position: its own w and h when it has them, else its named size's. */
export function posCells(pos, orientation = 'landscape') {
  if (pos && Number.isInteger(pos.w) && Number.isInteger(pos.h)) return [pos.w, pos.h];
  return sizeCells(pos?.size, orientation);
}

/**
 * The named size a w×h box of `kind` is drawn like (cards lay out by it, then fit the real box): the largest of the
 * kind's sizes that fits inside the box (ties: the closer shape); when none does, the one that sticks out least.
 */
export function lookSize(kind, w, h, orientation = 'landscape') {
  const o = orientOf(orientation);
  const k = kindOf(kind);
  const sizes = k?.sizes ?? CANVAS_SIZE_IDS;
  let best = null;
  let key = null;
  for (const s of sizes) {
    const [sw, sh] = sizeCells(s, o);
    const out = Math.max(0, sw - w) + Math.max(0, sh - h);
    const shape = Math.abs(Math.log((sw / sh) / (w / h)));
    // fits first, then the bigger, then the closer shape; when nothing fits: the least sticking out, then smaller
    const kk = out === 0 ? [0, -sw * sh, shape] : [1, out, sw * sh];
    if (!key || kk[0] < key[0] || (kk[0] === key[0] && (kk[1] < key[1] || (kk[1] === key[1] && kk[2] < key[2])))) {
      key = kk;
      best = s;
    }
  }
  return best ?? k?.def ?? 'm';
}

/**
 * A w×h box of `kind` as stored: clamped to its range; a box that is exactly one of its named sizes is stored as
 * that name alone (so every screen saved before keeps its shape), any other as { size: its look, w, h }.
 */
export function boxOf(kind, w, h, orientation = 'landscape') {
  const o = orientOf(orientation);
  const k = kindOf(kind);
  const r = cellRange(k, o);
  const cw = Math.min(r.maxW, Math.max(r.minW, Math.round(w)));
  const ch = Math.min(r.maxH, Math.max(r.minH, Math.round(h)));
  const named = (k?.sizes ?? []).find((s) => {
    const [sw, sh] = sizeCells(s, o);
    return sw === cw && sh === ch;
  });
  return named ? { size: named } : { size: lookSize(k, cw, ch, o), w: cw, h: ch };
}

/** True when a box of w×h cells is within the range of `kind` on an orientation. */
export function boxAllowed(kind, w, h, orientation = 'landscape') {
  const r = cellRange(kind, orientation);
  return Number.isInteger(w) && Number.isInteger(h) && w >= r.minW && w <= r.maxW && h >= r.minH && h <= r.maxH;
}

// ---- registry ----------------------------------------------------------------------------------------------------

/** A warning when the collector takes them (the save goes on), else nothing. */
const warnOf = (c, path, msg) => (typeof c.warn === 'function' ? c.warn(path, msg) : undefined);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Every size but the band and the one-line row (kinds that take any size). */
const SIZES_BUT_BAND = CANVAS_SIZE_IDS.filter((s) => s !== 'band' && s !== 'row' && s !== 'sq');
/** Where a clock's date goes (below the time, as before, or above it); the Fecha card: where the weekday goes. */
const DATE_POS = ['below', 'above'];

/**
 * Small coercers for props: wrong types are an error (and take the default), numbers out of range are clamped,
 * strings are capped. `c` = { err(path, msg), warn?(path, msg) }.
 */
const P = {
  bool: (c, path, v, d) => {
    if (v === undefined || v === null) return d;
    if (typeof v === 'boolean') return v;
    c.err(path, 'expected boolean');
    return d;
  },
  num: (c, path, v, d, min, max, int = true) => {
    if (v === undefined || v === null || v === '') return d;
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      c.err(path, 'expected number');
      return d;
    }
    const x = Math.min(max, Math.max(min, n));
    return int ? Math.round(x) : x;
  },
  str: (c, path, v, d, max) => {
    if (v === undefined || v === null) return d;
    if (typeof v !== 'string') {
      c.err(path, 'expected string');
      return d;
    }
    // eslint-disable-next-line no-control-regex
    const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (s.length > max) {
      c.err(path, `too long (max ${max})`);
      return s.slice(0, max);
    }
    return s;
  },
  oneOf: (c, path, v, d, list) => {
    if (v === undefined || v === null) return d;
    if (list.includes(v)) return v;
    c.err(path, `must be one of ${list.join(', ')}`);
    return d;
  },
  color: (c, path, v, d = null) => {
    if (v === undefined) return d;
    if (v === null || v === '') return null;
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())) return v.trim().toLowerCase();
    c.err(path, 'invalid color (#rrggbb)');
    return d;
  },
  /** A list of ids filtered to `known` (a Set, or null for any id); null stays null, an empty result is null. */
  ids: (c, path, v, known, max = 60) => {
    if (v === undefined || v === null) return null;
    if (!Array.isArray(v)) {
      c.err(path, 'expected array');
      return null;
    }
    const out = [...new Set(v.filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x) && (!known || known.has(x))))].slice(0, max);
    return out.length ? out : null;
  },
  /** One HA entity id of one of `domains` ('' = not chosen yet). */
  entity: (c, path, v, domains) => {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v !== 'string' || !HA_ENTITY_RE.test(v.trim())) {
      c.err(path, 'invalid entity id');
      return '';
    }
    const e = v.trim();
    if (domains && !domains.includes(e.split('.')[0])) {
      c.err(path, `must be one of the domains ${domains.join(', ')}`);
      return '';
    }
    return e;
  },
  list: (c, path, v, max, one) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      c.err(path, 'expected array');
      return [];
    }
    if (v.length > max) c.err(path, `too many items (max ${max})`);
    return v.slice(0, max).map((x, i) => (isObj(x) ? one(x, `${path}[${i}]`) : (c.err(`${path}[${i}]`, 'expected object'), null))).filter(Boolean);
  },
};

const calendarCommon = (c, p, x, refs) => ({
  sourceIds: P.ids(c, `${p}.sourceIds`, x.sourceIds, refs.sourceIds ?? null),
  hidePast: P.bool(c, `${p}.hidePast`, x.hidePast, false),
});

const zoneOf = (c, p, v, d) => {
  const s = P.str(c, p, v, d, 64).trim();
  if (s && isValidTimeZone(s)) return s;
  warnOf(c, p, 'unknown timezone, UTC used');
  return 'UTC';
};

const DOMAINS = {
  tile: ['light', 'switch', 'input_boolean', 'fan', 'scene', 'script', 'button', 'sensor', 'binary_sensor', 'cover', 'climate', 'lock', 'alarm_control_panel', 'media_player', 'person', 'device_tracker', 'input_number', 'input_select', 'number', 'select', 'vacuum', 'weather', 'sun', 'valve', 'update'],
  light: ['light'],
  switch: ['switch', 'input_boolean', 'fan'],
  climate: ['climate'],
  cover: ['cover'],
  sensor: ['sensor', 'binary_sensor'],
  chart: ['sensor'],
  camera: ['camera'],
  media: ['media_player'],
  scene: ['scene', 'script', 'button'],
  gauge: ['sensor', 'number', 'input_number'],
  statistic: ['sensor'],
};
/** What can go in the row under an Entidad card (ha.tile props.features; null = chosen for its domain). */
export const TILE_FEATURES = ['brightness', 'colorTemp', 'color', 'cover', 'position', 'hvacModes', 'target', 'valve', 'select', 'number', 'vacuum', 'update', 'gauge'];
/** The periods and values of a Estadística card (Home Assistant's long-term statistics). */
export const STAT_PERIODS = ['today', 'week', 'month'];
export const STAT_TYPES = ['change', 'mean', 'min', 'max'];
/** How a condition compares the entity's state or the value with what the owner wrote. */
export const CONDITION_OPS = ['eq', 'ne', 'gt', 'lt'];
/** Most time windows of one item's visibility schedule ("Horario"). */
export const ITEM_SCHEDULE_MAX = 6;
/** What a custom card may bind besides Home Assistant and Valor: the time, the date, the weather, the next event. */
export const CARD_BUILTINS = ['time', 'date', 'weather', 'nextEvent'];
const HVAC_MODES = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'];
const SPORTS_LEAGUE_IDS = SPORTS_LEAGUES.map((l) => l.id);
/** Kinds that show numbers the server fetches from public sources (core/dataCore.js). */
export const DATA_KIND_IDS = ['market', 'sports', 'stocks'];
/**
 * "Estilo de la gráfica" of the cards that draw a chart (Cripto, Bolsa, Sensor, Gráfica): 'below', the chart in a
 * band under the numbers, or 'background', the chart filling the card edge to edge behind them. Each kind keeps its
 * look as its default, so saved screens do not change.
 */
export const CHART_STYLES = ['below', 'background'];

/**
 * Every kind of widget. `cat` = palette category, `sizes` = its named sizes (`def` the default; the presets of the
 * editor), `cells` = [min w, min h, max w, max h]: any box of whole cells in between is allowed too (landscape cells;
 * see cellRange for portrait), `side` = may sit in
 * the sidebar, `edition` = 'all' (self-hosted and Cloud) or 'local' (self-hosted only), `feature` = the capability
 * key that turns it on, `perScreen` = most per screen, `ha` = Home Assistant entities it binds, `controls` = it has
 * touch controls, `reserved` = in the model for a later version and refused today. `defaults()` gives the props of a
 * new item and `props(c, p, raw, refs, opts)` validates them.
 */
export const CANVAS_KINDS = {
  // ---- Reloj y fecha
  'clock.digital': {
    cat: 'time', sizes: ['xs', 's', 'm', 'w', 'l', 'xl', 'band'], def: 'm', cells: [2, 2, 12, 6], side: true, edition: 'all', bigType: true,
    defaults: () => ({ seconds: false, showDate: true, dateFormat: 'long', weight: 'regular', datePos: 'below' }),
    props: (c, p, x) => ({
      seconds: P.bool(c, `${p}.seconds`, x.seconds, false),
      showDate: P.bool(c, `${p}.showDate`, x.showDate, true),
      datePos: P.oneOf(c, `${p}.datePos`, x.datePos, 'below', DATE_POS),
      dateFormat: P.oneOf(c, `${p}.dateFormat`, x.dateFormat, 'long', ['long', 'short']),
      weight: P.oneOf(c, `${p}.weight`, x.weight, 'regular', ['light', 'regular', 'bold']),
    }),
  },
  'clock.analog': {
    cat: 'time', sizes: ['xs', 's', 'm', 't', 'l', 'xl'], def: 'm', cells: [2, 2, 8, 8], side: true, edition: 'all', bigType: true,
    defaults: () => ({ face: 'classic', seconds: true, showDate: false, datePos: 'below' }),
    props: (c, p, x) => ({
      face: P.oneOf(c, `${p}.face`, x.face, 'classic', ['classic', 'minimal', 'dots', 'numbers']),
      seconds: P.bool(c, `${p}.seconds`, x.seconds, true),
      showDate: P.bool(c, `${p}.showDate`, x.showDate, false),
      datePos: P.oneOf(c, `${p}.datePos`, x.datePos, 'below', DATE_POS),
    }),
  },
  'clock.flip': {
    cat: 'time', sizes: ['s', 'm', 'w', 'l'], def: 'm', cells: [3, 2, 12, 6], side: true, edition: 'all', bigType: true,
    defaults: () => ({ showDate: false, datePos: 'below' }),
    props: (c, p, x) => ({ showDate: P.bool(c, `${p}.showDate`, x.showDate, false), datePos: P.oneOf(c, `${p}.datePos`, x.datePos, 'below', DATE_POS) }),
  },
  'clock.world': {
    cat: 'time', sizes: ['s', 'm', 'w', 't'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ zones: [{ tz: 'America/New_York', label: 'New York' }, { tz: 'Asia/Tokyo', label: 'Tokyo' }], analog: false }),
    props: (c, p, x) => {
      let zones = P.list(c, `${p}.zones`, x.zones, 8, (z, q) => ({ tz: zoneOf(c, `${q}.tz`, z.tz, 'UTC'), label: P.str(c, `${q}.label`, z.label, '', 24).trim() }));
      if (!zones.length) zones = [{ tz: 'UTC', label: 'UTC' }];
      return { zones, analog: P.bool(c, `${p}.analog`, x.analog, false) };
    },
  },
  date: {
    cat: 'time', sizes: ['xs', 's', 'w'], def: 's', cells: [2, 2, 12, 6], side: true, edition: 'all', bigType: true,
    defaults: () => ({ style: 'page', isoWeek: false, sun: false, weekday: 'above' }),
    props: (c, p, x) => ({
      style: P.oneOf(c, `${p}.style`, x.style, 'page', ['page', 'line']),
      weekday: P.oneOf(c, `${p}.weekday`, x.weekday, 'above', DATE_POS),
      isoWeek: P.bool(c, `${p}.isoWeek`, x.isoWeek, false),
      sun: P.bool(c, `${p}.sun`, x.sun, false),
    }),
  },
  // ---- Calendario
  'calendar.month': {
    cat: 'calendar', sizes: ['m', 'l', 'xl', 'full'], def: 'l', cells: [4, 3, 12, 8], side: false, edition: 'all', events: true,
    defaults: () => ({ sourceIds: null, hidePast: false, weeks: 'auto', eventStyle: 'lines', maxEventsPerDay: 4, showLegend: true }),
    props: (c, p, x, refs) => ({
      ...calendarCommon(c, p, x, refs),
      weeks: x.weeks === 'auto' || x.weeks === undefined || x.weeks === null ? 'auto' : P.num(c, `${p}.weeks`, x.weeks, 'auto', 1, 6),
      eventStyle: P.oneOf(c, `${p}.eventStyle`, x.eventStyle, 'lines', ['lines', 'cards']),
      maxEventsPerDay: P.num(c, `${p}.maxEventsPerDay`, x.maxEventsPerDay, 4, 1, 12),
      showLegend: P.bool(c, `${p}.showLegend`, x.showLegend, true),
    }),
  },
  'calendar.week': {
    cat: 'calendar', sizes: ['w', 'l', 'xl', 'full'], def: 'xl', cells: [6, 2, 12, 8], side: false, edition: 'all', events: true,
    defaults: () => ({ sourceIds: null, hidePast: false, start: 'today' }),
    props: (c, p, x, refs) => ({ ...calendarCommon(c, p, x, refs), start: P.oneOf(c, `${p}.start`, x.start, 'today', ['today', 'monday']) }),
  },
  'calendar.agenda': {
    cat: 'calendar', sizes: ['s', 'm', 't', 'l', 'xl', 'full'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all', events: true,
    defaults: () => ({ sourceIds: null, hidePast: false, days: 7, maxPerDay: 4, compact: false }),
    props: (c, p, x, refs) => ({
      ...calendarCommon(c, p, x, refs),
      days: P.num(c, `${p}.days`, x.days, 7, 1, 14),
      maxPerDay: P.num(c, `${p}.maxPerDay`, x.maxPerDay, 4, 1, 10),
      compact: P.bool(c, `${p}.compact`, x.compact, false),
    }),
  },
  'calendar.today': {
    cat: 'calendar', sizes: ['m', 't', 'l', 'xl', 'full'], def: 't', cells: [3, 3, 12, 8], side: true, edition: 'all', events: true,
    defaults: () => ({ sourceIds: null, hidePast: false }),
    props: (c, p, x, refs) => calendarCommon(c, p, x, refs),
  },
  'calendar.next': {
    cat: 'calendar', sizes: ['xs', 's', 'w'], def: 's', cells: [2, 2, 12, 6], side: true, edition: 'all', events: true,
    defaults: () => ({ sourceIds: null, hidePast: false, count: 1, relative: true }),
    props: (c, p, x, refs) => ({
      ...calendarCommon(c, p, x, refs),
      count: P.num(c, `${p}.count`, x.count, 1, 1, 6),
      relative: P.bool(c, `${p}.relative`, x.relative, true),
    }),
  },
  'calendar.people': {
    cat: 'calendar', sizes: ['l', 'xl', 'full'], def: 'l', cells: [6, 4, 12, 8], side: false, edition: 'all', events: true, private: true,
    defaults: () => ({ sourceIds: null, hidePast: false, memberIds: null, days: 2 }),
    props: (c, p, x, refs) => ({
      ...calendarCommon(c, p, x, refs),
      memberIds: P.ids(c, `${p}.memberIds`, x.memberIds, refs.memberIds ?? null, 12),
      days: P.num(c, `${p}.days`, x.days, 2, 1, 3),
    }),
  },
  countdowns: {
    cat: 'calendar', sizes: ['s', 'w', 't'], def: 'w', cells: [3, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ max: 4, style: 'list' }),
    props: (c, p, x) => ({ max: P.num(c, `${p}.max`, x.max, 4, 1, 6), style: P.oneOf(c, `${p}.style`, x.style, 'list', ['cards', 'list']) }),
  },
  // ---- Tiempo
  'weather.now': {
    cat: 'weather', sizes: ['xs', 's', 'm'], def: 's', cells: [2, 2, 12, 8], side: true, edition: 'all', bigType: true,
    defaults: () => ({ feelsLike: true, meta: true, indoor: false }),
    props: (c, p, x) => ({
      feelsLike: P.bool(c, `${p}.feelsLike`, x.feelsLike, true),
      meta: P.bool(c, `${p}.meta`, x.meta, true),
      indoor: P.bool(c, `${p}.indoor`, x.indoor, false),
    }),
  },
  'weather.hourly': {
    cat: 'weather', sizes: ['w', 'l'], def: 'w', cells: [6, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ hours: 12 }),
    props: (c, p, x) => ({ hours: P.oneOf(c, `${p}.hours`, x.hours, 12, [6, 12, 24]) }),
  },
  'weather.forecast': {
    cat: 'weather', sizes: ['m', 'w', 't', 'l'], def: 'w', cells: [4, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ days: 5, layout: 'row' }),
    props: (c, p, x) => ({ days: P.num(c, `${p}.days`, x.days, 5, 3, 7), layout: P.oneOf(c, `${p}.layout`, x.layout, 'row', ['row', 'column']) }),
  },
  // ---- Contenido y fotos
  message: {
    cat: 'content', sizes: ['s', 'w', 'm', 'l'], def: 'w', cells: [3, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ align: 'center' }),
    props: (c, p, x) => ({ align: P.oneOf(c, `${p}.align`, x.align, 'center', ['left', 'center']) }),
  },
  todo: {
    cat: 'content', sizes: ['s', 't', 'm'], def: 't', cells: [3, 2, 8, 8], side: true, edition: 'all',
    defaults: () => ({ maxRows: 6, showDone: true }),
    props: (c, p, x) => ({ maxRows: P.num(c, `${p}.maxRows`, x.maxRows, 6, 1, 12), showDone: P.bool(c, `${p}.showDone`, x.showDone, true) }),
  },
  news: {
    cat: 'content', sizes: ['w', 'm', 'l'], def: 'w', cells: [4, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ rotateSec: 15 }),
    props: (c, p, x) => ({ rotateSec: P.num(c, `${p}.rotateSec`, x.rotateSec, 15, 5, 60) }),
  },
  photo: {
    cat: 'content', sizes: ['s', 'm', 't', 'l', 'xl'], def: 'm', cells: [2, 2, 12, 8], side: true, edition: 'all', perScreen: 2,
    defaults: () => ({ intervalSec: 60, fit: 'cover', caption: false }),
    props: (c, p, x) => ({
      intervalSec: P.num(c, `${p}.intervalSec`, x.intervalSec, 60, 10, 600),
      fit: P.oneOf(c, `${p}.fit`, x.fit, 'cover', ['cover', 'contain']),
      caption: P.bool(c, `${p}.caption`, x.caption, false),
    }),
  },
  widget: {
    cat: 'content', sizes: ['s', 'm', 't', 'l', 'xl', 'full'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ widgetId: '', chartStyle: 'below' }),
    // a deleted widget drops the item quietly (sanitizeCanvas), as the screen placements do. chartStyle: the chart of
    // the electricity prices drawn in it (CHART_STYLES; the other widgets have none)
    props: (c, p, x) => ({ widgetId: typeof x.widgetId === 'string' ? x.widgetId : '', chartStyle: P.oneOf(c, `${p}.chartStyle`, x.chartStyle, 'below', CHART_STYLES) }),
  },
  value: {
    cat: 'content', sizes: ['xs', 's', 'w'], def: 's', cells: [2, 2, 8, 6], side: true, edition: 'all', bigType: true, private: true, feature: 'valueHooks',
    defaults: () => ({ key: '', label: '', unit: '', decimals: 1, icon: '', staleAfterMin: 60 }),
    props: (c, p, x) => {
      let key = P.str(c, `${p}.key`, x.key, '', 40).trim();
      if (key && !VALUE_KEY_RE.test(key)) {
        c.err(`${p}.key`, 'invalid key (a-z, 0-9, _ . -)');
        key = '';
      }
      return {
        key,
        label: P.str(c, `${p}.label`, x.label, '', 40),
        unit: P.str(c, `${p}.unit`, x.unit, '', 12),
        decimals: P.num(c, `${p}.decimals`, x.decimals, 1, 0, 3),
        icon: P.str(c, `${p}.icon`, x.icon, '', 8),
        staleAfterMin: P.num(c, `${p}.staleAfterMin`, x.staleAfterMin, 60, 0, 1440),
      };
    },
  },
  // "Sección": a title (and an emoji) on a thin band that groups the cards around it, like Home Assistant's headings
  heading: {
    cat: 'content', sizes: ['s', 'w', 'band'], def: 'w', cells: [2, 1, 12, 4], side: true, edition: 'all', defStyle: { surface: 'none' },
    defaults: () => ({ title: '', icon: '', align: 'left', line: true }),
    props: (c, p, x) => ({
      title: P.str(c, `${p}.title`, x.title, '', 40),
      icon: P.str(c, `${p}.icon`, x.icon, '', 8),
      align: P.oneOf(c, `${p}.align`, x.align, 'left', ['left', 'center']),
      line: P.bool(c, `${p}.line`, x.line, true),
    }),
  },
  spacer: {
    cat: 'content', sizes: ['xs', 's', 'm', 'w', 't', 'l'], def: 's', cells: [1, 1, 12, 8], side: true, edition: 'all',
    defaults: () => ({}),
    props: () => ({}),
  },
  // ---- Familia y hogar (the family data the display already gets: GET /api/display/family)
  'family.members': {
    cat: 'family', sizes: ['s', 'm', 'w', 'l'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all', family: true,
    defaults: () => ({ memberIds: null, showPoints: true }),
    props: (c, p, x, refs) => ({ memberIds: P.ids(c, `${p}.memberIds`, x.memberIds, refs.memberIds ?? null, 12), showPoints: P.bool(c, `${p}.showPoints`, x.showPoints, true) }),
  },
  'family.routines': {
    cat: 'family', sizes: ['m', 't', 'l', 'xl', 'full'], def: 't', cells: [3, 3, 12, 8], side: true, edition: 'all', family: true,
    defaults: () => ({ memberId: null, showDone: true }),
    props: (c, p, x, refs) => {
      const m = typeof x.memberId === 'string' && (!refs.memberIds || refs.memberIds.has(x.memberId)) ? x.memberId : null;
      return { memberId: m, showDone: P.bool(c, `${p}.showDone`, x.showDone, true) };
    },
  },
  'family.points': {
    cat: 'family', sizes: ['s', 'm', 't'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all', family: true,
    defaults: () => ({ memberIds: null }),
    props: (c, p, x, refs) => ({ memberIds: P.ids(c, `${p}.memberIds`, x.memberIds, refs.memberIds ?? null, 12) }),
  },
  'family.rewards': {
    cat: 'family', sizes: ['s', 'm', 'w'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all', family: true,
    defaults: () => ({ max: 3 }),
    props: (c, p, x) => ({ max: P.num(c, `${p}.max`, x.max, 3, 1, 6) }),
  },
  'family.chores': {
    cat: 'family', sizes: ['s', 't', 'm', 'l'], def: 't', cells: [3, 2, 12, 8], side: true, edition: 'all', family: true,
    defaults: () => ({ memberIds: null, showDone: true }),
    props: (c, p, x, refs) => ({ memberIds: P.ids(c, `${p}.memberIds`, x.memberIds, refs.memberIds ?? null, 12), showDone: P.bool(c, `${p}.showDone`, x.showDone, true) }),
  },
  'meals.today': {
    cat: 'family', sizes: ['s', 'w', 'm'], def: 'w', cells: [3, 2, 12, 8], side: true, edition: 'all', family: true,
    defaults: () => ({}),
    props: () => ({}),
  },
  'meals.week': {
    cat: 'family', sizes: ['w', 'l', 'xl', 'band', 'full'], def: 'l', cells: [3, 2, 12, 8], side: false, edition: 'all', family: true,
    defaults: () => ({ days: 7 }),
    props: (c, p, x) => ({ days: P.num(c, `${p}.days`, x.days, 7, 3, 7) }),
  },
  birthdays: {
    cat: 'family', sizes: ['s', 'm', 't', 'w'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({ max: 5 }),
    props: (c, p, x) => ({ max: P.num(c, `${p}.max`, x.max, 5, 1, 8) }),
  },
  highlights: {
    cat: 'family', sizes: ['s', 'w', 'band'], def: 'w', cells: [3, 2, 12, 4], side: true, edition: 'all', events: true,
    defaults: () => ({}),
    props: () => ({}),
  },
  announcement: {
    cat: 'family', sizes: ['w', 'band', 'l'], def: 'w', cells: [4, 2, 12, 8], side: true, edition: 'all',
    defaults: () => ({}),
    props: () => ({}),
  },
  // ---- Datos (numbers from public sources, fetched and cached by the server: core/dataCore.js, GET /api/display/data)
  market: {
    cat: 'data', sizes: ['xs', 's', 'w', 'm', 't', 'l'], def: 's', cells: [2, 2, 8, 8], side: true, edition: 'all', private: true, perScreen: 6,
    defaults: () => ({ coins: [{ id: 'bitcoin', sym: 'BTC', name: 'Bitcoin', currency: 'eur' }], layout: 'list', range: '7d', chart: 'area', chartStyle: 'below' }),
    props: (c, p, x) => {
      const seen = new Set();
      const coins = P.list(c, `${p}.coins`, x.coins, DATA_LIMITS.coins, (o, q) => {
        const id = P.str(c, `${q}.id`, o.id, '', 64).trim();
        if (!COIN_ID_RE.test(id)) {
          c.err(`${q}.id`, 'invalid coin id');
          return null;
        }
        const currency = P.oneOf(c, `${q}.currency`, o.currency, 'eur', MARKET_CURRENCIES);
        if (seen.has(`${id}|${currency}`)) return null;
        seen.add(`${id}|${currency}`);
        return { id, sym: P.str(c, `${q}.sym`, o.sym, '', 12).trim().toUpperCase(), name: P.str(c, `${q}.name`, o.name, '', 40).trim(), currency };
      });
      return {
        coins,
        layout: P.oneOf(c, `${p}.layout`, x.layout, 'list', ['list', 'big']),
        range: P.oneOf(c, `${p}.range`, x.range, '7d', MARKET_RANGES),
        chart: P.oneOf(c, `${p}.chart`, x.chart, 'area', ['area', 'line', 'none']),
        chartStyle: P.oneOf(c, `${p}.chartStyle`, x.chartStyle, 'below', CHART_STYLES),
      };
    },
  },
  sports: {
    cat: 'data', sizes: ['s', 'w', 'm', 't', 'l', 'xl'], def: 'm', cells: [3, 2, 12, 8], side: true, edition: 'all', private: true, perScreen: 4,
    defaults: () => ({ follow: [{ type: 'league', league: 'uefa.champions', name: '' }], show: 'auto', max: 4, crests: true }),
    props: (c, p, x) => {
      const seen = new Set();
      const follow = P.list(c, `${p}.follow`, x.follow, DATA_LIMITS.follow, (o, q) => {
        const league = P.oneOf(c, `${q}.league`, o.league, null, SPORTS_LEAGUE_IDS);
        if (!league) {
          if (o.league === undefined || o.league === null) c.err(`${q}.league`, 'missing competition');
          return null;
        }
        const type = P.oneOf(c, `${q}.type`, o.type, 'league', ['team', 'league']);
        const team = type === 'team' ? String(o.team ?? '') : '';
        if (type === 'team' && !TEAM_ID_RE.test(team)) {
          c.err(`${q}.team`, 'invalid team id');
          return null;
        }
        const k = `${league}|${team}`;
        if (seen.has(k)) return null;
        seen.add(k);
        return { type, league, ...(type === 'team' ? { team } : {}), name: P.str(c, `${q}.name`, o.name, '', 40).trim() };
      });
      return {
        follow,
        show: P.oneOf(c, `${p}.show`, x.show, 'auto', ['auto', 'next', 'last']),
        max: P.num(c, `${p}.max`, x.max, 4, 1, DATA_LIMITS.games),
        crests: P.bool(c, `${p}.crests`, x.crests, true),
      };
    },
  },
  stocks: {
    cat: 'data', sizes: ['xs', 's', 'w', 'm', 't', 'l', 'band'], def: 'w', cells: [2, 2, 12, 6], side: true, edition: 'all', private: true, perScreen: 4,
    defaults: () => ({ symbols: [{ sym: 'AAPL', name: 'Apple' }, { sym: 'MSFT', name: 'Microsoft' }, { sym: 'SPY', name: 'S&P 500' }], layout: 'ticker', sparkline: false, chartStyle: 'below' }),
    props: (c, p, x) => {
      const seen = new Set();
      const symbols = P.list(c, `${p}.symbols`, x.symbols, DATA_LIMITS.symbols, (o, q) => {
        const sym = P.str(c, `${q}.sym`, o.sym, '', 24).trim().toUpperCase();
        if (!STOCK_SYMBOL_RE.test(sym)) {
          c.err(`${q}.sym`, 'invalid symbol');
          return null;
        }
        if (seen.has(sym)) return null;
        seen.add(sym);
        return { sym, name: P.str(c, `${q}.name`, o.name, '', 40).trim() };
      });
      return {
        symbols,
        layout: P.oneOf(c, `${p}.layout`, x.layout, 'ticker', ['ticker', 'list']),
        sparkline: P.bool(c, `${p}.sparkline`, x.sparkline, false),
        chartStyle: P.oneOf(c, `${p}.chartStyle`, x.chartStyle, 'below', CHART_STYLES),
      };
    },
  },
  // ---- Casa (Home Assistant, self-hosted only)
  'ha.tile': haKind(['row', 'xs', 's', 'w', 'm'], 'xs', [2, 1, 6, 4], 'tile', {
    controls: true, one: true, state: true,
    extra: (c, p, x) => {
      // the row under the card: null = what suits the entity (haCore tileFeatures), else the owner's list
      let features = null;
      if (Array.isArray(x.features)) features = [...new Set(x.features.filter((f) => TILE_FEATURES.includes(f)))].slice(0, 3);
      else if (x.features !== undefined && x.features !== null) c.err(`${p}.features`, 'expected array');
      const [lo, hi] = rangeOf(c, p, x.gaugeMin, x.gaugeMax, 'gaugeMin', 'gaugeMax');
      return { features, gaugeMin: lo, gaugeMax: hi };
    },
  }),
  'ha.light': haKind(['row', 'xs', 's', 'sq', 'm', 't'], 's', [2, 1, 6, 4], 'light', {
    controls: true, one: true, state: true,
    // row: what goes under it from the small size up (auto: the colours when the light has them, else nothing; the
    // icon switches it on and off). brightness / colorTemp: what a touch screen may change (kept from before)
    extra: (c, p, x) => ({
      row: P.oneOf(c, `${p}.row`, x.row, 'auto', ['auto', 'color', 'brightness', 'none']),
      brightness: P.bool(c, `${p}.brightness`, x.brightness, true), colorTemp: P.bool(c, `${p}.colorTemp`, x.colorTemp, true),
    }),
  }),
  'ha.switch': haKind(['row', 'xs', 's'], 'xs', [2, 1, 6, 4], 'switch', { controls: true, one: true, state: true }),
  'ha.climate': haKind(['row', 'xs', 's', 'w', 'm', 't'], 'm', [2, 1, 6, 5], 'climate', {
    controls: true, one: true, bigType: true, state: true,
    // a new card shows a short set of modes (null: off and the two the entity has that people use most), no fan
    // modes and no humidity; a saved card keeps what it had
    extra: (c, p, x) => ({
      modes: Array.isArray(x.modes) ? [...new Set(x.modes.filter((m) => HVAC_MODES.includes(m)))] : null,
      fan: P.bool(c, `${p}.fan`, x.fan, false),
      humidity: P.bool(c, `${p}.humidity`, x.humidity, false),
    }),
  }),
  'ha.cover': haKind(['xs', 's', 'm'], 's', [2, 2, 6, 3], 'cover', { controls: true, one: true, state: true }),
  'ha.sensor': haKind(['row', 'xs', 's', 'w'], 'xs', [2, 1, 8, 4], 'sensor', {
    one: true, bigType: true,
    extra: (c, p, x) => {
      return {
        decimals: P.num(c, `${p}.decimals`, x.decimals, 1, 0, 3),
        sparkline: P.bool(c, `${p}.sparkline`, x.sparkline, false),
        // the curve fills the card behind the value, as it always did; 'below': in a band under the value
        chartStyle: P.oneOf(c, `${p}.chartStyle`, x.chartStyle, 'background', CHART_STYLES),
        thresholds: thresholdsOf(c, `${p}.thresholds`, x.thresholds),
        invert: P.bool(c, `${p}.invert`, x.invert, false),
      };
    },
  }),
  'ha.gauge': haKind(['xs', 's', 'w', 'm'], 's', [2, 2, 8, 6], 'gauge', {
    one: true, bigType: true,
    extra: (c, p, x) => {
      const [lo, hi] = rangeOf(c, p, x.min, x.max, 'min', 'max');
      return {
        min: lo, max: hi,
        decimals: P.num(c, `${p}.decimals`, x.decimals, 1, 0, 3),
        thresholds: thresholdsOf(c, `${p}.thresholds`, x.thresholds),
        invert: P.bool(c, `${p}.invert`, x.invert, false),
      };
    },
  }),
  'ha.statistic': haKind(['xs', 's', 'w'], 's', [2, 2, 8, 6], 'statistic', {
    one: true, bigType: true, perScreen: 8,
    extra: (c, p, x) => ({
      stat: P.oneOf(c, `${p}.stat`, x.stat, 'change', STAT_TYPES),
      period: P.oneOf(c, `${p}.period`, x.period, 'today', STAT_PERIODS),
      decimals: P.num(c, `${p}.decimals`, x.decimals, 1, 0, 3),
    }),
  }),
  'ha.room': {
    cat: 'home', sizes: ['m', 't', 'l'], def: 'm', cells: [3, 3, 8, 8], side: true, edition: 'local', feature: 'haWidgets', controls: true, private: true,
    ha: { domains: DOMAINS.tile, max: 6 },
    defaults: () => ({ title: '', rows: [] }),
    props: (c, p, x) => ({
      title: P.str(c, `${p}.title`, x.title, '', 40),
      rows: P.list(c, `${p}.rows`, x.rows, 6, (r, q) => ({ entity: P.entity(c, `${q}.entity`, r.entity, DOMAINS.tile), name: P.str(c, `${q}.name`, r.name, '', 40), interactive: P.bool(c, `${q}.interactive`, r.interactive, true) })),
    }),
  },
  'ha.chart': {
    cat: 'home', sizes: ['w', 'm', 'l', 'xl'], def: 'm', cells: [4, 2, 12, 8], side: true, edition: 'local', feature: 'haWidgets', perScreen: 4, private: true,
    ha: { domains: DOMAINS.chart, max: 4 },
    defaults: () => ({ series: [], period: '24h', type: 'line', chartStyle: 'below' }),
    props: (c, p, x) => ({
      series: P.list(c, `${p}.series`, x.series, 4, (s, q) => ({ entity: P.entity(c, `${q}.entity`, s.entity, DOMAINS.chart), label: P.str(c, `${q}.label`, s.label, '', 40), color: P.color(c, `${q}.color`, s.color) })),
      period: P.oneOf(c, `${p}.period`, x.period, '24h', ['1h', '6h', '24h', '7d']),
      type: P.oneOf(c, `${p}.type`, x.type, 'line', ['line', 'area', 'bar']),
      chartStyle: P.oneOf(c, `${p}.chartStyle`, x.chartStyle, 'below', CHART_STYLES),
    }),
  },
  'ha.camera': {
    cat: 'home', sizes: ['s', 'm', 'l', 'xl', 'full'], def: 'l', cells: [2, 2, 12, 8], side: false, edition: 'local', feature: 'cameraWidgets', perScreen: 4, private: true,
    ha: { domains: DOMAINS.camera, max: 2 },
    defaults: () => ({ entity: '', mode: 'snapshot', everySec: 5, fit: 'cover', label: true, showWhen: null }),
    props: (c, p, x, _refs, opts) => {
      let mode = P.oneOf(c, `${p}.mode`, x.mode, 'snapshot', ['snapshot', 'live']);
      if (mode === 'live' && opts.cameraLive === false) mode = 'snapshot';
      const sw = x.showWhen ? P.entity(c, `${p}.showWhen`, x.showWhen, ['binary_sensor']) : '';
      return {
        entity: P.entity(c, `${p}.entity`, x.entity, DOMAINS.camera),
        mode,
        everySec: P.num(c, `${p}.everySec`, x.everySec, 5, 2, 60),
        fit: P.oneOf(c, `${p}.fit`, x.fit, 'cover', ['cover', 'contain']),
        label: P.bool(c, `${p}.label`, x.label, true),
        showWhen: sw || null,
      };
    },
  },
  'ha.media': haKind(['s', 'w', 'm'], 'w', [3, 2, 8, 8], 'media', { controls: true, one: true, state: true }),
  'ha.scene': {
    cat: 'home', sizes: ['xs', 's', 'w'], def: 's', cells: [2, 2, 12, 6], side: true, edition: 'local', feature: 'haWidgets', controls: true, private: true,
    ha: { domains: DOMAINS.scene, max: 6 },
    defaults: () => ({ buttons: [] }),
    props: (c, p, x) => ({
      buttons: P.list(c, `${p}.buttons`, x.buttons, 6, (b, q) => ({ entity: P.entity(c, `${q}.entity`, b.entity, DOMAINS.scene), label: P.str(c, `${q}.label`, b.label, '', 40), icon: P.str(c, `${q}.icon`, b.icon, '', 8) })),
    }),
  },
  // ---- Avanzado
  html: {
    cat: 'adv', sizes: SIZES_BUT_BAND, def: 'm', cells: [2, 2, 12, 8], side: true, edition: 'local', feature: 'customWidgets', perScreen: 3, private: true,
    defaults: () => ({ html: '', css: '', bind: [], refreshSec: 60 }),
    props: (c, p, x) => {
      const css = P.str(c, `${p}.css`, x.css, '', 8000);
      const html = P.str(c, `${p}.html`, x.html, '', 8000);
      const names = new Set();
      const bind = P.list(c, `${p}.bind`, x.bind, 8, (b, q) => {
        const name = P.str(c, `${q}.name`, b.name, '', 24).trim();
        if (!/^[a-z][a-z0-9_]{0,23}$/i.test(name)) {
          c.err(`${q}.name`, 'invalid name');
          return null;
        }
        if (names.has(name)) {
          c.err(`${q}.name`, `repeated name ${name}`);
          return null;
        }
        names.add(name);
        // one source each: a built-in, a Home Assistant entity ('' = not chosen yet) or a Valor key
        const out = { name };
        if (b.builtin !== undefined && b.builtin !== null) out.builtin = P.oneOf(c, `${q}.builtin`, b.builtin, 'time', CARD_BUILTINS);
        else if (b.value !== undefined && b.value !== null) {
          const key = P.str(c, `${q}.value`, b.value, '', 40).trim();
          if (key && !VALUE_KEY_RE.test(key)) c.err(`${q}.value`, 'invalid key (a-z, 0-9, _ . -)');
          out.value = VALUE_KEY_RE.test(key) ? key : '';
        } else out.entity = P.entity(c, `${q}.entity`, b.entity, null);
        return out;
      });
      // the allowlist: anything outside it is an error that names it, and the card keeps nothing of what was refused
      const errors = checkCard(html, '', [...names]);
      for (const e of errors) c.err(`${p}.html`, `${cardErrorText(e)}${e.line ? ` (line ${e.line})` : ''}`);
      const bad = cssProblem(css);
      if (bad) c.err(`${p}.css`, `not allowed: ${bad}`);
      return {
        html: errors.length ? '' : html,
        css: bad ? '' : css,
        bind,
        refreshSec: P.num(c, `${p}.refreshSec`, x.refreshSec, 60, 5, 3600),
      };
    },
  },
  // the declarative card of a later version: kept in the model so it needs no migration, refused today
  card: {
    cat: 'adv', sizes: SIZES_BUT_BAND, def: 'm', cells: [1, 1, 12, 8], side: true, edition: 'all', reserved: true,
    defaults: () => ({}),
    props: () => ({}),
  },
};

/** A bar's two ends (0 to 100 by default), the lower first, never the same. */
function rangeOf(c, p, a, b, ka, kb) {
  const x = P.num(c, `${p}.${ka}`, a, 0, -1e9, 1e9, false);
  const y = P.num(c, `${p}.${kb}`, b, 100, -1e9, 1e9, false);
  const lo = Math.min(x, y);
  const hi = Math.max(x, y);
  return [lo, hi > lo ? hi : lo + 1];
}

/** Two breakpoints of a value's colour (ok below the first, warn between, err above the second), or null. */
function thresholdsOf(c, path, v) {
  if (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))) return [Math.min(...v), Math.max(...v)];
  if (v !== undefined && v !== null) c.err(path, 'expected two numbers');
  return null;
}

/** A Home Assistant kind bound to one entity (`one`) of a domain list, plus its own options. */
function haKind(sizes, def, cells, domains, { controls = false, one = true, bigType = false, perScreen = undefined, state = false, extra = null } = {}) {
  const ds = DOMAINS[domains];
  return {
    cat: 'home', sizes, def, cells, side: true, edition: 'local', feature: 'haWidgets', controls, bigType, private: true, ...(perScreen ? { perScreen } : {}),
    ha: { domains: ds, max: one ? 1 : 6 },
    // showName / showState: the owner's "Mostrar nombre" and "Mostrar estado" (the state line of the cards that have one)
    defaults: () => ({ entity: '', name: '', icon: '', showName: true, ...(state ? { showState: true } : {}), ...(extra ? extra({ err() {} }, '', {}) : {}) }),
    props: (c, p, x, refs, opts) => ({
      entity: P.entity(c, `${p}.entity`, x.entity, ds),
      name: P.str(c, `${p}.name`, x.name, '', 40),
      icon: P.str(c, `${p}.icon`, x.icon, '', 8),
      showName: P.bool(c, `${p}.showName`, x.showName, true),
      ...(state ? { showState: P.bool(c, `${p}.showState`, x.showState, true) } : {}),
      ...(extra ? extra(c, p, x, refs, opts) : {}),
    }),
  };
}

/** Why a custom card's CSS is refused ('' = fine): see cardTemplate.js. */
export { cssProblem };

export const CANVAS_KIND_IDS = Object.keys(CANVAS_KINDS);
/** Kinds a server allows by default: every kind but the reserved ones. */
export const DEFAULT_CANVAS_KINDS = CANVAS_KIND_IDS.filter((k) => !CANVAS_KINDS[k].reserved);
/** Kinds Marco Cloud allows: no Home Assistant and no custom HTML. */
export const CLOUD_CANVAS_KINDS = DEFAULT_CANVAS_KINDS.filter((k) => CANVAS_KINDS[k].edition === 'all');
/** Palette categories, in order. */
export const CANVAS_CATEGORIES = ['time', 'calendar', 'weather', 'content', 'family', 'home', 'data', 'adv'];

/** Props of a new item of `kind`. */
export function canvasDefaults(kind) {
  return CANVAS_KINDS[kind] ? structuredClone(CANVAS_KINDS[kind].defaults()) : {};
}

// ---- defaults ----------------------------------------------------------------------------------------------------

export function defaultItemStyle() {
  return { surface: 'inherit', glass: null, color: null, accent: null, radius: 'inherit', title: '', icon: '', showTitle: false, scale: 1 };
}

/** A screen's canvas before anything is placed (inert on every other layout). */
export function defaultCanvas() {
  return {
    v: 1, background: 'ambient', dim: 0.15, scrim: 'uniform', color: null, sidebar: { side: 'none', size: 'normal', fill: 'glass' },
    defaults: { surface: 'glass', radius: 'l' }, touch: false, perf: 'auto', portraitAuto: true, items: [],
  };
}

/** A fresh item id (cv_ + 8 base-36 characters). */
export function newCanvasId(taken = new Set()) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    const b = new Uint8Array(8);
    globalThis.crypto.getRandomValues(b);
    let s = 'cv_';
    for (const x of b) s += abc[x % 36];
    if (!taken.has(s)) return s;
  }
}

// ---- placement ---------------------------------------------------------------------------------------------------

/** Occupancy of a grid: cells[y][x] = item id or null. */
export function makeOccupancy(orientation = 'landscape') {
  const { cols, rows } = CANVAS_GRID[orientation === 'portrait' ? 'portrait' : 'landscape'];
  return { cols, rows, orientation, cells: Array.from({ length: rows }, () => new Array(cols).fill(null)) };
}
export function fitsAt(occ, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > occ.cols || y + h > occ.rows) return false;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (occ.cells[j][i]) return false;
  return true;
}
export function occupy(occ, id, x, y, w, h) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) occ.cells[j][i] = id;
}
/** The free origin nearest to (x, y) for a w×h box (Manhattan distance, then the upper one, then the left one). */
export function nearestFree(occ, x, y, w, h) {
  let best = null;
  for (let j = 0; j + h <= occ.rows; j++) {
    for (let i = 0; i + w <= occ.cols; i++) {
      if (!fitsAt(occ, i, j, w, h)) continue;
      const d = Math.abs(i - x) + Math.abs(j - y);
      if (!best || d < best.d || (d === best.d && (j < best.y || (j === best.y && i < best.x)))) best = { x: i, y: j, d };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}
/** The first free origin scanning rows (portrait derivation, items added with no position). */
export function firstFree(occ, w, h) {
  for (let j = 0; j + h <= occ.rows; j++) for (let i = 0; i + w <= occ.cols; i++) if (fitsAt(occ, i, j, w, h)) return { x: i, y: j };
  return null;
}

// ---- validation --------------------------------------------------------------------------------------------------

function sanitizeStyle(c, p, raw) {
  const D = defaultItemStyle();
  const x = isObj(raw) ? raw : {};
  if (raw !== undefined && !isObj(raw)) c.err(p, 'expected object');
  let glass = null;
  if (isObj(x.glass)) glass = normalizeGlassJs(x.glass, true);
  else if (x.glass !== undefined && x.glass !== null) c.err(`${p}.glass`, 'expected object');
  return {
    surface: P.oneOf(c, `${p}.surface`, x.surface, D.surface, ['inherit', ...CANVAS_SURFACES]),
    glass,
    color: P.color(c, `${p}.color`, x.color),
    accent: P.color(c, `${p}.accent`, x.accent),
    radius: P.oneOf(c, `${p}.radius`, x.radius, D.radius, ['inherit', ...CANVAS_RADII]),
    title: P.str(c, `${p}.title`, x.title, '', 40),
    icon: P.str(c, `${p}.icon`, x.icon, '', 8),
    showTitle: P.bool(c, `${p}.showTitle`, x.showTitle, false),
    scale: Math.round(P.num(c, `${p}.scale`, x.scale, 1, 0.7, 1.5, false) * 20) / 20,
  };
}

/**
 * The glass material rules of web/shared/glass.ts normalizeGlass (kept equal; this file must stay plain JS).
 * `card`: a canvas item's own glass, which also takes tint 'auto' (light or dark after the photo behind the card).
 */
export function normalizeGlassJs(raw, card = false) {
  const g = isObj(raw) ? raw : {};
  const n = (v, min, max, d) => {
    const x = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(x) ? d : Math.min(max, Math.max(min, x));
  };
  return {
    appearance: g.appearance === 'clear' || g.appearance === 'tinted' ? g.appearance : 'auto',
    opacity: n(g.opacity, 0, 1, 0.5),
    blur: Math.round(n(g.blur, 0, 40, 18)),
    tint: g.tint === 'light' || g.tint === 'photo' || (card && g.tint === 'auto') ? g.tint : 'dark',
    edge: g.edge !== false,
  };
}

/** The screen glass every style starts with (web/shared/glass.ts GLASS_DEFAULTS, server/core/defaults.js). */
export const SCREEN_GLASS_DEFAULTS = Object.freeze({ appearance: 'auto', opacity: 0.5, blur: 18, tint: 'dark', edge: true });
/**
 * The card glass of a new Personalizado screen ("Estilo por defecto de las tarjetas"): more see-through and less
 * blurred than the Modern designs, so the photo or the animated background shows between the cards.
 */
export const CANVAS_GLASS_DEFAULTS = Object.freeze({ appearance: 'auto', opacity: 0.25, blur: 5, tint: 'dark', edge: true });

/** The screen's glass was never changed (missing, or every setting as SCREEN_GLASS_DEFAULTS). */
export function glassUntouched(raw) {
  if (raw === undefined || raw === null) return true;
  const g = normalizeGlassJs(raw);
  return Object.keys(SCREEN_GLASS_DEFAULTS).every((k) => g[k] === SCREEN_GLASS_DEFAULTS[k]);
}

/**
 * A screen ({ layout, canvas, screen }) about to become Personalizado for the first time (another layout now and
 * no card on its grid yet) whose glass was never changed gets CANVAS_GLASS_DEFAULTS. Changes `screen` in place;
 * true when it did. Call it before the layout is set to 'canvas'.
 */
export function startCanvasGlass(screen) {
  if (!isObj(screen) || !isObj(screen.screen)) return false;
  if (screen.layout?.preset === 'canvas' || screen.canvas?.items?.length) return false;
  if (!glassUntouched(screen.screen.glass)) return false;
  screen.screen.glass = { ...CANVAS_GLASS_DEFAULTS };
  return true;
}

/**
 * The same on a save (server side, for every client): each screen of `next` that is Personalizado now while it was
 * another layout with an empty grid in `prev` gets CANVAS_GLASS_DEFAULTS when its glass is untouched. Screens new
 * in `next` are left alone (a copy of another screen keeps that screen's glass). Changes `next`; the ids it changed.
 */
export function startCanvasGlassOnSave(prev, next) {
  const out = [];
  if (!Array.isArray(prev?.screens) || !Array.isArray(next?.screens)) return out;
  for (const s of next.screens) {
    if (s?.layout?.preset !== 'canvas' || !isObj(s.screen)) continue;
    const was = prev.screens.find((x) => x?.id === s.id);
    if (!was || !startCanvasGlass({ layout: was.layout, canvas: was.canvas, screen: s.screen })) continue;
    out.push(s.id);
  }
  return out;
}

/** A raw position: { zone:'main', x, y, size, w?, h? } or { zone:'side', order, span }; null when unusable. */
function readPos(c, p, raw) {
  if (!isObj(raw)) {
    if (raw !== undefined) c.err(p, 'expected object');
    return null;
  }
  if (raw.zone === 'side') {
    const span = SIDE_SPANS.includes(raw.span) ? raw.span : 2;
    if (!SIDE_SPANS.includes(raw.span)) c.err(`${p}.span`, 'must be one of 2, 3, 4, fill');
    return { zone: 'side', order: Number.isFinite(raw.order) ? raw.order : 0, span };
  }
  const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);
  if (raw.zone !== undefined && raw.zone !== 'main') c.err(`${p}.zone`, 'must be one of main, side');
  const pos = { zone: 'main', x: int(raw.x), y: int(raw.y), size: typeof raw.size === 'string' ? raw.size : '' };
  // a box of its own: w and h in whole cells (placeMain clamps them to the kind's range)
  if (raw.w !== undefined || raw.h !== undefined) {
    const cell = (v) => Number.isInteger(v) && v >= 1 && v <= 12;
    if (cell(raw.w) && cell(raw.h)) {
      pos.w = raw.w;
      pos.h = raw.h;
    } else c.err(`${p}.w`, 'w and h must both be whole cells (1 to 12)');
  }
  return pos;
}

/**
 * Place the main-zone items of `list` ({ item, pos, path }) on one orientation's grid, in order: a size the kind
 * does not allow becomes its default, the box is clamped inside the grid, and an item that overlaps an earlier one
 * moves to the nearest free spot (with a warning). With no free spot at all it is dropped (an error). Returns the
 * ids that were dropped.
 */
function placeMain(c, list, orientation, key) {
  const occ = makeOccupancy(orientation);
  const dropped = new Set();
  for (const { item, path } of list) {
    const pos = item[key];
    const k = CANVAS_KINDS[item.kind];
    if (pos.w !== undefined) {
      // its own box: clamped to the kind's range, stored as a named size when it is exactly one
      const r = cellRange(k, orientation);
      const box = boxOf(k, pos.w, pos.h, orientation);
      const [bw, bh] = posCells(box, orientation);
      if (bw !== pos.w || bh !== pos.h) warnOf(c, `${path}.w`, `${pos.w}×${pos.h} not allowed for ${item.kind} (${r.minW}×${r.minH} to ${r.maxW}×${r.maxH}), ${bw}×${bh} used`);
      delete pos.w;
      delete pos.h;
      Object.assign(pos, box);
    } else if (!k.sizes.includes(pos.size)) {
      if (pos.size) warnOf(c, `${path}.size`, `size not allowed for ${item.kind}, ${k.def} used`);
      pos.size = k.def;
    }
    const [w, h] = posCells(pos, orientation);
    pos.x = Math.min(Math.max(0, pos.x), occ.cols - w);
    pos.y = Math.min(Math.max(0, pos.y), occ.rows - h);
    if (!fitsAt(occ, pos.x, pos.y, w, h)) {
      const spot = nearestFree(occ, pos.x, pos.y, w, h);
      if (!spot) {
        c.err(path, 'no free space on the grid');
        dropped.add(item.id);
        continue;
      }
      warnOf(c, path, 'overlapped another widget, moved');
      pos.x = spot.x;
      pos.y = spot.y;
    }
    occupy(occ, item.id, pos.x, pos.y, w, h);
  }
  return dropped;
}

/**
 * The sidebar stack of one orientation: order renumbered 0..n-1, at most one fill, spans clamped so the total stays
 * within SIDE_UNITS. Returns the items that did not fit (they go to the main area).
 */
function stackSide(list, key) {
  list.sort((a, b) => a.item[key].order - b.item[key].order);
  let used = 0;
  let fill = false;
  const out = [];
  for (const it of list) {
    const pos = it.item[key];
    if (pos.span === 'fill') {
      if (!fill) {
        fill = true;
        continue;
      }
      pos.span = 2;
    }
    const room = SIDE_UNITS - used;
    if (room < 2) {
      out.push(it);
      continue;
    }
    if (pos.span > room) pos.span = [4, 3, 2].find((s) => s <= room);
    used += pos.span;
  }
  const keep = list.filter((it) => !out.includes(it));
  keep.forEach((it, i) => {
    it.item[key].order = i;
  });
  return out;
}

/** Sidebar side on a portrait screen: left goes on top, right at the bottom. */
export function portraitSide(side) {
  return side === 'left' ? 'top' : side === 'right' ? 'bottom' : side;
}

/**
 * Validate a screen's `canvas` (called from validate.js sanitizeScreenProfile). `c` collects errors (err) and,
 * when it can, warnings (warn); `p` is the path prefix. `refs` = { sourceIds: Set of the screen's calendars,
 * widgets: Map id → widget def, memberIds: Set of family member ids }. `opts` = { canvasKinds, haControls,
 * cameraLive } (defaults: every kind but the reserved ones, true, true).
 */
export function sanitizeCanvas(c, p, raw, refs = {}, opts = {}) {
  const D = defaultCanvas();
  if (raw === undefined || raw === null) return D;
  if (!isObj(raw)) {
    c.err(p, 'expected object');
    return D;
  }
  if (raw.v !== undefined && raw.v !== 1) {
    warnOf(c, `${p}.v`, 'unknown canvas version, reset');
    return D;
  }
  const allowed = new Set(opts.canvasKinds ?? DEFAULT_CANVAS_KINDS);
  const haControls = opts.haControls !== false;
  // conditions on Home Assistant only where its cards are allowed (never on Marco Cloud); Valor ones everywhere
  const haConds = [...allowed].some((k) => k.startsWith('ha.'));
  const sb = isObj(raw.sidebar) ? raw.sidebar : {};
  const df = isObj(raw.defaults) ? raw.defaults : {};
  const background = P.oneOf(c, `${p}.background`, raw.background, D.background, CANVAS_BACKGROUNDS);
  const sidebar = {
    side: P.oneOf(c, `${p}.sidebar.side`, sb.side, D.sidebar.side, SIDEBAR_SIDES),
    size: P.oneOf(c, `${p}.sidebar.size`, sb.size, D.sidebar.size, SIDEBAR_SIZES),
    fill: P.oneOf(c, `${p}.sidebar.fill`, sb.fill, D.sidebar.fill, SIDEBAR_FILLS),
  };
  // the photo cannot be both behind the whole screen and in the sidebar alone
  if (sidebar.fill === 'photo' && background === 'photo') sidebar.fill = 'glass';
  const out = {
    v: 1,
    background,
    dim: Math.round(P.num(c, `${p}.dim`, raw.dim, D.dim, 0, 0.6, false) * 100) / 100,
    scrim: P.oneOf(c, `${p}.scrim`, raw.scrim, D.scrim, CANVAS_SCRIMS),
    color: P.color(c, `${p}.color`, raw.color),
    sidebar,
    defaults: {
      surface: P.oneOf(c, `${p}.defaults.surface`, df.surface, D.defaults.surface, CANVAS_SURFACES),
      radius: P.oneOf(c, `${p}.defaults.radius`, df.radius, D.defaults.radius, CANVAS_RADII),
    },
    touch: P.bool(c, `${p}.touch`, raw.touch, D.touch),
    perf: P.oneOf(c, `${p}.perf`, raw.perf, D.perf, ['auto', 'low']),
    portraitAuto: P.bool(c, `${p}.portraitAuto`, raw.portraitAuto, D.portraitAuto),
    items: [],
  };

  // ---- items: kind, id, props and style first
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  if (raw.items !== undefined && !Array.isArray(raw.items)) c.err(`${p}.items`, 'expected array');
  const seen = new Set();
  const counts = {};
  const entities = new Set();
  let live = 0;
  const items = [];
  rawItems.forEach((x, i) => {
    const q = `${p}.items[${i}]`;
    if (!isObj(x)) return c.err(q, 'expected object');
    const k = CANVAS_KINDS[x.kind];
    // a kind this version does not know: dropped quietly (an import from a newer server)
    if (!k) return;
    if (k.reserved) return c.err(`${q}.kind`, 'not available in this version');
    if (!allowed.has(x.kind)) return c.err(`${q}.kind`, 'not available on this server');
    if (items.length >= CANVAS_LIMITS.items) return c.err(`${p}.items`, `too many items (max ${CANVAS_LIMITS.items})`);
    if (k.perScreen && (counts[x.kind] ?? 0) >= k.perScreen) return c.err(`${q}.kind`, `too many ${x.kind} (max ${k.perScreen})`);
    const props = k.props(c, `${q}.props`, isObj(x.props) ? x.props : {}, refs, opts);
    if (x.kind === 'widget' && !(refs.widgets instanceof Map ? refs.widgets.has(props.widgetId) : false)) return; // its widget was deleted
    if (x.kind === 'ha.camera' && props.mode === 'live') {
      if (live >= CANVAS_LIMITS.liveCameras) props.mode = 'snapshot';
      else live++;
    }
    // HA entities: at most CANVAS_LIMITS.haEntities different ones per screen
    for (const e of haEntitiesOf({ kind: x.kind, props })) {
      if (entities.has(e)) continue;
      if (entities.size >= CANVAS_LIMITS.haEntities) {
        c.err(`${q}.props`, `too many Home Assistant entities (max ${CANVAS_LIMITS.haEntities})`);
        return;
      }
      entities.add(e);
    }
    counts[x.kind] = (counts[x.kind] ?? 0) + 1;
    let id = typeof x.id === 'string' && CANVAS_ID_RE.test(x.id) && !seen.has(x.id) ? x.id : '';
    if (!id) id = newCanvasId(seen);
    seen.add(id);
    const item = { id, kind: x.kind, pos: null, style: sanitizeStyle(c, `${q}.style`, x.style), props };
    if (k.controls) item.interactive = haControls ? P.bool(c, `${q}.interactive`, x.interactive, true) : false;
    if (k.controls) {
      // an entity that looks like a door: two taps always, and it works only once the owner ticked that anyone in
      // the room may use it (`ack`)
      const flagged = itemNames({ kind: x.kind, props }).some((b) => needsConfirm(b.entity.split('.')[0], null, b.entity, b.name));
      item.confirm = flagged || P.bool(c, `${q}.confirm`, x.confirm, false);
      if (P.bool(c, `${q}.ack`, x.ack, false)) item.ack = true;
    }
    // "Ocultar sin borrar": kept in its place, not drawn on the screen
    if (P.bool(c, `${q}.hidden`, x.hidden, false)) item.hidden = true;
    // "Horario": shown only on some days and times (the rule shape of privacy schedules)
    const schedule = readSchedule(c, `${q}.schedule`, x.schedule);
    if (schedule) item.schedule = schedule;
    // "Mostrar solo si": a Home Assistant state or a Valor value decides whether it is drawn now
    const when = readCondition(c, `${q}.when`, x.when, { ha: haConds });
    if (when) {
      if (when.src === 'ha' && when.entity && !entities.has(when.entity)) {
        if (entities.size >= CANVAS_LIMITS.haEntities) {
          c.err(`${q}.when`, `too many Home Assistant entities (max ${CANVAS_LIMITS.haEntities})`);
          when.entity = '';
        } else entities.add(when.entity);
      }
      item.when = when;
    }
    item.pos = readPos(c, `${q}.pos`, x.pos) ?? { zone: 'main', x: 0, y: 0, size: k.def };
    // null: left out of the portrait view last time (derived again below)
    if (!out.portraitAuto && x.portrait !== undefined && x.portrait !== null) item.portrait = readPos(c, `${q}.portrait`, x.portrait);
    items.push({ item, path: q });
  });

  // ---- landscape positions: the sidebar stack, then the main grid
  const sideOn = sidebar.side !== 'none';
  const toMain = (it, key) => {
    const k = CANVAS_KINDS[it.item.kind];
    it.item[key] = { zone: 'main', x: 0, y: 0, size: k.def, moved: true };
  };
  const sideL = [];
  for (const it of items) {
    if (it.item.pos.zone !== 'side') continue;
    if (!sideOn || !CANVAS_KINDS[it.item.kind].side) toMain(it, 'pos');
    else sideL.push(it);
  }
  if (sideL.length > CANVAS_LIMITS.side) {
    c.err(`${p}.items`, `too many items in the sidebar (max ${CANVAS_LIMITS.side})`);
    sideL.sort((a, b) => a.item.pos.order - b.item.pos.order);
    for (const it of sideL.splice(CANVAS_LIMITS.side)) toMain(it, 'pos');
  }
  for (const it of stackSide(sideL, 'pos')) toMain(it, 'pos');
  // items moved out of the sidebar look for room after the ones placed by the owner (nearest to the top left)
  const mainL = [...items.filter((it) => it.item.pos.zone === 'main' && !it.item.pos.moved), ...items.filter((it) => it.item.pos.moved)];
  for (const it of mainL) delete it.item.pos.moved;
  const droppedL = placeMain(c, mainL, 'landscape', 'pos');

  // ---- portrait positions (only when the owner arranged portrait by hand)
  let kept = items.filter((it) => !droppedL.has(it.item.id));
  if (!out.portraitAuto) {
    const derived = new Map(deriveCanvasPortrait(kept.map((it) => it.item), sidebar).placed.map((d) => [d.id, d.pos]));
    for (const it of kept) {
      if (!it.item.portrait) it.item.portrait = derived.get(it.item.id) ?? null;
      if (!it.item.portrait) continue;
      if (it.item.portrait.zone === 'side' && (!sideOn || !CANVAS_KINDS[it.item.kind].side)) toMain(it, 'portrait');
    }
    const sideP = kept.filter((it) => it.item.portrait?.zone === 'side');
    for (const it of sideP.splice(CANVAS_LIMITS.side)) toMain(it, 'portrait');
    for (const it of stackSide(sideP, 'portrait')) toMain(it, 'portrait');
    const mainP = [...kept.filter((it) => it.item.portrait?.zone === 'main' && !it.item.portrait.moved), ...kept.filter((it) => it.item.portrait?.moved)];
    for (const it of mainP) delete it.item.portrait.moved;
    // a portrait spot that cannot be found leaves the item out of the portrait view (it stays on landscape)
    const pc = { err: (path, m) => warnOf(c, `${path}.portrait`, m), warn: (path, m) => warnOf(c, path, m) };
    const droppedP = placeMain(pc, mainP.map((it) => ({ item: it.item, path: it.path })), 'portrait', 'portrait');
    for (const it of kept) if (droppedP.has(it.item.id) || !it.item.portrait) it.item.portrait = null;
  }
  kept = kept.map((it) => it.item);
  for (const it of kept) if (it.portrait === undefined) delete it.portrait;
  out.items = kept;
  return out;
}

// ---- conditions ("Mostrar solo si") -------------------------------------------------------------------------------

/**
 * An item's condition: { src: 'ha', entity, op, value } or { src: 'value', key, op, value }, or null. `op` is eq, ne,
 * gt or lt; `value` is text (a number for gt and lt). An entity or a key not chosen yet ('') keeps the condition
 * while it is being written, and it shows the item. `ha: false` (Marco Cloud): only Valor conditions.
 */
export function readCondition(c, p, raw, { ha = true } = {}) {
  if (raw === undefined || raw === null) return null;
  if (!isObj(raw)) {
    c.err(p, 'expected object');
    return null;
  }
  const op = P.oneOf(c, `${p}.op`, raw.op, 'eq', CONDITION_OPS);
  const v0 = typeof raw.value === 'number' && Number.isFinite(raw.value) ? String(raw.value) : typeof raw.value === 'boolean' ? String(raw.value) : raw.value;
  const value = P.str(c, `${p}.value`, v0, '', 60).trim();
  if ((op === 'gt' || op === 'lt') && condNum(value) === null) {
    c.err(`${p}.value`, 'expected a number');
    return null;
  }
  if (raw.src === 'ha') {
    if (!ha) {
      c.err(`${p}.src`, 'not available on this server');
      return null;
    }
    return { src: 'ha', entity: P.entity(c, `${p}.entity`, raw.entity, null), op, value };
  }
  if (raw.src === 'value') {
    let key = P.str(c, `${p}.key`, raw.key, '', 40).trim();
    if (key && !VALUE_KEY_RE.test(key)) {
      c.err(`${p}.key`, 'invalid key (a-z, 0-9, _ . -)');
      key = '';
    }
    return { src: 'value', key, op, value };
  }
  c.err(`${p}.src`, 'must be one of ha, value');
  return null;
}

/** A number written as text ('21.5', '21,5', '-3'), or null. */
function condNum(v) {
  const s = String(v ?? '').trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const TRUE_WORDS = ['true', 'on', '1', 'yes', 'si', 'sí'];
const FALSE_WORDS = ['false', 'off', '0', 'no'];

/**
 * True when `when` holds for `raw` (a Home Assistant state string, or a Valor value): equals and not equals compare
 * numbers as numbers and text without case (a Valor true/false also matches on/off), above and below need numbers.
 * Nothing known (null or undefined) never holds, so the item stays hidden until its state comes. A condition with
 * no entity or key yet always holds.
 */
export function conditionMet(when, raw) {
  if (!when) return true;
  if ((when.src === 'ha' && !when.entity) || (when.src === 'value' && !when.key)) return true;
  if (raw === undefined || raw === null) return false;
  const want = String(when.value ?? '').trim();
  if (typeof raw === 'boolean') {
    const w = want.toLowerCase();
    const is = TRUE_WORDS.includes(w) ? true : FALSE_WORDS.includes(w) ? false : null;
    if (when.op === 'gt' || when.op === 'lt') return false;
    const eq = is !== null && is === raw;
    return when.op === 'eq' ? eq : !eq;
  }
  const got = String(raw).trim();
  const a = condNum(got);
  const b = condNum(want);
  if (when.op === 'gt' || when.op === 'lt') {
    if (a === null || b === null) return false;
    return when.op === 'gt' ? a > b : a < b;
  }
  const eq = a !== null && b !== null ? a === b : got.toLowerCase() === want.toLowerCase();
  return when.op === 'eq' ? eq : !eq;
}

/** The entities the conditions of a screen's items read (shown items only). */
export function conditionEntities(screen) {
  const out = new Set();
  if (screen?.layout?.preset !== 'canvas') return out;
  for (const it of screen.canvas?.items ?? []) if (!it.hidden && it.when?.src === 'ha' && it.when.entity) out.add(it.when.entity);
  return out;
}

/** The Valor keys the conditions of a screen's items read (shown items only). */
export function conditionKeys(screen) {
  const out = new Set();
  if (screen?.layout?.preset !== 'canvas') return out;
  for (const it of screen.canvas?.items ?? []) if (!it.hidden && it.when?.src === 'value' && it.when.key) out.add(it.when.key);
  return out;
}

/**
 * The items of a screen its conditions hide right now: `ha(entity)` gives the entity's state string (null when not
 * known), `value(key)` a Valor value (null when none). On a private screen every item with a condition is hidden
 * (what it would say about the house is not shown either).
 */
export function conditionHidden(screen, { ha = () => null, value = () => null, isPrivate = false } = {}) {
  const out = new Set();
  if (screen?.layout?.preset !== 'canvas') return out;
  for (const it of screen.canvas?.items ?? []) {
    const w = it.when;
    if (it.hidden || !w) continue;
    if ((w.src === 'ha' && !w.entity) || (w.src === 'value' && !w.key)) continue;
    if (isPrivate || !conditionMet(w, w.src === 'ha' ? ha(w.entity) : value(w.key))) out.add(it.id);
  }
  return out;
}

// ---- visibility schedule ("Horario") --------------------------------------------------------------------------

const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/**
 * An item's visibility schedule: up to ITEM_SCHEDULE_MAX windows { id, enabled, days, from, to } (days 0 = Sunday,
 * [] = every day; `to < from` crosses midnight and belongs to the day it starts), the rule shape of privacy
 * schedules. null when there is none (an empty list too).
 */
export function readSchedule(c, p, raw) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    c.err(p, 'expected array');
    return null;
  }
  if (raw.length > ITEM_SCHEDULE_MAX) c.err(p, `too many time windows (max ${ITEM_SCHEDULE_MAX})`);
  const out = [];
  const seen = new Set();
  raw.slice(0, ITEM_SCHEDULE_MAX).forEach((r, i) => {
    const q = `${p}[${i}]`;
    if (!isObj(r)) return c.err(q, 'expected object');
    let id = typeof r.id === 'string' && /^p_[A-Za-z0-9_-]{1,40}$/.test(r.id) && !seen.has(r.id) ? r.id : '';
    for (let n = out.length; !id; n++) if (!seen.has(`p_${n}`)) id = `p_${n}`;
    seen.add(id);
    const hhmm = (k, d) => {
      const v = r[k];
      if (v === undefined || v === null || v === '') return d;
      if (typeof v === 'string' && HHMM_RE.test(v)) return v;
      c.err(`${q}.${k}`, 'expected HH:MM');
      return d;
    };
    let days = [];
    if (r.days !== undefined && r.days !== null) {
      if (!Array.isArray(r.days)) c.err(`${q}.days`, 'expected array');
      else days = [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    }
    const rule = { id, enabled: P.bool(c, `${q}.enabled`, r.enabled, true), days, from: hhmm('from', '08:00'), to: hhmm('to', '20:00') };
    if (rule.from === rule.to) c.err(`${q}.to`, 'must differ from `from`');
    out.push(rule);
  });
  return out.length ? out : null;
}

/** True when an item's schedule lets it show at `now` in `tz` (no schedule, or every window paused: always). */
export function scheduleOn(item, now = new Date(), tz = 'UTC') {
  const rules = enabledWindows(item?.schedule);
  if (!rules.length) return true;
  return windowState(rules, now, tz).active;
}

/** The ids of a screen's items their schedule hides at `now` (items hidden by hand are not counted). */
export function scheduleHidden(screen, now = new Date(), tz = 'UTC') {
  const out = new Set();
  if (screen?.layout?.preset !== 'canvas') return out;
  for (const it of screen.canvas?.items ?? []) if (!it.hidden && !scheduleOn(it, now, tz)) out.add(it.id);
  return out;
}

/** The next instant (ms) after `now` where a schedule of a screen's items starts or ends, or null. */
export function scheduleNext(screen, now = new Date(), tz = 'UTC') {
  if (screen?.layout?.preset !== 'canvas') return null;
  let best = null;
  for (const it of screen.canvas?.items ?? []) {
    if (it.hidden) continue;
    const n = nextWindowBoundary(enabledWindows(it.schedule), now, tz);
    if (n !== null && (best === null || n < best)) best = n;
  }
  return best;
}

/** Every HA entity id an item binds (empty for other kinds). */
export function haEntitiesOf(item) {
  const p = item.props || {};
  const out = [];
  const add = (e) => {
    if (typeof e === 'string' && e) out.push(e);
  };
  if (!item.kind?.startsWith('ha.') && item.kind !== 'html') return out;
  add(p.entity);
  add(p.showWhen);
  for (const r of p.rows ?? []) add(r.entity);
  for (const s of p.series ?? []) add(s.entity);
  for (const b of p.buttons ?? []) add(b.entity);
  for (const b of item.kind === 'html' ? p.bind ?? [] : []) add(b.entity);
  return out;
}

// ---- portrait derivation -----------------------------------------------------------------------------------------

/**
 * The portrait arrangement derived from the landscape one (canvas.portraitAuto): main items by (y, x) at the first
 * free spot of the 8×12 grid, keeping their size (their own box at most 8 wide, else their named size, else the kind's default, else 's'); sidebar items keep their place
 * in the stack. Deterministic, so the admin, the server and the display agree. Returns { placed: [{ id, pos }],
 * omitted: [id] } (items that do not fit).
 */
export function deriveCanvasPortrait(items, _sidebar) {
  const occ = makeOccupancy('portrait');
  const placed = [];
  const omitted = [];
  const main = items.filter((it) => it.pos?.zone === 'main').slice().sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  for (const it of main) {
    const k = CANVAS_KINDS[it.kind];
    const named = [...new Set([it.pos.size, k?.def, 's'].filter((s) => s && (!k || k.sizes.includes(s) || s === 's')))];
    // a box of its own keeps its cells (at most the 8 columns) before the named sizes are tried
    const tries = [...(Number.isInteger(it.pos.w) && k ? [boxOf(k, Math.min(it.pos.w, CANVAS_GRID.portrait.cols), it.pos.h, 'portrait')] : []), ...named.map((size) => ({ size }))];
    let done = false;
    for (const box of tries) {
      const [w, h] = posCells(box, 'portrait');
      const spot = firstFree(occ, w, h);
      if (!spot) continue;
      occupy(occ, it.id, spot.x, spot.y, w, h);
      placed.push({ id: it.id, pos: { zone: 'main', x: spot.x, y: spot.y, ...box } });
      done = true;
      break;
    }
    if (!done) omitted.push(it.id);
  }
  for (const it of items) if (it.pos?.zone === 'side') placed.push({ id: it.id, pos: { ...it.pos } });
  return { placed, omitted };
}

// ---- projection --------------------------------------------------------------------------------------------------

/** Short, stable hash (FNV-1a, 32 bits, hex). */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Walk an item's HA bindings in alias order: `fn(entity)` returns what goes in its place. The n-th bound entity
 * (empty ones skipped) is alias `${itemId}:${n}`, in this order: entity, showWhen, rows, series, buttons, bind.
 * projectCanvas and itemAliases both use it, so the server, the admin and the display agree on every alias.
 */
function mapEntities(item, fn) {
  const p = structuredClone(item.props ?? {});
  if ('entity' in p) p.entity = fn(p.entity);
  if ('showWhen' in p) p.showWhen = fn(p.showWhen);
  if (Array.isArray(p.rows)) p.rows = p.rows.map((r) => ({ ...r, entity: fn(r.entity) }));
  if (Array.isArray(p.series)) p.series = p.series.map((s) => ({ ...s, entity: fn(s.entity) }));
  if (Array.isArray(p.buttons)) p.buttons = p.buttons.map((b) => ({ ...b, entity: fn(b.entity) }));
  if (Array.isArray(p.bind)) p.bind = p.bind.map((b) => (b.entity ? { ...b, entity: fn(b.entity) } : b));
  return p;
}

/** The bound entities of an item in alias order, each with the name the owner gave it there (or ''). */
export function itemNames(item) {
  const p = item?.props ?? {};
  const out = [];
  const add = (e, name) => {
    if (typeof e === 'string' && e) out.push({ entity: e, name: typeof name === 'string' ? name : '' });
  };
  if (!item?.kind || (!item.kind.startsWith('ha.') && item.kind !== 'html')) return out;
  add(p.entity, p.name);
  add(p.showWhen, '');
  for (const r of Array.isArray(p.rows) ? p.rows : []) add(r?.entity, r?.name);
  for (const s of Array.isArray(p.series) ? p.series : []) add(s?.entity, s?.label);
  for (const b of Array.isArray(p.buttons) ? p.buttons : []) add(b?.entity, b?.label);
  for (const b of item.kind === 'html' && Array.isArray(p.bind) ? p.bind : []) add(b?.entity, '');
  return out;
}

/** Replace an item's HA entity ids with aliases `${itemId}:${n}` (the display never sees an entity id). */
function aliasEntities(item) {
  let n = 0;
  return mapEntities(item, (e) => (e ? { a: `${item.id}:${n++}`, d: e.split('.')[0] } : null));
}

/**
 * The aliases of an item's HA entities, in the order projectCanvas numbers them: [{ alias, entity, slot }] (slot =
 * n). Only ha.* and html items bind entities.
 */
export function itemAliases(item) {
  const out = [];
  if (!item?.kind || (!item.kind.startsWith('ha.') && item.kind !== 'html')) return out;
  mapEntities(item, (e) => {
    if (typeof e === 'string' && e) out.push({ alias: `${item.id}:${out.length}`, entity: e, slot: out.length });
    return e;
  });
  return out;
}

/**
 * The `canvas` block of a display config: null unless the screen's layout is 'canvas'. Entity ids, HA URLs and
 * pictures never leave the server (aliases instead); private screens get placeholders for HA, cameras, values,
 * per-person calendars and custom cards; kinds this server does not allow get disabled 'feature'. Pure: only the
 * config decides it (the admin preview runs it too).
 * `opts` = { isPrivate, canvasKinds, haControls, members: [{ id, calendarId }] }.
 */
export function projectCanvas(screen, opts = {}) {
  if (screen?.layout?.preset !== 'canvas') return null;
  const cv = screen.canvas ?? defaultCanvas();
  const allowed = new Set(opts.canvasKinds ?? DEFAULT_CANVAS_KINDS);
  const priv = !!opts.isPrivate;
  const haControls = opts.haControls !== false;
  const touch = !!cv.touch && haControls && !priv;
  const derived = cv.portraitAuto ? new Map(deriveCanvasPortrait(cv.items, cv.sidebar).placed.map((d) => [d.id, d.pos])) : null;
  const members = new Map((opts.members ?? []).map((m) => [m.id, m.calendarId ?? null]));
  // the schedules decide at `now` in the screen's zone; the display asks again at the next change (`next`)
  const now = opts.now ?? new Date();
  const tz = opts.tz || 'UTC';
  const offNow = scheduleHidden(screen, now, tz);
  const nextMs = scheduleNext(screen, now, tz);
  // hidden items (by hand or by their schedule) keep their cells (the derivation above counts them) but are not sent
  const items = cv.items.filter((it) => !it.hidden && !offNow.has(it.id)).map((it) => {
    const k = CANVAS_KINDS[it.kind];
    let props = it.kind.startsWith('ha.') || it.kind === 'html' ? aliasEntities(it) : structuredClone(it.props);
    // per person: the members chosen become the calendars shown as columns (members without a calendar are left out)
    if (it.kind === 'calendar.people') {
      const { memberIds, ...rest } = props;
      props = { ...rest, columns: memberIds ? memberIds.map((id) => members.get(id)).filter(Boolean) : null };
    }
    const portrait = derived ? derived.get(it.id) ?? null : it.portrait ?? null;
    const out = {
      id: it.id, kind: it.kind, pos: it.pos, portrait, style: it.style,
      interactive: !!(k?.controls && it.interactive !== false && touch),
      props,
    };
    if (it.confirm) out.confirm = true;
    // which feed says whether it is drawn now (never the entity or the key: the server works it out)
    if (it.when && (it.when.src === 'ha' ? it.when.entity : it.when.key)) out.when = { src: it.when.src };
    if (!k || !allowed.has(it.kind) || k.reserved) out.disabled = 'feature';
    else if (priv && k.private) out.disabled = 'privacy';
    if (out.disabled) out.props = {};
    out.v = fnv(JSON.stringify([out.kind, out.props, out.style, out.pos, out.portrait, out.interactive, out.disabled ?? '', ...(out.when ? [out.when.src] : [])]));
    return out;
  });
  const { items: _i, touch: _t, ...rest } = cv;
  const out = { ...structuredClone(rest), orientation: screen.screen?.orientation ?? 'auto', touch, items };
  if (nextMs !== null) out.next = new Date(nextMs).toISOString();
  if (opts.haOff && items.some((it) => it.kind.startsWith('ha.') && !it.disabled)) out.haOff = true;
  return out;
}

/** The data items (market, sports, stocks) a screen shows, hidden ones left out. */
export function canvasDataItems(screen, { now = new Date(), tz = 'UTC' } = {}) {
  if (screen?.layout?.preset !== 'canvas') return [];
  return (screen.canvas?.items ?? []).filter((it) => !it.hidden && DATA_KIND_IDS.includes(it.kind) && scheduleOn(it, now, tz));
}

/** Widget ids (config.widgets) the canvas of a screen shows ('widget' items), in item order, no repeats. */
export function canvasWidgetIds(screen, { now = new Date(), tz = 'UTC' } = {}) {
  if (screen?.layout?.preset !== 'canvas') return [];
  return [...new Set((screen.canvas?.items ?? []).filter((it) => it.kind === 'widget' && !it.hidden && it.props?.widgetId && scheduleOn(it, now, tz)).map((it) => it.props.widgetId))];
}

/**
 * How far ahead the canvas calendars need events (days from today): the longest of the month grids (weeks, 'auto' =
 * 6), the agendas, the per-person views, the next-events and highlights cards and the birthdays card (a month);
 * capped at 6 weeks. 0 = no calendar item.
 */
export function canvasEventsNeed(canvas) {
  let days = 0;
  for (const it of canvas?.items ?? []) {
    const p = it.props || {};
    if (it.kind === 'calendar.month') days = Math.max(days, (p.weeks === 'auto' || !p.weeks ? 6 : p.weeks) * 7 + 7);
    else if (it.kind === 'calendar.week') days = Math.max(days, 8);
    else if (it.kind === 'calendar.agenda') days = Math.max(days, (p.days || 7) + 1);
    else if (it.kind === 'calendar.people') days = Math.max(days, (p.days || 2) + 1);
    else if (it.kind === 'calendar.today' || it.kind === 'calendar.next' || it.kind === 'highlights') days = Math.max(days, 3);
    // upcoming birthdays: the next month of the birthdays calendar
    else if (it.kind === 'birthdays') days = Math.max(days, 32);
  }
  return Math.min(42, days);
}

// ---- templates ---------------------------------------------------------------------------------------------------

const M = (x, y, size) => ({ zone: 'main', x, y, size });
const S = (order, span) => ({ zone: 'side', order, span });
const NONE = { surface: 'none' };

/**
 * Starting points of the builder (data only). Items have no ids: canvasFromTemplate gives them fresh ones.
 * `requires.ha`: offered only with Home Assistant connected. Names are Spanish keys of the admin dictionaries.
 */
export const CANVAS_TEMPLATES = [
  {
    id: 'calendarWeather', name: 'Calendario y tiempo',
    canvas: {
      background: 'ambient',
      items: [
        { kind: 'calendar.month', pos: M(0, 0, 'xl') },
        { kind: 'clock.digital', pos: M(8, 0, 'm') },
        { kind: 'weather.now', pos: M(8, 3, 'm') },
        { kind: 'weather.forecast', pos: M(0, 6, 'w') },
        { kind: 'calendar.next', pos: M(6, 6, 'w') },
      ],
    },
  },
  {
    id: 'kitchen', name: 'Cocina',
    canvas: {
      background: 'ambient',
      items: [
        { kind: 'calendar.agenda', pos: M(0, 0, 't') },
        { kind: 'todo', pos: M(3, 0, 't') },
        { kind: 'clock.digital', pos: M(6, 0, 's') },
        { kind: 'weather.now', pos: M(9, 0, 's') },
        { kind: 'countdowns', pos: M(6, 2, 'w') },
        { kind: 'calendar.next', pos: M(0, 4, 'w') },
        { kind: 'weather.forecast', pos: M(6, 4, 'w') },
        { kind: 'message', pos: M(0, 6, 'w') },
        { kind: 'news', pos: M(6, 6, 'w') },
      ],
    },
  },
  {
    id: 'photoFrame', name: 'Marco de fotos',
    canvas: {
      background: 'photo',
      items: [
        { kind: 'clock.digital', pos: M(0, 6, 'w'), style: NONE },
        { kind: 'calendar.next', pos: M(6, 6, 's') },
        { kind: 'weather.now', pos: M(10, 6, 'xs'), style: NONE },
      ],
    },
  },
  {
    id: 'halfHalf', name: 'Mitad y mitad',
    canvas: {
      background: 'ambient',
      sidebar: { side: 'left', size: 'wide', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'weather.now', pos: S(1, 3) },
        { kind: 'countdowns', pos: S(2, 'fill') },
        { kind: 'calendar.month', pos: M(0, 0, 'full') },
      ],
    },
  },
  {
    id: 'calendarOnly', name: 'Solo calendario',
    canvas: {
      background: 'ambient',
      items: [{ kind: 'calendar.month', pos: M(0, 0, 'full') }],
    },
  },
  {
    id: 'bedroom', name: 'Dormitorio',
    canvas: {
      background: 'solid', color: '#0a0a0f',
      items: [
        { kind: 'clock.analog', pos: M(2, 0, 'xl'), style: NONE, props: { face: 'minimal', seconds: false } },
        { kind: 'calendar.agenda', pos: M(2, 6, 's'), props: { days: 2, compact: true } },
        { kind: 'weather.now', pos: M(8, 6, 'xs'), style: NONE },
      ],
    },
  },
  {
    id: 'homePanel', name: 'Panel de casa', requires: { ha: true },
    canvas: {
      background: 'ambient',
      items: [
        { kind: 'clock.digital', pos: M(0, 0, 'm') },
        { kind: 'ha.climate', pos: M(4, 0, 'm') },
        { kind: 'ha.light', pos: M(8, 0, 'xs') },
        { kind: 'ha.light', pos: M(10, 0, 'xs') },
        { kind: 'ha.light', pos: M(8, 2, 'xs') },
        { kind: 'ha.chart', pos: M(0, 3, 'w') },
        { kind: 'ha.camera', pos: M(6, 4, 'l') },
      ],
    },
  },
  {
    id: 'bento', name: 'Bento',
    canvas: {
      background: 'ambient',
      items: [
        { kind: 'clock.digital', pos: M(0, 0, 'm') },
        { kind: 'calendar.month', pos: M(4, 0, 'l') },
        { kind: 'weather.now', pos: M(10, 0, 'xs') },
        { kind: 'date', pos: M(10, 2, 'xs') },
        { kind: 'calendar.agenda', pos: M(0, 3, 'm'), props: { days: 3, compact: true } },
        { kind: 'weather.forecast', pos: M(4, 4, 'w') },
        { kind: 'calendar.next', pos: M(10, 4, 'xs') },
        { kind: 'todo', pos: M(0, 6, 's') },
        { kind: 'news', pos: M(3, 6, 'w') },
        { kind: 'countdowns', pos: M(9, 6, 's') },
      ],
    },
  },
  {
    id: 'cinematic', name: 'Cinemático',
    canvas: {
      background: 'photo', dim: 0.25,
      items: [
        { kind: 'clock.digital', pos: M(0, 4, 'l'), style: NONE, props: { weight: 'light' } },
        { kind: 'calendar.next', pos: M(6, 6, 'w'), props: { count: 2 } },
        { kind: 'weather.now', pos: M(10, 0, 'xs'), style: NONE, props: { meta: false } },
      ],
    },
  },
  { id: 'blank', name: 'En blanco', canvas: { items: [] } },
  // ---- one per existing design (layout.preset), as close as the grid allows (DESIGN_TEMPLATES maps them)
  {
    id: 'design.bigCalendar', name: 'Calendario grande', group: 'design',
    canvas: {
      background: 'photo', sidebar: { side: 'left', size: 'normal', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'weather.now', pos: S(1, 2) },
        { kind: 'news', pos: S(2, 'fill') },
        { kind: 'calendar.month', pos: M(0, 0, 'full') },
      ],
    },
  },
  {
    id: 'design.twoWeeks', name: 'Dos semanas', group: 'design',
    canvas: {
      background: 'photo', sidebar: { side: 'left', size: 'narrow', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'weather.now', pos: S(1, 2) },
        { kind: 'weather.forecast', pos: S(2, 'fill') },
        { kind: 'calendar.month', pos: M(0, 0, 'full'), props: { weeks: 2 } },
      ],
    },
  },
  {
    id: 'design.leftRight', name: 'Izquierda / Derecha', group: 'design',
    canvas: {
      // the photo in the wide column, the animated background behind the rest (a new Personalizado screen starts on
      // Animado unless the design is a plain colour on purpose, like Mesilla or the kids pages)
      background: 'ambient', sidebar: { side: 'left', size: 'wide', fill: 'photo' },
      items: [
        { kind: 'clock.digital', pos: M(0, 0, 'w') },
        { kind: 'weather.now', pos: M(6, 0, 's') },
        { kind: 'calendar.next', pos: M(9, 0, 's') },
        { kind: 'calendar.agenda', pos: M(0, 2, 'xl') },
        { kind: 'weather.forecast', pos: M(8, 2, 't') },
        { kind: 'countdowns', pos: M(8, 6, 's') },
      ],
    },
  },
  {
    id: 'design.topBottom', name: 'Arriba / Abajo', group: 'design',
    canvas: {
      background: 'photo', sidebar: { side: 'top', size: 'normal', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'weather.now', pos: S(1, 2) },
        { kind: 'weather.forecast', pos: S(2, 'fill') },
        { kind: 'calendar.month', pos: M(0, 0, 'full') },
      ],
    },
  },
  {
    id: 'design.agenda', name: 'Agenda', group: 'design',
    canvas: {
      background: 'ambient', sidebar: { side: 'top', size: 'narrow', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'weather.now', pos: S(1, 2) },
        { kind: 'calendar.next', pos: S(2, 'fill') },
        { kind: 'calendar.agenda', pos: M(0, 0, 'full'), props: { days: 7, maxPerDay: 6 } },
      ],
    },
  },
  {
    id: 'design.today', name: 'Hoy', group: 'design',
    canvas: {
      background: 'photo', sidebar: { side: 'left', size: 'normal', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'weather.now', pos: S(1, 2) },
        { kind: 'weather.hourly', pos: S(2, 'fill') },
        { kind: 'calendar.today', pos: M(0, 0, 'full') },
      ],
    },
  },
  {
    id: 'design.people', name: 'Por persona', group: 'design',
    canvas: {
      background: 'ambient', sidebar: { side: 'top', size: 'narrow', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'date', pos: S(1, 2) },
        { kind: 'weather.now', pos: S(2, 'fill') },
        { kind: 'calendar.people', pos: M(0, 0, 'full') },
      ],
    },
  },
  {
    id: 'design.board', name: 'Tablero', group: 'design',
    canvas: {
      background: 'ambient',
      items: [
        { kind: 'clock.digital', pos: M(0, 0, 's') },
        { kind: 'message', pos: M(3, 0, 'w') },
        { kind: 'weather.now', pos: M(9, 0, 's') },
        { kind: 'todo', pos: M(0, 2, 't') },
        { kind: 'countdowns', pos: M(3, 2, 't'), props: { style: 'cards' } },
        { kind: 'birthdays', pos: M(6, 2, 't') },
        { kind: 'calendar.agenda', pos: M(9, 2, 't'), props: { days: 3, compact: true } },
        { kind: 'weather.forecast', pos: M(0, 6, 'w') },
        { kind: 'calendar.next', pos: M(6, 6, 'w') },
      ],
    },
  },
  {
    id: 'design.bigTime', name: 'Hora grande', group: 'design',
    canvas: {
      background: 'photo',
      items: [
        { kind: 'clock.digital', pos: M(2, 0, 'xl'), style: NONE },
        { kind: 'calendar.next', pos: M(0, 6, 'w'), props: { count: 3 } },
        { kind: 'weather.forecast', pos: M(6, 6, 'w') },
      ],
    },
  },
  {
    id: 'design.bedside', name: 'Mesilla', group: 'design',
    canvas: {
      background: 'solid', color: '#000000',
      items: [
        { kind: 'clock.digital', pos: M(2, 0, 'xl'), style: NONE, props: { weight: 'light', showDate: false } },
        { kind: 'calendar.next', pos: M(2, 6, 'w'), style: NONE },
        { kind: 'weather.now', pos: M(8, 6, 'xs'), style: NONE, props: { meta: false, feelsLike: false } },
      ],
    },
  },
  {
    id: 'design.planner', name: 'Planificador', group: 'design',
    canvas: {
      background: 'ambient', sidebar: { side: 'top', size: 'narrow', fill: 'glass' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'date', pos: S(1, 2) },
        { kind: 'weather.forecast', pos: S(2, 'fill') },
        { kind: 'calendar.month', pos: M(0, 0, 'full'), props: { eventStyle: 'cards', maxEventsPerDay: 6 } },
      ],
    },
  },
  {
    id: 'design.kidsRoutines', name: 'Rutinas', group: 'design', theme: 'light',
    canvas: {
      background: 'solid', sidebar: { side: 'top', size: 'narrow', fill: 'solid' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'date', pos: S(1, 2) },
        { kind: 'family.points', pos: S(2, 'fill') },
        { kind: 'family.routines', pos: M(0, 0, 'full') },
      ],
    },
  },
  {
    id: 'design.kidsFamily', name: 'Familia', group: 'design', theme: 'light',
    canvas: {
      background: 'solid', defaults: { surface: 'solid', radius: 'l' },
      items: [
        { kind: 'clock.digital', pos: M(0, 0, 's') },
        { kind: 'highlights', pos: M(3, 0, 'w') },
        { kind: 'weather.now', pos: M(9, 0, 's') },
        { kind: 'calendar.agenda', pos: M(0, 2, 't'), props: { days: 1 } },
        { kind: 'family.routines', pos: M(3, 2, 'l') },
        { kind: 'meals.today', pos: M(9, 2, 's') },
        { kind: 'family.chores', pos: M(9, 4, 't') },
        { kind: 'countdowns', pos: M(0, 6, 's') },
        { kind: 'family.members', pos: M(3, 6, 'w') },
      ],
    },
  },
  {
    id: 'design.kidsMeals', name: 'Semana de comidas', group: 'design', theme: 'light',
    canvas: {
      background: 'solid', sidebar: { side: 'top', size: 'narrow', fill: 'solid' },
      items: [
        { kind: 'clock.digital', pos: S(0, 3) },
        { kind: 'calendar.next', pos: S(1, 3) },
        { kind: 'weather.now', pos: S(2, 'fill') },
        { kind: 'meals.week', pos: M(0, 0, 'full') },
      ],
    },
  },
];

/** The template of each existing design (layout.preset), for "Copiar mi diseño actual" and the picker. */
export const DESIGN_TEMPLATES = {
  bigCalendar: 'design.bigCalendar', twoWeeks: 'design.twoWeeks', leftRight: 'design.leftRight', topBottom: 'design.topBottom',
  agenda: 'design.agenda', today: 'design.today', people: 'design.people', board: 'design.board', bigTime: 'design.bigTime',
  photoFrame: 'photoFrame', bedside: 'design.bedside', planner: 'design.planner',
  kidsRoutines: 'design.kidsRoutines', kidsFamily: 'design.kidsFamily', kidsMeals: 'design.kidsMeals',
};

/**
 * A complete canvas from a template: defaults, each item's default props and style under the template's, and fresh
 * ids. `opts` as sanitizeCanvas (kinds the server does not allow are left out).
 */
export function canvasFromTemplate(id, refs = {}, opts = {}) {
  const tpl = CANVAS_TEMPLATES.find((t) => t.id === id) ?? CANVAS_TEMPLATES.find((t) => t.id === 'blank');
  const allowed = new Set(opts.canvasKinds ?? DEFAULT_CANVAS_KINDS);
  const taken = new Set();
  const raw = {
    ...defaultCanvas(),
    ...structuredClone(tpl.canvas),
    sidebar: { ...defaultCanvas().sidebar, ...(tpl.canvas.sidebar ?? {}) },
    items: tpl.canvas.items.filter((it) => allowed.has(it.kind)).map((it) => {
      const id2 = newCanvasId(taken);
      taken.add(id2);
      return { id: id2, kind: it.kind, pos: { ...it.pos }, style: { ...defaultItemStyle(), ...(it.style ?? {}) }, props: { ...canvasDefaults(it.kind), ...(it.props ?? {}) } };
    }),
  };
  const sink = { err() {}, warn() {} };
  return sanitizeCanvas(sink, 'canvas', raw, refs, opts);
}

/**
 * "Copiar mi diseño actual": a canvas that looks like the screen's current design. `screen` is the screen's profile
 * (layout, background, calendar, datetime). The design's template, then what the screen set: the side of the column,
 * its width, whether the photo is on, the month's weeks and event style, the agenda's days and an analog clock.
 */
export function canvasFromDesign(screen, refs = {}, opts = {}) {
  const preset = screen?.layout?.preset;
  const id = DESIGN_TEMPLATES[preset] ?? DESIGN_TEMPLATES.bigCalendar;
  const cv = canvasFromTemplate(id, refs, opts);
  const l = screen?.layout ?? {};
  const bg = screen?.background ?? {};
  const cal = screen?.calendar ?? {};
  if ((cv.sidebar.side === 'left' || cv.sidebar.side === 'right') && (l.sidePanel === 'left' || l.sidePanel === 'right')) cv.sidebar.side = l.sidePanel;
  if (id === 'design.bigCalendar' && typeof l.sideWidth === 'number') cv.sidebar.size = l.sideWidth < 0.25 ? 'narrow' : l.sideWidth < 0.33 ? 'normal' : 'wide';
  // the photo: off on the screen, none here either; on the whole screen, behind the whole canvas (a design with the
  // photo in its own column, Izquierda / Derecha, keeps it there: the screen's photo scope does not apply to it)
  if (bg.enabled === false) {
    if (cv.background === 'photo') cv.background = 'ambient';
    if (cv.sidebar.fill === 'photo') cv.sidebar.fill = 'glass';
  } else if (bg.enabled && bg.scope === 'screen' && cv.background === 'ambient' && cv.sidebar.fill !== 'photo') {
    cv.background = 'photo';
  }
  if (cv.sidebar.fill === 'photo' && cv.background === 'photo') cv.sidebar.fill = 'glass';
  const analog = screen?.datetime?.clock === 'analog';
  for (const it of cv.items) {
    const p = it.props;
    if (it.kind === 'calendar.month') {
      if (cal.weeks === 'auto' || (Number.isInteger(cal.weeks) && cal.weeks >= 1 && cal.weeks <= 6)) p.weeks = id === 'design.twoWeeks' ? 2 : cal.weeks;
      if (cal.eventStyle === 'cards') p.eventStyle = 'cards';
      if (Number.isInteger(cal.maxEventsPerDay)) p.maxEventsPerDay = Math.min(12, Math.max(1, cal.maxEventsPerDay));
    }
    if (it.kind === 'calendar.agenda' && Number.isInteger(cal.agendaDays) && id === 'design.agenda') p.days = Math.min(14, Math.max(1, cal.agendaDays));
    if (it.kind.startsWith('calendar.')) p.hidePast = !!cal.hidePast;
    if (analog && it.kind === 'clock.digital' && (it.pos.zone === 'side' || CANVAS_KINDS['clock.analog'].sizes.includes(it.pos.size))) {
      it.kind = 'clock.analog';
      it.props = { ...canvasDefaults('clock.analog'), showDate: true };
    }
  }
  const tpl = CANVAS_TEMPLATES.find((t) => t.id === id);
  const sink = { err() {}, warn() {} };
  return { canvas: sanitizeCanvas(sink, 'canvas', cv, refs, opts), theme: tpl?.theme ?? null, template: id };
}

// ---- one Personalizado screen as a file ---------------------------------------------------------------------------
// "Exportar esta pantalla" writes the canvas without anything that points into this household: calendars, family
// members, Home Assistant entities and saved widgets are left empty (the cards stay and ask for them again on
// import). Valor keys, coins, teams and symbols stay: they are names anyone can use. Item ids are new on import.

export const CANVAS_FILE_FORMAT = 'marco-screen';
export const CANVAS_FILE_VERSION = 1;
/** Largest file the editor reads (bytes). */
export const CANVAS_FILE_MAX = 512 * 1024;
/** What a card asks for again after an import. */
export const CANVAS_PICKS = ['calendars', 'people', 'entities', 'widget'];

/** An item's props and condition with this household's references emptied; `removed` = the CANVAS_PICKS it lost. */
function stripItem(it) {
  const p = structuredClone(it.props ?? {});
  const removed = new Set();
  if (Array.isArray(p.sourceIds) && p.sourceIds.length) removed.add('calendars');
  if ('sourceIds' in p) p.sourceIds = null;
  if (Array.isArray(p.memberIds) && p.memberIds.length) removed.add('people');
  if ('memberIds' in p) p.memberIds = null;
  if (typeof p.memberId === 'string' && p.memberId) removed.add('people');
  if ('memberId' in p) p.memberId = null;
  if (it.kind === 'widget') {
    removed.add('widget');
    p.widgetId = '';
  }
  const ent = (e) => {
    if (typeof e === 'string' && e) removed.add('entities');
    return '';
  };
  if (it.kind?.startsWith('ha.') || it.kind === 'html') {
    if ('entity' in p) p.entity = ent(p.entity);
    if ('showWhen' in p) p.showWhen = ent(p.showWhen);
    if (Array.isArray(p.rows)) p.rows = p.rows.map((r) => ({ ...r, entity: ent(r?.entity) }));
    if (Array.isArray(p.series)) p.series = p.series.map((s) => ({ ...s, entity: ent(s?.entity) }));
    if (Array.isArray(p.buttons)) p.buttons = p.buttons.map((b) => ({ ...b, entity: ent(b?.entity) }));
    if (Array.isArray(p.bind)) p.bind = p.bind.map((b) => (b && 'entity' in b ? { ...b, entity: ent(b.entity) } : b));
  }
  const out = { ...structuredClone(it), props: p };
  delete out.ack;
  if (out.when?.src === 'ha') out.when = { ...out.when, entity: ent(out.when.entity) };
  return { item: out, removed: [...removed] };
}

/**
 * The file of one Personalizado screen: { format, version, theme, glass, canvas, picks } where `picks` maps an item
 * id to what it lost (CANVAS_PICKS). `screen` = { theme, glass } of the screen (both optional).
 */
export function exportCanvasFile(canvas, screen = {}) {
  const cv = structuredClone(canvas ?? defaultCanvas());
  const picks = {};
  cv.items = (cv.items ?? []).map((it) => {
    const r = stripItem(it);
    if (r.removed.length) picks[it.id] = r.removed;
    return r.item;
  });
  const out = { format: CANVAS_FILE_FORMAT, version: CANVAS_FILE_VERSION, canvas: cv, picks };
  if (screen.theme === 'light' || screen.theme === 'dark') out.theme = screen.theme;
  if (isObj(screen.glass)) out.glass = structuredClone(screen.glass);
  return out;
}

/**
 * Read a screen file (parsed JSON) for this server: kinds it does not offer are left out (counted in `dropped`),
 * every reference is emptied again (a file written by hand cannot point into this household), then the canvas is
 * validated like a save (`refs`, `opts` as sanitizeCanvas). Item ids are new. Returns { ok: true, canvas, theme,
 * glass, picks: { [newId]: CANVAS_PICKS[] }, dropped, conditions } or { ok: false, error, path? } (`conditions`: Home
 * Assistant conditions left out where Home Assistant is not offered).
 */
export function readCanvasFile(raw, refs = {}, opts = {}) {
  if (!isObj(raw) || raw.format !== CANVAS_FILE_FORMAT) return { ok: false, error: 'not a Marco screen file' };
  if (typeof raw.version !== 'number' || raw.version > CANVAS_FILE_VERSION) return { ok: false, error: 'made by a newer version of Marco' };
  if (!isObj(raw.canvas)) return { ok: false, error: 'no canvas in the file' };
  const allowed = new Set(opts.canvasKinds ?? DEFAULT_CANVAS_KINDS);
  const haConds = [...allowed].some((k) => k.startsWith('ha.'));
  const items = Array.isArray(raw.canvas.items) ? raw.canvas.items : [];
  let dropped = 0;
  let conditions = 0;
  const taken = new Set();
  const marks = [];
  const kept = [];
  for (const x of items) {
    if (!isObj(x) || !CANVAS_KINDS[x.kind] || CANVAS_KINDS[x.kind].reserved || !allowed.has(x.kind)) {
      dropped++;
      continue;
    }
    const before = isObj(raw.picks) && Array.isArray(raw.picks[x.id]) ? raw.picks[x.id].filter((k) => CANVAS_PICKS.includes(k)) : [];
    const r = stripItem({ ...x, props: isObj(x.props) ? x.props : {} });
    // a Home Assistant condition where there is no Home Assistant (Marco Cloud): the card shows always
    if (r.item.when?.src === 'ha' && !haConds) {
      delete r.item.when;
      conditions++;
    }
    const id = newCanvasId(taken);
    taken.add(id);
    kept.push({ ...r.item, id });
    marks.push([id, [...new Set([...before, ...r.removed])].sort((a, b) => CANVAS_PICKS.indexOf(a) - CANVAS_PICKS.indexOf(b))]);
  }
  const errors = [];
  const c = { err: (path, msg) => errors.push({ path, msg }), warn() {} };
  // an emptied widget card stays (it asks for its widget again); the save drops it if none is picked
  const widgets = new Map(refs.widgets instanceof Map ? refs.widgets : []);
  widgets.set('', { id: '' });
  const canvas = sanitizeCanvas(c, 'canvas', { ...raw.canvas, items: kept }, { ...refs, widgets }, opts);
  if (errors.length) return { ok: false, error: errors[0].msg, path: errors[0].path };
  const ids = new Set(canvas.items.map((it) => it.id));
  const picks = Object.fromEntries(marks.filter(([id, list]) => list.length && ids.has(id)));
  const out = { ok: true, canvas, picks, dropped, conditions, theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : null, glass: isObj(raw.glass) ? raw.glass : null };
  return out;
}
