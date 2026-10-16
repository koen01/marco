// Second-aligned ticker shared by every time-dependent widget.
import { dateKeyInTz, zonedParts, type ZonedParts } from '../shared/i18n';

export interface Tick {
  now: Date;
  parts: ZonedParts;
  dayKey: string;
  minuteChanged: boolean;
  dayChanged: boolean;
}

type TickFn = (t: Tick) => void;
const subs = new Set<TickFn>();
let tz = 'Europe/Lisbon';
let lastMinute = -1;
let lastDay = '';
let timer: ReturnType<typeof setTimeout> | null = null;
let visBound = false;

/** Optional fixed clock offset (ms), e.g. ?now=2026-10-09T10:43 for screenshots. */
let offset = 0;
export function setClockOffset(ms: number) {
  offset = ms;
}
/** ?shot=1 with ?now=: the clock stands still at that moment (screenshots and golden fixtures). */
let frozenAt: number | null = null;
export function freezeClock(ms: number | null) {
  frozenAt = ms;
}
export const now = () => new Date(frozenAt ?? Date.now() + offset);

export function setTimezone(z: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: z });
    tz = z;
  } catch {
    tz = 'Europe/Lisbon';
  }
  lastDay = '';
}
export const getTimezone = () => tz;

export function current(): Tick {
  const n = now();
  const parts = zonedParts(n, tz);
  return { now: n, parts, dayKey: dateKeyInTz(n, tz), minuteChanged: false, dayChanged: false };
}

export function onTick(fn: TickFn): void {
  subs.add(fn);
}

function fire() {
  const t = current();
  const m = t.parts.hour * 60 + t.parts.minute;
  t.minuteChanged = m !== lastMinute;
  t.dayChanged = lastDay !== '' && t.dayKey !== lastDay;
  lastMinute = m;
  lastDay = t.dayKey;
  for (const fn of subs) {
    try {
      fn(t);
    } catch (e) {
      console.error('[tick]', e);
    }
  }
}

export function startTicker(): void {
  if (timer) return;
  const loop = () => {
    fire();
    const ms = now().getTime();
    timer = setTimeout(loop, 1000 - (ms % 1000) + 4);
  };
  loop();
  if (visBound) return;
  visBound = true;
  // Wake-up after the tab was hidden / the Pi resumed: re-sync immediately.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && timer) {
      clearTimeout(timer);
      timer = null;
      startTicker();
    }
  });
}
