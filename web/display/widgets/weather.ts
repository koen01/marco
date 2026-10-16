// Weather block: current conditions, meta row, hourly strip and daily forecast pills.
import type { DisplayConfig, Lang, WeatherResponse } from '../../shared/types';
import { diffDays, formatTime, LOCALES, weekdayName, zonedParts } from '../../shared/i18n';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { ICON, weatherIcon, windArrow } from '../icons';

const r = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '–' : String(Math.round(n)));
const has = (n: number | null | undefined): n is number => n !== null && n !== undefined && !Number.isNaN(n);

/**
 * Credit line for the data source ("Open-Meteo", "Open-Meteo · ECMWF IFS", "MET Norway"): the free sources ask
 * for it (CC BY 4.0). A server from before 0.5 sends no source: its data is Open-Meteo.
 */
export function sourceCredit(w: WeatherResponse | null): string {
  if (!w) return '';
  const s = w.source;
  if (!s) return 'Open-Meteo';
  return [s.name, s.modelName, s.also].filter(Boolean).join(' · ');
}

const r1 = (n: number | null | undefined, lang: string) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : (Math.round(n * 10) / 10).toLocaleString(LOCALES[lang as Lang] ?? 'es-ES');

export class Weather {
  /** The settings this block reads (the screen's, or a canvas item's merged over them). */
  private readonly cfg: () => DisplayConfig;

  /** `cfg`: where the settings come from (default: the screen's, ctx.cfg); every read goes through it. */
  constructor(private root: HTMLElement, private opts: { hourly?: boolean; days?: boolean; compact?: boolean; cfg?: () => DisplayConfig } = {}) {
    this.cfg = opts.cfg ?? (() => ctx.cfg);
    root.classList.add('weather');
    if (opts.compact) root.classList.add('compact');
    // a new width (a phone turned, a panel resized): the forecast days are fitted again
    if (typeof ResizeObserver !== 'undefined') {
      let width = 0;
      new ResizeObserver(() => {
        const nw = Math.round(root.clientWidth);
        if (nw === width) return;
        width = nw;
        if (this.last) this.render(...this.last);
      }).observe(root);
    }
  }

  /** What render() drew last, to draw it again at a new width. */
  private last: [WeatherResponse | null, string] | null = null;

  /**
   * Forecast days wider than their column (a phone, a large text size): first a stacked day with the high only,
   * then smaller symbols and text, then fewer days (three at least).
   */
  private fitDays(): void {
    const row = this.root.querySelector<HTMLElement>('.wx-days');
    if (!row || !row.clientWidth) return;
    const over = () => Array.from(row.children as HTMLCollectionOf<HTMLElement>).some((d) => d.scrollWidth > d.clientWidth + 1);
    for (const step of ['fit-1', 'fit-2']) {
      if (!over()) return;
      row.classList.add(step);
    }
    while (over() && row.children.length > 3) row.lastElementChild!.remove();
  }

  render(w: WeatherResponse | null, todayKey: string): void {
    this.last = [w, todayKey];
    const cfg = this.cfg();
    const { lang, tz, t } = ctx;
    const wc = cfg.weather;
    this.root.style.display = wc.enabled && w ? '' : 'none';
    if (!wc.enabled || !w || !w.current) return;
    const c = w.current;
    const f24 = cfg.datetime.format24;
    const speedUnit = wc.units === 'imperial' ? 'mph' : lang === 'da' ? 'km/t' : 'km/h'; // Danish: km/t (kilometer i timen)
    const windVal = has(c.windKmh) ? (wc.units === 'imperial' ? c.windKmh / 1.609 : c.windKmh) : null;

    const nowMs = Date.now();
    const sunsetMs = w.today?.sunset ? Date.parse(w.today.sunset) : NaN;
    const sunriseMs = w.today?.sunrise ? Date.parse(w.today.sunrise) : NaN;
    const showSunset = Number.isFinite(sunsetMs) && (nowMs < sunsetMs || !Number.isFinite(sunriseMs));
    const sunHtml = Number.isFinite(sunsetMs) || Number.isFinite(sunriseMs)
      ? `<span class="m">${showSunset ? ICON.sunset : ICON.sunrise}<b>${esc(formatTime(new Date(showSunset ? sunsetMs : sunriseMs), tz, f24, cfg.datetime.showAmPm))}</b></span>`
      : '';

    // A value the source does not give is left out rather than shown as a dash.
    const meta = [
      has(c.feelsLike) ? `<span class="m">${ICON.thermo}<em>${esc(t('feelsLike'))}</em><b>${r(c.feelsLike)}°</b></span>` : '',
      has(c.humidity) ? `<span class="m">${ICON.drop}<b>${r(c.humidity)}%</b></span>` : '',
      has(windVal) ? `<span class="m">${windArrow(c.windDir ?? 0)}<b>${r(windVal)}</b><em>${speedUnit}${c.windDirLabel ? ' ' + esc(c.windDirLabel) : ''}</em></span>` : '',
      sunHtml,
    ];
    if (wc.showPrecipChance && w.today && has(w.today.precipChance) && w.today.precipChance >= 10) {
      meta.push(`<span class="m">${ICON.umbrella}<b>${r(w.today.precipChance)}%</b></span>`);
    }
    if (w.indoor && (w.indoor.temp !== null || w.indoor.humidity !== null)) {
      meta.push(
        `<span class="m indoor">${ICON.home}<b>${w.indoor.temp !== null ? r1(w.indoor.temp, lang) + '°' : ''}</b>${w.indoor.humidity !== null ? `<em>${r(w.indoor.humidity)}%</em>` : ''}</span>`,
      );
    }

    if (cfg.screen.style === 'modern') {
      setHTML(this.root, this.modern(cfg, w, todayKey, meta.filter(Boolean)));
      return;
    }

    const hi = w.today ? `<span class="hilo"><b>${r(w.today.max)}°</b><i>/</i>${r(w.today.min)}°</span>` : '';
    let html = `<div class="wx-now">
        <div class="wx-icon">${weatherIcon(c.code, c.isDay, { animated: !ctx.lite })}</div>
        <div class="wx-temp">${r(c.temp)}<span class="deg">°</span></div>
        <div class="wx-desc"><b>${esc(c.description || '')}</b>${hi}<span class="loc">${esc(w.locationName || wc.locationName || '')}</span><span class="wx-src">${esc(sourceCredit(w))}</span></div>
      </div>
      <div class="wx-meta">${meta.filter(Boolean).join('')}</div>`;

    if (wc.showHourly && this.opts.hourly !== false && w.hourly?.length) {
      const hrs = w.hourly.slice(0, 8).map((h) => {
        const d = new Date(h.time);
        const p = zonedParts(d, tz);
        const lbl = f24 ? `${p.hour}h` : `${p.hour % 12 === 0 ? 12 : p.hour % 12}${p.hour < 12 ? 'a' : 'p'}`;
        const pc = wc.showPrecipChance && has(h.precipChance) && h.precipChance >= 20 ? `<span class="p">${r(h.precipChance)}%</span>` : '<span class="p"></span>';
        return `<div class="h"><span class="hl">${lbl}</span>${weatherIcon(h.code, h.isDay)}<span class="hv">${r(h.temp)}°</span>${pc}</div>`;
      });
      html += `<div class="wx-hourly">${hrs.join('')}</div>`;
    }

    if (this.opts.days !== false && w.daily?.length) {
      const days = w.daily.filter((d) => d.date >= todayKey).slice(0, wc.forecastDays);
      const all = days.flatMap((d) => [d.min, d.max]);
      const lo = Math.min(...all), hiT = Math.max(...all);
      const span = Math.max(1, hiT - lo);
      const pills = days.map((d) => {
        const isToday = diffDays(todayKey, d.date) === 0;
        const name = isToday ? t('today') : weekdayName(lang, d.date, 'short');
        const a = ((d.min - lo) / span) * 100, b = ((d.max - lo) / span) * 100;
        const pc = wc.showPrecipChance && has(d.precipChance) && d.precipChance >= 20 ? `<span class="p">${ICON.drop}${r(d.precipChance)}%</span>` : '';
        return `<div class="dp${isToday ? ' today' : ''}"><span class="dn">${esc(name)}</span>${weatherIcon(d.code, true)}
          <span class="dmx">${r(d.max)}°</span><span class="rng"><i style="left:${a.toFixed(0)}%;right:${(100 - b).toFixed(0)}%"></i></span><span class="dmn">${r(d.min)}°</span>${pc}</div>`;
      });
      html += `<div class="wx-days">${pills.join('')}</div>`;
    }
    setHTML(this.root, html);
    this.fitDays();
  }

  /**
   * Modern style: an iOS Weather-like widget. Place and big temperature on the left, symbol, condition and
   * high / low on the right, then a quiet details line, an hourly row (.wx-hourly, so the side-panel fitting
   * still drops it first) and the next days as columns.
   */
  private modern(cfg: DisplayConfig, w: WeatherResponse, todayKey: string, meta: string[]): string {
    const { lang, tz, t } = ctx;
    const wc = cfg.weather;
    const c = w.current!;
    const f24 = cfg.datetime.format24;
    const place = (w.locationName || wc.locationName || '').split(',')[0].trim();
    const hilo = w.today
      ? `<span class="wxm-hl"><span>${esc(t('hiShort'))} <b>${r(w.today.max)}°</b></span><span>${esc(t('loShort'))} <b>${r(w.today.min)}°</b></span></span>`
      : '';
    let html = `<div class="wxm-head">
        <div class="wxm-main"><span class="wxm-loc">${esc(place)}</span><span class="wxm-temp">${r(c.temp)}°</span></div>
        <div class="wxm-side"><span class="wxm-icon">${weatherIcon(c.code, c.isDay, { animated: !ctx.lite })}</span><span class="wxm-cond">${esc(c.description || '')}</span>${hilo}<span class="wx-src">${esc(sourceCredit(w))}</span></div>
      </div>
      <div class="wx-meta">${meta.join('')}</div>`;
    if (wc.showHourly && this.opts.hourly !== false && w.hourly?.length) {
      const hrs = w.hourly.slice(0, 6).map((h, i) => {
        const p = zonedParts(new Date(h.time), tz);
        const lbl = i === 0 ? t('now') : f24 ? `${p.hour}` : `${p.hour % 12 === 0 ? 12 : p.hour % 12}${p.hour < 12 ? 'a' : 'p'}`;
        const pc = wc.showPrecipChance && has(h.precipChance) && h.precipChance >= 20 ? `<span class="p">${r(h.precipChance)}%</span>` : '';
        return `<div class="h"><span class="hl">${esc(lbl)}</span>${weatherIcon(h.code, h.isDay)}${pc}<span class="hv">${r(h.temp)}°</span></div>`;
      });
      html += `<div class="wx-hourly">${hrs.join('')}</div>`;
    }
    if (this.opts.days !== false && w.daily?.length) {
      const days = w.daily.filter((d) => d.date > todayKey).slice(0, Math.max(1, wc.forecastDays - 1));
      const cols = days.map((d) => {
        const pc = wc.showPrecipChance && has(d.precipChance) && d.precipChance >= 30 ? `<span class="p">${r(d.precipChance)}%</span>` : '';
        return `<div class="wxm-day"><span class="dn">${esc(weekdayName(lang, d.date, 'short'))}</span>${weatherIcon(d.code, true)}${pc}<span class="dmx">${r(d.max)}°</span><span class="dmn">${r(d.min)}°</span></div>`;
      });
      if (cols.length) html += `<div class="wx-days wxm-days">${cols.join('')}</div>`;
    }
    return html;
  }
}
