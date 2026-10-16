// Inspector, Contenido tab of a Home Assistant card with controls: whether it can be used by touching the screen,
// two taps, the warning and the owner's tick for an entity that looks like a door, and the Probar buttons (they go
// through POST /api/admin/homeassistant/action: the preview in the frame never sends anything to Home Assistant).
import { useState } from 'preact/hooks';
import type { CanvasConfig, CanvasItem, HaControl, HaState } from '../../shared/types';
import { CANVAS_KINDS, itemAliases, itemNames, needsConfirm } from '../../../server/core/canvasCore.js';
import { ApiError, api } from '../api';
import { toast } from '../components/feedback';
import { Button, Callout, Field, ToggleRow } from '../components/ui';
import { t } from '../i18n';

const ERRORS: Record<string, string> = {
  not_allowed: 'Esta tarjeta no puede hacer eso con esa entidad.',
  out_of_range: 'Ese valor no vale para esta entidad.',
  ha_down: 'Home Assistant no responde.',
  ha_error: 'Home Assistant no lo ha aceptado.',
  rate: 'Demasiadas pruebas seguidas. Espera un momento.',
  bad_request: 'Elige antes una entidad.',
};

/** The bindings of an item with the state the builder fetched for each (haPreview.ts), keyed in alias order. */
function bindings(item: CanvasItem, states: Record<string, HaState>) {
  const names = itemNames(item);
  return itemAliases(item).map((a, i) => ({ ...a, name: names[i]?.name ?? '', state: states[a.alias] ?? null }));
}

/** True when the entity of a binding looks like a door, a gate or a lock (its id, its name, its device class). */
function flaggedOf(b: { entity: string; name: string; state: HaState | null }): boolean {
  const s = b.state as (HaState & { dc?: string | null; n?: string }) | null;
  return needsConfirm(b.entity.split('.')[0], { device_class: s?.dc ?? undefined, friendly_name: s?.n ?? undefined }, b.entity, b.name);
}

/** What Probar does for one binding: a control and its value, and the button's label. */
function probes(kind: string, b: { entity: string; name: string; state: HaState | null }): { control: HaControl; value?: unknown; label: string }[] {
  const d = b.entity.split('.')[0];
  const s = b.state;
  if (['light', 'switch', 'input_boolean', 'fan'].includes(d)) return [{ control: 'toggle', label: 'Encender o apagar' }];
  if (['scene', 'script', 'button'].includes(d)) return [{ control: 'run', label: 'Ejecutar' }];
  if (d === 'cover') {
    if (s?.d === 'cover' && s.readOnly) return [];
    return [
      { control: 'open', label: 'Subir' },
      { control: 'stop', label: 'Parar' },
      { control: 'close', label: 'Bajar' },
    ];
  }
  if (d === 'media_player' && kind === 'ha.media') return [{ control: 'playPause', label: 'Reproducir o pausar' }];
  if (d === 'valve') {
    if (s?.d === 'valve' && s.readOnly) return [];
    return [
      { control: 'open', label: 'Abrir' },
      { control: 'close', label: 'Cerrar' },
    ];
  }
  // a select or a number: what it has already (nothing changes, the path is tested)
  if (s?.d === 'select' && s.v && s.opts.includes(s.v)) return [{ control: 'selectOption', value: s.v, label: 'Mandar la misma opción' }];
  if (s?.d === 'sensor' && s.min !== undefined && s.num !== null) return [{ control: 'numberSet', value: s.num, label: 'Mandar el mismo valor' }];
  if (d === 'vacuum') return [{ control: 'dock', label: 'Volver a la base' }];
  // a climate: the temperature it already has (nothing changes, the path is tested)
  if (d === 'climate' && s?.d === 'climate' && s.target !== null) return [{ control: 'setpoint', value: s.target, label: 'Mandar la misma temperatura' }];
  return [];
}

export function HaControlsPanel({ item, cv, states, openMode, upd }: {
  item: CanvasItem;
  cv: CanvasConfig;
  states: Record<string, HaState>;
  openMode: boolean;
  upd: (fn: (it: CanvasItem) => void) => void;
}) {
  const [busy, setBusy] = useState('');
  if (!CANVAS_KINDS[item.kind]?.controls) return null;
  const list = bindings(item, states);
  const flagged = list.some(flaggedOf);
  // the house's water valve (device class water) rather than something that opens a door
  const water = list.some((b) => b.entity.startsWith('valve.') && (b.state as { dc?: string | null } | null)?.dc === 'water');
  const run = async (key: string, entity: string, control: HaControl, value?: unknown) => {
    setBusy(key);
    try {
      await api.haAction({ entity, kind: item.kind, control, ...(value !== undefined ? { value: value as number } : {}), props: item.props });
      toast(t('Hecho. Mira el dispositivo.'), 'ok');
    } catch (e) {
      const code = e instanceof ApiError && e.body && typeof e.body === 'object' ? String((e.body as { error?: unknown }).error ?? '') : '';
      toast(t(ERRORS[code] ?? 'No ha funcionado.'), 'error');
    } finally {
      setBusy('');
    }
  };
  const tests = list.flatMap((b) => probes(item.kind, b).map((p) => ({ ...p, b })));
  return (
    <div class="stack bld-ha-ctl">
      <h4 class="bld-h">{t('Tocar la pantalla')}</h4>
      {!cv.touch && <p class="muted small">{t('Para usar estos controles en la pantalla, activa «Permitir tocar en la pantalla» en Página.')}</p>}
      {cv.touch && openMode && <Callout kind="warn">{t('En modo abierto los controles no funcionan: vincula la pantalla o ábrela con su enlace privado.')}</Callout>}
      <ToggleRow
        label={t('Se puede usar tocando la pantalla')}
        checked={item.interactive !== false}
        disabled={!cv.touch}
        onChange={(v) => upd((x) => void (x.interactive = v))}
      />
      {flagged ? (
        <>
          <Callout kind="warn">{water ? t('Es una llave de paso del agua. En la pantalla pedirá siempre dos toques.') : t('Parece que abre una puerta, una cancela o una cerradura. En la pantalla pedirá siempre dos toques.')}</Callout>
          <ToggleRow
            label={t('Entiendo que cualquiera en la habitación podrá usarlo')}
            hint={t('Sin esta marca, la tarjeta solo muestra el estado.')}
            checked={!!item.ack}
            onChange={(v) => upd((x) => (v ? ((x.ack = true), (x.confirm = true)) : delete x.ack))}
          />
        </>
      ) : (
        <ToggleRow
          label={t('Pedir dos toques')}
          hint={t('El primero avisa y el segundo lo hace, para que no se active sin querer.')}
          checked={!!item.confirm}
          onChange={(v) => upd((x) => void (x.confirm = v))}
        />
      )}
      {tests.length > 0 && (
        <Field label={t('Probar')} hint={t('Lo hace de verdad en Home Assistant, aunque no hayas guardado.')}>
          <div class="bld-ha-probe">
            {tests.map((x, i) => {
              const key = `${x.b.alias}|${x.control}`;
              const who = list.length > 1 ? ` · ${x.b.name || x.b.state?.n || x.b.entity}` : '';
              return (
                <Button key={i} size="sm" disabled={!!busy} onClick={() => run(key, x.b.entity, x.control, x.value)}>
                  {busy === key ? t('Probando…') : `${t(x.label)}${who}`}
                </Button>
              );
            })}
          </div>
        </Field>
      )}
    </div>
  );
}
