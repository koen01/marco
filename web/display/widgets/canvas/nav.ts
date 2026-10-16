// Personalizado "Navegación": "Ir a pantalla" (a button to another screen of the household, or Inicio), "Pausar
// carrusel" and the carousel's progress (dots or a thin bar). What a tap does lives in web/display/nav.ts and main.ts
// (env.nav); these cards only draw and pass the tap on.
//
// - The two buttons need the screen's "Permitir tocar en la pantalla" (canvas.taps from the server, which also needs a
//   trusted display and a screen that is not private). Without it they are not drawn on the screen (the card is
//   empty); the admin's preview always draws them, and a tap there only lights the button up.
// - The progress card needs no touch: it shows the steps of the carousel this display runs, which one is on and how
//   much time it has left. On a display with no carousel it is empty; the preview draws a made-up one.
// - Text goes in as text (textContent), the built-in icons are static SVG markup.
import { ctx } from '../../ctx';
import { isPreview } from '../../identity';
import type { AdapterBox, AdapterEnv, CanvasAdapter, NavProgress } from './types';

type Props = Record<string, any>;

/** The built-in icons (canvasCore NAV_ICONS), 24×24 strokes. */
const ICON_PATHS: Record<string, string> = {
  home: 'M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6',
  back: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  prev: 'm15 6-6 6 6 6',
  next: 'm9 6 6 6-6 6',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 4l13 8-13 8z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  photo: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
};

function iconEl(icon: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'cv-nav-ico';
  const name = icon.startsWith('i:') ? icon.slice(2) : '';
  if (name && ICON_PATHS[name]) {
    span.classList.add('is-svg');
    // static markup from the table above (never from the config)
    const svg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[name]}"/></svg>`;
    span.innerHTML = svg;
  } else span.textContent = icon;
  return span;
}

/** A short light on a tapped button (and the only thing a tap does in the admin's preview). */
function flash(el: HTMLElement): void {
  el.classList.remove('is-pressed');
  void el.offsetWidth;
  el.classList.add('is-pressed');
  setTimeout(() => el.classList.remove('is-pressed'), 450);
}

/** The shape of a button by its box: a line, a square, wide. */
function shape(root: HTMLElement, box: AdapterBox): void {
  const r = box.w / Math.max(1, box.h);
  root.classList.toggle('is-line', box.h / box.rem < 16);
  root.classList.toggle('is-square', r < 1.4);
  // one cell wide: no room for the text next to (or under) the icon
  root.classList.toggle('is-narrow', box.w / box.rem < 20);
}

/** Make the label smaller (down to half) until it fits on its line. */
function fitLabel(btn: HTMLElement | null): void {
  const t = btn?.querySelector<HTMLElement>('.cv-nav-t');
  if (!btn || !t) return;
  let k = 1;
  btn.style.setProperty('--nk', '1');
  for (let i = 0; i < 8 && t.scrollWidth > t.clientWidth + 1 && k > 0.5; i++) {
    k -= 0.07;
    btn.style.setProperty('--nk', k.toFixed(2));
  }
}

interface ButtonSpec {
  cls: string;
  /** drawn only on a display that runs a carousel (and in the preview) */
  carousel?: boolean;
  /** the label when the card has none */
  label(env: AdapterEnv, p: Props): string;
  icon(env: AdapterEnv, p: Props): string;
  /** on: the button is "lit" (the screen it goes to is on, the carousel is paused) */
  on(env: AdapterEnv, p: Props): boolean;
  tap(env: AdapterEnv, p: Props): void;
}

function navButton(spec: ButtonSpec): () => CanvasAdapter {
  return () => {
    let env: AdapterEnv;
    let root: HTMLElement;
    let btn: HTMLButtonElement | null = null;
    const hidden = () => !env.nav.shows() || (!!spec.carousel && !isPreview && !env.nav.carousel());
    const render = () => {
      const p = env.item().props as Props;
      root.textContent = '';
      btn = null;
      if (hidden()) return;
      const show = p.show === 'icon' || p.show === 'text' ? p.show : 'both';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cv-nav-btn is-${show}`;
      const label = String(p.label || '').trim() || spec.label(env, p);
      const icon = String(p.icon || '').trim() || spec.icon(env, p);
      if (show !== 'text') b.appendChild(iconEl(icon));
      if (show !== 'icon') b.appendChild(Object.assign(document.createElement('span'), { className: 'cv-nav-t', textContent: label }));
      b.setAttribute('aria-label', label);
      b.classList.toggle('is-on', spec.on(env, p));
      b.classList.toggle('is-inert', !env.nav.live());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        flash(b);
        // the admin's preview (and a screen without touch) only lights the button up
        if (isPreview || !env.nav.live()) return;
        spec.tap(env, env.item().props as Props);
      });
      root.appendChild(b);
      btn = b;
      fitLabel(b);
    };
    return {
      mount(r, e) {
        root = r;
        env = e;
        root.classList.add('cv-nav', spec.cls);
        render();
      },
      update: () => render(),
      layout(box) {
        shape(root, box);
        fitLabel(btn);
      },
      data(topic) {
        if (topic === 'config' || hidden() !== !btn) return render();
        if (topic === 'nav' && btn) {
          btn.classList.toggle('is-on', spec.on(env, env.item().props as Props));
          // the pause button says what a tap does now
          if (spec.cls === 'cv-nav-pause') render();
        }
      },
      // no touch on this screen (the editor says why), or nothing to pause here: not drawn
      empty: () => hidden(),
      destroy() {
        root.textContent = '';
      },
    };
  };
}

const goButton = navButton({
  cls: 'cv-nav-go',
  label: (env, p) => (p.target === 'home' ? ctx.t('navHome') : String(p.targetName || '') || ctx.t('navPick')),
  icon: (_env, p) => (p.target === 'home' ? 'i:home' : 'i:next'),
  on: (env, p) => !!p.target && p.target !== 'home' && env.nav.current() === p.target,
  tap: (env, p) => {
    if (p.target) env.nav.go(String(p.target), Number(p.returnMin ?? 5));
  },
});

const pauseButton = navButton({
  cls: 'cv-nav-pause',
  carousel: true,
  label: (env) => ctx.t(env.nav.paused() ? 'navResume' : 'navPause'),
  icon: (env) => (env.nav.paused() ? 'i:play' : 'i:pause'),
  on: (env) => env.nav.paused(),
  tap: (env, p) => env.nav.pause(Number(p.returnMin ?? 5)),
});

/** What the admin's preview shows on the progress card (no carousel there): four steps, the second one on. */
function previewProgress(now: number): NavProgress {
  return { steps: [1, 2, 3, 4].map((n) => ({ name: ctx.t('navStep', { n }) })), index: 1, startsAt: now - 12_000, endsAt: now + 18_000, paused: false, visiting: false, now };
}

/** mm:ss or m min of what is left. */
function leftText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 600) return ctx.t('navMin', { n: Math.round(s / 60) });
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function progress(): CanvasAdapter {
  let env: AdapterEnv;
  let root: HTMLElement;
  let sig = '';
  let fill: HTMLElement | null = null;
  let left: HTMLElement | null = null;
  const state = (): NavProgress | null => env.nav.progress() ?? (isPreview ? previewProgress(Date.now()) : null);
  const draw = () => {
    const p = env.item().props as Props;
    const st = state();
    const s = st ? JSON.stringify([p.style, p.name, p.time, st.steps.map((x) => x.name), st.index, st.paused, st.visiting]) : '';
    if (s !== sig) {
      sig = s;
      root.textContent = '';
      fill = null;
      left = null;
      if (!st) return;
      root.classList.toggle('is-bar', p.style === 'bar');
      const head = document.createElement('div');
      head.className = 'cv-prog-head';
      if (p.name !== false) {
        const name = st.visiting ? ctx.t('navAway') : st.steps[st.index]?.name ?? '';
        head.appendChild(Object.assign(document.createElement('span'), { className: 'cv-prog-name', textContent: name }));
      }
      if (p.time !== false) {
        left = Object.assign(document.createElement('span'), { className: 'cv-prog-left' });
        head.appendChild(left);
      }
      if (head.childNodes.length) root.appendChild(head);
      if (p.style === 'bar') {
        const track = document.createElement('div');
        track.className = 'cv-prog-track';
        fill = document.createElement('div');
        fill.className = 'cv-prog-fill';
        track.appendChild(fill);
        root.appendChild(track);
      } else {
        const dots = document.createElement('div');
        dots.className = 'cv-prog-dots';
        st.steps.forEach((_, i) => {
          const d = document.createElement('span');
          d.className = `cv-prog-dot${i === st.index ? ' is-on' : ''}`;
          if (i === st.index) {
            fill = document.createElement('i');
            d.appendChild(fill);
          }
          dots.appendChild(d);
        });
        root.appendChild(dots);
      }
    }
    if (!st) return;
    // the time left, and how far the step is (the bar, or the dot of the step on)
    const span = st.startsAt !== null && st.endsAt !== null ? Math.max(1, st.endsAt - st.startsAt) : 0;
    const done = span ? Math.min(1, Math.max(0, (st.now - st.startsAt!) / span)) : 0;
    if (fill) fill.style.setProperty('--p', done.toFixed(3));
    if (left) left.textContent = st.paused ? ctx.t('navPaused') : st.visiting ? '' : span ? leftText(st.endsAt! - st.now) : '';
    root.classList.toggle('is-paused', st.paused);
  };
  return {
    mount(r, e) {
      root = r;
      env = e;
      root.classList.add('cv-nav', 'cv-prog');
      draw();
    },
    update: () => {
      sig = '';
      draw();
    },
    tick: () => draw(),
    // one cell high: the name, the time and the dots or the bar on one line
    layout(box) {
      root.classList.toggle('is-line', box.h / box.rem < 16);
    },
    data(topic) {
      if (topic === 'nav' || topic === 'config') draw();
    },
    // no carousel on this display: nothing to show
    empty: () => !state(),
    destroy() {
      root.textContent = '';
    },
  };
}

export const NAV_ADAPTERS: Record<string, () => CanvasAdapter> = {
  'nav.button': goButton,
  'nav.pause': pauseButton,
  'nav.progress': progress,
};
