import { useEffect, useState } from 'preact/hooks';
import type { AdminPhoto } from '../../shared/types';
import { api } from '../api';
import { Callout, Card, Field, PageHeader, Segmented, Select, Slider, TextInput, ToggleRow } from '../components/ui';
import { has } from '../caps';
import { t } from '../i18n';
import type { SectionProps } from './common';

const INTERVALS = [30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 86400];

function intervalLabel(s: number) {
  if (s < 60) return t('{n} segundos', { n: s });
  if (s < 3600) return s === 60 ? t('1 minuto') : t('{n} minutos', { n: s / 60 });
  if (s < 86400) return s === 3600 ? t('1 hora') : t('{n} horas', { n: s / 3600 });
  return t('1 día');
}

export function BackgroundSection({ cfg, set, errors }: SectionProps) {
  const b = cfg.background;
  const fx = b.weatherFx ?? 'simple';
  const galleryOn = has('gallery');
  const usesGallery = galleryOn && b.source !== 'stock';
  const [gallery, setGallery] = useState<AdminPhoto[] | null>(null);
  useEffect(() => {
    if (usesGallery && gallery === null) api.photos().then(setGallery, () => setGallery([]));
  }, [usesGallery]);
  const inRotation = gallery?.filter((p) => !p.hidden).length ?? 0;
  const intervals = INTERVALS.includes(b.intervalSec) ? INTERVALS : [...INTERVALS, b.intervalSec].sort((a, c) => a - c);
  return (
    <>
      <PageHeader scope="screen" title={t('Fondo')} desc={t('Fotos de fondo, transiciones y efectos ambientales animados.')} />
      <Card id="bg-photos" scope="screen" title={t('Fotos de fondo')} icon="image">
        <ToggleRow label={t('Mostrar fotos de fondo')} checked={b.enabled} onChange={(v) => set((d) => void (d.background.enabled = v))} />
        <div class={`stack ${b.enabled ? '' : 'is-disabled'}`}>
          {(galleryOn || b.source !== 'stock') && (
            <Field label={t('Origen')}>
              <Segmented
                full
                value={b.source}
                options={[
                  { value: 'stock', label: t('Stock'), icon: 'globe' },
                  { value: 'gallery', label: t('Mi galería'), icon: 'photos' },
                  { value: 'mixed', label: t('Mezcla'), icon: 'sparkles' },
                ]}
                onChange={(v) => set((d) => void (d.background.source = v))}
              />
              {!galleryOn && <Callout kind="warn">{t('{name} no está disponible aquí. Elige otra opción.', { name: t('Galería') })}</Callout>}
            </Field>
          )}
          {(!galleryOn || b.source !== 'gallery') && (
            <Field label={t('Tema de las fotos de stock')} hint={t('Palabra clave orientativa (p. ej. naturaleza, mar, montaña).')}>
              <TextInput value={b.stockTopic} onValue={(v) => set((d) => void (d.background.stockTopic = v))} placeholder="nature" />
            </Field>
          )}
          {usesGallery &&
            (gallery && gallery.length > 0 && inRotation === 0 ? (
              <Callout kind="warn">
                <strong>{t('Todas las fotos de la galería están ocultas.')}</strong>{' '}
                {t('Se mostrarán fotos de stock hasta que vuelvas a mostrar alguna en')}{' '}
                <a href="#/photos">
                  <strong>{t('Galería')}</strong>
                </a>
                .
              </Callout>
            ) : (
              <Callout>
                {gallery && gallery.length > 0 ? `${t('{shown} de {total} en rotación', { shown: inRotation, total: gallery.length })}. ` : ''}
                {t('Gestiona tus fotos y elige cuáles se muestran en')}{' '}
                <a href="#/photos">
                  <strong>{t('Galería')}</strong>
                </a>
                .
              </Callout>
            ))}
          {usesGallery && (
            <Field
              label={t('Orden de las fotos')}
              hint={
                (b.order ?? 'random') === 'random'
                  ? t('Al azar, sin repetir las fotos de la tanda anterior.')
                  : t('Sigue donde lo dejó y vuelve a empezar al terminar.')
              }
              error={errors['background.order']}
            >
              <div class="bg-order">
                <Segmented
                  full
                  value={b.order ?? 'random'}
                  options={[
                    { value: 'random', label: t('Aleatorio'), icon: 'sparkles' },
                    { value: 'newest', label: t('Más recientes primero'), icon: 'history' },
                    { value: 'name', label: t('Por nombre'), icon: 'list' },
                  ]}
                  onChange={(v) => set((d) => void (d.background.order = v))}
                />
              </div>
            </Field>
          )}
          <div class="grid grid--2">
            <Field label={t('Cambiar foto cada')} error={errors['background.intervalSec']}>
              <Select value={b.intervalSec} options={intervals.map((s) => ({ value: s, label: intervalLabel(s) }))} onChange={(v) => set((d) => void (d.background.intervalSec = v))} />
            </Field>
            <Field label={t('Brillo')}>
              <Slider value={b.brightness} min={0.2} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.background.brightness = v))} />
            </Field>
          </div>
          {cfg.screen.style === 'modern' && <Callout kind="info">{t('Con el estilo Moderno, las tarjetas de cristal se ajustan en Diseño > Cristal.')}</Callout>}
          <div class="grid grid--2">
            <Field label={t('Desenfoque del panel del tiempo')} hint={t('0 = sin desenfoque. En la Raspberry Pi, menos desenfoque es más ligero.')}>
              <Slider value={b.panelBlur ?? 18} min={0} max={40} step={1} format={(v) => (v ? `${v}` : t('Sin desenfoque'))} onChange={(v) => set((d) => void (d.background.panelBlur = v))} />
            </Field>
            <Field label={t('Oscuridad del panel del tiempo')} hint={t('Más oscuro = más legible sobre fotos claras.')}>
              <Slider value={b.panelShade ?? 0.5} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((d) => void (d.background.panelShade = v))} />
            </Field>
          </div>
          <ToggleRow label={t('Mostrar autor / título de la foto')} checked={b.showMeta} onChange={(v) => set((d) => void (d.background.showMeta = v))} />
          <ToggleRow label={t('Recortar para llenar la pantalla')} hint={t('Si se desactiva, la foto se muestra completa con bandas.')} checked={b.cover} onChange={(v) => set((d) => void (d.background.cover = v))} />
          <ToggleRow
            label={t('Foto en toda la pantalla')}
            hint={t('La foto también se ve detrás del calendario, no solo en el panel lateral o la franja superior. El efecto ambiental no se muestra. Algunos diseños ya usan la foto en toda la pantalla.')}
            checked={b.fullScreen === true}
            onChange={(v) => set((d) => void (d.background.fullScreen = v))}
          />
          <Field label={t('Transición entre fotos')}>
            <Segmented
              value={b.transition}
              options={[
                { value: 'webgl', label: t('WebGL (suave)') },
                { value: 'fade', label: t('Fundido') },
                { value: 'none', label: t('Ninguna') },
              ]}
              onChange={(v) => set((d) => void (d.background.transition = v))}
            />
          </Field>
        </div>
      </Card>
      <Card id="bg-ambient" scope="screen" title={t('Efecto ambiental')} icon="sparkles" desc={t('Animación three.js detrás del calendario. Limitada a 30 fps para la Raspberry Pi.')}>
        <div class="fx-grid">
          {(
            [
              { v: 'aurora', name: t('Aurora'), desc: t('Velos de color suaves que se mueven lentamente.') },
              { v: 'particles', name: t('Partículas'), desc: t('Polvo de luz flotando con profundidad.') },
              { v: 'none', name: t('Ninguno'), desc: t('Máximo rendimiento, sin WebGL.') },
            ] as const
          ).map((o) => (
            <button type="button" class={`fx ${b.ambient === o.v ? 'is-active' : ''}`} onClick={() => set((d) => void (d.background.ambient = o.v))}>
              <span class={`fx__swatch fx__swatch--${o.v}`} />
              <strong>{o.name}</strong>
              <small>{o.desc}</small>
            </button>
          ))}
        </div>
      </Card>
      <Card id="bg-weather" scope="screen" title={t('Efecto del tiempo')} icon="cloud" desc={t('Animación sobre la foto según el tiempo actual. Solo con WebGL, no se usa con ?lite=1.')}>
        <Field
          hint={
            fx === 'off'
              ? t('Sin lluvia ni nieve sobre la foto.')
              : fx === 'rich'
                ? t('Gotas en el cristal, nieve en capas y rayos de sol en los días despejados. La foto no se desenfoca. Algo más exigente para la Raspberry Pi.')
                : t('Partículas finas de lluvia o nieve. Lo más ligero.')
          }
          error={errors['background.weatherFx']}
        >
          <Segmented
            full
            value={fx}
            options={[
              { value: 'off', label: t('Desactivado') },
              { value: 'simple', label: t('Sencillo') },
              { value: 'rich', label: t('Realista') },
            ]}
            onChange={(v) => set((d) => void (d.background.weatherFx = v))}
          />
        </Field>
      </Card>
    </>
  );
}
