import type { Lang } from '../shared/types';
import { EN, PT } from './i18n-dict';
import { SINGULAR } from './i18n-plural';

/**
 * Spanish is the source language: t() takes the Spanish string as key and returns the
 * English/Portuguese translation when available (falls back to Spanish).
 * `{name}` placeholders are interpolated from `vars`.
 */
/** Languages of the panel itself. Dutch (nl) only exists as a screen language so far. */
export type AdminLang = Exclude<Lang, 'nl'>;

let current: AdminLang = 'es';

const LS_KEY = 'calendar-admin.lang';

export function initialLang(): AdminLang {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'es' || v === 'en' || v === 'pt') return v;
  } catch {
    /* ignore */
  }
  // First visit: follow the browser language (English fallback); the user can switch in the sidebar (remembered per browser).
  try {
    for (const l of navigator.languages ?? [navigator.language]) {
      const base = String(l).slice(0, 2).toLowerCase();
      if (base === 'es' || base === 'en' || base === 'pt') return base;
    }
  } catch {
    /* ignore */
  }
  return 'en';
}

export function setLang(l: AdminLang) {
  current = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(LS_KEY, l);
  } catch {
    /* ignore */
  }
}

export const getLang = () => current;

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = key;
  const one = vars && Number(vars.n) === 1 ? SINGULAR[key] : undefined;
  if (one) s = one[current === 'en' ? 1 : current === 'pt' ? 2 : 0];
  else if (current === 'en') s = EN[key] ?? key;
  else if (current === 'pt') s = PT[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
  return s;
}

const LOCALE: Record<AdminLang, string> = { es: 'es-ES', en: 'en-GB', pt: 'pt-PT' };
export const locale = () => LOCALE[current];

export function relTime(iso: string | number | null | undefined): string {
  if (iso == null || iso === '') return '–';
  const ts = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return '–';
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 45) return rtf.format(Math.round(diff), 'second');
  if (abs < 45 * 60) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '–';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

/** "1 pantalla" / "3 pantallas" */
export const nScreens = (n: number) => (n === 1 ? t('1 pantalla') : t('{n} pantallas', { n }));
