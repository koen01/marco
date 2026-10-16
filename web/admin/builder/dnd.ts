// The builder's drag engine: Pointer Events only (mouse, pen and touch), no library. One gesture per pointer:
// - mouse and pen: a press that moves more than a few pixels becomes a drag; a press that does not is a tap;
// - touch: a press held still for 250 ms becomes a drag (so a quick tap selects and a swipe is not a drag);
// - Escape, or the pointer being taken away (pointercancel), cancels the drag.
// The pointer is captured on the element that started it, so the drag keeps working over the preview iframe.

export const LONG_PRESS_MS = 250;
const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;

export interface GestureHandlers {
  /** touch must hold still before a drag starts (default true) */
  longPress?: boolean;
  onTap?(e: PointerEvent): void;
  /** the drag starts: return false to refuse it (the gesture then ends) */
  onStart(e: PointerEvent): boolean | void;
  onMove(e: PointerEvent): void;
  onEnd(e: PointerEvent): void;
  onCancel(): void;
}

/** Follow one pointer from its pointerdown on `el`. Returns a function that stops following it. */
export function gesture(down: PointerEvent, el: HTMLElement, h: GestureHandlers): () => void {
  if (down.pointerType === 'mouse' && down.button !== 0) return () => {};
  const touch = down.pointerType === 'touch';
  const sx = down.clientX;
  const sy = down.clientY;
  let state: 'pending' | 'drag' | 'done' = 'pending';
  let timer = 0;
  try {
    el.setPointerCapture(down.pointerId);
  } catch {
    /* an element that is not in the page any more */
  }
  const begin = (e: PointerEvent) => {
    if (state !== 'pending') return;
    if (h.onStart(e) === false) return stop();
    state = 'drag';
    if (touch) navigator.vibrate?.(8);
  };
  const stop = () => {
    if (state === 'done') return;
    state = 'done';
    clearTimeout(timer);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('keydown', key, true);
    try {
      el.releasePointerCapture(down.pointerId);
    } catch {
      /* already released */
    }
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    const d = Math.hypot(e.clientX - sx, e.clientY - sy);
    if (state === 'pending') {
      if (touch && h.longPress !== false) {
        // moving before the long press: not a drag (and not a tap)
        if (d > TOUCH_SLOP) stop();
        return;
      }
      if (d > (touch ? TOUCH_SLOP : MOUSE_SLOP)) begin(e);
      if ((state as string) !== 'drag') return;
    }
    e.preventDefault();
    h.onMove(e);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    const was = state;
    stop();
    if (was === 'drag') h.onEnd(e);
    else if (was === 'pending') h.onTap?.(e);
  };
  const cancel = () => {
    const was = state;
    stop();
    if (was === 'drag') h.onCancel();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || state !== 'drag') return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('lostpointercapture', cancel);
  window.addEventListener('keydown', key, true);
  if (touch && h.longPress !== false) {
    timer = window.setTimeout(() => {
      if (state !== 'pending') return;
      begin(down);
      if ((state as string) === 'drag') h.onMove(down);
    }, LONG_PRESS_MS);
  }
  return stop;
}
