// The one way Personalizado draws a curve (Cripto, Bolsa, Sensor, Gráfica): a line of one width and under it a fill
// that fades from the line's colour to nothing, so two charts on one screen match. The colour is the SVG's `color`
// (up and down for prices, the accent for a sensor, a series' own colour on a chart), the width and the fade are set
// once in styles-data.css (.cv-curve).
//
// "Estilo de la gráfica" (props.chartStyle): 'below' draws the chart in a band of its own under the numbers,
// 'background' fills the card with it, edge to edge and down to its bottom edge, behind the text (a list's rows each
// get their own, bleed()).
import { svgEl } from '../ha/haui';

export type ChartStyle = 'below' | 'background';

/** A card's chart style: what the owner chose, or the kind's own default. */
export const chartStyleOf = (p: Record<string, unknown>, def: ChartStyle): ChartStyle => (p.chartStyle === 'below' || p.chartStyle === 'background' ? p.chartStyle : def);

let seq = 0;

/**
 * A fade from the colour of its parent (`currentColor`) at the top of the shape it fills to nothing at the bottom.
 * `solid`: from the full colour (bars, which are the value themselves) to a trace of it. `span`: from y1 to y2 of the
 * drawing (every shape fades alike there) instead of over each shape's own height.
 */
export function fade(into: SVGElement, solid = false, span?: [number, number]): string {
  const id = `cvfade${++seq}`;
  const g = span
    ? svgEl('linearGradient', { id, x1: 0, y1: span[0], x2: 0, y2: span[1], gradientUnits: 'userSpaceOnUse' })
    : svgEl('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  g.append(svgEl('stop', { offset: 0, class: solid ? 'b0' : 'f0' }), svgEl('stop', { offset: 1, class: solid ? 'b1' : 'f1' }));
  const defs = svgEl('defs', {});
  defs.appendChild(g);
  into.appendChild(defs);
  return `url(#${id})`;
}

/**
 * A curve of `pts` in a box that stretches to its parent (the viewBox is drawn without keeping the ratio, the stroke
 * keeps its width). `area`: the fading fill under the line. `top` / `bottom`: the share of the height left free above
 * the highest point and under the lowest one (a background chart keeps its curve off the card's bottom edge).
 */
export function curve(pts: [number, number][], o: { area: boolean; tone: string; cls?: string; top?: number; bottom?: number }): SVGSVGElement | null {
  if (pts.length < 2) return null;
  const W = 300;
  const H = 100;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (hi - lo < 1e-12) {
    hi += 1;
    lo -= 1;
  }
  const top = H * (o.top ?? 0.06);
  const bottom = H * (o.bottom ?? 0.04);
  const X = (t: number) => ((t - x0) / (x1 - x0 || 1)) * W;
  const Y = (v: number) => H - bottom - ((v - lo) / (hi - lo)) * (H - top - bottom);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: `cv-curve is-${o.tone}${o.cls ? ` ${o.cls}` : ''}`, 'aria-hidden': 'true' });
  const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  if (o.area) svg.appendChild(svgEl('path', { d: `${line}L${W},${H}L0,${H}Z`, class: 'ar', fill: fade(svg) }));
  svg.appendChild(svgEl('path', { d: line, class: 'ln', 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

/**
 * A row's background chart reaches the card's edges: `el`, absolutely placed in `row` (a positioned row of the card),
 * is pulled out to the left and right edges of `root`, the card body (the body's own absolute children reach them with
 * left 0 and right 0 already). Offsets and not screen rectangles, so a scaled preview gives the same.
 */
export function bleed(el: HTMLElement | SVGElement, row: HTMLElement, root: HTMLElement): void {
  let x = 0;
  for (let n: HTMLElement | null = row; n && n !== root; n = n.offsetParent as HTMLElement | null) x += n.offsetLeft;
  const s = (el as HTMLElement).style;
  s.left = `${-x}px`;
  s.right = `${-(root.clientWidth - x - row.offsetWidth)}px`;
}
