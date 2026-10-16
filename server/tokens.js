// API tokens for the webhook API (/api/hooks/*). See docs/API.md and docs/ARCHITECTURE.md.
// Tokens are `cs_` + base64url(24 random bytes); only sha256(token) hex + an 8-char prefix are stored
// (secrets.apiTokens). The full token is returned once, on creation.
import crypto from 'node:crypto';
import { getSecrets, updateSecrets, flushSecrets } from './store.js';
import { logActivity } from './activity.js';
import { parseScopes, tokenScopes } from './core/valuesCore.js';

export const MAX_TOKENS = 20;
export const RATE_LIMIT = 30; // requests per minute per token
const RATE_WINDOW_MS = 60_000;
const USAGE_FLUSH_MS = 60_000; // secrets.json written at most once per minute for usage counters
const USED_LOG_MS = 10 * 60_000; // token.used logged once per token+endpoint per 10 min
const REJECT_LOG_MS = 60_000; // token.rejected logged once per ip per minute
const TOKEN_RE = /^cs_[A-Za-z0-9_-]{32}$/;

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const info = (t) => ({
  id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt,
  lastUsedAt: t.lastUsedAt ?? null, lastUsedIp: t.lastUsedIp ?? null, useCount: t.useCount || 0,
  // a token made before scopes existed has no field: it keeps doing everything it did ('*')
  scopes: tokenScopes(t.scopes),
});

/** ApiTokenInfo[] (no hashes), newest first. */
export function listTokens() {
  return getSecrets().apiTokens.map(info).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Create a token. Returns { token, info } or { error, status }.
 * @param {string} name 1..60 chars
 * @param {{ req?: object, scopes?: string[] }} [opts] scopes: core/valuesCore.js TOKEN_SCOPES or '*' (the default)
 */
export function createToken(name, { req, scopes } = {}) {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  if (!n || n.length > 60) return { error: 'name must be 1-60 characters', status: 400 };
  const sc = parseScopes(scopes);
  if (sc.error) return { error: sc.error, status: 400 };
  if (getSecrets().apiTokens.length >= MAX_TOKENS) return { error: `max ${MAX_TOKENS} tokens`, status: 409 };
  const token = `cs_${crypto.randomBytes(24).toString('base64url')}`;
  const t = {
    id: `tk_${crypto.randomBytes(6).toString('hex')}`,
    name: n,
    hash: hashToken(token),
    prefix: token.slice(0, 8),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    lastUsedIp: null,
    useCount: 0,
    scopes: sc.scopes,
  };
  updateSecrets((s) => { s.apiTokens.push(t); });
  logActivity('token.created', { req, data: { id: t.id, name: t.name, prefix: t.prefix, scopes: t.scopes } });
  return { token, info: info(t) };
}

/** Change what a token may do. Returns { info } or { error, status }. */
export function setTokenScopes(id, scopes, { req } = {}) {
  const t = getSecrets().apiTokens.find((x) => x.id === id);
  if (!t) return { error: 'not found', status: 404 };
  const sc = parseScopes(scopes);
  if (sc.error) return { error: sc.error, status: 400 };
  updateSecrets((s) => {
    const x = s.apiTokens.find((y) => y.id === id);
    if (x) x.scopes = sc.scopes;
  });
  logActivity('token.scopes', { req, data: { id: t.id, name: t.name, prefix: t.prefix, scopes: sc.scopes } });
  return { info: info(getSecrets().apiTokens.find((x) => x.id === id)) };
}

/** Revoke a token by id. Returns true when it existed. */
export function revokeToken(id, { req } = {}) {
  const t = getSecrets().apiTokens.find((x) => x.id === id);
  if (!t) return false;
  updateSecrets((s) => { s.apiTokens = s.apiTokens.filter((x) => x.id !== id); });
  rate.delete(id);
  logActivity('token.revoked', { req, data: { id: t.id, name: t.name, prefix: t.prefix } });
  return true;
}

/** Find the stored token for a presented bearer token (constant-time compare of the hashes). */
export function findToken(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const h = Buffer.from(hashToken(token), 'hex');
  let hit = null;
  for (const t of getSecrets().apiTokens) {
    const stored = /^[a-f0-9]{64}$/.test(t.hash || '') ? Buffer.from(t.hash, 'hex') : null;
    if (stored && crypto.timingSafeEqual(stored, h)) hit = t;
  }
  return hit;
}

// ---------- rate limit + usage bookkeeping ----------
const rate = new Map(); // tokenId → number[] (request times in the last minute)
const usedLogged = new Map(); // `${tokenId}|${endpoint}` → ms
const rejectLogged = new Map(); // ip → ms
let usageDirty = false;
let lastUsageFlush = 0;
let usageTimer = null;

/** Sliding-window limiter. Returns { ok, retryAfterSec }. */
export function checkRate(tokenId, now = Date.now()) {
  const list = (rate.get(tokenId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_LIMIT) {
    rate.set(tokenId, list);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + RATE_WINDOW_MS - now) / 1000)) };
  }
  list.push(now);
  rate.set(tokenId, list);
  if (rate.size > 200) for (const [k, v] of rate) if (!v.length || now - v[v.length - 1] > RATE_WINDOW_MS) rate.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

function flushUsage() {
  if (usageTimer) clearTimeout(usageTimer);
  usageTimer = null;
  if (!usageDirty) return;
  usageDirty = false;
  lastUsageFlush = Date.now();
  try { flushSecrets(); } catch (err) { console.warn('[tokens] usage save failed:', err.message); }
}

/** Record a successful use (counters in memory; secrets.json written at most once per minute). */
export function recordUse(t, { ip, endpoint, req }, now = Date.now()) {
  t.lastUsedAt = new Date(now).toISOString();
  t.lastUsedIp = ip ? String(ip).slice(0, 64) : null;
  t.useCount = (t.useCount || 0) + 1;
  usageDirty = true;
  if (now - lastUsageFlush >= USAGE_FLUSH_MS) flushUsage();
  else if (!usageTimer) {
    usageTimer = setTimeout(flushUsage, USAGE_FLUSH_MS - (now - lastUsageFlush));
    usageTimer.unref?.();
  }
  const key = `${t.id}|${endpoint}`;
  if (now - (usedLogged.get(key) || 0) >= USED_LOG_MS) {
    usedLogged.set(key, now);
    logActivity('token.used', { req, actor: `token:${t.name}`, ip, data: { id: t.id, name: t.name, endpoint } });
  }
}

/** Log a rejected request (throttled to once per minute per ip). */
export function recordRejection({ ip, endpoint, reason }, now = Date.now()) {
  const k = String(ip || '');
  if (now - (rejectLogged.get(k) || 0) < REJECT_LOG_MS) return false;
  rejectLogged.set(k, now);
  if (rejectLogged.size > 500) for (const [x, t] of rejectLogged) if (now - t > REJECT_LOG_MS) rejectLogged.delete(x);
  logActivity('token.rejected', { actor: 'anonymous', ip: ip || null, level: 'warn', data: { endpoint, reason } });
  return true;
}

/** Flush pending usage counters (shutdown). */
export const flushTokenUsage = () => flushUsage();

export function _resetTokenState() {
  rate.clear();
  usedLogged.clear();
  rejectLogged.clear();
  if (usageTimer) clearTimeout(usageTimer);
  usageTimer = null;
  usageDirty = false;
  lastUsageFlush = 0;
}
