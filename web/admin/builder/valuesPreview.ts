// Pushed values in the builder (POST /api/hooks/values): the keys the server has, for the Valor card's key picker and
// the custom card's preview, and the values Stage.tsx posts to the frame ('marco:preview-values'), so a card not saved
// yet shows its key's value too. Asked for when the builder opens and every 30 s while it stays open.
import { useEffect, useState } from 'preact/hooks';
import type { DisplayValue, HookValueInfo } from '../../shared/types';
import { api } from '../api';

const EVERY_MS = 30_000;

/** The values the server has (null until the first answer, [] when it has none or cannot say). */
export function useHookValues(on: boolean): HookValueInfo[] | null {
  const [list, setList] = useState<HookValueInfo[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const load = () =>
      api.hookValues().then(
        (r) => alive && setList(Array.isArray(r.values) ? r.values : []),
        () => alive && setList((x) => x ?? []),
      );
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [on]);
  return list;
}

/** The values as a display gets them, by key. */
export function displayValues(list: HookValueInfo[] | null): Record<string, DisplayValue> {
  const out: Record<string, DisplayValue> = {};
  for (const x of list ?? []) {
    const at = Date.parse(x.updatedAt) || 0;
    out[x.key] = { v: x.value, at, ...(x.unit ? { u: x.unit } : {}), ...(x.label ? { l: x.label } : {}) };
  }
  return out;
}
