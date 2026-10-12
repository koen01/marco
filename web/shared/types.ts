// Shared JSON contracts, see docs/API.md and docs/ARCHITECTURE.md. Imported by both the display and the admin panel.
// Keep in sync with the server (server/core/validate.js, server/core/defaults.js).
import type { PhotoFrame } from './focus';

export type Lang = 'es' | 'en' | 'pt' | 'nl';
export type LayoutPreset =
  | 'bigCalendar' | 'leftRight' | 'topBottom' | 'bigTime' | 'agenda'
  | 'today' | 'people' | 'photoFrame' | 'twoWeeks' | 'board' | 'bedside';
/** Corner of the clock card in the 'photoFrame' layout: top-left, top-right, bottom-left, bottom-right. */
export type FrameCorner = 'tl' | 'tr' | 'bl' | 'br';
export type SourceKind = 'generic' | 'airbnb' | 'birthdays' | 'holidays';
export type SourceType = 'ics' | 'google' | 'microsoft';
export type DateFormat = 'weekday_month_d' | 'weekday_d_month' | 'weekday_d_dot_month' | 'weekday_month_d_y' | 'weekday_mdy' | 'weekday_dmy' | 'weekday_iso' | 'custom';
/** Every date format, in the order the admin offers them. */
export const DATE_FORMATS: DateFormat[] = ['weekday_d_month', 'weekday_month_d', 'weekday_d_dot_month', 'weekday_month_d_y', 'weekday_mdy', 'weekday_dmy', 'weekday_iso', 'custom'];

export interface NightMode {
  enabled: boolean;
  from: string; // "HH:MM"
  to: string; // "HH:MM"
  dim: number; // 0..1 (brightness multiplier applied at night)
}

export type DisplayStyle = 'classic' | 'modern';

/** Glass material of the Modern style (like iOS Liquid Glass): ignored by Classic. */
export interface GlassConfig {
  /** 'auto' follows the photo (clearer over dark photos, more tinted over bright ones); 'clear' or 'tinted' fix it. */
  appearance: 'auto' | 'clear' | 'tinted';
  /** 0 = most see-through, 1 = most solid (0.5 = the default Modern look). */
  opacity: number;
  /** Background blur, 0..40 (0 = none). */
  blur: number;
  /** Tint colour: dark, light, or taken from the current photo. */
  tint: 'dark' | 'light' | 'photo';
  /** Thin light ring along the card edge. */
  edge: boolean;
}

export interface ScreenConfig {
  name: string;
  language: Lang;
  fontScale: number;
  theme: 'dark' | 'light' | string;
  /** Display style, independent of the layout: 'classic' (default) or 'modern' (glass cards, Apple-like). */
  style?: DisplayStyle;
  /** Glass options for the Modern style. Missing = defaults (GLASS_DEFAULTS). */
  glass?: GlassConfig;
  accent: string;
  orientation: 'auto' | 'landscape' | 'portrait' | string;
  customCss: string;
  nightMode: NightMode;
}

export interface LayoutConfig {
  preset: LayoutPreset;
  sidePanel: 'left' | 'right';
  sideWidth: number; // 0..1 fraction of the screen width
  /** 'people' layout: calendar ids shown as columns (max 5); null / missing = automatic. */
  people?: string[] | null;
  /** 'photoFrame' layout: corner of the clock card (default 'br'). */
  corner?: FrameCorner;
}

export interface BackgroundConfig {
  enabled: boolean;
  source: 'stock' | 'gallery' | 'mixed';
  stockTopic: string;
  /** gallery rotation order: shuffled (no immediate repeats), newest upload first, or by file name */
  order?: 'random' | 'newest' | 'name';
  intervalSec: number;
  brightness: number;
  showMeta: boolean;
  cover: boolean;
  transition: 'webgl' | 'fade' | 'none';
  ambient: 'aurora' | 'particles' | 'none';
  /** frosted weather card: backdrop blur (px at 1080p, 0 = off) and darkness (0..1, 0.5 = default) */
  panelBlur?: number;
  panelShade?: number;
  /** effect over the photo for the current weather: none, light rain/snow particles, or drops on the glass with sun rays */
  weatherFx?: 'off' | 'simple' | 'rich';
  /**
   * The photo fills the whole screen, behind the calendar too, instead of only the side panel (landscape) or the
   * top band (portrait, top / bottom). The calendar pane becomes translucent and the ambient effect is not drawn
   * (default false). Layouts that already use a full-screen photo ignore it.
   */
  fullScreen?: boolean;
}

export interface CalendarSource {
  id: string;
  type: SourceType;
  name: string;
  url?: string; // ics only
  /** Sent by multi-tenant servers instead of the URL when the session has not signed in recently. The URL comes back
   *  empty, and saving a known calendar with an empty URL keeps the stored one. Never stored. */
  urlHidden?: boolean;
  googleCalendarId?: string; // google only
  googleAccount?: string; // google only
  /** Microsoft Graph calendar id (Outlook.com, Hotmail, Microsoft 365). Marco Cloud only for now. */
  microsoftCalendarId?: string; // microsoft only
  microsoftAccount?: string; // microsoft only
  color: string;
  emoji?: string;
  kind: SourceKind;
  enabled: boolean;
  refreshMin: number;
  /** what privacy mode does to its events (missing = 'busy', or 'keep' for holidays and birthdays) */
  privacy?: PrivacyMode;
}

/** Per calendar, while a screen is private: 'busy' = shown as "Busy" (time and colour only), 'hide' = left out,
 *  'keep' = shown as it is. */
export type PrivacyMode = 'busy' | 'hide' | 'keep';

/** A rule that turns privacy mode on by itself (same days / from / to rules as scheduled messages). */
export interface PrivacyRule {
  id: string; // "p_xxx"
  enabled: boolean;
  /** 0 = Sunday … 6; [] = every day. A window that crosses midnight belongs to the day it starts. */
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM; `to < from` crosses midnight
}

/** Per-screen privacy settings (ScreenProfile.privacy). */
export interface ScreenPrivacyConfig {
  /** while private, the background and photo frame use stock photos only */
  hidePhotos: boolean;
  /** small lock on the display while private */
  showLock: boolean;
  schedule: PrivacyRule[];
}

/** `privacy` of GET /api/display/config. */
export interface DisplayPrivacy {
  active: boolean;
  /** when it ends (ISO); null while active = until someone turns it off */
  until: string | null;
  /** show the lock */
  lock: boolean;
  /** ask again at this time even without a live event (a period ends, a rule starts); null = nothing planned */
  next: string | null;
}

/** One screen in GET /api/admin/privacy (and /api/hooks/privacy). */
export interface PrivacyScreenState {
  screenId: string;
  slug: string;
  name: string;
  active: boolean;
  until: string | null;
  /** who turned it on (or paused the schedule): 'admin', 'hook', 'schedule'; null when off and nothing set */
  by: 'admin' | 'hook' | 'schedule' | null;
  /** a manual "off" pauses the schedule until then */
  resumesAt: string | null;
  /** the screen has schedule rules */
  scheduled: boolean;
}

export interface PrivacyResponse {
  screens: PrivacyScreenState[];
}

/** POST /api/admin/privacy and /api/hooks/privacy. Use at most one of hours, until and untilTime; none = until
 *  turned off. */
export interface PrivacyRequest {
  mode: 'on' | 'off' | 'toggle';
  hours?: number;
  /** ISO date and time */
  until?: string;
  /** HH:MM: the next time it comes round in the configured time zone */
  untilTime?: string;
  /** slugs or ids; omitted or [] = every screen */
  screens?: string[];
}

export interface PrivacyChangeResponse {
  ok: boolean;
  /** screens whose privacy turned on or off */
  changed: string[];
  screens: PrivacyScreenState[];
}

/** Public projection of a source sent to the display (no urls / account info). */
export interface PublicCalendarSource {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  kind: SourceKind;
}

export interface IconRule {
  id: string;
  match: string[];
  emoji: string;
  color: string | null;
}

export interface CalendarConfig<S = CalendarSource> {
  enabled: boolean;
  view: 'month' | 'agenda' | 'week';
  weeks: number;
  weekStart: number; // 0 = Sunday, 1 = Monday
  showLocation: boolean;
  showEndTime: boolean;
  showDayXofY: boolean;
  showLegend: boolean;
  hidePast: boolean;
  maxEventsPerDay: number;
  /** Titles cut short in bars and lists slide slowly to show the rest (default true). */
  marquee: boolean;
  /** A day with more events than fit in the month grid pages through them every few seconds (default true). */
  rotateBusyDays: boolean;
  /**
   * Month / week grid: a day that cannot fit its events at normal size shows them as small one-line entries, and week
   * rows share the height by how many events they have (on for new screens, off for screens saved before it).
   */
  compactBusyDays: boolean;
  /** Month / week grid: the first column is today instead of the first day of the week, so no past days are shown (default false). */
  startToday: boolean;
  /**
   * Month / week grid: size of the entries (text, lanes, paddings) relative to the screen's text size, 0.4 to 1.5
   * (default 1). The clock, weather and day numbers keep the screen's size.
   */
  fontScale: number;
  /**
   * Month / week grid as day lists: every day lists its events with the whole title wrapped over several lines,
   * week rows get the height their days need, and on a portrait screen the band above the calendar only takes the
   * height of its content (default false).
   */
  dense: boolean;
  /** v2, per screen: null = every enabled source (incl. 'local' + 'birthdays'); array = only these ids. */
  sourceIds?: string[] | null;
  sources: S[];
  iconRules: IconRule[];
}

export interface DateTimeConfig {
  enabled: boolean;
  timezone: string;
  clock: 'digital' | 'analog';
  format24: boolean;
  showSeconds: boolean;
  showAmPm: boolean;
  dateFormat: DateFormat;
  /** pattern for dateFormat 'custom': {dddd} {ddd} {d} {dd} {mmmm} {mmm} {m} {mm} {yyyy} {yy} plus any text */
  dateCustom?: string;
}

/** Weather data sources (server/core/weather.js). 'homeassistant' = Open-Meteo plus a Home Assistant entity (self-hosted). */
export type WeatherProvider = 'open-meteo' | 'met-norway' | 'pirate-weather' | 'homeassistant';
/** Open-Meteo forecast models offered in the admin ('best_match' = Open-Meteo picks). */
export type OpenMeteoModel = 'best_match' | 'ecmwf_ifs' | 'icon_seamless' | 'gfs_seamless' | 'meteofrance_seamless' | 'ukmo_seamless' | 'gem_seamless' | 'jma_seamless';

export interface WeatherConfig {
  enabled: boolean;
  provider: WeatherProvider;
  /** forecast model when the data comes from Open-Meteo (open-meteo, homeassistant) */
  model: OpenMeteoModel;
  locationName: string;
  lat: number;
  lon: number;
  units: 'metric' | 'imperial';
  forecastDays: number;
  showHourly: boolean;
  showPrecipChance: boolean;
  haWeatherEntity: string;
  haIndoorTempEntity: string;
  haIndoorHumidityEntity: string;
}

export interface NewsFeed {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export interface NewsConfig {
  enabled: boolean;
  feeds: NewsFeed[];
  rotateSec: number;
  maxItems: number;
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoConfig {
  enabled: boolean;
  items: TodoItem[];
}

export interface MessageConfig {
  enabled: boolean;
  text: string;
  emoji: string;
}

export interface HomeAssistantConfig {
  enabled: boolean;
  url: string;
  /** Doorbell camera settings (POST /api/hooks/doorbell). */
  doorbell: DoorbellSettings;
}

export interface DoorbellSettings {
  /** camera.* entity whose picture is shown; '' = no picture, only the label and the chime */
  camera: string;
  /** how long a ring stays on screen, 10..300 */
  seconds: number;
  /** screens that show it; [] = every screen */
  screenIds: string[];
  /** door chime on the displays */
  sound: boolean;
}

export interface AuthConfig {
  allowedGoogleEmails: string[];
  passwordLoginEnabled: boolean;
}

// ---- display access: private links + paired devices (docs/API.md "Display access") ----

/** 'private': displays need their private link (/d/<key>) or a paired-device token. 'open': legacy LAN mode. */
export type DisplayAccessMode = 'private' | 'open';
export type DisplayAccessVia = 'key' | 'device' | 'session' | 'open';

export interface SecurityConfig {
  displayAccess: DisplayAccessMode;
}

/** GET /api/admin/display-links item: one private link per saved screen. */
export interface DisplayLink {
  screenId: string;
  slug: string;
  name: string;
  /** UUIDv4 */
  key: string;
  /** "/d/<key>" */
  path: string;
  createdAt: string;
}

export interface DisplayLinksResponse {
  mode: DisplayAccessMode;
  links: DisplayLink[];
  /** this server's LAN IPv4 addresses (LAN_ADDRESS overrides; empty inside a container) */
  lanAddresses?: string[];
  /** PUBLIC_URL origin when set to something else than localhost */
  publicUrl?: string | null;
  /** Absolute origin that serves /d/<key> when it is not the admin's own (Marco Cloud) */
  displayOrigin?: string;
}

export interface PairedDevice {
  id: string;
  name: string;
  /** first characters of the token ("md_abcd"), for recognising it */
  prefix: string;
  screenId: string;
  screenSlug: string;
  screenName: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
  userAgent: string;
  connected: boolean;
  clientIds: string[];
}

export interface DevicesResponse {
  mode: DisplayAccessMode;
  devices: PairedDevice[];
}

/** POST /api/pair/start */
export interface PairStartResponse {
  /** secret: only this display knows it; the token is handed out to it alone */
  sessionId: string;
  /** 6 characters, shown on the screen and typed in the admin */
  code: string;
  expiresAt: string;
  pollMs: number;
}

/** POST /api/pair/status { sessionId } */
export type PairStatusResponse =
  | { status: 'waiting'; code: string; expiresAt: string }
  | { status: 'paired'; token: string; screen: { id: string; slug: string; name: string }; device: { id: string; name: string } }
  | { status: 'expired' };

export interface PairClaimRequest {
  code: string;
  screenId: string;
  name?: string;
  /** Second step: pair now. Without it the server only answers `confirm` (which display is waiting). */
  confirm?: boolean;
}

/** First step of POST /api/admin/pair/claim: the display that shows this code, for the owner to confirm. */
export interface PairConfirm {
  /** Where the waiting display is: its LAN address (self-hosted) or "City, Country" (Marco Cloud); '' = unknown. */
  where: string;
  screenId: string;
  screenName: string;
}

/** POST /api/admin/pair/claim: `confirm` without `confirm: true` in the request, else `device`. */
export interface PairClaimResponse {
  confirm?: PairConfirm;
  device?: PairedDevice;
}

/** GET /api/admin/geocode?q=&lang= (Open-Meteo geocoding through the server). */
export interface GeocodeResult {
  name: string;
  /** region / state; '' when unknown */
  admin1: string;
  country: string;
  /** ISO 3166-1 alpha-2, upper case; '' when unknown */
  countryCode: string;
  lat: number;
  lon: number;
  /** IANA time zone; '' when unknown */
  timezone: string;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
}

/**
 * FLAT per-screen VIEW of the v2 config (docs/ARCHITECTURE.md): global sections merged with ONE screen's sections,
 * in the historical v1 shape (+ the new global keys). This is what admin sections edit (`SectionProps.cfg`);
 * build it with `projectScreen()` and write it back with `applyScreen()` from web/shared/screens.ts.
 * NOT the stored/wire format any more: GET/PUT /api/admin/config use `StoredConfig`.
 */
export interface AppConfig {
  version: number;
  revision: number;
  /** id of the screen this view was projected from */
  screenId: string;
  slug: string;
  defaultScreen: string;
  screen: ScreenConfig;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: CalendarConfig<CalendarSource>;
  datetime: DateTimeConfig;
  weather: WeatherConfig;
  news: NewsConfig;
  todo: TodoConfig;
  message: MessageConfig;
  countdowns: CountdownsConfig & ScreenCountdownsConfig;
  alerts: ScreenAlertsConfig;
  localEvents: LocalEventsConfig;
  birthdays: BirthdaysConfig;
  eventRules: { items: EventRule[] };
  schedules: { items: ScheduledMessage[] };
  homeassistant: HomeAssistantConfig;
  auth: AuthConfig;
  security: SecurityConfig;
  privacy: ScreenPrivacyConfig;
}

/** GET /api/display/config[?screen=<slug|id>] */
export interface DisplayConfig {
  revision: number;
  /** v2 fields below are always sent by the server; optional only because older cached payloads lack them. */
  screenId?: string;
  slug?: string;
  /** true when ?screen= did not match any screen and the default screen was served instead */
  screenFallback?: boolean;
  countdowns?: ScreenCountdownsConfig;
  alerts?: ScreenAlertsConfig;
  /** enabled scheduled messages targeting this screen (screenIds stripped) */
  schedules?: Omit<ScheduledMessage, 'screenIds'>[];
  screen: ScreenConfig;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: CalendarConfig<PublicCalendarSource>;
  datetime: DateTimeConfig;
  weather: WeatherConfig;
  news: { enabled: boolean; rotateSec: number };
  todo: TodoConfig;
  message: MessageConfig;
  /** privacy mode of this screen (servers without it leave it out) */
  privacy?: DisplayPrivacy;
}

/** CalEvent from GET /api/events */
export interface CalEvent {
  id: string;
  sourceId: string;
  title: string;
  /** ISO with offset, or YYYY-MM-DD for allDay */
  start: string;
  /** exclusive end; ISO with offset, or YYYY-MM-DD for allDay */
  end: string;
  allDay: boolean;
  location?: string | null;
  color: string;
  emoji?: string | null;
  kind: SourceKind;
  multiDay: boolean;
  description?: string | null;
  /** F2: birthdays with a known birth year (and birthdays.showAge) → age turned on that day. Display: "🎂 María (34)" */
  age?: number | null;
  /** privacy mode: a "Busy" block (title already in the screen's language, no location, emoji or description) */
  busy?: boolean;
}

export interface EventsResponse {
  generatedAt: string;
  hash: string;
  events: CalEvent[];
  errors: { sourceId: string; message: string }[];
}

export interface WeatherCurrent {
  temp: number;
  feelsLike: number | null;
  humidity: number | null;
  windKmh: number | null;
  windDir: number | null; // degrees
  windDirLabel: string;
  code: number; // WMO
  isDay: boolean;
  description: string;
  pressure?: number | null;
  uv?: number | null;
}

export interface WeatherToday {
  sunrise: string | null;
  sunset: string | null;
  min: number;
  max: number;
  precipChance: number | null;
}

export interface WeatherDaily {
  date: string; // YYYY-MM-DD
  code: number;
  min: number;
  max: number;
  precipChance: number | null;
  windKmh: number | null;
}

export interface WeatherHourly {
  time: string;
  temp: number;
  code: number;
  precipChance: number | null;
  isDay: boolean;
}

/** Where the weather comes from: the display shows `name` (and `modelName`) small, as the licences ask. */
export interface WeatherSource {
  provider: Exclude<WeatherProvider, 'homeassistant'>;
  name: string;
  model: OpenMeteoModel | null;
  modelName: string | null;
  url: string;
  /** e.g. 'CC BY 4.0'; empty when the provider names none */
  licence: string;
  licenceUrl: string;
  /** another source on top (current conditions from Home Assistant) */
  also?: string;
}

/**
 * Fields a source does not have are null (MET Norway has no precipitation probability outside the Nordics,
 * some Open-Meteo models have no UV index): the display leaves them out.
 */
export interface WeatherResponse {
  updatedAt: string;
  locationName: string;
  current: WeatherCurrent;
  today: WeatherToday;
  daily: WeatherDaily[];
  hourly: WeatherHourly[];
  indoor: { temp: number | null; humidity: number | null } | null;
  /** since 0.5; missing from older servers (then it is Open-Meteo) */
  source?: WeatherSource;
}

/** GET /api/admin/weather/key: the key itself is never sent back. */
export interface WeatherKeyStatus {
  set: boolean;
  /** last 4 characters of the stored key, to recognise it */
  hint: string;
  /** PUT only: the provider accepted the key on a test call (false when that could not be tried) */
  checked?: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  date: string;
  image?: string;
}

export interface NewsResponse {
  updatedAt: string;
  items: NewsItem[];
}

export interface Photo {
  url: string;
  author?: string;
  title?: string;
  source: 'stock' | 'gallery';
  /** gallery file name (gallery photos only) */
  file?: string;
  /** Focal point (0..1 of width / height, from the top-left) the cover crop is kept around. Gallery only. */
  focusX?: number;
  focusY?: number;
}

export interface PhotosResponse {
  photos: Photo[];
}

/** Feature flags in GET /api/health. A self-hosted server turns them all on except googleCalendar and googleLogin
 *  (on when Google credentials are set), accountMenu and microsoftCalendar. No `features` field at all (older servers) means every
 *  feature is on except accountMenu; a missing key counts as off only when `edition` is not 'self-hosted'. */
export interface Features {
  homeassistant: boolean;
  news: boolean;
  customCss: boolean;
  gallery: boolean;
  schedules: boolean;
  announcements: boolean;
  displayCommands: boolean;
  openDisplayAccess: boolean;
  insecureTls: boolean;
  googleCalendar: boolean;
  googleLogin: boolean;
  passwordLogin: boolean;
  apiTokens: boolean;
  webhooks: boolean;
  backups: boolean;
  importExport: boolean;
  includeSecrets: boolean;
  activity: boolean;
  setupWizard: boolean;
  status: boolean;
  accountMenu: boolean;
  /** Outlook.com, Hotmail and Microsoft 365 calendars (read only, Microsoft Graph). Off unless the server says so. */
  microsoftCalendar: boolean;
  /** Update banner, settings and the update button (self-hosted only; absent on older servers = off). */
  updates: boolean;
  /** Help and feedback form that reaches the people who run the server (Marco Cloud only; absent = off). */
  feedback: boolean;
  /** Privacy mode per screen (/api/admin/privacy, /api/hooks/privacy). Absent = off. */
  privacy: boolean;
  /** Doorbell ring overlay, POST /api/hooks/doorbell and the admin card (absent = off). */
  doorbell: boolean;
  /** Doorbell frames are a live camera picture proxied from Home Assistant (self-hosted). Off: the frame URL returns
   *  the latest uploaded snapshot (absent = off). */
  doorbellLive: boolean;
}

export type FeatureName = keyof Features;

/** Plan limits in GET /api/health. Absent (self-hosted) = no limit. */
export interface Limits {
  screens?: number;
  sources?: number;
  devices?: number;
  photos?: number;
  /** bytes per photo */
  photoBytes?: number;
  /** bytes for all photos together */
  totalPhotoBytes?: number;
  newsFeeds?: number;
  apiTokens?: number;
  backups?: number;
  /** webhook commands per day */
  hookCommandsPerDay?: number;
  /** bytes of custom CSS per screen */
  customCssBytes?: number;
  /** list caps; absent = the config validator's own caps (web/admin/caps.ts BUILTIN_LIMITS) */
  localEvents?: number;
  birthdays?: number;
  countdowns?: number;
}

export interface HealthResponse {
  ok: boolean;
  /** seconds since the server started; null where there is no long-running process */
  uptime: number | null;
  version: string;
  /**
   * How displays get live updates: 'sse' = /api/stream, 'poll' = GET /api/display/poll (the display falls back to a
   * config revision poll when that answers 404). Absent (old servers) = 'sse'.
   */
  live?: 'sse' | 'poll';
  /** Absent on servers older than 0.5.0. */
  edition?: 'self-hosted' | 'cloud';
  tenancy?: 'single' | 'multi';
  runtime?: 'node' | 'workers';
  /** Characters in a pairing code shown on a TV (6 when absent). */
  pairCodeLength?: number;
  features?: Partial<Features>;
  limits?: Limits;
  /** Absolute origin that serves the display pages (/d/<key>, /pair). Absent = same origin as the admin. */
  displayOrigin?: string;
  /** Absolute origin of the admin, for a display served from another origin. Absent = same origin as the display. */
  adminOrigin?: string;
  /** This server's LAN addresses; only sent to a client on the server itself (a kiosk on http://localhost). */
  lanAddresses?: string[];
}

// ---- Feedback (Marco Cloud, features.feedback) ----

export type FeedbackKind = 'problem' | 'idea' | 'other';

/** Technical details the person chose to send with a message (every field optional, all shown before sending). */
export interface FeedbackMeta {
  version?: string;
  /** admin page the form was opened from, e.g. 'calendars' */
  page?: string;
  screens?: number;
  userAgent?: string;
  lang?: string;
  timeZone?: string;
}

/** POST /api/admin/feedback */
export interface FeedbackRequest {
  kind: FeedbackKind;
  message: string;
  /** null or absent: no technical details */
  meta?: FeedbackMeta | null;
}

export interface FeedbackResponse {
  ok: true;
  id: string;
}

// ---- Updates (self-hosted, features.updates) ----

/** How the server was installed: what the admin offers to update it (server/updates.js detectInstall). */
export interface UpdateInstall {
  kind: 'release' | 'checkout' | 'docker' | 'manual';
  /** The update button works (install.sh release install with the marco-update units). */
  canApply: boolean;
  /** The `marco` command manages this install. */
  cli: boolean;
}

export interface UpdateRelease {
  version: string;
  name: string;
  /** Markdown from the CHANGELOG section of that version */
  notes: string;
  url: string | null;
  publishedAt: string | null;
}

export interface UpdateSettings {
  /** Check for a new version once a day */
  check: boolean;
  /** Install it on its own inside the window (release installs) */
  auto: boolean;
  /** HH:MM, server time zone (Date & time) */
  from: string;
  to: string;
}

export interface UpdateStatus {
  state: 'requested' | 'running' | 'done' | 'current' | 'failed';
  from: string;
  to: string;
  target: string;
  by: 'admin' | 'auto';
  at: string | null;
  rolledBack: boolean;
  /** Requested, but no update service picked it up */
  stalled: boolean;
}

/** GET /api/admin/update */
export interface UpdateInfo {
  current: string;
  latest: UpdateRelease | null;
  available: boolean;
  checkedAt: string | null;
  error: 'network' | 'http' | 'rate_limited' | 'bad_response' | null;
  /** 'env-off' = MARCO_UPDATE_CHECK=0 on the server */
  checks: 'on' | 'off' | 'env-off';
  install: UpdateInstall;
  settings: UpdateSettings;
  status: UpdateStatus | null;
  /** Last lines of the installer's output for the last update */
  log: string[];
}

/** SSE /api/stream?screen=&client= event payloads (docs/ARCHITECTURE.md) */
export type StreamEvent =
  | ({ type: 'hello' } & StreamHello)
  | { type: 'config'; revision: number }
  | { type: 'reload' }
  | { type: 'events'; hash: string }
  | ({ type: 'announce' } & Announcement)
  | { type: 'announce-clear'; id: string | null }
  | ({ type: 'identify' } & IdentifyPayload)
  | { type: 'night'; mode: NightCommand }
  | { type: 'privacy'; active: boolean }
  | ({ type: 'doorbell' } & DoorbellRing)
  | { type: 'doorbell-end'; id: string }
  | { type: 'ping'; t: number };

// ---- Admin API ----

export interface AuthUser {
  email: string;
  name: string;
  picture?: string;
  method: 'password' | 'google' | 'account';
}

/** Marco Cloud: where the account pages live and which household the admin edits. */
export interface AccountInfo {
  loginUrl: string;
  accountUrl: string;
  sessionsUrl: string;
  deleteUrl: string;
  household: HouseholdInfo;
}

export interface HouseholdInfo {
  name: string;
  role: 'owner' | 'member';
}

export interface AuthMeResponse {
  user: AuthUser | null;
  googleConfigured: boolean;
  /** Sign in with Google is offered (self-hosted: off unless the server relies on it or MARCO_GOOGLE_LOGIN=1). */
  googleLoginEnabled?: boolean;
  passwordLoginEnabled: boolean;
  /** Logged in with the initial/default password: it must be changed (only accepted from the LAN until then). */
  mustChangePassword?: boolean;
  /** Fresh install: no admin password yet → the admin shows the setup wizard. */
  needsSetup?: boolean;
  /** The initial password came from ADMIN_PASSWORD (headless install): the panel offers to change it. */
  passwordFromEnv?: boolean;
  /** Only when user.method is 'account' (Marco Cloud). */
  account?: AccountInfo;
  /** Marco Cloud: the admin shows the Microsoft accounts card when it is true (Microsoft calendars on for this account). */
  microsoftConfigured?: boolean;
}

/** GET /api/setup/status */
export interface SetupStatus {
  needsSetup: boolean;
  googleConfigured: boolean;
  version: string;
  suggestedLanguage: Lang;
  /** only while needsSetup: a setup token is needed (SETUP_TOKEN set, or the browser is not on the LAN) */
  tokenRequired?: boolean;
  /** only while needsSetup and when a token was sent (x-setup-token): whether it is right */
  tokenValid?: boolean | null;
  defaults?: { timezone: string; location: string };
  /** only while needsSetup, for LAN clients: this machine's LAN IPv4 addresses (kiosk / wizard opened on localhost → QR code).
   *  Empty in a container unless LAN_ADDRESS is set. */
  lanAddresses?: string[];
}

/** POST /api/setup/complete */
export interface SetupRequest {
  token?: string;
  password: string;
  passwordConfirm: string;
  language: Lang;
  screenName: string;
  location?: { name: string; lat: number; lon: number; timezone: string | null };
  /** time zone without a location (location skipped) */
  timezone?: string;
  units?: 'metric' | 'imperial';
  format24?: boolean;
  calendars?: { name: string; url: string; kind: 'holidays' | 'generic'; color?: string }[];
  photos?: { source: 'stock' | 'gallery' | 'mixed' };
  layout?: { preset: LayoutPreset };
  accent?: string;
  ambient?: 'aurora' | 'particles' | 'none';
  theme?: 'dark' | 'light';
}

export interface SetupCompleteResponse {
  ok: true;
  user: AuthUser;
  /** displayPath: the screen's private link ("/d/<key>") */
  screen: { id?: string; slug: string; name: string; displayPath?: string | null };
  displayAccess?: DisplayAccessMode;
}

export interface GoogleAccount {
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

export interface MicrosoftAccount {
  email: string;
}

export interface MicrosoftCalendarListItem {
  id: string;
  name: string;
  /** #rrggbb, when the calendar has a colour */
  color?: string;
  /** the account's default calendar */
  isDefault?: boolean;
  /** owner address when the calendar is shared with the account by someone else */
  owner?: string;
}

export interface TestIcsResponse {
  ok: boolean;
  count?: number;
  sample?: string[];
  error?: string;
}

export interface TestRssResponse {
  ok: boolean;
  title?: string;
  count?: number;
  error?: string;
}

export interface TestHomeAssistantResponse {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface HaEntity {
  entity_id: string;
  name: string;
  state: string;
  unit?: string;
}

export interface AdminPhoto {
  file: string;
  /** includes a ?v=<mtime> cache-busting version */
  url: string;
  /** small JPEG preview for the grid (falls back to `url` until one exists) */
  thumbUrl?: string;
  hasThumb?: boolean;
  size: number;
  mtime: string | number;
  /** pixel size as displayed (EXIF orientation applied) */
  w?: number;
  h?: number;
  focusX?: number;
  focusY?: number;
  uploadedAt?: string;
  /** excluded from the background rotation */
  hidden?: boolean;
}

export type PhotoConflictPolicy = 'replace' | 'rename' | 'skip';

export interface PhotoNameCheck {
  name: string;
  /** the name the server will store it under */
  sanitized: string;
  exists: boolean;
  /** name it would get with "keep both" */
  renamed?: string;
}

export interface PhotoUploadResult {
  ok: true;
  files: (AdminPhoto & { status: 'created' | 'replaced' | 'renamed'; requested: string })[];
  skipped: string[];
}

export interface SourceStatus {
  id: string;
  name: string;
  enabled?: boolean;
  lastFetch: string | null;
  lastSuccess?: string | null;
  ok: boolean;
  count: number;
  error?: string | null;
}

export type WeatherErrorCode = 'key_missing' | 'key_invalid' | 'rate_limited' | 'http' | 'bad_response';

export interface AdminStatus {
  sources: SourceStatus[];
  weather: { ok: boolean; updatedAt: string | null; error?: string | null; errorCode?: WeatherErrorCode | null; provider?: WeatherProvider | null };
  news: { ok: boolean; updatedAt: string | null; count?: number; error?: string | null };
  displays: number;
  /** seconds; null where there is no long-running process (Marco Cloud) */
  uptime: number | null;
}

// =================================================================================================
// v2 admin management (docs/ARCHITECTURE.md). 
// =================================================================================================

/** Built-in pseudo-source ids (F2). */
export const LOCAL_SOURCE_ID = 'local';
export const BIRTHDAYS_SOURCE_ID = 'birthdays';

export type AlertStyle = 'info' | 'success' | 'warning' | 'urgent';
export type NightCommand = 'on' | 'off' | 'auto';

// ---- §2 stored config (data/config.json, GET/PUT /api/admin/config) ----

export interface ScreenCountdownsConfig {
  enabled: boolean;
  /** max chips shown (display may show fewer if space is short) 1..12 */
  max: number;
}

export interface ScreenAlertsConfig {
  /** show announcements + scheduled messages on this screen */
  enabled: boolean;
  /** play the WebAudio chime when an alert asks for it */
  sound: boolean;
  /** 0..1 */
  volume: number;
}

/** One screen profile (F1). `screen.name` lives in `name`. */
export interface ScreenProfile {
  id: string; // "s_xxx", stable, never changes
  slug: string; // URL key for ?screen=, unique, ^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$
  name: string;
  screen: Omit<ScreenConfig, 'name'>;
  layout: LayoutConfig;
  background: BackgroundConfig;
  calendar: Pick<CalendarConfig, 'enabled' | 'view' | 'weeks' | 'weekStart' | 'showLocation' | 'showEndTime' | 'showDayXofY' | 'showLegend' | 'hidePast' | 'maxEventsPerDay' | 'marquee' | 'rotateBusyDays' | 'compactBusyDays' | 'startToday' | 'fontScale' | 'dense'> & { sourceIds: string[] | null };
  datetime: Omit<DateTimeConfig, 'timezone'>;
  weather: Pick<WeatherConfig, 'enabled' | 'forecastDays' | 'showHourly' | 'showPrecipChance'>;
  news: { enabled: boolean; rotateSec: number };
  todo: { enabled: boolean };
  message: MessageConfig;
  countdowns: ScreenCountdownsConfig;
  alerts: ScreenAlertsConfig;
  privacy: ScreenPrivacyConfig;
}

export type RepeatFreq = 'none' | 'weekly' | 'monthly' | 'yearly';

/** F2 local event (dates/times are local to datetime.timezone). */
export interface LocalEvent {
  id: string; // "l_xxx"
  title: string;
  emoji: string; // '' → icon rules / localEvents.emoji
  color: string | null; // null → localEvents.color
  location: string;
  notes: string;
  allDay: boolean;
  date: string; // YYYY-MM-DD first day
  endDate: string; // YYYY-MM-DD last day, INCLUSIVE (= date for single-day)
  startTime: string; // 'HH:MM' when !allDay, else ''
  endTime: string; // 'HH:MM' when !allDay (on endDate), else ''
  repeat: {
    freq: RepeatFreq;
    interval: number; // every N weeks/months/years, 1..99
    until: string | null; // YYYY-MM-DD inclusive (last occurrence start), null = forever
    weekdays: number[]; // weekly only, 0 = Sunday … 6; [] = weekday of `date`
  };
  /** occurrence start dates (YYYY-MM-DD) that are skipped */
  exceptions: string[];
  /** also show as a countdown chip (F4) */
  countdown: boolean;
}

export interface LocalEventsConfig {
  enabled: boolean;
  name: string; // legend name of the 'local' source
  color: string;
  emoji: string;
  /** privacy mode for local events (default 'busy') */
  privacy?: PrivacyMode;
  items: LocalEvent[];
}

/** F2 birthday → yearly all-day event of kind 'birthdays' on source 'birthdays'. */
export interface Birthday {
  id: string; // "b_xxx"
  name: string;
  month: number; // 1..12
  day: number; // 1..31 (29/02 → 28/02 on non-leap years)
  year: number | null; // birth year → age
  emoji: string; // '' → birthdays.emoji
}

export interface BirthdaysConfig {
  enabled: boolean;
  name: string;
  color: string;
  emoji: string;
  showAge: boolean;
  /** privacy mode for birthdays (default 'keep') */
  privacy?: PrivacyMode;
  items: Birthday[];
}

export type EventRuleAction = 'hide' | 'rename' | 'style';

/** F3 filter / override rule. Evaluated: hide → rename (in order, chained) → style (first match). */
export interface EventRule {
  id: string; // "f_xxx"
  enabled: boolean;
  action: EventRuleAction;
  /** accent/case-insensitive text */
  match: string;
  matchMode: 'contains' | 'exact' | 'startsWith';
  /** 'title' or 'any' (title + description + location) */
  field: 'title' | 'any';
  /** [] = every source (ids may include 'local' / 'birthdays') */
  sourceIds: string[];
  /** rename: replacement for the matched text (contains/startsWith) or the whole title (exact) */
  replaceWith: string;
  /** style: '' = unchanged */
  emoji: string;
  /** style: null = unchanged */
  color: string | null;
  /** style: also show matching events as countdown chips (F4) */
  countdown: boolean;
  note: string;
}

/** F4 manual countdown. */
export interface Countdown {
  id: string; // "k_xxx"
  title: string;
  emoji: string;
  color: string | null;
  date: string; // YYYY-MM-DD
  yearly: boolean; // repeats every year on the same month/day
}

/** Global countdown settings (per-screen enabled/max live in ScreenCountdownsConfig). */
export interface CountdownsConfig {
  items: Countdown[];
  includeBirthdays: boolean;
  /** birthdays are included when they are ≤ N days away */
  birthdayDays: number;
  /** include events flagged `countdown` (local events, style rules) */
  includeFlagged: boolean;
  /** ignore anything further than N days */
  horizonDays: number;
}

/** F5 scheduled message (recurring time window). */
export interface ScheduledMessage {
  id: string; // "m_xxx"
  enabled: boolean;
  title: string;
  body: string;
  emoji: string;
  style: AlertStyle;
  /** 0 = Sunday … 6; [] = every day. The day refers to the START of the window. */
  days: number[];
  from: string; // HH:MM
  to: string; // HH:MM; to < from → window crosses midnight
  startDate: string | null; // YYYY-MM-DD inclusive
  endDate: string | null;
  /** screen ids; [] = all screens */
  screenIds: string[];
  /** chime when the window starts */
  sound: boolean;
}

/** v2 stored config: GET/PUT /api/admin/config, backups, export. */
export interface StoredConfig {
  version: 2;
  revision: number;
  defaultScreen: string;
  screens: ScreenProfile[];
  calendar: { sources: CalendarSource[]; iconRules: IconRule[] };
  datetime: { timezone: string };
  weather: Omit<WeatherConfig, 'enabled' | 'forecastDays' | 'showHourly' | 'showPrecipChance'>;
  news: { feeds: NewsFeed[]; maxItems: number };
  todo: { items: TodoItem[] };
  localEvents: LocalEventsConfig;
  birthdays: BirthdaysConfig;
  eventRules: { items: EventRule[] };
  countdowns: CountdownsConfig;
  schedules: { items: ScheduledMessage[] };
  homeassistant: HomeAssistantConfig;
  auth: AuthConfig;
  security: SecurityConfig;
}

/** PUT /api/admin/config body: the whole config plus the revision the admin loaded it at. A stale `baseRevision`
 *  gets 409 {error:'conflict', revision}; without it the last write wins. */
export type SaveConfigRequest = StoredConfig & { baseRevision?: number };

export interface ValidationError {
  path: string;
  message: string;
}

// ---- §3 events: preview, CSV, countdowns ----

export interface EventsPreviewRequest {
  /** default today (server tz) */
  from?: string;
  /** 1..60, default 14 */
  days?: number;
  /** screen id/slug to filter sources; omitted → all enabled sources */
  screen?: string;
  /** draft calendar settings of that screen (which sources it shows) instead of the saved ones */
  screenCalendar?: { enabled: boolean; sourceIds: string[] | null };
  /** draft values to preview instead of the saved ones (all optional) */
  eventRules?: EventRule[];
  iconRules?: IconRule[];
  localEvents?: LocalEventsConfig;
  birthdays?: BirthdaysConfig;
}

export interface PreviewEvent extends CalEvent {
  hidden: boolean;
  /** title before rename rules (after kind normalisation, e.g. Airbnb) */
  originalTitle: string;
  sourceName: string;
  /** rules that changed this event, in evaluation order */
  applied: { ruleId: string; action: EventRuleAction }[];
  /** icon rule that set emoji/color (null = none / overridden) */
  iconRuleId: string | null;
}

export interface EventsPreviewResponse {
  from: string;
  to: string;
  events: PreviewEvent[];
  /** ruleId → number of events affected in the window */
  ruleHits: Record<string, number>;
  errors: { sourceId: string; message: string }[];
}

export interface BirthdayCsvResult {
  items: Birthday[]; // parsed, with fresh ids (not saved)
  errors: { line: number; text: string; message: string }[];
  duplicates: number; // lines matching an existing birthday (same name + day + month), skipped
}

export interface CountdownItem {
  id: string;
  title: string;
  emoji: string;
  color: string | null;
  date: string; // YYYY-MM-DD (next occurrence)
  /** days from server "today" at generation time (0 = today); display recomputes at midnight from `date` */
  days: number;
  origin: 'manual' | 'birthday' | 'event';
  age?: number | null;
}

export interface CountdownsResponse {
  generatedAt: string;
  today: string; // YYYY-MM-DD server tz
  hash: string;
  items: CountdownItem[];
}

// ---- §4 displays ----

/** Sent by the display: POST /api/display/heartbeat (on SSE open, every 60 s, after a command). */
export interface DisplayHeartbeat {
  clientId: string; // [A-Za-z0-9_-]{8,64}, persisted in localStorage
  screen: string; // ?screen= value as requested ('' = default)
  screenId: string; // resolved screen id from DisplayConfig
  version: string; // __APP_VERSION__
  build: string; // __APP_BUILD__ (ISO build time)
  viewport: { w: number; h: number }; // innerWidth/innerHeight
  screenRes: { w: number; h: number }; // screen.width/height
  dpr: number;
  webgl: boolean; // three.js layers actually running
  lite: boolean;
  night: boolean; // dimmed right now
  nightOverride: NightCommand; // 'auto' = following the schedule
  uptimeSec: number; // since page load
  lastError: string | null; // last uncaught error message (≤ 200 chars)
  /** photo panel geometry and the part not covered by text (focal-point editor preview) */
  photoFrame?: PhotoFrame | null;
}

export interface HeartbeatResponse {
  ok: true;
  now: string; // server ISO time
  revision: number;
}

export interface DisplayInfo {
  clientId: string;
  screenId: string;
  screenSlug: string;
  screenName: string;
  connected: boolean; // SSE stream open now
  ip: string;
  userAgent: string;
  uaShort: string; // "Chromium 128 · Linux aarch64"
  connectedAt: string | null; // current SSE connection start
  firstSeen: string;
  lastSeen: string; // last heartbeat or SSE activity
  viewport: { w: number; h: number } | null;
  screenRes: { w: number; h: number } | null;
  dpr: number | null;
  webgl: boolean | null;
  lite: boolean | null;
  version: string | null;
  build: string | null;
  /** version !== server version → display runs an old build */
  outdated: boolean;
  night: boolean | null;
  nightOverride: NightCommand | null;
  uptimeSec: number | null;
  lastError: string | null;
  photoFrame?: PhotoFrame | null;
  /** how the display got in: private link, paired device, admin session or open mode (no key) */
  access?: DisplayAccessVia;
  deviceId?: string | null;
  deviceName?: string | null;
}

export interface DisplaysResponse {
  displays: DisplayInfo[];
  serverVersion: string;
}

export interface DisplayCommandRequest {
  action: 'reload' | 'identify' | 'night';
  mode?: NightCommand; // required for 'night'
  clientIds?: string[];
  /** screen ids or slugs */
  screens?: string[];
}

export interface StreamHello {
  revision: number;
  screenId: string;
  slug: string;
  clientId: string | null;
  serverVersion: string;
  now: string; // server ISO time (clock-offset for announcement expiry)
  /** announcements still active for this screen; the display drops any other it is showing (missed clears) */
  activeAnnouncementIds: string[];
  /** doorbell ring on this screen right now, null = none (older servers: absent) */
  doorbellId?: string | null;
}

/**
 * A live command for one display, as GET /api/display/poll returns it. Names and payloads are the SSE event names
 * and payloads (StreamEvent), so one dispatcher (web/display/live.ts) serves both transports.
 */
export type DisplayCommand =
  | { type: 'reload' }
  | { type: 'night'; mode: NightCommand }
  | ({ type: 'identify' } & IdentifyPayload)
  | ({ type: 'announce' } & Announcement)
  | { type: 'announce-clear'; id: string | null }
  | { type: 'photos'; hidden?: string[] }
  /** self-hosted only: calendar data changed */
  | { type: 'events'; hash: string }
  /** privacy mode turned on or off: refetch config, events, countdowns and photos */
  | { type: 'privacy'; active: boolean }
  | ({ type: 'doorbell' } & DoorbellRing)
  | { type: 'doorbell-end'; id: string };

/** GET /api/display/poll?client=&cursor=&rev=&hidden=&preview= (docs/API.md) */
export interface PollResponse {
  /** config revision; a different one makes the display refetch its config, events and countdowns */
  revision: number;
  /** screen bound to this display now; a different one (device moved) reloads the page */
  screenId: string;
  /** server ISO time (clock offset for announcement expiry) */
  now: string;
  serverVersion: string;
  /** opaque; send it back on the next poll */
  cursor: string;
  /** true on the first poll or after an unknown cursor: `commands` only replays the active announcements */
  reset: boolean;
  /** in order, already filtered to this display */
  commands: DisplayCommand[];
  /** present on a reset and whenever `commands` holds announce or announce-clear */
  activeAnnouncementIds?: string[];
  /** present on a reset: the doorbell ring on this screen, null = none */
  doorbellId?: string | null;
  /** ms until the next poll, chosen by the server */
  next: number;
}

/** SSE `doorbell` / poll command: a ring on this screen (a later one with the same id extends it). */
export interface DoorbellRing {
  id: string;
  startedAt: string;
  updatedAt: string;
  expiresAt: string;
  /** play the door chime */
  sound: boolean;
  /** false: no camera picture (no camera chosen), only the label and the time */
  frames: boolean;
  /** ms between two frame requests to GET /api/display/doorbell/frame */
  refreshMs: number;
}

/** POST /api/hooks/doorbell, POST /api/admin/doorbell. Omitted fields take homeassistant.doorbell. */
export interface DoorbellRequest {
  action?: 'ring' | 'dismiss';
  /** 10..300 (clamped) */
  seconds?: number;
  /** slugs or ids; omitted = the configured screens (ring) or every ringing screen (dismiss) */
  screens?: string[];
  /** camera.* entity for this ring only */
  camera?: string;
  sound?: boolean;
}

export interface DoorbellResponse {
  ok: true;
  action: 'ring' | 'dismiss';
  delivered: number;
  /** slugs of the screens it reached */
  screens: string[];
  /** ring only: when the last of the rings ends */
  expiresAt?: string | null;
  /** servers that show uploaded snapshots (features.doorbellLive off): the ring has a picture */
  picture?: boolean;
}

export interface IdentifyPayload {
  name: string;
  slug: string;
  clientId: string | null;
  durationSec: number; // 10
}

// ---- §5 announcements, tokens ----

export interface AnnounceRequest {
  title?: string; // ≤120; title or body required
  body?: string; // ≤500
  emoji?: string;
  style?: AlertStyle; // default 'info'
  durationSec?: number; // 5..86400, default 30
  sound?: boolean; // default false
  /** screen ids or slugs; omitted/[] = all */
  screens?: string[];
}

export interface Announcement {
  id: string; // "a_xxx"
  title: string;
  body: string;
  emoji: string;
  style: AlertStyle;
  durationSec: number;
  sound: boolean;
  /** screen ids; [] = all */
  screenIds: string[];
  createdAt: string;
  expiresAt: string;
  via: 'admin' | 'hook';
  by: string; // admin email or "token:<name>"
  /** set when removed before expiry */
  clearedAt?: string | null;
}

export interface AnnounceResponse {
  ok: true;
  announcement: Announcement;
  delivered: number; // SSE clients that received it
}

export interface AnnouncementsResponse {
  active: Announcement[];
  history: Announcement[]; // newest first, ≤ 50
}

export interface ApiTokenInfo {
  id: string; // "tk_xxx"
  name: string;
  prefix: string; // first 8 chars of the token, e.g. "cs_Ab3x"
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  useCount: number;
}

export interface ApiTokenCreated {
  token: string; // shown ONCE
  info: ApiTokenInfo;
}

// ---- §6 backups, export/import, activity ----

export type BackupReason = 'save' | 'manual' | 'restore' | 'import' | 'migration';

export interface BackupInfo {
  id: string; // file name
  createdAt: string;
  revision: number;
  reason: BackupReason;
  size: number;
  screens: number;
  sources: number;
}

export interface ExportSecrets {
  passwordHash?: string;
  homeassistant?: { token?: string };
  /** API key of a weather source that needs one (Pirate Weather) */
  weather?: { apiKey?: string };
  google?: { accounts: Record<string, unknown> };
  apiTokens?: unknown[];
}

export interface ExportBundle {
  format: 'marco-backup';
  formatVersion: 1;
  exportedAt: string;
  appVersion: string;
  config: StoredConfig;
  secrets?: ExportSecrets;
}

export interface ImportPreview {
  ok: boolean;
  errors: ValidationError[];
  fromVersion: number; // config version found (1 or 2)
  appVersion: string | null;
  exportedAt: string | null;
  hasSecrets: boolean;
  /** what importing the secrets would change in display access (null: the bundle has no links / devices) */
  secretsImpact?: { linksChanged: string[]; devicesRemoved: string[]; devicesAdded: number } | null;
  /** current display access mode: imports and restores always keep it */
  displayAccess?: 'private' | 'open';
  sections: { key: string; changed: boolean; summary: string }[];
  screens: { added: string[]; removed: string[]; changed: string[] };
  sources: { added: string[]; removed: string[]; changed: string[] };
  /** enabled scheduled messages that a partial import would leave without target screens (they get disabled) */
  orphanSchedules: { screensOnly: string[]; schedulesOnly: string[] };
  counts: { localEvents: number; birthdays: number; eventRules: number; countdowns: number; schedules: number };
  /** Marco Cloud: settings this server does not offer, left out of the import (absent on self-hosted servers). */
  notes?: ImportNote[];
  /** Marco Cloud: sections that go over a plan limit; importing one of them is refused (400 limit_exceeded). */
  overLimit?: { section: string; path: string; max: number }[];
}

/**
 * Something an import leaves out on this server, and why:
 *   secrets            the file has secrets (they are not imported here)
 *   homeassistant      Home Assistant (and its weather) cannot be reached
 *   signIn             admin password and Google sign-in (the account signs in instead)
 *   openDisplayAccess  open display access (screens use private links and pairing)
 *   insecureTls        calendars imported with certificate checks on (items)
 *   google             Google calendars of accounts not connected here (items)
 *   microsoft          Microsoft calendars of accounts not connected here, or on a server without them (items)
 *   blockedUrl         calendars and feeds on an address this server cannot fetch (items)
 *   refreshMin         calendars refreshed every 30 minutes at most (items)
 *   news               news feeds, while this server offers no news
 *   photos             screens show the gallery: photos are not in the file
 */
export interface ImportNote {
  code: 'secrets' | 'homeassistant' | 'signIn' | 'openDisplayAccess' | 'insecureTls' | 'google' | 'microsoft' | 'blockedUrl' | 'refreshMin' | 'news' | 'photos';
  items?: string[];
}

export interface ImportApplyRequest {
  bundle: unknown;
  includeSecrets: boolean;
  /** top-level config keys to take from the bundle; omitted = all */
  sections?: string[];
}

export type ActivityType =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.password_changed'
  | 'auth.setup_completed'
  | 'auth.setup_rejected'
  | 'google.connected'
  | 'google.removed'
  | 'microsoft.connected'
  | 'microsoft.removed'
  | 'config.saved'
  | 'config.restored'
  | 'config.imported'
  | 'config.exported'
  | 'config.migrated'
  | 'backup.created'
  | 'backup.deleted'
  | 'source.error'
  | 'source.recovered'
  | 'announce.sent'
  | 'announce.cleared'
  | 'token.created'
  | 'token.revoked'
  | 'token.used'
  | 'token.rejected'
  | 'display.connected'
  | 'display.command'
  | 'privacy.changed'
  | 'display.link_regenerated'
  | 'display.paired'
  | 'display.pair_failed'
  | 'display.device_updated'
  | 'display.device_revoked'
  | 'display.doorbell'
  | 'activity.cleared'
  | 'update.requested'
  | 'update.finished'
  | 'update.failed'
  | 'update.settings';

export interface ActivityEntry {
  id: string; // sortable (time-based)
  ts: string;
  type: ActivityType;
  level: 'info' | 'warn' | 'error';
  actor: string; // email | "password" | "token:<name>" | "system" | "anonymous"
  ip: string | null;
  data?: Record<string, unknown>;
}

export interface ActivityResponse {
  items: ActivityEntry[]; // newest first
  hasMore: boolean;
}

// ---- §7 dashboard ----

export interface DashboardResponse {
  version: string;
  /** seconds; null where there is no long-running process (Marco Cloud) */
  uptime: number | null;
  revision: number;
  screens: { id: string; slug: string; name: string; isDefault: boolean; displaysOnline: number }[];
  displays: DisplayInfo[];
  nextEvents: CalEvent[];
  sources: SourceStatus[];
  /** `source` since 0.5 (Marco Cloud copies the dashboard shape, so it may be missing) */
  weather: (WeatherCurrent & { locationName: string; updatedAt: string; min: number; max: number; source?: WeatherSource }) | null;
  announcements: Announcement[];
  schedulesNow: { id: string; title: string; emoji: string; screenIds: string[]; until: string }[];
  activity: ActivityEntry[];
  /** codes: default_password | source_errors | no_displays | outdated_displays | google_auth_failed | microsoft_auth_failed */
  warnings: string[];
}
