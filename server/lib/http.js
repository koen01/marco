// Outbound HTTP helper: 15 s timeout everywhere, optional "insecure TLS" mode for self-signed hosts.
//
// Node's global fetch (undici) does not expose a per-request TLS agent without the `undici` package,
// which is not installed (we avoid extra deps on the Pi). When `insecureTls` is set we fall back to
// node:https with `rejectUnauthorized: false` for that request only. Redirects are followed (max 5), unless the
// caller passes `redirect: 'error'` (every Home Assistant call does: a redirect would carry the bearer token to
// another host), on both paths.
//
// SSRF: URLs configured in the admin (calendars, RSS, Home Assistant) are fetched from the server, on purpose
// including LAN addresses (Nextcloud, Home Assistant…). Unauthenticated callers (the setup wizard's test button)
// use `guard: true`: loopback, link-local/cloud-metadata, multicast and unspecified destinations are refused on
// every redirect hop (checked on the resolved address, at connect time) and errors are generic.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import { blockedFetchAddress, blockedFetchHost } from './net.js';

export const DEFAULT_TIMEOUT = 15_000;
export const MAX_BODY = 10 * 1024 * 1024; // 10 MB response cap
export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const blockedError = () => Object.assign(new HttpError('Address not allowed', 0), { blocked: true });
/** A redirect the caller asked not to follow (`redirect: 'error'`). */
const redirectError = (status) => Object.assign(new HttpError('Redirect not allowed (use the final URL)', status || 0), { redirect: true });

/** dns.lookup that refuses blocked addresses (used as the socket's lookup, so there is no check/use race). */
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => blockedFetchAddress(a.address))) {
      return cb(Object.assign(new Error('Address not allowed'), { code: 'EBLOCKED' }));
    }
    if (options?.all) cb(null, addrs);
    else cb(null, addrs[0].address, addrs[0].family);
  });
}

/** Normalise webcal:// links to https:// */
export function normalizeUrl(url) {
  return String(url || '').trim().replace(/^webcals?:\/\//i, 'https://');
}

/**
 * Minimal fetch wrapper. Returns { status, ok, headers, text }.
 * Throws HttpError on network error/timeout; non-2xx does not throw unless `throwOnError`.
 */
export async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body, timeout = DEFAULT_TIMEOUT, insecureTls = false, throwOnError = true, guard = false } = opts;
  const noRedirect = opts.redirect === 'error';
  url = normalizeUrl(url);
  let res;
  if (guard) {
    try {
      res = await nodeRequest(url, { method, headers, body, timeout, insecure: false, guard: true, noRedirect, deadline: Date.now() + timeout });
    } catch (err) {
      throw err?.blocked ? blockedError() : err?.redirect ? err : new HttpError(/^Timeout/.test(err?.message) ? err.message : 'Could not connect', 0);
    }
  } else if (insecureTls && url.startsWith('https:')) {
    res = await nodeRequest(url, { method, headers, body, timeout, insecure: true, noRedirect, deadline: Date.now() + timeout });
  } else {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      // 'manual': the redirect answer itself comes back (never followed) and is refused below
      const r = await fetch(url, { method, headers, body, signal: ctrl.signal, redirect: noRedirect ? 'manual' : 'follow' });
      if (noRedirect && (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400))) {
        r.body?.cancel().catch(() => {});
        throw redirectError(r.status);
      }
      const text = await readCapped(r);
      res = { status: r.status, ok: r.ok, headers: Object.fromEntries(r.headers), text };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const msg = err.name === 'AbortError' ? `Timeout (${timeout / 1000}s)` : describeNetError(err);
      throw new HttpError(msg, 0);
    } finally {
      clearTimeout(timer);
    }
  }
  if (throwOnError && !res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
  return res;
}

export async function requestJson(url, opts = {}) {
  const res = await request(url, opts);
  try {
    return JSON.parse(res.text);
  } catch {
    throw new HttpError('Invalid JSON response', res.status);
  }
}

async function readCapped(r) {
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError('Response too large', r.status);
  if (!r.body) return '';
  const reader = r.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      reader.cancel().catch(() => {});
      throw new HttpError('Response too large', r.status);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
}

function describeNetError(err) {
  const c = err.cause;
  if (c?.code) {
    if (c.code === 'ENOTFOUND' || c.code === 'EAI_AGAIN') return `Host not found (${c.hostname || c.code})`;
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c.code)) return `TLS certificate error (${c.code}); try insecureTls`;
    return `${c.code}${c.message ? ': ' + c.message : ''}`;
  }
  return err.message || String(err);
}

function nodeRequest(url, { method, headers, body, timeout, insecure, guard = false, noRedirect = false, deadline }, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (guard && (!['http:', 'https:'].includes(u.protocol) || blockedFetchHost(u.hostname))) return reject(blockedError());
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new HttpError(`Timeout (${timeout / 1000}s)`, 0));
    let settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    // Overall deadline (the socket `timeout` below is only an idle timeout).
    const timer = setTimeout(() => {
      const e = new HttpError(`Timeout (${timeout / 1000}s)`, 0);
      req.destroy(e);
      done(reject, e);
    }, remaining);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      u,
      {
        method,
        headers: { 'accept-encoding': 'identity', ...headers },
        rejectUnauthorized: !insecure,
        timeout,
        ...(guard ? { lookup: guardedLookup } : {}),
      },
      (res) => {
        if (noRedirect && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          const e = redirectError(res.statusCode);
          req.destroy();
          done(reject, e);
          return;
        }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          const next = new URL(res.headers.location, u).toString();
          done(resolve, nodeRequest(next, { method: 'GET', headers, timeout, insecure, guard, deadline }, redirects + 1));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) {
            const e = new HttpError('Response too large', res.statusCode);
            req.destroy(e);
            done(reject, e);
            return;
          }
          chunks.push(c);
        });
        res.on('end', () =>
          done(resolve, {
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', (e) => done(reject, e instanceof HttpError ? e : new HttpError(e.message, 0)));
      },
    );
    req.on('timeout', () => req.destroy(new HttpError(`Timeout (${timeout / 1000}s)`, 0)));
    req.on('error', (e) => done(reject, e instanceof HttpError ? e
      : e.code === 'EBLOCKED' ? blockedError() : new HttpError(describeNetError({ cause: e, message: e.message }), 0)));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Binary-safe request for LAN services that answer images as well as JSON (server/immich.js). node:http(s) only,
 * so `insecureTls` can skip the certificate check for this one request. Redirects are not followed (a redirect
 * would carry the API key header to another host). Returns { status, headers, buffer }; throws HttpError on a
 * network error, the timeout or a body over `maxBytes`.
 */
export function requestBuffer(url, { method = 'GET', headers = {}, body, insecureTls = false, maxBytes = MAX_BODY, timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new HttpError('Invalid URL', 0)); }
    if (!['http:', 'https:'].includes(u.protocol)) return reject(new HttpError('Invalid URL', 0));
    let settled = false;
    const done = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => {
      const e = new HttpError(`Timeout (${timeout / 1000}s)`, 0);
      req.destroy(e);
      done(reject, e);
    }, timeout);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, {
      method,
      headers: { 'accept-encoding': 'identity', ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) },
      rejectUnauthorized: !insecureTls,
      timeout,
    }, (res) => {
      const len = Number(res.headers['content-length'] || 0);
      if (len > maxBytes) {
        const e = new HttpError('Response too large', res.statusCode);
        req.destroy(e);
        return done(reject, e);
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          const e = new HttpError('Response too large', res.statusCode);
          req.destroy(e);
          done(reject, e);
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => done(resolve, { status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
      res.on('error', (e) => done(reject, e instanceof HttpError ? e : new HttpError(e.message, 0)));
    });
    req.on('timeout', () => req.destroy(new HttpError(`Timeout (${timeout / 1000}s)`, 0)));
    req.on('error', (e) => done(reject, e instanceof HttpError ? e : new HttpError(describeNetError({ cause: e, message: e.message }), 0)));
    if (body) req.write(body);
    req.end();
  });
}
