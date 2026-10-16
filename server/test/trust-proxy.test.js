// TRUST_PROXY: a value Express cannot read stops the server with one clear paragraph, not a stack trace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkTrustProxy, trustProxyValue } from '../lib/trustProxy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('TRUST_PROXY: the accepted forms', () => {
  assert.equal(trustProxyValue(''), 'loopback');
  assert.equal(trustProxyValue(undefined), 'loopback');
  assert.equal(trustProxyValue(' true '), true);
  assert.equal(trustProxyValue('2'), 2);
  assert.deepEqual(trustProxyValue('10.0.0.1, 172.16.0.0/12'), ['10.0.0.1', '172.16.0.0/12']);
  for (const ok of ['', 'loopback', '172.16.0.0/12', '192.0.2.10', '192.0.2.10,loopback', 'uniquelocal, linklocal', '1', 'true', '::1', 'fd00::/8']) {
    assert.equal(checkTrustProxy(ok).ok, true, ok);
  }
});

test('TRUST_PROXY: a bad value gets a message naming it, the forms and the compose hint', () => {
  const r = checkTrustProxy('$ { TRUST_PROXY:-}');
  assert.equal(r.ok, false);
  assert.match(r.message, /"\$ \{ TRUST_PROXY:-\}"/);
  assert.match(r.message, /172\.16\.0\.0\/12/);
  assert.match(r.message, /comma-separated/);
  assert.match(r.message, /loopback/);
  assert.match(r.message, /number of proxy hops/);
  assert.match(r.message, /true/);
  assert.match(r.message, /\$\{TRUST_PROXY:-172\.16\.0\.0\/12\}/);
  assert.match(r.message, /docker-compose/);
  assert.doesNotMatch(r.message, /\n/);
  const plain = checkTrustProxy('my-proxy');
  assert.equal(plain.ok, false);
  assert.match(plain.message, /"my-proxy"/);
  assert.doesNotMatch(plain.message, /still contains the variable syntax/);
});

test('TRUST_PROXY: the server stops at start with the message and no stack trace', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-trust-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'server/index.js')], {
      cwd: data,
      env: { PATH: process.env.PATH, DATA_DIR: data, PORT: '0', TRUST_PROXY: '$ { TRUST_PROXY:-}' },
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /TRUST_PROXY is set to "\$ \{ TRUST_PROXY:-\}"/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
    // nothing was written: it stopped before the store started
    assert.deepEqual(fs.readdirSync(data), []);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
