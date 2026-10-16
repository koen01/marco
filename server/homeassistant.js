// Home Assistant REST and WebSocket API (long-lived token stored in secrets.json). The token is only ever sent to
// the saved Home Assistant URL (or to a new URL typed together with a new token, for "Probar conexión"), and never
// across a redirect: every call passes redirect 'error' (a Home Assistant behind a redirect needs its final URL).
import { request } from './lib/http.js';
import { getConfig, getSecrets } from './store.js';
import { openHaSocket } from './haWs.js';
import { ENTITY_RE, fromRestState, parseHistory, parseStatistics, pickAttrs } from './core/haCore.js';

export const norm = (u) => String(u || '').trim().replace(/\/+$/, '');

/**
 * The URL and token to use. `override` (Probar conexión): a URL and token typed in the admin. The stored token goes
 * only to the saved URL: a new URL without a new token gets no token at all, so a request can never send it
 * somewhere else.
 */
export function haSettings(override = {}) {
  const cfg = getConfig().homeassistant;
  const saved = norm(cfg.url);
  const url = norm(override.url || cfg.url);
  return {
    url,
    token: override.token || (url === saved && !tokenForOtherUrl() ? storedToken() : ''),
    enabled: cfg.enabled,
  };
}

const storedToken = () => getSecrets().homeassistant?.token || '';

/**
 * The stored token was saved for another Home Assistant URL than the saved one (secrets.homeassistant.url, set when
 * the token is saved and kept when the URL changes): it is not used until the token is saved again for this URL, so
 * a URL changed in the admin or brought in by an imported file never receives it.
 */
export function tokenForOtherUrl() {
  const sec = getSecrets().homeassistant ?? {};
  if (!sec.token || typeof sec.url !== 'string') return false;
  return norm(sec.url) !== norm(getConfig().homeassistant.url);
}

async function haFetch(path, { url, token }, { method = 'GET', body, timeout = 10_000 } = {}) {
  if (!url) throw new Error('Home Assistant URL not configured');
  if (!token) throw new Error('Home Assistant token not configured');
  const res = await request(`${url}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    timeout,
    throwOnError: false,
    redirect: 'error',
  });
  if (res.status === 401) throw Object.assign(new Error('Unauthorized (check token)'), { status: 401 });
  if (res.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.text ? JSON.parse(res.text) : null;
}

const haGet = (path, s, opts) => haFetch(path, s, opts);

/** POST to Home Assistant (service calls): no redirects, 6 s. */
export function haPost(path, body, s = haSettings()) {
  return haFetch(path, s, { method: 'POST', body, timeout: 6000 });
}

export async function testConnection(override = {}) {
  // a URL that is not the saved one never gets the stored token: it has to come with its own
  if (override.url && norm(override.url) !== norm(getConfig().homeassistant.url) && !override.token) {
    return { ok: false, error: 'new_url_needs_token' };
  }
  if (!override.token && tokenForOtherUrl()) return { ok: false, error: 'token_other_url' };
  try {
    const s = haSettings(override);
    const ping = await haGet('/api/', s);
    let version;
    try { version = (await haGet('/api/config', s)).version; } catch { /* optional */ }
    return { ok: true, version, message: ping?.message };
  } catch (err) {
    return { ok: false, error: err.redirect ? 'redirect_refused' : err.message };
  }
}

export async function getState(entityId) {
  return haGet(`/api/states/${encodeURIComponent(entityId)}`, haSettings());
}

// ---- WebSocket commands ------------------------------------------------------------------------------------------

/** Where WebSocket commands go when the mirror (haLive.js) is connected: set by haLive. */
let liveCommand = null;
export function setLiveCommand(fn) { liveCommand = fn; }

/** One WebSocket command: over the mirror's connection when it is up, else a short connection of its own. */
export async function wsCommand(msg, { timeout = 15_000 } = {}) {
  if (liveCommand) {
    const r = await liveCommand(msg, timeout);
    if (r !== undefined) return r.value;
  }
  const s = haSettings();
  if (!s.enabled || !s.url || !s.token) throw new Error('Home Assistant is not set up');
  const sock = await openHaSocket({ url: s.url, token: s.token, timeout });
  try {
    return await sock.call(msg, timeout);
  } finally {
    sock.close();
  }
}

// ---- entities for the builder -------------------------------------------------------------------------------------

const ENTITY_TTL = 30_000;
const REGISTRY_TTL = 5 * 60_000;
let statesCache = null; // { at, list, promise }
let registryCache = null; // { at, value }

async function allStates() {
  const now = Date.now();
  if (statesCache?.list && now - statesCache.at < ENTITY_TTL) return statesCache.list;
  if (statesCache?.promise) return statesCache.promise;
  const promise = haGet('/api/states', haSettings(), { timeout: 15_000 }).then((list) => {
    statesCache = { at: Date.now(), list: Array.isArray(list) ? list : [] };
    return statesCache.list;
  }, (err) => {
    statesCache = null;
    throw err;
  });
  statesCache = { ...(statesCache || {}), promise };
  return promise;
}

/**
 * Areas of the entities (config/area_registry, entity_registry and device_registry over the WebSocket). Those need
 * an admin user in Home Assistant: with another token they fail, and the picker groups by domain instead.
 * Returns Map entity → area name, or null.
 */
export async function registry() {
  const now = Date.now();
  if (registryCache && now - registryCache.at < REGISTRY_TTL) return registryCache.value;
  let value = null;
  try {
    const [areas, entities, devices] = await Promise.all([
      wsCommand({ type: 'config/area_registry/list' }),
      wsCommand({ type: 'config/entity_registry/list' }),
      wsCommand({ type: 'config/device_registry/list' }).catch(() => []),
    ]);
    const areaName = new Map((Array.isArray(areas) ? areas : []).map((a) => [a.area_id, String(a.name || a.area_id)]));
    const devArea = new Map((Array.isArray(devices) ? devices : []).map((d) => [d.id, d.area_id]));
    value = new Map();
    for (const e of Array.isArray(entities) ? entities : []) {
      const id = e.area_id || devArea.get(e.device_id);
      if (id && areaName.has(id)) value.set(e.entity_id, areaName.get(id));
    }
  } catch {
    value = null;
  }
  registryCache = { at: now, value };
  return value;
}

/**
 * Entities of the given domains (a string or a list; empty = all) with what the builder needs: name, state, unit,
 * domain, device_class, supported_features, area, icon and the builder attributes. Cached for 30 s.
 */
export async function listEntities(domains = []) {
  const want = (Array.isArray(domains) ? domains : [domains]).filter(Boolean);
  const [states, areas] = await Promise.all([allStates(), registry().catch(() => null)]);
  return states
    .filter((s) => typeof s?.entity_id === 'string' && ENTITY_RE.test(s.entity_id))
    .filter((s) => !want.length || want.includes(s.entity_id.split('.')[0]))
    .map((s) => {
      const a = s.attributes || {};
      const attrs = pickAttrs(a);
      for (const k of ['friendly_name', 'unit_of_measurement', 'device_class', 'supported_features', 'icon', 'entity_picture']) delete attrs[k];
      return {
        entity_id: s.entity_id,
        name: a.friendly_name || s.entity_id,
        state: s.state,
        unit: a.unit_of_measurement || '',
        domain: s.entity_id.split('.')[0],
        device_class: typeof a.device_class === 'string' ? a.device_class : null,
        supported_features: Number.isFinite(a.supported_features) ? a.supported_features : 0,
        area: areas?.get(s.entity_id) ?? null,
        icon: typeof a.icon === 'string' ? a.icon : null,
        attrs,
      };
    })
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

/** Forget the cached entity list and areas (a new token or URL). */
export function invalidateEntityCache() {
  statesCache = null;
  registryCache = null;
}

/** The mirrored-shape state of one entity, fetched over REST (the mirror's fallback, the builder's preview). */
export async function fetchSlimState(entityId, s = haSettings()) {
  return fromRestState(await haGet(`/api/states/${encodeURIComponent(entityId)}`, s));
}

// ---- charts -------------------------------------------------------------------------------------------------------

/**
 * Numeric history of `entityIds` between `start` and `end` (ms): /api/history/period with minimal_response,
 * no_attributes and significant_changes_only. Map entity → [[ms, value]].
 */
export async function history(entityIds, start, end) {
  const q = new URLSearchParams({ filter_entity_id: entityIds.join(','), end_time: new Date(end).toISOString() });
  const path = `/api/history/period/${encodeURIComponent(new Date(start).toISOString())}?${q}&minimal_response&no_attributes&significant_changes_only`;
  return parseHistory(await haGet(path, haSettings(), { timeout: 15_000 }));
}

/** Hourly means of `entityIds` (recorder/statistics_during_period, for periods over 24 h). Map entity → points. */
export async function statistics(entityIds, start, end) {
  const result = await wsCommand({
    type: 'recorder/statistics_during_period',
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    statistic_ids: entityIds,
    period: 'hour',
    types: ['mean', 'state'],
  });
  return parseStatistics(result);
}

/** The calendar period Home Assistant's recorder takes for a Estadística card's period. */
const STAT_CALENDAR = { today: 'day', week: 'week', month: 'month' };

/**
 * One value of a statistic over today, this week or this month (recorder/statistic_during_period, the command Home
 * Assistant's own statistic card uses; over the mirror's connection when it is up): `stat` is change, mean, min or
 * max. A number, or null when the recorder has none. Throws when Home Assistant cannot be asked.
 */
export async function statisticValue(entityId, stat, period) {
  const result = await wsCommand({
    type: 'recorder/statistic_during_period',
    statistic_id: entityId,
    calendar: { period: STAT_CALENDAR[period] ?? 'day' },
    types: [stat],
  });
  const v = result && typeof result === 'object' ? result[stat] : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function haUsable() {
  const s = haSettings();
  return Boolean(s.enabled && s.url && s.token);
}
