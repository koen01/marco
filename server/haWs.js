// Home Assistant WebSocket API: one connection, authenticated, with request/answer pairing (haLive.js keeps one
// open for the mirror; homeassistant.js opens a short one for a registry or statistics command when the mirror is
// not connected). Uses Node's global WebSocket (Node 22 and later); the token travels in the `auth` frame, never in a
// header or a URL, and frames are never logged. The WebSocket handshake never follows redirects.

/** ws(s)://<host>/api/websocket for an http(s) Home Assistant URL ('' when the URL is not http(s)). */
export function wsUrl(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = `${u.pathname.replace(/\/+$/, '')}/api/websocket`;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

export const hasWebSocket = (impl = globalThis.WebSocket) => typeof impl === 'function';

export class HaWsError extends Error {
  constructor(message, code = '') {
    super(message);
    this.code = code;
  }
}

/**
 * Open and authenticate a connection. Resolves with { call(msg) → Promise<result>, subscribe(msg, onEvent) →
 * Promise<subscription id>, close(), onClose(fn), haVersion } once HA answers auth_ok; rejects with HaWsError
 * (code 'auth' when the token is refused, 'unreachable' otherwise).
 * @param {{ url: string, token: string, WebSocketImpl?: typeof WebSocket, timeout?: number }} o
 */
export function openHaSocket({ url, token, WebSocketImpl = globalThis.WebSocket, timeout = 10_000 }) {
  return new Promise((resolve, reject) => {
    if (!hasWebSocket(WebSocketImpl)) return reject(new HaWsError('WebSocket not available in this Node version', 'no_websocket'));
    const target = wsUrl(url);
    if (!target) return reject(new HaWsError('Home Assistant URL not configured', 'unreachable'));
    if (!token) return reject(new HaWsError('Home Assistant token not configured', 'auth'));
    let ws;
    try {
      ws = new WebSocketImpl(target);
    } catch (err) {
      return reject(new HaWsError(`Could not connect: ${err.message}`, 'unreachable'));
    }
    let id = 0;
    let ready = false;
    let closed = false;
    const pending = new Map();
    const subs = new Map();
    const closers = [];
    const timer = setTimeout(() => fail(new HaWsError('Timeout while connecting', 'unreachable')), timeout);
    timer.unref?.();
    const fail = (err) => {
      clearTimeout(timer);
      if (!ready) reject(err);
      try { ws.close(); } catch { /* ignore */ }
    };
    const send = (msg) => ws.send(JSON.stringify(msg));
    const api = {
      haVersion: '',
      /** One command; resolves with its result, rejects with HaWsError(code = HA's error code). */
      call(msg, ms = 15_000) {
        if (closed) return Promise.reject(new HaWsError('Connection closed', 'closed'));
        const n = ++id;
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            pending.delete(n);
            rej(new HaWsError('Timeout', 'timeout'));
          }, ms);
          t.unref?.();
          pending.set(n, { res, rej, t });
          try {
            send({ ...msg, id: n });
          } catch (err) {
            clearTimeout(t);
            pending.delete(n);
            rej(new HaWsError(err.message, 'closed'));
          }
        });
      },
      /** A subscription: `onEvent(event)` for each event; resolves with its id once HA accepts it. */
      async subscribe(msg, onEvent) {
        const n = id + 1;
        subs.set(n, onEvent);
        try {
          await api.call(msg);
        } catch (err) {
          subs.delete(n);
          throw err;
        }
        return n;
      },
      forget(subId) {
        subs.delete(subId);
      },
      close() {
        closed = true;
        try { ws.close(); } catch { /* ignore */ }
      },
      onClose(fn) {
        closers.push(fn);
      },
      get open() {
        return !closed;
      },
    };
    ws.addEventListener('message', (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      if (!ready) {
        if (m?.type === 'auth_required') {
          api.haVersion = typeof m.ha_version === 'string' ? m.ha_version : '';
          try { send({ type: 'auth', access_token: token }); } catch { /* close follows */ }
        } else if (m?.type === 'auth_ok') {
          ready = true;
          clearTimeout(timer);
          if (!api.haVersion && typeof m.ha_version === 'string') api.haVersion = m.ha_version;
          resolve(api);
        } else if (m?.type === 'auth_invalid') {
          fail(new HaWsError('Unauthorized (check token)', 'auth'));
        }
        return;
      }
      // HA may batch messages (coalesce_messages): an array of them
      for (const x of Array.isArray(m) ? m : [m]) {
        if (x?.type === 'result' || x?.type === 'pong') {
          const p = pending.get(x.id);
          if (!p) continue;
          pending.delete(x.id);
          clearTimeout(p.t);
          if (x.type === 'pong' || x.success) p.res(x.result ?? null);
          else p.rej(new HaWsError(String(x.error?.message || 'error').slice(0, 200), String(x.error?.code || 'error')));
        } else if (x?.type === 'event') {
          const fn = subs.get(x.id);
          if (fn) {
            try { fn(x.event); } catch (err) { console.warn('[ha] event handler:', err.message); }
          }
        }
      }
    });
    ws.addEventListener('error', () => {
      if (!ready) fail(new HaWsError('Could not connect', 'unreachable'));
    });
    ws.addEventListener('close', () => {
      closed = true;
      clearTimeout(timer);
      for (const p of pending.values()) {
        clearTimeout(p.t);
        p.rej(new HaWsError('Connection closed', 'closed'));
      }
      pending.clear();
      if (!ready) reject(new HaWsError('Connection closed', 'unreachable'));
      for (const fn of closers) {
        try { fn(); } catch { /* ignore */ }
      }
    });
  });
}
