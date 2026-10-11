import ICON_RULES from './iconRules.js';

// Default configuration (created on first run, and used to back-fill missing keys on load).
// Icon rules are shared with the admin and display (server/core/iconRules.js).
export const DEFAULT_ICON_RULES = ICON_RULES.map((r) => ({ id: r.id, match: [...r.match], emoji: r.emoji, color: null }));

export const DEFAULT_SOURCES = [
  // A public example feed only. Add your own calendars (Google, iCal, vacation-rental feeds…) in the admin panel.
  {
    id: 'c_holidays', type: 'ics', name: 'Public holidays',
    url: 'https://calendar.google.com/calendar/ical/en.portuguese%23holiday%40group.v.calendar.google.com/public/basic.ics',
    color: '#f4a261', emoji: '🎉', kind: 'holidays', enabled: true, refreshMin: 360, insecureTls: false, privacy: 'keep',
  },
];

// ---- Config schema v2 (multi-screen). See docs/ARCHITECTURE.md. ----
export const CONFIG_VERSION = 2;

/** Built-in pseudo-source ids (F2). User sources can never take these ids. */
export const LOCAL_SOURCE_ID = 'local';
export const BIRTHDAYS_SOURCE_ID = 'birthdays';
export const RESERVED_SOURCE_IDS = [LOCAL_SOURCE_ID, BIRTHDAYS_SOURCE_ID];

/** Per-screen part of the keys that are split between global and per-screen ("merged sections"). */
export const SCREEN_SPLIT_KEYS = {
  calendar: ['enabled', 'view', 'weeks', 'weekStart', 'showLocation', 'showEndTime', 'showDayXofY', 'showLegend', 'hidePast', 'maxEventsPerDay', 'marquee', 'rotateBusyDays', 'compactBusyDays', 'startToday', 'fontScale', 'sourceIds'],
  datetime: ['enabled', 'clock', 'format24', 'showSeconds', 'showAmPm', 'dateFormat', 'dateCustom'],
  weather: ['enabled', 'forecastDays', 'showHourly', 'showPrecipChance'],
  news: ['enabled', 'rotateSec'],
  todo: ['enabled'],
  countdowns: ['enabled', 'max'],
};
/** Keys that only exist per screen (whole object lives in the screen profile). */
export const SCREEN_ONLY_KEYS = ['screen', 'layout', 'background', 'message', 'alerts', 'privacy'];

/** A complete screen profile with default values (screen.name lives in profile.name). */
export function defaultScreenProfile({ id = 's_main', slug = 'living-room', name = 'Living room' } = {}) {
  return structuredClone({
    id, slug, name,
    screen: {
      language: 'en', fontScale: 1.0, theme: 'dark', style: 'modern', accent: '#ff5a4e', orientation: 'auto', customCss: '',
      nightMode: { enabled: false, from: '23:00', to: '07:00', dim: 0.35 },
      // Modern style glass material (ignored by Classic). The defaults reproduce the original Modern look.
      glass: { appearance: 'auto', opacity: 0.5, blur: 18, tint: 'dark', edge: true },
    },
    // people: calendar ids shown as columns by the 'people' layout (null = automatic); corner: where the
    // 'photoFrame' layout puts its small clock card (tl, tr, bl, br)
    layout: { preset: 'bigCalendar', sidePanel: 'left', sideWidth: 0.36, people: null, corner: 'br' },
    background: {
      enabled: true, source: 'stock', stockTopic: 'nature', order: 'random', intervalSec: 120, brightness: 0.85, showMeta: false,
      cover: true, transition: 'webgl', ambient: 'aurora',
      panelBlur: 18, panelShade: 0.5, weatherFx: 'simple',
    },
    calendar: {
      enabled: true, view: 'month', weeks: 5, weekStart: 1, showLocation: false, showEndTime: false,
      showDayXofY: true, showLegend: true, hidePast: false, maxEventsPerDay: 4,
      // marquee: titles cut short slide to show the rest; rotateBusyDays: a day with more events than fit pages through them
      marquee: true, rotateBusyDays: true,
      // compactBusyDays: a month-grid day that cannot fit its events shows them as small one-line entries, and week
      // rows share the height by how many events they have (on for new screens, off for screens saved before it)
      compactBusyDays: true,
      // startToday: the grid starts on today instead of the first day of the week (no past days on screen)
      startToday: false,
      // fontScale: size of the grid entries relative to the screen's text size (smaller = more and longer titles)
      fontScale: 1,
      sourceIds: null, // null = every enabled source (incl. local + birthdays); array = only these ids
    },
    datetime: { enabled: true, clock: 'digital', format24: true, showSeconds: true, showAmPm: false, dateFormat: 'weekday_d_month', dateCustom: '{dddd}, {d} {mmmm} {yyyy}' },
    weather: { enabled: true, forecastDays: 5, showHourly: true, showPrecipChance: true },
    news: { enabled: true, rotateSec: 15 },
    todo: { enabled: false },
    message: { enabled: false, text: '', emoji: '💬' },
    countdowns: { enabled: true, max: 4 },
    alerts: { enabled: true, sound: true, volume: 0.6 },
    // privacy mode (server/core/privacy.js): photos replaced by stock ones while private, a small lock on screen,
    // and rules that turn it on by themselves ({ id, enabled, days, from, to }, `to < from` crosses midnight)
    privacy: { hidePhotos: false, showLock: true, schedule: [] },
  });
}

export function defaultConfig() {
  return structuredClone({
    version: CONFIG_VERSION,
    revision: 1,
    defaultScreen: 's_main',
    screens: [defaultScreenProfile()],
    // ---- global sections ----
    calendar: { sources: DEFAULT_SOURCES, iconRules: DEFAULT_ICON_RULES },
    datetime: { timezone: 'Europe/Lisbon' },
    weather: {
      // provider: a source of server/core/weather.js (or 'homeassistant'); model: an Open-Meteo forecast model
      provider: 'open-meteo', model: 'best_match', locationName: 'Lisbon, Portugal', lat: 38.7223, lon: -9.1393, units: 'metric',
      haWeatherEntity: '', haIndoorTempEntity: '', haIndoorHumidityEntity: '',
    },
    news: {
      feeds: [{ id: 'n1', name: 'BBC News – World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', enabled: true }],
      maxItems: 30,
    },
    todo: { items: [] },
    localEvents: { enabled: true, name: 'Family', color: '#e76f51', emoji: '', privacy: 'busy', items: [] },
    birthdays: { enabled: true, name: 'Birthdays', color: '#ff6f91', emoji: '🎂', showAge: true, privacy: 'keep', items: [] },
    eventRules: { items: [] },
    countdowns: { items: [], includeBirthdays: true, birthdayDays: 30, includeFlagged: true, horizonDays: 365 },
    schedules: { items: [] },
    // doorbell: camera entity (camera.*), seconds on screen (10..300), screenIds ([] = all), door chime on/off
    homeassistant: {
      enabled: false, url: 'http://homeassistant.local:8123',
      doorbell: { camera: '', seconds: 60, screenIds: [], sound: true },
    },
    auth: { allowedGoogleEmails: [], passwordLoginEnabled: true },
    // 'private': every display needs its private link (/d/<key>) or a paired-device token (server/displayAccess.js).
    // 'open': legacy LAN mode (/ and /?screen= work without a key). Configs saved before 0.3 load as 'open'.
    security: { displayAccess: 'private' },
  });
}
