// Taps on the Home Assistant controls of a Personalizado screen (docs/ARCHITECTURE.md). One set of delegated pointer
// listeners on #canvas and #canvas-side, attached only while taps may reach Home Assistant (the screen allows touch,
// the server answers, the screen is not private, and this is not the admin's preview: haFeed.ts touch()). The cards
// draw their controls with data attributes (widgets/ha/haui.ts); this file turns them into actions:
//
// - a tap (`data-ctl`): one action, at most one every 600 ms per control against a bouncing finger;
// - −/+ (`data-d`): the new setpoint (or number) shows at once and goes out 700 ms after the last tap;
// - a slider (`data-slide`): dragged anywhere on its track, the value shows at once, goes out at most every
//   300 ms while the finger moves and once more when it lifts;
// - an item that needs two taps (HaState.cf): the first tap arms that control for 3 s ("Toca otra vez o mantén
//   pulsado"), the second one sends it with `confirm`; pressing and holding a button for 0.7 s does the same in one go.
//
// While night mode dims the screen, a tap only wakes it (main.ts lifts the dimming for a minute): nobody can see what
// they would press.
import type { HaControl } from '../../../shared/types';
import type { HaFeed } from '../../haFeed';

const TAP_LOCK_MS = 600;
const STEP_MS = 700;
const SLIDE_MS = 300;
const HOLD_MS = 700;

/** What the screen around the cards does for a tap (main.ts). */
export interface TouchHost {
  /** night mode dims the screen right now */
  dimmed(): boolean;
  /** a tap on a dimmed screen: lift the dimming for a while (and again on every tap while it is lifted) */
  wake(): void;
}

interface Hold {
  pointer: number;
  el: HTMLElement;
  alias: string;
  control: HaControl;
  value: unknown;
  key: string;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  done: boolean;
}

interface Drag {
  el: HTMLElement;
  pointer: number;
  root: HTMLElement;
  alias: string;
  control: HaControl;
  min: number;
  max: number;
  step: number;
  rect: DOMRect;
  value: number;
  sentAt: number;
  sent: number | null;
  confirm: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export class HaTouch {
  private on = false;
  private locks = new Map<string, number>();
  private drag: Drag | null = null;
  private steps = new Map<string, { value: number | [number, number]; timer: ReturnType<typeof setTimeout>; confirm: boolean }>();
  private hold: Hold | null = null;
  /** the pointer whose tap woke a dimmed screen: its lift does nothing */
  private waking: number | null = null;

  constructor(private roots: HTMLElement[], private feed: HaFeed, private host: TouchHost = { dimmed: () => document.documentElement.classList.contains('night'), wake: () => {} }) {}

  get active(): boolean {
    return this.on;
  }

  /** Listen or stop listening (taps only reach Home Assistant while this is on). */
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    for (const r of this.roots) {
      const m = on ? 'addEventListener' : 'removeEventListener';
      r[m]('pointerdown', this.down as EventListener);
      r[m]('pointermove', this.move as EventListener);
      r[m]('pointerup', this.up as EventListener);
      r[m]('pointercancel', this.cancel as EventListener);
      r.classList.toggle('ha-touch', on);
    }
    if (!on) {
      this.endDrag(false);
      this.endHold();
    }
  }

  private dimmed(): boolean {
    return this.host.dimmed();
  }

  /** A button's control, alias and value (data-ctl, data-a, data-v), or null. */
  private ctlOf(el: HTMLElement): { alias: string; control: HaControl; value: unknown; key: string } | null {
    const alias = el.dataset.a || '';
    const control = el.dataset.ctl as HaControl;
    if (!alias || !control) return null;
    let value: unknown;
    if (el.dataset.v !== undefined) {
      try {
        value = JSON.parse(el.dataset.v);
      } catch {
        return null;
      }
    }
    return { alias, control, value, key: `${alias}|${control}${value !== undefined ? `|${value}` : ''}` };
  }

  /** Lock a control for 600 ms (a bouncing finger). False when it is locked already. */
  private lock(key: string): boolean {
    const now = Date.now();
    if (now - (this.locks.get(key) ?? 0) < TAP_LOCK_MS) return false;
    this.locks.set(key, now);
    if (this.locks.size > 200) this.locks.clear();
    return true;
  }

  private endHold(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.timer);
    this.hold.el.classList.remove('is-holding');
    this.hold = null;
  }

  /** A button of an item that needs two taps, pressed: held for 0.7 s, it goes at once with `confirm`. */
  private startHold(e: PointerEvent, el: HTMLElement): void {
    const c = this.ctlOf(el);
    if (!c || el.dataset.d !== undefined || !this.feed.state(c.alias)?.cf) return;
    this.endHold();
    el.classList.add('is-holding');
    const h: Hold = {
      pointer: e.pointerId, el, ...c, x: e.clientX, y: e.clientY, done: false,
      timer: setTimeout(() => {
        h.done = true;
        h.el.classList.remove('is-holding');
        if (!this.on || !this.lock(h.key)) return;
        this.feed.disarm(this.itemOf(h.alias));
        this.feed.send(h.alias, h.control, h.value, true);
      }, HOLD_MS),
    };
    this.hold = h;
  }

  /** The item id of an alias (`${itemId}:${n}`). */
  private itemOf(alias: string): string {
    return alias.split(':')[0];
  }

  /** True when this tap may go: the item does not need two taps, or this is the second one. */
  private confirmed(alias: string, key: string): boolean | null {
    const s = this.feed.state(alias);
    if (!s?.cf) return false;
    return this.feed.arm(this.itemOf(alias), key) ? true : null;
  }

  private down = (e: PointerEvent): void => {
    if (!this.on || this.drag) return;
    if (this.dimmed()) {
      // the first tap on a dimmed screen only wakes it
      this.waking = e.pointerId;
      this.host.wake();
      return;
    }
    this.waking = null;
    this.host.wake();
    const root = e.currentTarget as HTMLElement;
    const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ctl]');
    if (btn && root.contains(btn)) return this.startHold(e, btn);
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-slide]');
    if (!el || !root.contains(el)) return;
    const alias = el.dataset.a || '';
    const control = el.dataset.slide as HaControl;
    if (!alias || !control) return;
    const c = this.confirmed(alias, `${alias}|${control}`);
    if (c === null) return; // the first of two taps: armed, nothing moves yet
    e.preventDefault();
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);
    const step = Number(el.dataset.step) || 1;
    // the card is drawn again while the value changes: the pointer is held by the zone, which stays
    try {
      root.setPointerCapture(e.pointerId);
    } catch { /* an old browser: the moves still arrive while the finger stays on the zone */ }
    // the value it has now counts as sent: touching the slider without moving it sends nothing
    const now = Number(el.getAttribute('aria-valuenow'));
    this.drag = { el, pointer: e.pointerId, root, alias, control, min, max, step, rect: el.getBoundingClientRect(), value: NaN, sentAt: 0, sent: Number.isFinite(now) ? now : null, confirm: c, timer: null };
    this.slideTo(e.clientX, e.clientY);
  };

  private move = (e: PointerEvent): void => {
    // a finger that slides off a held button lets it go
    const h = this.hold;
    if (h && e.pointerId === h.pointer && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 24) this.endHold();
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    e.preventDefault();
    this.slideTo(e.clientX, e.clientY);
  };

  private up = (e: PointerEvent): void => {
    if (this.drag) {
      if (e.pointerId === this.drag.pointer) {
        this.slideTo(e.clientX, e.clientY);
        this.endDrag(true);
      }
      return;
    }
    if (this.waking === e.pointerId) {
      this.waking = null;
      return;
    }
    const held = this.hold && this.hold.pointer === e.pointerId ? this.hold : null;
    if (held) {
      this.endHold();
      if (held.done) return; // it went when the hold ended
    }
    if (!this.on || this.dimmed()) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-ctl]');
    const root = e.currentTarget as HTMLElement;
    if (!el || !root.contains(el)) return;
    const ctl = this.ctlOf(el);
    if (!ctl) return;
    const { alias, control, value, key } = ctl;
    if (el.dataset.d !== undefined) return this.stepBy(alias, control, Number(el.dataset.d), el.dataset.which || '');
    if (!this.lock(key)) return;
    const c = this.confirmed(alias, key);
    if (c === null) return;
    this.feed.send(alias, control, value, c);
  };

  private cancel = (e: PointerEvent): void => {
    if (this.drag && e.pointerId === this.drag.pointer) this.endDrag(true);
    if (this.hold && e.pointerId === this.hold.pointer) this.endHold();
    if (this.waking === e.pointerId) this.waking = null;
  };

  /** The slider value under the finger: shown at once, sent at most every 300 ms. */
  private slideTo(x: number, y: number): void {
    const d = this.drag;
    if (!d || !d.rect.width) return;
    // a vertical slider (the cover's shutter): the top is the most, the bottom the least
    const vert = d.el.dataset.dir === 'v';
    if (vert && !d.rect.height) return;
    const f = vert ? Math.max(0, Math.min(1, (d.rect.bottom - y) / d.rect.height)) : Math.max(0, Math.min(1, (x - d.rect.left) / d.rect.width));
    const raw = d.min + f * (d.max - d.min);
    const v = Math.round(Math.round(raw / d.step) * d.step * 1000) / 1000;
    if (v === d.value) return;
    d.value = v;
    this.feed.show(d.alias, d.control, v);
    const now = Date.now();
    if (now - d.sentAt >= SLIDE_MS) this.sendDrag();
    else if (!d.timer) d.timer = setTimeout(() => this.sendDrag(), SLIDE_MS - (now - d.sentAt));
  }

  private sendDrag(): void {
    const d = this.drag;
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    if (!Number.isFinite(d.value) || d.value === d.sent) return;
    d.sentAt = Date.now();
    d.sent = d.value;
    this.feed.send(d.alias, d.control, d.value, d.confirm);
  }

  /** The finger lifted: the last value goes out (when it is not the one sent already). */
  private endDrag(send: boolean): void {
    const d = this.drag;
    if (!d) return;
    if (send) this.sendDrag();
    if (d.timer) clearTimeout(d.timer);
    try {
      d.root.releasePointerCapture(d.pointer);
    } catch { /* already released */ }
    this.drag = null;
  }

  /** −/+ on a climate or a number: the new value at once, sent 700 ms after the last tap. */
  private stepBy(alias: string, control: HaControl, delta: number, which: string): void {
    const s = this.feed.state(alias);
    if (!Number.isFinite(delta)) return;
    if (control === 'numberSet' && s?.d === 'sensor') return this.stepNumber(alias, s, delta);
    // the light's brightness ring: one step at a time, at once (a dark light starts from nothing)
    if (control === 'brightness' && s?.d === 'light') {
      const key = `${alias}|brightness`;
      if (!this.lock(key)) return;
      const c = this.confirmed(alias, key);
      if (c === null) return;
      const from = s.on ? s.bri ?? 100 : 0;
      this.feed.send(alias, 'brightness', Math.max(1, Math.min(100, from + delta)), c);
      return;
    }
    if (s?.d !== 'climate') return;
    const key = `${alias}|${control}`;
    const held = this.steps.get(alias);
    let confirm = held?.confirm ?? false;
    if (!held) {
      const c = this.confirmed(alias, key);
      if (c === null) return;
      confirm = c;
    }
    const snap = (v: number) => Math.round(Math.min(s.max, Math.max(s.min, Math.round(v / s.step) * s.step)) * 100) / 100;
    let value: number | [number, number];
    if (control === 'setpointRange') {
      if (s.lo === null || s.hi === null) return;
      let lo = s.lo;
      let hi = s.hi;
      if (which === 'lo') lo = snap(lo + delta);
      else hi = snap(hi + delta);
      if (lo >= hi) return;
      value = [lo, hi];
    } else {
      if (s.target === null) return;
      value = snap(s.target + delta);
    }
    this.feed.show(alias, control, value);
    if (held) clearTimeout(held.timer);
    const timer = setTimeout(() => {
      this.steps.delete(alias);
      this.feed.send(alias, control, value, confirm);
    }, STEP_MS);
    this.steps.set(alias, { value, timer, confirm });
  }

  /** −/+ on a number entity: within its range, on its step from its minimum. */
  private stepNumber(alias: string, s: Extract<ReturnType<HaFeed['state']>, { d: 'sensor' }>, delta: number): void {
    if (s.min === undefined || s.max === undefined) return;
    const key = `${alias}|numberSet`;
    const held = this.steps.get(alias);
    let confirm = held?.confirm ?? false;
    if (!held) {
      const c = this.confirmed(alias, key);
      if (c === null) return;
      confirm = c;
    }
    const step = s.step && s.step > 0 ? s.step : 1;
    const cur = typeof held?.value === 'number' ? held.value : s.num ?? s.min;
    const value = Math.round(Math.min(s.max, Math.max(s.min, Math.round((cur + delta - s.min) / step) * step + s.min)) * 1e6) / 1e6;
    this.feed.show(alias, 'numberSet', value);
    if (held) clearTimeout(held.timer);
    const timer = setTimeout(() => {
      this.steps.delete(alias);
      this.feed.send(alias, 'numberSet', value, confirm);
    }, STEP_MS);
    this.steps.set(alias, { value, timer, confirm });
  }
}
