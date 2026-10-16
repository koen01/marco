// Shared render context derived from the current config.
import type { DisplayConfig, Lang } from '../shared/types';
import { makeT, normLang } from '../shared/i18n';
import { DEFAULT_CONFIG } from './defaults';
import { isSoftwareGPU } from './switchPlan';

export interface Ctx {
  cfg: DisplayConfig;
  lang: Lang;
  tz: string;
  t: ReturnType<typeof makeT>;
  lite: boolean;
  params: URLSearchParams;
}

const params = new URLSearchParams(location.search);

/**
 * The browser draws with the CPU (no usable graphics chip: WebGL off or slow, or a software renderer such as the one
 * Chrome falls back to after a GPU driver crash). Then every blurred card and the animated photo cost the processor
 * each frame, so such a screen takes the lite look (the same glass without live blur, no WebGL), as ?lite=1 does.
 * ?lite=0 keeps the full look anyway; ?soft=1 forces this (tests). A browser driven by automation is not probed
 * (headless test browsers draw in software, and their screenshots must show the full look).
 */
function softwareRendering(): boolean {
  if (params.get('soft') === '1') return true;
  if (params.get('lite') === '0' || params.get('soft') === '0' || navigator.webdriver) return false;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const fast = c.getContext('webgl', { failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
    const gl = fast ?? (document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null);
    // no WebGL at all: blocked after a crash, or a browser that never had a GPU for it
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !fast || isSoftwareGPU(name);
  } catch {
    return false;
  }
}

/** This browser draws in software (softwareRendering), worked out once at start. */
export const software = params.get('lite') !== '1' && softwareRendering();

export const ctx: Ctx = {
  cfg: DEFAULT_CONFIG,
  lang: 'en',
  tz: 'Europe/Lisbon',
  t: makeT('en'),
  lite: params.get('lite') === '1' || software,
  params,
};

export function setCtxConfig(cfg: DisplayConfig): void {
  ctx.cfg = cfg;
  ctx.lang = normLang(params.get('lang') || cfg.screen.language);
  ctx.t = makeT(ctx.lang);
  ctx.tz = cfg.datetime.timezone || 'Europe/Lisbon';
}
