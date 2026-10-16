// Types for cardTemplate.js (custom HTML cards), imported by web/shared/cardTemplate.ts.

export type CardErrorCode =
  | 'element' | 'attr' | 'dupAttr' | 'src' | 'css' | 'cssBlock' | 'svgUrl' | 'unclosed' | 'markup' | 'triple' | 'placeholder'
  | 'field' | 'filter' | 'place' | 'styleNum' | 'section' | 'unknown';
export interface CardError {
  code: CardErrorCode;
  el?: string;
  attr?: string;
  detail?: string;
  /** offset in the HTML */
  at: number;
  /** line in the HTML (1-based; 0 for the CSS block) */
  line: number;
}
export interface CardPlaceholder {
  kind: '=' | '#' | '^' | '/';
  name: string;
  field: string;
  filters: { name: string; args: number[] }[];
  at: number;
}
export type CardPart = string | CardPlaceholder;
export type CardNode =
  | { t: 'text'; parts: CardPart[] }
  | { t: 'open'; name: string; attrs: { name: string; parts: CardPart[] }[]; self: boolean }
  | { t: 'close'; name: string };
export type CardValue = string | number | boolean | null | undefined;

export declare const CARD_ELEMENTS: readonly string[];
export declare const CARD_FIELDS: readonly string[];
export declare const CARD_FILTERS: Readonly<Record<string, [number, number]>>;
export declare const CARD_CSP: string;
export declare function cssProblem(css: string): string;
export declare function decodeEntities(s: string): string;
export declare function escapeHtml(s: string): string;
export declare function parseCard(html: string): { nodes: CardNode[]; errors: CardError[] };
export declare function checkCard(html: string, css?: string, names?: readonly string[] | null): CardError[];
export declare function cardErrorText(e: CardError): string;
export declare function renderCard(nodes: CardNode[], value: (name: string, field: string) => CardValue, fmt?: (n: number, decimals: number | null) => string): string;
export declare function cardDocument(o?: { body?: string; css?: string; vars?: Record<string, string>; scheme?: 'dark' | 'light' }): string;
export declare function cardNames(html: string): string[];
