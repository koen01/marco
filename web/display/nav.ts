// Navigation on touch screens (the Personalizado "Navegación" cards and the swipe; docs/ARCHITECTURE.md). Pure: no
// DOM and no fetches (main.ts passes them in), so the tests run it with a fake clock (server/test/display-nav.test.js).
//
// - planNav() decides what a tap on "Ir a pantalla" does on this display: back home, jump to a step of the carousel
//   it runs (that step starts its time again and the carousel goes on from there), or show a screen outside it and
//   stay there.
// - NavMemo is the only thing kept, and only in this browser (localStorage): a screen shown by touch or a paused
//   carousel, with the time it ends. Nothing is written to the server on a tap.
// - "Volver solo tras X min sin tocar": every touch on the screen pushes that time forward; when it passes, the
//   display goes back to its own screen or carousel (expire). 0 minutes: it stays until someone taps Inicio.

/** What a tap does (planNav). */
export type NavPlan =
  | { do: 'home' }
  | { do: 'jump'; index: number }
  | { do: 'visit'; screenId: string }
  | { do: 'none' };

export interface NavPlace {
  /** the screen this display is bound to, or '' when it runs a carousel */
  homeScreen: string;
  /** the carousel's steps (screen ids, in order), or null on a single screen */
  steps: string[] | null;
  /** the carousel rotates now (inside its schedule, not held at night) */
  rotating: boolean;
  /** the screen on display now */
  current: string;
  /** the step on display now (-1 outside the steps) */
  index: number;
}

/** What a tap on "Ir a pantalla" with `target` (a screen id or 'home') does here. */
export function planNav(target: string, at: NavPlace): NavPlan {
  if (!target) return { do: 'none' };
  if (target === 'home') return { do: 'home' };
  if (at.steps) {
    if (at.rotating) {
      // the step on display when it is that screen (its time starts again), else the first step that shows it
      if (at.index >= 0 && at.steps[at.index] === target) return { do: 'jump', index: at.index };
      const i = at.steps.indexOf(target);
      if (i >= 0) return { do: 'jump', index: i };
    }
    return target === at.current ? { do: 'none' } : { do: 'visit', screenId: target };
  }
  if (target === at.homeScreen) return { do: 'home' };
  return target === at.current ? { do: 'none' } : { do: 'visit', screenId: target };
}

export type NavMode = 'visit' | 'pause';

/** What this browser keeps of a navigation (localStorage). */
export interface NavMemo {
  v: 1;
  mode: NavMode;
  /** the screen shown ('visit'); '' for a pause */
  screenId: string;
  /** "Volver solo tras": minutes without a touch (0 = it stays) */
  returnMin: number;
  /** when it ends (ms, Date.now), null = it stays */
  until: number | null;
  /** what the display was bound to when it started: a memo of another binding is dropped */
  home: string;
}

export interface NavDeps {
  now(): number;
  load(): unknown;
  save(m: NavMemo | null): void;
  /** the time passed with no touch: go back to the display's own screen or carousel */
  expire(m: NavMemo): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** Writes of a pushed-forward end are kept to one every this many ms (a finger on a slider touches a lot). */
export const NAV_SAVE_EVERY = 15_000;
/** The longest a timer waits in one go (timers drift over hours; it is armed again). */
const MAX_WAIT = 6 * 3600_000;

/** A stored memo when it is well formed, of this binding and not over yet; else null. */
export function readMemo(raw: unknown, home: string, now: number): NavMemo | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<NavMemo>;
  if (m.v !== 1 || (m.mode !== 'visit' && m.mode !== 'pause') || m.home !== home) return null;
  if (typeof m.screenId !== 'string' || (m.mode === 'visit' && !m.screenId)) return null;
  const returnMin = Number(m.returnMin);
  if (!Number.isFinite(returnMin) || returnMin < 0) return null;
  const until = m.until === null ? null : Number(m.until);
  if (until !== null && (!Number.isFinite(until) || until <= now)) return null;
  return { v: 1, mode: m.mode, screenId: m.screenId, returnMin, until, home };
}

/** The navigation this display is in (a visit or a pause), its end and the idle timer. */
export class NavIdle {
  private memo: NavMemo | null = null;
  private timer: unknown = null;
  private savedAt = 0;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (t: unknown) => void;

  constructor(private home: string, private d: NavDeps) {
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = d.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  get current(): NavMemo | null {
    return this.memo;
  }

  /** The memo kept from before a reload, when it still holds (it is armed again). */
  restore(): NavMemo | null {
    let m: NavMemo | null = null;
    try {
      m = readMemo(this.d.load(), this.home, this.d.now());
    } catch {
      m = null;
    }
    if (!m) {
      this.d.save(null);
      return null;
    }
    this.memo = m;
    this.arm();
    return m;
  }

  /** A visit or a pause starts (a tap). `returnMin` 0: it stays until home. */
  start(mode: NavMode, screenId: string, returnMin: number): NavMemo {
    const now = this.d.now();
    const min = Number.isFinite(returnMin) && returnMin > 0 ? returnMin : 0;
    this.memo = { v: 1, mode, screenId: mode === 'visit' ? screenId : '', returnMin: min, until: min ? now + min * 60_000 : null, home: this.home };
    this.savedAt = now;
    this.d.save(this.memo);
    this.arm();
    return this.memo;
  }

  /** Someone touched the screen: the end moves to `returnMin` from now. */
  touched(): void {
    const m = this.memo;
    if (!m || !m.returnMin) return;
    const now = this.d.now();
    m.until = now + m.returnMin * 60_000;
    if (now - this.savedAt >= NAV_SAVE_EVERY) {
      this.savedAt = now;
      this.d.save(m);
    }
    this.arm();
  }

  /** It ended (home, the carousel went on, a new binding): forget it. */
  clear(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    if (!this.memo) return;
    this.memo = null;
    this.d.save(null);
  }

  private arm(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const m = this.memo;
    if (!m || m.until === null) return;
    const wait = Math.max(0, m.until - this.d.now());
    this.timer = this.setTimer(() => {
      this.timer = null;
      const cur = this.memo;
      if (!cur || cur.until === null) return;
      if (cur.until > this.d.now() + 50) return this.arm();
      this.memo = null;
      this.d.save(null);
      this.d.expire(cur);
    }, Math.min(wait, MAX_WAIT));
  }
}

/** A swipe: at least this far sideways (px, or 12 % of the width when that is less), mostly sideways, quick. */
export const SWIPE_MIN_PX = 80;
export const SWIPE_MAX_MS = 900;

/** -1 (to the left: the next screen), 1 (to the right: the previous one) or 0 (not a swipe). */
export function swipeDir(dx: number, dy: number, ms: number, width = 1920): -1 | 0 | 1 {
  const min = Math.min(SWIPE_MIN_PX, Math.max(40, width * 0.12));
  if (ms > SWIPE_MAX_MS || Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 2) return 0;
  return dx < 0 ? -1 : 1;
}
