// Config validation & sanitisation. Unknown keys are dropped, missing keys take defaults,
// invalid values produce errors (PUT /api/admin/config answers 400 with the list).
import { defaultConfig, defaultScreenProfile, CONFIG_VERSION, RESERVED_SOURCE_IDS, SCREEN_SPLIT_KEYS, SCREEN_ONLY_KEYS } from './defaults.js';
import { isValidTimeZone } from './lib/tz.js';
import { randomId, fold } from './lib/text.js';
import { LANGS } from './lib/i18n.js';
import { WEATHER_PROVIDER_IDS, OPEN_METEO_MODEL_IDS, KEY_PROVIDERS } from './weather.js';
import { PRIVACY_MODES, MAX_PRIVACY_RULES, defaultSourcePrivacy } from './privacy.js';
import { CAMERA_RE, DOORBELL_MIN_SEC, DOORBELL_MAX_SEC } from './doorbellCore.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Screen layouts (docs/ARCHITECTURE.md); the display, the admin and server/setup.js use the same ids. */
export const LAYOUT_PRESETS = ['bigCalendar', 'leftRight', 'topBottom', 'bigTime', 'agenda', 'today', 'people', 'photoFrame', 'twoWeeks', 'board', 'bedside'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export function isHttpUrl(s, protocols = ['http:', 'https:']) {
  try {
    const u = new URL(String(s).trim().replace(/^webcals?:\/\//i, 'https://'));
    return protocols.includes(u.protocol);
  } catch {
    return false;
  }
}

class Ctx {
  constructor() { this.errors = []; }
  err(path, msg) { this.errors.push({ path, message: msg }); }
}

// --- primitive coercers: return sanitized value or the default (recording an error when invalid) ---
function bool(ctx, path, v, d) {
  if (v === undefined) return d;
  if (typeof v === 'boolean') return v;
  ctx.err(path, 'expected boolean');
  return d;
}
function num(ctx, path, v, d, min, max, int = false) {
  if (v === undefined || v === null || v === '') return d;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) { ctx.err(path, 'expected number'); return d; }
  if (n < min || n > max) { ctx.err(path, `must be between ${min} and ${max}`); return d; }
  return int ? Math.round(n) : n;
}
function str(ctx, path, v, d, max = 200) {
  if (v === undefined || v === null) return d;
  if (typeof v !== 'string') { ctx.err(path, 'expected string'); return d; }
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  if (s.length > max) { ctx.err(path, `too long (max ${max})`); return s.slice(0, max); }
  return s;
}
function oneOf(ctx, path, v, d, list) {
  if (v === undefined) return d;
  if (list.includes(v)) return v;
  ctx.err(path, `must be one of ${list.join(', ')}`);
  return d;
}
function color(ctx, path, v, d, nullable = false) {
  if (v === undefined) return d;
  if (v === null || v === '') {
    if (nullable) return null;
    ctx.err(path, 'color required');
    return d;
  }
  if (typeof v === 'string' && HEX.test(v.trim())) return v.trim().toLowerCase();
  ctx.err(path, 'invalid color (#rrggbb)');
  return d;
}
function emoji(ctx, path, v, d) {
  if (v === undefined || v === null) return d;
  const s = str(ctx, path, v, d, 16).trim();
  return s;
}
/** The emoji field rule on its own (announcements): `{ value, errors }`, errors as { path, message }. */
export function validateEmoji(v, path = 'emoji', d = '') {
  const ctx = new Ctx();
  const value = emoji(ctx, path, v, d);
  return { value, errors: ctx.errors };
}
function id(ctx, path, v, prefix, seen) {
  let s = typeof v === 'string' && ID.test(v) ? v : randomId(prefix);
  while (seen.has(s)) s = randomId(prefix);
  seen.add(s);
  return s;
}
function arr(ctx, path, v, d, max) {
  if (v === undefined) return d;
  if (!Array.isArray(v)) { ctx.err(path, 'expected array'); return d; }
  if (v.length > max) { ctx.err(path, `too many items (max ${max})`); return v.slice(0, max); }
  return v;
}
function obj(ctx, path, v) {
  if (v === undefined) return {};
  if (!isObj(v)) { ctx.err(path, 'expected object'); return {}; }
  return v;
}

function sanitizeSource(ctx, path, s, seen) {
  if (!isObj(s)) { ctx.err(path, 'expected object'); return null; }
  const type = oneOf(ctx, `${path}.type`, s.type, 'ics', ['ics', 'google', 'microsoft']);
  const out = {
    id: id(ctx, `${path}.id`, s.id, 'c_', seen),
    type,
    name: str(ctx, `${path}.name`, s.name, 'Calendar', 80).trim() || 'Calendar',
    color: color(ctx, `${path}.color`, s.color, '#4ea8de'),
    emoji: emoji(ctx, `${path}.emoji`, s.emoji, ''),
    kind: oneOf(ctx, `${path}.kind`, s.kind, 'generic', ['generic', 'airbnb', 'birthdays', 'holidays']),
    enabled: bool(ctx, `${path}.enabled`, s.enabled, true),
    refreshMin: num(ctx, `${path}.refreshMin`, s.refreshMin, 5, 1, 1440, true),
  };
  // what privacy mode does to its events: 'busy' (default), 'hide', 'keep' (holidays and birthdays default to keep)
  out.privacy = oneOf(ctx, `${path}.privacy`, s.privacy, defaultSourcePrivacy(out.kind), PRIVACY_MODES);
  if (type === 'ics') {
    const url = str(ctx, `${path}.url`, s.url, '', 2048).trim();
    if (!isHttpUrl(url, ['http:', 'https:', 'webcal:', 'webcals:'])) ctx.err(`${path}.url`, 'invalid URL');
    out.url = url;
    out.insecureTls = bool(ctx, `${path}.insecureTls`, s.insecureTls, false);
  } else if (type === 'google') {
    out.googleCalendarId = str(ctx, `${path}.googleCalendarId`, s.googleCalendarId, 'primary', 512).trim() || 'primary';
    const acct = str(ctx, `${path}.googleAccount`, s.googleAccount, '', 320).trim().toLowerCase();
    if (!EMAIL.test(acct)) ctx.err(`${path}.googleAccount`, 'Google account email required');
    out.googleAccount = acct;
  } else {
    // Microsoft (Outlook.com, Hotmail, Microsoft 365) calendars, read through Microsoft Graph (server/microsoft.js, or
    // Marco Cloud). A server without a Microsoft app keeps them in the config and reports them as not available.
    const calId = str(ctx, `${path}.microsoftCalendarId`, s.microsoftCalendarId, '', 512).trim();
    if (!calId) ctx.err(`${path}.microsoftCalendarId`, 'Microsoft calendar id required');
    out.microsoftCalendarId = calId;
    const acct = str(ctx, `${path}.microsoftAccount`, s.microsoftAccount, '', 320).trim().toLowerCase();
    if (!EMAIL.test(acct)) ctx.err(`${path}.microsoftAccount`, 'Microsoft account email required');
    out.microsoftAccount = acct;
  }
  return out;
}

function sanitizeRule(ctx, path, r, seen) {
  if (!isObj(r)) { ctx.err(path, 'expected object'); return null; }
  const match = arr(ctx, `${path}.match`, r.match, [], 50)
    .filter((m) => typeof m === 'string')
    .map((m) => m.trim().slice(0, 80))
    .filter(Boolean);
  if (!match.length) ctx.err(`${path}.match`, 'at least one keyword');
  return {
    id: id(ctx, `${path}.id`, r.id, 'r_', seen),
    match,
    emoji: emoji(ctx, `${path}.emoji`, r.emoji, ''),
    color: color(ctx, `${path}.color`, r.color, null, true),
  };
}

// ------------------------------------------------------------------------------------------------
// Schema v2 helpers (docs/ARCHITECTURE.md)
// ------------------------------------------------------------------------------------------------
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const ALERT_STYLES = ['info', 'success', 'warning', 'urgent'];
export const MAX_SCREENS = 12;

/** Strict YYYY-MM-DD (real calendar date). */
export function isValidDate(s) {
  const m = typeof s === 'string' && DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "Salón principal" → "salon-principal" (lowercase ascii, dashes, ≤ 32 chars). */
export function slugify(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
}

function date(ctx, path, v, d, nullable = false) {
  if (v === undefined) return d;
  if ((v === null || v === '') && nullable) return null;
  if (isValidDate(v)) return v;
  ctx.err(path, 'invalid date (YYYY-MM-DD)');
  return d;
}
function hhmm(ctx, path, v, d) {
  if (v === undefined) return d;
  if (typeof v === 'string' && HHMM.test(v)) return v;
  ctx.err(path, 'HH:MM');
  return d;
}
function idList(ctx, path, v, max = 60) {
  return arr(ctx, path, v, [], max).filter((x) => typeof x === 'string' && ID.test(x));
}
function weekdays(ctx, path, v) {
  const list = arr(ctx, path, v, [], 7);
  const out = [...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  if (out.length !== list.length) ctx.err(path, 'weekdays must be unique integers 0..6 (0 = Sunday)');
  return out;
}
function requiredStr(ctx, path, v, d, max) {
  const s = str(ctx, path, v, d, max).trim();
  if (!s) ctx.err(path, 'required');
  return s;
}

function sanitizeScreenProfile(ctx, p, raw, seenIds, seenSlugs) {
  const D = defaultScreenProfile();
  const x = obj(ctx, p, raw);
  const name = str(ctx, `${p}.name`, x.name, '', 60).trim() || 'Screen';
  let slug = typeof x.slug === 'string' ? x.slug.trim().toLowerCase() : '';
  if (slug && !SLUG_RE.test(slug)) { ctx.err(`${p}.slug`, 'invalid slug (a-z, 0-9, -)'); slug = ''; }
  if (!slug) slug = slugify(name) || 'screen';
  for (let i = 2, base = slug; seenSlugs.has(slug); i++) slug = `${base.slice(0, 29)}-${i}`;
  seenSlugs.add(slug);

  const sc = obj(ctx, `${p}.screen`, x.screen);
  const nm = obj(ctx, `${p}.screen.nightMode`, sc.nightMode);
  const gl = obj(ctx, `${p}.screen.glass`, sc.glass);
  const GD = D.screen.glass;
  const screen = {
    language: oneOf(ctx, `${p}.screen.language`, sc.language, D.screen.language, LANGS),
    fontScale: num(ctx, `${p}.screen.fontScale`, sc.fontScale, D.screen.fontScale, 0.5, 3),
    theme: oneOf(ctx, `${p}.screen.theme`, sc.theme, D.screen.theme, ['dark', 'light', 'auto']),
    // display style: 'classic' (the original look) or 'modern' (glass cards, Apple-like); independent of the layout.
    // New configs start Modern (defaults.js); a config saved before styles existed keeps the look it always had.
    style: oneOf(ctx, `${p}.screen.style`, sc.style, 'classic', ['classic', 'modern']),
    accent: color(ctx, `${p}.screen.accent`, sc.accent, D.screen.accent),
    orientation: oneOf(ctx, `${p}.screen.orientation`, sc.orientation, D.screen.orientation, ['auto', 'landscape', 'portrait']),
    customCss: str(ctx, `${p}.screen.customCss`, sc.customCss, '', 20000).replace(/<\/style/gi, ''),
    nightMode: {
      enabled: bool(ctx, `${p}.screen.nightMode.enabled`, nm.enabled, D.screen.nightMode.enabled),
      from: hhmm(ctx, `${p}.screen.nightMode.from`, nm.from, D.screen.nightMode.from),
      to: hhmm(ctx, `${p}.screen.nightMode.to`, nm.to, D.screen.nightMode.to),
      dim: num(ctx, `${p}.screen.nightMode.dim`, nm.dim, D.screen.nightMode.dim, 0, 1),
    },
    // glass material of the Modern style: appearance, transparency (0 = see-through, 1 = solid), blur, tint, light edge
    glass: {
      appearance: oneOf(ctx, `${p}.screen.glass.appearance`, gl.appearance, GD.appearance, ['auto', 'clear', 'tinted']),
      opacity: num(ctx, `${p}.screen.glass.opacity`, gl.opacity, GD.opacity, 0, 1),
      blur: num(ctx, `${p}.screen.glass.blur`, gl.blur, GD.blur, 0, 40, true),
      tint: oneOf(ctx, `${p}.screen.glass.tint`, gl.tint, GD.tint, ['dark', 'light', 'photo']),
      edge: bool(ctx, `${p}.screen.glass.edge`, gl.edge, GD.edge),
    },
  };

  const ly = obj(ctx, `${p}.layout`, x.layout);
  const layout = {
    preset: oneOf(ctx, `${p}.layout.preset`, ly.preset, D.layout.preset, LAYOUT_PRESETS),
    sidePanel: oneOf(ctx, `${p}.layout.sidePanel`, ly.sidePanel, D.layout.sidePanel, ['left', 'right']),
    sideWidth: num(ctx, `${p}.layout.sideWidth`, ly.sideWidth, D.layout.sideWidth, 0.2, 0.6),
    // 'people' layout: the calendars shown as columns (null = automatic, at most 5, no duplicates)
    people: ly.people === null || ly.people === undefined ? null : [...new Set(idList(ctx, `${p}.layout.people`, ly.people, 5))],
    // 'photoFrame' layout: corner of the clock card
    corner: oneOf(ctx, `${p}.layout.corner`, ly.corner, D.layout.corner, ['tl', 'tr', 'bl', 'br']),
  };

  const bg = obj(ctx, `${p}.background`, x.background);
  const background = {
    enabled: bool(ctx, `${p}.background.enabled`, bg.enabled, D.background.enabled),
    source: oneOf(ctx, `${p}.background.source`, bg.source, D.background.source, ['stock', 'gallery', 'mixed']),
    stockTopic: str(ctx, `${p}.background.stockTopic`, bg.stockTopic, D.background.stockTopic, 60),
    order: oneOf(ctx, `${p}.background.order`, bg.order, D.background.order, ['random', 'newest', 'name']),
    intervalSec: num(ctx, `${p}.background.intervalSec`, bg.intervalSec, D.background.intervalSec, 10, 86400, true),
    brightness: num(ctx, `${p}.background.brightness`, bg.brightness, D.background.brightness, 0.1, 1),
    showMeta: bool(ctx, `${p}.background.showMeta`, bg.showMeta, D.background.showMeta),
    cover: bool(ctx, `${p}.background.cover`, bg.cover, D.background.cover),
    transition: oneOf(ctx, `${p}.background.transition`, bg.transition, D.background.transition, ['webgl', 'fade', 'none']),
    ambient: oneOf(ctx, `${p}.background.ambient`, bg.ambient, D.background.ambient, ['aurora', 'particles', 'none']),
    panelBlur: num(ctx, `${p}.background.panelBlur`, bg.panelBlur, D.background.panelBlur, 0, 40, true),
    panelShade: num(ctx, `${p}.background.panelShade`, bg.panelShade, D.background.panelShade, 0, 1),
    weatherFx: oneOf(ctx, `${p}.background.weatherFx`, bg.weatherFx, D.background.weatherFx, ['off', 'simple', 'rich']),
  };

  const ca = obj(ctx, `${p}.calendar`, x.calendar);
  const calendar = {
    enabled: bool(ctx, `${p}.calendar.enabled`, ca.enabled, D.calendar.enabled),
    view: oneOf(ctx, `${p}.calendar.view`, ca.view, D.calendar.view, ['month', 'agenda', 'week']),
    weeks: num(ctx, `${p}.calendar.weeks`, ca.weeks, D.calendar.weeks, 1, 8, true),
    weekStart: num(ctx, `${p}.calendar.weekStart`, ca.weekStart, D.calendar.weekStart, 0, 6, true),
    showLocation: bool(ctx, `${p}.calendar.showLocation`, ca.showLocation, D.calendar.showLocation),
    showEndTime: bool(ctx, `${p}.calendar.showEndTime`, ca.showEndTime, D.calendar.showEndTime),
    showDayXofY: bool(ctx, `${p}.calendar.showDayXofY`, ca.showDayXofY, D.calendar.showDayXofY),
    showLegend: bool(ctx, `${p}.calendar.showLegend`, ca.showLegend, D.calendar.showLegend),
    hidePast: bool(ctx, `${p}.calendar.hidePast`, ca.hidePast, D.calendar.hidePast),
    maxEventsPerDay: num(ctx, `${p}.calendar.maxEventsPerDay`, ca.maxEventsPerDay, D.calendar.maxEventsPerDay, 1, 20, true),
    marquee: bool(ctx, `${p}.calendar.marquee`, ca.marquee, D.calendar.marquee),
    rotateBusyDays: bool(ctx, `${p}.calendar.rotateBusyDays`, ca.rotateBusyDays, D.calendar.rotateBusyDays),
    // screens saved before the option keep the look they had (new screens get it on from defaultConfig)
    compactBusyDays: bool(ctx, `${p}.calendar.compactBusyDays`, ca.compactBusyDays, false),
    startToday: bool(ctx, `${p}.calendar.startToday`, ca.startToday, D.calendar.startToday),
    fontScale: num(ctx, `${p}.calendar.fontScale`, ca.fontScale, D.calendar.fontScale, 0.4, 1.5),
    dense: bool(ctx, `${p}.calendar.dense`, ca.dense, D.calendar.dense),
    sourceIds: ca.sourceIds === null || ca.sourceIds === undefined ? null : idList(ctx, `${p}.calendar.sourceIds`, ca.sourceIds),
  };

  const dt = obj(ctx, `${p}.datetime`, x.datetime);
  const datetime = {
    enabled: bool(ctx, `${p}.datetime.enabled`, dt.enabled, D.datetime.enabled),
    clock: oneOf(ctx, `${p}.datetime.clock`, dt.clock, D.datetime.clock, ['digital', 'analog']),
    format24: bool(ctx, `${p}.datetime.format24`, dt.format24, D.datetime.format24),
    showSeconds: bool(ctx, `${p}.datetime.showSeconds`, dt.showSeconds, D.datetime.showSeconds),
    showAmPm: bool(ctx, `${p}.datetime.showAmPm`, dt.showAmPm, D.datetime.showAmPm),
    dateFormat: oneOf(ctx, `${p}.datetime.dateFormat`, dt.dateFormat, D.datetime.dateFormat, ['weekday_month_d', 'weekday_d_month', 'weekday_d_dot_month', 'weekday_month_d_y', 'weekday_mdy', 'weekday_dmy', 'weekday_iso', 'custom']),
    dateCustom: str(ctx, `${p}.datetime.dateCustom`, dt.dateCustom, D.datetime.dateCustom, 60).replace(/[<>]/g, ''),
  };

  const we = obj(ctx, `${p}.weather`, x.weather);
  const weather = {
    enabled: bool(ctx, `${p}.weather.enabled`, we.enabled, D.weather.enabled),
    forecastDays: num(ctx, `${p}.weather.forecastDays`, we.forecastDays, D.weather.forecastDays, 1, 14, true),
    showHourly: bool(ctx, `${p}.weather.showHourly`, we.showHourly, D.weather.showHourly),
    showPrecipChance: bool(ctx, `${p}.weather.showPrecipChance`, we.showPrecipChance, D.weather.showPrecipChance),
  };

  const ne = obj(ctx, `${p}.news`, x.news);
  const news = {
    enabled: bool(ctx, `${p}.news.enabled`, ne.enabled, D.news.enabled),
    rotateSec: num(ctx, `${p}.news.rotateSec`, ne.rotateSec, D.news.rotateSec, 3, 600, true),
  };
  const td = obj(ctx, `${p}.todo`, x.todo);
  const todo = { enabled: bool(ctx, `${p}.todo.enabled`, td.enabled, D.todo.enabled) };
  const ms = obj(ctx, `${p}.message`, x.message);
  const message = {
    enabled: bool(ctx, `${p}.message.enabled`, ms.enabled, D.message.enabled),
    text: str(ctx, `${p}.message.text`, ms.text, '', 500),
    emoji: emoji(ctx, `${p}.message.emoji`, ms.emoji, D.message.emoji),
  };
  const cd = obj(ctx, `${p}.countdowns`, x.countdowns);
  const countdowns = {
    enabled: bool(ctx, `${p}.countdowns.enabled`, cd.enabled, D.countdowns.enabled),
    max: num(ctx, `${p}.countdowns.max`, cd.max, D.countdowns.max, 1, 12, true),
  };
  const al = obj(ctx, `${p}.alerts`, x.alerts);
  const alerts = {
    enabled: bool(ctx, `${p}.alerts.enabled`, al.enabled, D.alerts.enabled),
    sound: bool(ctx, `${p}.alerts.sound`, al.sound, D.alerts.sound),
    volume: num(ctx, `${p}.alerts.volume`, al.volume, D.alerts.volume, 0, 1),
  };

  const pv = obj(ctx, `${p}.privacy`, x.privacy);
  const privacy = {
    hidePhotos: bool(ctx, `${p}.privacy.hidePhotos`, pv.hidePhotos, D.privacy.hidePhotos),
    showLock: bool(ctx, `${p}.privacy.showLock`, pv.showLock, D.privacy.showLock),
    schedule: list(ctx, `${p}.privacy.schedule`, pv.schedule, [], MAX_PRIVACY_RULES, sanitizePrivacyRule),
  };

  return {
    id: id(ctx, `${p}.id`, x.id, 's_', seenIds), slug, name,
    screen, layout, background, calendar, datetime, weather, news, todo, message, countdowns, alerts, privacy,
  };
}

/** A privacy schedule rule: days (0 = Sunday, [] = every day) and a from/to window (`to < from` crosses midnight). */
function sanitizePrivacyRule(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'p_', seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    days: weekdays(ctx, `${p}.days`, x.days),
    from: hhmm(ctx, `${p}.from`, x.from, '22:00'),
    to: hhmm(ctx, `${p}.to`, x.to, '07:00'),
  };
  if (out.from === out.to) ctx.err(`${p}.to`, 'must differ from `from`');
  return out;
}

function sanitizeLocalEvent(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const allDay = bool(ctx, `${p}.allDay`, x.allDay, true);
  const start = date(ctx, `${p}.date`, x.date, null);
  if (!start) { if (x.date === undefined) ctx.err(`${p}.date`, 'required'); return null; }
  let endDate = date(ctx, `${p}.endDate`, x.endDate, start, true) || start;
  if (endDate < start) { ctx.err(`${p}.endDate`, 'must be >= date'); endDate = start; }
  const rp = obj(ctx, `${p}.repeat`, x.repeat);
  const freq = oneOf(ctx, `${p}.repeat.freq`, rp.freq, 'none', ['none', 'weekly', 'monthly', 'yearly']);
  let until = date(ctx, `${p}.repeat.until`, rp.until, null, true);
  if (until && until < start) { ctx.err(`${p}.repeat.until`, 'must be >= date'); until = null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'l_', seen),
    title: requiredStr(ctx, `${p}.title`, x.title, '', 120),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    color: color(ctx, `${p}.color`, x.color, null, true),
    location: str(ctx, `${p}.location`, x.location, '', 120).trim(),
    notes: str(ctx, `${p}.notes`, x.notes, '', 1000),
    allDay,
    date: start,
    endDate,
    startTime: allDay ? '' : hhmm(ctx, `${p}.startTime`, x.startTime ?? '', '09:00'),
    endTime: allDay ? '' : hhmm(ctx, `${p}.endTime`, x.endTime ?? '', '10:00'),
    repeat: {
      freq,
      interval: num(ctx, `${p}.repeat.interval`, rp.interval, 1, 1, 99, true),
      until,
      weekdays: freq === 'weekly' ? weekdays(ctx, `${p}.repeat.weekdays`, rp.weekdays) : [],
    },
    exceptions: arr(ctx, `${p}.exceptions`, x.exceptions, [], 200).filter(isValidDate),
    countdown: bool(ctx, `${p}.countdown`, x.countdown, false),
  };
  if (!allDay && endDate === start && out.endTime <= out.startTime) ctx.err(`${p}.endTime`, 'must be after startTime');
  return out;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function sanitizeBirthday(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const month = num(ctx, `${p}.month`, x.month, 1, 1, 12, true);
  let day = num(ctx, `${p}.day`, x.day, 1, 1, 31, true);
  if (day > DAYS_IN_MONTH[month - 1]) { ctx.err(`${p}.day`, 'invalid day for month'); day = DAYS_IN_MONTH[month - 1]; }
  const year = x.year === null || x.year === undefined || x.year === '' ? null : num(ctx, `${p}.year`, x.year, null, 1900, 2100, true);
  return {
    id: id(ctx, `${p}.id`, x.id, 'b_', seen),
    name: requiredStr(ctx, `${p}.name`, x.name, '', 80),
    month, day, year,
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
  };
}

function sanitizeEventRule(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'f_', seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    action: oneOf(ctx, `${p}.action`, x.action, 'hide', ['hide', 'rename', 'style']),
    match: requiredStr(ctx, `${p}.match`, x.match, '', 120),
    matchMode: oneOf(ctx, `${p}.matchMode`, x.matchMode, 'contains', ['contains', 'exact', 'startsWith']),
    field: oneOf(ctx, `${p}.field`, x.field, 'title', ['title', 'any']),
    sourceIds: idList(ctx, `${p}.sourceIds`, x.sourceIds),
    replaceWith: str(ctx, `${p}.replaceWith`, x.replaceWith, '', 120),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    color: color(ctx, `${p}.color`, x.color, null, true),
    countdown: bool(ctx, `${p}.countdown`, x.countdown, false),
    note: str(ctx, `${p}.note`, x.note, '', 200),
  };
  if (out.action === 'style' && !out.emoji && !out.color && !out.countdown) ctx.err(`${p}.emoji`, 'style rule needs an emoji, a color or countdown');
  return out;
}

function sanitizeCountdown(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const d = date(ctx, `${p}.date`, x.date, null);
  if (!d) { if (x.date === undefined) ctx.err(`${p}.date`, 'required'); return null; }
  return {
    id: id(ctx, `${p}.id`, x.id, 'k_', seen),
    title: requiredStr(ctx, `${p}.title`, x.title, '', 80),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    color: color(ctx, `${p}.color`, x.color, null, true),
    date: d,
    yearly: bool(ctx, `${p}.yearly`, x.yearly, false),
  };
}

function sanitizeSchedule(ctx, p, x, seen) {
  if (!isObj(x)) { ctx.err(p, 'expected object'); return null; }
  const out = {
    id: id(ctx, `${p}.id`, x.id, 'm_', seen),
    enabled: bool(ctx, `${p}.enabled`, x.enabled, true),
    title: requiredStr(ctx, `${p}.title`, x.title, '', 80),
    body: str(ctx, `${p}.body`, x.body, '', 300),
    emoji: emoji(ctx, `${p}.emoji`, x.emoji, ''),
    style: oneOf(ctx, `${p}.style`, x.style, 'info', ALERT_STYLES),
    days: weekdays(ctx, `${p}.days`, x.days),
    from: hhmm(ctx, `${p}.from`, x.from, '20:00'),
    to: hhmm(ctx, `${p}.to`, x.to, '22:00'),
    startDate: date(ctx, `${p}.startDate`, x.startDate, null, true),
    endDate: date(ctx, `${p}.endDate`, x.endDate, null, true),
    screenIds: idList(ctx, `${p}.screenIds`, x.screenIds, MAX_SCREENS),
    sound: bool(ctx, `${p}.sound`, x.sound, false),
  };
  if (out.from === out.to) ctx.err(`${p}.to`, 'must differ from `from`');
  if (out.startDate && out.endDate && out.endDate < out.startDate) ctx.err(`${p}.endDate`, 'must be >= startDate');
  return out;
}

const list = (ctx, path, v, d, max, fn) => {
  const seen = new Set();
  return arr(ctx, path, v, d, max).map((x, i) => fn(ctx, `${path}[${i}]`, x, seen)).filter(Boolean);
};

/** True when `c` has the v1 single-screen shape. */
export const isV1 = (c) => isObj(c) && !Array.isArray(c.screens) && !(Number(c.version) >= 2);

/**
 * v1 (single screen) → v2 (screens[]). Pure; never loses data: every v1 key lands in the global part or in
 * screens[0]. Already-v2 input is returned unchanged. See docs/ARCHITECTURE.md
 */
export function migrateConfig(raw) {
  if (!isV1(raw)) return raw;
  const c = raw;
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => isObj(o) && k in o).map((k) => [k, o[k]]));
  const omit = (o, keys) => (isObj(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) : undefined);
  const name = (isObj(c.screen) && typeof c.screen.name === 'string' && c.screen.name.trim()) || 'Living room';
  const slug = slugify(name) || 'main';
  const sid = `s_${slug.replace(/-/g, '_')}`.slice(0, 64);
  const screenProfile = { id: sid, slug, name };
  if (isObj(c.screen)) screenProfile.screen = omit(c.screen, ['name']);
  for (const k of ['layout', 'background', 'message']) if (isObj(c[k])) screenProfile[k] = c[k];
  for (const [k, keys] of Object.entries(SCREEN_SPLIT_KEYS)) if (isObj(c[k])) screenProfile[k] = pick(c[k], keys);
  const out = {
    version: CONFIG_VERSION,
    revision: c.revision,
    defaultScreen: sid,
    screens: [screenProfile],
  };
  for (const k of Object.keys(SCREEN_SPLIT_KEYS)) if (isObj(c[k])) out[k] = omit(c[k], SCREEN_SPLIT_KEYS[k]);
  for (const k of ['homeassistant', 'auth', 'security']) if (k in c) out[k] = c[k];
  return out;
}

/**
 * Validate a full (v2) config object. v1 input is migrated first. Returns { ok, errors, value }.
 * `value` is always a complete, sanitised config (defaults fill gaps); callers decide whether to persist it on errors.
 * `opts.weatherKeySet` (the admin save only): false when no weather API key is stored, so choosing a source that
 * needs one is refused (weather.apiKey 'API key required'). Left out, keys are not checked (imports, restores).
 */
export function validateConfig(input, opts = {}) {
  const ctx = new Ctx();
  const D = defaultConfig();
  const c = obj(ctx, '', migrateConfig(input));

  // ---- global: calendar sources + icon rules
  const ca = obj(ctx, 'calendar', c.calendar);
  const srcSeen = new Set(RESERVED_SOURCE_IDS);
  const ruleSeen = new Set();
  const calendar = {
    sources: arr(ctx, 'calendar.sources', ca.sources, D.calendar.sources, 50)
      .map((s, i) => sanitizeSource(ctx, `calendar.sources[${i}]`, s, srcSeen)).filter(Boolean),
    iconRules: arr(ctx, 'calendar.iconRules', ca.iconRules, D.calendar.iconRules, 200)
      .map((r, i) => sanitizeRule(ctx, `calendar.iconRules[${i}]`, r, ruleSeen)).filter(Boolean),
  };

  const dt = obj(ctx, 'datetime', c.datetime);
  let tz = str(ctx, 'datetime.timezone', dt.timezone, D.datetime.timezone, 64);
  if (!isValidTimeZone(tz)) { ctx.err('datetime.timezone', 'unknown timezone'); tz = D.datetime.timezone; }
  const datetime = { timezone: tz };

  const we = obj(ctx, 'weather', c.weather);
  const entity = (p, v) => {
    const s = str(ctx, p, v, '', 255).trim();
    if (s && !/^[a-z_]+\.[a-z0-9_]+$/i.test(s)) { ctx.err(p, 'invalid entity id'); return ''; }
    return s;
  };
  const weather = {
    provider: oneOf(ctx, 'weather.provider', we.provider, D.weather.provider, WEATHER_PROVIDER_IDS),
    model: oneOf(ctx, 'weather.model', we.model, D.weather.model, OPEN_METEO_MODEL_IDS),
    locationName: str(ctx, 'weather.locationName', we.locationName, D.weather.locationName, 80),
    lat: num(ctx, 'weather.lat', we.lat, D.weather.lat, -90, 90),
    lon: num(ctx, 'weather.lon', we.lon, D.weather.lon, -180, 180),
    units: oneOf(ctx, 'weather.units', we.units, D.weather.units, ['metric', 'imperial']),
    haWeatherEntity: entity('weather.haWeatherEntity', we.haWeatherEntity),
    haIndoorTempEntity: entity('weather.haIndoorTempEntity', we.haIndoorTempEntity),
    haIndoorHumidityEntity: entity('weather.haIndoorHumidityEntity', we.haIndoorHumidityEntity),
  };
  if (opts.weatherKeySet === false && KEY_PROVIDERS.includes(weather.provider)) ctx.err('weather.apiKey', 'API key required');

  const ne = obj(ctx, 'news', c.news);
  const feedSeen = new Set();
  const news = {
    feeds: arr(ctx, 'news.feeds', ne.feeds, D.news.feeds, 20).map((f, i) => {
      const p = `news.feeds[${i}]`;
      if (!isObj(f)) { ctx.err(p, 'expected object'); return null; }
      const url = str(ctx, `${p}.url`, f.url, '', 2048).trim();
      if (!isHttpUrl(url)) ctx.err(`${p}.url`, 'invalid URL');
      return {
        id: id(ctx, `${p}.id`, f.id, 'n_', feedSeen),
        name: str(ctx, `${p}.name`, f.name, '', 80),
        url,
        enabled: bool(ctx, `${p}.enabled`, f.enabled, true),
      };
    }).filter(Boolean),
    maxItems: num(ctx, 'news.maxItems', ne.maxItems, D.news.maxItems, 1, 200, true),
  };

  const td = obj(ctx, 'todo', c.todo);
  const todo = {
    items: list(ctx, 'todo.items', td.items, [], 100, (cx, p, it, seen) => {
      if (!isObj(it)) { cx.err(p, 'expected object'); return null; }
      return { id: id(cx, `${p}.id`, it.id, 't_', seen), text: str(cx, `${p}.text`, it.text, '', 200), done: bool(cx, `${p}.done`, it.done, false) };
    }),
  };

  // ---- F2 local events + birthdays
  const le = obj(ctx, 'localEvents', c.localEvents);
  const localEvents = {
    enabled: bool(ctx, 'localEvents.enabled', le.enabled, D.localEvents.enabled),
    name: str(ctx, 'localEvents.name', le.name, D.localEvents.name, 80).trim() || D.localEvents.name,
    color: color(ctx, 'localEvents.color', le.color, D.localEvents.color),
    emoji: emoji(ctx, 'localEvents.emoji', le.emoji, D.localEvents.emoji),
    privacy: oneOf(ctx, 'localEvents.privacy', le.privacy, D.localEvents.privacy, PRIVACY_MODES),
    items: list(ctx, 'localEvents.items', le.items, [], 1000, sanitizeLocalEvent),
  };
  const bd = obj(ctx, 'birthdays', c.birthdays);
  const birthdays = {
    enabled: bool(ctx, 'birthdays.enabled', bd.enabled, D.birthdays.enabled),
    name: str(ctx, 'birthdays.name', bd.name, D.birthdays.name, 80).trim() || D.birthdays.name,
    color: color(ctx, 'birthdays.color', bd.color, D.birthdays.color),
    emoji: emoji(ctx, 'birthdays.emoji', bd.emoji, D.birthdays.emoji),
    showAge: bool(ctx, 'birthdays.showAge', bd.showAge, D.birthdays.showAge),
    privacy: oneOf(ctx, 'birthdays.privacy', bd.privacy, D.birthdays.privacy, PRIVACY_MODES),
    items: list(ctx, 'birthdays.items', bd.items, [], 500, sanitizeBirthday),
  };

  // ---- F3 event rules (filters / overrides)
  const er = obj(ctx, 'eventRules', c.eventRules);
  const eventRules = { items: list(ctx, 'eventRules.items', er.items, [], 200, sanitizeEventRule) };

  // ---- F4 countdowns (global list)
  const cd = obj(ctx, 'countdowns', c.countdowns);
  const countdowns = {
    items: list(ctx, 'countdowns.items', cd.items, [], 100, sanitizeCountdown),
    includeBirthdays: bool(ctx, 'countdowns.includeBirthdays', cd.includeBirthdays, D.countdowns.includeBirthdays),
    birthdayDays: num(ctx, 'countdowns.birthdayDays', cd.birthdayDays, D.countdowns.birthdayDays, 1, 366, true),
    includeFlagged: bool(ctx, 'countdowns.includeFlagged', cd.includeFlagged, D.countdowns.includeFlagged),
    horizonDays: num(ctx, 'countdowns.horizonDays', cd.horizonDays, D.countdowns.horizonDays, 1, 1000, true),
  };

  // ---- F5 scheduled messages
  const sm = obj(ctx, 'schedules', c.schedules);
  const schedules = { items: list(ctx, 'schedules.items', sm.items, [], 100, sanitizeSchedule) };

  const ha = obj(ctx, 'homeassistant', c.homeassistant);
  const haUrl = str(ctx, 'homeassistant.url', ha.url, D.homeassistant.url, 512).trim().replace(/\/+$/, '');
  if (haUrl && !isHttpUrl(haUrl)) ctx.err('homeassistant.url', 'invalid URL');
  // Doorbell camera (POST /api/hooks/doorbell): one camera entity, how long the picture stays, which screens, sound.
  const db = obj(ctx, 'homeassistant.doorbell', ha.doorbell);
  const DD = D.homeassistant.doorbell;
  let camera = str(ctx, 'homeassistant.doorbell.camera', db.camera, DD.camera, 255).trim();
  if (camera && !CAMERA_RE.test(camera)) { ctx.err('homeassistant.doorbell.camera', 'must be a camera entity id (camera.…)'); camera = ''; }
  const homeassistant = {
    enabled: bool(ctx, 'homeassistant.enabled', ha.enabled, D.homeassistant.enabled),
    url: haUrl,
    doorbell: {
      camera,
      seconds: num(ctx, 'homeassistant.doorbell.seconds', db.seconds, DD.seconds, DOORBELL_MIN_SEC, DOORBELL_MAX_SEC, true),
      screenIds: idList(ctx, 'homeassistant.doorbell.screenIds', db.screenIds, MAX_SCREENS),
      sound: bool(ctx, 'homeassistant.doorbell.sound', db.sound, DD.sound),
    },
  };

  const au = obj(ctx, 'auth', c.auth);
  const emails = arr(ctx, 'auth.allowedGoogleEmails', au.allowedGoogleEmails, [], 50)
    .filter((e) => typeof e === 'string').map((e) => e.trim().toLowerCase()).filter(Boolean);
  emails.forEach((e, i) => { if (!EMAIL.test(e)) ctx.err(`auth.allowedGoogleEmails[${i}]`, 'invalid email'); });
  const auth = {
    allowedGoogleEmails: [...new Set(emails.filter((e) => EMAIL.test(e)))],
    passwordLoginEnabled: bool(ctx, 'auth.passwordLoginEnabled', au.passwordLoginEnabled, D.auth.passwordLoginEnabled),
  };

  const se = obj(ctx, 'security', c.security);
  const security = {
    displayAccess: oneOf(ctx, 'security.displayAccess', se.displayAccess, D.security.displayAccess, ['private', 'open']),
  };

  // ---- F1 screens
  let rawScreens = arr(ctx, 'screens', c.screens, D.screens, MAX_SCREENS);
  if (!rawScreens.length) { ctx.err('screens', 'at least one screen'); rawScreens = D.screens; }
  const seenIds = new Set();
  const seenSlugs = new Set();
  const screens = rawScreens.map((s, i) => sanitizeScreenProfile(ctx, `screens[${i}]`, s, seenIds, seenSlugs));
  // Drop references to sources / screens that no longer exist (silently: deleting a source is legit).
  const knownSources = new Set([...RESERVED_SOURCE_IDS, ...calendar.sources.map((s) => s.id)]);
  for (const s of screens) if (s.calendar.sourceIds) s.calendar.sourceIds = s.calendar.sourceIds.filter((x) => knownSources.has(x));
  const screenIds = new Set(screens.map((s) => s.id));
  for (const m of schedules.items) {
    const keep = m.screenIds.filter((x) => screenIds.has(x));
    // Every target screen is gone: an empty list would mean "all screens", so retire it instead
    // (same rule as announce.js pruneScreens). The admin shows it disabled with "todas".
    if (m.screenIds.length && !keep.length) m.enabled = false;
    m.screenIds = keep;
  }
  // Doorbell screens that were deleted are dropped; when none is left the ring goes to the default screen only
  // (an empty list would mean every screen, and a camera picture should not spread to screens nobody chose).
  const dbKeep = homeassistant.doorbell.screenIds.filter((x) => screenIds.has(x));
  const dbLost = homeassistant.doorbell.screenIds.length && !dbKeep.length;
  homeassistant.doorbell.screenIds = dbKeep;
  let defaultScreen = typeof c.defaultScreen === 'string' ? c.defaultScreen : screens[0].id;
  if (!screenIds.has(defaultScreen)) {
    if (c.defaultScreen !== undefined) ctx.err('defaultScreen', 'unknown screen id');
    defaultScreen = screens[0].id;
  }

  if (dbLost) homeassistant.doorbell.screenIds = [defaultScreen];
  const revision = Number.isInteger(c.revision) && c.revision > 0 ? c.revision : 1;
  const value = {
    version: CONFIG_VERSION, revision, defaultScreen, screens,
    calendar, datetime, weather, news, todo, localEvents, birthdays, eventRules, countdowns, schedules, homeassistant, auth, security,
  };
  return { ok: ctx.errors.length === 0, errors: ctx.errors, value };
}

/**
 * Deep-merge stored config over defaults (missing keys → defaults; arrays replaced wholesale).
 * v1 input is migrated first; every screen profile is merged over defaultScreenProfile().
 */
export function mergeDefaults(stored) {
  const D = defaultConfig();
  const merge = (d, s) => {
    if (!isObj(d) || !isObj(s)) return s === undefined ? d : s;
    const out = { ...d };
    for (const k of Object.keys(s)) out[k] = k in d ? merge(d[k], s[k]) : s[k];
    return out;
  };
  const src = migrateConfig(isObj(stored) ? stored : {});
  const out = merge(D, src);
  if (Array.isArray(src.screens) && src.screens.length) {
    // a screen saved before display styles existed keeps the Classic look; only new screens start Modern
    const keepStyle = (s) => (isObj(s.screen) && 'style' in s.screen ? s : { ...s, screen: { ...(isObj(s.screen) ? s.screen : {}), style: 'classic' } });
    // the same for compact busy days: screens saved before the option keep the month grid they had
    const keepGrid = (s) => (isObj(s.calendar) && 'compactBusyDays' in s.calendar ? s : { ...s, calendar: { ...(isObj(s.calendar) ? s.calendar : {}), compactBusyDays: false } });
    out.screens = src.screens.map((s) => (isObj(s) ? merge(defaultScreenProfile({ id: s.id, slug: s.slug, name: s.name }), keepGrid(keepStyle(s))) : s));
  }
  return out;
}

export { SCREEN_ONLY_KEYS, SCREEN_SPLIT_KEYS };
