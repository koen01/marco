// webhook API for Home Assistant & co. See docs/API.md and docs/ARCHITECTURE.md.
// Mounted at /api/hooks. Auth: `Authorization: Bearer cs_…` only (API tokens, stored hashed in secrets.apiTokens).
//   GET  /ping        → { ok, token }
//   POST /announce    → { ok, announcement, delivered }
//   POST /reload      → { ok, delivered }
//   POST /night       → { ok, delivered }
//   GET  /privacy     → { screens }
//   POST /privacy     → { ok, changed, screens }
//   POST /doorbell    → { ok, action, delivered, screens, expiresAt? }  (routes/doorbell.js)
//   POST /values      → { ok, stored, waiting }                         (routes/values.js)
//   GET  /values      → { values }
//   DELETE /values/:key → { ok }
// Every route but /ping needs its scope on the token (core/valuesCore.js TOKEN_SCOPES): 403 { error: 'scope' }.
import { Router } from 'express';
import { findToken, checkRate, recordUse, recordRejection } from '../tokens.js';
import { handleAnnounce } from './announce.js';
import { runCommand } from '../displays.js';
import { logActivity } from '../activity.js';
import { handlePrivacy, privacyResponse } from '../privacy.js';
import { handleDoorbell } from './doorbell.js';
import { valuesHooks } from './values.js';
import { hasScope } from '../core/valuesCore.js';

/** Bearer-token middleware: 401 (logged, throttled), 429 over 30 req/min, usage bookkeeping. */
export function bearerAuth(req, res, next) {
  res.set('cache-control', 'no-store');
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') || '');
  const endpoint = req.path.replace(/^\/+/, '').slice(0, 40) || '/';
  const t = m ? findToken(m[1]) : null;
  if (!t) {
    recordRejection({ ip: req.ip, endpoint, reason: m ? 'invalid' : 'missing' });
    res.set('www-authenticate', 'Bearer realm="marco"');
    return res.status(401).json({ error: 'unauthorized' });
  }
  const rl = checkRate(t.id);
  if (!rl.ok) {
    res.set('retry-after', String(rl.retryAfterSec));
    return res.status(429).json({ error: 'rate limited', retryAfterSec: rl.retryAfterSec });
  }
  req.apiToken = { id: t.id, name: t.name, scopes: t.scopes };
  recordUse(t, { ip: req.ip, endpoint, req });
  next();
}

/**
 * The token may use routes of `scope` (a token made before scopes existed may use every route it could). After
 * bearerAuth. 403 { error: 'scope', scope } otherwise, logged like a rejected token (throttled per ip).
 */
export function requireScope(scope) {
  return (req, res, next) => {
    if (hasScope(req.apiToken?.scopes, scope)) return next();
    recordRejection({ ip: req.ip, endpoint: req.path.replace(/^\/+/, '').slice(0, 40) || '/', reason: 'scope' });
    res.status(403).json({ error: 'scope', scope });
  };
}

/** JSON body required for POST hooks (an empty body is accepted as {}). */
function jsonOnly(req, res, next) {
  const ct = (req.get('content-type') || '').toLowerCase();
  const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
  if (hasBody && !ct.startsWith('application/json')) return res.status(415).json({ error: 'content-type must be application/json' });
  next();
}

function command(req, res, action) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const out = runCommand({ action, mode: b.mode, screens: b.screens });
  if (out.error) return res.status(out.status || 400).json({ error: out.error, ...(out.unknown ? { unknown: out.unknown } : {}) });
  logActivity('display.command', {
    req,
    data: { action, ...(b.mode ? { mode: b.mode } : {}), ...(out.target.screenIds.length ? { screens: out.target.screenIds } : {}), delivered: out.delivered, via: 'hook' },
  });
  res.json({ ok: true, delivered: out.delivered });
}

export function hooksRouter() {
  const r = Router();
  r.use(bearerAuth);
  r.get('/ping', (req, res) => res.json({ ok: true, token: req.apiToken.name }));
  r.post('/announce', requireScope('announce'), jsonOnly, (req, res) => {
    const [status, body] = handleAnnounce(req, 'hook');
    res.status(status).json(body);
  });
  r.post('/reload', requireScope('commands'), jsonOnly, (req, res) => command(req, res, 'reload'));
  r.post('/night', requireScope('commands'), jsonOnly, (req, res) => command(req, res, 'night'));
  r.get('/privacy', requireScope('privacy'), (req, res) => res.json(privacyResponse()));
  r.post('/privacy', requireScope('privacy'), jsonOnly, (req, res) => {
    const [status, body] = handlePrivacy(req, 'hook');
    res.status(status).json(body);
  });
  r.post('/doorbell', requireScope('doorbell'), jsonOnly, (req, res) => {
    const [status, body] = handleDoorbell(req, 'hook');
    res.status(status).json(body);
  });
  valuesHooks(r, { scope: requireScope('values'), jsonOnly });
  r.use((req, res) => res.status(404).json({ error: 'not found' }));
  return r;
}
