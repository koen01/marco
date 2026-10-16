// Weather for the screens: one of the free sources in server/core/weather.js (Open-Meteo, MET Norway, Pirate Weather
// with the household's own key), plus the optional Home Assistant overlay (current conditions from a weather
// entity, indoor sensors). The provider answer is cached per place (one entry for every language) for at least the
// provider's minimum interval (MET Norway's Expires header when longer); a failed refresh keeps showing the last
// answer for up to 6 hours.
import fs from 'node:fs';
import { fetchWeather, localizeWeather, tryWeatherKey, weatherCacheKey, weatherRequest, WEATHER_STALE_MS } from './core/weather.js';
import { wmoDescription, windDirLabel } from './core/lib/i18n.js';
import { defaultScreen } from './core/screens.js';
import { getConfig, getSecrets } from './store.js';
import * as ha from './homeassistant.js';
import { mirroredState } from './haLive.js';

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0';
  }
})();
/** MET Norway asks for an identifying User-Agent with a way to reach the app. */
export const USER_AGENT = `Marco/${VERSION} (+https://github.com/mr-reb00t/marco)`;

const cache = new Map(); // weatherCacheKey → { base, fetchedAt, expiresAt, lastModified }
const inflight = new Map(); // weatherCacheKey → Promise<entry>
export const status = { ok: null, updatedAt: null, error: null, errorCode: null, provider: null };

/** Tests replace the network. */
let outbound = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
export function setWeatherFetch(f) {
  outbound = f || ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }));
  cache.clear();
}

/** The household's key for a key provider (secrets.json, never in the config). */
export const weatherKey = () => String(getSecrets()?.weather?.apiKey || '');

// HA weather condition → WMO code (approximate)
const HA_TO_WMO = {
  'clear-night': 0, sunny: 0, partlycloudy: 2, cloudy: 3, fog: 45, rainy: 63, pouring: 65, lightning: 95,
  'lightning-rainy': 95, hail: 96, snowy: 73, 'snowy-rainy': 66, windy: 3, 'windy-variant': 3, exceptional: 3,
};

const round1 = (n) => (n == null || Number.isNaN(+n) ? null : Math.round(+n * 10) / 10);
const round0 = (n) => (n == null || Number.isNaN(+n) ? null : Math.round(+n));

/** A Home Assistant state: from the live mirror when it has it (haLive.js), else one REST call. */
const haState = (id) => {
  const m = mirroredState(id);
  return m ? Promise.resolve(m) : ha.getState(id);
};

async function applyHomeAssistant(data, w, lang) {
  if (!ha.haUsable()) return data;
  const num = (s) => {
    const n = parseFloat(s?.state);
    return Number.isFinite(n) ? n : null;
  };
  const tasks = [];
  if (w.provider === 'homeassistant' && w.haWeatherEntity) {
    tasks.push(haState(w.haWeatherEntity).then((s) => {
      const a = s.attributes || {};
      const code = HA_TO_WMO[s.state];
      const cur = data.current;
      data.source = { ...data.source, also: 'Home Assistant' };
      if (a.temperature != null) cur.temp = round1(a.temperature);
      if (a.apparent_temperature != null) cur.feelsLike = round1(a.apparent_temperature);
      if (a.humidity != null) cur.humidity = round0(a.humidity);
      if (a.wind_speed != null) {
        const unit = String(a.wind_speed_unit || 'km/h').toLowerCase();
        const k = unit === 'm/s' ? 3.6 : unit === 'mph' ? 1.609 : unit === 'kn' ? 1.852 : 1;
        cur.windKmh = round0(a.wind_speed * k);
      }
      if (a.wind_bearing != null && !Number.isNaN(+a.wind_bearing)) {
        cur.windDir = round0(a.wind_bearing);
        cur.windDirLabel = windDirLabel(a.wind_bearing, lang);
      }
      if (a.pressure != null) cur.pressure = round0(a.pressure);
      if (a.uv_index != null) cur.uv = round1(a.uv_index);
      if (code !== undefined) {
        cur.code = code;
        cur.description = wmoDescription(code, lang);
        if (s.state === 'clear-night') cur.isDay = false;
      }
    }).catch((err) => console.warn('[weather] HA weather entity:', err.message)));
  }
  let indoor = null;
  if (w.haIndoorTempEntity) {
    tasks.push(haState(w.haIndoorTempEntity).then((s) => { indoor = { ...(indoor || {}), temp: round1(num(s)) }; })
      .catch((err) => console.warn('[weather] HA indoor temp:', err.message)));
  }
  if (w.haIndoorHumidityEntity) {
    tasks.push(haState(w.haIndoorHumidityEntity).then((s) => { indoor = { ...(indoor || {}), humidity: round0(num(s)) }; })
      .catch((err) => console.warn('[weather] HA indoor humidity:', err.message)));
  }
  await Promise.all(tasks);
  if (indoor) data.indoor = { temp: indoor.temp ?? null, humidity: indoor.humidity ?? null };
  return data;
}

/**
 * Tries a Pirate Weather key at the configured place (one call, kept in the cache when it works): true, false
 * (refused) or null (could not tell).
 */
export async function checkWeatherKey(key) {
  const cfg = getConfig();
  const forecastDays = Math.max(1, ...cfg.screens.map((s) => s.weather.forecastDays));
  const r = weatherRequest({ ...cfg.weather, provider: 'pirate-weather' }, { tz: cfg.datetime.timezone, forecastDays, apiKey: key });
  const { ok, entry } = await tryWeatherKey(r, { fetch: outbound, userAgent: USER_AGENT });
  if (entry) cache.set(weatherCacheKey(r), entry);
  return ok;
}

/** Provider entry for a request: cached while fresh, else fetched (one request at a time per key). */
async function entryFor(r, force) {
  const key = weatherCacheKey(r);
  const hit = cache.get(key);
  const now = Date.now();
  // `force` (admin refresh) still waits for MET Norway's Expires: its terms ask not to call before it.
  if (hit && hit.expiresAt > now && (!force || r.provider === 'met-norway')) return { e: hit, error: null };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const e = await fetchWeather(r, { fetch: outbound, userAgent: USER_AGENT, prev: hit || null });
      cache.set(key, e);
      // Entries for an older place or provider are useless now.
      for (const k of cache.keys()) if (k !== key) cache.delete(k);
      return { e, error: null };
    } catch (err) {
      if (hit && now - Date.parse(hit.fetchedAt) < WEATHER_STALE_MS) return { e: hit, error: err }; // stale on error
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export async function getWeather({ force = false, lang = null } = {}) {
  const cfg = getConfig();
  // v2: location/provider are global; forecastDays is per screen → fetch the max any screen shows.
  const forecastDays = Math.max(1, ...cfg.screens.map((s) => s.weather.forecastDays));
  const w = cfg.weather;
  lang ||= defaultScreen(cfg).screen.language;
  const r = weatherRequest(w, { tz: cfg.datetime.timezone, forecastDays, apiKey: weatherKey() });
  const fail = (err) => Object.assign(status, { ok: false, error: err.message, errorCode: err.code || 'http', provider: r.provider });
  let got;
  try {
    got = await entryFor(r, force);
  } catch (err) {
    fail(err);
    throw err;
  }
  if (got.error) fail(got.error);
  else Object.assign(status, { ok: true, updatedAt: got.e.fetchedAt, error: null, errorCode: null, provider: r.provider });
  const data = localizeWeather(got.e.base, { lang, locationName: w.locationName, forecastDays });
  return applyHomeAssistant(data, w, lang);
}

/**
 * Cached weather without fetching (dashboard): the current place's entry in `lang` (default screen language), or
 * null. May be stale.
 */
export function cachedWeather(lang = null) {
  const cfg = getConfig();
  lang ||= defaultScreen(cfg).screen.language;
  const forecastDays = Math.max(1, ...cfg.screens.map((s) => s.weather.forecastDays));
  const e = cache.get(weatherCacheKey(weatherRequest(cfg.weather, { tz: cfg.datetime.timezone, forecastDays, apiKey: weatherKey() })));
  return e ? localizeWeather(e.base, { lang, locationName: cfg.weather.locationName, forecastDays }) : null;
}
