// Inspector, Contenido tab, every card: "Horario", the days and times a card is on the screen (the time windows of
// privacy mode, ScheduleRulesEditor). The server leaves the card out of the screen's config outside its windows, so
// it gets no data then; the builder works it out again here to say when it is hidden right now.
import type { CanvasItem, PrivacyRule } from '../../shared/types';
import { ITEM_SCHEDULE_MAX, scheduleOn } from '../../../server/core/canvasCore.js';
import { Field, Select } from '../components/ui';
import { t } from '../i18n';
import { ScheduleRulesEditor } from '../sections/Privacy';

/** True when the card's schedule hides it now (never for a card hidden by hand or without a schedule). */
export function scheduleOffNow(item: CanvasItem, tz: string, now = new Date()): boolean {
  if (item.hidden || !item.schedule?.length) return false;
  try {
    return !scheduleOn(item, now, tz);
  } catch {
    return false;
  }
}

export function ScheduleField({ item, upd }: { item: CanvasItem; upd: (fn: (it: CanvasItem) => void, merge?: string) => void }) {
  const rules = item.schedule ?? [];
  const on = rules.length > 0;
  const paused = on && rules.every((r) => !r.enabled);
  return (
    <div class="stack bld-sched">
      <Field label={t('Horario')} hint={on ? undefined : t('Puede salir solo unas horas o unos días, por ejemplo el menú por la mañana o el tráfico entre semana.')}>
        <Select
          value={on ? 'some' : 'always'}
          options={[
            { value: 'always', label: t('Siempre') },
            { value: 'some', label: t('Solo en estas franjas') },
          ]}
          onChange={(v) =>
            upd((x) => {
              if (v === 'always') delete x.schedule;
              else x.schedule = [{ id: 'p_0', enabled: true, days: [1, 2, 3, 4, 5], from: '07:00', to: '09:00' }];
            })
          }
        />
      </Field>
      {on && (
        <ScheduleRulesEditor
          rules={rules}
          max={ITEM_SCHEDULE_MAX}
          newFrom="08:00"
          newTo="20:00"
          errorOf={(r) => (r.from === r.to ? 'Debe ser distinta de la hora de inicio' : undefined)}
          update={(fn) =>
            upd((x) => {
              const list: PrivacyRule[] = structuredClone(x.schedule ?? []);
              fn(list);
              if (list.length) x.schedule = list;
              else delete x.schedule;
            }, `${item.id}.schedule`)
          }
        />
      )}
      {paused && <p class="muted small">{t('Todas las franjas están en pausa: se ve siempre.')}</p>}
    </div>
  );
}
