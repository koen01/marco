// The showcase screens (website and video), made up and in English with &lang=en: one registry so the demo's
// mockCanvas.ts (layouts), mockHa.ts (Home Assistant states, statistic, history, camera) and mock.ts (to-do items,
// note, theme, family size, countdowns) read what each screen needs from one place.
//   ?demo=1&preset=canvas&lang=en&shot=show.<key>[&now=...]      one screen (the clock stands still)
//   ?demo=1&carousel=1&show=1&lang=en[&now=...]                  the showcase carousel (SHOW_CAROUSEL_STEPS)
// A key must start with "show.": the family demo and the player's track are in English only on these screens.
import type { CanvasConfig, CanvasItem, ChoreSlot, CountdownsResponse, HaHistory, HaSlim, HaStatistic, MessageConfig, TodoItem } from '../../shared/types';
import { SHOW_BENTO, SHOW_BENTO_PHOTO, SHOW_BENTO_TODO } from './bento';
import { CINEMATIC, CINEMATIC_KEY } from './cinematic';
import { DATA_SHOWCASE } from './data';
import { EVERYDAY, EVERYDAY_MESSAGE } from './everyday';
import { FAMILY_CHORES, FAMILY_COUNTDOWNS_FILTER, SHOW_FAMILY } from './family';
import { SHOW_HOME, SHOW_HOME_PHOTO, showHomeArt, showHomeCameraFrame, showHomeHistory, showHomeState, showHomeStatistic } from './home';
import { LIGHT_HA, LIGHT_TODO, SHOW_LIGHT } from './light';
import { PORTRAIT_HA, PORTRAIT_LAYOUT, PORTRAIT_TODO } from './portrait';

type Raw = { kind: CanvasItem['kind']; pos: CanvasItem['pos']; portrait?: CanvasItem['pos']; props?: Record<string, unknown>; style?: Partial<CanvasItem['style']> };
export type ShowFixture = { canvas: Partial<CanvasConfig>; items: Raw[]; orientation?: 'portrait' | 'landscape' };

export interface Showcase {
  fixture: ShowFixture;
  /** the made-up state of an alias (`cv_demo0003:0`) before the demo's states by domain order */
  ha?: (alias: string) => HaSlim | null;
  statistic?: (itemId: string) => HaStatistic | null;
  history?: (itemId: string) => HaHistory | null;
  camera?: (n: number) => Promise<Blob | null>;
  /** the player's cover as a data: URL (mockHa's demoArt; the other showcases take show.home's) */
  art?: () => Promise<string | null>;
  /** the screen's one photo, alone in mockPhotos() (its background or its photo card's; a stock picture, its author as Picsum lists it) */
  photo?: { url: string; author: string };
  /** cfg.todo.items */
  todo?: TodoItem[];
  /** cfg.message */
  message?: MessageConfig;
  /** cfg.screen.theme (?theme= still wins) */
  theme?: 'light' | 'dark';
  /** the family with the grandmother and the grown-ups' chores (as ?members=6) */
  members6?: boolean;
  /** the family's routines and chores in place of mock.ts MOCK_CHORES: [member, slot, emoji, title, stars] */
  chores?: [string, ChoreSlot, string, string, number][];
  /** over mockCountdowns() */
  countdowns?: (r: CountdownsResponse) => CountdownsResponse;
  /** the moment the screen was made for (&now=, in UTC); the screen shows it in the demo's Lisbon time */
  now: string;
}

const byMap = (m: Record<string, HaSlim>) => (alias: string) => m[alias] ?? null;

export const SHOWCASES: Record<string, Showcase> = {
  'show.home': {
    fixture: SHOW_HOME, ha: showHomeState, statistic: showHomeStatistic, history: showHomeHistory, camera: showHomeCameraFrame,
    art: showHomeArt, photo: SHOW_HOME_PHOTO, now: '2026-10-15T17:42Z',
  },
  'show.family': {
    fixture: SHOW_FAMILY, theme: 'light', members6: true, chores: FAMILY_CHORES, countdowns: FAMILY_COUNTDOWNS_FILTER, now: '2026-10-27T07:40Z',
  },
  'show.data': { fixture: DATA_SHOWCASE, now: '2026-10-15T17:42Z' },
  'show.everyday': { fixture: EVERYDAY, message: EVERYDAY_MESSAGE, now: '2026-10-15T07:20Z' },
  'show.bento': { fixture: SHOW_BENTO, todo: SHOW_BENTO_TODO, photo: SHOW_BENTO_PHOTO, now: '2026-10-15T17:42Z' },
  [CINEMATIC_KEY]: { fixture: CINEMATIC, now: '2026-10-15T17:42Z' },
  'show.portrait': { fixture: PORTRAIT_LAYOUT, ha: byMap(PORTRAIT_HA), todo: PORTRAIT_TODO, now: '2026-10-15T16:12Z' },
  'show.light': { fixture: SHOW_LIGHT, ha: byMap(LIGHT_HA), todo: LIGHT_TODO, theme: 'light', now: '2026-10-15T08:40Z' },
};

/** The steps of the showcase carousel (?demo=1&carousel=1&show=1), in order. */
export const SHOW_CAROUSEL_STEPS = ['show.home', 'show.family', 'show.data', 'show.everyday', 'show.cinematic'] as const;

const q = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
/** &shot= of this page. */
export const SHOT = q.get('shot') ?? '';
/** ?carousel=1&show=1: the showcase carousel. */
export const SHOW_CAROUSEL = q.get('carousel') === '1' && q.get('show') === '1';
/** A showcase screen or the showcase carousel is on: the demo speaks English for the family and the player. */
export const SHOW_ACTIVE = SHOT.startsWith('show.') || SHOW_CAROUSEL;

/**
 * The showcase a config shows: a step of the showcase carousel carries its key as its screenId, a single screen is
 * the page's &shot=.
 */
export function showcaseOf(cfg: { screenId?: string } | null | undefined): Showcase | null {
  const id = cfg?.screenId ?? '';
  return SHOWCASES[id] ?? SHOWCASES[SHOT] ?? null;
}

/** What the page's countdowns go through (the family screen, also in the carousel, leaves out the birthdays). */
export function showCountdowns(r: CountdownsResponse): CountdownsResponse {
  const f = SHOWCASES[SHOT]?.countdowns ?? (SHOW_CAROUSEL ? SHOWCASES['show.family'].countdowns : undefined);
  return f ? f(r) : r;
}

/** The demo camera's picture on a showcase page (the driveway of show.home), or null for the demo's own. */
export function showCamera(): ((n: number) => Promise<Blob | null>) | null {
  return SHOWCASES[SHOT]?.camera ?? (SHOW_CAROUSEL ? SHOWCASES['show.home'].camera ?? null : null);
}

/** The player's cover on a showcase page that has none of its own: show.home's (a stock photo made into a sleeve). */
export const showArt = (): Promise<string | null> => showHomeArt();

/** The one photo of a showcase page (the demo's only photo there), or null for the demo's own list. */
export function showPhoto(): { url: string; author: string } | null {
  return SHOWCASES[SHOT]?.photo ?? null;
}
