// F5 on the display: instant announcements (animated overlay cards + chime), scheduled message banners and
// the "identify" overlay. Everything here sits above the night dim layer and animates transform/opacity only.
import type { AlertStyle, Announcement, DisplayConfig, IdentifyPayload, ScheduledMessage } from '../../shared/types';
import { addDays, formatHM, weekdayOfKey } from '../../shared/i18n';
import { ctx } from '../ctx';
import { el, esc, reconcile, reducedMotion, type Spec } from '../dom';
import type { Tick } from '../time';
import { chime } from './chime';

const STYLES: AlertStyle[] = ['info', 'success', 'warning', 'urgent'];
const styleOf = (s: unknown): AlertStyle => (STYLES.includes(s as AlertStyle) ? (s as AlertStyle) : 'info');
const DEFAULT_EMOJI: Record<AlertStyle, string> = { info: '🔔', success: '✅', warning: '⚠️', urgent: '🚨' };

/** Server clock offset (server − local, ms), from `hello.now` / heartbeat responses. */
let serverOffset = 0;
export function setServerNow(iso: string | undefined): void {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(t)) serverOffset = t - Date.now();
}
export const serverNow = () => Date.now() + serverOffset;

// ---------------------------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------------------------

interface Live {
  a: Announcement;
  el: HTMLElement;
  expiresMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
  compact: boolean;
  /** a carousel waits for it until then (ms): urgent ones never settle into the corner, so the wait is capped */
  holdUntil: number;
}

/** Non-urgent announcements stay big for this long, then settle into a compact corner toast. */
const EXPANDED_MS = 60_000;
const MAX_STACK = 3;

export class Announcements {
  private root: HTMLElement;
  private center: HTMLElement;
  private corner: HTMLElement;
  private dim: HTMLElement;
  private live = new Map<string, Live>();
  /** ids already seen (so a replay after reconnect never re-chimes); bounded */
  private seen = new Set<string>();

  constructor(root: HTMLElement) {
    this.root = root;
    root.innerHTML = '<div class="an-dim"></div><div class="an-center"></div><div class="an-corner"></div>';
    this.dim = root.querySelector('.an-dim')!;
    this.center = root.querySelector('.an-center')!;
    this.corner = root.querySelector('.an-corner')!;
  }

  get count(): number {
    return this.live.size;
  }

  /** Called after announcements come or go (a Personalizado announcement card shows the newest). */
  onChange: (() => void) | null = null;

  /** The newest announcement on screen, or null. */
  newest(): Announcement | null {
    let best: Live | null = null;
    for (const lv of this.live.values()) if (!best || Date.parse(lv.a.createdAt) > Date.parse(best.a.createdAt)) best = lv;
    return best ? best.a : null;
  }

  /**
   * A Personalizado screen with an announcement card: the settled corner toast is left out there (the card shows
   * it), the big entrance stays.
   */
  setDocked(on: boolean): void {
    this.root.classList.toggle('an-docked', on);
  }

  /**
   * Announcements shown big right now (not yet settled into the corner): a carousel waits for them, but never past
   * `holdUntil` (an urgent one stays big until it expires, up to 24 h).
   */
  get expandedCount(): number {
    const now = serverNow();
    let n = 0;
    for (const lv of this.live.values()) if (!lv.compact && now < lv.holdUntil) n++;
    return n;
  }

  /** Show (or update) an announcement. Ignored when alerts are disabled on this screen or already expired. */
  show(raw: Announcement): void {
    const alerts = ctx.cfg.alerts;
    if (alerts && !alerts.enabled) return;
    if (!raw || typeof raw.id !== 'string') return;
    if (raw.clearedAt) return this.clear(raw.id);
    const a: Announcement = { ...raw, style: styleOf(raw.style) };
    const created = Date.parse(a.createdAt);
    let expires = Date.parse(a.expiresAt);
    if (!Number.isFinite(expires)) expires = (Number.isFinite(created) ? created : serverNow()) + (a.durationSec || 30) * 1000;
    const remaining = expires - serverNow();
    if (remaining <= 250) return;
    const known = this.live.get(a.id);
    const fresh = !this.seen.has(a.id);
    this.seen.add(a.id);
    if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value as string);

    if (known) {
      known.a = a;
      known.expiresMs = expires;
      this.fill(known);
      this.arm(known);
      this.onChange?.();
      return;
    }
    // Replayed (reconnect / page load) announcements older than a minute start compact and silent.
    const age = Number.isFinite(created) ? serverNow() - created : 0;
    const node = el('div', `an an-${a.style}`);
    const lv: Live = {
      a, el: node, expiresMs: expires, timer: null, settleTimer: null, compact: a.style !== 'urgent' && age > EXPANDED_MS,
      holdUntil: Math.max((Number.isFinite(created) ? created : serverNow()) + EXPANDED_MS, serverNow() + 15_000),
    };
    this.fill(lv);
    this.live.set(a.id, lv);
    this.arm(lv);
    this.layout(true, lv);
    if (fresh && a.sound && alerts?.sound !== false && age < 15_000) chime(a.style, alerts?.volume ?? 0.6);
  }

  clear(id: string | null): void {
    const ids = id === null ? [...this.live.keys()] : [id];
    for (const k of ids) {
      const lv = this.live.get(k);
      if (!lv) continue;
      this.live.delete(k);
      if (lv.timer) clearTimeout(lv.timer);
      if (lv.settleTimer) clearTimeout(lv.settleTimer);
      this.leave(lv.el);
    }
    this.layout(false);
  }

  /**
   * Reconnect: the server sends the ids still active for this screen. Anything else on screen was
   * cleared (or expired) while the stream was down, and its announce-clear event was lost.
   */
  sync(activeIds: string[]): void {
    const keep = new Set(activeIds);
    for (const id of [...this.live.keys()]) if (!keep.has(id)) this.clear(id);
  }

  /** Alerts disabled on this screen (config change) → remove everything. */
  applyConfig(cfg: DisplayConfig): void {
    if (cfg.alerts && !cfg.alerts.enabled && this.live.size) this.clear(null);
  }

  private fill(lv: Live): void {
    const { a } = lv;
    const emoji = a.emoji || DEFAULT_EMOJI[a.style];
    // "La lavadora ha terminado 🧺" + emoji 🧺 → the big emoji already says it; drop the repeat from the title
    let title = (a.title || '').trim();
    if (a.emoji && title.endsWith(a.emoji)) title = title.slice(0, -a.emoji.length).trim();
    else if (a.emoji && title.startsWith(a.emoji)) title = title.slice(a.emoji.length).trim();
    lv.el.className = `an an-${a.style}${lv.compact ? ' compact' : ''}`;
    lv.el.innerHTML = `<div class="an-glow"></div>
      <div class="an-em">${esc(emoji)}</div>
      <div class="an-txt">${title ? `<div class="an-title">${esc(title)}</div>` : ''}${a.body ? `<div class="an-body">${esc(a.body)}</div>` : ''}</div>
      <div class="an-bar"><i></i></div>`;
    this.progress(lv);
  }

  /** Progress bar: remaining fraction → 0, as a single compositor animation. */
  private progress(lv: Live): void {
    const bar = lv.el.querySelector('.an-bar i') as HTMLElement | null;
    if (!bar) return;
    const total = Math.max(1000, (lv.a.durationSec || 30) * 1000);
    const remaining = Math.max(0, lv.expiresMs - serverNow());
    const frac = Math.min(1, remaining / total);
    bar.style.transform = `scaleX(${frac})`;
    if (reducedMotion() || remaining <= 0) return;
    bar.animate([{ transform: `scaleX(${frac})` }, { transform: 'scaleX(0)' }], { duration: remaining, easing: 'linear', fill: 'forwards' });
  }

  private arm(lv: Live): void {
    if (lv.timer) clearTimeout(lv.timer);
    if (lv.settleTimer) clearTimeout(lv.settleTimer);
    const remaining = lv.expiresMs - serverNow();
    // setTimeout is capped at ~24.8 days; durations are ≤ 24 h anyway.
    lv.timer = setTimeout(() => this.clear(lv.a.id), Math.min(Math.max(0, remaining), 2 ** 31 - 1));
    if (!lv.compact && lv.a.style !== 'urgent') {
      const created = Date.parse(lv.a.createdAt);
      const shownFor = Number.isFinite(created) ? serverNow() - created : 0;
      const until = Math.max(15_000, EXPANDED_MS - shownFor);
      if (remaining > until + 5_000) {
        lv.settleTimer = setTimeout(() => {
          lv.settleTimer = null;
          if (!this.live.has(lv.a.id)) return;
          lv.compact = true;
          this.leave(lv.el);
          const fresh = el('div', '');
          lv.el = fresh;
          this.fill(lv);
          this.layout(true, lv);
        }, until);
      }
    }
  }

  private leave(node: HTMLElement): void {
    if (reducedMotion() || !node.isConnected) {
      node.remove();
      return;
    }
    node.classList.add('leaving');
    const a = node.animate(
      [{ opacity: getComputedStyle(node).opacity, transform: node.style.transform || 'none' },
        { opacity: 0, transform: `${node.style.transform || ''} translateY(-2rem) scale(.94)` }],
      { duration: 520, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' },
    );
    a.onfinish = () => node.remove();
  }

  /** Position the stacks: newest on top; older expanded cards collapse behind it. */
  private layout(animateNew: boolean, newest?: Live): void {
    const all = [...this.live.values()].sort((x, y) => Date.parse(y.a.createdAt) - Date.parse(x.a.createdAt));
    const big = all.filter((l) => !l.compact).slice(0, MAX_STACK);
    const small = all.filter((l) => l.compact).slice(0, MAX_STACK);
    const hidden = all.filter((l) => !big.includes(l) && !small.includes(l));
    for (const l of hidden) l.el.style.display = 'none';

    big.forEach((l, i) => {
      if (l.el.parentElement !== this.center) this.center.appendChild(l.el);
      l.el.style.display = '';
      l.el.style.zIndex = String(10 - i);
      l.el.style.transform = i === 0 ? 'none' : `translateY(${-i * 2.6}rem) scale(${1 - i * 0.06})`;
      l.el.classList.toggle('behind', i > 0);
    });
    small.forEach((l, i) => {
      if (l.el.parentElement !== this.corner) this.corner.appendChild(l.el);
      l.el.style.display = '';
      l.el.style.zIndex = String(10 - i);
      l.el.style.order = String(i);
      l.el.style.transform = '';
      l.el.classList.remove('behind');
    });

    this.onChange?.();
    const urgent = big.some((l) => l.a.style === 'urgent');
    this.dim.classList.toggle('on', urgent || big.length > 0);
    this.dim.classList.toggle('urgent', urgent);
    this.root.classList.toggle('has-big', big.length > 0);

    if (animateNew && newest && !reducedMotion()) {
      newest.el.animate(
        newest.compact
          ? [{ opacity: 0, transform: 'translateX(3rem)' }, { opacity: 1, transform: 'none' }]
          : [{ opacity: 0, transform: 'translateY(4rem) scale(.9)' }, { opacity: 1, transform: 'none' }],
        { duration: 700, easing: 'cubic-bezier(.16,1.12,.3,1)' },
      );
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Scheduled messages (§5.3), evaluated locally every minute
// ---------------------------------------------------------------------------------------------

type Sched = Omit<ScheduledMessage, 'screenIds'>;

function hm(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? +m[1] * 60 + +m[2] : -1;
}

function dayOk(s: Sched, day: string): boolean {
  if (s.days?.length && !s.days.includes(weekdayOfKey(day))) return false;
  if (s.startDate && day < s.startDate) return false;
  if (s.endDate && day > s.endDate) return false;
  return true;
}

/** Active window for `s` at local minute `n` of `today`, or null. `endsAt` = minutes since today's midnight. */
export function scheduleWindow(s: Sched, today: string, n: number): { start: number; endsAt: number } | null {
  if (!s || s.enabled === false) return null;
  const f = hm(s.from), t = hm(s.to);
  if (f < 0 || t < 0 || f === t) return null;
  if (f < t) return dayOk(s, today) && n >= f && n < t ? { start: f, endsAt: t } : null;
  if (dayOk(s, today) && n >= f) return { start: f, endsAt: t + 1440 };
  if (dayOk(s, addDays(today, -1)) && n < t) return { start: f - 1440, endsAt: t };
  return null;
}

export class ScheduleBanners {
  private active = new Set<string>();

  constructor(private card: HTMLElement, private strip: HTMLElement) {
    card.classList.add('sched-wrap');
    strip.classList.add('sched-strip');
  }

  /** Re-evaluate; returns true when the visible set changed. */
  render(tick: Tick): boolean {
    const cfg = ctx.cfg;
    const on = cfg.alerts?.enabled !== false;
    const n = tick.parts.hour * 60 + tick.parts.minute;
    const list: { s: Sched; endsAt: number; start: number }[] = [];
    if (on) {
      for (const s of cfg.schedules ?? []) {
        const w = scheduleWindow(s, tick.dayKey, n);
        if (w) list.push({ s, ...w });
      }
    }
    const ids = new Set(list.map((x) => x.s.id));
    const changed = ids.size !== this.active.size || [...ids].some((id) => !this.active.has(id));
    // chime only when a window really opens (its start minute), never for one already running at page load
    // or that merely appeared because the config changed mid-window
    for (const x of list) {
      if (this.active.has(x.s.id)) continue;
      const justStarted = n - x.start <= 1;
      if (justStarted && x.s.sound && cfg.alerts?.sound !== false) chime(styleOf(x.s.style), cfg.alerts?.volume ?? 0.6);
    }
    this.active = ids;

    const f24 = cfg.datetime.format24, ampm = cfg.datetime.showAmPm;
    const specs = (v: string): Spec[] =>
      list.map(({ s, endsAt }) => {
        const st = styleOf(s.style);
        const end = ((endsAt % 1440) + 1440) % 1440;
        const until = ctx.t('until', { t: formatHM(Math.floor(end / 60), end % 60, f24, ampm) });
        return {
          key: `${v}${s.id}`,
          className: `sched sched-${st}`,
          html: `<span class="sched-em">${esc(s.emoji || DEFAULT_EMOJI[st])}</span><span class="sched-txt"><b>${esc(s.title)}</b>${
            s.body ? `<span class="sched-body">${esc(s.body)}</span>` : ''
          }</span><span class="sched-until">${esc(until)}</span>`,
        };
      });
    this.card.style.display = list.length ? '' : 'none';
    this.strip.style.display = list.length ? '' : 'none';
    reconcile(this.card, specs('c'), { flip: true });
    reconcile(this.strip, specs('s'), { flip: true });
    return changed;
  }
}

// ---------------------------------------------------------------------------------------------
// Identify overlay
// ---------------------------------------------------------------------------------------------

export class IdentifyOverlay {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private root: HTMLElement) {}

  show(p: Partial<IdentifyPayload>, fallback: { name: string; slug: string; clientId: string }): void {
    const name = (p.name || fallback.name || '').trim() || '–';
    const slug = (p.slug || fallback.slug || '').trim();
    const cid = (p.clientId || fallback.clientId || '').trim();
    const dur = Math.min(120, Math.max(3, Number(p.durationSec) || 10));
    const { t } = ctx;
    this.root.innerHTML = `<div class="id-card">
        <div class="id-kicker">${esc(t('identifyScreen'))}</div>
        <div class="id-name">${esc(name)}</div>
        <div class="id-meta">${slug ? `<span>?screen=<b>${esc(slug)}</b></span>` : ''}${
          cid ? `<span>${esc(t('identifyDevice'))} <b>…${esc(cid.slice(-6))}</b></span>` : ''
        }<span>${esc(`${window.innerWidth}×${window.innerHeight}`)}</span></div>
        <div class="id-bar"><i></i></div>
      </div>`;
    this.root.classList.add('show');
    const bar = this.root.querySelector('.id-bar i') as HTMLElement | null;
    if (bar && !reducedMotion()) bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: dur * 1000, easing: 'linear', fill: 'forwards' });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), dur * 1000);
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.root.classList.remove('show');
  }
}
