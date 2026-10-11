// First-run setup wizard API (docs/API.md → "Setup"). A fresh install has no admin password: until the wizard
// completes, GET /api/setup/status says needsSetup and POST /api/setup/complete creates the password hash + the
// initial settings in one step and logs the browser in. Afterwards every mutating setup endpoint answers 409.
//
// Who may run the wizard:
//   - SETUP_TOKEN set           → only with that token (x-setup-token header or { token } in the body).
//   - SETUP_REQUIRE_TOKEN=1     → only with the per-process token printed in the server log (the Docker image
//                                 sets this: inside a container the client address says nothing reliable).
//   - otherwise                 → from LAN clients (lib/net.js isLanClient strict: private address, not relayed
//                                 by an untrusted proxy, not the container gateway) without a token; from anywhere
//                                 else only with the per-process token printed in the server log at startup.
//   - a previously configured install whose secrets were lost (config revision > 1, no password) always needs
//     the token: losing secrets.json must not reopen the install to the whole LAN.
import crypto from 'node:crypto';
import { Router } from 'express';
import os from 'node:os';
import { getConfig, saveConfig, updateSecrets } from './store.js';
import { isLanClient, ipBucket, inContainer } from './lib/net.js';
import { hashPassword, needsSetup, startSession } from './auth.js';
import { googleConfigured } from './google.js';
import { logActivity, logActivityThrottled } from './activity.js';
import { testIcs } from './calendars.js';
import { passwordProblem, PASSWORD_MESSAGES } from './lib/password.js';
import { isHttpUrl, LAYOUT_PRESETS, slugify } from './core/validate.js';
import { isValidTimeZone } from './core/lib/tz.js';
import { LANGS, langFromHeader } from './core/lib/i18n.js';
import { DEFAULT_SOURCES } from './core/defaults.js';
import { displayAccessMode, displayKeyFor } from './displayAccess.js';

let generatedToken = null;

/** The token that unlocks the wizard: SETUP_TOKEN, or a random one generated once per process. */
export function setupToken() {
  const env = process.env.SETUP_TOKEN?.trim();
  if (env) return env;
  generatedToken ??= crypto.randomBytes(18).toString('base64url');
  return generatedToken;
}

/** Tests only: forget the generated token. */
export const _resetSetup = () => { generatedToken = null; inProgress = false; failures.clear(); };

const envFlag = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/** The config shows an install that was set up before (the wizard or the panel saved it at least once). */
export const previouslyConfigured = () => (getConfig()?.revision || 1) > 1;

/**
 * A token is needed when SETUP_TOKEN or SETUP_REQUIRE_TOKEN is configured, when the install was configured
 * before (lost secrets.json), or when the request does not provably come from the LAN.
 */
export const tokenRequired = (req) => Boolean(process.env.SETUP_TOKEN?.trim()) || envFlag(process.env.SETUP_REQUIRE_TOKEN)
  || previouslyConfigured() || !isLanClient(req, { strict: true });

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const tokenMatches = (given) => typeof given === 'string' && given.length > 0 && given.length <= 256
  && crypto.timingSafeEqual(digest(given), digest(setupToken()));

const tokenOf = (req) => req.get('x-setup-token') || (typeof req.body?.token === 'string' ? req.body.token : '');

// Wrong-token throttle (per IPv4 address / IPv6 /64): 10 failures → locked for 10 minutes. Applies to every place
// a token is checked (POST endpoints and the GET /status check), so /status is not a free guessing oracle.
const FAIL_MAX = 10;
const FAIL_WINDOW = 10 * 60_000;
const FAIL_TABLE_MAX = 5000;
const failures = new Map(); // bucket → { n, first }
/** Tokens this long (the generated one: 24 chars of base64url) cannot be guessed: a lockout never blocks them. */
const STRONG_TOKEN = 20;

/** Keep the table bounded without wiping live lockouts: drop expired entries, then the oldest ones. */
function pruneFailures(now) {
  for (const [k, f] of failures) if (now - f.first > FAIL_WINDOW) failures.delete(k);
  for (const k of failures.keys()) {
    if (failures.size <= FAIL_TABLE_MAX) break;
    failures.delete(k);
  }
}

/**
 * Check the request's token with failure counting. Returns 'ok' | 'missing' | 'invalid' | 'locked'.
 * A locked bucket still accepts the right token when that token is strong (the lockout only exists to stop
 * guessing a short user-chosen SETUP_TOKEN; it must not let a neighbour behind the same NAT lock the owner out).
 */
function checkToken(req) {
  const now = Date.now();
  const key = ipBucket(req.ip);
  const f = failures.get(key);
  if (f && now - f.first > FAIL_WINDOW) failures.delete(key);
  const cur = failures.get(key);
  const given = tokenOf(req);
  const locked = Boolean(cur && cur.n >= FAIL_MAX);
  if (locked) return setupToken().length >= STRONG_TOKEN && tokenMatches(given) ? 'ok' : 'locked';
  if (tokenMatches(given)) return 'ok';
  if (!given) return 'missing';
  const entry = cur || { n: 0, first: now };
  entry.n += 1;
  failures.delete(key);
  failures.set(key, entry); // re-insert: Map order = least recently failed first
  if (failures.size > FAIL_TABLE_MAX) pruneFailures(now);
  logActivityThrottled('auth.setup_rejected', `setup|${key}`, { everyMs: 60_000, perMinute: 10 },
    { req, actor: 'anonymous', level: 'warn', data: { reason: 'invalid_token' } });
  return 'invalid';
}

function tokenGate(req, res) {
  if (!tokenRequired(req)) return true;
  const r = checkToken(req);
  if (r === 'ok') return true;
  if (r === 'locked') {
    res.status(429).json({ error: 'too many attempts, wait a few minutes' });
    return false;
  }
  if (r === 'missing') {
    logActivityThrottled('auth.setup_rejected', `setup|${ipBucket(req.ip)}`, { everyMs: 60_000, perMinute: 10 },
      { req, actor: 'anonymous', level: 'warn', data: { reason: 'token_required' } });
  }
  const given = r === 'invalid';
  res.status(403).json({ error: given ? 'invalid setup token' : 'setup token required', code: given ? 'invalid_token' : 'token_required' });
  return false;
}

/**
 * For routes outside /api/setup that the wizard also calls (GET /api/admin/geocode): true while the install has
 * no password and the request passes the same token rules as the wizard; otherwise the error response is sent.
 */
export function setupGate(req, res) {
  if (!needsSetup()) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return tokenGate(req, res);
}

/** 409 once the install has a password. */
function openGate(res) {
  if (needsSetup()) return true;
  res.status(409).json({ error: 'setup already completed' });
  return false;
}

export const suggestedLanguage = langFromHeader;

const LAYOUTS = LAYOUT_PRESETS;
const PHOTO_SOURCES = ['stock', 'gallery', 'mixed'];
const AMBIENTS = ['aurora', 'particles', 'none'];
const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/**
 * Validate the wizard payload. Returns { errors: [{ path, message }], value } (value normalised).
 * Optional sections fall back to the current settings.
 */
export function parseSetupBody(b) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });
  if (!isObj(b)) return { errors: [{ path: '', message: 'expected a JSON object' }], value: null };
  const v = {};
  const pw = passwordProblem(b.password, typeof b.passwordConfirm === 'string' ? b.passwordConfirm : '');
  if (pw) err(pw === 'mismatch' ? 'passwordConfirm' : 'password', PASSWORD_MESSAGES[pw]);
  v.password = b.password;
  v.language = LANGS.includes(b.language) ? b.language : (err('language', 'expected es, en, pt or nl'), 'en');
  v.screenName = cleanText(b.screenName, 40) || 'Living room';
  if (b.location !== undefined) {
    const l = b.location;
    if (!isObj(l)) err('location', 'expected object');
    else {
      const lat = Number(l.lat);
      const lon = Number(l.lon);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) err('location.lat', 'invalid latitude');
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) err('location.lon', 'invalid longitude');
      const tz = cleanText(l.timezone, 64);
      if (tz && !isValidTimeZone(tz)) err('location.timezone', 'unknown timezone');
      v.location = { name: cleanText(l.name, 80) || `${lat.toFixed(2)}, ${lon.toFixed(2)}`, lat, lon, timezone: tz || null };
    }
  }
  if (b.timezone !== undefined) {
    const tz = cleanText(b.timezone, 64);
    if (tz && isValidTimeZone(tz)) v.timezone = tz;
    else err('timezone', 'unknown timezone');
  }
  if (b.units !== undefined) v.units = b.units === 'imperial' ? 'imperial' : b.units === 'metric' ? 'metric' : (err('units', 'expected metric or imperial'), 'metric');
  if (b.format24 !== undefined) v.format24 = b.format24 !== false;
  v.calendars = [];
  if (b.calendars !== undefined) {
    if (!Array.isArray(b.calendars) || b.calendars.length > 20) err('calendars', 'expected a list of at most 20 calendars');
    else {
      b.calendars.forEach((c, i) => {
        const url = isObj(c) ? cleanText(c.url, 2048) : '';
        if (!isHttpUrl(url, ['http:', 'https:', 'webcal:', 'webcals:'])) return err(`calendars[${i}].url`, 'invalid URL');
        v.calendars.push({
          name: cleanText(c.name, 80) || 'Calendar',
          url,
          kind: c.kind === 'holidays' ? 'holidays' : 'generic',
          color: HEX.test(c.color) ? c.color.toLowerCase() : null,
        });
      });
    }
  }
  const pick = (path, val, list) => {
    if (val === undefined) return undefined;
    if (list.includes(val)) return val;
    err(path, `expected one of ${list.join(', ')}`);
    return undefined;
  };
  v.layout = pick('layout.preset', isObj(b.layout) ? b.layout.preset : b.layout, LAYOUTS);
  v.photos = pick('photos.source', isObj(b.photos) ? b.photos.source : b.photos, PHOTO_SOURCES);
  v.ambient = pick('ambient', b.ambient, AMBIENTS);
  v.theme = pick('theme', b.theme, ['dark', 'light']);
  if (b.accent !== undefined) v.accent = HEX.test(b.accent) ? b.accent.toLowerCase() : (err('accent', 'expected #rrggbb'), undefined);
  return { errors, value: v };
}

const CAL_COLORS = ['#f4a261', '#4ea8de', '#2ec4b6', '#9b6bff', '#ff6f91', '#9bd34a', '#ffc23d', '#5b7cfa'];

/** The current config with the wizard choices applied (pure: returns a new object). */
export function applySetup(cfg, v) {
  const next = structuredClone(cfg);
  const scr = next.screens.find((s) => s.id === next.defaultScreen) || next.screens[0];
  scr.name = v.screenName;
  const taken = new Set(next.screens.filter((s) => s !== scr).map((s) => s.slug));
  let slug = slugify(v.screenName) || 'living-room';
  for (let i = 2; taken.has(slug); i++) slug = `${slugify(v.screenName).slice(0, 28) || 'screen'}-${i}`;
  scr.slug = slug;
  scr.screen.language = v.language;
  if (v.accent) scr.screen.accent = v.accent;
  if (v.theme) scr.screen.theme = v.theme;
  if (v.layout) scr.layout.preset = v.layout;
  if (v.photos) scr.background.source = v.photos;
  if (v.ambient) scr.background.ambient = v.ambient;
  if (v.format24 !== undefined) {
    scr.datetime.format24 = v.format24;
    scr.datetime.showAmPm = !v.format24;
  }
  if (v.location) {
    next.weather.locationName = v.location.name;
    next.weather.lat = Math.round(v.location.lat * 10000) / 10000;
    next.weather.lon = Math.round(v.location.lon * 10000) / 10000;
    if (v.location.timezone) next.datetime.timezone = v.location.timezone;
  }
  if (v.timezone && !v.location?.timezone) next.datetime.timezone = v.timezone;
  if (v.units) next.weather.units = v.units;
  // The example holiday feed shipped in the defaults is replaced by the wizard's choice (when untouched).
  const sample = DEFAULT_SOURCES[0];
  next.calendar.sources = next.calendar.sources.filter((s) => !(s.id === sample.id && s.url === sample.url));
  const used = new Set(next.calendar.sources.map((s) => s.id));
  v.calendars.forEach((c, i) => {
    let id;
    do id = `c_${crypto.randomBytes(4).toString('hex')}`; while (used.has(id));
    used.add(id);
    next.calendar.sources.push({
      id, type: 'ics', name: c.name, url: c.url,
      color: c.color || CAL_COLORS[(next.calendar.sources.length + i) % CAL_COLORS.length],
      emoji: c.kind === 'holidays' ? '🎉' : '', kind: c.kind, enabled: true,
      refreshMin: c.kind === 'holidays' ? 720 : 15, insecureTls: false,
    });
  });
  return next;
}

let inProgress = false;

// Virtual interfaces (Docker/Podman bridges, veth pairs, libvirt, CNI, VPN tunnels): their addresses are not
// reachable from a phone on the LAN.
const VIRTUAL_IF = /^(docker|br-|veth|virbr|cni|flannel|cali|podman|lxc|lxd|tun|tap|wg|zt|tailscale|vmnet|vboxnet)/i;

/**
 * Non-internal IPv4 addresses of this machine (at most 3), real LAN interfaces first. LAN_ADDRESS overrides the
 * detection (useful in Docker, where the container only sees its internal address: then nothing is detected).
 */
export function lanAddresses() {
  const forced = String(process.env.LAN_ADDRESS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (forced.length) return forced.slice(0, 3);
  if (inContainer()) return [];
  try {
    return Object.entries(os.networkInterfaces())
      .filter(([name]) => !VIRTUAL_IF.test(name))
      .flatMap(([, list]) => list || [])
      .filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
      .map((i) => i.address)
      .slice(0, 3);
  } catch {
    return [];
  }
}


export function setupRouter({ version }) {
  const r = Router();
  r.use((req, res, next) => {
    res.set('cache-control', 'no-store');
    // Stricter than the global CSRF guard: every setup mutation must be a JSON body (no empty/form posts).
    if (req.method === 'POST' && !(req.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'content-type must be application/json' });
    }
    next();
  });

  r.get('/status', (req, res) => {
    const open = needsSetup();
    const out = {
      needsSetup: open,
      googleConfigured: googleConfigured(),
      version,
      suggestedLanguage: suggestedLanguage(req.get('accept-language')),
    };
    if (open) {
      out.tokenRequired = tokenRequired(req);
      // Lets the wizard check a token from ?setup=… before asking for the password. Same failure counter and
      // lockout as the POST endpoints (a locked client gets 429).
      if (tokenOf(req)) {
        const r = checkToken(req);
        if (r === 'locked') return res.status(429).json({ error: 'too many attempts, wait a few minutes' });
        out.tokenValid = r === 'ok';
      } else {
        out.tokenValid = null;
      }
      // The welcome screen of a kiosk opened on http://localhost (and the wizard's last step) need this machine's
      // LAN address for the QR code. Not inside a container: there it would be the container's internal address.
      if (isLanClient(req)) {
        out.lanAddresses = lanAddresses();
      }
      const cfg = getConfig();
      out.defaults = { timezone: cfg.datetime.timezone, location: cfg.weather.locationName };
    }
    res.json(out);
  });

  // ICS "Test" button of the wizard (the admin's /api/admin/test/ics needs a session, which does not exist yet).
  r.post('/test-ics', async (req, res, next) => {
    try {
      if (!openGate(res) || !tokenGate(req, res)) return;
      const { url } = req.body || {};
      if (!isHttpUrl(url, ['http:', 'https:', 'webcal:', 'webcals:'])) return res.json({ ok: false, count: 0, sample: [], error: 'invalid URL' });
      res.json(await testIcs(url, false, { guard: true }));
    } catch (err) {
      next(err);
    }
  });

  r.post('/complete', async (req, res, next) => {
    if (!openGate(res) || !tokenGate(req, res)) return;
    const { errors, value } = parseSetupBody(req.body);
    if (errors.length) return res.status(400).json({ error: 'invalid setup data', details: errors });
    const nextCfg = applySetup(getConfig(), value);
    // Claim the wizard synchronously: a concurrent request now gets 409 (single-threaded; no await before this).
    if (inProgress) return res.status(409).json({ error: 'setup already in progress' });
    inProgress = true;
    try {
      const hash = await hashPassword(value.password);
      if (!needsSetup()) return res.status(409).json({ error: 'setup already completed' });
      // Config first (validated as a whole): if it fails nothing has changed and the wizard can be retried.
      const saved = saveConfig(nextCfg, { reason: 'setup', req, backup: false });
      if (!saved.ok) return res.status(400).json({ error: 'invalid setup data', details: saved.errors });
      const epoch = crypto.randomBytes(16).toString('hex');
      updateSecrets((s) => {
        s.passwordHash = hash;
        s.passwordIsDefault = false;
        delete s.passwordFromEnv;
        s.sessionEpoch = epoch;
        s.setupCompletedAt = new Date().toISOString();
      });
      startSession(req, { email: 'admin', name: 'Admin', picture: '', method: 'password' });
      logActivity('auth.setup_completed', {
        req,
        level: 'warn',
        data: {
          language: value.language, screen: saved.config.screens.find((s) => s.id === saved.config.defaultScreen)?.slug,
          calendars: value.calendars.length, location: value.location?.name ?? null, viaToken: tokenRequired(req),
        },
      });
      const scr = saved.config.screens.find((s) => s.id === saved.config.defaultScreen) || saved.config.screens[0];
      // The Done step shows the screen's private link (+ QR) in private mode instead of the bare address.
      const key = displayKeyFor(scr.id);
      res.json({
        ok: true, user: { email: 'admin', name: 'Admin', picture: '', method: 'password' },
        screen: { id: scr.id, slug: scr.slug, name: scr.name, displayPath: key ? `/d/${key}` : null },
        displayAccess: displayAccessMode(saved.config),
      });
    } catch (err) {
      next(err);
    } finally {
      inProgress = false;
    }
  });
  return r;
}

/**
 * Startup log lines with the setup URL (token included). Always lists http://localhost:<PORT> and the LAN
 * addresses with the real port; PUBLIC_URL is added when it is set to something else than localhost.
 */
export function logSetupHint(port) {
  if (!needsSetup()) return;
  const token = encodeURIComponent(setupToken());
  const bases = [`http://localhost:${port}`, ...lanAddresses().slice(0, 2).map((ip) => `http://${ip}:${port}`)];
  const pub = String(process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (pub) {
    try {
      if (!/^(localhost|127\.|\[::1\])/.test(new URL(pub).hostname) && !bases.includes(pub)) bases.push(pub);
    } catch { /* invalid PUBLIC_URL: ignore */ }
  }
  console.log('[setup] No admin password yet: finish the first-run setup wizard in your browser.');
  for (const b of bases) console.log(`[setup] Open ${b}/admin/?setup=${token} to finish setup`);
  if (inContainer() && !process.env.LAN_ADDRESS) {
    console.log(`[setup] (running in a container: from another device replace "localhost" with the address of the Docker host, and ${port} with the published port)`);
  }
  const envTok = process.env.SETUP_TOKEN?.trim();
  if (envTok) {
    console.log('[setup] (SETUP_TOKEN is set: the wizard always asks for it)');
    if (envTok.length < 16) console.warn('[setup] WARNING: SETUP_TOKEN is shorter than 16 characters; use a long random value (openssl rand -hex 16)');
  } else if (envFlag(process.env.SETUP_REQUIRE_TOKEN)) {
    console.log('[setup] (SETUP_REQUIRE_TOKEN is set: the wizard always asks for the token above)');
  } else if (previouslyConfigured()) {
    console.log('[setup] (this install was configured before but has no password (secrets.json lost?): the token is required)');
  } else {
    console.log('[setup] (from your local network /admin/ works without the token; elsewhere the token is required)');
  }
}
