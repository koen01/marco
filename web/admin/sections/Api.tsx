import { useEffect, useState } from 'preact/hooks';
import type { ApiTokenCreated, ApiTokenInfo, TokenScope } from '../../shared/types';
import { api, ApiError } from '../api';
import { confirmDialog, toast } from '../components/feedback';
import { Icon } from '../components/icons';
import { canCopy } from '../components/share';
import { Button, Callout, Card, Empty, Field, Modal, PageHeader, Segmented, TextInput, ToggleRow } from '../components/ui';
import { fmtDateTime } from '../dates';
import { atLimit, has, limit, runtime } from '../caps';
import { LimitNote } from '../components/LimitNote';
import { relTime, t } from '../i18n';
import { takeIntent } from '../intent';
import type { SectionProps } from './common';
import { DoorbellCard } from './HomeAssistant';
import { ValuesHelper } from './ApiValues';

/** True for hosts that are only reachable on the local network (private IPs, localhost, .local/.lan). */
export function isLanHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home.arpa') || h.endsWith('.internal')) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return !h.includes('.') && !h.includes(':'); // single-label LAN names ("raspberrypi")
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('Copiado'), 'ok', 1500);
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <div class="codeblock">
      <div class="codeblock__bar">
        <span class="mono small muted">{lang}</span>
        {canCopy() && (
          <button type="button" class="btn btn--ghost btn--sm" onClick={() => copyText(code)}>
            <Icon name="copy" size={14} />
            <span>{t('Copiar')}</span>
          </button>
        )}
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** What a token may do, as the admin reads it (Spanish t() keys), only the ones this server has. */
function scopeList(): { id: Exclude<TokenScope, '*' | 'screen'>; label: string; hint: string }[] {
  const out: { id: Exclude<TokenScope, '*' | 'screen'>; label: string; hint: string }[] = [
    { id: 'announce', label: 'Avisos', hint: 'POST /api/hooks/announce' },
    { id: 'commands', label: 'Recargar y modo noche', hint: 'POST /api/hooks/reload, /night' },
  ];
  if (has('privacy')) out.push({ id: 'privacy', label: 'Modo privado', hint: 'GET, POST /api/hooks/privacy' });
  if (has('doorbell')) out.push({ id: 'doorbell', label: 'Timbre', hint: 'POST /api/hooks/doorbell' });
  if (has('valueHooks')) out.push({ id: 'values', label: 'Valores', hint: '/api/hooks/values' });
  return out;
}

/** "Todo" (the default) or some of the scopes. */
function ScopePicker({ value, onChange }: { value: TokenScope[]; onChange: (v: TokenScope[]) => void }) {
  const all = value.includes('*');
  const list = scopeList();
  return (
    <div class="stack api-scopes">
      <ToggleRow label={t('Todo')} hint={t('Todo lo que permite la API, también lo que se añada más adelante.')} checked={all} onChange={(on) => onChange(on ? ['*'] : list.map((x) => x.id))} />
      {!all &&
        list.map((x) => (
          <ToggleRow
            label={t(x.label)}
            hint={<code class="mono small">{x.hint}</code>}
            checked={value.includes(x.id)}
            onChange={(on) => onChange(on ? [...value, x.id] : value.filter((y) => y !== x.id))}
          />
        ))}
      {!all && !value.length && <p class="small err-text">{t('Elige al menos una cosa.')}</p>}
    </div>
  );
}

/** The names of a token's scopes, for the list. */
const scopeNames = (sc: TokenScope[] | undefined) =>
  !sc || sc.includes('*') ? t('Todo') : !sc.length ? t('Ninguna') : sc.map((x) => t(scopeList().find((y) => y.id === x)?.label ?? x)).join(', ');

function ScopesDialog({ token, onClose, onSaved }: { token: ApiTokenInfo; onClose: () => void; onSaved: () => void }) {
  const [scopes, setScopes] = useState<TokenScope[]>(token.scopes ?? ['*']);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.setTokenScopes(token.id, scopes);
      toast(t('Permisos guardados'));
      onSaved();
      onClose();
    } catch (err) {
      toast((err as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('Qué puede hacer “{name}”', { name: token.name })}
      icon="key"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" icon="check" loading={busy} disabled={!scopes.length} onClick={save}>
            {t('Guardar')}
          </Button>
        </>
      }
    >
      <ScopePicker value={scopes} onChange={setScopes} />
    </Modal>
  );
}

function NewTokenDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (c: ApiTokenCreated) => void }) {
  const [name, setName] = useState('Home Assistant');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [scopes, setScopes] = useState<TokenScope[]>(['*']);
  const scoped = has('tokenScopes');
  const create = async (e?: Event) => {
    e?.preventDefault();
    if (!name.trim() || (scoped && !scopes.length)) return;
    setBusy(true);
    try {
      const c = await api.createToken(name.trim(), scoped && !scopes.includes('*') ? scopes : undefined);
      setCreated(c);
      onCreated(c);
    } catch (err) {
      const ae = err as ApiError;
      toast(ae.status === 409 ? t('Has llegado al máximo de 20 tokens. Revoca alguno.') : ae.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={created ? t('Token creado') : t('Nuevo token de API')}
      icon="key"
      onClose={onClose}
      size="sm"
      footer={
        created ? (
          <Button variant="primary" icon="check" onClick={onClose}>
            {t('Ya lo he copiado')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancelar')}
            </Button>
            <Button variant="primary" icon="key" loading={busy} disabled={!name.trim() || (scoped && !scopes.length)} onClick={create}>
              {t('Crear token')}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div class="stack">
          <Callout kind="warn">{t('Cópialo ahora: por seguridad no se volverá a mostrar.')}</Callout>
          <div class="token-reveal">
            <code>{created.token}</code>
            {canCopy() && (
              <button type="button" class="btn btn--primary btn--sm" onClick={() => copyText(created.token)}>
                <Icon name="copy" size={14} />
                <span>{t('Copiar')}</span>
              </button>
            )}
          </div>
          <p class="muted small">{t('Úsalo en la cabecera Authorization: Bearer <token>. Los ejemplos de abajo ya lo incluyen mientras esta página esté abierta.')}</p>
        </div>
      ) : (
        <form class="stack" onSubmit={create}>
          <Field label={t('Nombre')} hint={t('Para reconocerlo en la lista y en el registro de actividad.')}>
            <TextInput value={name} onValue={setName} maxLength={60} placeholder="Home Assistant" />
          </Field>
          {scoped && (
            <Field label={t('Qué puede hacer')}>
              <ScopePicker value={scopes} onChange={setScopes} />
            </Field>
          )}
        </form>
      )}
    </Modal>
  );
}

export function ApiSection(props: SectionProps) {
  const { full } = props;
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(() => takeIntent('api', 'new'));
  const [fresh, setFresh] = useState<string>('');
  const [ex, setEx] = useState<'ha' | 'curl'>('ha');
  const [editing, setEditing] = useState<ApiTokenInfo | null>(null);
  const scoped = has('tokenScopes');

  const load = async () => {
    try {
      setTokens(await api.tokens());
      setErr('');
    } catch (e) {
      setErr((e as ApiError).message);
      setTokens([]);
    }
  };
  const tokensOn = has('apiTokens');
  const hooksOn = has('webhooks');
  const valuesOn = hooksOn && has('valueHooks');
  useEffect(() => {
    if (tokensOn) load();
  }, []);
  const tokensFull = atLimit('apiTokens', tokens?.length ?? 0);

  const revoke = async (tk: ApiTokenInfo) => {
    const ok = await confirmDialog({
      title: t('Revocar “{name}”', { name: tk.name }),
      body: t('Las automatizaciones que lo usen dejarán de funcionar inmediatamente.'),
      confirm: t('Revocar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeToken(tk.id);
      toast(t('Token revocado'));
      load();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    }
  };

  // Caddy (deploy/Caddyfile.example) blocks /api/hooks/* from outside the LAN, and Home Assistant should
  // call the Pi directly: when the panel is opened through a public domain, show a LAN placeholder instead.
  // On Workers (Marco Cloud) the hooks live on the panel's own public origin.
  const workers = runtime() === 'workers';
  const lanPanel = workers || isLanHost(location.hostname);
  const base = lanPanel ? location.origin : `http://${t('<ip-de-la-pi>')}:3000`;
  const token = fresh || 'cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const slugs = full.screens.map((s) => s.slug);
  const washer = t('La lavadora ha terminado');
  const priv = has('privacy');
  // servers without a live camera (Marco Cloud): the ring carries a snapshot, and the doorbell card lives here
  const snapshotBell = hooksOn && has('doorbell') && !has('doorbellLive');
  const yaml = `# ${t('configuration.yaml de Home Assistant')}
rest_command:
  marco_alert:
    url: "${base}/api/hooks/announce"
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: >-
      {"title": {{ title | tojson }}, "body": {{ (body | default('')) | tojson }},
       "emoji": {{ (emoji | default('🔔')) | tojson }}, "style": "{{ style | default('info') }}",
       "durationSec": {{ duration | default(120) }}, "sound": true}${priv ? `
  marco_privacy:
    url: "${base}/api/hooks/privacy"
    method: POST
    headers:
      Authorization: "Bearer ${token}"
    content_type: "application/json"
    payload: '{"mode": "{{ mode }}"}'` : ''}

automation:
  - alias: "${t('Aviso: lavadora terminada')}"
    triggers:
      - trigger: state
        entity_id: sensor.washing_machine_status
        to: "finished"
    actions:
      - action: rest_command.marco_alert
        data:
          title: "${washer} 🧺"
          emoji: "🧺"
          style: "success"
          duration: 300${priv ? `
  - alias: "${t('Modo privado con invitados')}"
    triggers:
      - trigger: state
        entity_id: input_boolean.guests
    actions:
      - action: rest_command.marco_privacy
        data:
          mode: "{{ 'on' if trigger.to_state.state == 'on' else 'off' }}"` : ''}`;
  const curl = `# ${t('Comprobar el token')}
curl -H "Authorization: Bearer ${token}" ${base}/api/hooks/ping

# ${slugs.length > 1 ? t('Aviso en la pantalla «{slug}»', { slug: slugs[0] }) : t('Aviso en todas las pantallas')}
curl -X POST ${base}/api/hooks/announce \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":${JSON.stringify(washer).replace(/'/g, "'\\''")},"emoji":"🧺","style":"success","durationSec":300,"sound":true${slugs.length > 1 ? `,"screens":["${slugs[0]}"]` : ''}}'

# ${t('Recargar todas las pantallas')}
curl -X POST ${base}/api/hooks/reload \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{}'

# ${t('Modo noche')}: on | off | auto
curl -X POST ${base}/api/hooks/night \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"mode":"on"}'${priv ? `

# ${t('Modo privado 3 horas')}: on | off | toggle
curl -X POST ${base}/api/hooks/privacy \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"mode":"on","hours":3}'` : ''}${valuesOn ? `

# ${t('Valores para las tarjetas Valor')}
curl -X POST ${base}/api/hooks/values \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"values":[{"key":"solar.today","value":12.6,"unit":"kWh"},{"key":"washer","value":"${t('Terminado').replace(/'/g, '')}"}]}'` : ''}${snapshotBell ? `

# ${t('Timbre con la foto de la cámara')} (JPEG, PNG, WebP; 2 MB)
curl -X POST ${base}/api/hooks/doorbell \\
  -H "Authorization: Bearer ${token}" \\
  -F image=@doorbell.jpg -F action=ring -F seconds=60

# ${t('Quitar el timbre de las pantallas')}
curl -X POST ${base}/api/hooks/doorbell \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"action":"dismiss"}'` : ''}`;
  // Home Assistant takes a snapshot of the camera and sends it with the ring; the file is removed right after, since
  // Home Assistant serves www/ at /local/ without a sign in.
  const bellYaml = `# ${t('configuration.yaml de Home Assistant')}
shell_command:
  marco_doorbell: >-
    curl -s -X POST -H "Authorization: Bearer ${token}"
    -F image=@/config/www/doorbell.jpg -F action=ring -F seconds=60
    ${base}/api/hooks/doorbell
  marco_doorbell_clean: rm -f /config/www/doorbell.jpg

automation:
  - alias: "${t('Timbre en las pantallas de Marco')}"
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_door_doorbell
        to: "on"
    actions:
      - action: camera.snapshot
        target:
          entity_id: camera.front_door
        data:
          filename: /config/www/doorbell.jpg
      - action: shell_command.marco_doorbell
      - action: shell_command.marco_doorbell_clean
    mode: single`;

  return (
    <>
      <PageHeader title={t('API y webhooks')} desc={t('Permite que Home Assistant u otros sistemas envíen avisos, recarguen las pantallas o activen el modo noche.')}>
        {tokensOn && (
          <Button variant="primary" icon="plus" disabled={tokensFull} onClick={() => setCreating(true)}>
            {t('Nuevo token')}
          </Button>
        )}
      </PageHeader>

      {tokensOn && (
        <Card title={t('Tokens de API')} icon="key" id="api-tokens" desc={t('Se guardan cifrados (hash): solo se ven una vez al crearlos.')}>
          {err && <Callout kind="error">{err}</Callout>}
          <LimitNote name="apiTokens" count={tokens?.length ?? 0} />
          {tokens === null ? (
            <div class="skeleton-list">
              <div class="skeleton" />
            </div>
          ) : tokens.length === 0 ? (
            <Empty icon="key" title={t('Ningún token todavía')}>
              {t('Crea uno para Home Assistant y pégalo en el ejemplo de abajo.')}
            </Empty>
          ) : (
            <div class="table-wrap">
              <table class="table tokens">
                <thead>
                  <tr>
                    <th>{t('Nombre')}</th>
                    <th>{t('Token')}</th>
                    <th>{t('Creado')}</th>
                    <th>{t('Último uso')}</th>
                    {scoped && <th>{t('Permisos')}</th>}
                    <th class="num">{t('Usos')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((tk) => (
                    <tr>
                      <td>
                        <strong>{tk.name}</strong>
                      </td>
                      <td>
                        <code class="mono small">{tk.prefix}…</code>
                      </td>
                      <td class="muted" title={tk.createdAt}>
                        {fmtDateTime(tk.createdAt)}
                      </td>
                      <td class="muted" title={tk.lastUsedAt ?? ''}>
                        {tk.lastUsedAt ? (
                          <>
                            {relTime(tk.lastUsedAt)}
                            {tk.lastUsedIp && <span class="small"> · {tk.lastUsedIp}</span>}
                          </>
                        ) : (
                          t('Nunca')
                        )}
                      </td>
                      {scoped && (
                        <td>
                          <button type="button" class="link-btn" title={t('Cambiar lo que puede hacer')} onClick={() => setEditing(tk)}>
                            {scopeNames(tk.scopes)}
                          </button>
                        </td>
                      )}
                      <td class="num">{tk.useCount}</td>
                      <td class="num">
                        <Button size="sm" variant="ghost" icon="trash" onClick={() => revoke(tk)}>
                          {t('Revocar')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {hooksOn && (
        <Card title={t('Ejemplos')} icon="code" id="api-examples" actions={<Segmented size="sm" value={ex} options={[{ value: 'ha', label: 'Home Assistant' }, { value: 'curl', label: 'curl' }]} onChange={setEx} />}>
          {!fresh && <p class="muted small">{t('Sustituye cs_XXXX… por tu token (o crea uno nuevo y se rellenará solo).')}</p>}
          {!workers && !lanPanel && (
            <Callout kind="info">
              {t('Estás usando el panel desde fuera de la red local. Home Assistant debe llamar a la Pi directamente por la red local (por ejemplo http://192.168.1.50:3000): desde Internet /api/hooks está bloqueado. Sustituye <ip-de-la-pi> por su IP.')}
            </Callout>
          )}
          {ex === 'ha' ? <CodeBlock lang="yaml" code={yaml} /> : <CodeBlock lang="bash" code={curl} />}
          <div class="api-ref">
            <h4>{t('Endpoints')}</h4>
            <ul>
              <li>
                <code>GET /api/hooks/ping</code>: {t('comprueba el token')}
              </li>
              <li>
                <code>POST /api/hooks/announce</code>: <code>{'{ title, body, emoji, style: info|success|warning|urgent, durationSec, sound, screens: [slug] }'}</code>
              </li>
              <li>
                <code>POST /api/hooks/reload</code>: <code>{'{ screens?: [slug] }'}</code>
              </li>
              <li>
                <code>POST /api/hooks/night</code>: <code>{'{ mode: on|off|auto, screens?: [slug] }'}</code>
              </li>
              {has('privacy') && (
                <li>
                  <code>POST /api/hooks/privacy</code>: <code>{'{ mode: on|off|toggle, hours?, until?, untilTime?: "HH:MM", screens?: [slug] }'}</code> · <code>GET /api/hooks/privacy</code>
                </li>
              )}
              {has('doorbell') && (
                <li>
                  <code>POST /api/hooks/doorbell</code>:{' '}
                  {snapshotBell ? (
                    <>
                      <code>{'{ action: ring|dismiss, seconds?: 10..300, screens?: [slug], sound? }'}</code> · {t('la foto como campo image (multipart) o como cuerpo image/jpeg con los campos en la URL')}
                    </>
                  ) : (
                    <code>{'{ action: ring|dismiss, seconds?: 10..300, screens?: [slug], camera?: camera.x }'}</code>
                  )}
                </li>
              )}
              {valuesOn && (
                <li>
                  <code>POST /api/hooks/values</code>: <code>{'{ values: [{ key, value: number|string|true|false, unit?, label? }] }'}</code> · <code>GET /api/hooks/values</code> · <code>DELETE /api/hooks/values/:key</code>
                </li>
              )}
            </ul>
            <p class="muted small">
              {t('Pantallas disponibles')}: {slugs.map((s) => <code class="slug-code">{s}</code>)} · {t('Límite: 30 peticiones por minuto y token.')}
              {limit('hookCommandsPerDay') != null && <> {t('Como mucho {n} avisos y órdenes al día entre todos los tokens.', { n: limit('hookCommandsPerDay') ?? 0 })}</>}
            </p>
          </div>
        </Card>
      )}

      {valuesOn && <ValuesHelper full={full} base={base} token={token} code={(y) => <CodeBlock lang="yaml" code={y} />} />}

      {snapshotBell && <DoorbellCard {...props} snapshot example={<CodeBlock lang="yaml" code={bellYaml} />} />}

      {editing && <ScopesDialog token={editing} onClose={() => setEditing(null)} onSaved={load} />}

      {creating && tokensOn && (
        <NewTokenDialog
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setFresh(c.token);
            load();
          }}
        />
      )}
    </>
  );
}
