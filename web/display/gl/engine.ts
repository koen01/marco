// One shared WebGLRenderer on a fixed full-screen canvas. Each layer renders into the screen-rect of a
// DOM element (scissor/viewport), so the photo panel, rain overlay and the ambient calendar backdrop
// share a single GL context (important on a Raspberry Pi). 30 fps cap, DPR ≤ 1, paused when hidden.
import { Color, WebGLRenderer } from 'three';

export interface Rect { x: number; y: number; w: number; h: number }

export interface GLLayer {
  /** element whose bounding rect is the render area (null → skip) */
  target(): HTMLElement | null;
  active(): boolean;
  render(r: WebGLRenderer, rect: Rect, time: number, dt: number): void;
  dispose(): void;
  /** true while something needs smooth motion (transition, rain…); otherwise the engine drops to idleFps */
  readonly busy?: boolean;
}

/**
 * Viewport and scissor on `rect` (drawing-buffer pixels, as Engine measures them). three.js multiplies both by its
 * pixel ratio, so they are given in its units: at a ratio below 1 (a page zoomed out, a screen scaled under 100 %)
 * the raw rect drew a smaller box, anchored at the bottom left.
 */
export function setRect(r: WebGLRenderer, rect: Rect): void {
  const pr = r.getPixelRatio() || 1;
  r.setViewport(rect.x / pr, rect.y / pr, rect.w / pr, rect.h / pr);
  r.setScissor(rect.x / pr, rect.y / pr, rect.w / pr, rect.h / pr);
}

export class Engine {
  readonly renderer: WebGLRenderer;
  private layers: GLLayer[] = [];
  private raf = 0;
  private lastFrame = 0;
  private t0 = performance.now();
  private frameN = 0;
  private rects = new Map<GLLayer, Rect | null>();
  private clear = new Color(0, 0, 0);
  private dead = false;
  /** keep the measured rects (a carousel switch moves #app with a transform; the canvas moves with it) */
  private hold = false;
  /** the canvas snapshot() copies the frame into, kept between switches */
  private shot: HTMLCanvasElement | null = null;
  onLost: (() => void) | null = null;
  fps = 30;
  /** cap when no layer is busy: Ken Burns drift is sub-pixel per frame, the aurora updates at 15 fps anyway */
  idleFps = 15;
  private onResize = () => this.resize();
  private onVisibility = () => (document.hidden ? this.stop() : this.start());

  static create(canvas: HTMLCanvasElement): Engine | null {
    try {
      // three.js ≥ r163 requires WebGL2; probe on a throwaway canvas so ours keeps its attributes.
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return null;
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return new Engine(canvas);
    } catch (e) {
      console.warn('[gl] WebGL unavailable', e);
      return null;
    }
  }

  private constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(Math.min(1, window.devicePixelRatio || 1));
    this.renderer.autoClear = false;
    this.resize();
    window.addEventListener('resize', this.onResize);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.dead = true;
      this.stop();
      this.onLost?.();
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setClearColor(css: string): void {
    try {
      this.clear.set(css);
    } catch { /* ignore */ }
  }

  add(l: GLLayer): void {
    this.layers.push(l);
    this.invalidate();
  }

  remove(l: GLLayer): void {
    this.layers = this.layers.filter((x) => x !== l);
    this.rects.delete(l);
    l.dispose();
  }

  invalidate(): void {
    this.frameN = 0;
    this.rects.clear();
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.invalidate();
  }

  start(): void {
    if (this.raf || this.dead || document.hidden) return;
    const loop = (ts: number) => {
      this.raf = requestAnimationFrame(loop);
      const busy = this.layers.some((l) => l.busy && l.active());
      const minDt = 1000 / (busy ? this.fps : Math.min(this.fps, this.idleFps));
      if (ts - this.lastFrame < minDt - 2) return;
      const dt = Math.min(0.1, (ts - (this.lastFrame || ts)) / 1000);
      this.lastFrame = ts;
      try {
        this.frame((ts - this.t0) / 1000, dt);
      } catch (e) {
        console.error('[gl] frame failed, disabling WebGL', e);
        this.dead = true;
        this.stop();
        this.onLost?.();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Measure every layer now and keep those rects until holdRects(false). */
  holdRects(on: boolean): void {
    this.hold = false;
    this.invalidate();
    if (!on) return;
    for (const l of this.layers) this.rectOf(l);
    this.hold = true;
  }

  /**
   * A copy of the frame as it is now (a fresh frame is drawn first: without preserveDrawingBuffer the buffer is
   * only readable in the task that drew it). The same canvas comes back every time, so a caller is done with the
   * copy before it asks again. Null when the context is gone.
   */
  snapshot(): HTMLCanvasElement | null {
    if (this.dead || !this.canvas.width || !this.canvas.height) return null;
    try {
      this.frame((performance.now() - this.t0) / 1000, 0);
      // one canvas for every switch (a full-screen copy is several MB): the switch before is always over by now
      const c = (this.shot ??= document.createElement('canvas'));
      if (c.width !== this.canvas.width || c.height !== this.canvas.height) {
        c.width = this.canvas.width;
        c.height = this.canvas.height;
      }
      const g = c.getContext('2d');
      if (!g) return null;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(this.canvas, 0, 0);
      return c;
    } catch (e) {
      console.warn('[gl] snapshot failed', e);
      return null;
    }
  }

  private rectOf(l: GLLayer): Rect | null {
    if ((!this.hold && this.frameN % 15 === 0) || !this.rects.has(l)) {
      const el = l.target();
      if (!el) this.rects.set(l, null);
      else {
        const b = el.getBoundingClientRect();
        const pr = this.renderer.getPixelRatio();
        const H = window.innerHeight;
        const r = { x: Math.round(b.left * pr), y: Math.round((H - b.bottom) * pr), w: Math.round(b.width * pr), h: Math.round(b.height * pr) };
        this.rects.set(l, r.w > 0 && r.h > 0 ? r : null);
      }
    }
    return this.rects.get(l) ?? null;
  }

  private frame(time: number, dt: number): void {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.setScissorTest(false);
    r.setClearColor(this.clear, 1);
    r.clear(true, false, false);
    for (const l of this.layers) {
      if (!l.active()) continue;
      const rect = this.rectOf(l);
      if (!rect) continue;
      r.setScissorTest(true);
      setRect(r, rect);
      l.render(r, rect, time, dt);
    }
    this.frameN++;
  }

  dispose(): void {
    this.stop();
    this.dead = true;
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const l of this.layers) l.dispose();
    this.layers = [];
    this.shot = null;
    this.renderer.dispose();
  }
}
