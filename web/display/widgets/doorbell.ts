// Doorbell overlay: someone rang, the camera picture fills the screen for a while (docs/ARCHITECTURE.md).
// It sits above the night dim layer on purpose, so a ring wakes a dimmed screen for its duration and the screen goes
// back to night mode when it ends. The picture comes from a FrameSource: on a display that is
// GET /api/display/doorbell/frame, asked again every `refreshMs` with a counter so nothing caches it. The overlay does
// not know whether the server answers with a live camera frame (self-hosted, Home Assistant) or with the latest
// uploaded snapshot: it shows whatever comes back, keeps the last good picture on an error, and stops asking when the
// server says the ring is over (null).
// With a LiveSource (doorbellLive.ts) a ring first tries live video over WebRTC, for cameras that have no pictures at
// all (Google Nest): while it is being set up the bell card shows, once it plays it replaces the pictures, and when
// it is not offered, fails or drops the overlay goes back to asking for pictures. One try per ring.
import type { DoorbellRing } from '../../shared/types';
import { formatHM } from '../../shared/i18n';
import { ctx } from '../ctx';
import { reducedMotion } from '../dom';
import { current } from '../time';
import { serverNow } from './alerts';
import { doorChime } from './chime';
import type { LiveSession, LiveSource } from '../doorbellLive';

/**
 * One frame for request number `n`: an image Blob, or null when there is no picture to ask for (no ring on this
 * screen any more, no camera). Throws when the picture could not be read this time (the overlay retries).
 */
export type FrameSource = (n: number, signal: AbortSignal) => Promise<Blob | null>;

/** A failed frame is asked again after this long at the earliest. */
const RETRY_MS = 2000;
/** A ring older than this when it reaches the display (page load, reconnect) does not chime. */
const CHIME_FRESH_MS = 15_000;
/** The "live" dot goes grey when the last good frame is older than this. */
const STALE_MS = 4000;

export class DoorbellOverlay {
  private ring: DoorbellRing | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private ctl: AbortController | null = null;
  private n = 0;
  private front = 0;
  private urls: [string, string] = ['', ''];
  private lastFrameAt = 0;
  private failed = false;
  private stopped = false;
  /** `${id}|${updatedAt}` already chimed, so a replay never chimes twice */
  private chimed = new Set<string>();
  private imgs: [HTMLImageElement, HTMLImageElement];
  private back: HTMLImageElement;
  private video: HTMLVideoElement;
  private onChange: (on: boolean) => void;
  /** live video: tried once per ring; `liveCtl` is set from the try until the session ends (no pictures meanwhile) */
  private liveTried = false;
  private liveCtl: AbortController | null = null;
  private liveSession: LiveSession | null = null;
  private videoOn = false;

  constructor(private root: HTMLElement, private source: FrameSource, onChange: (on: boolean) => void = () => undefined, private live: LiveSource | null = null) {
    this.onChange = onChange;
    // .db-back: the same picture blurred, filling the bands a picture of another shape leaves (portrait screens)
    root.innerHTML = `<div class="db-stage"><img class="db-back" alt=""><img class="db-frame" alt=""><img class="db-frame" alt=""><video class="db-video" muted playsinline autoplay></video></div>
      <div class="db-empty"><div class="db-bell">🔔</div><div class="db-msg"></div></div>
      <div class="db-top"><span class="db-pill"><span class="db-ic">🔔</span><b class="db-label"></b><span class="db-time"></span><span class="db-live"></span></span></div>
      <div class="db-bar"><i></i></div>`;
    this.imgs = [...root.querySelectorAll<HTMLImageElement>('.db-frame')] as [HTMLImageElement, HTMLImageElement];
    this.back = root.querySelector('.db-back') as HTMLImageElement;
    this.video = root.querySelector('.db-video') as HTMLVideoElement;
    this.video.addEventListener('playing', () => this.setVideo(true));
    // the "live" dot stays red while the video moves
    this.video.addEventListener('timeupdate', () => {
      if (this.videoOn) this.lastFrameAt = Date.now();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ring && !this.stopped) this.schedule(0);
    });
  }

  get active(): boolean {
    return this.ring !== null;
  }

  /** Show a ring, or extend the one on screen (same id). Rings that are already over are ignored. */
  show(r: DoorbellRing): void {
    if (!r || typeof r.id !== 'string') return;
    const expires = Date.parse(r.expiresAt);
    if (!Number.isFinite(expires) || expires - serverNow() <= 250) return;
    const same = this.ring?.id === r.id;
    if (this.ring && !same) this.reset();
    this.ring = { ...r };
    this.maybeChime(r);
    this.arm();
    this.progress();
    if (same) {
      // A server that serves uploaded snapshots can get the first picture after the ring started: the same ring
      // comes again with frames on, and the overlay starts asking for it.
      if (r.frames && this.stopped) {
        this.stopped = false;
        this.failed = false;
        this.begin(this.ring);
      }
      return;
    }
    this.root.querySelector('.db-label')!.textContent = ctx.t('doorbell');
    this.stopped = !r.frames;
    this.failed = false;
    this.lastFrameAt = 0;
    this.paint();
    this.root.classList.add('show');
    document.documentElement.classList.add('doorbell-on');
    this.onChange(true);
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    if (r.frames) this.begin(this.ring);
  }

  /** The picture of a ring: live video when the camera has it (once per ring), else the frames. */
  private begin(r: DoorbellRing): void {
    if (this.live && !this.liveTried) void this.startLive(r);
    else this.schedule(0);
  }

  private async startLive(r: DoorbellRing): Promise<void> {
    this.liveTried = true;
    const ctl = new AbortController();
    this.liveCtl = ctl;
    let s: LiveSession | null = null;
    try {
      s = await this.live!(this.video, ctl.signal);
    } catch {
      s = null;
    }
    if (this.ring !== r || ctl.signal.aborted) {
      s?.close();
      return;
    }
    if (!s) {
      // no live video for this camera (or it could not be set up): the pictures
      this.liveCtl = null;
      this.schedule(0);
      return;
    }
    this.liveSession = s;
    void s.ended.then(() => {
      if (this.liveSession !== s) return;
      this.liveSession = null;
      this.liveCtl = null;
      this.setVideo(false);
      // the video dropped while the ring lasts: back to the pictures
      if (this.ring === r && !this.stopped) this.schedule(0);
    });
  }

  private setVideo(on: boolean): void {
    if (on === this.videoOn || (on && !this.liveSession)) return;
    this.videoOn = on;
    this.root.classList.toggle('has-video', on);
    if (on) {
      this.lastFrameAt = Date.now();
      this.failed = false;
      if (this.frameTimer) clearTimeout(this.frameTimer);
      this.frameTimer = null;
      this.ctl?.abort();
    }
    this.paint();
    this.tickClock();
  }

  /** End the ring `id` (null = whatever is on screen). */
  end(id: string | null): void {
    if (!this.ring || (id !== null && id !== this.ring.id)) return;
    this.hide();
  }

  /** The server says which ring this screen has now (hello, poll reset): anything else on screen is over. */
  sync(id: string | null | undefined): void {
    if (id === undefined) return;
    if (this.ring && this.ring.id !== id) this.hide();
  }

  hide(): void {
    if (!this.ring) return;
    this.reset();
    this.root.classList.remove('show');
    document.documentElement.classList.remove('doorbell-on');
    this.onChange(false);
    // free the pictures once the fade is over
    setTimeout(() => {
      if (this.ring) return;
      for (const i of [0, 1] as const) this.setUrl(i, '');
    }, 800);
  }

  private reset(): void {
    this.ring = null;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.timer = this.frameTimer = this.clockTimer = null;
    this.ctl?.abort();
    this.ctl = null;
    this.liveCtl?.abort();
    this.liveSession?.close();
    this.liveCtl = this.liveSession = null;
    this.liveTried = false;
    this.videoOn = false;
    this.root.classList.remove('has-video');
  }

  private maybeChime(r: DoorbellRing): void {
    const key = `${r.id}|${r.updatedAt || r.startedAt}`;
    if (this.chimed.has(key)) return;
    this.chimed.add(key);
    if (this.chimed.size > 50) this.chimed.delete(this.chimed.values().next().value as string);
    const at = Date.parse(r.updatedAt || r.startedAt);
    const fresh = !Number.isFinite(at) || serverNow() - at < CHIME_FRESH_MS;
    if (r.sound && fresh) doorChime(ctx.cfg.alerts?.volume ?? 0.6);
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    const remaining = Date.parse(this.ring!.expiresAt) - serverNow();
    this.timer = setTimeout(() => this.hide(), Math.min(Math.max(0, remaining), 10 * 60_000));
  }

  /** Bar from the remaining share of the whole ring down to 0. */
  private progress(): void {
    const bar = this.root.querySelector('.db-bar i') as HTMLElement | null;
    const r = this.ring;
    if (!bar || !r) return;
    const start = Date.parse(r.startedAt);
    const end = Date.parse(r.expiresAt);
    const remaining = Math.max(0, end - serverNow());
    const total = Math.max(1000, Number.isFinite(start) ? end - start : remaining);
    const frac = Math.min(1, remaining / total);
    bar.getAnimations().forEach((a) => a.cancel());
    bar.style.transform = `scaleX(${frac})`;
    if (reducedMotion() || remaining <= 0) return;
    bar.animate([{ transform: `scaleX(${frac})` }, { transform: 'scaleX(0)' }], { duration: remaining, easing: 'linear', fill: 'forwards' });
  }

  private tickClock(): void {
    const p = current().parts;
    const dt = ctx.cfg.datetime;
    this.root.querySelector('.db-time')!.textContent = formatHM(p.hour, p.minute, dt?.format24 !== false, !!dt?.showAmPm);
    const live = this.root.querySelector('.db-live') as HTMLElement;
    live.classList.toggle('on', this.lastFrameAt > 0 && Date.now() - this.lastFrameAt < STALE_MS);
    live.style.display = this.ring?.frames ? '' : 'none';
  }

  /** Picture or the bell card (no camera, or no picture yet after an error). */
  private paint(): void {
    const has = this.lastFrameAt > 0 || this.videoOn;
    this.root.classList.toggle('has-frame', has);
    const msg = this.root.querySelector('.db-msg')!;
    msg.textContent = this.ring?.frames && this.failed ? ctx.t('doorbellNoPicture') : ctx.t('doorbellRinging');
    this.root.classList.toggle('db-failed', this.failed && has);
  }

  private schedule(ms: number): void {
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = setTimeout(() => void this.next(), ms);
  }

  private async next(): Promise<void> {
    this.frameTimer = null;
    const r = this.ring;
    if (!r || this.stopped || this.ctl || this.liveCtl) return;
    if (document.hidden) return; // asked again on visibilitychange
    const ctl = new AbortController();
    this.ctl = ctl;
    const kill = setTimeout(() => ctl.abort(), 10_000);
    const t0 = Date.now();
    let wait = Math.max(250, Number(r.refreshMs) || 1000);
    try {
      const blob = await this.source(++this.n, ctl.signal);
      if (this.ring !== r) return;
      if (!blob) {
        // nothing more to show for this ring (it ended, or there is no camera): keep the last picture until it ends
        this.stopped = true;
        return;
      }
      await this.swap(blob);
      if (this.ring !== r) return;
      this.lastFrameAt = Date.now();
      this.failed = false;
    } catch {
      if (this.ring !== r) return;
      this.failed = true;
      wait = Math.max(wait, RETRY_MS);
    } finally {
      clearTimeout(kill);
      if (this.ctl === ctl) this.ctl = null;
    }
    this.paint();
    this.tickClock();
    // the refresh interval counts from the start of the request, so a slow camera does not slow it down further
    this.schedule(Math.max(0, wait - (Date.now() - t0)));
  }

  /** Decode the new frame off screen, then flip the two images, so the picture never flickers. */
  private async swap(blob: Blob): Promise<void> {
    const back = (1 - this.front) as 0 | 1;
    const url = URL.createObjectURL(blob);
    const img = this.imgs[back];
    this.setUrl(back, url);
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('bad frame');
    }
    img.classList.add('on');
    this.imgs[this.front].classList.remove('on');
    this.front = back;
    if (!ctx.lite) this.back.src = url;
  }

  private setUrl(i: 0 | 1, url: string): void {
    if (this.urls[i]) URL.revokeObjectURL(this.urls[i]);
    this.urls[i] = url;
    if (!url) {
      this.imgs[i].removeAttribute('src');
      this.imgs[i].classList.remove('on');
      this.back.removeAttribute('src');
    }
  }
}
