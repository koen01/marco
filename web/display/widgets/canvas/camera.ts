// Personalizado Cámara card: the picture of a Home Assistant camera, proxied by this server (routes/ha.js, the
// shared server/haCamera.js), so this page never sees an entity id, a Home Assistant address or a token.
//
// - Snapshots are the default: a new picture every `everySec` seconds (2 s at the fastest, 10 s in lite mode or on a
//   low-power device), decoded off screen and swapped in, so the picture never flickers (the doorbell's pattern).
//   After 3 pictures in a row that did not come the card says "Sin señal" over the last one it had.
// - "Directo" opens the live picture (one per screen at most, checked by the server) when this is not lite mode, not a
//   low-power device, not the admin's preview and the page is on screen. It is read with fetch and drawn in the same
//   two images, so a camera that stops sending shows "Sin señal" (an <img> with an MJPEG source gives no sign when
//   the stream stops). Pictures that come faster than 10 a second are skipped. When the live picture fails (the
//   server is busy, the camera breaks) the card goes back to snapshots and tries live again later.
// - `showWhen`: the card is shown only while that binary sensor is on (and asks for nothing while it is off). The
//   admin's preview keeps it in view, dimmed, with a line that says why.
// - Nothing is asked while the page is hidden. destroy() stops everything and revokes every object URL.
import type { DisplayCanvasItem, HaState } from '../../../shared/types';
import { ctx } from '../../ctx';
import { authHeaders, isPreview, withScreen } from '../../identity';
import { demoCameraFrame } from '../../mockHa';
import { aliasOf } from '../ha/haui';
import { el } from './ha';
import type { AdapterEnv, CanvasAdapter } from './types';

type Props = Record<string, any>;

/** Pictures in a row that did not come before the card says "Sin señal". */
const MISSES = 3;
const MIN_MS = 2000;
const LOW_MIN_MS = 10_000;
/** A request for one picture gives up after this. */
const FRAME_TIMEOUT_MS = 10_000;
/** The home network rule refused the picture: asked again this much later. */
const LAN_RETRY_MS = 60_000;
/** Live: no picture for this long counts as a missed one (three of them: "Sin señal", then back to snapshots). */
const LIVE_STALE_MS = 5000;
/** Live: at most one picture drawn per this many ms. */
const LIVE_MIN_GAP_MS = 100;
/** Live failed: tried again after 15 s, 30 s, 1 min, 2 min, then every 5 min. */
const LIVE_RETRY_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
/** The server ends a live picture after 10 minutes; one that lasted this long is opened again at once. */
const LIVE_LONG_MS = 9 * 60_000;

const enc = new TextEncoder();
const HEAD_END = enc.encode('\r\n\r\n');

function indexOf(buf: Uint8Array, seq: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) if (buf[i + j] !== seq[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Pictures out of Marco's own multipart stream (routes/ha.js: every part has its Content-Type and Content-Length).
 * `push(chunk)` returns the pictures that are complete; throws when the stream is not what Marco sends.
 */
export class LiveParts {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): { type: string; body: Uint8Array }[] {
    const next = new Uint8Array(this.buf.length + chunk.length);
    next.set(this.buf);
    next.set(chunk, this.buf.length);
    this.buf = next;
    const out: { type: string; body: Uint8Array }[] = [];
    for (;;) {
      const end = indexOf(this.buf, HEAD_END);
      if (end < 0) {
        if (this.buf.length > 4096) throw new Error('bad stream');
        return out;
      }
      const head = new TextDecoder('latin1').decode(this.buf.subarray(0, end));
      const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? NaN);
      const type = /content-type:\s*([^\r\n;]+)/i.exec(head)?.[1]?.trim().toLowerCase() ?? '';
      if (!Number.isFinite(len) || len > 4 * 1024 * 1024) throw new Error('bad stream');
      const start = end + 4;
      if (this.buf.length < start + len) return out;
      out.push({ type, body: this.buf.slice(start, start + len) });
      this.buf = this.buf.slice(start + len);
    }
  }
}

function camera(item0: DisplayCanvasItem): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let stage: HTMLElement;
  let imgs: [HTMLImageElement, HTMLImageElement];
  let label: HTMLElement;
  let badge: HTMLElement;
  let msg: HTMLElement;
  let front = 0;
  const urls: [string, string] = ['', ''];
  let hasFrame = false;
  let misses = 0;
  let n = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ctl: AbortController | null = null;
  let lanBlocked = false;
  let dead = false;
  // live
  let liveCtl: AbortController | null = null;
  let liveOn = false;
  let liveFails = 0;
  let liveAfter = 0;
  let liveLast = 0;
  let liveWatch: ReturnType<typeof setInterval> | null = null;
  let decoding = false;
  let key = '';

  const props = () => env.item().props as Props;
  const entity = () => aliasOf(props().entity);
  const state = (): HaState | null => (entity() ? env.ha.state(entity()) : null);
  /** The showWhen sensor keeps the card away now (off, or not known yet). */
  const gated = (): boolean => {
    const a = aliasOf(props().showWhen);
    if (!a) return false;
    const s = env.ha.state(a);
    return !(s && s.d === 'binary' && s.on);
  };
  const period = () => Math.max(env.low() ? LOW_MIN_MS : MIN_MS, (Number(props().everySec) || 5) * 1000);
  const wantLive = () => props().mode === 'live' && !env.low() && !isPreview && !env.ha.isDemo() && !document.hidden && Date.now() >= liveAfter;
  const active = () => !dead && !!entity() && !gated() && !document.hidden && !env.ha.off();

  const setUrl = (i: 0 | 1, url: string) => {
    if (urls[i]) URL.revokeObjectURL(urls[i]);
    urls[i] = url;
    if (!url) {
      imgs[i].removeAttribute('src');
      imgs[i].classList.remove('on');
    }
  };

  /** Decode the new picture off screen, then flip the two images. */
  const swap = async (blob: Blob): Promise<void> => {
    const back = (1 - front) as 0 | 1;
    const url = URL.createObjectURL(blob);
    const img = imgs[back];
    setUrl(back, url);
    img.src = url;
    await img.decode();
    if (dead) return;
    img.classList.add('on');
    imgs[front].classList.remove('on');
    front = back;
    hasFrame = true;
  };

  const paint = () => {
    if (!root) return;
    const p = props();
    const s = state();
    const nosig = !!entity() && !lanBlocked && !env.ha.off() && (misses >= MISSES || s?.d === 'unavailable');
    root.classList.toggle('has-frame', hasFrame);
    root.classList.toggle('is-nosig', nosig);
    root.classList.toggle('is-live', liveOn);
    root.classList.toggle('is-gated', isPreview && gated());
    stage.classList.toggle('contain', p.fit === 'contain');
    const name = p.label ? String(s?.n || '') : '';
    label.textContent = name;
    label.hidden = !name;
    badge.hidden = !liveOn;
    let text = '';
    const off = env.ha.off();
    root.classList.toggle('is-ha-off', off);
    if (off) text = ctx.t(isPreview ? 'haOffTitle' : 'haOffTv');
    else if (!entity()) text = ctx.t('cvSetup');
    else if (lanBlocked) text = ctx.t('haCamLan');
    else if (nosig) text = ctx.t('haNoSignal');
    else if (isPreview && gated()) text = ctx.t('haCamGated');
    else if (!hasFrame) text = ctx.t('haCamWaiting');
    msg.textContent = text;
    msg.hidden = !text;
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const stopLive = () => {
    liveCtl?.abort();
    liveCtl = null;
    liveOn = false;
    if (liveWatch) clearInterval(liveWatch);
    liveWatch = null;
  };

  const stopAll = () => {
    clearTimer();
    ctl?.abort();
    ctl = null;
    stopLive();
  };

  const schedule = (ms: number) => {
    clearTimer();
    if (!active()) return;
    timer = setTimeout(() => void next(), ms);
  };

  /** One snapshot (or the live picture when it may run now). */
  const next = async (): Promise<void> => {
    timer = null;
    if (!active() || ctl || liveCtl) return;
    if (wantLive()) return void openLive();
    const id = item0.id;
    const t0 = Date.now();
    let wait = period();
    const c = new AbortController();
    ctl = c;
    const kill = setTimeout(() => c.abort(), FRAME_TIMEOUT_MS);
    try {
      let blob: Blob | null;
      if (isPreview) blob = env.ha.previewFrame(id);
      else if (env.ha.isDemo()) blob = await demoCameraFrame(++n);
      else {
        const r = await fetch(withScreen(`/api/display/ha/camera/${encodeURIComponent(id)}?n=${++n}`), { headers: authHeaders(), cache: 'no-store', signal: c.signal });
        const err = r.ok ? '' : String(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? '');
        lanBlocked = err === 'lan_only';
        if (lanBlocked) wait = LAN_RETRY_MS;
        // the server says the sensor is off: no miss, the state will catch up
        if (err === 'hidden') blob = null;
        else if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) throw new Error(err || `HTTP ${r.status}`);
        else blob = await r.blob();
      }
      if (blob) {
        await swap(blob);
        misses = 0;
      }
    } catch {
      if (!lanBlocked) misses++;
    } finally {
      clearTimeout(kill);
      if (ctl === c) ctl = null;
    }
    if (dead) return;
    paint();
    // the interval counts from the start of the request, so a slow camera does not slow it down further
    schedule(Math.max(0, wait - (Date.now() - t0)));
  };

  /** The live picture failed or ended: back to snapshots, live again later. */
  const liveDone = (failed: boolean) => {
    stopLive();
    if (failed) {
      liveAfter = Date.now() + LIVE_RETRY_MS[Math.min(liveFails, LIVE_RETRY_MS.length - 1)];
      liveFails++;
    }
    paint();
    schedule(failed ? 0 : 50);
  };

  const openLive = async (): Promise<void> => {
    const c = new AbortController();
    liveCtl = c;
    const opened = Date.now();
    liveLast = Date.now();
    let ok = false;
    try {
      const r = await fetch(withScreen(`/api/display/ha/camera/${encodeURIComponent(item0.id)}/live`), { headers: authHeaders(), cache: 'no-store', signal: c.signal });
      if (!r.ok || !r.body) {
        const err = String(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? '');
        lanBlocked = err === 'lan_only';
        throw new Error(err || `HTTP ${r.status}`);
      }
      // no picture for a while counts as missed ones; three: give up on this stream
      liveWatch = setInterval(() => {
        if (Date.now() - liveLast < LIVE_STALE_MS) return;
        liveLast = Date.now();
        misses++;
        paint();
        if (misses >= MISSES) c.abort();
      }, 1000);
      const parts = new LiveParts();
      const reader = r.body.getReader();
      let shown = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done || dead) break;
        for (const part of parts.push(value)) {
          liveLast = Date.now();
          if (!/^image\/(jpeg|png|webp|gif)$/.test(part.type)) continue;
          // a picture still being decoded, or one drawn a moment ago: this one is skipped
          if (decoding || Date.now() - shown < LIVE_MIN_GAP_MS) continue;
          decoding = true;
          shown = Date.now();
          try {
            await swap(new Blob([part.body as BlobPart], { type: part.type }));
            if (!liveOn || misses) {
              liveOn = true;
              ok = true;
              liveFails = 0;
              misses = 0;
              paint();
            }
          } catch { /* a picture that does not decode: the next one */ } finally {
            decoding = false;
          }
        }
      }
    } catch {
      /* failed or aborted */
    }
    if (liveCtl !== c || dead) return;
    // it ran its full time (the server ends it after 10 minutes): opened again at once
    const long = ok && Date.now() - opened >= LIVE_LONG_MS && misses < MISSES;
    liveDone(!long);
  };

  /** Start, stop or change what runs, after a change of the item, the states or the page. */
  const sync = () => {
    if (!root) return;
    const p = props();
    const k = JSON.stringify([env.item().v, entity(), p.mode, p.everySec, env.low()]);
    if (k !== key) {
      // a new camera or mode: its own retries and counters
      key = k;
      stopAll();
      misses = 0;
      liveFails = 0;
      liveAfter = 0;
      lanBlocked = false;
    }
    if (!active()) {
      stopAll();
      paint();
      return;
    }
    if (liveCtl && !wantLive()) {
      stopLive();
      clearTimer();
    }
    paint();
    if (!timer && !ctl && !liveCtl) schedule(0);
  };

  const onVisibility = () => sync();

  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-ha', 'cv-ha-cam');
      stage = el('div', 'cv-cam-stage');
      imgs = [el('img', 'cv-cam-img'), el('img', 'cv-cam-img')];
      for (const i of imgs) {
        i.alt = '';
        i.decoding = 'async';
      }
      stage.append(...imgs);
      label = el('span', 'cv-cam-label');
      badge = el('span', 'cv-cam-live', ctx.t('haCamLive'));
      msg = el('span', 'cv-cam-msg');
      msg.setAttribute('role', 'status');
      root.append(stage, label, badge, msg);
      document.addEventListener('visibilitychange', onVisibility);
      sync();
    },
    update() {
      sync();
    },
    tick(t) {
      // the card was gated or hidden and nothing runs: look again once a minute
      if (t.minuteChanged) sync();
    },
    data(topic) {
      if (topic === 'ha' || topic === 'config') sync();
    },
    empty() {
      return !isPreview && !!entity() && gated();
    },
    destroy() {
      dead = true;
      stopAll();
      document.removeEventListener('visibilitychange', onVisibility);
      setUrl(0, '');
      setUrl(1, '');
      root.textContent = '';
    },
  };
}

export const CAMERA_ADAPTERS: Record<string, (item: DisplayCanvasItem) => CanvasAdapter> = {
  'ha.camera': (item) => camera(item),
};
