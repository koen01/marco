import { useEffect, useState } from 'preact/hooks';
import { HaEntityPicker } from '../components/HaEntityPicker';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Field, NumberInput, PageHeader, Segmented, Select, TextInput, ToggleRow } from '../components/ui';
import { ScopeBadge } from '../components/ui';
import type { AdminStatus, GeocodeResult, OpenMeteoModel, WeatherKeyStatus, WeatherProvider } from '../../shared/types';
import { api, ApiError } from '../api';
import { toast } from '../components/feedback';
import { has } from '../caps';
import { getLang, kmh, t } from '../i18n';
import type { SectionProps } from './common';

export function WeatherSection({ cfg, set, errors }: SectionProps) {
  const w = cfg.weather;
  const haOffered = has('homeassistant');
  const haOn = haOffered && cfg.homeassistant.enabled;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async (e?: Event) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      // Through this server (GET /api/admin/geocode), so the browser only talks to its own server.
      const j = await api.geocode(q.trim(), getLang());
      setResults(j.results ?? []);
    } catch (e) {
      setResults([]);
      if ((e as ApiError).status === 429) toast(t('Demasiadas búsquedas seguidas. Espera unos minutos.'), 'error');
      else toast(t('No se pudo buscar (¿sin conexión a Internet?). Inténtalo de nuevo.'), 'error');
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <PageHeader title={t('Tiempo')} desc={t('Previsión, humedad y viento de tu ciudad. Elige de dónde vienen los datos: todas las fuentes son gratuitas.')} />
      <Card id="wx-main" title={t('Tiempo')} icon="cloud">
        <ToggleRow label={<>{t('Mostrar el tiempo')} <ScopeBadge scope="screen" /></>} checked={w.enabled} onChange={(v) => set((d) => void (d.weather.enabled = v))} />
        <div class={`stack ${w.enabled ? '' : 'is-disabled'}`}>
          <Field label={t('Ubicación')} hint={t('Busca una ciudad para rellenar las coordenadas.')}>
            <form class="search-row" onSubmit={search}>
              <TextInput value={q} onValue={setQ} placeholder={t('Buscar ciudad…')} prefix={<Icon name="search" size={14} />} />
              <Button type="submit" loading={searching}>
                {t('Buscar')}
              </Button>
            </form>
            {results && (
              <div class="geo-results">
                {results.length === 0 && <div class="muted small">{t('Sin resultados')}</div>}
                {results.map((r) => (
                  <button
                    type="button"
                    class="geo-result"
                    onClick={() => {
                      set((d) => {
                        d.weather.lat = Math.round(r.lat * 1000) / 1000;
                        d.weather.lon = Math.round(r.lon * 1000) / 1000;
                        d.weather.locationName = [r.name, r.admin1].filter(Boolean).join(', ');
                      });
                      setResults(null);
                      setQ('');
                    }}
                  >
                    <Icon name="pin" size={14} />
                    <span>
                      <strong>{r.name}</strong> <span class="muted">{[r.admin1, r.country].filter(Boolean).join(', ')}</span>
                    </span>
                    <span class="mono small muted">
                      {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          <div class="grid grid--3">
            <Field label={t('Nombre visible')}>
              <TextInput value={w.locationName} onValue={(v) => set((d) => void (d.weather.locationName = v))} />
            </Field>
            <Field label={t('Latitud')} error={errors['weather.lat']}>
              <NumberInput value={w.lat} step={0.001} min={-90} max={90} error={!!errors['weather.lat']} onValue={(v) => set((d) => void (d.weather.lat = v))} />
            </Field>
            <Field label={t('Longitud')} error={errors['weather.lon']}>
              <NumberInput value={w.lon} step={0.001} min={-180} max={180} error={!!errors['weather.lon']} onValue={(v) => set((d) => void (d.weather.lon = v))} />
            </Field>
          </div>
          <div class="grid grid--2">
            <Field label={t('Unidades')}>
              <Segmented
                full
                value={w.units}
                options={[
                  { value: 'metric', label: `°C · ${kmh()}` },
                  { value: 'imperial', label: '°F · mph' },
                ]}
                onChange={(v) => set((d) => void (d.weather.units = v))}
              />
            </Field>
            <Field label={<>{t('Previsión extendida')} <ScopeBadge scope="screen" /></>}>
              <Segmented
                full
                value={w.forecastDays}
                options={[1, 3, 4, 5, 7].map((n) => ({ value: n, label: `${n} d`, title: t('{n} días', { n }) }))}
                onChange={(v) => set((d) => void (d.weather.forecastDays = v))}
              />
            </Field>
          </div>
          <ToggleRow icon="🕐" label={t('Previsión por horas')} hint={t('Próximas 8 horas')} checked={w.showHourly} onChange={(v) => set((d) => void (d.weather.showHourly = v))} />
          <ToggleRow icon="☔" label={t('Probabilidad de lluvia')} checked={w.showPrecipChance} onChange={(v) => set((d) => void (d.weather.showPrecipChance = v))} />
          <ToggleRow icon="🌡️" label={t('Sensación térmica')} hint={t('Temperatura aparente, con viento y humedad')} checked={w.showFeelsLike} onChange={(v) => set((d) => void (d.weather.showFeelsLike = v))} />
        </div>
      </Card>
      <WeatherSourceCard cfg={cfg} set={set} errors={errors} haOffered={haOffered} haOn={haOn} />
      {haOffered && (
        <Card id="wx-ha" scope="global" title={t('Datos de Home Assistant')} icon="home" desc={t('Opcional: usa tu estación meteorológica y sensores interiores.')} muted={!haOn}>
          <div class="grid grid--3">
            <Field label={t('Entidad del tiempo')} error={errors['weather.haWeatherEntity']}>
              <HaEntityPicker domain="weather" enabled={haOn} value={w.haWeatherEntity} error={!!errors['weather.haWeatherEntity']} onChange={(v) => set((d) => void (d.weather.haWeatherEntity = v))} />
            </Field>
            <Field label={t('Temperatura interior')}>
              <HaEntityPicker
                domain="sensor"
                enabled={haOn}
                value={w.haIndoorTempEntity}
                filter={(e) => !e.unit || /°|c|f/i.test(e.unit)}
                onChange={(v) => set((d) => void (d.weather.haIndoorTempEntity = v))}
              />
            </Field>
            <Field label={t('Humedad interior')}>
              <HaEntityPicker
                domain="sensor"
                enabled={haOn}
                value={w.haIndoorHumidityEntity}
                filter={(e) => !e.unit || e.unit === '%'}
                onChange={(v) => set((d) => void (d.weather.haIndoorHumidityEntity = v))}
              />
            </Field>
          </div>
        </Card>
      )}
    </>
  );
}

/** Short description of each source; the licence line is shown for the chosen one. */
function sourceOptions(haOffered: boolean, current: WeatherProvider) {
  const opts: { v: WeatherProvider; icon: 'globe' | 'cloud' | 'key' | 'home'; title: string; badge?: string; body: string }[] = [
    {
      v: 'open-meteo',
      icon: 'globe',
      title: 'Open-Meteo',
      badge: t('Recomendado'),
      body: t('Sin clave. Usa el mejor modelo meteorológico para tu zona o el que elijas (ECMWF, ICON, GFS…).'),
    },
    {
      v: 'met-norway',
      icon: 'cloud',
      title: 'MET Norway',
      body: t('Sin clave. El instituto meteorológico de Noruega, con previsión para todo el mundo. Fuera de los países nórdicos no da probabilidad de lluvia.'),
    },
    {
      v: 'pirate-weather',
      icon: 'key',
      title: 'Pirate Weather',
      badge: t('Clave gratuita'),
      body: t('Necesita tu propia clave gratuita (10.000 consultas al mes; Marco usa unas 3.000). Modelos de NOAA y ECMWF.'),
    },
  ];
  if (haOffered || current === 'homeassistant') {
    opts.push({ v: 'homeassistant', icon: 'home', title: 'Home Assistant', body: t('El tiempo actual de tu entidad de Home Assistant, con la previsión de Open-Meteo.') });
  }
  return opts;
}

const MODEL_LABELS: Record<OpenMeteoModel, string> = {
  best_match: 'Automático (recomendado)',
  ecmwf_ifs: 'ECMWF IFS (centro europeo)',
  icon_seamless: 'DWD ICON (Alemania)',
  gfs_seamless: 'NOAA GFS (Estados Unidos)',
  meteofrance_seamless: 'Météo-France (Europa, hasta 4 días)',
  ukmo_seamless: 'UK Met Office (Reino Unido)',
  gem_seamless: 'GEM (Canadá)',
  jma_seamless: 'JMA (Japón)',
};

const LICENCE: Record<string, { name: string; site: string; url: string; licence?: string; licenceUrl?: string }> = {
  'open-meteo': { name: 'Open-Meteo', site: 'open-meteo.com', url: 'https://open-meteo.com/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'met-norway': { name: 'MET Norway', site: 'api.met.no', url: 'https://api.met.no/', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'pirate-weather': { name: 'Pirate Weather', site: 'pirateweather.net', url: 'https://pirateweather.net/' },
};

const WX_ERRORS: Record<string, string> = {
  key_missing: 'Falta la clave de la fuente del tiempo.',
  key_invalid: 'La fuente del tiempo no acepta la clave guardada. Revísala.',
  rate_limited: 'La fuente del tiempo ha recibido demasiadas consultas. Marco lo intentará de nuevo en unos minutos.',
  http: 'No se pudo conectar con la fuente del tiempo. Las pantallas muestran los últimos datos.',
  bad_response: 'La fuente del tiempo ha enviado una respuesta que Marco no entiende.',
};

function WeatherSourceCard({ cfg, set, errors, haOffered, haOn }: Pick<SectionProps, 'cfg' | 'set' | 'errors'> & { haOffered: boolean; haOn: boolean }) {
  const w = cfg.weather;
  const provider = w.provider;
  const [keyStatus, setKeyStatus] = useState<WeatherKeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [editKey, setEditKey] = useState(false);
  const [wxStatus, setWxStatus] = useState<AdminStatus['weather'] | null>(null);

  useEffect(() => {
    api.weatherKey().then(setKeyStatus).catch(() => setKeyStatus(null));
    if (has('status')) api.status().then((s) => setWxStatus(s.weather)).catch(() => {});
  }, []);

  const saveKey = async (value: string) => {
    setSavingKey(true);
    try {
      const st = await api.setWeatherKey(value);
      setKeyStatus(st);
      setKey('');
      setEditKey(false);
      toast(value ? t('Clave guardada') : t('Clave quitada'));
    } catch (e) {
      const err = e as ApiError;
      toast(err.status === 400 ? t('Pirate Weather no acepta esta clave. Cópiala de nuevo desde tu cuenta.') : t('No se pudo guardar la clave.'), 'error');
    } finally {
      setSavingKey(false);
    }
  };

  const fromOpenMeteo = provider === 'open-meteo' || provider === 'homeassistant';
  const lic = LICENCE[fromOpenMeteo ? 'open-meteo' : provider];
  const model = fromOpenMeteo && w.model !== 'best_match' ? MODEL_LABELS[w.model]?.replace(/ \(.*\)$/, '') : '';
  const opts = sourceOptions(haOffered, provider);
  const keyError = errors['weather.apiKey'];
  // The status is about the saved provider: show it only while the page shows that one.
  const statusError = wxStatus && wxStatus.ok === false && (!wxStatus.provider || wxStatus.provider === (provider === 'homeassistant' ? 'open-meteo' : provider)) ? WX_ERRORS[wxStatus.errorCode || 'http'] : null;

  return (
    <Card id="wx-source" scope="global" title={t('Fuente de los datos')} icon="globe" desc={t('De dónde saca Marco la previsión. Puedes cambiarla cuando quieras.')}>
      <div class="access-mode wx-sources" role="radiogroup" aria-label={t('Fuente de los datos')}>
        {opts.map((o) => (
          <button type="button" role="radio" aria-checked={provider === o.v} class={`access-mode__opt ${provider === o.v ? 'is-active' : ''}`} onClick={() => set((d) => void (d.weather.provider = o.v))}>
            <Icon name={o.icon} size={18} />
            <div>
              <strong>
                <span class="wx-sources__name">{o.title}</span>
                {o.badge && <span class="badge badge--soft">{o.badge}</span>}
              </strong>
              <p>{o.body}</p>
            </div>
          </button>
        ))}
      </div>
      {provider === 'homeassistant' && !haOffered && <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: 'Home Assistant' })}</Callout>}
      {provider === 'homeassistant' && haOffered && !haOn && (
        <Callout kind="warn">
          {t('Activa y configura Home Assistant en')} <a href="#/homeassistant">Home Assistant</a>.
        </Callout>
      )}
      {fromOpenMeteo && (
        <Field label={t('Modelo de previsión')} hint={t('Automático elige el mejor modelo para tu zona. Algunos modelos no dan probabilidad de lluvia o índice UV; esos datos no se muestran.')}>
          <Select<OpenMeteoModel>
            value={w.model}
            options={(Object.keys(MODEL_LABELS) as OpenMeteoModel[]).map((m) => ({ value: m, label: t(MODEL_LABELS[m]) }))}
            onChange={(v) => set((d) => void (d.weather.model = v))}
          />
        </Field>
      )}
      {provider === 'pirate-weather' && (
        <Field
          label={t('Clave de Pirate Weather')}
          error={keyError ? t('Guarda tu clave de Pirate Weather antes de elegir esta fuente.') : undefined}
          hint={
            <>
              {t('Créala gratis en')}{' '}
              <a href="https://pirate-weather.apiable.io/" target="_blank" rel="noopener noreferrer">
                pirateweather.net
              </a>
              . {t('Se guarda solo en el servidor y nunca se vuelve a mostrar.')}
            </>
          }
        >
          {keyStatus?.set && !editKey ? (
            <div class="search-row">
              <span class="wx-key-saved">
                <Icon name="check" size={14} /> {t('Clave guardada')} <span class="mono muted">…{keyStatus.hint}</span>
              </span>
              <Button onClick={() => setEditKey(true)}>{t('Cambiar')}</Button>
              <Button variant="danger" loading={savingKey} onClick={() => saveKey('')}>
                {t('Quitar')}
              </Button>
            </div>
          ) : (
            <form
              class="search-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) saveKey(key.trim());
              }}
            >
              <TextInput type="password" mono autocomplete="off" value={key} onValue={setKey} error={!!keyError} placeholder={t('Pega aquí tu clave')} prefix={<Icon name="key" size={14} />} />
              <Button type="submit" variant="primary" disabled={!key.trim()} loading={savingKey}>
                {t('Guardar clave')}
              </Button>
            </form>
          )}
        </Field>
      )}
      {statusError && <Callout kind="error">{t(statusError)}</Callout>}
      <p class="muted small wx-credit">
        {t('Datos de')}{' '}
        <a href={lic.url} target="_blank" rel="noopener noreferrer">
          {lic.name}
        </a>
        {model ? ` (${model})` : ''}
        {lic.licence ? (
          <>
            {', '}
            {t('con licencia')}{' '}
            <a href={lic.licenceUrl} target="_blank" rel="noopener noreferrer">
              {lic.licence}
            </a>
          </>
        ) : null}
        . {t('Las pantallas lo indican con una nota pequeña junto al tiempo.')}
      </p>
    </Card>
  );
}
