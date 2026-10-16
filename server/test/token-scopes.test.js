// API token scopes: a token made before scopes existed (no field) keeps every route it had, '*' covers everything but
// 'screen', each hook route needs its scope (403 { error: 'scope' } otherwise, logged as a rejection), /ping needs
// none, the admin creates tokens with scopes and changes them later, and bad scope lists are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import * as store from '../store.js';
import { createToken, listTokens, setTokenScopes, findToken, _resetTokenState } from '../tokens.js';
import { hooksRouter } from '../routes/hooks.js';
import { hasScope, parseScopes, tokenScopes, TOKEN_SCOPES } from '../core/valuesCore.js';
import { listActivity } from '../activity.js';
import { _resetAnnouncements } from '../announce.js';
import { _resetDisplays } from '../displays.js';
import { _resetValues } from '../values.js';
import { closeAll } from '../sse.js';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-scopes-'));
  store.initStore(dir);
  _resetTokenState();
  _resetAnnouncements();
  _resetDisplays();
  _resetValues();
  return dir;
}

async function withHooks(fn) {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/hooks', hooksRouter());
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/hooks`;
  try {
    await fn(async (token, method, url, body) => {
      const r = await fetch(base + url, {
        method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    });
  } finally {
    closeAll();
    await new Promise((r) => server.close(r));
  }
}

/** Every hook route with the scope it needs and a body that passes its checks. */
const ROUTES = [
  ['announce', 'POST', '/announce', { title: 'Hola' }],
  ['commands', 'POST', '/reload', {}],
  ['commands', 'POST', '/night', { mode: 'auto' }],
  ['privacy', 'GET', '/privacy'],
  ['privacy', 'POST', '/privacy', { mode: 'off' }],
  ['doorbell', 'POST', '/doorbell', { action: 'dismiss' }],
  ['values', 'POST', '/values', { values: [{ key: 'a', value: 1 }] }],
  ['values', 'GET', '/values'],
];

test('scope rules: missing means *, * covers all but screen, parse refuses typos and empty lists', () => {
  assert.deepEqual(tokenScopes(undefined), ['*']);
  assert.deepEqual(tokenScopes(null), ['*']);
  assert.deepEqual(tokenScopes('values'), ['values']);
  // a stored list that names nothing this version knows (a newer version's scope after a downgrade, a hand edit)
  // allows nothing: it never widens to everything
  assert.deepEqual(tokenScopes([]), []);
  assert.deepEqual(tokenScopes(['lights']), []);
  assert.deepEqual(tokenScopes('lights'), []);
  for (const s of TOKEN_SCOPES) {
    assert.equal(hasScope([], s), false, s);
    assert.equal(hasScope(['lights'], s), false, s);
  }
  assert.deepEqual(tokenScopes(['values', 'nope', 'announce']), ['announce', 'values']);
  for (const s of TOKEN_SCOPES) assert.equal(hasScope(undefined, s), s !== 'screen', s);
  assert.equal(hasScope(['*', 'screen'], 'screen'), true);
  assert.equal(hasScope(['values'], 'announce'), false);
  assert.equal(hasScope(['values'], 'values'), true);
  assert.deepEqual(parseScopes(undefined), { scopes: ['*'] });
  assert.deepEqual(parseScopes(['values', 'values']), { scopes: ['values'] });
  for (const bad of [[], 'values', ['valeus'], [1], Array(11).fill('values')]) assert.ok(parseScopes(bad).error, JSON.stringify(bad));
});

test('an old token (no scopes field) keeps every route; a values-only token gets 403 scope elsewhere', async () => {
  const dir = setup();
  const old = createToken('Old');
  // as secrets.json had it before scopes existed
  store.updateSecrets((s) => { delete s.apiTokens.find((t) => t.id === old.info.id).scopes; });
  assert.equal(findToken(old.token).scopes, undefined);
  assert.deepEqual(listTokens().find((t) => t.id === old.info.id).scopes, ['*']);
  const only = createToken('Valores', { scopes: ['values'] });
  assert.deepEqual(only.info.scopes, ['values']);
  const all = createToken('Todo');
  assert.deepEqual(all.info.scopes, ['*']);
  await withHooks(async (call) => {
    for (const [scope, method, url, body] of ROUTES) {
      let r = await call(old.token, method, url, body);
      assert.ok(r.status < 400, `${url} with an old token: ${r.status} ${JSON.stringify(r.json)}`);
      r = await call(only.token, method, url, body);
      if (scope === 'values') assert.ok(r.status < 400, `${url}: ${r.status}`);
      else assert.deepEqual([r.status, r.json], [403, { error: 'scope', scope }], url);
    }
    // /ping needs no scope
    assert.equal((await call(only.token, 'GET', '/ping')).status, 200);
  });
  assert.ok(listActivity({ type: 'token.rejected' }).items.some((e) => e.data.reason === 'scope'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a stored token whose scopes this version does not know may use no route (never everything)', async () => {
  const dir = setup();
  const odd = createToken('Newer');
  const none = createToken('Empty');
  // a scope of a newer version (kept after a downgrade or a restore), and a list emptied by hand
  store.updateSecrets((s) => {
    s.apiTokens.find((t) => t.id === odd.info.id).scopes = ['lights'];
    s.apiTokens.find((t) => t.id === none.info.id).scopes = [];
  });
  assert.deepEqual(listTokens().find((t) => t.id === odd.info.id).scopes, []);
  await withHooks(async (call) => {
    for (const tk of [odd.token, none.token]) {
      for (const [scope, method, url, body] of ROUTES) {
        const r = await call(tk, method, url, body);
        assert.deepEqual([r.status, r.json], [403, { error: 'scope', scope }], url);
      }
      assert.equal((await call(tk, 'GET', '/ping')).status, 200);
    }
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scopes: created with them, changed later, refused when unknown; activity lines carry them', () => {
  const dir = setup();
  assert.equal(createToken('x', { scopes: ['everything'] }).status, 400);
  assert.equal(createToken('x', { scopes: [] }).status, 400);
  const t = createToken('HA', { scopes: ['announce', 'values'] });
  assert.deepEqual(t.info.scopes, ['announce', 'values']);
  assert.deepEqual(setTokenScopes(t.info.id, ['*', 'screen']).info.scopes, ['*', 'screen']);
  assert.equal(hasScope(findToken(t.token).scopes, 'screen'), true);
  assert.equal(setTokenScopes(t.info.id, ['bogus']).status, 400);
  assert.equal(setTokenScopes('tk_missing', ['values']).status, 404);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
  assert.deepEqual(disk.apiTokens[0].scopes, ['*', 'screen']);
  assert.deepEqual(listActivity({ type: 'token.scopes' }).items[0].data.scopes, ['*', 'screen']);
  assert.deepEqual(listActivity({ type: 'token.created' }).items[0].data.scopes, ['announce', 'values']);
  fs.rmSync(dir, { recursive: true, force: true });
});
