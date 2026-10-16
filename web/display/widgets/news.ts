// News ticker: headline + one-line summary, rotating with a smooth slide/crossfade.
import type { DisplayConfig, NewsItem, NewsResponse } from '../../shared/types';
import { ctx } from '../ctx';
import { el, esc, reducedMotion } from '../dom';
import { refreshMarquee } from '../marquee';

export class News {
  private items: NewsItem[] = [];
  private idx = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stage: HTMLElement;
  private bar: HTMLElement;
  private cur: HTMLElement | null = null;
  private sig = '';

  /** The settings this ticker reads (the screen's, or a canvas item's merged over them). */
  private readonly cfg: () => DisplayConfig;

  /** `opts.cfg`: where the settings come from (default: the screen's, ctx.cfg); every read, timers included, goes through it. */
  constructor(private root: HTMLElement, opts: { cfg?: () => DisplayConfig } = {}) {
    this.cfg = opts.cfg ?? (() => ctx.cfg);
    root.classList.add('news');
    root.innerHTML = `<div class="news-stage"></div><div class="news-bar"><i></i></div>`;
    this.stage = root.querySelector('.news-stage')!;
    this.bar = root.querySelector('.news-bar i')!;
  }

  setData(n: NewsResponse | null): void {
    const enabled = this.cfg().news.enabled && !!n && n.items?.length > 0;
    this.root.style.display = enabled ? '' : 'none';
    if (!enabled) {
      this.stop();
      return;
    }
    const sig = n!.items.map((i) => i.id).join('|');
    if (sig === this.sig) {
      // re-enabled after being hidden: the rotation timer was stopped, restart it
      if (!this.timer) this.next();
      return;
    }
    this.sig = sig;
    const curId = this.items[this.idx]?.id;
    this.items = n!.items.slice();
    const keep = this.items.findIndex((i) => i.id === curId);
    this.idx = keep >= 0 ? keep : -1;
    if (keep < 0 || !this.cur || !this.timer) this.next();
  }

  /** Stop rotating (a canvas widget removed from the screen). */
  destroy(): void {
    this.stop();
    this.items = [];
    this.sig = '';
  }

  private stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  next(): void {
    this.stop();
    if (!this.items.length) return;
    this.idx = (this.idx + 1) % this.items.length;
    const it = this.items[this.idx];
    const node = el(
      'div',
      'news-item',
      `<div class="news-h"><span class="news-src">${esc(it.source || ctx.t('news'))}</span><span class="news-n">${this.idx + 1}/${this.items.length}</span></div>
       <div class="news-title">${esc(it.title)}</div>${it.summary ? `<div class="news-sum">${esc(it.summary)}</div>` : ''}`,
    );
    const old = this.cur;
    this.stage.appendChild(node);
    this.cur = node;
    const anim = !reducedMotion();
    if (old) {
      if (anim) {
        old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-14px)' }], {
          duration: 700, easing: 'ease-in', fill: 'forwards',
        }).onfinish = () => old.remove();
        node.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], {
          duration: 900, delay: 350, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards',
        });
      } else old.remove();
    }
    const sec = this.cfg().news.rotateSec;
    // a headline too long for one line slides once to its end before the next item (marquee.ts)
    node.dataset.mqUntil = String(Date.now() + sec * 1000);
    refreshMarquee();
    if (anim) {
      this.bar.getAnimations().forEach((a) => a.cancel());
      this.bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: sec * 1000, easing: 'linear' });
    }
    this.timer = setTimeout(() => this.next(), sec * 1000);
  }
}
