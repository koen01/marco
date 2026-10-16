// Types for haCore.js (Home Assistant on Personalizado screens).
import type { HaControl, HaSlim, HaState, TileFeature } from '../../web/shared/types';

export const ENTITY_RE: RegExp;
export const ATTR_WHITELIST: readonly string[];
export function pickAttrs(attrs: unknown): Record<string, unknown>;
export function slim(domain: string, state: unknown, attrs?: Record<string, unknown>): HaSlim;
export function changedAt(st: unknown): number;
export function fromRestState(st: unknown): { state: string; attrs: Record<string, unknown>; slim: HaSlim; at: number };

export interface HaAlias {
  entity: string; itemId: string; kind: string; slot: number; interactive: boolean;
  confirm: boolean; ack: boolean; name: string; props: Record<string, unknown>;
}
export function aliasesFor(screen: unknown): Map<string, HaAlias>;
export function watchedEntities(cfg: unknown): Set<string>;

export const CONTROL_TABLE: Readonly<Record<HaControl, { domains: string[]; service: (domain: string) => string }>>;
export const FEATURE_DOMAINS: Readonly<Record<TileFeature, string[]>>;
export function tileFeatures(domain: string, attrs?: Record<string, unknown>, props?: Record<string, unknown>): TileFeature[];
export function isHighRisk(domain: string, attrs?: Record<string, unknown>, entityId?: string, name?: string): boolean;
export function isGasValve(domain: string, attrs?: Record<string, unknown>, entityId?: string, name?: string): boolean;
export function controlsFor(kind: string, domain: string, attrs?: Record<string, unknown>, props?: Record<string, unknown>): HaControl[];
export function needsConfirm(domain: string, attrs?: Record<string, unknown> | null, entityId?: string, name?: string): boolean;
export function clampValue(control: string, value: unknown, domain: string, attrs?: Record<string, unknown>, props?: Record<string, unknown>): { value: number | string | [number, number] | null } | undefined;
export function serviceCall(control: string, domain: string, value: unknown): { domain: string; service: string; data: Record<string, unknown> } | null;
export function aliasFlagged(a: HaAlias, attrs: Record<string, unknown> | null | undefined): boolean;
export function aliasControls(a: HaAlias, m: { slim: HaSlim; attrs: Record<string, unknown> } | null | undefined, touch: boolean): { c: HaControl[]; cf: boolean };
export function snapshotStates(
  aliases: Map<string, HaAlias>,
  lookup: (entity: string) => { slim: HaSlim; attrs: Record<string, unknown>; at: number } | null,
  opts?: { touch?: boolean; missing?: 'skip' | 'unavailable'; only?: Set<string> | null; hidden?: Set<string> | null },
): Record<string, HaState>;

export const CHART_PERIODS: Readonly<Record<'1h' | '6h' | '24h' | '7d', number>>;
export const MAX_POINTS: number;
export function periodRange(period: string, now?: number): { start: number; end: number; source: 'history' | 'statistics' };
export function parseHistory(raw: unknown): Map<string, [number, number][]>;
export function parseStatistics(result: unknown): Map<string, [number, number][]>;
export function downsample(points: [number, number][], n?: number): [number, number][];
export function roundPoints(points: [number, number][]): [number, number][];
