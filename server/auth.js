// Admin authentication: scrypt password, cookie-session, Google OAuth login/connect, CSRF guard.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import cookieSession from 'cookie-session';
import { getConfig, getSecrets, updateSecrets, updateConfig } from './store.js';
import * as google from './google.js';
import * as microsoft from './microsoft.js';
import { logActivity, logActivityThrottled } from './activity.js';
import { passwordProblem, PASSWORD_MESSAGES } from './lib/password.js';
import { isPrivateIp, isLanClient, ipBucket, hostAllowed, hostnameOf } from './lib/net.js';

export { isPrivateIp, isLanClient };

/**
 * 'revoked' () after the session epoch rotates (logout everywhere, password change, imported password);
 * 'logout' (sid) when one browser logs out. Live admin-session streams listen (displayAccess.js).
 */
export const authEvents = new EventEmitter();

const scryptRaw = promisify(crypto.scrypt);
const KEYLEN = 64;

// Global concurrency cap: one scrypt at a time (brute-force throttle + keeps the Pi responsive).
let scryptChain = Promise.resolve();
function scrypt(...args) {
  const run = scryptChain.then(() => scryptRaw(...args));
  scryptChain = run.catch(() => {});
  return run;
}

/** Format: scrypt$<saltB64>$<hashB64> */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(String(password ?? ''), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const WEAK_DEFAULTS = new Set(['', 'admin', 'password', 'change-me']);

/** Fresh install: no admin password has been set yet → the admin shows the setup wizard (server/setup.js). */
export const needsSetup = () => !getSecrets().passwordHash;

/**
 * Startup: make sure a session epoch exists and, when ADMIN_PASSWORD is set and no password hash exists yet
 * (headless/Docker installs), hash it as the initial password (`passwordFromEnv`: the panel offers to change it).
 * Without ADMIN_PASSWORD there is no default password at all: the install stays in "needs setup" until the
 * wizard completes. An ADMIN_PASSWORD that does not meet the wizard's rules (at least 10 characters, not a common
 * password: lib/password.js) is flagged as weak (`passwordIsDefault`): it is then only accepted from LAN clients
 * (isLanClient strict) and the panel forces a change. Installs that already have a hash are never touched.
 */
export async function ensurePassword() {
  const sec = getSecrets();
  if (!sec.sessionEpoch) updateSecrets((s) => { s.sessionEpoch = crypto.randomBytes(16).toString('hex'); });
  if (sec.passwordHash) return;
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return;
  const h = await hashPassword(pw);
  if (getSecrets().passwordHash) return; // set meanwhile (wizard)
  const weak = WEAK_DEFAULTS.has(pw) || pw.length < 6 || passwordProblem(pw) !== null;
  updateSecrets((s) => { s.passwordHash = h; s.passwordIsDefault = weak; s.passwordFromEnv = true; });
  if (weak) console.warn('[auth] ADMIN_PASSWORD does not meet the password rules (>= 10 characters, not a common password): it only works from the LAN until you change it in the panel');
}

export const SESSION_MAX_AGE = 14 * 24 * 3600_000;

export function sessionMiddleware() {
  const envSecret = process.env.SESSION_SECRET;
  const secret = envSecret && envSecret !== 'change-me' ? envSecret : getSecrets().sessionSecret;
  const mw = cookieSession({
    name: 'cs_session',
    keys: [secret],
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
  });
  // Secure flag decided per request: https requests (directly or via a trusted proxy) get a Secure cookie,
  // plain-http LAN access (http://<pi-ip>:3000/admin/) still works. COOKIE_SECURE=0 disables it, =1 forces it.
  const mode = process.env.COOKIE_SECURE;
  return (req, res, next) => mw(req, res, () => {
    if (req.sessionOptions) req.sessionOptions.secure = mode === '1' ? true : mode === '0' ? false : Boolean(req.secure);
    next();
  });
}

/** Server-side validity of a cookie session: epoch (revocation), login method still allowed, Google email still allowed. */
export function sessionValid(req) {
  if (needsSetup()) return false;
  const u = req.session?.user;
  if (!u) return false;
  const sec = getSecrets();
  if (!sec.sessionEpoch || req.session.epoch !== sec.sessionEpoch) return false;
  const cfg = getConfig();
  if (u.method === 'password') {
    if (!cfg.auth.passwordLoginEnabled) return false;
    if (sec.passwordIsDefault && !isLanClient(req, { strict: true })) return false;
  } else if (u.method === 'google') {
    // Sign in with Google turned off (the default on self-hosted): sessions made with it end too.
    if (!google.googleLoginEnabled(cfg)) return false;
    if (!cfg.auth.allowedGoogleEmails.includes(u.email)) return false;
  } else {
    return false;
  }
  return true;
}

/**
 * Family photos (/media/*): LAN clients (the displays) or a signed-in admin only. Behind a reverse proxy that lets
 * /media/* through (deploy/Caddyfile.example), Internet clients without a session get 404.
 */
export function lanOrSession(req, res, next) {
  if (isLanClient(req) || sessionValid(req)) return next();
  res.status(404).type('text/plain').send('not found');
}

export function startSession(req, user) {
  req.session.user = user;
  req.session.epoch = getSecrets().sessionEpoch;
  // Per-login id: lets a plain logout close the streams this browser opened (admin previews).
  req.session.sid = crypto.randomBytes(9).toString('base64url');
}

export function requireAuth(req, res, next) {
  if (sessionValid(req)) return next();
  if (req.session?.user) req.session = null;
  res.status(401).json({ error: 'unauthorized' });
}

/** Invalidate every existing session (password change, "log out everywhere"). */
export function rotateSessionEpoch() {
  const epoch = crypto.randomBytes(16).toString('hex');
  updateSecrets((s) => { s.sessionEpoch = epoch; });
  authEvents.emit('revoked');
  return epoch;
}

/**
 * CSRF guard for mutating requests: the session cookie is SameSite=Lax; additionally the body must be JSON
 * (or multipart for photo upload, or empty), and a present Origin header must match the Host and be an allowed
 * host name (lib/net.js hostAllowed: LAN names, IP literals, PUBLIC_URL, ALLOWED_HOSTS; DNS rebinding guard).
 */
export function csrfGuard({ multipartPaths = [] } = {}) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Sec-Fetch-Site, when the browser sends it (HTTPS and localhost only), must be same-origin.
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin') return res.status(403).json({ error: 'bad origin' });
    const origin = req.get('origin');
    if (origin && origin !== 'null') {
      let host;
      try { host = new URL(origin).host; } catch { host = ''; }
      if (!host || !hostAllowed(hostnameOf(host))) return res.status(403).json({ error: 'bad origin' });
      const allowed = new Set([req.get('host'), req.get('x-forwarded-host')].filter(Boolean));
      if (process.env.PUBLIC_URL) { try { allowed.add(new URL(process.env.PUBLIC_URL).host); } catch { /* ignore */ } }
      if (!allowed.has(host)) return res.status(403).json({ error: 'bad origin' });
    }
    if (req.method === 'DELETE') return next();
    const ct = (req.get('content-type') || '').toLowerCase();
    const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if (ct.startsWith('application/json')) return next();
    if (ct.startsWith('multipart/form-data') && multipartPaths.some((p) => (p instanceof RegExp ? p.test(req.path) : p === req.path))) return next();
    if (!ct && !hasBody) return next();
    res.status(415).json({ error: 'content-type must be application/json' });
  };
}

const sessionUser = (u) => ({ email: u.email, name: u.name, picture: u.picture || '', method: u.method });

// ---------- route handlers ----------
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000;
const attempts = new Map(); // ip → { n, first, until }

function pruneAttempts(now) {
  for (const [ip, a] of attempts) if (a.until <= now && now - a.first > WINDOW_MS) attempts.delete(ip);
}

export async function loginHandler(req, res) {
  const cfg = getConfig();
  if (needsSetup()) return res.status(409).json({ error: 'setup required', needsSetup: true });
  if (!cfg.auth.passwordLoginEnabled) return res.status(403).json({ error: 'password login disabled' });
  const now = Date.now();
  if (attempts.size > 1000) pruneAttempts(now);
  const key = ipBucket(req.ip);
  let a = attempts.get(key);
  if (!a || (a.until <= now && now - a.first > WINDOW_MS)) {
    a = { n: 0, first: now, until: 0 };
    attempts.set(key, a);
  }
  if (a.until > now) {
    // Logged once per lockout window (not for every rejected hammering attempt).
    if (!a.lockLogged) { a.lockLogged = true; logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'warn', data: { method: 'password', reason: 'rate_limited' } }); }
    return res.status(429).json({ error: 'too many attempts, wait a minute' });
  }
  // Reserve the attempt *before* the async verification so parallel requests cannot bypass the limit.
  a.n += 1;
  if (a.n >= MAX_ATTEMPTS) a.until = now + WINDOW_MS;
  const sec = getSecrets();
  const ok = await verifyPassword(req.body?.password, sec.passwordHash);
  if (!ok) {
    logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'warn', data: { method: 'password', reason: 'invalid_password', attempt: a.n } });
    return res.status(401).json({ error: 'invalid password' });
  }
  if (sec.passwordIsDefault && !isLanClient(req, { strict: true })) {
    logActivity('auth.login_failed', { req, actor: 'anonymous', level: 'warn', data: { method: 'password', reason: 'default_password_remote' } });
    return res.status(403).json({ error: 'default password only allowed from the local network; change it first' });
  }
  attempts.delete(key);
  startSession(req, { email: 'admin', name: 'Admin', picture: '', method: 'password' });
  logActivity('auth.login', { req, data: { method: 'password' } });
  res.json({ user: sessionUser(req.session.user) });
}

export function logoutHandler(req, res) {
  if (sessionValid(req)) logActivity('auth.logout', { req });
  const sid = typeof req.session?.sid === 'string' ? req.session.sid : null;
  req.session = null;
  if (sid) authEvents.emit('logout', sid);
  res.json({ ok: true });
}

/** Revoke all sessions (including this one). */
export function logoutAllHandler(req, res) {
  if (!sessionValid(req)) return res.status(401).json({ error: 'unauthorized' });
  logActivity('auth.logout_all', { req, level: 'warn' });
  rotateSessionEpoch();
  req.session = null;
  res.json({ ok: true });
}

export function meHandler(req, res) {
  const valid = sessionValid(req);
  if (!valid && req.session?.user) req.session = null;
  const sec = getSecrets();
  res.json({
    user: valid ? sessionUser(req.session.user) : null,
    needsSetup: needsSetup(),
    mustChangePassword: Boolean(valid && req.session.user.method === 'password' && sec.passwordIsDefault),
    // Initial password came from ADMIN_PASSWORD (headless/Docker install): the panel offers to change it.
    passwordFromEnv: Boolean(valid && sec.passwordFromEnv),
    googleConfigured: google.googleConfigured(),
    // Sign in with Google (off by default on self-hosted, see google.googleLoginEnabled)
    googleLoginEnabled: google.googleLoginEnabled(getConfig()),
    // Microsoft calendars with the server's own Entra app (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET).
    microsoftConfigured: microsoft.microsoftConfigured(),
    passwordLoginEnabled: getConfig().auth.passwordLoginEnabled,
  });
}

export async function changePasswordHandler(req, res) {
  const { current, next } = req.body || {};
  const problem = passwordProblem(next);
  if (problem) return res.status(400).json({ error: PASSWORD_MESSAGES[problem], code: problem });
  const s = getSecrets();
  if (!(await verifyPassword(current, s.passwordHash))) {
    logActivity('auth.login_failed', { req, level: 'warn', data: { method: 'password', reason: 'password_change_wrong_current' } });
    return res.status(401).json({ error: 'current password incorrect' });
  }
  const h = await hashPassword(next);
  updateSecrets((x) => { x.passwordHash = h; x.passwordIsDefault = false; delete x.passwordFromEnv; });
  // Revoke every other session; keep the current one alive with the new epoch.
  req.session.epoch = rotateSessionEpoch();
  logActivity('auth.password_changed', { req, level: 'warn' });
  res.json({ ok: true });
}

function oauthRedirect(req, res, purpose) {
  if (!google.googleConfigured()) return res.redirect('/admin/?error=google_not_configured');
  if (purpose === 'connect' && !sessionValid(req)) return res.redirect('/admin/?error=login_required');
  const nonce = google.newNonce();
  req.session.oauthNonce = nonce;
  // The purpose is kept in the session: the one in `state` comes back from the browser and is only compared.
  req.session.oauthPurpose = purpose;
  res.redirect(google.authUrl(req, purpose, nonce));
}

export const googleLoginHandler = (req, res) =>
  google.googleLoginEnabled(getConfig()) ? oauthRedirect(req, res, 'login') : res.redirect('/admin/?error=google_login_off');
export const googleConnectHandler = (req, res) => oauthRedirect(req, res, 'connect');

/** OAuth error codes Google may send back (RFC 6749 §4.1.2.1 + Google's own); anything else → google_error. */
const GOOGLE_ERRORS = new Set(['access_denied', 'admin_policy_enforced', 'disallowed_useragent', 'org_internal', 'invalid_request',
  'unauthorized_client', 'invalid_scope', 'server_error', 'temporarily_unavailable', 'consent_required', 'interaction_required']);

export async function googleCallbackHandler(req, res) {
  const fail = (code, email = null) => {
    logActivity('auth.login_failed', { req, actor: email || 'anonymous', level: 'warn', data: { method: 'google', reason: code } });
    return res.redirect(`/admin/?error=${encodeURIComponent(code)}`);
  };
  // Failures before a code exchange can be triggered by anyone (public URL): throttle their log entries.
  const failEarly = (code) => {
    logActivityThrottled('auth.login_failed', `google|${req.ip}|${code}`, { everyMs: 60_000, perMinute: 10 },
      { req, actor: 'anonymous', level: 'warn', data: { method: 'google', reason: code } });
    return res.redirect(`/admin/?error=${encodeURIComponent(code)}`);
  };
  if (!google.googleConfigured()) return res.redirect('/admin/?error=google_not_configured');
  const state = google.parseState(req.query.state);
  const nonce = req.session?.oauthNonce;
  const purpose = req.session?.oauthPurpose;
  if (req.session) { delete req.session.oauthNonce; delete req.session.oauthPurpose; }
  if (req.query.error) {
    const e = String(req.query.error);
    return failEarly(GOOGLE_ERRORS.has(e) ? `google_${e}` : 'google_error');
  }
  if (!state || !nonce || state.n.length !== nonce.length || !crypto.timingSafeEqual(Buffer.from(state.n), Buffer.from(nonce))
    || !purpose || state.p !== purpose) {
    return failEarly('invalid_state');
  }
  if (typeof req.query.code !== 'string') return failEarly('missing_code');
  let result;
  try {
    result = await google.exchangeCode(req, req.query.code);
  } catch (err) {
    console.warn('[auth] google exchange failed:', err.message);
    return fail('google_exchange_failed');
  }
  const { profile, tokens } = result;

  if (purpose === 'connect') {
    if (!sessionValid(req)) return fail('login_required');
    if (!tokens.refresh_token && !getSecrets().google.accounts[profile.email]?.refresh_token) return fail('no_refresh_token');
    if (!String(tokens.scope || '').includes(google.CAL_SCOPE)) return fail('calendar_scope_denied');
    google.storeAccount(profile, tokens);
    logActivity('google.connected', { req, data: { email: profile.email } });
    return res.redirect(`/admin/?connected=${encodeURIComponent(profile.email)}`);
  }

  // login
  if (!google.googleLoginEnabled(getConfig())) return fail('google_login_off', profile.email);
  const allowed = getConfig().auth.allowedGoogleEmails;
  if (!allowed.includes(profile.email)) {
    if (allowed.length === 0 && sessionValid(req) && req.session.user.method === 'password') {
      updateConfig((c) => { c.auth.allowedGoogleEmails = [profile.email]; }, { reason: 'server', req });
    } else {
      return fail('email_not_allowed', profile.email);
    }
  }
  startSession(req, { email: profile.email, name: profile.name, picture: profile.picture, method: 'google' });
  logActivity('auth.login', { req, data: { method: 'google' } });
  res.redirect('/admin/');
}

// --- Microsoft calendars (server/microsoft.js) ---

const MS_BACK = '#/calendars/cal-accounts';

/** GET /auth/microsoft/connect: a signed in admin goes to Microsoft (PKCE, state in the session). */
export function microsoftConnectHandler(req, res) {
  if (!microsoft.microsoftConfigured()) return res.redirect(`/admin/?error=microsoft_not_configured${MS_BACK}`);
  if (!sessionValid(req)) return res.redirect('/admin/?error=login_required');
  const lang = ['es', 'en', 'pt', 'nl'].includes(getConfig().screens?.[0]?.screen?.language) ? getConfig().screens[0].screen.language : '';
  res.redirect(microsoft.startConnect(req, lang));
}

/** GET /auth/microsoft/callback: the redirect URI registered in the Entra app (PUBLIC_URL + this path). */
export async function microsoftCallbackHandler(req, res) {
  const back = (q) => res.redirect(`/admin/?${q}${MS_BACK}`);
  const failEarly = (code) => {
    logActivityThrottled('auth.login_failed', `microsoft|${req.ip}|${code}`, { everyMs: 60_000, perMinute: 10 },
      { req, actor: 'anonymous', level: 'warn', data: { method: 'microsoft', reason: code } });
    return back(`error=${encodeURIComponent(code)}`);
  };
  if (!microsoft.microsoftConfigured()) return back('error=microsoft_not_configured');
  const pendingConnect = microsoft.takeConnect(req, req.query.state);
  if (req.query.error) {
    const e = String(req.query.error);
    return failEarly(microsoft.MICROSOFT_OAUTH_ERRORS.has(e) ? `microsoft_${e}` : 'microsoft_error');
  }
  if (!pendingConnect) return failEarly('microsoft_invalid_state');
  if (!sessionValid(req)) return back('error=login_required');
  if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) return failEarly('microsoft_missing_code');
  let result;
  try {
    result = await microsoft.exchangeCode(req, req.query.code, pendingConnect.verifier);
  } catch (err) {
    const known = { scope_denied: 'microsoft_scope_denied', no_refresh_token: 'microsoft_no_refresh_token', no_email: 'microsoft_no_email' };
    console.warn('[auth] microsoft connect failed:', err.code || err.status || 'error');
    return back(`error=${known[err.code] || 'microsoft_exchange_failed'}`);
  }
  microsoft.storeAccount(result.email, result.tokens);
  logActivity('microsoft.connected', { req, data: { email: result.email } });
  return back(`microsoft=${encodeURIComponent(result.email)}`);
}
