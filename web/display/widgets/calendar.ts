// Month / week grid: huge thin day numbers, lane-allocated event chips and continuous multi-day bars.
import { addDays, diffDays, gridWeekStart, monthName, startOfWeek, weekdayNames, weekdayOfKey } from '../../shared/i18n';
import { chipColors } from '../color';
import { ctx } from '../ctx';
import { esc, reconcile, setHTML, type Spec } from '../dom';
import { type NEvent, sortForDay, timeLabel } from '../eventModel';
import { refreshMarquee } from '../marquee';
import { PAGE_MS, pageAt, pageLabel, planPages, wrapLineCap } from '../motion';
import {
  COMPACT_FONT, COMPACT_GAP_U, COMPACT_LINE, COMPACT_PAD_U, type CompactDay, laneHeight, linesThatFit, shareRows, weekNeed,
} from '../compact';
import type { Tick } from '../time';

/** Grid metrics in px, read from the calendar's CSS variables (see lanesFor / planCompact). */
interface Metrics {
  /** height of the whole weeks area */
  h: number;
  rem: number;
  numH: number;
  laneH: number;
  laneMin: number;
  gap: number;
  /** compact entries: font size, height of one line, space between lines, space kept below the last one */
  lineFs: number;
  lineH: number;
  lineGap: number;
  pad: number;
}

/** A busy day drawn as a column of compact one-line entries (calendar.compactBusyDays). */
interface Stack {
  d: number;
  /** lanes kept by bars that also cover other days: the column starts below them */
  top: number;
  /** the entries shown, by page (more than one page only when the day rotates, calendar.rotateBusyDays) */
  pages: Placed[][];
}

interface Placed {
  e: NEvent;
  /** 0-based half-day slots within the week [s, eSlot) (14 slots per week) */
  s: number;
  eSlot: number;
  lane: number;
  contL: boolean;
  contR: boolean;
  /** lanes spanned (P1a: single-day chips with a long title may grow into free lanes below and wrap) */
  span?: number;
  /** title still longer than the lines available → slightly smaller font */
  long?: boolean;
  /** busy day paging: which page of `pages` this chip belongs to, on day `day` (yyyy-mm-dd) */
  page?: number;
  pages?: number;
  day?: string;
  /** a one-day piece of a bar spanning other days, shown on a busy day's pages (its own key) */
  piece?: boolean;
  /** the part of a bar after a busy day that took its lane (its own key) */
  part?: string;
}

/** Text width measurement (canvas, cached context) used to decide which chips deserve a second line. */
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, px: number, weight: number): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return text.length * px * 0.55;
  // Modern measures with the font it renders with (SF on Apple devices, Inter elsewhere), so wrapping matches
  measureCtx.font = ctx.cfg.screen.style === 'modern'
    ? `${weight} ${px}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter Variable', Inter, system-ui, sans-serif`
    : `${weight} ${px}px 'Inter Variable', Inter, system-ui, sans-serif`;
  return measureCtx.measureText(text).width;
}

export class MonthCalendar {
  readonly root: HTMLElement;
  /** Two weeks layout: rows are tall, so chips may wrap onto four lines (five for the only event of a day). */
  roomy = false;
  private head: HTMLElement;
  private dow: HTMLElement;
  private weeks: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('cal');
    root.innerHTML = `<div class="cal-head"><div class="cal-title"></div><div class="legend"></div></div>
      <div class="cal-dow"></div><div class="cal-weeks"></div>`;
    this.head = root.querySelector('.cal-head')!;
    this.dow = root.querySelector('.cal-dow')!;
    this.weeks = root.querySelector('.cal-weeks')!;
  }

  render(events: NEvent[], tick: Tick): void {
    const { cfg, lang, tz, t } = ctx;
    const c = cfg.calendar;
    const isWeek = c.view === 'week';
    const nWeeks = isWeek ? 1 : c.weeks;
    const wantL = Math.max(1, isWeek ? Math.min(14, c.maxEventsPerDay * 3) : c.maxEventsPerDay);
    this.root.classList.toggle('is-week', isWeek);
    const compact = c.compactBusyDays === true;
    const m = this.metrics();
    const L = Math.max(1, Math.min(wantL, m ? this.lanesFor(m.h / nWeeks - 1, m) : 99));
    const today = tick.dayKey;
    const nowMs = tick.now.getTime();
    // startToday: the first column is today, so every row is seven days from today on
    const weekStart = gridWeekStart(today, c.weekStart, c.startToday === true);
    const gridStart = startOfWeek(today, weekStart);
    this.root.style.setProperty('--weeks', String(nWeeks));
    this.root.style.setProperty('--lanes', String(L));

    // ---- header: month title + legend
    // Just the current month: the grid itself marks where the next one starts ("Nov").
    const title = `<b>${esc(monthName(lang, +today.slice(5, 7)))}</b> <span>${today.slice(0, 4)}</span>`;
    setHTML(this.head.querySelector('.cal-title') as HTMLElement, title);
    const legend = c.showLegend
      ? c.sources
          .map((s) => {
            const col = chipColors(s.color);
            return `<span class="lg"><i style="--c:${col.base}"></i>${s.emoji ? `<span class="em">${esc(s.emoji)}</span>` : ''}${esc(s.name)}</span>`;
          })
          .join('')
      : '';
    setHTML(this.head.querySelector('.legend') as HTMLElement, legend);

    // ---- weekday header
    const names = weekdayNames(lang, weekStart, 'short');
    const todayCol = (weekdayOfKey(today) - weekStart + 7) % 7;
    setHTML(
      this.dow,
      names
        .map((n, i) => {
          const wd = (weekStart + i) % 7;
          return `<div class="${i === todayCol ? 'is-today' : ''}${wd === 0 || wd === 6 ? ' we' : ''}">${esc(n)}</div>`;
        })
        .join(''),
    );

    // ---- weeks
    let list = events;
    if (c.hidePast) list = list.filter((e) => e.spanLast >= today && !(e.timed && e.endMs <= nowMs));
    const weekSpecs: Spec[] = [];
    const weekRows: { key: string; start: string }[] = [];
    for (let w = 0; w < nWeeks; w++) {
      const ws = addDays(gridStart, w * 7);
      weekRows.push({ key: ws, start: ws });
      weekSpecs.push({ key: `w${ws}`, className: 'wk', html: '' });
    }
    reconcile(this.weeks, weekSpecs, { flip: true });
    const rowEls = Array.from(this.weeks.children).filter((x) => !(x as any).__leaving) as HTMLElement[];

    this.geom = this.measureGeom();
    const layouts = weekRows.map((row) => this.layoutWeek(row.start, list));
    // Compact busy days: rows share the height by what their events need (equal rows while every week fits)
    let rowHs: number[] | null = null;
    if (compact && m && nWeeks > 1) {
      const needs = layouts.map((segs) => {
        const { days, normal } = this.daySummary(segs, wantL);
        return weekNeed(days, normal, wantL, m);
      });
      const minRow = m.numH + m.gap + m.laneH + m.gap;
      rowHs = shareRows(needs, m.h - nWeeks, minRow).map((x) => x + 1);
    }
    const rows = rowHs ? rowHs.map((x) => `minmax(0, ${x.toFixed(1)}fr)`).join(' ') : '';
    if (this.weeks.style.gridTemplateRows !== rows) this.weeks.style.gridTemplateRows = rows;
    weekRows.forEach((row, w) => {
      const el = rowEls[w];
      if (!el) return;
      const rowH = rowHs ? rowHs[w] - 1 : m ? m.h / nWeeks - 1 : 0;
      const Lw = rowHs && m ? Math.max(1, Math.min(wantL, this.lanesFor(rowH, m))) : L;
      el.style.setProperty('--lanes', String(Lw));
      reconcile(el, this.weekSpecs(row.start, layouts[w], Lw, today, nowMs, t, tz, isWeek, compact ? m : null, rowH), { flip: true });
    });
    this.applyPages();
  }

  /** Busy days: page turns so far (every day shows page step % its page count, so they all turn together). */
  private pageStep = 0;
  private pageTimer: ReturnType<typeof setInterval> | null = null;

  /** Show the current page of every busy day (and its "1/2" label); runs the page timer only while one exists. */
  private applyPages(): void {
    let any = false;
    for (const el of Array.from(this.weeks.querySelectorAll<HTMLElement>('[data-pgs]'))) {
      const pages = Number(el.dataset.pgs) || 1;
      if (pages > 1) any = true;
      const cur = pageAt(this.pageStep, pages);
      if (el.classList.contains('more')) {
        const txt = pageLabel(cur, pages);
        if (el.textContent !== txt) el.textContent = txt;
      } else {
        el.classList.toggle('pg-off', Number(el.dataset.pg) !== cur);
      }
    }
    if (any && !this.pageTimer) {
      this.pageTimer = setInterval(() => {
        this.pageStep++;
        this.applyPages();
        // a bar that just came into view may need to slide; the ones fading out stop once they are gone
        setTimeout(refreshMarquee, 750);
      }, PAGE_MS);
    } else if (!any && this.pageTimer) {
      clearInterval(this.pageTimer);
      this.pageTimer = null;
      this.pageStep = 0;
    }
  }

  private geom: { colW: number; rem: number; chipPx: number } | null = null;

  /** Column width + chip font size in px (null while the grid is not laid out yet). */
  private measureGeom(): { colW: number; rem: number; chipPx: number } | null {
    const w = this.weeks.clientWidth;
    if (!w) return null;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const raw = getComputedStyle(this.root).getPropertyValue('--chip-fs').trim();
    const n = parseFloat(raw);
    const chipPx = Number.isFinite(n) ? (raw.endsWith('px') ? n : n * rem) : 1.68 * rem;
    return { colW: w / 7, rem, chipPx };
  }

  /**
   * Widest single word of the title vs the chip's inner width: 1 = fits, 0.9 = fits only with the smaller font,
   * 0 = never fits (wrapping would split a word: keep the one-line ellipsis instead).
   */
  private wordScale(e: NEvent): number {
    const g = this.geom;
    if (!g) return 1;
    const inner = g.colW - 0.8 * g.rem - (e.timed ? 1.8 : 1.6) * g.rem - 2;
    let widest = 0;
    e.title.split(/\s+/).filter(Boolean).forEach((w, i) => {
      let ww = textWidth(w, g.chipPx, 560) * 1.04;
      // the emoji is glued (word joiner) to the first word when there is no time label in between
      if (i === 0 && e.emoji && !e.timed) ww += g.chipPx * 1.12 + 0.45 * g.rem;
      widest = Math.max(widest, ww);
    });
    if (widest <= inner) return 1;
    if (widest * 0.9 <= inner) return 0.9;
    return 0;
  }

  /** Lines a single-day chip needs to show its whole title (emoji + time inline on the first line). */
  private linesNeeded(e: NEvent, timeText: string, extra: string): number {
    const g = this.geom;
    if (!g) return 1;
    const { colW, rem, chipPx } = g;
    const inner = colW - 0.8 * rem - (e.timed ? 1.8 : 1.6) * rem - 2;
    if (inner <= 0) return 1;
    let w = textWidth(e.title, chipPx, 560);
    if (e.emoji) w += chipPx * 1.12 + 0.55 * rem;
    if (timeText) w += textWidth(timeText, chipPx, 700) + 0.55 * rem;
    if (extra) w += textWidth(extra, chipPx, 400) + 0.55 * rem;
    // word-wrapping wastes some of every line: be a bit pessimistic
    return Math.max(1, Math.ceil((w * 1.04) / inner + (w > inner ? 0.12 : 0)));
  }

  /**
   * P1a: let single-day chips grow into free lanes below them instead of truncating "Merca…": as far down as the day
   * is free when it is the day's only event, about 2 lines when it shares the day (what still does not fit scrolls,
   * marquee.ts). Only days whose chips are all visible are re-laid out, so the "+N"
   * capacity logic (lanes ≥ L hidden) is unchanged. Multi-day bars keep their lanes.
   */
  private planWrap(segs: Placed[], hidden: Set<Placed>, L: number, labels: Map<Placed, { tm: string; extra: string }>): void {
    if (!this.geom) return;
    const isSingle = (sg: Placed) => sg.eSlot - sg.s === 2 && sg.s % 2 === 0 && !sg.e.airbnb;
    const blocked: boolean[][] = Array.from({ length: L }, () => new Array(14).fill(false));
    for (const sg of segs) {
      if (hidden.has(sg) || isSingle(sg) || sg.lane >= L) continue;
      for (let i = sg.s; i < sg.eSlot; i++) blocked[sg.lane][i] = true;
    }
    // Make room: when a long single-day chip can't grow because a multi-day bar sits in the lane right below it
    // (e.g. a reservation starting that afternoon), push that bar down to a lane that is free along its whole
    // span. Bars only ever move down into free space, so nothing overlaps and no new "+N" appears.
    const occupied = (lane: number, s0: number, s1: number, skip: Placed[]) =>
      segs.some((o) => !skip.includes(o) && !hidden.has(o) && o.lane <= lane && lane < o.lane + (o.span ?? 1) && o.s < s1 && s0 < o.eSlot);
    for (let d = 0; d < 7; d++) {
      const day = segs.filter((sg) => isSingle(sg) && sg.s === 2 * d && !hidden.has(sg));
      if (day.length !== 1) continue;
      const sg = day[0];
      const lb = labels.get(sg);
      if (this.wordScale(sg.e) === 0 || this.linesNeeded(sg.e, lb?.tm ?? '', lb?.extra ?? '') < 2) continue;
      const below = sg.lane + 1;
      if (below >= L) continue;
      const bars = segs.filter((o) => o !== sg && !hidden.has(o) && !isSingle(o) && o.lane === below && o.s < 2 * d + 2 && 2 * d < o.eSlot);
      if (!bars.length) continue;
      const moves: [Placed, number][] = [];
      for (const b of bars) {
        let target = -1;
        for (let t = below + 1; t < L; t++) {
          if (!occupied(t, b.s, b.eSlot, [b, ...moves.map((m) => m[0])])) { target = t; break; }
        }
        if (target < 0) { moves.length = 0; break; }
        moves.push([b, target]);
      }
      if (moves.length !== bars.length) continue;
      for (const [b, t] of moves) {
        for (let i = b.s; i < b.eSlot; i++) blocked[b.lane][i] = false;
        b.lane = t;
        for (let i = b.s; i < b.eSlot; i++) blocked[t][i] = true;
      }
    }
    for (let d = 0; d < 7; d++) {
      const day = segs.filter((sg) => isSingle(sg) && sg.s === 2 * d);
      if (!day.length || day.some((sg) => hidden.has(sg))) continue;
      const free: number[] = [];
      for (let l = 0; l < L; l++) if (!blocked[l][2 * d] && !blocked[l][2 * d + 1]) free.push(l);
      if (free.length < day.length) continue;
      day.sort((a, b) => a.lane - b.lane);
      const maxSpan = wrapLineCap(day.length, this.roomy, free.length);
      const base = day.map((sg) => {
        const lb = labels.get(sg);
        return this.linesNeeded(sg.e, lb?.tm ?? '', lb?.extra ?? '');
      });
      // Two weeks: columns are narrow for long words, so wrapping wastes more of each line. Give every chip of the
      // day one spare line, but only when all of them get it (a busy day keeps the tighter estimate).
      const spare = this.roomy && base.reduce((n, b) => n + Math.min(maxSpan, b + 1), 0) <= free.length ? 1 : 0;
      let p = 0;
      day.forEach((sg, i) => {
        const scale = this.wordScale(sg.e);
        // alone on its day: one more line when there is room (the estimate can be a line short, e.g. when the time
        // and the first word do not share a line)
        const need = base[i] + (day.length === 1 ? Math.max(spare, 1) : spare);
        const want = scale === 0 ? 1 : Math.min(maxSpan, need);
        const rest = day.length - i - 1;
        let span = 1;
        while (span < want && p + span < free.length - rest && free[p + span] === free[p] + span) span++;
        sg.lane = free[p];
        sg.span = span;
        sg.long = scale < 1 || base[i] + spare > span;
        p += span;
      });
    }
  }

  /** Page count of each busy day of the last rendered week (day key → pages). */
  private busyPages = new Map<string, number>();

  /**
   * Busy days (more events than lanes): instead of "+N", the day pages through all its events. Bars that also cover
   * other days keep their lanes so they stay lined up; the day's own events (and a one-day piece of any bar that did
   * not fit) take turns in the lanes left free. Returns the extra pieces to draw; marks paged chips with their page.
   */
  private planBusyDays(ws: string, segs: Placed[], hidden: Set<Placed>, moreCount: number[], L: number, skip: Set<number>): Placed[] {
    const pieces: Placed[] = [];
    for (let d = 0; d < 7; d++) {
      if (!moreCount[d] || skip.has(d)) continue;
      const key = addDays(ws, d);
      const a = 2 * d, b = 2 * d + 2;
      const inDay = (sg: Placed) => sg.s < b && a < sg.eSlot;
      const local = (sg: Placed) => sg.s >= a && sg.eSlot <= b;
      const fixed = segs.filter((sg) => inDay(sg) && !local(sg) && !hidden.has(sg));
      const free: number[] = [];
      for (let l = 0; l < L; l++) if (!fixed.some((f) => f.lane <= l && l < f.lane + (f.span ?? 1))) free.push(l);
      const pool: Placed[] = segs.filter((sg) => local(sg));
      const cut: Placed[] = [];
      // Every lane is held by bars that cover other days too: the bar in the last lane gives this day up (it keeps
      // its lane on the other days and shows a one-day piece among the pages), or the day's own events would never
      // show at all.
      const last = !free.length && L > 0 ? fixed.find((f) => f.lane === L - 1 && (f.span ?? 1) === 1) : undefined;
      if (last) {
        cut.push({
          e: last.e, s: Math.max(last.s, a), eSlot: Math.min(last.eSlot, b), lane: -1,
          contL: last.contL || last.s < a, contR: last.contR || last.eSlot > b, piece: true, day: key,
        });
        const after: Placed | null = last.eSlot > b ? { ...last, s: b, contL: true, part: `>${key}` } : null;
        if (last.s < a) {
          last.eSlot = a;
          last.contR = true;
          if (after) segs.push(after);
        } else if (after) Object.assign(last, after);
        free.push(L - 1);
      }
      for (const sg of segs) {
        if (!hidden.has(sg) || !inDay(sg) || local(sg)) continue;
        cut.push({
          e: sg.e, s: Math.max(sg.s, a), eSlot: Math.min(sg.eSlot, b), lane: -1,
          contL: sg.contL || sg.s < a, contR: sg.contR || sg.eSlot > b, piece: true, day: key,
        });
      }
      pool.push(...cut);
      pool.sort((x, y) => sortForDay(x.e, y.e));
      const plan = planPages(pool, free);
      if (!plan) continue;
      for (const { item, page, lane } of plan.placed) {
        item.lane = lane;
        item.span = 1;
        hidden.delete(item);
        if (plan.pages > 1) Object.assign(item, { page, pages: plan.pages, day: key });
      }
      pieces.push(...cut);
      if (plan.pages > 1) this.busyPages.set(key, plan.pages);
      else moreCount[d] = 0; // everything fits once the long bars are cut to this day
    }
    return pieces;
  }

  /** Grid metrics in px (null while the grid is not laid out yet). */
  private metrics(): Metrics | null {
    const h = this.weeks.clientHeight;
    if (!h) return null;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    const cs = getComputedStyle(this.root);
    const v = (name: string, def: number) => {
      const raw = cs.getPropertyValue(name).trim();
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return def * rem;
      return raw.endsWith('px') ? n : n * rem;
    };
    const lineFs = v('--chip-fs', 1.68) * COMPACT_FONT;
    const lineH = Math.round(lineFs * COMPACT_LINE);
    // the CSS draws the compact entries with these sizes, so what is planned is what shows
    const set = (k: string, px: number) => {
      const val = `${px.toFixed(2)}px`;
      if (this.root.style.getPropertyValue(k) !== val) this.root.style.setProperty(k, val);
    };
    set('--cline-fs', lineFs);
    set('--cline-h', lineH);
    set('--cline-gap', Math.round(COMPACT_GAP_U * rem));
    return {
      h, rem, numH: v('--num-h', 5.8), laneH: v('--lane-h', 2.9), laneMin: v('--lane-min', 2.45), gap: v('--lane-gap', 0.42),
      lineFs, lineH, lineGap: Math.round(COMPACT_GAP_U * rem), pad: COMPACT_PAD_U * rem,
    };
  }

  /** How many event lanes fit in a week row of `rowH` px without squashing chips. */
  private lanesFor(rowH: number, m: Metrics): number {
    return Math.floor((rowH - m.numH - m.gap) / (m.laneMin + m.gap));
  }

  /** Segments of the events overlapping the week starting `ws`, with lanes given greedily (bars first). */
  private layoutWeek(ws: string, events: NEvent[]): Placed[] {
    const we = addDays(ws, 6);
    const segs: Placed[] = [];
    for (const e of events) {
      if (e.spanLast < ws || e.spanFirst > we) continue;
      const contL = e.spanFirst < ws;
      const contR = e.spanLast > we;
      const d0 = contL ? 0 : diffDays(ws, e.spanFirst);
      const d1 = contR ? 6 : diffDays(ws, e.spanLast);
      let s = d0 * 2;
      let eSlot = d1 * 2 + 2;
      if (e.halfStart && !contL) s += 1;
      if (e.halfEnd && !contR) eSlot -= 1;
      segs.push({ e, s, eSlot, lane: -1, contL, contR });
    }
    segs.sort((a, b) => {
      const ab = a.e.bar || a.eSlot - a.s > 2, bb = b.e.bar || b.eSlot - b.s > 2;
      if (ab !== bb) return ab ? -1 : 1;
      if (ab) {
        if (a.s !== b.s) return a.s - b.s;
        if (b.eSlot - b.s !== a.eSlot - a.s) return b.eSlot - b.s - (a.eSlot - a.s);
      }
      return sortForDay(a.e, b.e);
    });
    const occ: boolean[][] = [];
    for (const sg of segs) {
      let lane = 0;
      for (;; lane++) {
        const row = (occ[lane] ||= new Array(14).fill(false));
        let free = true;
        for (let i = sg.s; i < sg.eSlot; i++) if (row[i]) { free = false; break; }
        if (free) {
          for (let i = sg.s; i < sg.eSlot; i++) row[i] = true;
          break;
        }
      }
      sg.lane = lane;
    }
    return segs;
  }

  /**
   * Per day of a laid out week: the lanes its bars keep, how many entries it would list in compact form, and how
   * many lanes it takes at normal size (a day with a single event keeps the usual behaviour: it never goes compact).
   */
  private daySummary(segs: Placed[], L: number): { days: CompactDay[]; normal: number[] } {
    const days: CompactDay[] = [];
    const normal: number[] = [];
    for (let d = 0; d < 7; d++) {
      const a = 2 * d, b = 2 * d + 2;
      let top = 0, items = 0, lanes = 0, locals = 0;
      for (const sg of segs) {
        if (!(sg.s < b && a < sg.eSlot)) continue;
        lanes = Math.max(lanes, sg.lane + 1);
        if (sg.s >= a && sg.eSlot <= b) { items++; locals++; } else if (sg.lane >= L) items++;
        else top = Math.max(top, sg.lane + 1);
      }
      days.push({ top, items });
      normal.push(locals < 2 ? Math.min(lanes, L) : lanes);
    }
    return { days, normal };
  }

  /**
   * Compact busy days: a day whose own events do not all get a lane lists them (and a one-day piece of any bar that
   * did not get one) as small one-line entries, in a column below the bars that also cover other days. Only when the
   * entries show more than the lanes would; when even they do not fit, the column pages through them (rotateBusyDays)
   * or the day shows "+N". Days handled here are added to `done` (planBusyDays leaves them alone).
   */
  private planCompact(
    ws: string, segs: Placed[], hidden: Set<Placed>, moreCount: number[], L: number, m: Metrics, rowH: number, done: Set<number>,
  ): Stack[] {
    const stacks: Stack[] = [];
    const rotate = ctx.cfg.calendar.rotateBusyDays !== false;
    const lane = laneHeight(rowH, m.numH, L, m.laneH, m.laneMin, m.gap);
    for (let d = 0; d < 7; d++) {
      const a = 2 * d, b = 2 * d + 2;
      const inDay = (sg: Placed) => sg.s < b && a < sg.eSlot;
      const local = (sg: Placed) => sg.s >= a && sg.eSlot <= b;
      const all = segs.filter(local);
      if (all.length < 2 || !all.some((sg) => hidden.has(sg))) continue;
      const fixed = segs.filter((sg) => inDay(sg) && !local(sg) && !hidden.has(sg));
      const top = fixed.reduce((n, f) => Math.max(n, f.lane + (f.span ?? 1)), 0);
      if (top >= L) continue;
      // events that got a lane above the bars (a gap left by bars of other days) keep it
      const own = all.filter((sg) => hidden.has(sg) || sg.lane >= top);
      const space = rowH - m.numH - m.gap - top * (lane + m.gap) - m.pad;
      const fit = linesThatFit(space, m.lineH, m.lineGap);
      if (!fit || fit < L - top) continue; // small entries would show fewer events than the lanes do
      const key = addDays(ws, d);
      const cut: Placed[] = segs.filter((sg) => hidden.has(sg) && inDay(sg) && !local(sg)).map((sg) => ({
        e: sg.e, s: Math.max(sg.s, a), eSlot: Math.min(sg.eSlot, b), lane: -1,
        contL: sg.contL || sg.s < a, contR: sg.contR || sg.eSlot > b, piece: true, day: key,
      }));
      const items = [...own, ...cut].sort((x, y) => sortForDay(x.e, y.e));
      for (const sg of own) hidden.add(sg);
      // the same paging as the normal busy days, with a line for a lane
      const plan = planPages(rotate ? items : items.slice(0, fit), Array.from({ length: fit }, (_, i) => i))!;
      const pages: Placed[][] = Array.from({ length: plan.pages }, () => []);
      for (const { item, page } of plan.placed) pages[page].push(item);
      moreCount[d] = plan.pages > 1 ? 1 : items.length - pages[0].length;
      if (plan.pages > 1) this.busyPages.set(key, plan.pages);
      stacks.push({ d, top, pages });
      done.add(d);
    }
    return stacks;
  }

  /** One compact entry: emoji, time (none for all-day events), title; the colour shows as for a normal chip. */
  private lineHtml(sg: Placed, today: string, nowMs: number, tz: string): string {
    const { cfg } = ctx;
    const e = sg.e;
    const col = chipColors(e.color);
    const allDay = !e.timed;
    const pastEv = e.timed ? e.endMs <= nowMs : e.spanLast < today;
    const ongoing = e.timed && e.startMs <= nowMs && e.endMs > nowMs;
    const cls = ['ev', 'cl', allDay ? 'bar single' : 'timed', pastEv ? 'past' : '', ongoing ? 'ongoing' : ''].filter(Boolean).join(' ');
    let html = e.emoji ? `<span class="em">${esc(e.emoji)}</span>` : '';
    if (e.timed) html += `<span class="tm">${esc(timeLabel(e, tz, cfg.datetime.format24, cfg.datetime.showAmPm, false, true))}</span>`;
    html += `<span class="tt">${esc(e.title)}</span>`;
    return `<div class="${cls}" style="--c:${col.base};--on:${col.onSolid};--tint:${col.tint};--shade:${col.shade}">${html}</div>`;
  }

  private weekSpecs(
    ws: string, segs: Placed[], L: number, today: string, nowMs: number, t: Ctx['t'], tz: string, isWeek: boolean,
    compact: Metrics | null, rowH: number,
  ): Spec[] {
    const { cfg, lang } = ctx;
    const c = cfg.calendar;
    const specs: Spec[] = [];

    // Day cells + numbers
    for (let d = 0; d < 7; d++) {
      const key = addDays(ws, d);
      const wd = weekdayOfKey(key);
      const dayNum = +key.slice(8, 10);
      const past = key < today;
      const isToday = key === today;
      const first = dayNum === 1;
      const col = `grid-column:${2 * d + 1} / span 2`;
      const cls = `${past ? ' past' : ''}${isToday ? ' today' : ''}${wd === 0 || wd === 6 ? ' we' : ''}${first ? ' m1' : ''}`;
      specs.push({ key: `b${key}`, className: `cell${cls}`, style: col, html: '' });
      let label = first ? esc(monthName(lang, +key.slice(5, 7), 'short')) : String(dayNum);
      if (isWeek && !first) label = `${dayNum}`;
      const numHtml = isToday ? `<span class="dot"><span>${label}</span></span>` : `<span>${label}</span>`;
      specs.push({ key: `n${key}`, className: `num${cls}`, style: `${col};grid-row:1`, html: numHtml });
    }

    // Overflow: days with items beyond L lanes show "+N" in the last lane.
    const days = (sg: Placed) => {
      const out: number[] = [];
      for (let d = Math.floor(sg.s / 2); d <= Math.floor((sg.eSlot - 1) / 2); d++) out.push(d);
      return out;
    };
    // "+N" lives in the day-number row, so it never steals a lane.
    const hidden = new Set<Placed>(segs.filter((s) => s.lane >= L));
    const moreCount = new Array(7).fill(0);
    for (const h of hidden) for (const d of days(h)) moreCount[d]++;

    const f24 = cfg.datetime.format24;
    const ampm = cfg.datetime.showAmPm;
    if (!isWeek) {
      const labels = new Map<Placed, { tm: string; extra: string }>();
      for (const sg of segs) {
        labels.set(sg, {
          tm: sg.e.timed ? timeLabel(sg.e, tz, f24, ampm, c.showEndTime, true) : '',
          extra: c.showLocation && sg.e.ev.location ? `· ${sg.e.ev.location}` : '',
        });
      }
      this.planWrap(segs, hidden, L, labels);
    }
    // Rotation off (it can be turned off while the screen runs): forget the pages, or the "+N" cells would keep a
    // stale page indicator.
    if (c.rotateBusyDays === false) this.busyPages.clear();
    for (let d = 0; d < 7; d++) this.busyPages.delete(addDays(ws, d));
    const done = new Set<number>();
    const stacks = compact && rowH > 0 ? this.planCompact(ws, segs, hidden, moreCount, L, compact, rowH, done) : [];
    const pieces = c.rotateBusyDays === false ? [] : this.planBusyDays(ws, segs, hidden, moreCount, L, done);
    for (const sg of [...segs, ...pieces]) {
      if (hidden.has(sg)) continue;
      const e = sg.e;
      const col = chipColors(e.color);
      const kind = e.bar ? 'bar' : 'timed';
      const pastEv = e.timed ? e.endMs <= nowMs : e.spanLast < today;
      const ongoing = e.timed && e.startMs <= nowMs && e.endMs > nowMs;
      const cls = [
        'ev', kind, e.allDay && !(sg.eSlot - sg.s > 2) ? 'single' : '',
        sg.contL ? 'cont-l' : '', sg.contR ? 'cont-r' : '',
        e.halfStart && !sg.contL ? 'half-l' : '', e.halfEnd && !sg.contR ? 'half-r' : '',
        pastEv ? 'past' : '', ongoing ? 'ongoing' : '', (e.airbnb && !e.checkoutMarker) ? 'airbnb' : '',
        (sg.span ?? 1) > 1 ? 'wrap' : '', (sg.span ?? 1) > 1 && sg.long ? 'long' : '',
        sg.pages ? 'pg' : '',
      ].filter(Boolean).join(' ');
      let html = e.emoji ? `<span class="em">${esc(e.emoji)}</span>` : '';
      if (e.timed) {
        html += `<span class="tm">${esc(timeLabel(e, tz, f24, ampm, c.showEndTime, true))}</span>`;
      }
      const short = sg.contL && sg.eSlot - sg.s <= 2;
      if (short && (e.airbnb && !e.checkoutMarker) && !sg.contR) html = `<span class="em">🚪</span>`;
      else html += `<span class="tt">${esc(e.title)}</span>`;
      if (c.showLocation && e.ev.location) html += `<span class="loc">${esc(e.ev.location)}</span>`;
      if (c.showDayXofY && e.bar && sg.contL && e.days > 1 && !short) {
        const x = diffDays(e.spanFirst, addDays(ws, Math.floor(sg.s / 2))) + 1; // a part after a busy day starts later
        html += `<span class="dx">${esc(t('dayXofY', { x, y: (e.airbnb && !e.checkoutMarker) ? e.days + 1 : e.days }))}</span>`;
      }
      if ((e.airbnb && !e.checkoutMarker) && !sg.contR && !short && sg.eSlot - sg.s >= 3) html += `<span class="co">🚪</span>`;
      const span = sg.span ?? 1;
      if (span > 1) {
        // multi-line chip: emoji + time glued to the first word (U+2060 word joiner; emoji allow a break after
        // them), and a real space between time and title so the title wraps naturally.
        const WJ = '\u2060';
        let tx = e.emoji ? `<span class="em">${esc(e.emoji)}</span>${WJ}` : '';
        if (e.timed) tx += `<span class="tm">${esc(timeLabel(e, tz, f24, ampm, c.showEndTime, true))}</span> `;
        tx += `<span class="tt">${esc(e.title)}</span>`;
        if (c.showLocation && e.ev.location) tx += ` <span class="loc">${esc(e.ev.location)}</span>`;
        html = `<span class="tx">${tx}</span>`;
      }
      const row = span > 1 ? `${sg.lane + 2} / span ${span};--clamp:${span}` : `${sg.lane + 2}`;
      specs.push({
        key: sg.piece ? `e${e.id}@${sg.day}` : `e${e.id}@${ws}${sg.part ?? ''}`,
        className: cls,
        style: `grid-column:${sg.s + 1} / ${sg.eSlot + 1};grid-row:${row};--c:${col.base};--on:${col.onSolid};--tint:${col.tint};--shade:${col.shade}`,
        html,
        data: sg.pages ? { day: sg.day!, pg: String(sg.page), pgs: String(sg.pages) } : undefined,
      });
    }
    for (const st of stacks) {
      const key = addDays(ws, st.d);
      const n = st.pages.length;
      const lines = (items: Placed[]) => items.map((sg) => this.lineHtml(sg, today, nowMs, tz)).join('');
      // pages are stacked in the same place; applyPages() shows one at a time, like the busy days' chips
      const html = n > 1
        ? st.pages.map((items, p) => `<div class="cpg" data-day="${key}" data-pg="${p}" data-pgs="${n}">${lines(items)}</div>`).join('')
        : lines(st.pages[0]);
      specs.push({
        key: `c${key}`,
        className: `cstack${n > 1 ? ' paged' : ''}`,
        style: `grid-column:${2 * st.d + 1} / span 2;grid-row:${st.top + 2} / -1`,
        html,
      });
    }
    for (let d = 0; d < 7; d++) {
      if (!moreCount[d]) continue;
      const key = addDays(ws, d);
      const pages = this.busyPages.get(key);
      specs.push({
        key: `m${key}`,
        className: `more${key < today ? ' past' : ''}${pages ? ' pgi' : ''}`,
        style: `grid-column:${2 * d + 1} / span 2`,
        // the page indicator's text is kept up to date by applyPages()
        html: pages ? esc(pageLabel(0, pages)) : esc(t('more', { n: moreCount[d] })),
        data: pages ? { day: key, pgs: String(pages) } : undefined,
      });
    }
    return specs;
  }
}

type Ctx = typeof ctx;
