// The key of a pushed value (POST /api/hooks/values) in the builder: typed, or picked from the keys the server has,
// with the value that came last under it.
import { useMemo } from 'preact/hooks';
import type { HookValueInfo } from '../../shared/types';
import { VALUE_KEY_RE } from '../../../server/core/canvasCore.js';
import { TextInput } from '../components/ui';
import { locale, relTime, t } from '../i18n';

let seq = 0;

/** A value as the admin reads it: a number in the admin's language, true/false, or the text. */
export function valueLabel(x: HookValueInfo): string {
  const v = typeof x.value === 'number' ? new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 }).format(x.value) : String(x.value);
  return x.unit && typeof x.value === 'number' ? `${v} ${x.unit}` : v;
}

export function ValueKeyInput({ value, onValue, values }: { value: string; onValue: (v: string) => void; values: HookValueInfo[] }) {
  const id = useMemo(() => `bld-value-keys-${++seq}`, []);
  const hit = values.find((x) => x.key === value);
  const bad = !!value && !VALUE_KEY_RE.test(value);
  return (
    <div class="bld-value-key">
      <TextInput mono value={value} maxLength={40} placeholder="solar.today" aria-label={t('Clave')} list={id} error={bad} onValue={(v) => onValue(v.trim())} />
      <datalist id={id}>
        {values.map((x) => (
          <option value={x.key}>{x.label || valueLabel(x)}</option>
        ))}
      </datalist>
      <p class="muted small">
        {bad
          ? t('Solo letras minúsculas sin acentos, números y los signos _ . -')
          : hit
            ? t('Ahora: {value}, {ago}.', { value: valueLabel(hit), ago: relTime(hit.updatedAt) })
            : value
              ? t('Todavía no ha llegado nada con esta clave.')
              : values.length
                ? t('Escribe una clave o elige una de las que ya han llegado.')
                : t('La clave con la que Home Assistant u otro programa envía el valor a /api/hooks/values.')}
      </p>
    </div>
  );
}
