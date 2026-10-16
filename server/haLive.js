// Live Home Assistant states for Personalizado screens: a mirror of the WATCHED SET only (the entities the saved
// screens show, plus the weather entities), never the whole house.
// - WebSocket (`subscribe_entities` with `entity_ids`): its first message is the full state of exactly those
//   entities, so there is no get_states (several MB on a large install, parsed on a Pi at every reconnect), and never
//   `subscribe_events state_changed` (the whole event firehose).
// - Reconnects with backoff from 5 s to 60 s; after 3 failures in a row, or when HA is older than 2022.4 (no
//   subscribe_entities), or Node has no global WebSocket, it polls the watched set over REST every 15 s.
// - Changes go to displays as the SSE `ha` event (publishHa): slim states keyed by alias (no entity ids), coalesced
//   per screen over 1 s, targeted at the screen (carousel-aware through sse.js). It never goes through pollHub (poll
//   displays ask GET /api/display/ha every 10 s) and never calls markFast.
// - Frames are never logged; errors go through redactSecrets (the token travels in the auth frame body).
import { openHaSocket, hasWebSocket } from './haWs.js';
import { fromRestState, pickAttrs, slim, watchedEntities, aliasesFor, snapshotStates, ENTITY_RE } from './core/haCore.js';
import { redactSecrets } from './core/activityCore.js';
import { conditionEntities } from './core/canvasCore.js';
import { conditionChanged, forgetHide, hasConditions, hiddenItems, hideChanged, onConditionChange, setConditionSource } from './canvasConditions.js';

export const TIMING = Object.freeze({ backoffMin: 5000, backoffMax: 60_000, pollMs: 15_000, failuresBeforePoll: 3, pingMs: 30_000, coalesceMs: 1000 });

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * A mirror. `settings()` → { url, token, enabled }; `watched()` → Set of entity ids; `onChange(entities, kind)`
 * after states changed ('state') or the connection did ('conn'); `fetchState(id, settings)` → REST state object.
 */
export function createHaLive({ settings, watched, onChange = () => {}, fetchState, WebSocketImpl = globalThis.WebSocket, timing = {}, log = console }) {
  const T = { ...TIMING, ...timing };
  /** entity → { state, attrs, slim, at } */
  const mirror = new Map();
  let status = { state: 'off', reason: '', lastEventAt: null };
  let sock = null;
  let subId = null;
  let subscribed = new Set();
  let synced = false;
  let running = false;
  let failures = 0;
  let retryTimer = null;
  let pollTimer = null;
  let pingTimer = null;
  let polling = false;
  let pollBusy = false;
  let noSubscribe = false;
  let gen = 0;

  const warn = (m) => log.warn?.(`[ha] ${redactSecrets(String(m))}`);
  const setStatus = (state, reason = '') => {
    const before = status.state;
    status = { ...status, state, reason };
    if (before !== state) onChange([], 'conn');
  };

  const put = (id, rec) => {
    const old = mirror.get(id);
    mirror.set(id, rec);
    return !old || old.at !== rec.at || JSON.stringify(old.slim) !== JSON.stringify(rec.slim);
  };

  // ---- WebSocket
  async function connect() {
    if (!running) return;
    const s = settings();
    const my = ++gen;
    if (!s.enabled || !s.url || !s.token) {
      setStatus('off');
      return;
    }
    if (!hasWebSocket(WebSocketImpl)) {
      setStatus('polling', 'no_websocket');
      startPolling();
      return;
    }
    let c;
    try {
      c = await openHaSocket({ url: s.url, token: s.token, WebSocketImpl });
    } catch (err) {
      if (my !== gen || !running) return;
      fail(err.code === 'auth' ? 'auth' : 'unreachable', err.message);
      return;
    }
    if (my !== gen || !running) {
      c.close();
      return;
    }
    sock = c;
    c.onClose(() => {
      if (sock !== c) return;
      sock = null;
      subId = null;
      subscribed = new Set();
      clearInterval(pingTimer);
      if (running) fail('unreachable', 'connection closed');
    });
    failures = 0;
    stopPolling();
    try {
      await resubscribe(true);
    } catch (err) {
      if (sock !== c) return;
      if (err.code === 'unknown_command') {
        // Home Assistant older than 2022.4: REST polling of the watched set (never the state_changed firehose)
        noSubscribe = true;
        setStatus('polling', 'old_version');
        startPolling();
        return;
      }
      warn(`subscribe failed: ${err.message}`);
      c.close();
      return;
    }
    setStatus('connected');
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (sock !== c) return;
      c.call({ type: 'ping' }, 10_000).catch(() => c.close());
    }, T.pingMs);
    pingTimer.unref?.();
  }

  function fail(reason, message) {
    failures++;
    if (failures === 1 || failures % 10 === 0) warn(`connection: ${message}`);
    if (failures >= T.failuresBeforePoll && reason !== 'auth') {
      // 'polling' (screens see Home Assistant as fine) only once a poll has read the watched set: with Home
      // Assistant down altogether the screens keep their dot instead of losing it until the next poll fails
      if (status.state !== 'polling') setStatus('error', reason);
      startPolling();
    } else setStatus('error', reason);
    scheduleRetry();
  }

  function scheduleRetry() {
    if (!running || retryTimer) return;
    const delay = Math.min(T.backoffMax, T.backoffMin * 2 ** Math.max(0, failures - 1));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
    retryTimer.unref?.();
  }

  /** (Re)subscribe to the watched set: its first event is the full state of those entities. */
  async function resubscribe(force = false) {
    if (!sock || noSubscribe) return;
    const want = new Set([...watched()].filter((e) => ENTITY_RE.test(e)));
    if (!force && subId !== null && sameSet(want, subscribed)) return;
    const c = sock;
    if (subId !== null) {
      const old = subId;
      subId = null;
      c.forget(old);
      c.call({ type: 'unsubscribe_events', subscription: old }).catch(() => {});
    }
    for (const id of [...mirror.keys()]) if (!want.has(id)) mirror.delete(id);
    subscribed = want;
    synced = false;
    // an empty entity_ids would mean every entity in Home Assistant: nothing watched, nothing subscribed
    if (!want.size) {
      synced = true;
      return;
    }
    const ids = [...want];
    subId = await c.subscribe({ type: 'subscribe_entities', entity_ids: ids }, (ev) => onEvent(ev, want));
  }

  /** subscribe_entities events: a (added, full), c (changed: + and -), r (removed). */
  function onEvent(ev, want) {
    if (!ev || typeof ev !== 'object') return;
    const changed = [];
    for (const [id, x] of Object.entries(ev.a ?? {})) {
      if (!want.has(id) || !x) continue;
      const attrs = pickAttrs(x.a);
      const at = Math.round((Number(x.lc ?? x.lu) || 0) * 1000);
      if (put(id, { state: String(x.s ?? ''), attrs, slim: slim(id.split('.')[0], x.s, attrs), at })) changed.push(id);
    }
    for (const [id, x] of Object.entries(ev.c ?? {})) {
      const old = mirror.get(id);
      if (!want.has(id) || !old || !x) continue;
      const plus = x['+'] ?? {};
      const attrs = { ...old.attrs, ...pickAttrs(plus.a) };
      for (const k of Array.isArray(x['-']?.a) ? x['-'].a : []) delete attrs[k];
      const state = plus.s !== undefined ? String(plus.s) : old.state;
      const at = plus.lc !== undefined ? Math.round(Number(plus.lc) * 1000) : plus.s !== undefined && plus.lu !== undefined ? Math.round(Number(plus.lu) * 1000) : old.at;
      if (put(id, { state, attrs, slim: slim(id.split('.')[0], state, attrs), at })) changed.push(id);
    }
    for (const id of Array.isArray(ev.r) ? ev.r : []) {
      if (mirror.delete(id)) changed.push(id);
    }
    synced = true;
    status.lastEventAt = Date.now();
    if (changed.length) onChange(changed, 'state');
  }

  // ---- REST polling
  function startPolling() {
    if (polling || !running) return;
    polling = true;
    void pollOnce();
    pollTimer = setInterval(() => void pollOnce(), T.pollMs);
    pollTimer.unref?.();
  }
  function stopPolling() {
    polling = false;
    clearInterval(pollTimer);
    pollTimer = null;
  }
  async function pollOnce() {
    if (pollBusy || !polling) return;
    pollBusy = true;
    try {
      const s = settings();
      const want = [...watched()].filter((e) => ENTITY_RE.test(e));
      for (const id of [...mirror.keys()]) if (!want.includes(id)) mirror.delete(id);
      const changed = [];
      let ok = 0;
      // a few at a time: a Pi and Home Assistant both stay calm
      for (let i = 0; i < want.length; i += 4) {
        await Promise.all(want.slice(i, i + 4).map(async (id) => {
          try {
            const rec = fromRestState(await fetchState(id, s));
            ok++;
            if (put(id, rec)) changed.push(id);
          } catch (err) {
            if (err?.status === 404) {
              ok++;
              if (mirror.delete(id)) changed.push(id);
            }
          }
        }));
        if (!polling) return;
      }
      if (want.length && !ok) {
        if (status.state === 'polling') setStatus('error', status.reason || 'unreachable');
      } else {
        synced = true;
        status.lastEventAt = Date.now();
        if (status.state === 'error' && !sock) setStatus('polling', status.reason);
      }
      if (changed.length) onChange(changed, 'state');
    } finally {
      pollBusy = false;
    }
  }

  function teardown() {
    gen++;
    clearTimeout(retryTimer);
    retryTimer = null;
    clearInterval(pingTimer);
    stopPolling();
    const c = sock;
    sock = null;
    subId = null;
    subscribed = new Set();
    c?.close();
  }

  return {
    start() {
      if (running) return;
      running = true;
      failures = 0;
      noSubscribe = false;
      void connect();
    },
    stop() {
      running = false;
      teardown();
      mirror.clear();
      synced = false;
      setStatus('off');
    },
    /** A new token or URL: drop everything and connect again. */
    restart() {
      const was = running;
      this.stop();
      if (was) this.start();
    },
    /** The watched set may have changed (a config save): subscribe to the new one. */
    watchedChanged() {
      if (!running) return;
      const s = settings();
      if (!s.enabled || !s.url || !s.token) {
        teardown();
        mirror.clear();
        setStatus('off');
        return;
      }
      if (status.state === 'off') return void connect();
      if (sock) resubscribe().catch((err) => warn(`subscribe failed: ${err.message}`));
      else if (polling) void pollOnce();
    },
    /** { state, attrs, slim, at } of a mirrored entity, or null. */
    get(id) {
      return mirror.get(id) ?? null;
    },
    /** True once the mirror holds the full first answer for the watched set (a missing entity is then gone). */
    get synced() {
      return synced;
    },
    status() {
      return { state: status.state, ...(status.reason ? { reason: status.reason } : {}), lastEventAt: status.lastEventAt, count: mirror.size };
    },
    /** A WebSocket command over this connection: { value } when connected, undefined when not. */
    async command(msg, timeout) {
      if (!sock?.open || status.state !== 'connected') return undefined;
      return { value: await sock.call(msg, timeout) };
    },
  };
}

// ---- the server's own mirror and the `ha` event -------------------------------------------------------------------

let live = null;
let deps = null;
let rev = 0;
let index = new Map(); // entity → Set of screen ids
let condIndex = new Map(); // entity a condition reads → Set of screen ids
let offConditions = null;
const pending = new Map(); // screen id → Set of aliases (null: everything, a connection change)
let flushTimer = null;

/** The mirror, once startHaLive() ran (null in tests that do not start it). */
export const haLive = () => live;
export const haRev = () => rev;

/** Connection state as displays see it. */
export const haConn = () => (live && ['connected', 'polling'].includes(live.status().state) ? 'ok' : 'down');
/** Home Assistant is not set up at all (off, or no URL or token): the cards show a calm note, not the offline dot. */
const haOffNow = () => live?.status().state === 'off';
const connOf = () => (haOffNow() ? { conn: haConn(), off: true } : { conn: haConn() });

function rebuildIndex(cfg) {
  index = new Map();
  condIndex = new Map();
  for (const s of cfg.screens ?? []) {
    for (const a of aliasesFor(s).values()) {
      if (!index.has(a.entity)) index.set(a.entity, new Set());
      index.get(a.entity).add(s.id);
    }
    for (const e of conditionEntities(s)) {
      if (!condIndex.has(e)) condIndex.set(e, new Set());
      condIndex.get(e).add(s.id);
    }
  }
}

/**
 * The states of one screen's aliases (all of them, or `only`), as the display may see them: none while the screen
 * is private, controls only when its touch switch is on (and controls are allowed here).
 */
export function screenStates(cfg, screen, { only = null, hidden = null } = {}) {
  if (!live || !deps) return {};
  if (deps.isPrivate(cfg, screen)) return {};
  const aliases = aliasesFor(screen);
  if (!aliases.size) return {};
  const touch = !!screen.canvas?.touch && deps.haControls !== false;
  return snapshotStates(aliases, (e) => live.get(e), { touch, only, hidden: hidden ?? hiddenItems(cfg, screen), missing: live.synced ? 'unavailable' : 'skip' });
}

/** The `hide` field of a screen's snapshots: the items its conditions hide now (only on screens with conditions). */
function withHide(cfg, screen, snap, hidden) {
  return hasConditions(screen) ? { ...snap, hide: [...hidden] } : snap;
}

/** A full snapshot of one screen (GET /api/display/ha, and a stream that just opened). */
export function screenSnapshot(cfg, screen) {
  const hidden = hiddenItems(cfg, screen);
  return withHide(cfg, screen, { rev, ...connOf(), full: true, screenId: screen.id, states: screenStates(cfg, screen, { hidden }) }, hidden);
}

/**
 * Send an `ha` event to the displays of `screenIds` (carousel-aware: sse.js matches a carousel's displays by its
 * screens). Never recorded for the poll channel and never makes polls faster.
 */
export function publishHa(screenIds, diff) {
  if (!deps) return 0;
  return deps.broadcast('ha', diff, { screenIds });
}

function queue(screenId, aliases) {
  const cur = pending.get(screenId);
  if (aliases === null || cur === null) pending.set(screenId, null);
  else pending.set(screenId, new Set([...(cur ?? []), ...aliases]));
  if (flushTimer) return;
  // the first change of a quiet second waits a second for the ones that follow it: at most one event a second
  flushTimer = setTimeout(flush, deps?.coalesceMs ?? TIMING.coalesceMs);
  flushTimer.unref?.();
}

function flush() {
  flushTimer = null;
  if (!deps) return pending.clear();
  const cfg = deps.getConfig();
  const jobs = [...pending.entries()];
  pending.clear();
  rev++;
  for (const [screenId, aliases] of jobs) {
    const screen = cfg.screens.find((s) => s.id === screenId);
    if (!screen) continue;
    const hidden = hiddenItems(cfg, screen);
    const states = aliases === null ? screenStates(cfg, screen, { hidden }) : screenStates(cfg, screen, { only: aliases, hidden });
    if (aliases !== null && !Object.keys(states).length) continue;
    publishHa([screenId], withHide(cfg, screen, { rev, ...connOf(), full: aliases === null, screenId, states }, hidden));
  }
}

function onMirrorChange(entities, kind) {
  if (!deps) return;
  const cfg = deps.getConfig();
  if (kind === 'conn') {
    // the dot on the cards: every screen that shows Home Assistant gets a full snapshot with the new state
    for (const ids of index.values()) for (const id of ids) queue(id, null);
    const cond = new Set([...condIndex.values()].flatMap((ids) => [...ids]));
    for (const id of cond) {
      // sent whatever it is: remembered so the next reading compares with what the screens have now
      const screen = cfg.screens.find((s) => s.id === id);
      if (screen) hideChanged(cfg, screen);
      queue(id, null);
    }
    conditionChanged([...cond], 'ha');
    return;
  }
  // an entity a condition reads: the whole screen again when an item shows or hides (and its values too); nothing
  // when the change hides and shows the same items (the display never hears when that entity changes)
  const condScreens = new Set();
  for (const e of entities) for (const sid of condIndex.get(e) ?? []) condScreens.add(sid);
  const flipped = [...condScreens].filter((sid) => {
    const screen = cfg.screens.find((s) => s.id === sid);
    return screen && hideChanged(cfg, screen);
  });
  for (const sid of flipped) queue(sid, null);
  conditionChanged(flipped, 'ha');
  const per = new Map();
  for (const e of entities) {
    for (const sid of index.get(e) ?? []) {
      const screen = cfg.screens.find((s) => s.id === sid);
      if (!screen) continue;
      if (!per.has(sid)) per.set(sid, new Set());
      for (const [alias, a] of aliasesFor(screen)) if (a.entity === e) per.get(sid).add(alias);
    }
  }
  for (const [sid, aliases] of per) queue(sid, aliases);
}

/**
 * Start the server's mirror. `deps` = { getConfig, settings, fetchState, broadcast, isPrivate(cfg, screen),
 * haControls?, WebSocketImpl?, timing?, coalesceMs? }. Call configChanged() after every config save and restart()
 * after a token change.
 */
export function startHaLive(d) {
  stopHaLive();
  deps = d;
  rebuildIndex(d.getConfig());
  // conditions read the raw state ('on', 'open', '21.5'); a Valor condition that changed sends its screens again
  setConditionSource({ ha: (e) => live?.get(e)?.state ?? null });
  offConditions = onConditionChange((ids, src) => {
    if (src !== 'value') return;
    for (const id of ids) if (deps?.getConfig().screens.some((s) => s.id === id && aliasesFor(s).size)) queue(id, null);
  });
  live = createHaLive({
    settings: d.settings,
    watched: () => watchedEntities(d.getConfig()),
    fetchState: d.fetchState,
    onChange: onMirrorChange,
    WebSocketImpl: d.WebSocketImpl ?? globalThis.WebSocket,
    timing: d.timing,
  });
  live.start();
  return live;
}

export function stopHaLive() {
  offConditions?.();
  offConditions = null;
  live?.stop();
  live = null;
  deps = null;
  clearTimeout(flushTimer);
  flushTimer = null;
  pending.clear();
  index = new Map();
  condIndex = new Map();
  forgetHide();
}

/** A config save: new screens, items or weather entities. */
export function haConfigChanged(cfg) {
  forgetHide();
  if (!live) return;
  rebuildIndex(cfg);
  live.watchedChanged();
}

/** A new token (or URL): connect again from scratch. */
export function haRestart() {
  live?.restart();
}

/** The value of `entity` from the mirror as a REST-like state ({ state, attributes }), or null. */
export function mirroredState(entity) {
  const m = live?.get(entity);
  if (!m || m.slim.d === 'unavailable') return null;
  return { entity_id: entity, state: m.state, attributes: m.attrs };
}

export function haStatus() {
  const cfg = deps?.getConfig();
  const s = live ? live.status() : { state: 'off', lastEventAt: null, count: 0 };
  return { ...s, watched: cfg ? watchedEntities(cfg).size : 0 };
}
