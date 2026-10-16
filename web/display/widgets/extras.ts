// Custom message banner + to-do list cards (side panel).
import type { DisplayConfig } from '../../shared/types';
import { ctx } from '../ctx';
import { esc, setHTML } from '../dom';
import { ICON } from '../icons';

export function renderMessage(root: HTMLElement, cfg: DisplayConfig = ctx.cfg): void {
  const m = cfg.message;
  const on = m.enabled && !!m.text.trim();
  root.style.display = on ? '' : 'none';
  if (!on) return;
  setHTML(root, `<span class="msg-em">${esc(m.emoji || '💬')}</span><span class="msg-tx">${esc(m.text)}</span>`);
}

/** `opts`: at most `max` rows (default 6) and the done ones too (default yes). */
export function renderTodo(root: HTMLElement, cfg: DisplayConfig = ctx.cfg, opts: { max?: number; showDone?: boolean } = {}): void {
  const td = cfg.todo;
  const items = (td.items || []).filter((i) => i.text?.trim() && (opts.showDone !== false || !i.done));
  const on = td.enabled && items.length > 0;
  root.style.display = on ? '' : 'none';
  if (!on) return;
  const sorted = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)].slice(0, opts.max ?? 6);
  setHTML(
    root,
    `<div class="card-h">✅ ${esc(ctx.t('todo'))}</div><ul>${sorted
      .map((i) => `<li class="${i.done ? 'done' : ''}">${i.done ? ICON.check : ICON.circle}<span>${esc(i.text)}</span></li>`)
      .join('')}</ul>`,
  );
}
