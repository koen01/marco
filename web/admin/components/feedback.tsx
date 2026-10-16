import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { Icon, type IconName } from './icons';

/* ------------------------------------------------------------------ toasts */

type ToastKind = 'ok' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
  leaving?: boolean;
  /** a button in the toast (e.g. Deshacer) */
  action?: { label: string; run: () => void };
}

let toasts: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: ToastKind = 'ok', ms = kind === 'error' ? 6000 : 3200, action?: ToastItem['action']) {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, kind, text, action }];
  emit();
  setTimeout(() => dismiss(id), ms);
}

function dismiss(id: number) {
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emit();
  }, 220);
}

export function ToastHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div class={`toast toast--${x.kind} ${x.leaving ? 'is-leaving' : ''}`} key={x.id} onClick={() => dismiss(x.id)}>
          <span class="toast__icon">
            <Icon name={x.kind === 'ok' ? 'check' : x.kind === 'error' ? 'alert' : 'info'} size={16} />
          </span>
          <span>{x.text}</span>
          {x.action && (
            <button
              type="button"
              class="toast__action"
              onClick={(e) => {
                e.stopPropagation();
                x.action!.run();
                dismiss(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ confirm / choice dialog */

interface ConfirmOpts {
  title: string;
  body?: ComponentChildren;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
}

export interface DialogChoice<T extends string> {
  value: T;
  label: string;
  kind?: 'primary' | 'danger' | 'ghost' | 'default';
  /** icon before the label (a provider logo in the linked accounts chooser) */
  icon?: IconName;
}

interface Pending {
  title: string;
  body?: ComponentChildren;
  /** Buttons left to right; the last one gets the focus. Escape, a click outside and `cancel` resolve null. */
  choices: DialogChoice<string>[];
  cancel: string;
  closeX: boolean;
  resolve: (v: string | null) => void;
}
let pending: Pending | null = null;
const dlgListeners = new Set<() => void>();

/** A dialog with several actions besides "cancel". Resolves the chosen value, or null when cancelled. */
/** `closeX`: a picker (no Cancel button; an X in the corner closes it, and the choices are stacked full width). */
export function choiceDialog<T extends string>(opts: { title: string; body?: ComponentChildren; choices: DialogChoice<T>[]; cancel?: string; closeX?: boolean }): Promise<T | null> {
  return new Promise((resolve) => {
    pending?.resolve(null);
    pending = { title: opts.title, body: opts.body, choices: opts.choices, cancel: opts.cancel ?? t('Cancelar'), closeX: !!opts.closeX, resolve: resolve as (v: string | null) => void };
    dlgListeners.forEach((l) => l());
  });
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return choiceDialog({
    title: opts.title,
    body: opts.body,
    cancel: opts.cancel,
    choices: [{ value: 'ok', label: opts.confirm ?? t('Aceptar'), kind: opts.danger ? 'danger' : 'primary' }],
  }).then((v) => v === 'ok');
}

export function DialogHost() {
  const [, force] = useState(0);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    dlgListeners.add(l);
    return () => void dlgListeners.delete(l);
  }, []);
  useEffect(() => {
    if (pending) okRef.current?.focus();
  });
  if (!pending) return null;
  const p = pending;
  const close = (v: string | null) => {
    pending = null;
    p.resolve(v);
    force((n) => n + 1);
  };
  const last = p.choices.length - 1;
  return (
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && close(null)} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), close(null))}>
      <div class={`modal ${p.closeX ? 'modal--picker' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        {p.closeX && (
          <button type="button" class="icon-btn modal__x" onClick={() => close(null)} aria-label={t('Cerrar')} title={t('Cerrar')}>
            <Icon name="x" size={16} />
          </button>
        )}
        <h3 id="dlg-title">{p.title}</h3>
        {p.body && <div class="modal__body">{p.body}</div>}
        <div class="modal__actions">
          {!p.closeX && (
            <button type="button" class="btn btn--ghost" onClick={() => close(null)}>
              {p.cancel}
            </button>
          )}
          {p.choices.map((c, i) => (
            <button
              type="button"
              key={c.value}
              ref={i === last ? okRef : undefined}
              class={`btn ${c.kind === 'danger' ? 'btn--danger' : c.kind === 'ghost' ? 'btn--ghost' : c.kind === 'default' ? 'btn--default' : 'btn--primary'}`}
              onClick={() => close(c.value)}
            >
              {c.icon && <Icon name={c.icon} size={16} />}
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
