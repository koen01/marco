// Where a Personalizado screen starts: the screen's current design copied onto the grid, a starting template, one
// template per existing design (Calendario grande, Hoy, Rutinas...), or an empty grid. Each card is a drawing of the
// template itself (thumb.tsx), in landscape or portrait as the screen will show it.
import { useMemo } from 'preact/hooks';
import type { CanvasConfig } from '../../shared/types';
import { CANVAS_TEMPLATES, type CanvasTemplate } from '../../../server/core/canvasCore.js';
import { Icon } from '../components/icons';
import { t } from '../i18n';
import { CanvasThumb } from './thumb';

export interface TemplateChoice {
  id: string;
  name: string;
  canvas: CanvasConfig;
  theme: 'light' | 'dark' | null;
}

export function TemplatePicker(props: {
  /** canvasFromTemplate with this server's kinds and the screen's references */
  make: (id: string) => CanvasConfig;
  /** the screen's current design as a canvas (null: nothing to copy) */
  current: { name: string; canvas: CanvasConfig; theme: 'light' | 'dark' | null } | null;
  portrait: boolean;
  light: boolean;
  /** Home Assistant is on for this server: the home panel template is offered */
  ha: boolean;
  onPick: (c: TemplateChoice) => void;
  onClose: () => void;
}) {
  const list = useMemo(() => {
    // the home panel needs Home Assistant (never on Marco Cloud)
    const usable = CANVAS_TEMPLATES.filter((tp: CanvasTemplate) => !tp.requires?.ha || props.ha);
    const build = (tp: CanvasTemplate): TemplateChoice => ({ id: tp.id, name: tp.name, canvas: props.make(tp.id), theme: tp.theme ?? null });
    return {
      start: usable.filter((tp) => !tp.group && tp.id !== 'photoFrame').map(build),
      design: usable.filter((tp) => tp.group === 'design' || tp.id === 'photoFrame').map(build),
    };
  }, [props.make, props.ha]);
  const card = (c: TemplateChoice, extra?: string) => (
    <button type="button" class="bld-tpl" onClick={() => props.onPick(c)}>
      <CanvasThumb cv={c.canvas} portrait={props.portrait} light={c.theme === 'light' || (props.light && c.theme !== 'dark')} />
      <span class="bld-tpl__name">{extra ?? t(c.name)}</span>
      <span class="bld-tpl__n muted small">{c.canvas.items.length ? t('{n} widgets', { n: c.canvas.items.length }) : t('Vacío')}</span>
    </button>
  );
  return (
    <div class="bld-tpls" role="dialog" aria-label={t('Plantillas')}>
      <div class="bld-tpls__head">
        <h4 class="bld-h">{t('Elige cómo empezar')}</h4>
        <button type="button" class="icon-btn" onClick={props.onClose} aria-label={t('Cerrar')}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class="bld-tpls__scroll">
        {props.current && (
          <>
            <h5 class="bld-sub">{t('Copiar mi diseño actual')}</h5>
            <div class="bld-tpls__grid">{card({ id: 'current', name: props.current.name, canvas: props.current.canvas, theme: props.current.theme })}</div>
          </>
        )}
        <h5 class="bld-sub">{t('Para empezar')}</h5>
        <div class="bld-tpls__grid">{list.start.map((c) => card(c))}</div>
        <h5 class="bld-sub">{t('Como los diseños de siempre')}</h5>
        <div class="bld-tpls__grid">{list.design.map((c) => card(c))}</div>
      </div>
    </div>
  );
}

