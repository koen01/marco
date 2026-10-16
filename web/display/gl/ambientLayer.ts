// Ambient backdrop behind the calendar, kept faint so it never competes with the text:
//  - aurora: northern-lights curtains (folding ribbons with fine vertical rays, green/teal at the lower edge fading
//    to violet at the top, slow shimmer and brightness pulses), rendered at ¼ resolution into a render target,
//    refreshed at 15 fps and upscaled with a dither so the soft gradients never band;
//  - particles: soft bokeh dust in three depth layers (small sharp specks far away, larger blurred discs close by,
//    a few big out-of-focus orbs), drifting with parallax and a slight twinkle, tinted by the accent colour.
import {
  BufferAttribute, BufferGeometry, Color, CustomBlending, LinearFilter, Mesh, OneFactor, OneMinusSrcAlphaFactor, OrthographicCamera,
  PlaneGeometry, Points, Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { setRect, type GLLayer, type Rect } from './engine';
import { FULLSCREEN_VERT, NOISE } from './noise';

const AURORA = /* glsl */ `
varying vec2 vUv;
uniform float uTime, uI, uLight;
uniform vec3 uA, uBg;
uniform vec2 uRes;
${NOISE}
// one curtain: a ribbon whose lower edge folds along x, with rays hanging up from it.
// returns intensity in x, height above the lower edge (0..1) in y
vec2 curtain(vec2 p, float t, float base, float seed, float rayF){
  // slow large folds + a finer travelling ripple
  float fold = (fbm(vec2(p.x * 1.1 + seed, t * 0.18 + seed)) - 0.5) * 0.55
             + 0.04 * sin(p.x * 3.7 + t * 0.9 + seed * 4.0);
  float edge = base + fold;
  float h = vUv.y - edge;                        // above the lower edge > 0
  // sharp-ish, brightest lower edge, long soft fade upwards
  float hp = max(h, 0.0);
  float prof = smoothstep(-0.03, 0.01, h) * (0.8 * exp(-hp * 3.2) + 0.5 * exp(-hp * 22.0));
  // the folds bunch the rays: sample the rays along the folded x. Two octaves of thin vertical streaks that drift
  // and shimmer slowly; they barely change with height so they read as rays hanging from the edge.
  float xr = p.x + fold * 1.6;
  float r1 = vnoise(vec2(xr * rayF, t * 0.30 + seed));
  float r2 = vnoise(vec2(xr * rayF * 2.7 + 5.0, t * 0.55 + seed - h * 0.35));
  float rays = 0.22 + 1.25 * pow(r1 * 0.55 + r2 * 0.45, 2.2);
  // patches of the ribbon brighten and fade slowly
  float pulse = 0.55 + 0.45 * sin(t * 0.7 + p.x * 1.3 + seed * 5.0) * (0.5 + 0.5 * vnoise(vec2(p.x * 0.8 - t * 0.2, seed)));
  float along = smoothstep(0.15, 0.6, fbm(vec2(p.x * 0.7 - t * 0.12, seed * 3.0)));
  return vec2(prof * rays * pulse * along, clamp(h / 0.5, 0.0, 1.0));
}
vec3 auroraColor(float h){
  vec3 green = vec3(0.22, 1.0, 0.55);
  vec3 teal = vec3(0.12, 0.85, 0.80);
  vec3 violet = vec3(0.50, 0.30, 0.95);
  vec3 magenta = vec3(0.85, 0.32, 0.78);
  vec3 c = mix(green, teal, smoothstep(0.0, 0.25, h));
  c = mix(c, violet, smoothstep(0.25, 0.7, h));
  return mix(c, magenta, smoothstep(0.7, 1.0, h));
}
void main(){
  float t = uTime * 0.1;
  float asp = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * asp, vUv.y);
  vec2 c1 = curtain(p, t, 0.52, 1.7, 14.0);
  vec2 c2 = curtain(p + vec2(3.1, 0.0), t * 0.8, 0.70, 6.3, 10.0);
  vec2 c3 = curtain(p + vec2(7.4, 0.0), t * 1.15, 0.30, 9.1, 20.0);
  vec3 col = auroraColor(c1.y) * c1.x + auroraColor(c2.y) * c2.x * 0.7 + auroraColor(c3.y) * c3.x * 0.45;
  // a faint airglow so the sky is never pitch black around the curtains
  col += vec3(0.10, 0.30, 0.25) * 0.10 * smoothstep(0.1, 0.9, vUv.y);
  // a breath of the screen's accent colour, so it still feels like this screen
  col = mix(col, uA * length(col) * 0.8, 0.12);
  col *= uI;
  vec3 outc;
  if (uLight > 0.5) {
    // light theme: a very faint pastel tint on the paper-coloured background (hue only, so it never looks grey)
    float m = max(col.r, max(col.g, col.b));
    vec3 pastel = mix(col / max(m, 1e-4), vec3(1.0), 0.3);
    outc = uBg * mix(vec3(1.0), pastel, clamp(m * 3.0, 0.0, 0.6));
  } else outc = uBg + col;
  gl_FragColor = vec4(outc, 1.0);
}`;

// upscale the ¼-res aurora with a ±½ LSB dither so its smooth gradients do not band on 8-bit panels
const BLIT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uTex;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 c = texture2D(uTex, vUv).rgb;
  c += (h12(gl_FragCoord.xy) + h12(gl_FragCoord.xy + 17.3) - 1.0) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

// seed: x, y, speed / phase, depth (0 far … 1 near; the top few % are the big out-of-focus orbs)
const P_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime, uH, uAsp;
varying float vA, vBlur, vHue, vRing;
void main(){
  float d = seed.w;
  float orb = step(0.955, d);
  float depth = pow(min(d / 0.955, 1.0), 1.5);    // more far specks than near discs
  // parallax: near layers drift faster, everything rises slowly and sways
  float t = uTime;
  float vy = (0.0025 + 0.010 * depth) * (0.7 + 0.6 * seed.z) * (1.0 - orb * 0.6);
  float vx = (0.0015 + 0.006 * depth) * (seed.z - 0.4);
  float y = fract(seed.y + t * vy);
  float x = fract(seed.x + t * vx + (0.012 + 0.02 * depth) * sin(t * (0.05 + 0.08 * seed.z) + seed.y * 40.0));
  y += 0.01 * sin(t * 0.11 + seed.x * 31.0) * depth;
  // wrap with a margin so big discs do not pop at the edges
  gl_Position = vec4((x * 1.2 - 0.1) * 2.0 - 1.0, (y * 1.2 - 0.1) * 2.0 - 1.0, 0.0, 1.0);
  float px = mix(mix(2.5, 44.0, depth * depth), mix(90.0, 190.0, seed.z), orb);
  gl_PointSize = px * uH;
  vBlur = mix(mix(0.2, 0.32, depth), 0.5, orb);    // fraction of the radius that is soft
  vRing = (1.0 - orb) * smoothstep(0.5, 0.9, depth); // near bokeh: slightly brighter rim
  // far specks twinkle, near discs breathe slowly
  float tw = 0.55 + 0.45 * sin(t * mix(1.3, 0.25, depth) * (0.6 + seed.z) + seed.x * 60.0);
  tw = mix(tw * tw, 0.8 + 0.2 * tw, depth);
  float fadeY = smoothstep(0.0, 0.18, y) * smoothstep(1.0, 0.75, y);
  vA = tw * fadeY * mix(mix(0.85, 0.32, depth), 0.13, orb);
  vHue = fract(seed.x * 7.3 + seed.y * 3.1);
}`;
const P_FRAG = /* glsl */ `
uniform vec3 uA, uB;
uniform float uI, uLight;
varying float vA, vBlur, vHue, vRing;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;     // 0 centre … 1 edge
  float disc = 1.0 - smoothstep(1.0 - vBlur * 2.0, 1.0, r);
  float ring = smoothstep(0.55, 0.92, r) * disc;
  float a = disc * (0.75 + 0.25 * (1.0 - r * r)) + ring * vRing * 0.35;
  a *= vA * uI;
  vec3 c = mix(mix(uA, vec3(1.0), 0.18), uB, smoothstep(0.3, 0.9, vHue));
  if (uLight > 0.5) {
    gl_FragColor = vec4(c * a * 0.7, a);            // over the light background: soft tinted discs
  } else {
    gl_FragColor = vec4(c * a, 0.0);                // additive glow
  }
}`;

const PARTICLES = 150;

export class AmbientLayer implements GLLayer {
  private scene = new Scene();
  private blitScene = new Scene();
  private pScene = new Scene();
  private cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private aurora: ShaderMaterial;
  private blit: ShaderMaterial;
  private parts: ShaderMaterial;
  private rt: WebGLRenderTarget | null = null;
  private lastUpdate = -1;
  mode: 'aurora' | 'particles' | 'none' = 'aurora';
  enabled = true;

  constructor(private el: () => HTMLElement | null) {
    const geo = new PlaneGeometry(2, 2);
    this.aurora = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: AURORA, depthTest: false, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uI: { value: 0.2 }, uLight: { value: 0 }, uA: { value: new Color('#ff5a4e') },
        uBg: { value: new Color(0, 0, 0) }, uRes: { value: new Vector2(1, 1) },
      },
    });
    this.blit = new ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: BLIT, depthTest: false, depthWrite: false, uniforms: { uTex: { value: null } },
    });
    const a = new Mesh(geo, this.aurora);
    a.frustumCulled = false;
    this.scene.add(a);
    const b = new Mesh(geo, this.blit);
    b.frustumCulled = false;
    this.blitScene.add(b);

    const g = new BufferGeometry();
    const s = new Float32Array(PARTICLES * 4);
    for (let i = 0; i < s.length; i++) s[i] = Math.random();
    g.setAttribute('seed', new BufferAttribute(s, 4));
    g.setAttribute('position', new BufferAttribute(new Float32Array(PARTICLES * 3), 3));
    // premultiplied: additive glow on dark (alpha 0), soft "over" discs on light
    this.parts = new ShaderMaterial({
      vertexShader: P_VERT, fragmentShader: P_FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
      uniforms: {
        uTime: { value: 0 }, uH: { value: 1 }, uAsp: { value: 16 / 9 }, uI: { value: 0.5 }, uLight: { value: 0 },
        uA: { value: new Color('#ff5a4e') }, uB: { value: new Color('#ffffff') },
      },
    });
    const pts = new Points(g, this.parts);
    pts.frustumCulled = false;
    this.pScene.add(pts);
  }

  setColors(accent: string, second: string, bg: string, light: boolean): void {
    try {
      const pu = this.parts.uniforms;
      (this.aurora.uniforms.uA.value as Color).set(accent);
      (this.aurora.uniforms.uBg.value as Color).set(bg);
      this.aurora.uniforms.uLight.value = light ? 1 : 0;
      this.aurora.uniforms.uI.value = light ? 0.4 : 0.45;
      // dust: the accent plus a soft partner (warm white on dark, the second hue on light)
      (pu.uA.value as Color).set(accent);
      (pu.uB.value as Color).set(light ? second : '#fff4e6');
      pu.uLight.value = light ? 1 : 0;
      pu.uI.value = light ? 0.45 : 0.7;
      this.lastUpdate = -1;
    } catch { /* ignore bad colours */ }
  }

  target() {
    return this.el();
  }
  active() {
    return this.enabled && this.mode !== 'none';
  }

  render(r: WebGLRenderer, rect: Rect, time: number): void {
    // wrapped so the float maths keeps its precision on a screen that runs for weeks
    const t = time % 7200;
    if (this.mode === 'particles') {
      this.parts.uniforms.uTime.value = t;
      this.parts.uniforms.uH.value = Math.max(0.6, rect.h / 1080);
      this.parts.uniforms.uAsp.value = rect.w / Math.max(1, rect.h);
      r.render(this.pScene, this.cam);
      return;
    }
    const w = Math.max(16, Math.round(rect.w / 4));
    const h = Math.max(16, Math.round(rect.h / 4));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new WebGLRenderTarget(w, h, { minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
      this.lastUpdate = -1;
    }
    if (this.lastUpdate < 0 || time - this.lastUpdate > 1 / 15) {
      this.lastUpdate = time;
      this.aurora.uniforms.uTime.value = t;
      this.aurora.uniforms.uRes.value.set(rect.w, rect.h);
      r.setScissorTest(false);
      // the target's own viewport covers all of it (setViewport here would be scaled by the pixel ratio)
      r.setRenderTarget(this.rt);
      r.render(this.scene, this.cam);
      r.setRenderTarget(null);
      r.setScissorTest(true);
      setRect(r, rect);
    }
    this.blit.uniforms.uTex.value = this.rt.texture;
    r.render(this.blitScene, this.cam);
  }

  dispose(): void {
    this.rt?.dispose();
    this.aurora.dispose();
    this.blit.dispose();
    this.parts.dispose();
  }
}
