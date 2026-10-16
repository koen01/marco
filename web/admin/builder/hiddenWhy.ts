// Why a card is not on the screen right now, for the badge on the stage and the line in the inspector: hidden by
// hand, a kind this edition does not offer, a button on a screen that cannot be touched, no room in this orientation, outside its schedule, or its condition.
// The first reason that applies wins, in that order.
import type { CanvasItem } from '../../shared/types';
import { CANVAS_KINDS } from '../../../server/core/canvasCore.js';

export type HiddenWhy = 'hand' | 'edition' | 'touch' | 'orient' | 'schedule' | 'cond';

/** The badge (short) and the inspector line (long) of each reason, as t() keys. */
export const HIDDEN_TEXT: Record<HiddenWhy, { badge: string; long: string }> = {
  hand: { badge: 'Oculto', long: 'Oculto: no se ve en la pantalla, pero guarda su sitio.' },
  edition: { badge: 'No disponible', long: 'Este widget no está disponible en esta versión de Marco, así que la pantalla no lo muestra.' },
  touch: { badge: 'Sin tocar', long: 'No se ve en la pantalla: activa «Permitir tocar en la pantalla» en Página.' },
  orient: { badge: 'No sale en vertical', long: 'No cabe en vertical. Hazle sitio o ponlo más pequeño en horizontal.' },
  schedule: { badge: 'Fuera de horario', long: 'Ahora no se ve en la pantalla: está fuera de su horario.' },
  cond: { badge: 'Oculto ahora', long: 'Ahora no se ve en la pantalla: no se cumple la condición.' },
};

export function hiddenWhy(item: CanvasItem, ctx: { allowed: readonly string[]; omitted: Set<string>; portraitMatters: boolean; schedOff: Set<string>; condOff: Set<string>; touch?: boolean }): HiddenWhy | null {
  if (item.hidden) return 'hand';
  const k = CANVAS_KINDS[item.kind];
  if (!k || k.reserved || !ctx.allowed.includes(item.kind)) return 'edition';
  // the Navegación buttons need the screen's "Permitir tocar en la pantalla"
  if (k.taps && ctx.touch === false) return 'touch';
  if (ctx.portraitMatters && ctx.omitted.has(item.id)) return 'orient';
  if (ctx.schedOff.has(item.id)) return 'schedule';
  if (ctx.condOff.has(item.id)) return 'cond';
  return null;
}
