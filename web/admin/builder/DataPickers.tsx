// Inspector fields of the data cards (Cripto, Deportes, Bolsa): the coins with their currency, the teams and
// competitions followed, the stock symbols, and the Finnhub key the stocks card needs. Every search goes through this
// server (server/routes/data.js), which asks the source and keeps the answer.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../api';
import { caps } from '../caps';
import { t } from '../i18n';
import { Button, Callout, Select, TextInput } from '../components/ui';
import { DATA_LIMITS, MARKET_CURRENCIES, SPORTS_LEAGUES, STOCK_SYMBOL_RE } from '../../../server/core/dataCore.js';

type Coin = { id: string; sym: string; name: string; currency: string };
type Follow = { type: 'team' | 'league'; league: string; team?: string; name: string };
type Sym = { sym: string; name: string };

const errCode = (e: unknown) => (e instanceof ApiError ? String((e.body as { error?: string } | undefined)?.error ?? '') : '');
const leagueOf = (id: string) => SPORTS_LEAGUES.find((l) => l.id === id);
const SPORT_NAME: Record<string, string> = { soccer: 'Fútbol', basketball: 'Baloncesto', football: 'Fútbol americano', hockey: 'Hockey sobre hielo', baseball: 'Béisbol' };

/** A search box that asks after a short pause; `run` gives the results or throws. */
function useSearch<T>(run: (q: string) => Promise<T[]>, min = 2) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<T[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (text.length < min) {
      setRes(null);
      setErr('');
      return;
    }
    const n = ++seq.current;
    const tm = setTimeout(() => {
      setBusy(true);
      run(text).then(
        (r) => n === seq.current && (setRes(r), setErr('')),
        (e) => n === seq.current && (setRes([]), setErr(errCode(e) || 'fetch_failed')),
      ).finally(() => n === seq.current && setBusy(false));
    }, 450);
    return () => clearTimeout(tm);
  }, [q]);
  return { q, setQ, res, err, busy, clear: () => (setQ(''), setRes(null)) };
}

function searchError(code: string): string {
  if (code === 'no_key' || code === 'key_refused') return t('Guarda primero la clave de Finnhub, más abajo.');
  if (code === 'rate_limited') return t('El servicio pide esperar un poco. Prueba dentro de un minuto.');
  return t('No se ha podido buscar ahora. Prueba otra vez en un momento.');
}

// ------------------------------------------------------------------------------------------------ coins

export function CoinsField({ value, onChange }: { value: Coin[]; onChange: (v: Coin[]) => void }) {
  const coins = Array.isArray(value) ? value : [];
  const s = useSearch((q) => api.dataCoins(q).then((r) => r.coins));
  const full = coins.length >= DATA_LIMITS.coins;
  const add = (c: { id: string; sym: string; name: string }) => {
    if (full || coins.some((x) => x.id === c.id)) return;
    onChange([...coins, { id: c.id, sym: c.sym, name: c.name, currency: coins[0]?.currency ?? 'eur' }]);
    s.clear();
  };
  return (
    <div class="stack bld-dlist">
      {coins.map((c, i) => (
        <div class="bld-drow">
          <span class="bld-dbadge">{c.sym || c.id.slice(0, 4).toUpperCase()}</span>
          <span class="bld-dname">{c.name || c.id}</span>
          <Select
            value={c.currency}
            options={MARKET_CURRENCIES.map((x) => ({ value: x, label: x.toUpperCase() }))}
            onChange={(v) => onChange(coins.map((x, j) => (j === i ? { ...x, currency: String(v) } : x)))}
          />
          <button type="button" class="icon-btn" onClick={() => onChange(coins.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {!full && <TextInput value={s.q} placeholder={t('Busca una moneda: bitcoin, eth…')} onValue={s.setQ} aria-label={t('Buscar moneda')} />}
      {full && <p class="muted small">{t('Seis monedas como mucho por tarjeta.')}</p>}
      {s.busy && <p class="muted small">{t('Buscando…')}</p>}
      {s.err && <p class="muted small">{searchError(s.err)}</p>}
      {s.res && !s.err && (
        <div class="bld-dresults" role="listbox">
          {s.res.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
          {s.res.map((c) => (
            <button type="button" class="bld-dres" disabled={coins.some((x) => x.id === c.id)} onClick={() => add(c)}>
              <b>{c.sym}</b> <span>{c.name}</span>
              {c.rank ? <span class="muted small"> #{c.rank}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ teams and competitions

export function FollowField({ value, onChange }: { value: Follow[]; onChange: (v: Follow[]) => void }) {
  const list = Array.isArray(value) ? value : [];
  const [league, setLeague] = useState(list[list.length - 1]?.league ?? 'esp.1');
  const [teams, setTeams] = useState<{ id: string; name: string; abbr: string }[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true;
    setTeams(null);
    setErr('');
    api.dataTeams(league).then(
      (r) => alive && setTeams(r.teams),
      (e) => alive && (setTeams([]), setErr(errCode(e) || 'fetch_failed')),
    );
    return () => {
      alive = false;
    };
  }, [league]);
  const full = list.length >= DATA_LIMITS.follow;
  const has = (f: Follow) => list.some((x) => x.league === f.league && (x.team ?? '') === (f.team ?? ''));
  const add = (f: Follow) => {
    if (full || has(f)) return;
    onChange([...list, f]);
    setQ('');
  };
  const text = q.trim().toLowerCase();
  const shown = (teams ?? []).filter((x) => !text || x.name.toLowerCase().includes(text) || x.abbr.toLowerCase() === text).slice(0, 12);
  return (
    <div class="stack bld-dlist">
      {list.map((f, i) => (
        <div class="bld-drow">
          <span class="bld-dname">
            {f.type === 'team' ? f.name || f.team : leagueOf(f.league)?.name ?? f.league}
            <span class="muted small"> · {f.type === 'team' ? leagueOf(f.league)?.short ?? f.league : t('Toda la competición')}</span>
          </span>
          <button type="button" class="icon-btn" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {full ? (
        <p class="muted small">{t('Cuatro como mucho por tarjeta.')}</p>
      ) : (
        <>
          <Select value={league} options={SPORTS_LEAGUES.map((l) => ({ value: l.id, label: l.name, group: t(SPORT_NAME[l.sport] ?? 'Otros') }))} onChange={(v) => setLeague(String(v))} />
          <Button size="sm" disabled={has({ type: 'league', league, name: '' })} onClick={() => add({ type: 'league', league, name: '' })}>
            {t('Añadir toda la competición')}
          </Button>
          <TextInput value={q} placeholder={t('O busca un equipo de esta competición')} onValue={setQ} aria-label={t('Buscar equipo')} />
          {teams === null && <p class="muted small">{t('Cargando equipos…')}</p>}
          {err && <p class="muted small">{searchError(err)}</p>}
          {teams && !err && text && (
            <div class="bld-dresults" role="listbox">
              {shown.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
              {shown.map((x) => (
                <button type="button" class="bld-dres" disabled={has({ type: 'team', league, team: x.id, name: '' })} onClick={() => add({ type: 'team', league, team: x.id, name: x.name })}>
                  <b>{x.abbr}</b> <span>{x.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ stock symbols

export function SymbolsField({ value, onChange }: { value: Sym[]; onChange: (v: Sym[]) => void }) {
  const syms = Array.isArray(value) ? value : [];
  const s = useSearch((q) => api.dataSymbols(q).then((r) => r.symbols), 1);
  const full = syms.length >= DATA_LIMITS.symbols;
  const add = (x: Sym) => {
    if (full || syms.some((y) => y.sym === x.sym)) return;
    onChange([...syms, x]);
    s.clear();
  };
  const typed = s.q.trim().toUpperCase();
  return (
    <div class="stack bld-dlist">
      {syms.map((x, i) => (
        <div class="bld-drow">
          <span class="bld-dbadge is-wide">{x.sym}</span>
          <TextInput value={x.name} maxLength={40} placeholder={t('Nombre')} onValue={(v) => onChange(syms.map((y, j) => (j === i ? { ...y, name: v } : y)))} aria-label={t('Nombre')} />
          <button type="button" class="icon-btn" onClick={() => onChange(syms.filter((_, j) => j !== i))} aria-label={t('Quitar')}>
            ×
          </button>
        </div>
      ))}
      {!full && <TextInput value={s.q} placeholder={t('Busca un valor: Apple, MSFT…')} onValue={s.setQ} aria-label={t('Buscar valor')} />}
      {full && <p class="muted small">{t('Doce valores como mucho por tarjeta.')}</p>}
      {s.busy && <p class="muted small">{t('Buscando…')}</p>}
      {s.err && <p class="muted small">{searchError(s.err)}</p>}
      {!full && STOCK_SYMBOL_RE.test(typed) && !syms.some((y) => y.sym === typed) && (s.err || (s.res && !s.res.some((r) => r.sym === typed))) && (
        <button type="button" class="link-btn" onClick={() => add({ sym: typed, name: '' })}>
          {t('Añadir {s} tal cual', { s: typed })}
        </button>
      )}
      {s.res && !s.err && (
        <div class="bld-dresults" role="listbox">
          {s.res.length === 0 && <p class="muted small">{t('Nada con ese nombre.')}</p>}
          {s.res.map((r) => (
            <button type="button" class="bld-dres" disabled={syms.some((y) => y.sym === r.sym)} onClick={() => add({ sym: r.sym, name: r.name ? r.name.charAt(0) + r.name.slice(1).toLowerCase() : '' })}>
              <b>{r.sym}</b> <span>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Finnhub key: write-only (only its last four characters come back), tried once before the server keeps it. */
export function StocksKeyField() {
  // on Marco Cloud the key belongs to the service, not to the household
  if (caps().edition === 'cloud') return null;
  return <StocksKeyForm />;
}

function StocksKeyForm() {
  const [st, setSt] = useState<{ set: boolean; last4: string } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    api.stocksKey().then(setSt, () => setSt({ set: false, last4: '' }));
  }, []);
  const save = async (k: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.putStocksKey(k);
      setSt(r);
      setKey('');
      setMsg(k ? { kind: 'ok', text: r.checked ? t('Clave guardada. Finnhub la ha aceptado.') : t('Clave guardada. No se ha podido probar ahora.') } : { kind: 'ok', text: t('Clave quitada.') });
    } catch (e) {
      setMsg({ kind: 'error', text: errCode(e) === 'key_invalid' ? t('Finnhub no acepta esta clave.') : t('No se ha podido guardar la clave.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack">
      <p class="muted small bld-note">
        {t('Bolsa necesita una clave gratuita de Finnhub (finnhub.io). Se guarda en este servidor y nunca llega a las pantallas.')}
      </p>
      {st?.set && <p class="small">{t('Clave guardada, termina en {x}.', { x: st.last4 })}</p>}
      <div class="bld-drow">
        <TextInput type="password" autocomplete="off" value={key} maxLength={64} placeholder={st?.set ? t('Nueva clave') : t('Clave de Finnhub')} onValue={setKey} aria-label={t('Clave de Finnhub')} />
        <Button size="sm" variant="primary" loading={busy} disabled={!key.trim()} onClick={() => void save(key.trim())}>
          {t('Guardar')}
        </Button>
        {st?.set && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save('')}>
            {t('Quitar')}
          </Button>
        )}
      </div>
      {msg && <Callout kind={msg.kind}>{msg.text}</Callout>}
    </div>
  );
}
