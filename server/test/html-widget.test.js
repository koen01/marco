// Custom HTML cards (canvas kind 'html', self-hosted only; server/core/cardTemplate.js, docs/CANVAS.md): the template
// language and the allowlist sanitiser (every element and attribute outside it is an error, split tags, mixed case,
// entities in attribute names, SVG data URIs, where placeholders may stand), the escaping of bound values, the
// document of the card's frame (its CSP), the validation of the kind (Cloud refuses it), the display page's CSP and
// its per-request frame-src, and a corpus of attacks run in headless Chrome: with the sanitiser bypassed on purpose,
// the frame (sandbox="", meta CSP, pointer-events:none) and the page CSP still let no script run, no request leave
// and no frame navigate (CDP Network and Page.frameNavigated events, and a listening server that counts every hit).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CARD_CSP, cardDocument, cardErrorText, checkCard, cssProblem, decodeEntities, escapeHtml, parseCard, renderCard,
} from '../core/cardTemplate.js';
import { CLOUD_CANVAS_KINDS, canvasDefaults, defaultCanvas, defaultItemStyle, projectCanvas, sanitizeCanvas } from '../core/canvasCore.js';
import { defaultConfig } from '../core/defaults.js';
import { validateConfig } from '../core/validate.js';
import * as store from '../store.js';
import { createApp, displayCsp, DISPLAY_CSP } from '../app.js';
import { closeAll } from '../sse.js';
import { findChrome, launchChrome } from './browser.js';

const M = (x, y, size) => ({ zone: 'main', x, y, size });
let seq = 0;
const htmlItem = (props, pos = M(0, 0, 'm')) => ({
  id: `cv_html${String(seq++).padStart(4, '0')}`, kind: 'html', pos, style: defaultItemStyle(), props: { ...canvasDefaults('html'), ...props },
});
const collect = () => {
  const errors = [];
  return { errors, err: (path, msg) => errors.push({ path, msg }), warn() {} };
};
const codes = (html, css = '', names = null) => checkCard(html, css, names).map((e) => e.code);
const render = (html, vals) => renderCard(parseCard(html).nodes, (n, f) => vals[n]?.[f] ?? null);

// ---- the sanitiser -----------------------------------------------------------------------------------------------

test('the allowlist: every element outside it is an error that names it', () => {
  for (const el of ['a', 'meta', 'base', 'link', 'form', 'iframe', 'object', 'embed', 'script', 'style', 'template', 'foreignObject', 'video', 'audio', 'input', 'button', 'textarea', 'details', 'math', 'noscript', 'image', 'use', 'animate', 'set', 'frame', 'marquee', 'html', 'body', 'title']) {
    const errs = checkCard(`<div><${el}>x</${el}></div>`);
    assert.ok(errs.length, el);
    assert.equal(errs[0].code, 'element', el);
    assert.equal(errs[0].el, el.toLowerCase(), el);
    assert.match(cardErrorText(errs[0]), new RegExp(`<${el.toLowerCase()}>`));
  }
  // what is allowed parses clean
  const ok = '<div class="a"><span title="t">x</span><p>y</p><h1>1</h1><h4>4</h4><small>s</small><strong>b</strong><b>b</b><em>e</em><i>i</i><u>u</u><s>s</s><br><hr>' +
    '<ul><li>1</li></ul><ol><li>2</li></ol><table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="1">d</td></tr></tbody></table>' +
    '<img alt="dot" src="data:image/png;base64,iVBORw0KGgo="><svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g><path d="M0 0L1 1"/><circle cx="1" cy="1" r="1"/><rect x="0" y="0" width="1" height="1" rx="1"/>' +
    '<line x1="0" y1="0" x2="1" y2="1" stroke="red" stroke-width="2"/><polyline points="0,0 1,1"/><polygon points="0,0 1,1 1,0" fill="blue" opacity="0.5" transform="rotate(10)"/><text x="1" y="1">t<tspan>s</tspan></text></g></svg></div>';
  assert.deepEqual(checkCard(ok), []);
});

test('the allowlist: attributes outside it, on* handlers, entities in names, split tags, mixed case, SVG data URIs', () => {
  for (const [html, code] of [
    ['<img src=x onerror=alert(1)>', 'attr'],
    ['<div onclick="x()">', 'attr'],
    ['<div ONMOUSEOVER="x()">', 'attr'],
    ['<img on&#x65;rror=alert(1)>', 'attr'],
    ['<img o&#110;error=alert(1)>', 'attr'],
    ['<div id="x">', 'attr'],
    ['<div href="https://example.org">', 'attr'],
    ['<svg><path xlink:href="#a"/></svg>', 'attr'],
    ['<svg><path href="#a"/></svg>', 'attr'],
    ['<svg xmlns="http://example.org/other"></svg>', 'attr'],
    ['<p class="a" class="b">', 'dupAttr'],
    ['<scr<script>ipt>alert(1)</script>', 'element'],
    ['<ScRiPt>alert(1)</sCrIpT>', 'element'],
    ['<SCRIPT SRC=//x></SCRIPT>', 'element'],
    ['<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">', 'src'],
    ['<img src="data:image/svg+xml,<svg onload=alert(1)>">', 'src'],
    ['<img src="https://example.org/a.png">', 'src'],
    ['<img src="javascript:alert(1)">', 'src'],
    ['<img src="data:text/html;base64,PHNjcmlwdD4=">', 'src'],
    ['<svg><rect fill="url(https://example.org/x)"/></svg>', 'svgUrl'],
    ['<div style="background:url(https://example.org/x)">', 'css'],
    ['<div style="width:expression(alert(1))">', 'css'],
    ['<div style="background:u\\72l(https://example.org)">', 'css'],
    ['<!doctype html><div>', 'markup'],
    ['<![CDATA[x]]>', 'markup'],
    ['<?xml version="1.0"?>', 'markup'],
    ['<div', 'unclosed'],
    ['<div title="x>', 'unclosed'],
    ['<!-- never closed', 'unclosed'],
  ]) {
    assert.ok(codes(html).includes(code), `${html}: ${codes(html).join(',')} (expected ${code})`);
  }
  // a stripped tag can never rebuild another one: the first refusal names the odd element as the browser reads it
  assert.equal(checkCard('<scr<script>ipt>')[0].el, 'scr<script');
  // comments are dropped, a lone "<" is text
  assert.deepEqual(checkCard('<!-- a note --><b>1 < 2</b>'), []);
  assert.equal(render('<!-- a note --><b>1 < 2</b>', {}), '<b>1 &#60; 2</b>');
});

test('placeholders: syntax, fields, filters, sections and unknown names', () => {
  assert.deepEqual(codes('{{t}} {{t.unit}} {{t.ago}} {{t.on}} {{t.name}} {{t.time}} {{t | round:1}} {{t | upper}} {{t|lower}} {{#t.on}}a{{/t.on}}{{^t}}b{{/t}}', '', ['t']), []);
  assert.ok(codes('<b>{{{x}}}</b>').includes('triple'));
  assert.ok(codes('<b title="{{{x}}}">').includes('triple'));
  assert.ok(codes('{{x.colour}}').includes('field'));
  assert.ok(codes('{{x | shout}}').includes('filter'));
  assert.ok(codes('{{x | round:1:2}}').includes('filter'));
  assert.ok(codes('{{x | clamp:1}}').includes('filter'));
  assert.ok(codes('{{x y}}').includes('placeholder'));
  assert.ok(codes('{{x').includes('placeholder'));
  assert.ok(codes('{{#x | upper}}a{{/x}}').includes('placeholder'));
  assert.ok(codes('{{#x}}a').includes('section'));
  assert.ok(codes('{{#x}}{{#y}}a{{/x}}{{/y}}').includes('section'));
  assert.ok(codes('{{/x}}').includes('section'));
  assert.deepEqual(codes('{{x}} {{y}}', '', ['x']), ['unknown']);
  assert.deepEqual(codes('{{x}} {{y}}', '', null), []);
});

test('placeholders: a long run of spaces inside {{ }} is read in linear time (no regex backtracking)', () => {
  // the editor checks every keystroke and the display parses every card: a pasted wall of spaces must not hang them
  const t = Date.now();
  assert.ok(codes(`<p>{{${' '.repeat(200_000)}!}}</p>`).includes('placeholder'));
  assert.ok(codes(`<p>{{${' '.repeat(200_000)}#${' '.repeat(200_000)}!}}</p>`).includes('placeholder'));
  assert.ok(Date.now() - t < 1000, `took ${Date.now() - t} ms`);
  // spaces around the section signs still work
  assert.deepEqual(codes('{{ # t.on }}a{{ / t.on }}{{ ^ t }}b{{ /t }}', '', ['t']), []);
});

test('placeholders: refused in CSS, href, src, names; style only behind a numeric filter', () => {
  assert.ok(codes('<img src="{{x}}">').includes('place'));
  assert.ok(codes('<img alt="{{x}}">').includes('place'));
  assert.ok(codes('<svg><rect width="{{x}}"/></svg>').includes('place'));
  assert.ok(codes('<div {{x}}="1">').includes('place'));
  assert.ok(codes('<{{x}}>').includes('place'));
  assert.ok(codes('<div{{x}}>').includes('place'));
  assert.ok(codes('<div class="{{#x}}a{{/x}}">').includes('place'));
  assert.ok(codes('<div style="width:{{x}}%">').includes('styleNum'));
  assert.ok(codes('<div style="width:{{x | upper}}%">').includes('styleNum'));
  assert.ok(codes('<div style="width:{{x | round:1}}%">').includes('styleNum'));
  for (const f of ['num', 'pct', 'clamp:0:100']) assert.deepEqual(codes(`<div style="width:{{x | ${f}}}%">`), [], f);
  assert.deepEqual(codes('<div class="a {{x}}" title="{{x.name}}" data-v="{{x}}">'), []);
  assert.ok(codes('<b>x</b>', 'b::after{content:"{{x}}"}').includes('cssBlock'));
  // a bound value can never add CSS: numeric filters give a plain number
  const out = render('<div style="width:{{x | pct}}%;height:{{x | num}}px;top:{{x | clamp:-5:5}}px"></div>', { x: { '': '100%;background:url(https://example.org/x)' } });
  assert.equal(out, '<div style="width:100%;height:100px;top:5px"></div>');
  for (const v of ['abc', '', null, '1e400', '-7.5', 1e30, NaN, '12,5']) {
    const s = render('<i style="width:{{x | num}}px;left:{{x | pct}}%">', { x: { '': v } });
    assert.match(s, /^<i style="width:-?[0-9.]+px;left:-?[0-9.]+%">$/, String(v));
  }
});

test('bound values are escaped everywhere: < > " \' ` & and braces', () => {
  const v = { x: { '': '<script>"\'`&{{y}}</script>', unit: '"><img src=x onerror=alert(1)>' } };
  const out = render('<p class="{{x}}" title="{{x.unit}}">{{x}}{{x.unit}}</p>', v);
  assert.equal(/[<>"'`]/.test(out.replace(/^<p class="|" title="|">|<\/p>$/g, '')), false, out);
  assert.equal(out.includes('{{'), false);
  assert.ok(out.includes('&#60;script&#62;&#34;&#39;&#96;&#38;&#123;&#123;y&#125;&#125;'));
  assert.equal(escapeHtml('<>"\'`&{}'), '&#60;&#62;&#34;&#39;&#96;&#38;&#123;&#125;');
  // the filled card passes the sanitiser again (what the display checks before it builds the frame)
  assert.deepEqual(checkCard(out), []);
  // character references in the template are read, then written escaped
  assert.equal(decodeEntities('&lt;b&gt; &#x3c;i&#62; &amp;amp; &unknown;'), '<b> <i> &amp; &unknown;');
  assert.equal(render('<b>&lt;script&gt;</b>', {}), '<b>&#60;script&#62;</b>');
  // sections, filters, numbers
  const r = render('{{#d.on}}open{{/d.on}}{{^d.on}}closed{{/d.on}} {{t | round:1}} {{n | upper}} {{gone}}|{{#gone}}x{{/gone}}', { d: { on: false }, t: { '': 21.456 }, n: { '': 'abc' } });
  assert.equal(r, 'closed 21.5 ABC |');
  // SVG attributes keep their case, void and self-closing elements are written the browser's way
  assert.equal(render('<svg viewbox="0 0 1 1"><path d="M0 0"/></svg><div/><br/>', {}), '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg><div></div><br>');
});

test('the CSS block: imports, fonts, external urls, escapes and expressions are refused', () => {
  for (const bad of ['@import "x.css";', '@IMPORT url(a)', '@font-face{src:x}', 'a{background:url(https://x/y.png)}', "a{b:url('//x')}", 'a{width:expression(1)}', '</style><script>', 'a{c:u\\72l(x)}',
    'a{background:image-set("https://x/a.png" 1x)}', 'a{background:-webkit-image-set(url(data:,) 1x, "https://x" 2x)}', '@namespace x url(https://x);', 'a{content:"{{x}}"}', '<!--', 'a{-moz-binding:x}']) {
    assert.ok(cssProblem(bad), bad);
  }
  assert.equal(cssProblem('.a { color: var(--accent); background: url(data:image/png;base64,AAAA); border-radius: var(--radius) }'), '');
});

test('the frame document: the meta CSP first, the theme as variables, only checked HTML and CSS', () => {
  const doc = cardDocument({ body: '<b>hi</b>', css: 'b{color:var(--accent)}', vars: { '--accent': '#ff0000', '--ink': 'rgb(255 255 255 / 0.62)', '--bad': 'red;}body{background:url(https://x)', 'color': 'red' }, scheme: 'light' });
  assert.ok(doc.startsWith('<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"'));
  assert.ok(doc.includes(`content="${CARD_CSP}"`));
  assert.equal(CARD_CSP, "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'");
  assert.ok(doc.includes('--accent:#ff0000;'));
  assert.ok(doc.includes('--ink:rgb(255 255 255 / 0.62);'));
  assert.equal(doc.includes('--bad'), false);
  assert.equal(doc.includes('https://x'), false);
  assert.ok(doc.includes('color-scheme:light'));
  assert.ok(doc.includes('<body><b>hi</b></body>'));
  // HTML or CSS that did not come through the sanitiser is not written
  const bad = cardDocument({ body: '<script>alert(1)</script>', css: '@import "x";' });
  assert.equal(/script|import/i.test(bad.split('</style>').slice(1).join('')), false);
});

// ---- validation, projection, Cloud ------------------------------------------------------------------------------

test('validation: errors name what is refused (and its line), the card keeps nothing refused, bindings are checked', () => {
  const c = collect();
  const raw = { ...defaultCanvas(), items: [htmlItem({ html: '<div>\n<a href="https://example.org">x</a></div>', css: 'a{}', bind: [] })] };
  const out = sanitizeCanvas(c, 'canvas', raw);
  assert.equal(out.items[0].props.html, '');
  assert.ok(c.errors.some((e) => e.path.endsWith('.props.html') && /<a>/.test(e.msg) && /line 2/.test(e.msg)), JSON.stringify(c.errors));

  const c2 = collect();
  const good = '<div class="x">{{temp | round:1}} {{temp.unit}} {{now}}</div>';
  const out2 = sanitizeCanvas(c2, 'canvas', {
    ...defaultCanvas(),
    items: [htmlItem({ html: good, css: '.x{color:var(--accent)}', refreshSec: 1, bind: [{ name: 'temp', entity: 'sensor.attic' }, { name: 'now', builtin: 'time' }, { name: 'k', value: 'solar.today' }] })],
  });
  assert.deepEqual(c2.errors, []);
  assert.equal(out2.items[0].props.html, good);
  assert.equal(out2.items[0].props.refreshSec, 5);
  assert.deepEqual(out2.items[0].props.bind, [{ name: 'temp', entity: 'sensor.attic' }, { name: 'now', builtin: 'time' }, { name: 'k', value: 'solar.today' }]);

  const c3 = collect();
  sanitizeCanvas(c3, 'canvas', {
    ...defaultCanvas(),
    items: [htmlItem({ html: '{{a}} {{nope}}', bind: [{ name: 'a', builtin: 'time' }, { name: 'a', builtin: 'date' }, { name: '1x' }, { name: 'b', builtin: 'stocks' }, { name: 'c', value: 'BAD KEY' }, { name: 'd', entity: 'not an entity' }] })],
  });
  const msgs = c3.errors.map((e) => `${e.path}: ${e.msg}`).join('\n');
  for (const want of ['repeated name a', 'invalid name', 'must be one of', 'invalid key', 'invalid entity id', 'no binding called nope']) assert.ok(msgs.includes(want), `${want}\n${msgs}`);

  // at most 3 per screen, 8000 characters each
  const c4 = collect();
  const out4 = sanitizeCanvas(c4, 'canvas', { ...defaultCanvas(), items: [0, 1, 2, 3].map((i) => htmlItem({ html: '<b>x</b>' }, M(i * 3, 0, 's'))) });
  assert.equal(out4.items.length, 3);
  assert.ok(c4.errors.some((e) => /too many html/.test(e.msg)));
  const c5 = collect();
  sanitizeCanvas(c5, 'canvas', { ...defaultCanvas(), items: [htmlItem({ html: 'x'.repeat(8001) })] });
  assert.ok(c5.errors.some((e) => /too long/.test(e.msg)));
});

test('Cloud: the kind is refused by validation, drawn as "not available" if one slips through, and its entity bindings become aliases', () => {
  const c = collect();
  const out = sanitizeCanvas(c, 'canvas', { ...defaultCanvas(), items: [htmlItem({ html: '<b>x</b>' })] }, {}, { canvasKinds: CLOUD_CANVAS_KINDS, haControls: false, cameraLive: false });
  assert.equal(out.items.length, 0);
  assert.ok(c.errors.some((e) => /not available on this server/.test(e.msg)));
  // the whole config on Cloud: refused there too
  const cfg = defaultConfig();
  cfg.screens[0].layout.preset = 'canvas';
  cfg.screens[0].canvas = { ...defaultCanvas(), items: [htmlItem({ html: '<b>x</b>' })] };
  const v = validateConfig(cfg, { canvasKinds: CLOUD_CANVAS_KINDS, haControls: false, cameraLive: false });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /not available on this server/.test(String(e.message ?? e.msg ?? e))), JSON.stringify(v.errors));
  // a config saved on a server that allowed it, projected for Cloud: a placeholder, no HTML, no binding
  const screen = { layout: { preset: 'canvas' }, screen: { orientation: 'auto' }, canvas: { ...defaultCanvas(), items: [htmlItem({ html: '<b>{{t}}</b>', bind: [{ name: 't', entity: 'sensor.attic' }] })] } };
  const cloud = projectCanvas(screen, { canvasKinds: CLOUD_CANVAS_KINDS });
  assert.equal(cloud.items[0].disabled, 'feature');
  assert.deepEqual(cloud.items[0].props, {});
  const home = projectCanvas(screen, {});
  assert.deepEqual(home.items[0].props.bind, [{ name: 't', entity: { a: `${home.items[0].id}:0`, d: 'sensor' } }]);
  assert.equal(JSON.stringify(home).includes('sensor.attic'), false);
  // private screens: a placeholder too
  assert.equal(projectCanvas(screen, { isPrivate: true }).items[0].disabled, 'privacy');
});

// ---- the display page's CSP ---------------------------------------------------------------------------------------

test('display CSP: hardened always; frame-src limited to this server and the web widgets while a screen has a custom card', () => {
  assert.equal(DISPLAY_CSP, "script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
  const cfg = defaultConfig();
  cfg.widgets = [
    { id: 'w_web1', type: 'web', name: 'Graphs', options: { url: 'http://graphs.home.arpa:3000/d/x?k=1', refreshSec: 0, fit: 'cover', bust: false } },
    { id: 'w_web2', type: 'web', name: 'Other', options: { url: 'https://example.org/page', refreshSec: 0, fit: 'cover', bust: false } },
    { id: 'w_img1', type: 'image', name: 'Cam', options: { url: 'https://images.example.net/a.jpg', refreshSec: 60, fit: 'cover', bust: false } },
  ];
  // no custom card: frames stay open (web widgets behave as before)
  assert.equal(displayCsp(cfg), DISPLAY_CSP);
  const cfg2 = structuredClone(cfg);
  cfg2.screens[0].layout.preset = 'canvas';
  cfg2.screens[0].canvas = { ...defaultCanvas(), items: [htmlItem({ html: '<b>x</b>' })] };
  assert.equal(displayCsp(cfg2), `${DISPLAY_CSP}; frame-src 'self' http://graphs.home.arpa:3000 https://example.org`);
  // a hidden card counts as no card
  const cfg3 = structuredClone(cfg2);
  cfg3.screens[0].canvas.items[0].hidden = true;
  assert.equal(displayCsp(cfg3), DISPLAY_CSP);
  assert.equal(displayCsp(undefined), DISPLAY_CSP);
});

/** A config dir with `mutate` applied, and the app on a free port. */
async function withApp(mutate, fn, distFiles = { 'index.html': '<!doctype html><title>display</title>', 'admin/index.html': '<!doctype html><title>admin</title>' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'marco-html-'));
  const c = defaultConfig();
  c.calendar.sources = [];
  c.news.feeds = [];
  mutate(c);
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c));
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({}));
  for (const [f, body] of Object.entries(distFiles)) {
    fs.mkdirSync(path.dirname(path.join(dir, 'dist', f)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', f), body);
  }
  store.initStore(dir);
  const app = createApp({ version: '0.5.0', dist: path.join(dir, 'dist') });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, dir);
  } finally {
    closeAll();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const withCard = (c) => {
  c.widgets = [{ id: 'w_web1', type: 'web', name: 'Graphs', options: { url: 'https://graphs.example.org/d/x', refreshSec: 0, fit: 'cover', bust: false } }];
  c.screens[0].layout.preset = 'canvas';
  c.screens[0].canvas = { ...defaultCanvas(), items: [htmlItem({ html: '<b>{{now}}</b>', bind: [{ name: 'now', builtin: 'time' }] })] };
};

test('display CSP header: on /, /index.html, /pair and /d/<key>; the admin and the API keep their own; a save changes it', async () => {
  await withApp(withCard, async (base) => {
    const want = `${DISPLAY_CSP}; frame-src 'self' https://graphs.example.org`;
    for (const url of ['/', '/index.html', '/pair', '/d/any-key']) {
      const r = await fetch(base + url);
      assert.equal(r.status, 200, url);
      assert.equal(r.headers.get('content-security-policy'), want, url);
    }
    for (const url of ['/admin', '/api/health']) {
      const r = await fetch(base + url);
      assert.equal(r.headers.get('content-security-policy'), "frame-ancestors 'self'", url);
    }
    // the card removed: frames open again
    const next = structuredClone(store.getConfig());
    next.screens[0].canvas.items = [];
    const saved = store.saveConfig(next, { backup: false });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
    assert.equal((await fetch(`${base}/`)).headers.get('content-security-policy'), DISPLAY_CSP);
  });
});

// ---- the corpus in a browser -------------------------------------------------------------------------------------

const chrome = findChrome();

describe('attack corpus in headless Chrome', { skip: !chrome && 'no Chrome' }, () => {
  let canary;
  let hits;
  let browser;
  before(async () => {
    hits = [];
    canary = http.createServer((req, res) => {
      hits.push(req.url);
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      res.end('hit');
    });
    await new Promise((r) => canary.listen(0, '127.0.0.1', r));
    browser = await launchChrome(chrome);
  });
  after(async () => {
    await browser?.close();
    canary?.closeAllConnections?.();
    await new Promise((r) => (canary ? canary.close(r) : r()));
  });

  test('no script runs, no request leaves and no frame navigates, even with the sanitiser bypassed', async () => {
    const C = `http://127.0.0.1:${canary.address().port}`;
    const go = `fetch('${C}/script');new Image().src='${C}/img-js';try{parent.document.title='pwned'}catch(e){};document.body.dataset.pwned='1'`;
    // [label, html, css, tap]: what an older server, a hand-edited config or a sanitiser bug could put in the frame
    const corpus = [
      ['script', `<script>${go}</script>`, ''],
      ['onerror', `<img src="${C}/onerror-src" onerror="${go}">`, ''],
      ['svg onload', `<svg onload="${go}"><rect width="10" height="10"/></svg>`, ''],
      ['javascript: link', `<a href="javascript:${go}" style="position:fixed;inset:0;display:block">tap</a>`, '', true],
      ['link', `<a href="${C}/link" style="position:fixed;inset:0;display:block">tap</a>`, '', true],
      ['link target top', `<a href="${C}/link-top" target="_top" style="position:fixed;inset:0;display:block">tap</a>`, '', true],
      ['form', `<form action="${C}/form"><button style="position:fixed;inset:0">go</button></form>`, '', true],
      ['nested srcdoc', `<iframe srcdoc="<script>fetch('${C}/nested')</script><img src='${C}/nested-img'>"></iframe>`, ''],
      ['nested src', `<iframe src="${C}/nested-src"></iframe>`, ''],
      ['meta refresh', `<meta http-equiv="refresh" content="0;url=${C}/refresh">`, ''],
      ['base', `<base href="${C}/base/"><img src="b.png">`, ''],
      ['link css', `<link rel="stylesheet" href="${C}/link.css">`, ''],
      ['object', `<object data="${C}/object"></object><embed src="${C}/embed">`, ''],
      ['media', `<video src="${C}/video" autoplay muted></video><audio src="${C}/audio" autoplay></audio>`, ''],
      ['svg image', `<svg><image href="${C}/svg-image" width="10" height="10"/></svg>`, ''],
      ['svg use', `<svg><use href="${C}/use.svg#a"/></svg>`, ''],
      ['img https', `<img src="${C}/img">`, ''],
      ['img svg data', `<img src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' onload=\"${go}\"><image href='${C}/svg-data'/></svg>`)}">`, ''],
      ['inline style url', `<div style="width:10px;height:10px;background:url(${C}/inline-style)">x</div>`, ''],
      ['css url', '<div class="bg">x</div>', `.bg{width:10px;height:10px;background:url(${C}/css-url)}`],
      ['css import', '<b>x</b>', `@import url(${C}/import.css);`],
      ['css font-face', '<b class="f">x</b>', `@font-face{font-family:evil;src:url(${C}/font.woff)}.f{font-family:evil}`],
      ['css image-set', '<div class="i">x</div>', `.i{width:10px;height:10px;background:image-set("${C}/image-set.png" 1x)}`],
      ['split tag', `<scr<script>ipt>${go}</script>`, ''],
      ['mixed case', `<ScRiPt>${go}</sCrIpT>`, ''],
      ['entity name', `<img src=x on&#x65;rror="${go}">`, ''],
      ['details toggle', `<details open ontoggle="${go}"><summary>x</summary></details>`, ''],
      ['mxss', `<math><mtext><table><mglyph><style><img src=${C}/mxss onerror="${go}">`, ''],
      ['noscript', `<noscript><p title="</noscript><img src=${C}/noscript onerror=&quot;${go}&quot;>"></noscript>`, ''],
    ];
    // the sanitiser refuses each one (the first layer)...
    for (const [label, html, css] of corpus) assert.ok(checkCard(html, css).length > 0, `validation should refuse: ${label}`);
    // ...and a real card next to them still draws (an about:srcdoc frame is allowed by the page's frame-src)
    const real = cardDocument({ body: renderCard(parseCard('<b class="ok">{{t | round:1}} {{t.unit}}</b>').nodes, (n, f) => (f === '' ? 21.46 : '°C')), css: '.ok{color:var(--accent)}', vars: { '--accent': '#ff0000' } });
    // the rest of the layers, with the sanitiser bypassed: the raw markup in the frame document the display builds
    const docs = corpus.map(([label, html, css, tap]) => ({
      label,
      tap: !!tap,
      doc: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CARD_CSP}"><style>${css}</style></head><body>${html}</body></html>`,
    }));
    docs.push({ label: 'real', tap: false, doc: real });
    // the page: the display's own frame attributes and pointer-events, under the display page's CSP (an inline
    // script is in it too, to show the header is there)
    const script = `fetch('/assets/corpus.json').then((r) => r.json()).then((docs) => {
      for (const d of docs) {
        const f = document.createElement('iframe');
        f.setAttribute('sandbox', '');
        f.setAttribute('referrerpolicy', 'no-referrer');
        f.setAttribute('allow', '');
        f.setAttribute('loading', 'eager');
        f.tabIndex = -1;
        f.dataset.label = d.label;
        f.style.cssText = 'width:200px;height:120px;border:0;pointer-events:none;display:inline-block';
        f.srcdoc = d.doc;
        document.body.appendChild(f);
      }
      document.body.dataset.ready = '1';
    });`;
    await withApp(withCard, async (base) => {
      const p = await browser.page('about:blank', { width: 1400, height: 1400 });
      try {
        // sandboxed frames run in a process of their own: attach to each one (and to the frames inside it) and log its
        // requests, navigations and console too, before it starts
        const sessions = [];
        const watch = async (sid) => {
          await p.send('Network.enable', {}, sid);
          await p.send('Page.enable', {}, sid);
          await p.send('Log.enable', {}, sid);
          await p.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid);
          if (sid) await p.send('Runtime.runIfWaitingForDebugger', {}, sid);
        };
        p.on((msg) => {
          if (msg.method !== 'Target.attachedToTarget') return;
          sessions.push(msg.params.sessionId);
          void watch(msg.params.sessionId).catch(() => undefined);
        });
        await watch(undefined);
        await p.send('Page.navigate', { url: `${base}/` });
        for (let i = 0; i < 100 && !(await p.eval('document.body?.dataset.ready === "1"').catch(() => false)); i++) await new Promise((r) => setTimeout(r, 50));
        await new Promise((r) => setTimeout(r, 2500));
        // tap the middle of every frame that has something to tap (pointer-events:none: the page gets the tap)
        const boxes = await p.eval(`[...document.querySelectorAll('iframe')].map((f) => { const r = f.getBoundingClientRect(); return { label: f.dataset.label, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`);
        for (const b of boxes.filter((x) => docs.find((d) => d.label === x.label)?.tap)) {
          for (const type of ['mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
          await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] }).catch(() => undefined);
          await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => undefined);
        }
        await new Promise((r) => setTimeout(r, 2000));

        // the page CSP is there: its inline script did not run, the page is not touched by any frame
        assert.equal(await p.eval('document.title'), 'display');
        // no request reached the listening server, and none of the page's requests went anywhere but this server
        assert.deepEqual(hits, []);
        const reqs = p.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => ({ id: e.params.requestId, url: e.params.request.url }));
        const failed = new Map(p.events.filter((e) => e.method === 'Network.loadingFailed').map((e) => [e.params.requestId, e.params]));
        const answered = new Set(p.events.filter((e) => e.method === 'Network.responseReceived').map((e) => e.params.requestId));
        const out = reqs.filter((r) => r.url.startsWith(C));
        // a request the browser started for the canary must have been blocked before it left (CSP), never answered
        for (const r of out) {
          assert.equal(answered.has(r.id), false, `answered: ${r.url}`);
          assert.ok(failed.get(r.id)?.blockedReason || failed.get(r.id)?.errorText, `not blocked: ${r.url} ${JSON.stringify(failed.get(r.id))}`);
        }
        assert.deepEqual(reqs.filter((r) => !r.url.startsWith(base) && !r.url.startsWith(C) && !r.url.startsWith('data:') && !r.url.startsWith('about:')).map((r) => r.url), []);
        // no frame navigated anywhere but its own document (about:srcdoc, or about:blank for nested ones)
        // (every navigation the browser started or was asked for, in the page and in each frame's own process)
        const main = p.events.find((e) => e.method === 'Page.frameNavigated' && !e.sessionId && e.params.frame.url.startsWith(base))?.params.frame.id;
        const navs = p.events
          .filter((e) => ['Page.frameStartedNavigating', 'Page.frameRequestedNavigation', 'Page.frameNavigated'].includes(e.method))
          .map((e) => ({ frame: e.params.frameId ?? e.params.frame?.id, url: e.params.url ?? e.params.frame?.url }))
          .filter((n) => n.frame !== main);
        assert.ok(navs.filter((n) => n.url === 'about:srcdoc').length >= docs.length, `frames: ${navs.length}`);
        assert.deepEqual(navs.filter((n) => n.url !== 'about:srcdoc' && n.url !== 'about:blank').map((n) => n.url), []);
        // no script ran inside any frame: nothing it would have written is there, and the real card drew its values
        const frames = [];
        for (const sid of [undefined, ...sessions]) {
          const tree = await p.send('Page.getFrameTree', {}, sid).catch(() => null);
          const walk = (n, top) => {
            if (!top) frames.push({ sid, frame: n.frame });
            for (const ch of n.childFrames ?? []) walk(ch, false);
          };
          if (tree) walk(tree.frameTree, !sid);
        }
        assert.ok(frames.length >= docs.length, `frames: ${frames.length}`);
        let realText = '';
        let checked = 0;
        for (const { sid, frame } of frames) {
          const world = await p.send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'check' }, sid).catch(() => null);
          if (!world) continue;
          const r = await p.send('Runtime.evaluate', { contextId: world.executionContextId, expression: 'JSON.stringify([document.body ? document.body.dataset.pwned || "" : "", document.body ? document.body.innerText : ""])', returnByValue: true }, sid);
          const [pwned, text] = JSON.parse(r.result.value);
          checked++;
          assert.equal(pwned, '', `script ran in a frame: ${frame.url}`);
          if (text.includes('°C')) realText = text;
        }
        assert.ok(checked >= docs.length, `frames checked: ${checked}`);
        assert.equal(realText.trim(), '21.5 °C');
        // and the browser said why it refused (sandboxed scripts, blocked loads): never a page error from Marco's page
        const logs = p.events.filter((e) => e.method === 'Log.entryAdded').map((e) => e.params.entry.text).join('\n');
        assert.match(logs, /sandboxed|Content Security Policy/i);
      } finally {
        await p.close();
      }
    }, {
      'index.html': '<!doctype html><html><head><title>display</title><script>document.title = "inline ran"</script><script src="/assets/corpus.js"></script></head><body></body></html>',
      'assets/corpus.js': script,
      'assets/corpus.json': JSON.stringify(docs),
      'admin/index.html': '<!doctype html><title>admin</title>',
    });
  });
});
