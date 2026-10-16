// TRUST_PROXY: which reverse proxies the server believes about the client address (Express "trust proxy").
// The value is read once at start and checked with Express's own parser (proxy-addr), so a typo stops the server
// with a message that says what was read and what would work, instead of a stack trace ("invalid IP address").
import express from 'express';

/** The Express "trust proxy" value for a TRUST_PROXY string (empty: loopback). */
export function trustProxyValue(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return 'loopback';
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}

/** The message shown when TRUST_PROXY cannot be used (one paragraph, no stack trace). */
export function trustProxyMessage(raw, reason = '') {
  const v = String(raw ?? '');
  const broken = v.includes('$');
  return [
    `TRUST_PROXY is set to ${JSON.stringify(v)}, which Marco cannot use${reason ? ` (${reason})` : ''}.`,
    'It accepts an IP address (192.0.2.10), a CIDR range such as 172.16.0.0/12, a comma-separated list of those,',
    'the words loopback, linklocal or uniquelocal, a number of proxy hops (1), or true to trust every proxy.',
    'Leave it empty to trust only this machine.',
    broken
      ? 'The value still contains the variable syntax of docker-compose, so that line is probably written wrong: it should look like ${TRUST_PROXY:-172.16.0.0/12}, with no spaces around the $ and the braces.'
      : 'If you set it in docker-compose.yml, check that the line looks like ${TRUST_PROXY:-172.16.0.0/12}.',
  ].join(' ');
}

/**
 * Check a TRUST_PROXY string the way Express will read it.
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
export function checkTrustProxy(raw) {
  const value = trustProxyValue(raw);
  try {
    express().set('trust proxy', value);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, message: trustProxyMessage(raw, err?.message || '') };
  }
}
