// Custom HTML cards (canvas kind 'html', self-hosted only): the template language, the allowlist sanitiser and the
// document a card is drawn in. Pure (no DOM, no node:* imports): the server validates with it, the admin's editor
// shows its errors and a live preview with it, and the display runs it again on what it draws (web/shared/
// cardTemplate.ts re-exports this file). Docs: docs/ARCHITECTURE.md, SECURITY.md.
//
// - The HTML is read by a small tokenizer and written out again from what it read, never passed through: only the
//   elements and attributes of the allowlist below, every text and attribute value escaped, in double quotes. Anything
//   outside the allowlist is an error that names it (never a silent removal), so the owner sees what will not draw and
//   tricks that rebuild a tag once something is stripped (`<scr<script>ipt>`) have nothing to work with.
// - Placeholders `{{name}}`, `{{name.unit}}`, `{{name.ago}}`, filters `| round:1`, `| upper`, `| lower`, `| num`,
//   `| pct`, `| clamp:0:100`, sections `{{#name.on}}…{{/name.on}}` and `{{^name.on}}…{{/name.on}}`. Always escaped.
//   They may stand in text and in the values of class, title and data-*; in style only behind a numeric filter (its
//   output is a plain number), so a bound value such as `100%;background:url(…)` cannot add CSS. In the CSS block, in
//   src, or in an element or attribute name they are an error.
// - The card is drawn in <iframe sandbox="" srcdoc> with the meta CSP below: no script, no network, no navigation.

/** Elements a card may use. */
export const CARD_ELEMENTS = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'small', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'hr', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
  'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan',
];
const ELEMENTS = new Set(CARD_ELEMENTS);
const VOID = new Set(['br', 'hr', 'img']);
const SVG = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan']);
/** Attributes every element may have (plus data-*). */
const GLOBAL_ATTRS = new Set(['class', 'title', 'style', 'colspan', 'rowspan', 'alt']);
/** Presentation and geometry attributes of the SVG elements, by their lower-case name (written in SVG's own case). */
const SVG_ATTRS = new Map([
  'viewBox', 'preserveAspectRatio', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'pathLength',
].map((a) => [a.toLowerCase(), a]));
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The only images a card may hold: raster data URIs (no SVG documents, no addresses). */
const IMG_SRC_RE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i;

/** Fields a placeholder may read: the value itself, its unit, how long ago it changed, on or off, its name, a time. */
export const CARD_FIELDS = ['', 'unit', 'ago', 'on', 'name', 'time'];
/** Filters and how many numbers each takes. */
export const CARD_FILTERS = { round: [0, 1], upper: [0, 0], lower: [0, 0], num: [0, 0], pct: [0, 0], clamp: [2, 2] };
/** Filters whose output is a plain number (`-?[0-9.]+`): the only ones allowed inside style="…". */
const NUMERIC = new Set(['num', 'pct', 'clamp']);

/** The policy of a card's document: nothing may load but inline styles and data: images. */
export const CARD_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'";

// ---- CSS ---------------------------------------------------------------------------------------------------------

// the at-rule for imports is written in two pieces: core-lint.test.js would read the plain word as a module import
const CSS_BANNED = ['@im' + 'port', '@font-face', '@namespace', 'expression(', '-moz-binding', 'behavior:', '</', '<!--', '{{', '}}', '\\'];

/** Why a card's CSS (the CSS block or a style="…") is refused ('' = fine). */
export function cssProblem(css) {
  const s = String(css || '').toLowerCase();
  const bad = CSS_BANNED.find((x) => s.includes(x));
  if (bad) return bad === '\\' ? 'backslash' : bad;
  const re = /url\(\s*(['"]?)([^'")]*)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) if (!m[2].trim().startsWith('data:')) return 'url()';
  if (/(?:^|[^a-z0-9_-])(?:-webkit-)?image-set\s*\(/.test(s)) return 'image-set()';
  if (/(?:^|[^a-z0-9_-])src\s*\(/.test(s)) return 'src()';
  return '';
}

// ---- text --------------------------------------------------------------------------------------------------------

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', deg: '°', euro: '€',
  pound: '£', yen: '¥', cent: '¢', middot: '·', bull: '•', hellip: '…', ndash: '–', laquo: '«', raquo: '»',
  times: '×', divide: '÷', plusmn: '±', micro: 'µ', sect: '§', para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓',
  frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³', ordm: 'º', ordf: 'ª', iexcl: '¡', iquest: '¿', shy: '­',
};

/** Character references decoded (numeric ones and the common named ones; others stay as they are written). */
export function decodeEntities(s) {
  return String(s).replace(/&(?:#(\d{1,8})|#x([0-9a-f]{1,7})|([a-z][a-z0-9]{1,8}));?/gi, (all, dec, hex, name) => {
    if (name) return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : all;
    const n = dec ? Number(dec) : parseInt(hex, 16);
    if (!n || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
    return String.fromCodePoint(n);
  });
}

/** Escaped for HTML text and double-quoted attribute values: & < > " ' ` and the braces (no placeholder survives). */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"'`{}]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// ---- placeholders ------------------------------------------------------------------------------------------------

// the spaces around a section's sign are one optional group, so a long run of spaces is read once (no backtracking)
const PH_RE = /^\s*(?:([#^/])\s*)?([a-zA-Z][a-zA-Z0-9_]{0,23})(?:\.([a-zA-Z]+))?\s*((?:\|\s*[a-zA-Z]+\s*(?::\s*-?\d+(?:\.\d+)?\s*)*)*)$/;

/**
 * Split `raw` (a text node or an attribute value as written) into literal strings and placeholders. Problems are
 * pushed to `errors` with `at` (offset of `raw` in the template).
 */
function splitPlaceholders(raw, at, errors) {
  const parts = [];
  let i = 0;
  for (;;) {
    const open = raw.indexOf('{{', i);
    if (open < 0) break;
    if (open > i) parts.push(decodeEntities(raw.slice(i, open)));
    if (raw[open + 2] === '{') {
      errors.push({ code: 'triple', at: at + open });
      return null;
    }
    const close = raw.indexOf('}}', open + 2);
    if (close < 0) {
      errors.push({ code: 'placeholder', detail: raw.slice(open, open + 24), at: at + open });
      return null;
    }
    const body = raw.slice(open + 2, close);
    const m = PH_RE.exec(body);
    if (!m) {
      errors.push({ code: 'placeholder', detail: `{{${body.slice(0, 40)}}}`, at: at + open });
      return null;
    }
    const field = (m[3] ?? '').toLowerCase();
    const filters = [];
    for (const f of (m[4] ?? '').split('|').slice(1)) {
      const [fname, ...args] = f.split(':').map((x) => x.trim());
      const name = fname.toLowerCase();
      const want = CARD_FILTERS[name];
      if (!want) {
        errors.push({ code: 'filter', detail: fname, at: at + open });
        return null;
      }
      if (args.length < want[0] || args.length > want[1]) {
        errors.push({ code: 'filter', detail: f.trim(), at: at + open });
        return null;
      }
      filters.push({ name, args: args.map(Number) });
    }
    const ph = { kind: m[1] || '=', name: m[2], field, filters, at: at + open };
    if (!CARD_FIELDS.includes(field)) {
      errors.push({ code: 'field', detail: `${m[2]}.${m[3]}`, at: at + open });
      return null;
    }
    if (ph.kind !== '=' && filters.length) {
      errors.push({ code: 'placeholder', detail: `{{${body.trim()}}}`, at: at + open });
      return null;
    }
    parts.push(ph);
    i = close + 2;
  }
  if (i < raw.length) parts.push(decodeEntities(raw.slice(i)));
  return parts;
}

// ---- the tokenizer -----------------------------------------------------------------------------------------------

const WS = /[\t\n\f\r ]/;

/** Line number (1-based) of an offset. */
const lineOf = (src, at) => src.slice(0, at).split('\n').length;

/**
 * Read a card's HTML. Returns { nodes, errors }: nodes = [{ t: 'text', parts } | { t: 'open', name, attrs: [{ name,
 * parts }], self } | { t: 'close', name }]; errors = [{ code, el?, attr?, detail?, at, line }] (empty = fine). Codes:
 * element, attr, dupAttr, src, css, svgUrl, unclosed, markup, triple, placeholder, field, filter, place, styleNum,
 * section.
 */
export function parseCard(html) {
  const src = String(html ?? '');
  const n = src.length;
  const nodes = [];
  const errors = [];
  const text = (raw, at) => {
    if (!raw) return;
    const parts = splitPlaceholders(raw, at, errors);
    if (parts) nodes.push({ t: 'text', parts });
  };
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      text(src.slice(i), i);
      break;
    }
    text(src.slice(i, lt), i);
    const next = src[lt + 1] ?? '';
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) {
        errors.push({ code: 'unclosed', detail: '<!--', at: lt });
        break;
      }
      i = end + 3;
      continue;
    }
    if (next === '!' || next === '?') {
      const end = src.indexOf('>', lt);
      errors.push({ code: 'markup', detail: src.slice(lt, Math.min(end < 0 ? n : end + 1, lt + 24)), at: lt });
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (next === '{') {
      errors.push({ code: 'place', detail: 'element', at: lt });
      i = lt + 1;
      continue;
    }
    const closing = next === '/';
    const start = lt + (closing ? 2 : 1);
    if (!/[a-zA-Z]/.test(src[start] ?? '')) {
      if (closing) {
        // "</" with no name: a parse error the browser would turn into a comment
        errors.push({ code: 'markup', detail: src.slice(lt, lt + 12), at: lt });
        const end = src.indexOf('>', lt);
        if (end < 0) break;
        i = end + 1;
        continue;
      }
      // "a < b": a plain character
      nodes.push({ t: 'text', parts: ['<'] });
      i = lt + 1;
      continue;
    }
    // the tag name runs to a space, "/" or ">" (as in the browser), so "<scr<script>" is the element "scr<script"
    let j = start;
    while (j < n && !WS.test(src[j]) && src[j] !== '/' && src[j] !== '>') j++;
    const rawName = src.slice(start, j);
    const name = rawName.toLowerCase();
    const tagAt = lt;
    let bad = false;
    if (rawName.includes('{{')) {
      errors.push({ code: 'place', detail: 'element', at: tagAt });
      bad = true;
    } else if (!/^[a-z][a-z0-9-]*$/.test(name) || !ELEMENTS.has(name)) {
      // its end tag is not a second mistake
      if (!closing || !errors.some((e) => e.code === 'element' && e.el === name.slice(0, 40))) errors.push({ code: 'element', el: name.slice(0, 40), at: tagAt });
      bad = true;
    }
    const attrs = [];
    const seen = new Set();
    let self = false;
    let ended = false;
    while (j < n) {
      while (j < n && WS.test(src[j])) j++;
      if (src[j] === '>') {
        j++;
        ended = true;
        break;
      }
      if (src.startsWith('/>', j)) {
        j += 2;
        self = true;
        ended = true;
        break;
      }
      if (src[j] === '/') {
        j++;
        continue;
      }
      if (j >= n) break;
      const aAt = j;
      // an attribute name runs to a space, "/", ">" or "=" (a leading "=" is part of it, as in the browser)
      let k = j + (src[j] === '=' ? 1 : 0);
      while (k < n && !WS.test(src[k]) && src[k] !== '/' && src[k] !== '>' && src[k] !== '=') k++;
      const rawAttr = src.slice(j, k);
      j = k;
      while (j < n && WS.test(src[j])) j++;
      let rawValue = null;
      let valueAt = j;
      if (src[j] === '=') {
        j++;
        while (j < n && WS.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          if (end < 0) {
            j = n;
            break;
          }
          valueAt = j + 1;
          rawValue = src.slice(j + 1, end);
          j = end + 1;
        } else {
          valueAt = j;
          let e = j;
          while (e < n && !WS.test(src[e]) && src[e] !== '>') e++;
          rawValue = src.slice(j, e);
          j = e;
        }
      }
      if (closing || bad) continue;
      const attr = rawAttr.toLowerCase();
      if (rawAttr.includes('{{')) {
        errors.push({ code: 'place', detail: 'attribute', el: name, at: aAt });
        continue;
      }
      if (!/^[a-z][a-z0-9-]*$/.test(attr)) {
        errors.push({ code: 'attr', el: name, attr: rawAttr.slice(0, 40), at: aAt });
        continue;
      }
      if (seen.has(attr)) {
        errors.push({ code: 'dupAttr', el: name, attr, at: aAt });
        continue;
      }
      seen.add(attr);
      const out = checkAttr(name, attr, rawValue ?? '', valueAt, errors);
      if (out) attrs.push(out);
    }
    if (!ended) {
      errors.push({ code: 'unclosed', detail: `<${rawName.slice(0, 20)}`, at: tagAt });
      break;
    }
    i = j;
    if (bad) continue;
    if (closing) nodes.push({ t: 'close', name });
    else nodes.push({ t: 'open', name, attrs, self: self || VOID.has(name) });
  }
  checkSections(nodes, errors);
  for (const e of errors) e.line = lineOf(src, e.at);
  return { nodes, errors };
}

/** One attribute: its parts (literal strings and placeholders), or null when it is refused (an error is pushed). */
function checkAttr(el, attr, rawValue, at, errors) {
  const svg = SVG.has(el);
  if (attr === 'xmlns' && el === 'svg') {
    // pasted SVG often carries its namespace: the only value it may have, and it is not written out (HTML adds it)
    if (decodeEntities(rawValue).trim() !== SVG_NS) errors.push({ code: 'attr', el, attr, at });
    return null;
  }
  const placeholders = attr === 'class' || attr === 'title' || attr === 'style' || attr.startsWith('data-');
  const allowed = GLOBAL_ATTRS.has(attr) || attr.startsWith('data-') || (el === 'img' && attr === 'src') || (svg && SVG_ATTRS.has(attr));
  if (!allowed || attr.startsWith('on')) {
    errors.push({ code: 'attr', el, attr, at });
    return null;
  }
  if (!placeholders && rawValue.includes('{{')) {
    errors.push({ code: 'place', detail: attr, el, at });
    return null;
  }
  const parts = splitPlaceholders(rawValue, at, errors);
  if (!parts) return null;
  if (parts.some((p) => typeof p !== 'string' && p.kind !== '=')) {
    errors.push({ code: 'place', detail: attr, el, at });
    return null;
  }
  if (attr === 'style') {
    // a placeholder in style only with a numeric filter; the CSS around it is checked with a number in its place
    if (parts.some((p) => typeof p !== 'string' && !NUMERIC.has(p.filters.at(-1)?.name ?? ''))) {
      errors.push({ code: 'styleNum', el, at });
      return null;
    }
    const bad = cssProblem(parts.map((p) => (typeof p === 'string' ? p : '0')).join(''));
    if (bad) {
      errors.push({ code: 'css', detail: bad, el, at });
      return null;
    }
  }
  if (attr === 'src' && !IMG_SRC_RE.test(parts.join(''))) {
    errors.push({ code: 'src', el, at });
    return null;
  }
  if (svg && SVG_ATTRS.has(attr) && /url\s*\(/i.test(parts.join(''))) {
    errors.push({ code: 'svgUrl', el, attr, at });
    return null;
  }
  return { name: svg && SVG_ATTRS.has(attr) ? SVG_ATTRS.get(attr) : attr, parts };
}

/** Sections open and close in order, with the same name and field. */
function checkSections(nodes, errors) {
  const stack = [];
  for (const nd of nodes) {
    if (nd.t !== 'text') continue;
    for (const p of nd.parts) {
      if (typeof p === 'string' || p.kind === '=') continue;
      const key = `${p.name}.${p.field}`;
      if (p.kind === '/') {
        const top = stack.pop();
        if (!top || top.key !== key) {
          errors.push({ code: 'section', detail: `{{/${p.name}${p.field ? `.${p.field}` : ''}}}`, at: p.at });
          return;
        }
      } else stack.push({ key, p });
    }
  }
  if (stack.length) {
    const { p } = stack.at(-1);
    errors.push({ code: 'section', detail: `{{${p.kind}${p.name}${p.field ? `.${p.field}` : ''}}}`, at: p.at });
  }
}

/** Every placeholder of a parsed card. */
function placeholdersOf(nodes) {
  const out = [];
  for (const nd of nodes) {
    const lists = nd.t === 'text' ? [nd.parts] : nd.t === 'open' ? nd.attrs.map((a) => a.parts) : [];
    for (const parts of lists) for (const p of parts) if (typeof p !== 'string') out.push(p);
  }
  return out;
}

/**
 * Check a card: its HTML (the allowlist, the placeholders, `names` = the bound names, or null to skip that check)
 * and its CSS. Returns the errors of parseCard, plus { code: 'unknown', detail: name } for a placeholder with no
 * binding and { code: 'cssBlock', detail } for the CSS block.
 */
export function checkCard(html, css = '', names = null) {
  const { nodes, errors } = parseCard(html);
  if (names) {
    const known = new Set(names);
    const told = new Set();
    for (const p of placeholdersOf(nodes)) {
      if (known.has(p.name) || told.has(p.name)) continue;
      told.add(p.name);
      errors.push({ code: 'unknown', detail: p.name, at: p.at, line: lineOf(String(html ?? ''), p.at) });
    }
  }
  const bad = cssProblem(css);
  if (bad) errors.push({ code: 'cssBlock', detail: bad, at: 0, line: 0 });
  return errors;
}

/** One error in plain English (the server's validation message). */
export function cardErrorText(e) {
  switch (e.code) {
    case 'element': return `not allowed: <${e.el}>`;
    case 'attr': return `not allowed: ${e.attr} on <${e.el}>`;
    case 'dupAttr': return `repeated attribute ${e.attr} on <${e.el}>`;
    case 'src': return 'not allowed: an image that is not a PNG, JPEG, WebP or GIF data: URI';
    case 'svgUrl': return `not allowed: url() in ${e.attr} on <${e.el}>`;
    case 'css': return `not allowed in style on <${e.el}>: ${e.detail}`;
    case 'cssBlock': return `not allowed in the CSS: ${e.detail}`;
    case 'unclosed': return `not closed: ${e.detail}`;
    case 'markup': return `not allowed: ${e.detail}`;
    case 'triple': return 'not allowed: {{{';
    case 'placeholder': return `not a placeholder: ${e.detail}`;
    case 'field': return `unknown field: ${e.detail}`;
    case 'filter': return `unknown filter: ${e.detail}`;
    case 'place': return `placeholders are not allowed in ${e.detail === 'element' || e.detail === 'attribute' ? `an ${e.detail} name` : e.detail}`;
    case 'styleNum': return 'a placeholder in style needs | num, | pct or | clamp';
    case 'section': return `section not closed or closed in the wrong order: ${e.detail}`;
    case 'unknown': return `no binding called ${e.detail}`;
    default: return e.code;
  }
}

// ---- filling in --------------------------------------------------------------------------------------------------

/** A number written plainly (no exponent, at most 3 decimals): what num, pct and clamp give. */
function plainNumber(v) {
  let n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.').replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) n = 0;
  n = Math.max(-1e9, Math.min(1e9, n));
  const s = String(Math.round(n * 1000) / 1000);
  return /^-?[0-9.]+$/.test(s) ? s : '0';
}

function applyFilters(v, filters, fmt) {
  let cur = v;
  let rounded = null;
  for (const f of filters) {
    rounded = null;
    if (f.name === 'upper') cur = String(cur ?? '').toUpperCase();
    else if (f.name === 'lower') cur = String(cur ?? '').toLowerCase();
    else if (f.name === 'num') cur = plainNumber(cur);
    else if (f.name === 'pct') cur = plainNumber(Math.max(0, Math.min(100, Number(plainNumber(cur)))));
    else if (f.name === 'clamp') {
      const [a, b] = f.args;
      cur = plainNumber(Math.max(Math.min(a, b), Math.min(Math.max(a, b), Number(plainNumber(cur)))));
    } else if (f.name === 'round') {
      const d = Math.max(0, Math.min(3, Math.round(f.args[0] ?? 0)));
      const n = typeof cur === 'number' ? cur : Number(String(cur ?? '').replace(',', '.'));
      if (cur === null || cur === undefined || cur === '' || !Number.isFinite(n)) cur = String(cur ?? '');
      else {
        cur = n;
        rounded = d;
      }
    }
  }
  if (typeof cur === 'number') return fmt(cur, rounded);
  if (typeof cur === 'boolean') return cur ? 'on' : 'off';
  return String(cur ?? '');
}

const truthy = (v) => v !== null && v !== undefined && v !== '' && v !== false;

/**
 * Fill a parsed card in. `value(name, field)` gives what a placeholder reads (a string, a number, a boolean or null);
 * `fmt(n, decimals|null)` writes a number for text (the screen's locale; decimals null = as it is). Returns HTML made
 * only of allowlisted elements and attributes, with every value escaped.
 */
export function renderCard(nodes, value, fmt = (n, d) => (d === null ? String(n) : n.toFixed(d))) {
  let out = '';
  const stack = [];
  const shown = () => stack.every(Boolean);
  const one = (p) => escapeHtml(applyFilters(value(p.name, p.field), p.filters, fmt));
  for (const nd of nodes) {
    if (nd.t === 'text') {
      for (const p of nd.parts) {
        if (typeof p === 'string') {
          if (shown()) out += escapeHtml(p);
        } else if (p.kind === '#' || p.kind === '^') {
          const v = truthy(value(p.name, p.field));
          stack.push(p.kind === '#' ? v : !v);
        } else if (p.kind === '/') stack.pop();
        else if (shown()) out += one(p);
      }
      continue;
    }
    if (!shown()) continue;
    if (nd.t === 'close') {
      if (!VOID.has(nd.name)) out += `</${nd.name}>`;
      continue;
    }
    out += `<${nd.name}`;
    for (const a of nd.attrs) out += ` ${a.name}="${a.parts.map((p) => (typeof p === 'string' ? escapeHtml(p) : one(p))).join('')}"`;
    if (SVG.has(nd.name) && nd.self) out += '/>';
    else out += '>';
    // "<div/>" is an open div to the browser; written out with its end so what is drawn is what was read
    if (nd.self && !VOID.has(nd.name) && !SVG.has(nd.name)) out += `</${nd.name}>`;
  }
  return out;
}

/** CSS variable names and values Marco passes in (its theme), kept to plain tokens. */
const VAR_NAME = /^--[a-z0-9-]{1,32}$/;
const VAR_VALUE = /^[#a-zA-Z0-9.,%() _'"/-]{1,300}$/;

/**
 * The document of a card's frame (its srcdoc): the meta CSP, Marco's theme as CSS variables, the author's CSS and the
 * filled HTML. `body` must come from renderCard and `css` must pass cssProblem (they are checked again here and an
 * empty document is written when they do not). `vars` = { '--accent': '#…', … }, `scheme` = 'dark' | 'light'.
 */
export function cardDocument({ body = '', css = '', vars = {}, scheme = 'dark' } = {}) {
  const okBody = parseCard(body).errors.length === 0 ? body : '';
  const okCss = cssProblem(css) ? '' : String(css);
  let root = '';
  for (const [k, v] of Object.entries(vars)) if (VAR_NAME.test(k) && VAR_VALUE.test(String(v)) && !/[;{}<>\\]/.test(String(v))) root += `${k}:${v};`;
  const cs = scheme === 'light' ? 'light' : 'dark';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${CARD_CSP}">` +
    `<style>:root{${root}color-scheme:${cs}}html,body{margin:0;padding:0;background:transparent;width:100%;height:100%;overflow:hidden}` +
    'body{color:var(--ink,currentColor);font-family:var(--font,system-ui,sans-serif);font-size:var(--size,16px);line-height:1.25;box-sizing:border-box}' +
    '*,*::before,*::after{box-sizing:inherit}img,svg{max-width:100%}</style>' +
    `<style>${okCss}</style></head><body>${okBody}</body></html>`;
}

/** Placeholder names a card's HTML uses (for the editor's binding table). */
export function cardNames(html) {
  return [...new Set(placeholdersOf(parseCard(html).nodes).map((p) => p.name))];
}
