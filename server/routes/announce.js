// instant announcements + API tokens (admin side). See docs/API.md and docs/ARCHITECTURE.md.
// Mounted at /api/admin (session required):
//   POST   /announce              → { ok, announcement, delivered }
//   GET    /announcements         → { active, history }
//   DELETE /announcements/:id     → { ok }      DELETE /announcements → { ok, cleared }
//   GET    /tokens  POST /tokens  DELETE /tokens/:id   (API tokens, §5.4)
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getConfig } from '../store.js';
import { sanitizeAnnounce, createAnnouncement, listAnnouncements, clearAnnouncements } from '../announce.js';
import { resolveScreenList } from '../displays.js';
import { listTokens, createToken, revokeToken, setTokenScopes } from '../tokens.js';
import { logActivity, actorFrom } from '../activity.js';

/**
 * Shared by the admin route and the webhook: validate, create, broadcast, log. Returns [status, body].
 * @param {any} req Express request (body = AnnounceRequest)
 * @param {'admin'|'hook'} via
 */
export function handleAnnounce(req, via) {
  const cfg = getConfig();
  const v = sanitizeAnnounce(req.body, (keys) => resolveScreenList(cfg, keys));
  if (!v.ok) return [400, { error: v.error, details: v.details }];
  const { actor } = actorFrom(req);
  const { announcement, delivered } = createAnnouncement(v.value, { via, by: actor });
  const slugs = announcement.screenIds.map((id) => cfg.screens.find((s) => s.id === id)?.slug || id);
  logActivity('announce.sent', {
    req,
    data: { id: announcement.id, title: announcement.title || announcement.body.slice(0, 60), style: announcement.style, screens: slugs, via, delivered },
  });
  return [200, { ok: true, announcement, delivered }];
}

export function announceRouter() {
  const r = Router();
  r.use(requireAuth);
  r.use((req, res, next) => { res.set('cache-control', 'no-store'); next(); });

  r.post('/announce', (req, res) => {
    const [status, body] = handleAnnounce(req, 'admin');
    res.status(status).json(body);
  });

  r.get('/announcements', (req, res) => res.json(listAnnouncements()));

  r.delete('/announcements/:id', (req, res) => {
    const cleared = clearAnnouncements(String(req.params.id));
    if (!cleared.length) return res.status(404).json({ error: 'not found' });
    logActivity('announce.cleared', { req, data: { id: cleared[0].id, title: cleared[0].title } });
    res.json({ ok: true });
  });

  r.delete('/announcements', (req, res) => {
    const cleared = clearAnnouncements(null);
    if (cleared.length) logActivity('announce.cleared', { req, data: { id: null, count: cleared.length } });
    res.json({ ok: true, cleared: cleared.length });
  });

  // ---- API tokens ----
  r.get('/tokens', (req, res) => res.json(listTokens()));

  r.post('/tokens', (req, res) => {
    const out = createToken(req.body?.name, { req, scopes: req.body?.scopes });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json(out);
  });

  // what a token may do (core/valuesCore.js TOKEN_SCOPES); its secret stays the same
  r.patch('/tokens/:id', (req, res) => {
    const out = setTokenScopes(String(req.params.id), req.body?.scopes, { req });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.json(out.info);
  });

  r.delete('/tokens/:id', (req, res) => {
    if (!revokeToken(String(req.params.id), { req })) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  return r;
}
