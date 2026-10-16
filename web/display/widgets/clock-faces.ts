// Analog clock faces of the Personalizado clocks (classic, minimal, dots, numbers) as static SVG, and a small dial
// that moves its hands for any time zone. The classic face is the one widgets/clock.ts draws for the screen clock.
import { zonedParts } from '../../shared/i18n';

export type AnalogFace = 'classic' | 'minimal' | 'dots' | 'numbers';

function marks(face: AnalogFace): string {
  let out = '';
  if (face === 'classic') {
    for (let i = 0; i < 60; i++) {
      const big = i % 5 === 0;
      out += `<line x1="100" y1="${big ? 10 : 12}" x2="100" y2="${big ? 24 : 17}" transform="rotate(${i * 6} 100 100)" class="${big ? 'tk big' : 'tk'}"/>`;
    }
  } else if (face === 'minimal') {
    for (let i = 0; i < 12; i++) {
      const q = i % 3 === 0;
      out += `<line x1="100" y1="12" x2="100" y2="${q ? 28 : 20}" transform="rotate(${i * 30} 100 100)" class="${q ? 'tk big' : 'tk'}"/>`;
    }
  } else if (face === 'dots') {
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      const x = (100 + 82 * Math.sin(a)).toFixed(2);
      const y = (100 - 82 * Math.cos(a)).toFixed(2);
      out += `<circle cx="${x}" cy="${y}" r="${i % 3 === 0 ? 5 : 3}" class="dot"/>`;
    }
  } else {
    for (let i = 1; i <= 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      const x = (100 + 74 * Math.sin(a)).toFixed(2);
      const y = (100 - 74 * Math.cos(a) + 8).toFixed(2);
      out += `<text x="${x}" y="${y}" class="num" text-anchor="middle">${i}</text>`;
    }
  }
  return out;
}

/** The SVG of a face with its three hands (classes hh, mh, sh as the screen clock, so the same styles apply). */
export function faceSvg(face: AnalogFace, seconds: boolean): string {
  return `<svg viewBox="0 0 200 200" aria-hidden="true" class="face-${face}">
    <circle cx="100" cy="100" r="96" class="rim"/>${marks(face)}
    <line class="hh" x1="100" y1="112" x2="100" y2="52"/>
    <line class="mh" x1="100" y1="116" x2="100" y2="26"/>
    <g class="sh"${seconds ? '' : ' style="display:none"'}><line x1="100" y1="124" x2="100" y2="20"/><circle cx="100" cy="100" r="3.5"/></g>
    <circle cx="100" cy="100" r="2" class="pin"/></svg>`;
}

/** An analog dial in `root`: `set(now)` moves the hands to the wall time of `tz` (null = the screen's zone). */
export class Dial {
  private hands: { h: SVGElement; m: SVGElement; s: SVGElement };
  private key = '';

  constructor(private root: HTMLElement, face: AnalogFace, private seconds: boolean, private tz: string) {
    root.classList.add('clock', 'analog');
    root.innerHTML = faceSvg(face, seconds);
    this.hands = { h: root.querySelector('.hh')!, m: root.querySelector('.mh')!, s: root.querySelector('.sh')! };
  }

  set(now: Date): void {
    const p = zonedParts(now, this.tz);
    const key = `${p.hour}|${p.minute}|${this.seconds ? p.second : ''}`;
    if (key === this.key) return;
    this.key = key;
    const sec = this.seconds ? p.second : 0;
    this.hands.h.setAttribute('transform', `rotate(${(p.hour % 12) * 30 + p.minute * 0.5} 100 100)`);
    this.hands.m.setAttribute('transform', `rotate(${p.minute * 6 + sec * 0.1} 100 100)`);
    if (this.seconds) this.hands.s.setAttribute('transform', `rotate(${p.second * 6} 100 100)`);
  }
}
