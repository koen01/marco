import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { HaEntity } from '../../shared/types';
import { api } from '../api';
import { t } from '../i18n';
import { Icon } from './icons';
import { haEntityGroups } from '../haSearch';

const cache: Record<string, Promise<HaEntity[]> | undefined> = {};

export function invalidateHaEntities() {
  for (const k of Object.keys(cache)) delete cache[k];
}

/** The entities of one domain or several (one request per set of domains, kept until invalidated). */
export function loadHaEntities(domain: string | readonly string[]) {
  const key = (Array.isArray(domain) ? [...domain].sort() : [domain]).join(',');
  if (!cache[key]) {
    cache[key] = api.haEntities(domain).catch((e) => {
      delete cache[key];
      throw e;
    });
  }
  return cache[key]!;
}

/**
 * The entity picker of the Home Assistant, Tiempo and doorbell sections: the same dropdown with the search inside as
 * the builder's (HaEntitySelect), for one domain, with "Ninguna" to leave the field empty.
 */
export function HaEntityPicker(props: {
  domain: string | readonly string[];
  value: string;
  onChange: (v: string) => void;
  /** Optional filter, e.g. by unit (°C / %). */
  filter?: (e: HaEntity) => boolean;
  error?: boolean;
  enabled: boolean;
  reloadKey?: number;
}) {
  const domains = useMemo(() => (Array.isArray(props.domain) ? props.domain : [props.domain as string]), [String(props.domain)]);
  return (
    <HaEntitySelect
      domains={domains}
      value={props.value}
      onChange={(v) => props.onChange(v)}
      enabled={props.enabled}
      reloadKey={props.reloadKey}
      filter={props.filter}
      error={props.error}
      emptyLabel={t('Ninguna')}
    />
  );
}

/** "Salón: 21,5 °C" style text of an entity's live state. */
export const haStateLine = (e: HaEntity) => `${e.state}${e.unit ? ` ${e.unit}` : ''}`;

/** Most options drawn at once in the open list (typing narrows it down). */
const MAX_SHOWN = 250;

type PopPos = { left: number; width: number; maxHeight: number; top?: number; bottom?: number };

/**
 * Where the open list goes (fixed, so no scrolling panel or phone sheet around the picker can cut it): under the
 * trigger, or above it when there is clearly more room there, always inside the visible part of the screen.
 */
function placePop(anchor: DOMRect): PopPos {
  const M = 8;
  const GAP = 4;
  const vv = window.visualViewport;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  // the visible part: on a phone the keyboard takes the bottom of the screen
  const vTop = vv ? vv.offsetTop : 0;
  const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  const width = Math.min(Math.max(anchor.width, 280), vw - 2 * M);
  const left = Math.max(M, Math.min(anchor.left, vw - width - M));
  const below = vBottom - anchor.bottom - GAP - M;
  const WANT = 400;
  // above: up to the trigger, or up to the keyboard when the trigger is behind it
  const edge = Math.min(anchor.top - GAP, vBottom - M);
  const above = edge - vTop - M;
  const up = below < 260 && above > below;
  const maxHeight = Math.min(WANT, Math.max(up ? above : below, 160));
  return up ? { left, width, maxHeight, bottom: window.innerHeight - edge } : { left, width, maxHeight, top: anchor.bottom + GAP };
}

/**
 * The builder's entity picker, one dropdown: the button shows the chosen entity and its state; it opens a list with
 * its own search (case and accents do not matter; it also knows the kinds, so "luz" finds the lights), the entities
 * of `domains` grouped by area (by domain when Home Assistant gives no areas, which happens with a token of a user who
 * is not an administrator). Arrow keys, Enter and Escape work in the search; a click anywhere else closes it.
 */
export function HaEntitySelect(props: {
  domains: readonly string[];
  value: string;
  onChange: (v: string, e: HaEntity | null) => void;
  enabled: boolean;
  /** an entity already used by the same card (room rows, chart series): marked */
  taken?: readonly string[];
  reloadKey?: number;
  /** the choice of no entity, when it means something (a camera shown always): its label */
  emptyLabel?: string;
  /** only some of the entities of `domains` (e.g. by unit: °C, %) */
  filter?: (e: HaEntity) => boolean;
  error?: boolean;
}) {
  const [all, setList] = useState<HaEntity[] | null>(null);
  const list = useMemo(() => (all && props.filter ? all.filter(props.filter) : all), [all, props.filter]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<PopPos | null>(null);
  const [uid] = useState(() => `hacombo-${Math.random().toString(36).slice(2, 8)}`);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listEl = useRef<HTMLUListElement>(null);
  /** the active option moved by the keyboard (or on opening): keep it in sight; the mouse does not scroll the list */
  const follow = useRef(false);
  const dkey = [...props.domains].sort().join(',');
  useEffect(() => {
    if (!props.enabled) return;
    let alive = true;
    loadHaEntities(props.domains)
      .then((l) => alive && (setList(l), setErr('')))
      .catch((e) => alive && setErr(e.message || 'error'));
    return () => {
      alive = false;
    };
  }, [dkey, props.enabled, props.reloadKey]);
  const sel = list?.find((e) => e.entity_id === props.value) ?? null;
  const matches = useMemo(() => haEntityGroups(list ?? [], q, t('Sin habitación')), [list, q]);
  // a long list is cut (typing narrows it down), but the chosen entity is always in it
  const shown = matches.length > MAX_SHOWN ? matches.filter((m, i) => i < MAX_SHOWN || m.e.entity_id === props.value) : matches;
  const choices: ({ empty: true } | { empty: false; e: HaEntity; group: string })[] = [
    ...(props.emptyLabel !== undefined && !q.trim() ? [{ empty: true as const }] : []),
    ...shown.map((m) => ({ empty: false as const, ...m })),
  ];
  // open: placed next to the trigger (and again when anything scrolls or the window or the keyboard changes size)
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    // the search takes the keys at once, so nothing typed right after opening is lost
    search.current?.focus({ preventScroll: true });
    let raf = 0;
    const update = () => {
      raf = 0;
      const a = trigger.current;
      if (a) setPos(placePop(a.getBoundingClientRect()));
    };
    const later = (e?: Event) => {
      // the list's own scrolling does not move it
      if (e?.target instanceof Node && pop.current?.contains(e.target)) return;
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', later, true);
    window.addEventListener('resize', later);
    window.visualViewport?.addEventListener('resize', later);
    window.visualViewport?.addEventListener('scroll', later);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', later, true);
      window.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('resize', later);
      window.visualViewport?.removeEventListener('scroll', later);
    };
  }, [open]);
  // open: the chosen entity is the active one; a tap or click anywhere else closes the list
  useEffect(() => {
    if (!open) return;
    const at = choices.findIndex((c) => (c.empty ? !props.value : c.e.entity_id === props.value));
    follow.current = true;
    setActive(Math.max(0, at));
    const away = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!box.current?.contains(n) && !pop.current?.contains(n)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    follow.current = true;
    setActive(0);
  }, [q]);
  useLayoutEffect(() => {
    if (!follow.current || !pos) return;
    follow.current = false;
    const ul = listEl.current;
    const el = ul?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!ul || !el) return;
    // under the sticky area heading, not behind it
    const head = ul.querySelector<HTMLElement>('.ha-combo__group')?.offsetHeight ?? 0;
    const r = el.getBoundingClientRect();
    const view = ul.getBoundingClientRect();
    if (r.top < view.top + head) ul.scrollTop -= view.top + head - r.top;
    else if (r.bottom > view.bottom) ul.scrollTop += r.bottom - view.bottom;
  }, [active, pos]);
  if (!props.enabled) return <p class="field__hint">{t('Activa Home Assistant para elegir entidades.')}</p>;
  const show = () => {
    // placed before the first paint: a hidden field could not take the focus
    if (trigger.current) setPos(placePop(trigger.current.getBoundingClientRect()));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQ('');
    trigger.current?.focus({ preventScroll: true });
  };
  const pick = (v: string) => {
    props.onChange(v, list?.find((e) => e.entity_id === v) ?? null);
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = choices.length;
      follow.current = true;
      if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Home' || e.key === 'End') {
      if (!choices.length) return;
      e.preventDefault();
      follow.current = true;
      setActive(e.key === 'Home' ? 0 : choices.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = choices[active];
      if (c) pick(c.empty ? '' : c.e.entity_id);
    } else if (e.key === 'Escape') {
      // closes the list only, not the editor around it
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // the list lives at the end of the page: Tab goes on from the trigger, to the next field of the form
      close();
    }
  };
  const label = !list
    ? err ? t('No se pudieron cargar las entidades') : t('Cargando…')
    : sel ? sel.name : props.value ? `${props.value} (${t('No encontrada')})` : props.emptyLabel ?? t('Elige una entidad');
  const style = pos
    ? { left: `${pos.left}px`, width: `${pos.width}px`, maxHeight: `${pos.maxHeight}px`, top: pos.top != null ? `${pos.top}px` : 'auto', bottom: pos.bottom != null ? `${pos.bottom}px` : 'auto' }
    : { visibility: 'hidden' as const };
  let lastGroup = '';
  return (
    <div class={`ha-picker ha-combo ${open ? 'is-open' : ''}`} ref={box}>
      <button
        ref={trigger}
        type="button"
        class={`input ha-combo__trigger ${err || props.error ? 'is-invalid' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        disabled={!list}
        title={sel ? `${sel.name} (${sel.entity_id})` : undefined}
        onClick={() => (open ? (setOpen(false), setQ('')) : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            show();
          }
        }}
      >
        <span class={`ha-combo__label ${sel || props.value ? '' : 'is-placeholder'}`}>{label}</span>
        {sel && <span class="ha-combo__state">{haStateLine(sel)}</span>}
        <Icon name="down" size={14} />
      </button>
      {open &&
        createPortal(
          <div class="ha-combo__pop" ref={pop} style={style}>
            <div class="input-group">
              <span class="input-group__addon">
                <Icon name="search" size={14} />
              </span>
              <input
                ref={search}
                class="input"
                type="text"
                value={q}
                placeholder={t('Buscar entidad')}
                aria-label={t('Buscar entidad')}
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                aria-controls={uid}
                aria-activedescendant={choices.length ? `${uid}-${active}` : undefined}
                onInput={(e) => setQ(e.currentTarget.value)}
                onKeyDown={onKey}
                spellcheck={false}
                autocomplete="off"
                enterkeyhint="done"
              />
            </div>
            <ul class="ha-combo__list" role="listbox" id={uid} ref={listEl}>
              {choices.map((c, i) => {
                const head = !c.empty && c.group !== lastGroup ? (lastGroup = c.group) : null;
                const on = c.empty ? !props.value : c.e.entity_id === props.value;
                const used = !c.empty && !on && !!props.taken?.includes(c.e.entity_id);
                return (
                  <>
                    {head && (
                      <li class="ha-combo__group" role="presentation">
                        {head}
                      </li>
                    )}
                    <li
                      id={`${uid}-${i}`}
                      data-i={i}
                      role="option"
                      aria-selected={on}
                      class={`ha-combo__opt ${i === active ? 'is-active' : ''} ${on ? 'is-on' : ''} ${used ? 'is-used' : ''}`}
                      title={c.empty ? undefined : `${c.e.name} (${c.e.entity_id})`}
                      onPointerMove={() => i !== active && setActive(i)}
                      onClick={() => pick(c.empty ? '' : c.e.entity_id)}
                    >
                      <span class="ha-combo__check" aria-hidden="true">
                        {on && <Icon name="check" size={14} />}
                      </span>
                      <span class="ha-combo__name">{c.empty ? props.emptyLabel : c.e.name}</span>
                      {used && <span class="ha-combo__tag">{t('En uso')}</span>}
                      {!c.empty && <span class="ha-combo__state">{haStateLine(c.e)}</span>}
                    </li>
                  </>
                );
              })}
              {!choices.length && (
                <li class="ha-combo__none" role="presentation">
                  {list?.length ? t('Ninguna entidad coincide') : t('No hay entidades de este tipo')}
                </li>
              )}
            </ul>
            {matches.length > MAX_SHOWN && <div class="ha-combo__more">{t('Escribe para ver más ({n} en total)', { n: matches.length })}</div>}
          </div>,
          document.body,
        )}
      <div class="field__hint">
        {err ? (
          <span class="err-text">{t('No se pudieron cargar las entidades')}: {err}</span>
        ) : list && q.trim() ? (
          t('{n} de {total} entidades', { n: matches.length, total: list.length })
        ) : sel ? (
          <span>
            {sel.area ? `${sel.area} · ` : ''}
            <strong>{haStateLine(sel)}</strong>
          </span>
        ) : list ? (
          t('{n} entidades disponibles', { n: list.length })
        ) : null}
      </div>
    </div>
  );
}
