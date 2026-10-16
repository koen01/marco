// A fake Home Assistant for the tests: REST (/api/, /api/config, /api/states, /api/history/period,
// /api/media_player_proxy, /api/camera_proxy, /api/camera_proxy_stream (MJPEG), /api/services) and the WebSocket API (/api/websocket: auth, subscribe_entities,
// unsubscribe_events, ping, the area / entity / device registries, recorder statistics). Hand-written WebSocket
// framing (RFC 6455) so the tests need no dependency. Every REST request and every WebSocket command is recorded.
import http from 'node:http';
import crypto from 'node:crypto';

export const FAKE_HA_TOKEN = 'fake-ha-long-lived-token-abcdefghijklmnopqrstuvwxyz';
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(text, opcode = 1) {
  const payload = Buffer.from(text, 'utf8');
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | opcode, n]);
  else if (n < 65536) {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(n, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Frames out of `buf`: [{ opcode, payload }], plus what is left over. */
function decodeFrames(buf) {
  const out = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off];
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    out.push({ opcode: b0 & 0x0f, payload });
    off = p + len;
  }
  return { frames: out, rest: buf.subarray(off) };
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Start a fake Home Assistant on 127.0.0.1. `opts`: { token, states: [{ entity_id, state, attributes }], version,
 * noSubscribeEntities (HA older than 2022.4), nonAdmin (registry commands refused), areas, entityRegistry,
 * deviceRegistry, history: { entity: [[ms, value]] }, statistics: { entity: [[ms, mean]] }, statValues: { entity:
 * { change, mean, min, max } } for recorder/statistic_during_period }.
 */
export async function fakeHa(opts = {}) {
  const token = opts.token ?? FAKE_HA_TOKEN;
  const hits = [];
  const wsLog = [];
  const sockets = new Set();
  const state = {
    redirectTo: '', // every request answers 302 to this URL
    wsDown: false, // WebSocket upgrades are refused
    restDown: false,
    noSubscribeEntities: !!opts.noSubscribeEntities,
    noStatistic: false, // recorder/statistic_during_period refused (Home Assistant before 2023.2)
    nonAdmin: !!opts.nonAdmin,
    picture: null, // a JPEG or another body for media_player_proxy
    // cameras: 'ok' | 'down' (500) | 'html' (not an image) | 'huge' (a 5 MB frame) | 'stall' (the stream sends one
    // frame, then nothing) | 'svg' (stream parts that are not pictures)
    camera: 'ok',
    cameraEveryMs: 40,
    cameraDelay: 0,
    cameraJpeg: null, // the picture cameras send (default FAKE_JPEG, which no browser can decode)
  };
  /** live camera streams open now */
  const liveOpen = new Set();
  const t0 = Date.now() - 3600_000;
  const states = new Map();
  for (const s of opts.states ?? []) {
    states.set(s.entity_id, { entity_id: s.entity_id, state: String(s.state), attributes: { ...(s.attributes ?? {}) }, last_changed: iso(s.at ?? t0), last_updated: iso(s.at ?? t0) });
  }
  const history = opts.history ?? {};
  const statistics = opts.statistics ?? {};

  const authOk = (req) => req.headers.authorization === `Bearer ${token}`;
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      if (state.redirectTo) {
        res.writeHead(302, { location: state.redirectTo + req.url });
        return res.end();
      }
      if (!authOk(req)) return json(res, 401, { message: 'unauthorized' });
      if (state.restDown) return json(res, 500, { message: 'boom' });
      const u = new URL(req.url, 'http://x');
      const p = decodeURIComponent(u.pathname);
      if (p === '/api/') return json(res, 200, { message: 'API running.' });
      if (p === '/api/config') return json(res, 200, { version: opts.version ?? '2026.10.0' });
      if (p === '/api/states') return json(res, 200, [...states.values()]);
      if (p.startsWith('/api/states/')) {
        const s = states.get(p.slice('/api/states/'.length));
        return s ? json(res, 200, s) : json(res, 404, { message: 'Entity not found.' });
      }
      if (p.startsWith('/api/history/period/')) {
        const ids = String(u.searchParams.get('filter_entity_id') || '').split(',').filter(Boolean);
        return json(res, 200, ids.filter((id) => history[id]).map((id) => history[id].map(([t, v], i) => (i === 0
          ? { entity_id: id, state: String(v), last_changed: iso(t), attributes: {} }
          : { state: String(v), last_changed: iso(t) }))));
      }
      if (p.startsWith('/api/media_player_proxy/')) {
        const id = p.slice('/api/media_player_proxy/'.length);
        if (!states.has(id)) return json(res, 404, {});
        const pic = state.picture ?? FAKE_JPEG;
        res.writeHead(200, { 'content-type': pic === FAKE_JPEG ? 'image/jpeg' : 'text/html', 'x-ha-secret': 'should-not-pass' });
        return res.end(pic);
      }
      if (p.startsWith('/api/camera_proxy/')) {
        const id = p.slice('/api/camera_proxy/'.length);
        if (!states.has(id)) return json(res, 404, {});
        const send = () => {
          if (state.camera === 'down') return json(res, 500, { message: 'boom' });
          if (state.camera === 'html') {
            res.writeHead(200, { 'content-type': 'text/html' });
            return res.end('<script>alert(1)</script>');
          }
          if (state.camera === 'huge') {
            res.writeHead(200, { 'content-type': 'image/jpeg' });
            return res.end(Buffer.alloc(5 * 1024 * 1024));
          }
          res.writeHead(200, { 'content-type': 'image/jpeg', 'x-ha-secret': 'should-not-pass' });
          res.end(state.cameraJpeg ?? FAKE_JPEG);
        };
        if (state.cameraDelay) setTimeout(send, state.cameraDelay); else send();
        return;
      }
      if (p.startsWith('/api/camera_proxy_stream/')) {
        const id = p.slice('/api/camera_proxy_stream/'.length);
        if (!states.has(id)) return json(res, 404, {});
        if (state.camera === 'down') return json(res, 500, { message: 'boom' });
        res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace;boundary=frameboundary', 'x-ha-secret': 'should-not-pass' });
        const entry = { id, sent: 0 };
        liveOpen.add(entry);
        const part = () => {
          if (state.camera === 'svg') return Buffer.concat([Buffer.from('--frameboundary\r\nContent-Type: image/svg+xml\r\n\r\n'), Buffer.from('<svg onload="alert(1)"/>'), Buffer.from('\r\n')]);
          if (state.camera === 'huge') return Buffer.concat([Buffer.from(`--frameboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${3 * 1024 * 1024}\r\n\r\n`), Buffer.alloc(3 * 1024 * 1024)]);
          const jpg = state.cameraJpeg ?? FAKE_JPEG;
          return Buffer.concat([Buffer.from(`--frameboundary\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from('\r\n')]);
        };
        const tick = () => {
          if (state.camera === 'stall' && entry.sent >= 1) return;
          entry.sent++;
          res.write(part());
        };
        tick();
        const timer = setInterval(tick, state.cameraEveryMs);
        const done = () => {
          clearInterval(timer);
          liveOpen.delete(entry);
        };
        res.on('close', done);
        return;
      }
      if (p.startsWith('/api/services/')) return json(res, 200, []);
      json(res, 404, { message: 'not found' });
    });
  });

  // ---- WebSocket
  server.on('upgrade', (req, socket) => {
    hits.push({ method: 'WS', url: req.url, auth: req.headers.authorization ?? null });
    if (state.wsDown || req.url !== '/api/websocket' || state.redirectTo) {
      if (state.redirectTo) socket.end(`HTTP/1.1 302 Found\r\nLocation: ${state.redirectTo}/api/websocket\r\nContent-Length: 0\r\n\r\n`);
      else socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = { socket, authed: false, subs: new Map() };
    sockets.add(conn);
    const out = (msg) => {
      if (!socket.destroyed) socket.write(encodeFrame(JSON.stringify(msg)));
    };
    conn.send = out;
    out({ type: 'auth_required', ha_version: opts.version ?? '2026.10.0' });
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = decodeFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 8) {
          socket.end(encodeFrame('', 8));
          continue;
        }
        if (f.opcode === 9) {
          socket.write(encodeFrame(f.payload.toString('utf8'), 10));
          continue;
        }
        if (f.opcode !== 1) continue;
        let m;
        try { m = JSON.parse(f.payload.toString('utf8')); } catch { continue; }
        onMessage(conn, m);
      }
    });
    socket.on('close', () => sockets.delete(conn));
    socket.on('error', () => sockets.delete(conn));
  });

  const compressed = (s) => ({ s: s.state, a: s.attributes, lc: Date.parse(s.last_changed) / 1000, lu: Date.parse(s.last_updated) / 1000, c: 'ctx' });

  function onMessage(conn, m) {
    wsLog.push(m.type === 'auth' ? { type: 'auth', tokenOk: m.access_token === token } : m);
    const ok = (result = null) => conn.send({ id: m.id, type: 'result', success: true, result });
    const err = (code, message = code) => conn.send({ id: m.id, type: 'result', success: false, error: { code, message } });
    if (!conn.authed) {
      if (m.type !== 'auth') return;
      if (m.access_token !== token) {
        conn.send({ type: 'auth_invalid', message: 'Invalid access token or password' });
        conn.socket.end();
        return;
      }
      conn.authed = true;
      conn.send({ type: 'auth_ok', ha_version: opts.version ?? '2026.10.0' });
      return;
    }
    switch (m.type) {
      case 'ping': return conn.send({ id: m.id, type: 'pong' });
      case 'subscribe_entities': {
        if (state.noSubscribeEntities) return err('unknown_command', 'Unknown command.');
        const ids = Array.isArray(m.entity_ids) ? m.entity_ids : null;
        conn.subs.set(m.id, ids);
        ok();
        const a = {};
        for (const s of states.values()) if (!ids || ids.includes(s.entity_id)) a[s.entity_id] = compressed(s);
        conn.send({ id: m.id, type: 'event', event: { a } });
        return;
      }
      case 'unsubscribe_events':
        conn.subs.delete(m.subscription);
        return ok();
      case 'get_states': return ok([...states.values()]);
      case 'config/area_registry/list':
        return state.nonAdmin ? err('unauthorized', 'Unauthorized') : ok(opts.areas ?? []);
      case 'config/entity_registry/list':
        return state.nonAdmin ? err('unauthorized', 'Unauthorized') : ok(opts.entityRegistry ?? []);
      case 'config/device_registry/list':
        return state.nonAdmin ? err('unauthorized', 'Unauthorized') : ok(opts.deviceRegistry ?? []);
      case 'recorder/statistics_during_period': {
        const r = {};
        for (const id of m.statistic_ids ?? []) if (statistics[id]) r[id] = statistics[id].map(([t, v]) => ({ start: t, end: t + 3600_000, mean: v, min: v, max: v }));
        return ok(r);
      }
      case 'recorder/statistic_during_period': {
        // one value per type asked: opts.statValues[id][type] (else nothing), per calendar period
        if (state.noStatistic) return err('unknown_command', 'Unknown command.');
        const v = (opts.statValues ?? {})[m.statistic_id] ?? {};
        const r = {};
        for (const t of m.types ?? []) if (typeof v[t] === 'number') r[t] = typeof v.byPeriod === 'object' && v.byPeriod[m.calendar?.period]?.[t] !== undefined ? v.byPeriod[m.calendar.period][t] : v[t];
        return ok(r);
      }
      default: return err('unknown_command', 'Unknown command.');
    }
  }

  return {
    url: `http://127.0.0.1:${await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))}`,
    token,
    hits,
    wsLog,
    state,
    states,
    /** Change an entity (or add it) and tell the subscribers, the way Home Assistant does (compressed diff). */
    set(id, value, attrs = null, { at = Date.now() } = {}) {
      const old = states.get(id);
      const s = { entity_id: id, state: String(value), attributes: attrs ? { ...attrs } : { ...(old?.attributes ?? {}) }, last_changed: old && old.state === String(value) ? old.last_changed : iso(at), last_updated: iso(at) };
      states.set(id, s);
      for (const c of sockets) {
        for (const [sid, ids] of c.subs) {
          if (ids && !ids.includes(id)) continue;
          if (!old) c.send({ id: sid, type: 'event', event: { a: { [id]: compressed(s) } } });
          else {
            const plus = { lu: Date.parse(s.last_updated) / 1000 };
            if (old.state !== s.state) {
              plus.s = s.state;
              plus.lc = Date.parse(s.last_changed) / 1000;
            }
            const ch = {};
            for (const [k, v] of Object.entries(s.attributes)) if (JSON.stringify(old.attributes[k]) !== JSON.stringify(v)) ch[k] = v;
            if (Object.keys(ch).length) plus.a = ch;
            const minus = Object.keys(old.attributes).filter((k) => !(k in s.attributes));
            c.send({ id: sid, type: 'event', event: { c: { [id]: { '+': plus, ...(minus.length ? { '-': { a: minus } } : {}) } } } });
          }
        }
      }
    },
    remove(id) {
      states.delete(id);
      for (const c of sockets) for (const [sid, ids] of c.subs) if (!ids || ids.includes(id)) c.send({ id: sid, type: 'event', event: { r: [id] } });
    },
    /** Live camera streams open now: [{ id, sent }]. */
    liveStreams: () => [...liveOpen].map((x) => ({ ...x })),
    /** Open WebSocket connections and their subscriptions (entity id lists). */
    connections: () => [...sockets].map((c) => ({ authed: c.authed, subs: [...c.subs.values()] })),
    /** Cut every WebSocket connection (Home Assistant restarting). */
    dropAll() {
      for (const c of sockets) c.socket.destroy();
      sockets.clear();
    },
    close: () => new Promise((r) => {
      for (const c of sockets) c.socket.destroy();
      server.closeAllConnections?.();
      server.close(() => r());
    }),
  };
}
