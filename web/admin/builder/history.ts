// Undo and redo of the builder: up to 50 steps. Changes made one after another on the same field (a slider being
// dragged, a title being typed) merge into one step, so one undo takes the whole gesture back.

export const HISTORY_MAX = 50;
/** Changes with the same merge key closer than this merge into one step. */
export const MERGE_MS = 1200;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** merge key and time of the last change */
  last: { key: string; at: number } | null;
}

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], last: null });

/** Record `next` as the new present. `key`: changes with the same key in a row merge into one step. */
export function push<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (next === h.present) return h;
  const merge = !!key && !!h.last && h.last.key === key && now - h.last.at < MERGE_MS && h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-HISTORY_MAX);
  return { past, present: next, future: [], last: key ? { key, at: now } : null };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], last: null };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), last: null };
}
