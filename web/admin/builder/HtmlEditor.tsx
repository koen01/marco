// Inspector, Contenido tab of a custom HTML card (kind 'html', self-hosted only): the HTML and the CSS, the values the
// card binds, the starter cards, what may be written, a live preview and the list of errors as you type. The same
// sanitiser as the server and the screen (web/shared/cardTemplate.ts) reads the card, so what is listed here is what
// the save would refuse, and the preview is drawn the way the screen draws it: in a sandboxed frame that runs nothing
// and loads nothing.
import { useMemo, useState } from 'preact/hooks';
import type { CanvasItem, HaState, HookValueInfo } from '../../shared/types';
import { CANVAS_KINDS, CARD_BUILTINS, itemAliases } from '../../../server/core/canvasCore.js';
import { cardDocument, checkCard, parseCard, renderCard, type CardError, type CardValue } from '../../shared/cardTemplate';
import { cardSnippets } from '../../shared/cardSnippets';
import { HaEntitySelect } from '../components/HaEntityPicker';
import { Button, Callout, Field, Select, Slider, TextInput, Textarea } from '../components/ui';
import { locale, t } from '../i18n';
import { has } from '../caps';
import { ValueKeyInput } from './ValueKeyInput';

type Source = 'entity' | 'value' | (typeof CARD_BUILTINS)[number];
type Bind = { name: string; entity?: string; value?: string; builtin?: (typeof CARD_BUILTINS)[number] };

const SOURCES: { v: Source; l: string }[] = [
  { v: 'entity', l: 'Home Assistant' },
  { v: 'time', l: 'La hora' },
  { v: 'date', l: 'La fecha' },
  { v: 'weather', l: 'El tiempo' },
  { v: 'nextEvent', l: 'El próximo evento' },
  // a key of POST /api/hooks/values
  { v: 'value', l: 'Un valor enviado' },
];
const SNIPPETS: { id: 'temp' | 'rooms' | 'quote'; l: string }[] = [
  { id: 'temp', l: 'Temperatura grande' },
  { id: 'rooms', l: 'Lista de habitaciones' },
  { id: 'quote', l: 'Una cita' },
];
const ENTITY_DOMAINS: readonly string[] = (CANVAS_KINDS['ha.tile'] as { ha?: { domains: string[] } }).ha?.domains ?? [];

const sourceOf = (b: Bind): Source => (b.builtin ? b.builtin : b.value !== undefined ? 'value' : 'entity');

/** One error in the admin's language, with its line. */
export function cardErrorMessage(e: CardError): string {
  const v = { line: e.line, el: e.el ?? '', attr: e.attr ?? '', detail: e.detail === 'backslash' ? '\\' : e.detail ?? '' };
  switch (e.code) {
    case 'element': return t('Línea {line}: <{el}> no se puede usar.', v);
    case 'attr': return t('Línea {line}: el atributo {attr} de <{el}> no se puede usar.', v);
    case 'dupAttr': return t('Línea {line}: el atributo {attr} está repetido en <{el}>.', v);
    case 'src': return t('Línea {line}: las imágenes van dentro del HTML como data:image (PNG, JPEG, WebP o GIF).', v);
    case 'svgUrl': return t('Línea {line}: url() no se puede usar en {attr}.', v);
    case 'css': return t('Línea {line}: el estilo de <{el}> no puede llevar {detail}.', v);
    case 'cssBlock': return t('CSS: no se puede usar {detail}.', v);
    case 'unclosed': return t('Línea {line}: falta cerrar {detail}.', v);
    case 'markup': return t('Línea {line}: {detail} no se puede usar.', v);
    case 'triple': return t('Línea {line}: tres llaves seguidas no se pueden usar.', v);
    case 'placeholder': return t('Línea {line}: {detail} no es un dato bien escrito.', v);
    case 'field': return t('Línea {line}: {detail} no existe. Detrás del nombre puede ir .unit, .ago, .on, .name o .time.', v);
    case 'filter': return t('Línea {line}: el filtro {detail} no existe.', v);
    case 'place': return t('Línea {line}: los datos solo pueden ir en el texto y en class, title, data-* y style.', v);
    case 'styleNum': return t('Línea {line}: dentro de style un dato necesita | num, | pct o | clamp.', v);
    case 'section': return t('Línea {line}: la sección {detail} no está bien cerrada.', v);
    case 'unknown': return t('Línea {line}: {detail} no está entre los datos de la tarjeta. Añádelo abajo.', v);
    default: return e.code;
  }
}

/** What a placeholder shows in the preview: the real state when the builder has it, else an example. */
function previewValue(b: Bind | undefined, s: HaState | null, field: string, values: HookValueInfo[]): CardValue {
  if (!b) return null;
  const now = new Date();
  switch (sourceOf(b)) {
    case 'time': return field === '' || field === 'time' ? now.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : null;
    case 'date': return field === '' ? now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' }) : null;
    case 'weather': return field === '' ? 21 : field === 'unit' ? '°' : field === 'name' ? t('Despejado') : field === 'on' ? true : null;
    case 'nextEvent': return field === '' || field === 'name' ? t('Cena con los abuelos') : field === 'time' ? '20:30' : field === 'on' ? false : null;
    case 'value': {
      const x = values.find((v) => v.key === b.value);
      if (!x) return field === '' ? 42 : field === 'name' ? b.value || '' : field === 'ago' ? t('hace {n} min', { n: 5 }) : null;
      if (field === 'unit') return x.unit ?? '';
      if (field === 'name') return x.label ?? '';
      if (field === 'ago') return t('hace {n} min', { n: Math.max(0, Math.round((Date.now() - Date.parse(x.updatedAt)) / 60_000)) });
      if (field === 'on') return x.value === true || (typeof x.value === 'number' && x.value !== 0) || x.value === 'on';
      return field === '' ? x.value : null;
    }
    default: {
      if (!s) return field === '' ? 21.5 : field === 'unit' ? '°C' : field === 'name' ? t('Ejemplo') : field === 'ago' ? t('hace {n} min', { n: 5 }) : field === 'on' ? true : null;
      const on = 'on' in s ? !!s.on : s.d === 'cover' ? s.state !== 'closed' : s.d === 'media' ? s.state === 'playing' : null;
      if (field === 'unit') return s.d === 'sensor' ? s.unit : '';
      if (field === 'name') return s.n ?? '';
      if (field === 'on') return on;
      if (field === 'ago') return t('hace {n} min', { n: Math.max(0, Math.round((Date.now() - s.at) / 60_000)) });
      if (field !== '') return null;
      if (s.d === 'sensor') return s.num ?? s.v;
      if (s.d === 'unavailable') return t('No disponible');
      if (on !== null) return on ? t('Encendido') : t('Apagado');
      return 'v' in s ? String(s.v) : 'state' in s ? String(s.state) : '';
    }
  }
}

export function HtmlEditor({ item, haOn, states, values, put }: { item: CanvasItem; haOn: boolean; states: Record<string, HaState>; values: HookValueInfo[]; put: (k: string, v: unknown, merge?: string) => void }) {
  const p = item.props as { html?: string; css?: string; bind?: Bind[]; refreshSec?: number };
  const html = p.html ?? '';
  const css = p.css ?? '';
  const binds: Bind[] = Array.isArray(p.bind) ? p.bind : [];
  const [help, setHelp] = useState(false);
  const errors = useMemo(() => checkCard(html, css, binds.map((b) => b.name)), [html, css, JSON.stringify(binds.map((b) => b.name))]);
  const putBinds = (next: Bind[]) => put('bind', next, `${item.id}.bind`);
  const setBind = (i: number, b: Bind) => putBinds(binds.map((x, j) => (j === i ? b : x)));

  // the builder's live states of the bound entities, by name (the aliases the server gives them)
  const byName = useMemo(() => {
    const aliases = itemAliases(item);
    const out = new Map<string, HaState | null>();
    let n = 0;
    for (const b of binds) {
      if (sourceOf(b) !== 'entity' || !b.entity) continue;
      out.set(b.name, states[aliases[n++]?.alias ?? ''] ?? null);
    }
    return out;
  }, [item, states]);

  const doc = useMemo(() => {
    if (!html.trim() || errors.length) return '';
    const { nodes } = parseCard(html);
    const names = new Map(binds.map((b) => [b.name, b]));
    const nf = (n: number, d: number | null) => new Intl.NumberFormat(locale(), d === null ? { maximumFractionDigits: 3 } : { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    const body = renderCard(nodes, (name, field) => previewValue(names.get(name), byName.get(name) ?? null, field, values), nf);
    return cardDocument({
      body,
      css,
      scheme: 'dark',
      vars: { '--accent': '#0a84ff', '--ink': '#ffffff', '--ink-2': 'rgb(255 255 255 / 0.62)', '--sep': 'rgb(255 255 255 / 0.16)', '--fill': 'rgb(255 255 255 / 0.1)', '--radius': '14px', '--font': 'system-ui, sans-serif', '--size': '15px' },
    });
  }, [html, css, errors, binds, byName, values]);

  const useSnippet = (id: 'temp' | 'rooms' | 'quote') => {
    if ((html.trim() || css.trim()) && !window.confirm(t('¿Cambiar el HTML y el CSS de esta tarjeta por el ejemplo?'))) return;
    const sn = cardSnippets(t('Lo mejor de la casa es quien la habita.')).find((x) => x.id === id)!;
    // the bindings the example needs, keeping the entities already chosen under the same name
    const keep = new Map(binds.map((b) => [b.name, b]));
    put('html', sn.html);
    put('css', sn.css);
    putBinds(sn.bind.map((b) => keep.get(b.name) ?? (b.builtin ? { name: b.name, builtin: b.builtin } : { name: b.name, entity: '' })));
  };

  const freeName = () => {
    for (let i = 1; ; i++) if (!binds.some((b) => b.name === `dato${i}`)) return `dato${i}`;
  };

  return (
    <div class="stack bld-html">
      <Callout>{t('Solo en Marco instalado en casa. Se muestra aislado: no puede ejecutar código ni leer tus datos ni tu sesión.')}</Callout>
      <Field label={t('Empezar con un ejemplo')}>
        <div class="bld-chips" role="group">
          {SNIPPETS.map((s) => (
            <button type="button" class="bld-chip" onClick={() => useSnippet(s.id)}>
              {t(s.l)}
            </button>
          ))}
        </div>
      </Field>
      <Field label="HTML" hint={t('Sin scripts, enlaces ni imágenes de internet. Cada dato se escribe con su nombre entre llaves dobles.')}>
        <Textarea mono rows={9} maxLength={8000} value={html} onValue={(v) => put('html', v, `${item.id}.html`)} placeholder={'<div class="big">{{temp | round:1}} {{temp.unit}}</div>'} />
      </Field>
      <Field label="CSS" hint={t('Sin @import, @font-face ni url() de internet.')}>
        <Textarea mono rows={6} maxLength={8000} value={css} onValue={(v) => put('css', v, `${item.id}.css`)} placeholder={'.big { font-size: 3em; color: var(--accent); }'} />
      </Field>
      {errors.length > 0 ? (
        <Callout kind="error">
          <ul class="bld-html-errors">
            {errors.slice(0, 8).map((e) => (
              <li>{cardErrorMessage(e)}</li>
            ))}
            {errors.length > 8 && <li>{t('Y {n} más.', { n: errors.length - 8 })}</li>}
          </ul>
        </Callout>
      ) : (
        html.trim() && <p class="muted small bld-html-ok">{t('Sin errores.')}</p>
      )}
      <Field label={t('Datos de la tarjeta')} hint={t('Cada dato tiene un nombre para usarlo en el HTML. Hasta 8.')}>
        <div class="stack bld-ha-list">
          {binds.map((b, i) => {
            const src = sourceOf(b);
            return (
              <div class="bld-ha-item bld-html-bind">
                <div class="bld-ha-line">
                  <TextInput mono value={b.name} maxLength={24} aria-label={t('Nombre')} onValue={(v) => setBind(i, { ...b, name: v.trim() })} />
                  <Select
                    value={src}
                    options={SOURCES.filter((s) => s.v === src || (s.v === 'entity' ? haOn : s.v !== 'value' || has('valueHooks'))).map((s) => ({ value: s.v, label: t(s.l) }))}
                    onChange={(v) => setBind(i, v === 'entity' ? { name: b.name, entity: '' } : v === 'value' ? { name: b.name, value: '' } : { name: b.name, builtin: v as Bind['builtin'] })}
                  />
                  <button type="button" class="icon-btn" onClick={() => putBinds(binds.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
                    ×
                  </button>
                </div>
                {src === 'entity' && <HaEntitySelect domains={ENTITY_DOMAINS} enabled={haOn} value={b.entity ?? ''} onChange={(v) => setBind(i, { name: b.name, entity: v })} />}
                {src === 'value' && <ValueKeyInput value={b.value ?? ''} values={values} onValue={(v) => setBind(i, { name: b.name, value: v })} />}
              </div>
            );
          })}
          {binds.length < 8 && (
            <button type="button" class="link-btn" onClick={() => putBinds([...binds, haOn ? { name: freeName(), entity: '' } : { name: freeName(), builtin: 'time' }])}>
              {t('Añadir dato')}
            </button>
          )}
        </div>
      </Field>
      <button type="button" class="link-btn" aria-expanded={help} onClick={() => setHelp(!help)}>
        {help ? t('Ocultar la ayuda') : t('Qué se puede escribir')}
      </button>
      {help && (
        <div class="bld-html-help small">
          <p>
            <code>{'{{temp}}'}</code> {t('el valor')} · <code>{'{{temp.unit}}'}</code> {t('su unidad')} · <code>{'{{temp.ago}}'}</code> {t('cuándo cambió')} · <code>{'{{temp.name}}'}</code> {t('su nombre')} ·{' '}
            <code>{'{{event.time}}'}</code> {t('la hora del evento')}
          </p>
          <p>
            <code>{'| round:1'}</code> {t('decimales')} · <code>{'| upper'}</code> <code>{'| lower'}</code> · <code>{'| num'}</code> <code>{'| pct'}</code> <code>{'| clamp:0:100'}</code> {t('un número para style')}
          </p>
          <p>
            <code>{'{{#light.on}}…{{/light.on}}'}</code> {t('solo si está encendido')} · <code>{'{{^light.on}}…{{/light.on}}'}</code> {t('solo si está apagado')}
          </p>
          <p>
            <code>{'style="width: {{battery | pct}}%"'}</code> {t('una barra que sigue un valor')}
          </p>
          <p>
            {t('Colores de Marco')}: <code>var(--accent)</code> <code>var(--ink)</code> <code>var(--ink-2)</code> <code>var(--sep)</code> <code>var(--fill)</code> <code>var(--radius)</code>
          </p>
          <p>{t('Etiquetas')}: div span p h1 h2 h3 h4 small strong b em i u s br hr ul ol li table thead tbody tr th td img svg g path circle rect line polyline polygon text tspan</p>
          <p>{t('Atributos')}: class title style data-* colspan rowspan alt, src (data:image) {t('y los de dibujo en SVG')}</p>
        </div>
      )}
      <Field label={t('Vista previa')} hint={t('Con el estado real de Home Assistant cuando lo hay; si no, con datos de ejemplo.')}>
        <div class="bld-html-pv">
          {doc ? (
            <iframe class="bld-html-pv__frame" sandbox="" referrerpolicy="no-referrer" allow="" tabIndex={-1} aria-hidden="true" title={t('Vista previa')} srcdoc={doc} />
          ) : (
            <span class="muted small">{errors.length ? t('Corrige los errores para verla.') : t('Escribe algo de HTML o empieza con un ejemplo.')}</span>
          )}
        </div>
      </Field>
      <Field label={t('Actualizar cada')} hint={t('Para la hora y el tiempo pasado. Los cambios de Home Assistant se ven antes.')}>
        <Slider
          value={Number(p.refreshSec) || 60}
          min={5}
          max={600}
          step={5}
          format={(v) => (v >= 60 && v % 60 === 0 ? t('{n} min', { n: v / 60 }) : t('{n} s', { n: v }))}
          onChange={(v) => put('refreshSec', v, `${item.id}.refreshSec`)}
        />
      </Field>
    </div>
  );
}
