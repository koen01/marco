// Server-side strings (weather descriptions, Airbnb titles, wind labels). Default language: en.
// Dutch (nl) covers the display and this file; the admin panel has no Dutch yet.
export const LANGS = ['es', 'en', 'pt', 'nl'];
export const lang = (l) => (LANGS.includes(l) ? l : 'en');

// WMO weather interpretation codes (Open-Meteo; 68 and 69 for the other providers' sleet).
const WMO = {
  0: ['Despejado', 'Clear sky', 'Céu limpo', 'Onbewolkt'],
  1: ['Mayormente despejado', 'Mainly clear', 'Céu pouco nublado', 'Overwegend helder'],
  2: ['Parcialmente nublado', 'Partly cloudy', 'Parcialmente nublado', 'Half bewolkt'],
  3: ['Nublado', 'Overcast', 'Encoberto', 'Bewolkt'],
  45: ['Niebla', 'Fog', 'Nevoeiro', 'Mist'],
  48: ['Niebla con escarcha', 'Depositing rime fog', 'Nevoeiro com geada', 'Aanvriezende mist'],
  51: ['Llovizna ligera', 'Light drizzle', 'Chuvisco fraco', 'Lichte motregen'],
  53: ['Llovizna', 'Drizzle', 'Chuvisco', 'Motregen'],
  55: ['Llovizna intensa', 'Dense drizzle', 'Chuvisco forte', 'Dichte motregen'],
  56: ['Llovizna helada', 'Freezing drizzle', 'Chuvisco gelado', 'Aanvriezende motregen'],
  57: ['Llovizna helada intensa', 'Dense freezing drizzle', 'Chuvisco gelado forte', 'Dichte aanvriezende motregen'],
  61: ['Lluvia ligera', 'Light rain', 'Chuva fraca', 'Lichte regen'],
  63: ['Lluvia', 'Rain', 'Chuva', 'Regen'],
  65: ['Lluvia intensa', 'Heavy rain', 'Chuva forte', 'Zware regen'],
  66: ['Lluvia helada', 'Freezing rain', 'Chuva gelada', 'IJzel'],
  67: ['Lluvia helada intensa', 'Heavy freezing rain', 'Chuva gelada forte', 'Zware ijzel'],
  // 68, 69: rain and snow mixed (WMO 4677); MET Norway and Pirate Weather "sleet"
  68: ['Aguanieve', 'Sleet', 'Água-neve', 'Natte sneeuw'],
  69: ['Aguanieve intensa', 'Heavy sleet', 'Água-neve forte', 'Zware natte sneeuw'],
  71: ['Nevada ligera', 'Light snow', 'Neve fraca', 'Lichte sneeuw'],
  73: ['Nevada', 'Snow', 'Neve', 'Sneeuw'],
  75: ['Nevada intensa', 'Heavy snow', 'Neve forte', 'Zware sneeuw'],
  77: ['Granizo fino', 'Snow grains', 'Grãos de neve', 'Motsneeuw'],
  80: ['Chubascos ligeros', 'Light showers', 'Aguaceiros fracos', 'Lichte buien'],
  81: ['Chubascos', 'Showers', 'Aguaceiros', 'Buien'],
  82: ['Chubascos fuertes', 'Violent showers', 'Aguaceiros fortes', 'Zware buien'],
  85: ['Chubascos de nieve', 'Snow showers', 'Aguaceiros de neve', 'Sneeuwbuien'],
  86: ['Chubascos de nieve fuertes', 'Heavy snow showers', 'Aguaceiros de neve fortes', 'Zware sneeuwbuien'],
  95: ['Tormenta', 'Thunderstorm', 'Trovoada', 'Onweer'],
  96: ['Tormenta con granizo', 'Thunderstorm with hail', 'Trovoada com granizo', 'Onweer met hagel'],
  99: ['Tormenta con granizo fuerte', 'Thunderstorm with heavy hail', 'Trovoada com granizo forte', 'Onweer met zware hagel'],
};

export function wmoDescription(code, l) {
  const row = WMO[code];
  if (!row) return '';
  return row[LANGS.indexOf(lang(l))];
}

const DIRS = {
  es: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  pt: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  nl: ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'],
};

export function windDirLabel(deg, l) {
  if (deg == null || Number.isNaN(+deg)) return '';
  const i = Math.round((((+deg % 360) + 360) % 360) / 45) % 8;
  return DIRS[lang(l)][i];
}

const STRINGS = {
  reservation: { es: 'Reserva', en: 'Reservation', pt: 'Reserva', nl: 'Reservering' },
  busy: { es: 'Ocupado', en: 'Busy', pt: 'Ocupado', nl: 'Bezet' },
  blocked: { es: 'No disponible', en: 'Not available', pt: 'Indisponível', nl: 'Niet beschikbaar' },
  untitled: { es: '(Sin título)', en: '(No title)', pt: '(Sem título)', nl: '(Geen titel)' },
};

export function t(key, l) {
  return STRINGS[key]?.[lang(l)] ?? key;
}

/** First supported language of an Accept-Language header (default en). */
export function langFromHeader(header) {
  for (const part of String(header || '').split(',')) {
    const base = part.trim().slice(0, 2).toLowerCase();
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

/** Language of an admin request: explicit ?lang= / body.lang, else Accept-Language. */
export const requestLang = (req) => {
  const explicit = req?.query?.lang ?? req?.body?.lang;
  return LANGS.includes(explicit) ? explicit : langFromHeader(req?.get?.('accept-language'));
};

// Import-preview summaries (server/core/backupsCore.js). Nouns: [one, many, grammatical gender ('f'|'m')].
const NOUNS = {
  screen: { es: ['pantalla', 'pantallas', 'f'], en: ['screen', 'screens'], pt: ['ecrã', 'ecrãs', 'm'], nl: ['scherm', 'schermen'] },
  source: { es: ['fuente', 'fuentes', 'f'], en: ['source', 'sources'], pt: ['fonte', 'fontes', 'f'], nl: ['bron', 'bronnen'] },
  feed: { es: ['feed', 'feeds', 'm'], en: ['feed', 'feeds'], pt: ['feed', 'feeds', 'm'], nl: ['feed', 'feeds'] },
  item: { es: ['elemento', 'elementos', 'm'], en: ['item', 'items'], pt: ['elemento', 'elementos', 'm'], nl: ['item', 'items'] },
  iconRule: { es: ['regla de iconos', 'reglas de iconos', 'f'], en: ['icon rule', 'icon rules'], pt: ['regra de ícones', 'regras de ícones', 'f'], nl: ['pictogramregel', 'pictogramregels'] },
};
const SUMMARY = {
  modified: { es: 'modificado', en: 'modified', pt: 'modificado', nl: 'gewijzigd' },
  unchanged: { es: 'sin cambios', en: 'unchanged', pt: 'sem alterações', nl: 'ongewijzigd' },
  settingsModified: { es: 'ajustes modificados', en: 'settings modified', pt: 'definições modificadas', nl: 'instellingen gewijzigd' },
};

/** "3 pantallas" / "1 screen" */
export function countNoun(n, noun, l) {
  const [one, many] = NOUNS[noun][lang(l)];
  return `${n} ${n === 1 ? one : many}`;
}

/** "1 modificada" / "2 modified" / "2 modificados" (agrees with the noun's gender in es/pt; Dutch has one form). */
export function countChanged(n, noun, l) {
  const L = lang(l);
  if (L === 'en') return `${n} modified`;
  if (L === 'nl') return `${n} gewijzigd`;
  const g = NOUNS[noun][L][2] === 'f' ? 'a' : 'o';
  return `${n} modificad${g}${n === 1 ? '' : 's'}`;
}

export const summaryWord = (key, l) => SUMMARY[key][lang(l)];
