import { useEffect, useRef, useState } from 'preact/hooks';
import type { AdminPhoto, BackupInfo, ImportNote, ImportPreview } from '../../shared/types';
import { api, ApiError, downloadJson } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { Button, Callout, Card, Empty, PageHeader, Toggle } from '../components/ui';
import { fmtDateTime } from '../dates';
import { relTime, nScreens, t } from '../i18n';
import { has, isSelfHosted } from '../caps';
import { takeIntent } from '../intent';
import { sectionLabel } from '../activityText';
import { formatBytes } from '../util';
import { uniqueNames, zipParts, ZIP_MAX_BYTES } from '../zip';
import type { SectionProps } from './common';

/** What an import leaves out on this server (ImportPreview.notes, Marco Cloud), in words. */
export function importNoteText(n: ImportNote): string {
  const list = (n.items ?? []).join(', ');
  switch (n.code) {
    case 'secrets':
      return t('La copia trae secretos (contraseña, tokens, enlaces privados, dispositivos vinculados). Aquí no se importan: los enlaces y dispositivos de tus pantallas siguen como están.');
    case 'homeassistant':
      return t('Home Assistant no se importa: Marco Cloud no puede conectarse a tu red de casa. El tiempo se toma de Open-Meteo.');
    case 'signIn':
      return t('La contraseña del panel y el inicio de sesión con Google no se importan: aquí entras con tu cuenta de Marco.');
    case 'openDisplayAccess':
      return t('El acceso abierto a las pantallas no se importa: aquí cada pantalla usa su enlace privado o un dispositivo vinculado.');
    case 'insecureTls':
      return t('Se importan con la comprobación de certificados activada: {list}.', { list });
    case 'google':
      return t('Calendarios de Google de cuentas que no están conectadas aquí, no se importan: {list}. Conecta la cuenta en Calendarios y vuelve a añadirlos.', { list });
    case 'microsoft':
      return t('Calendarios de Microsoft de cuentas que no están conectadas aquí, no se importan: {list}. Conecta la cuenta en Calendarios y vuelve a añadirlos.', { list });
    case 'blockedUrl':
      return t('No se importan porque su dirección no es accesible desde Internet (red local o nombre interno): {list}.', { list });
    case 'refreshMin':
      return t('Se actualizarán cada 30 minutos, el mínimo aquí: {list}.', { list });
    case 'news':
      return t('Las fuentes de noticias no se importan: este servidor no ofrece noticias.');
    case 'photos':
      return t('Las fotos de la galería no van en la copia: súbelas en Fotos.');
    case 'webWidgets':
      return t('Los widgets de páginas web no se importan, aquí solo hay widgets de imagen: {list}.', { list });
    case 'widgetHttps':
      return t('Widgets que no se importan porque su dirección no empieza por https://: {list}.', { list });
    case 'widgetRefresh':
      return t('Se actualizarán cada 30 segundos, el mínimo aquí: {list}.', { list });
    case 'haWidgets':
      return t('Las tarjetas de Home Assistant y las cámaras de las pantallas Personalizado no se importan: Marco Cloud no puede conectarse a tu red de casa. Pantallas: {list}.', { list });
    case 'customWidgets':
      return t('Las tarjetas con HTML propio no se importan, aquí no están disponibles. Pantallas: {list}.', { list });
    default:
      return list;
  }
}

/** File name for a downloaded backup (self-hosted ids are file names already). */
function backupFileName(b: BackupInfo): string {
  if (b.id.endsWith('.json')) return b.id;
  const stamp = b.createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `config-${stamp}-r${b.revision}-${b.reason}.json`;
}

const REASON: Record<string, string> = { save: 'Al guardar', manual: 'Manual', restore: 'Antes de restaurar', import: 'Antes de importar', migration: 'Migración v1' };

/**
 * Run a call that sends private data (an export or import with secrets). When the server asks for the password
 * (no sign-in in the last 10 minutes: 403 password_required) or says it was wrong, ask for it and try again.
 * Resolves null when the person cancels.
 */
async function withPassword<T>(run: (password?: string) => Promise<T>): Promise<T | null> {
  let password: string | undefined;
  for (let i = 0; i < 4; i++) {
    try {
      return await run(password);
    } catch (e) {
      const code = ((e as ApiError).body as { code?: string } | null)?.code;
      if (code !== 'password_required' && code !== 'password_incorrect') throw e;
      let typed = '';
      const ok = await confirmDialog({
        title: t('Contraseña actual'),
        body: (
          <>
            <p>{t('Para incluir los datos privados, escribe la contraseña del panel.')}</p>
            {code === 'password_incorrect' && <p class="err-text">{t('Contraseña incorrecta')}</p>}
            <input class="input" type="password" autocomplete="current-password" aria-label={t('Contraseña actual')} onInput={(ev) => (typed = ev.currentTarget.value)} />
          </>
        ),
      });
      if (!ok || !typed) return null;
      password = typed;
    }
  }
  return null;
}

export function BackupsSection({ dirty, replaceConfig, full }: SectionProps) {
  const hasPhotos = !!full?.family?.members?.some((m) => !!m.photo);
  const [secrets, setSecrets] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [listErr, setListErr] = useState('');
  const [creating, setCreating] = useState(false);
  const [bundle, setBundle] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [impSecrets, setImpSecrets] = useState(false);
  const [busy, setBusy] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(null);
  const secretsOn = has('includeSecrets');
  const backupsOn = has('backups');
  const transferOn = has('importExport');

  const load = async () => {
    try {
      setList(await api.backups());
      setListErr('');
    } catch (e) {
      setList([]);
      setListErr((e as ApiError).message);
    }
  };
  useEffect(() => {
    if (backupsOn) load();
    if (takeIntent('backups', 'export') && transferOn) setTimeout(() => doExport(), 200);
    if (takeIntent('backups', 'backup') && backupsOn) setTimeout(() => createNow(), 200);
  }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      const withSecrets = secretsOn && secrets;
      const b = withSecrets ? await withPassword((pw) => api.exportConfig(true, pw)) : await api.exportConfig(false);
      if (!b) return;
      const day = new Date().toISOString().slice(0, 10);
      downloadJson(b, `marco-${day}${withSecrets ? '-secrets' : ''}.json`);
      toast(t('Copia descargada'));
    } catch (e) {
      toast(`${t('No se pudo exportar')}: ${(e as ApiError).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const createNow = async () => {
    setCreating(true);
    try {
      await api.createBackup();
      toast(t('Copia de seguridad creada'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const readFile = async (f: File) => {
    setPreview(null);
    setBundle(null);
    setFileName(f.name);
    if (f.size > 5 * 1024 * 1024) return toast(t('El archivo es demasiado grande (máx. 5 MB)'), 'error');
    let data: unknown;
    try {
      data = JSON.parse(await f.text());
    } catch {
      return toast(t('El archivo no es un JSON válido'), 'error');
    }
    setBundle(data);
    setBusy('preview');
    try {
      const p = await api.importPreview(data);
      setPreview(p);
      const over = new Set((p.overLimit ?? []).map((o) => o.section));
      setSections(p.sections.filter((s) => s.changed && !over.has(s.key)).map((s) => s.key));
      setImpSecrets(false);
    } catch (e) {
      toast(`${t('No se pudo analizar')}: ${(e as ApiError).message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const apply = async () => {
    if (!preview || !bundle) return;
    const all = preview.sections.length === sections.length;
    const ok = await confirmDialog({
      title: t('¿Importar esta configuración?'),
      body: (
        <>
          <p>{all ? t('Se reemplazará toda la configuración actual.') : t('Se reemplazarán: {list}.', { list: sections.map(sectionLabel).join(', ') })}</p>
          <p class="muted small">{t('Antes se guarda una copia automática de la configuración actual.')}</p>
          {dirty && <p class="err-text">{t('Perderás los cambios sin guardar.')}</p>}
          {secretsOn && impSecrets && <p class="err-text">{t('Si la copia trae otra contraseña, se cerrarán todas las sesiones.')}</p>}
        </>
      ),
      confirm: t('Importar'),
      danger: true,
    });
    if (!ok) return;
    setBusy('apply');
    try {
      const includeSecrets = secretsOn && impSecrets;
      const r = await withPassword((password) => api.importApply({ bundle, includeSecrets, sections: all ? undefined : sections, ...(password ? { password } : {}) }));
      if (!r) return;
      if (r.loggedOut) {
        toast(t('Importado. La contraseña ha cambiado: vuelve a entrar.'), 'info');
        setTimeout(() => location.reload(), 1500);
        return;
      }
      replaceConfig(r.config);
      setPreview(null);
      setBundle(null);
      setFileName('');
      toast(t('Configuración importada'));
      load();
    } catch (e) {
      toast(`${t('No se pudo importar')}: ${(e as ApiError).message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const restore = async (b: BackupInfo) => {
    const ok = await confirmDialog({
      title: t('¿Restaurar la copia del {date}?', { date: fmtDateTime(b.createdAt) }),
      body: (
        <>
          <p>{t('La configuración actual se reemplazará (antes se guarda una copia).')}</p>
          {dirty && <p class="err-text">{t('Perderás los cambios sin guardar.')}</p>}
        </>
      ),
      confirm: t('Restaurar'),
      danger: true,
    });
    if (!ok) return;
    setBusy(`r-${b.id}`);
    try {
      const r = await api.restoreBackup(b.id);
      replaceConfig(r.config);
      if (r.repaired?.length) toast(t('Copia restaurada · se corrigieron {n} valores no válidos (ver Actividad)', { n: r.repaired.length }), 'info', 6000);
      else toast(t('Copia restaurada · las pantallas se actualizan solas'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };
  const remove = async (b: BackupInfo) => {
    if (!(await confirmDialog({ title: t('¿Eliminar esta copia?'), confirm: t('Eliminar'), danger: true }))) return;
    try {
      await api.deleteBackup(b.id);
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  const download = async (b: BackupInfo) => {
    setBusy(`d-${b.id}`);
    try {
      downloadJson(await api.backupFile(b.id), backupFileName(b));
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy('');
    }
  };

  // Every gallery photo in one .zip, built here in the browser (the photos are fetched one by one).
  const downloadPhotos = async () => {
    let list: AdminPhoto[];
    try {
      list = await api.photos();
    } catch (e) {
      return toast((e as ApiError).message, 'error');
    }
    if (!list.length) return toast(t('La galería está vacía'), 'info');
    const total = list.reduce((n, p) => n + (p.size || 0), 0);
    if (total > ZIP_MAX_BYTES) return toast(t('La galería es demasiado grande para un solo .zip'), 'error');
    setZipping({ done: 0, total: list.length });
    const names = uniqueNames(list.map((p) => p.file));
    const entries = [];
    let failed = 0;
    try {
      for (const [i, p] of list.entries()) {
        try {
          const r = await fetch(p.url, { credentials: 'same-origin' });
          if (!r.ok) throw new Error(String(r.status));
          entries.push({ name: names[i], data: new Uint8Array(await r.arrayBuffer()), date: p.uploadedAt ? new Date(p.uploadedAt) : undefined });
        } catch {
          failed++;
        }
        setZipping({ done: i + 1, total: list.length });
      }
      const blob = new Blob(zipParts(entries) as BlobPart[], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `marco-photos-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      if (failed) toast(t('Fotos descargadas · {n} no se pudieron leer', { n: failed }), 'info', 6000);
      else toast(t('Fotos descargadas'));
    } catch (e) {
      toast(`${t('No se pudieron descargar las fotos')}: ${(e as Error).message}`, 'error');
    } finally {
      setZipping(null);
    }
  };

  const diffList = (label: string, d: { added: string[]; removed: string[]; changed: string[] }) =>
    d.added.length + d.removed.length + d.changed.length > 0 && (
      <div class="diff-block">
        <strong class="small">{label}</strong>
        <div class="diff-chips">
          {d.added.map((x) => (
            <span class="diff diff--add">+ {x}</span>
          ))}
          {d.removed.map((x) => (
            <span class="diff diff--del">− {x}</span>
          ))}
          {d.changed.map((x) => (
            <span class="diff diff--chg">~ {x}</span>
          ))}
        </div>
      </div>
    );

  return (
    <>
      <PageHeader title={t('Copias de seguridad')} desc={t('Exporta toda la configuración a un archivo, impórtala en otra instalación o vuelve a una versión anterior.')} />

      {transferOn && (
        <Card title={t('Exportar')} icon="download" id="bk-export" desc={t('Pantallas, calendarios, cumpleaños, filtros, avisos programados… en un archivo JSON.')}>
          {secretsOn && (
            <label class="mini-toggle">
              <Toggle checked={secrets} onChange={setSecrets} />
              <span>{t('Incluir secretos (contraseña cifrada, token de Home Assistant, cuentas de Google, tokens de API)')}</span>
            </label>
          )}
          {secretsOn && secrets && <Callout kind="warn">{t('Con secretos, quien tenga el archivo podría acceder a tus calendarios de Google y a Home Assistant. Guárdalo en un lugar seguro.')}</Callout>}
          {hasPhotos && <p class="muted small">{t('El archivo incluye las fotos de perfil de los miembros de Familia.')}</p>}
          {!secretsOn && !isSelfHosted() && (
            <p class="muted small">
              {t('Sirve también para pasar a un Marco instalado en casa: impórtalo en su panel. No lleva enlaces privados, dispositivos vinculados, tokens de API ni cuentas de Google, así que después vincula de nuevo las pantallas y vuelve a conectar Google Calendar.')}{' '}
              {t('Contiene las direcciones de tus calendarios: guárdalo en un lugar seguro.')}
            </p>
          )}
          <div>
            <Button variant="primary" icon="download" loading={exporting} onClick={doExport}>
              {t('Descargar copia')}
            </Button>
          </div>
        </Card>
      )}

      {transferOn && (
        <Card title={t('Importar')} icon="upload" id="bk-import">
          <div
            class={`dropzone dropzone--sm ${drag ? 'is-drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer?.files?.[0];
              if (f) readFile(f);
            }}
          >
            <span class="dropzone__icon">{busy === 'preview' ? <span class="spinner" /> : <Icon name="upload" size={20} />}</span>
            <div>
              <strong>{fileName || t('Elige o arrastra un archivo .json')}</strong>
              <div class="muted small">{t('Copias exportadas desde aquí o un config.json (también del formato antiguo).')}</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) readFile(f);
                e.currentTarget.value = '';
              }}
            />
          </div>
          {preview && (
            <div class="import-prev">
              <div class="import-prev__head">
                {preview.ok ? (
                  <span class="ok-text">
                    <Icon name="check" size={15} /> {t('Archivo válido')}
                  </span>
                ) : (
                  <span class="err-text">
                    <Icon name="alert" size={15} /> {t('{n} errores de validación', { n: preview.errors.length })}
                  </span>
                )}
                <span class="muted small">
                  {preview.fromVersion === 1 ? t('formato antiguo (v1), se migrará') : 'v2'}
                  {preview.appVersion && ` · app ${preview.appVersion}`}
                  {preview.exportedAt && ` · ${t('exportada {when}', { when: fmtDateTime(preview.exportedAt) })}`}
                </span>
              </div>
              {!preview.ok && (
                <ul class="import-prev__errs">
                  {preview.errors.slice(0, 8).map((e) => (
                    <li>
                      <code>{e.path}</code> {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {preview.ok && (
                <>
                  <div class="import-sections">
                    {preview.sections.map((s) => {
                      const on = sections.includes(s.key);
                      const over = (preview.overLimit ?? []).find((o) => o.section === s.key);
                      return (
                        <label class={`import-sec ${s.changed ? '' : 'is-same'} ${on ? 'is-on' : ''} ${over ? 'is-same' : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!!over}
                            onChange={() => setSections(on ? sections.filter((x) => x !== s.key) : [...sections, s.key])}
                          />
                          <span class="check-box">
                            <Icon name="check" size={12} />
                          </span>
                          <span class="import-sec__name">{sectionLabel(s.key)}</span>
                          <span class={`import-sec__sum small ${over ? 'err-text' : 'muted'}`}>
                            {over ? t('Supera el límite de tu plan ({max}): no se puede importar', { max: over.max }) : s.summary}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {diffList(t('Pantallas'), preview.screens)}
                  {diffList(t('Calendarios'), preview.sources)}
                  <div class="muted small">
                    {t('Contiene')}: {t('{n} eventos locales', { n: preview.counts.localEvents })} · {t('{n} cumpleaños', { n: preview.counts.birthdays })} · {t('{n} reglas', { n: preview.counts.eventRules })} · {t('{n} cuentas atrás', { n: preview.counts.countdowns })} · {t('{n} mensajes programados', { n: preview.counts.schedules })}
                  </div>
                  {preview.notes && preview.notes.length > 0 && (
                    <Callout kind="info">
                      <strong>{t('Lo que no se importa aquí')}</strong>
                      <ul class="import-prev__notes">
                        {preview.notes.map((n) => (
                          <li>{importNoteText(n)}</li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                  {(() => {
                    const o = preview.orphanSchedules;
                    const list = sections.includes('screens') && !sections.includes('schedules') ? o?.screensOnly
                      : sections.includes('schedules') && !sections.includes('screens') ? o?.schedulesOnly : null;
                    return list?.length ? (
                      <p class="err-text small">
                        {t('Estos mensajes programados se quedarán sin pantallas y se desactivarán: {list}. Importa también «Pantallas» y «Mensajes programados» juntos para conservarlos.', { list: list.join(', ') })}
                      </p>
                    ) : null;
                  })()}
                  {secretsOn && preview.hasSecrets && (
                    <label class="mini-toggle">
                      <Toggle checked={impSecrets} onChange={setImpSecrets} />
                      <span>{t('Importar también los secretos que trae la copia')}</span>
                    </label>
                  )}
                  {secretsOn && preview.hasSecrets && impSecrets && preview.secretsImpact && (preview.secretsImpact.linksChanged.length > 0 || preview.secretsImpact.devicesRemoved.length > 0) && (
                    <Callout kind="warn">
                      {preview.secretsImpact.linksChanged.length > 0 && (
                        <p>{t('Cambiará el enlace privado de: {list}. Las pantallas abiertas con el enlace actual se desconectan; vuelve a funcionar el de la copia.', { list: preview.secretsImpact.linksChanged.join(', ') })}</p>
                      )}
                      {preview.secretsImpact.devicesRemoved.length > 0 && (
                        <p>{t('Se quitarán estos dispositivos vinculados (se desconectan al instante): {list}.', { list: preview.secretsImpact.devicesRemoved.join(', ') })}</p>
                      )}
                    </Callout>
                  )}
                  {preview.displayAccess && (
                    <p class="muted small">
                      {t('El acceso a las pantallas ({mode}) no cambia al importar ni al restaurar: se cambia en Seguridad.', {
                        mode: preview.displayAccess === 'open' ? t('Abierto (red local)') : t('Privado'),
                      })}
                    </p>
                  )}
                  <div class="btn-row">
                    <Button variant="ghost" onClick={() => (setPreview(null), setBundle(null), setFileName(''))}>
                      {t('Cancelar')}
                    </Button>
                    <Button variant="primary" icon="upload" loading={busy === 'apply'} disabled={!sections.length} onClick={apply}>
                      {t('Importar {n} secciones', { n: sections.length })}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {transferOn && has('gallery') && (
        <Card title={t('Fotos')} icon="photos" id="bk-photos" desc={t('Las fotos de la galería no van en la copia de la configuración. Descárgalas todas en un .zip para guardarlas o subirlas en otra instalación.')}>
          <div>
            <Button icon="download" loading={!!zipping} onClick={downloadPhotos}>
              {zipping ? t('Descargando {done} de {total}…', zipping) : t('Descargar fotos (.zip)')}
            </Button>
          </div>
        </Card>
      )}

      {backupsOn && (
        <Card
          title={t('Copias automáticas')}
          icon="archive"
          id="bk-auto"
          desc={t('Se crea una copia cada vez que guardas (se conservan las 20 últimas).')}
          actions={
            <Button size="sm" icon="plus" loading={creating} onClick={createNow}>
              {t('Crear copia ahora')}
            </Button>
          }
        >
          {listErr && <Callout kind="error">{listErr}</Callout>}
          {list === null ? (
            <div class="skeleton-list">
              <div class="skeleton" />
              <div class="skeleton" />
            </div>
          ) : list.length === 0 ? (
            <Empty icon="archive" title={t('Todavía no hay copias')}>
              {t('Aparecerán aquí cuando guardes cambios.')}
            </Empty>
          ) : (
            <ul class="bk-list">
              {list.map((b, i) => (
                <li class="bk">
                  <span class={`bk__icon bk__icon--${b.reason}`}>
                    <Icon name={b.reason === 'manual' ? 'star' : b.reason === 'save' ? 'check' : b.reason === 'migration' ? 'wand' : 'history'} size={14} />
                  </span>
                  <div class="bk__main">
                    <strong>
                      {fmtDateTime(b.createdAt)} <span class="muted small">· {relTime(b.createdAt)}</span>
                      {i === 0 && <span class="badge badge--soft">{t('la más reciente')}</span>}
                    </strong>
                    <span class="muted small">
                      {t(REASON[b.reason] ?? b.reason)} · {t('revisión {n}', { n: b.revision })} · {nScreens(b.screens)} · {t('{n} calendarios', { n: b.sources })} · {formatBytes(b.size)}
                    </span>
                  </div>
                  <div class="bk__actions">
                    <button type="button" class="icon-btn" title={t('Descargar')} disabled={busy === `d-${b.id}`} onClick={() => download(b)}>
                      <Icon name="download" size={15} />
                    </button>
                    <Button size="sm" variant="ghost" icon="history" loading={busy === `r-${b.id}`} onClick={() => restore(b)}>
                      {t('Restaurar')}
                    </Button>
                    {b.reason !== 'migration' && (
                      <button type="button" class="icon-btn icon-btn--danger" title={t('Eliminar')} onClick={() => remove(b)}>
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
