// i18n + date helpers shared by the display and the admin panel (es default, en, pt, nl).
import type { DateFormat, Lang } from './types';

export const LANGS: Lang[] = ['es', 'en', 'pt', 'nl'];
export const LOCALES: Record<Lang, string> = { es: 'es-ES', en: 'en-GB', pt: 'pt-PT', nl: 'nl-NL' };

type Dict = Record<string, string>;

const es: Dict = {
  // layouts with their own view (web/display/widgets/views.ts)
  upNext: 'A continuación',
  nothingMoreToday: 'Nada más por hoy',
  firstTomorrow: 'Mañana',
  everyone: 'Todos',
  birthdays: 'Cumpleaños',
  agenda: 'Agenda',
  allDone: 'Todo hecho',
  noPeople: 'Elige los calendarios de cada persona en Diseño',
  nothingPlanned: 'Nada previsto',
  daysWord: 'días',
  today: 'Hoy',
  tomorrow: 'Mañana',
  yesterday: 'Ayer',
  now: 'Ahora',
  allDay: 'Todo el día',
  more: '+{n} más',
  dayXofY: 'Día {x} de {y}',
  checkIn: 'Entrada',
  checkOut: 'Salida',
  privateMode: 'Modo privado',
  inMinutes: 'En {n} min',
  inHours: 'En {n} h',
  inHoursMinutes: 'En {h} h {m} min',
  inDays: 'En {n} días',
  happeningNow: 'Ahora',
  untilTime: 'hasta las {t}',
  next: 'Próximo',
  noEvents: 'Sin eventos',
  noUpcoming: 'Nada en la agenda',
  feelsLike: 'Sensación',
  hiShort: 'Máx.',
  loShort: 'Mín.',
  humidity: 'Humedad',
  wind: 'Viento',
  sunrise: 'Amanecer',
  sunset: 'Atardecer',
  precip: 'Lluvia',
  indoor: 'Casa',
  uv: 'UV',
  pressure: 'Presión',
  news: 'Noticias',
  todo: 'Tareas',
  offline: 'Sin conexión',
  photoBy: 'Foto: {a}',
  week: 'Semana',
  todayEvents: 'Hoy',
  upcoming: 'Próximos días',
  loading: 'Cargando…',
  countdowns: 'Cuentas atrás',
  cdDays: 'Faltan {n} días',
  cdTomorrow: '¡Mañana!',
  cdToday: '¡Hoy!',
  screenNotFound: 'Pantalla «{s}» no encontrada',
  identifyScreen: 'Pantalla',
  identifyDevice: 'Dispositivo',
  doorbell: 'Puerta',
  doorbellRinging: 'Llaman a la puerta',
  doorbellNoPicture: 'Cámara no disponible',
  until: 'hasta las {t}',
  nightOn: 'Modo noche',
};

const en: Dict = {
  // layouts with their own view (web/display/widgets/views.ts)
  upNext: 'Up next',
  nothingMoreToday: 'Nothing else today',
  firstTomorrow: 'Tomorrow',
  everyone: 'Everyone',
  birthdays: 'Birthdays',
  agenda: 'Agenda',
  allDone: 'All done',
  noPeople: 'Choose each person’s calendars in Layout',
  nothingPlanned: 'Nothing planned',
  daysWord: 'days',
  today: 'Today',
  tomorrow: 'Tomorrow',
  yesterday: 'Yesterday',
  now: 'Now',
  allDay: 'All day',
  more: '+{n} more',
  dayXofY: 'Day {x} of {y}',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  privateMode: 'Private mode',
  inMinutes: 'In {n} min',
  inHours: 'In {n} h',
  inHoursMinutes: 'In {h} h {m} min',
  inDays: 'In {n} days',
  happeningNow: 'Now',
  untilTime: 'until {t}',
  next: 'Next',
  noEvents: 'No events',
  noUpcoming: 'Nothing scheduled',
  feelsLike: 'Feels like',
  hiShort: 'H',
  loShort: 'L',
  humidity: 'Humidity',
  wind: 'Wind',
  sunrise: 'Sunrise',
  sunset: 'Sunset',
  precip: 'Rain',
  indoor: 'Home',
  uv: 'UV',
  pressure: 'Pressure',
  news: 'News',
  todo: 'To-do',
  offline: 'Offline',
  photoBy: 'Photo: {a}',
  week: 'Week',
  todayEvents: 'Today',
  upcoming: 'Coming up',
  loading: 'Loading…',
  countdowns: 'Countdowns',
  cdDays: 'In {n} days',
  cdTomorrow: 'Tomorrow!',
  cdToday: 'Today!',
  screenNotFound: 'Screen “{s}” not found',
  identifyScreen: 'Screen',
  identifyDevice: 'Device',
  doorbell: 'Door',
  doorbellRinging: 'Someone is at the door',
  doorbellNoPicture: 'Camera unavailable',
  until: 'until {t}',
  nightOn: 'Night mode',
};

const pt: Dict = {
  // layouts with their own view (web/display/widgets/views.ts)
  upNext: 'A seguir',
  nothingMoreToday: 'Mais nada hoje',
  firstTomorrow: 'Amanhã',
  everyone: 'Todos',
  birthdays: 'Aniversários',
  agenda: 'Agenda',
  allDone: 'Tudo feito',
  noPeople: 'Escolha os calendários de cada pessoa em Disposição',
  nothingPlanned: 'Nada previsto',
  daysWord: 'dias',
  today: 'Hoje',
  tomorrow: 'Amanhã',
  yesterday: 'Ontem',
  now: 'Agora',
  allDay: 'Todo o dia',
  more: '+{n} mais',
  dayXofY: 'Dia {x} de {y}',
  checkIn: 'Entrada',
  checkOut: 'Saída',
  privateMode: 'Modo privado',
  inMinutes: 'Daqui a {n} min',
  inHours: 'Daqui a {n} h',
  inHoursMinutes: 'Daqui a {h} h {m} min',
  inDays: 'Daqui a {n} dias',
  happeningNow: 'Agora',
  untilTime: 'até às {t}',
  next: 'Próximo',
  noEvents: 'Sem eventos',
  noUpcoming: 'Nada agendado',
  feelsLike: 'Sensação',
  hiShort: 'Máx.',
  loShort: 'Mín.',
  humidity: 'Humidade',
  wind: 'Vento',
  sunrise: 'Nascer do sol',
  sunset: 'Pôr do sol',
  precip: 'Chuva',
  indoor: 'Casa',
  uv: 'UV',
  pressure: 'Pressão',
  news: 'Notícias',
  todo: 'Tarefas',
  offline: 'Sem ligação',
  photoBy: 'Foto: {a}',
  week: 'Semana',
  todayEvents: 'Hoje',
  upcoming: 'Próximos dias',
  loading: 'A carregar…',
  countdowns: 'Contagens',
  cdDays: 'Faltam {n} dias',
  cdTomorrow: 'Amanhã!',
  cdToday: 'Hoje!',
  screenNotFound: 'Ecrã «{s}» não encontrado',
  identifyScreen: 'Ecrã',
  identifyDevice: 'Dispositivo',
  doorbell: 'Porta',
  doorbellRinging: 'Está alguém à porta',
  doorbellNoPicture: 'Câmara indisponível',
  until: 'até às {t}',
  nightOn: 'Modo noite',
};

const nl: Dict = {
  // layouts with their own view (web/display/widgets/views.ts)
  upNext: 'Hierna',
  nothingMoreToday: 'Verder niets vandaag',
  firstTomorrow: 'Morgen',
  everyone: 'Iedereen',
  birthdays: 'Verjaardagen',
  agenda: 'Agenda',
  allDone: 'Alles gedaan',
  noPeople: 'Kies bij Layout de agenda’s van elke persoon',
  nothingPlanned: 'Niets gepland',
  daysWord: 'dagen',
  today: 'Vandaag',
  tomorrow: 'Morgen',
  yesterday: 'Gisteren',
  now: 'Nu',
  allDay: 'Hele dag',
  more: '+{n} meer',
  dayXofY: 'Dag {x} van {y}',
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  privateMode: 'Privémodus',
  inMinutes: 'Over {n} min',
  inHours: 'Over {n} uur',
  inHoursMinutes: 'Over {h} uur {m} min',
  inDays: 'Over {n} dagen',
  happeningNow: 'Nu',
  untilTime: 'tot {t}',
  next: 'Volgende',
  noEvents: 'Geen afspraken',
  noUpcoming: 'Niets gepland',
  feelsLike: 'Voelt als',
  hiShort: 'Max.',
  loShort: 'Min.',
  humidity: 'Luchtvochtigheid',
  wind: 'Wind',
  sunrise: 'Zonsopkomst',
  sunset: 'Zonsondergang',
  precip: 'Regen',
  indoor: 'Thuis',
  uv: 'UV',
  pressure: 'Luchtdruk',
  news: 'Nieuws',
  todo: 'Taken',
  offline: 'Offline',
  photoBy: 'Foto: {a}',
  week: 'Week',
  todayEvents: 'Vandaag',
  upcoming: 'Komende dagen',
  loading: 'Laden…',
  countdowns: 'Aftellen',
  cdDays: 'Nog {n} dagen',
  cdTomorrow: 'Morgen!',
  cdToday: 'Vandaag!',
  screenNotFound: 'Scherm “{s}” niet gevonden',
  identifyScreen: 'Scherm',
  identifyDevice: 'Apparaat',
  doorbell: 'Deur',
  doorbellRinging: 'Er staat iemand voor de deur',
  doorbellNoPicture: 'Camera niet beschikbaar',
  until: 'tot {t}',
  nightOn: 'Nachtmodus',
};

export const DICTS: Record<Lang, Dict> = { es, en, pt, nl };

export function normLang(l: string | undefined | null): Lang {
  return l === 'es' || l === 'pt' || l === 'nl' ? l : 'en';
}

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang]?.[key] ?? DICTS.es[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export function makeT(lang: Lang) {
  return (key: string, vars?: Record<string, string | number>) => t(lang, key, vars);
}

// ---------------------------------------------------------------------------
// Date helpers. "Date keys" are calendar dates as "YYYY-MM-DD" strings, independent
// of the browser's own timezone. All arithmetic on keys is done in UTC.
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23', weekday: 'short',
      });
    } catch {
      f = new Intl.DateTimeFormat('en-US', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23', weekday: 'short',
      });
    }
    partsCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
  /** 0 = Sunday */ weekday: number;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of a Date in a timezone. */
export function zonedParts(d: Date, tz: string): ZonedParts {
  const p: Record<string, string> = {};
  for (const x of partsFmt(tz).formatToParts(d)) p[x.type] = x.value;
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour: +p.hour % 24, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday] ?? 0,
  };
}

export const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

export function keyOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Calendar date key (YYYY-MM-DD) of an instant in a timezone. */
export function dateKeyInTz(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return keyOf(p.year, p.month, p.day);
}

export function keyToUTC(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function utcToKey(d: Date): string {
  return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(key: string, n: number): string {
  const d = keyToUTC(key);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToKey(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((keyToUTC(b).getTime() - keyToUTC(a).getTime()) / 86400000);
}

/** 0 = Sunday */
export function weekdayOfKey(key: string): number {
  return keyToUTC(key).getUTCDay();
}

/** Start of the week containing `key`. weekStart 1 = Monday. */
export function startOfWeek(key: string, weekStart = 1): string {
  const wd = weekdayOfKey(key);
  const delta = (wd - weekStart + 7) % 7;
  return addDays(key, -delta);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(lang: Lang, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = lang + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALES[lang], opts);
    fmtCache.set(k, f);
  }
  return f;
}

/** Weekday name for a date key. style: 'long' | 'short' | 'narrow'. */
export function weekdayName(lang: Lang, key: string, style: 'long' | 'short' | 'narrow' = 'short'): string {
  let s = fmt(lang, { weekday: style, timeZone: 'UTC' }).format(keyToUTC(key));
  s = s.replace(/\.$/, '');
  // some locales (pt-PT) return full names for "short" ("segunda"); keep labels compact
  if (style === 'short' && s.length > 4) s = s.replace(/-feira$/, '').slice(0, 3);
  return capitalize(s);
}

/**
 * First weekday column of the calendar grid: the configured one, or today's weekday when the grid starts on today
 * (calendar.startToday), which makes startOfWeek(today, …) today itself.
 */
export function gridWeekStart(today: string, weekStart = 1, startToday = false): number {
  return startToday ? weekdayOfKey(today) : weekStart;
}

/** Weekday names ordered from weekStart (0=Sunday). */
export function weekdayNames(lang: Lang, weekStart = 1, style: 'long' | 'short' | 'narrow' = 'short'): string[] {
  // 2023-01-01 was a Sunday
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(weekdayName(lang, addDays('2023-01-01', (weekStart + i) % 7), style));
  return out;
}

export function monthName(lang: Lang, month1: number, style: 'long' | 'short' = 'long'): string {
  let s = fmt(lang, { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, month1 - 1, 1)));
  s = s.replace(/\.$/, '');
  return capitalize(s);
}

/** Localized long date line, e.g. es weekday_d_month → "viernes, 9 de octubre". */
/** Tokens of the custom date pattern, longest first so {dddd} wins over {ddd} and {d}. */
export const DATE_TOKENS = ['dddd', 'ddd', 'dd', 'd', 'mmmm', 'mmm', 'mm', 'm', 'yyyy', 'yy'] as const;

/** Custom date line: {dddd} Saturday, {ddd} Sat, {d} 7, {dd} 07, {mmmm} March, {mmm} Mar, {m} 3, {mm} 03, {yyyy} 2026, {yy} 26. */
export function formatDatePattern(lang: Lang, key: string, pattern: string): string {
  const d = keyToUTC(key);
  const val: Record<string, () => string> = {
    dddd: () => capitalize(fmt(lang, { weekday: 'long', timeZone: 'UTC' }).format(d)),
    ddd: () => capitalize(fmt(lang, { weekday: 'short', timeZone: 'UTC' }).format(d).replace(/\.$/, '')),
    d: () => String(d.getUTCDate()),
    dd: () => key.slice(8, 10),
    mmmm: () => { const m = fmt(lang, { month: 'long', timeZone: 'UTC' }).format(d); return lang === 'en' ? capitalize(m) : m; },
    mmm: () => { const m = fmt(lang, { month: 'short', timeZone: 'UTC' }).format(d).replace(/\.$/, ''); return lang === 'en' ? capitalize(m) : m; },
    m: () => String(d.getUTCMonth() + 1),
    mm: () => key.slice(5, 7),
    yyyy: () => key.slice(0, 4),
    yy: () => key.slice(2, 4),
  };
  return pattern.replace(/\{(dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy)\}/gi, (_, t: string) => val[t.toLowerCase()]());
}

export function formatDateLine(lang: Lang, key: string, format: DateFormat = 'weekday_d_month', custom = ''): string {
  if (format === 'custom' && custom.trim()) return formatDatePattern(lang, key, custom.trim());
  const d = keyToUTC(key);
  const wd = fmt(lang, { weekday: 'long', timeZone: 'UTC' }).format(d);
  const mo = fmt(lang, { month: 'long', timeZone: 'UTC' }).format(d);
  const day = d.getUTCDate();
  const W = capitalize(wd);
  switch (format) {
    case 'weekday_month_d':
      return lang === 'en' ? `${W}, ${capitalize(mo)} ${day}` : `${W}, ${mo} ${day}`;
    case 'weekday_d_dot_month':
      return `${W} ${day}. ${lang === 'en' ? capitalize(mo) : mo}`;
    case 'weekday_month_d_y':
      return `${W}, ${lang === 'en' ? capitalize(mo) : mo} ${day}, ${d.getUTCFullYear()}`;
    case 'weekday_mdy':
      return `${W}, ${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(0, 4)}`;
    case 'weekday_dmy':
      return `${W}, ${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
    case 'weekday_iso':
      return `${W}, ${key.slice(0, 10)}`;
    case 'weekday_d_month':
    default:
      if (lang === 'en') return `${W}, ${day} ${capitalize(mo)}`;
      if (lang === 'nl') return `${W} ${day} ${mo}`;
      return `${W}, ${day} de ${mo}`;
  }
}

/** Short day label e.g. "Hoy", "Mañana", "Sáb 11". */
export function relativeDayLabel(lang: Lang, key: string, todayKey: string, withNumber = true): string {
  const dd = diffDays(todayKey, key);
  if (dd === 0) return t(lang, 'today');
  if (dd === 1) return t(lang, 'tomorrow');
  if (dd === -1) return t(lang, 'yesterday');
  const wd = weekdayName(lang, key, 'short');
  return withNumber ? `${wd} ${keyToUTC(key).getUTCDate()}` : wd;
}

/** Format HH:MM in a timezone. */
export function formatTime(d: Date, tz: string, format24 = true, showAmPm = false): string {
  const p = zonedParts(d, tz);
  return formatHM(p.hour, p.minute, format24, showAmPm);
}

export function formatHM(h: number, m: number, format24 = true, showAmPm = false): string {
  if (format24) return `${pad2(h)}:${pad2(m)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)}${showAmPm ? (h < 12 ? ' AM' : ' PM') : ''}`;
}

/** "En 2 h", "En 25 min", "En 3 días". */
export function formatCountdown(lang: Lang, ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return t(lang, 'now');
  if (min < 60) return t(lang, 'inMinutes', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m >= 5 && h < 3 ? t(lang, 'inHoursMinutes', { h, m }) : t(lang, 'inHours', { n: h + (m >= 30 ? 1 : 0) });
  const days = Math.round(h / 24);
  return days <= 1 ? t(lang, 'tomorrow') : t(lang, 'inDays', { n: days });
}
