// Conditions of Personalizado items ("Mostrar solo si", core/canvasCore.js conditionHidden): which items of a screen
// are hidden right now, worked out here from the mirrored Home Assistant states (haLive.js) and the stored values
// (values.js), so an item its condition hides gets no states and no values, and a display only learns which item
// ids to leave out (never the entity, the key or the value the condition reads).
// The two feeds tell each other when a condition they own may have changed (conditionChanged), so the other one
// sends its screens again: a value can hide a Home Assistant card and a door can hide a Valor card.
import { conditionEntities, conditionHidden, conditionKeys, scheduleHidden } from './core/canvasCore.js';
import { screenPrivacy } from './privacy.js';

let haState = () => null;
let valueOf = () => null;
const listeners = new Set();

/** Where conditions read from: `ha(entity)` → the state string or null, `value(key)` → the value or null. */
export function setConditionSource(src) {
  if (typeof src.ha === 'function') haState = src.ha;
  if (typeof src.value === 'function') valueOf = src.value;
}

/** True when a screen has an item with a condition (its displays get the list of hidden items). */
export function hasConditions(screen) {
  return conditionEntities(screen).size > 0 || conditionKeys(screen).size > 0;
}

/**
 * The ids of a screen's items hidden now by their schedule ("Horario") or by their condition (every item with a
 * condition while the screen is private): they get no states, no values and no data.
 */
export function hiddenItems(cfg, screen, now = new Date()) {
  const out = scheduleHidden(screen, now, cfg?.datetime?.timezone || 'UTC');
  if (!hasConditions(screen)) return out;
  for (const id of conditionHidden(screen, { ha: (e) => haState(e), value: (k) => valueOf(k), isPrivate: screenPrivacy(cfg, screen).active })) out.add(id);
  return out;
}

const lastHide = new Map(); // screen id → the ids its conditions hid when last worked out

/**
 * True when the items a screen's conditions hide are not the ones of the last call (and remembers them): a source
 * that changed without changing what is hidden (a power reading going on climbing) sends nothing, so a display
 * never learns when an entity or a value it does not show changes, and screens are not sent everything again on
 * every reading. Only the conditions count here (schedules and privacy send their own changes).
 */
export function hideChanged(cfg, screen) {
  const ids = hasConditions(screen)
    ? conditionHidden(screen, { ha: (e) => haState(e), value: (k) => valueOf(k), isPrivate: screenPrivacy(cfg, screen).active })
    : new Set();
  const key = [...ids].sort().join(',');
  if (lastHide.get(screen.id) === key) return false;
  lastHide.set(screen.id, key);
  return true;
}

/** A config save (or a restart): what was last hidden is worked out again from scratch. */
export function forgetHide() {
  lastHide.clear();
}

/** `fn(screenIds, src)` after a condition of those screens may have changed ('ha' or 'value'). Returns an unsubscribe. */
export function onConditionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function conditionChanged(screenIds, src) {
  if (!screenIds.length) return;
  for (const fn of listeners) {
    try {
      fn(screenIds, src);
    } catch (err) {
      console.warn('[conditions]', err.message);
    }
  }
}
