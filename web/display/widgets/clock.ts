// Huge thin digital clock (seconds as superscript, digit micro-animations) or SVG analog clock.
import type { DisplayConfig } from '../../shared/types';
import { formatDateLine, pad2 } from '../../shared/i18n';
import { ctx } from '../ctx';
import { esc, reducedMotion, setHTML, setText } from '../dom';
import type { Tick } from '../time';

export class Clock {
  private mode = '';
  private digits: HTMLElement[] = [];
  private secEls: HTMLElement[] = [];
  private colon!: HTMLElement;
  private ampm!: HTMLElement;
  private hands: { h: SVGElement; m: SVGElement; s: SVGElement } | null = null;
  private dateEl: HTMLElement;
  private face: HTMLElement;
  /** epoch second of the previous update: digit animations only run on a normal 1 s step */
  private lastSec = 0;
  /** minute of the last fit check: the width only changes when the digits, the layout or the font size change */
  private fitKey = '';

  /** The settings this clock reads (the screen's, or a canvas item's merged over them). */
  private readonly cfg: () => DisplayConfig;

  /**
   * @param opts.seconds force the seconds on / off (layouts with a small or a bedside clock); default: the config
   * @param opts.cfg where the settings come from (default: the screen's, ctx.cfg); every read goes through it
   */
  constructor(private root: HTMLElement, private opts: { seconds?: boolean; cfg?: () => DisplayConfig } = {}) {
    this.cfg = opts.cfg ?? (() => ctx.cfg);
    root.classList.add('clock-wrap');
    root.innerHTML = `<div class="clock"></div><div class="date"></div>`;
    this.face = root.querySelector('.clock')!;
    this.dateEl = root.querySelector('.date')!;
    // A large font size (screen.fontScale) or a narrow panel must never push the digits onto a second line:
    // the clock shrinks to the width it has.
    // (in the next frame: resizing inside the observer callback would loop)
    if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(() => this.fit())).observe(root);
  }

  /** Scale the digital clock down (CSS zoom) when it is wider than its column; never up. */
  private fit(): void {
    const f = this.face;
    if (!f.classList.contains('digital')) return void f.style.removeProperty('zoom');
    f.style.removeProperty('zoom');
    // the wrap can grow with the clock, so measure the column it sits in
    const parent = this.root.parentElement;
    const cs = parent ? getComputedStyle(parent) : null;
    const col = parent && cs ? parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 0;
    const avail = col > 0 ? Math.min(col, this.root.clientWidth || col) : this.root.clientWidth;
    const need = f.scrollWidth;
    if (avail > 0 && need > avail + 1) f.style.zoom = String(Math.max(0.3, (avail / need) * 0.98));
  }

  private build(): void {
    const cfg = this.cfg();
    const dt = { ...cfg.datetime, showSeconds: this.opts.seconds ?? cfg.datetime.showSeconds };
    const mode = `${dt.clock}|${dt.showSeconds}|${dt.format24}|${dt.showAmPm}`;
    if (mode === this.mode) return;
    this.mode = mode;
    this.hands = null;
    this.digits = [];
    this.secEls = [];
    if (dt.clock === 'analog') {
      this.face.className = 'clock analog';
      let ticks = '';
      for (let i = 0; i < 60; i++) {
        const big = i % 5 === 0;
        ticks += `<line x1="100" y1="${big ? 10 : 12}" x2="100" y2="${big ? 24 : 17}" transform="rotate(${i * 6} 100 100)" class="${big ? 'tk big' : 'tk'}"/>`;
      }
      this.face.innerHTML = `<svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="96" class="rim"/>${ticks}
        <line class="hh" x1="100" y1="112" x2="100" y2="52"/>
        <line class="mh" x1="100" y1="116" x2="100" y2="26"/>
        <g class="sh"${dt.showSeconds ? '' : ' style="display:none"'}><line x1="100" y1="124" x2="100" y2="20"/><circle cx="100" cy="100" r="3.5"/></g>
        <circle cx="100" cy="100" r="2" class="pin"/></svg>`;
      this.hands = {
        h: this.face.querySelector('.hh')!, m: this.face.querySelector('.mh')!, s: this.face.querySelector('.sh')!,
      };
      return;
    }
    this.face.className = 'clock digital';
    this.face.innerHTML = `<span class="hm"><span class="d"></span><span class="d"></span><span class="colon">:</span><span class="d"></span><span class="d"></span></span>${
      dt.showSeconds ? '<span class="sec"><span class="d"></span><span class="d"></span></span>' : ''
    }<span class="ampm"></span>`;
    this.digits = Array.from(this.face.querySelectorAll('.hm .d'));
    this.secEls = Array.from(this.face.querySelectorAll('.sec .d'));
    this.colon = this.face.querySelector('.colon')!;
    this.ampm = this.face.querySelector('.ampm')!;
  }

  update(tick: Tick): void {
    const dt = this.cfg().datetime;
    this.root.style.display = dt.enabled ? '' : 'none';
    if (!dt.enabled) return;
    this.build();
    const { hour, minute, second } = tick.parts;
    // P1b: after a throttled/hidden period or a clock jump several digits change at once; animating them all
    // from transparent made a digit look missing ("3" instead of "03") in captures. Only animate regular steps.
    const sec = Math.floor(tick.now.getTime() / 1000);
    const anim = !document.hidden && sec - this.lastSec === 1;
    this.lastSec = sec;
    if (this.hands) {
      const s = second * 6;
      const m = minute * 6 + second * 0.1;
      const h = (hour % 12) * 30 + minute * 0.5;
      this.hands.h.setAttribute('transform', `rotate(${h} 100 100)`);
      this.hands.m.setAttribute('transform', `rotate(${m} 100 100)`);
      this.hands.s.setAttribute('transform', `rotate(${s} 100 100)`);
    } else {
      let h = hour;
      if (!dt.format24) h = h % 12 === 0 ? 12 : h % 12;
      const hs = dt.format24 ? pad2(h) : String(h).padStart(2, ' ');
      const ms = pad2(minute);
      const chars = [hs[0], hs[1], ms[0], ms[1]];
      chars.forEach((ch, i) => this.setDigit(this.digits[i], ch.trim(), anim));
      this.digits[0].classList.toggle('blank', hs[0] === ' ');
      // always two digits ("03"), each in its own fixed-width slot
      const ss = pad2(Math.max(0, Math.min(59, Math.floor(second))));
      if (this.secEls.length === 2) {
        this.setDigit(this.secEls[0], ss[0], anim);
        this.setDigit(this.secEls[1], ss[1], anim);
      }
      setText(this.ampm, !dt.format24 && dt.showAmPm ? (hour < 12 ? 'AM' : 'PM') : '');
    }
    setHTML(this.dateEl, esc(formatDateLine(ctx.lang, tick.dayKey, dt.dateFormat, dt.dateCustom)));
    const key = `${this.mode}|${hour}|${minute}|${getComputedStyle(document.documentElement).getPropertyValue('--fs')}`;
    if (key !== this.fitKey) {
      this.fitKey = key;
      this.fit();
    }
  }

  private setDigit(e: HTMLElement | undefined, ch: string, animate: boolean): void {
    if (!e || e.textContent === ch) return;
    const first = e.textContent === '';
    e.textContent = ch;
    if (first || !animate || reducedMotion()) return;
    // never starts fully transparent: the digit stays legible in any captured frame
    e.animate(
      [
        { transform: 'translateY(-0.14em)', opacity: 0.35 },
        { transform: 'translateY(0)', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
  }
}
