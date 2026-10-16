// Pushed values for the Valor card (docs/API.md, server/values.js):
//   valuesHooks(r) on the hooks router (bearer token with the `values` scope):
//     POST   /values       { values: [{ key, value, unit?, label? }] } → { ok, stored, waiting }
//     GET    /values       → { values: [{ key, value, unit?, label?, updatedAt, screens }] }
//     DELETE /values/:key  → { ok } (its cards show "Sin datos")
//   valuesDisplayRouter() mounted at /api (displayAuth already ran for /api/display):
//     GET /display/values  → { rev, full, screenId, values: { key: { v, u?, l?, at } | null } }: only the keys the
//                            requesting screen shows, nothing while it is private
//   valuesAdminRouter() mounted at /api/admin (session):
//     GET    /values       → the same list as the hook (the builder's key picker, the API page)
//     DELETE /values/:key
import { Router } from 'express';
import { getConfig } from '../store.js';
import { requestScreen } from '../displayAccess.js';
import { requireAuth } from '../auth.js';
import { parseValues } from '../core/valuesCore.js';
import { VALUE_KEY_RE } from '../core/canvasCore.js';
import { deleteValue, listValues, putValues, valuesSnapshot } from '../values.js';

/** The hook routes, added to the hooks router `r` (bearerAuth already ran). */
export function valuesHooks(r, { scope, jsonOnly }) {
  r.post('/values', scope, jsonOnly, (req, res) => {
    // the body is parsed with an 8 KB limit (app.js): a bigger one is a 413 before this
    const parsed = parseValues(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const out = putValues(parsed.values, { by: `token:${req.apiToken.name}` });
    if (out.error) return res.status(out.status).json({ error: out.error });
    // no activity line of its own: token.used already notes the endpoint (once per 10 minutes)
    res.json(out);
  });
  r.get('/values', scope, (req, res) => res.json({ values: listValues() }));
  r.delete('/values/:key', scope, (req, res) => {
    const key = String(req.params.key || '');
    if (!VALUE_KEY_RE.test(key)) return res.status(400).json({ error: 'invalid key' });
    if (!deleteValue(key)) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });
}

export function valuesDisplayRouter() {
  const r = Router();
  r.get('/display/values', (req, res) => {
    res.set('cache-control', 'no-store');
    const cfg = getConfig();
    const { screen } = requestScreen(cfg, req);
    res.json(valuesSnapshot(cfg, screen));
  });
  return r;
}

export function valuesAdminRouter() {
  const r = Router();
  r.use('/values', requireAuth);
  r.get('/values', (req, res) => {
    res.set('cache-control', 'no-store');
    res.json({ values: listValues() });
  });
  r.delete('/values/:key', (req, res) => {
    const key = String(req.params.key || '');
    if (!VALUE_KEY_RE.test(key)) return res.status(400).json({ error: 'invalid key' });
    if (!deleteValue(key)) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });
  return r;
}
