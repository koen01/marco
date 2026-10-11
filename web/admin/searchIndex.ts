// Static index of individual settings for the command palette (Ctrl/Cmd+K).
// label = Spanish source string (translated with t()), keywords = extra words in es/en/pt, anchor = element id.
// feature = hidden when the server turns it off (navFilter.ts); the page's own feature applies too.
// unless = hidden when the server turns this feature on (the setting lives on another page there).
import type { FeatureName } from '../shared/types';

export interface SettingEntry {
  label: string;
  route: string;
  anchor?: string;
  keywords?: string;
  feature?: FeatureName | readonly FeatureName[];
  unless?: FeatureName;
}

export const SETTINGS_INDEX: SettingEntry[] = [
  // Pantalla
  { label: 'Cristal (estilo moderno)', route: 'layout', anchor: 'layout-glass', keywords: 'glass cristal vidro liquid transparente transparency transparência opacidad opacity blur desenfoque desfoque tint tono tom edge borde contorno iphone ios apple modern moderno' },
  { label: 'Estilo clásico / moderno', route: 'layout', anchor: 'layout-style', keywords: 'style estilo look aspecto moderno modern classic clásico clássico apple glass cristal vidro minimal' },
  { label: 'Plantilla de diseño', route: 'layout', anchor: 'layout-presets', keywords: 'layout preset agenda calendario grande reloj grande template' },
  { label: 'Plantillas: hoy, por persona, dos semanas, tablero, marco de fotos, mesilla', route: 'layout', anchor: 'layout-presets', keywords: 'today hoy hoje timeline per person por persona pessoa columns columnas board tablero quadro tasks tareas photo frame marco moldura bedside mesilla dormitorio bedroom quarto two weeks dos semanas duas semanas corner esquina' },
  { label: 'Panel lateral (izquierda/derecha, anchura)', route: 'layout', anchor: 'layout-side', keywords: 'side panel width columna lateral largura' },
  { label: 'Fotos de fondo', route: 'background', anchor: 'bg-photos', keywords: 'background wallpaper fondo stock galería intervalo brillo fotos orden aleatorio order random shuffle newest name' },
  { label: 'Efecto ambiental (aurora, partículas)', route: 'background', anchor: 'bg-ambient', keywords: 'ambient aurora particles three webgl animación' },
  { label: 'Efecto del tiempo (lluvia, nieve, sol)', route: 'background', anchor: 'bg-weather', keywords: 'weather effect rain snow sun drops lluvia nieve sol gotas webgl' },
  { label: 'Nombre de la pantalla', route: 'screen', anchor: 'scr-general', keywords: 'name nombre nome' },
  { label: 'Idioma de la pantalla', route: 'screen', anchor: 'scr-general', keywords: 'language idioma lingua español english português' },
  { label: 'Orientación (horizontal / vertical)', route: 'screen', anchor: 'scr-general', keywords: 'orientation portrait landscape vertical rotar' },
  { label: 'Tamaño de letra', route: 'screen', anchor: 'scr-general', keywords: 'font size escala texto grande' },
  { label: 'Tema claro / oscuro', route: 'screen', anchor: 'scr-look', keywords: 'theme dark light tema' },
  { label: 'Color de acento', route: 'screen', anchor: 'scr-look', keywords: 'accent color cor' },
  { label: 'Modo noche (horario y brillo)', route: 'screen', anchor: 'scr-night', keywords: 'night dim noche noturno brillo atenuar' },
  { label: 'CSS personalizado', route: 'screen', anchor: 'scr-css', keywords: 'custom css estilos avanzado', feature: 'customCss' },
  { label: 'Enlace privado', route: 'screen', anchor: 'scr-link', keywords: 'private link url qr kiosk raspberry enlace privado ligação privada key clave' },
  { label: 'Reloj (digital / analógico, segundos, 24 h)', route: 'datetime', anchor: 'dt-clock', keywords: 'clock seconds segundos 12h 24h ampm reloj' },
  { label: 'Zona horaria', route: 'datetime', anchor: 'dt-clock', keywords: 'timezone fuso horario lisboa madrid' },
  { label: 'Formato de fecha', route: 'datetime', anchor: 'dt-format', keywords: 'date format fecha data' },
  // Contenido
  { label: 'Añadir calendario iCal (URL .ics)', route: 'calendars', anchor: 'cal-sources', keywords: 'ics ical url airbnb booking icloud outlook fuente source' },
  { label: 'Cuentas de Google Calendar', route: 'calendars', anchor: 'cal-accounts', keywords: 'google account cuenta oauth vincular cuentas vinculadas', feature: 'googleCalendar' },
  { label: 'Cuentas de Microsoft', route: 'calendars', anchor: 'cal-accounts', keywords: 'microsoft outlook hotmail office 365 account cuenta oauth vincular', feature: 'microsoftCalendar' },
  { label: 'Calendarios visibles en esta pantalla', route: 'calendars', anchor: 'cal-screen-sources', keywords: 'sources filter screen mostrar ocultar fuentes por pantalla' },
  { label: 'Vista del calendario (mes, semana, agenda)', route: 'calendars', anchor: 'cal-view', keywords: 'view month week agenda semanas weeks start lunes marquee desplazar slide rotar rotate textos largos long titles compacto compact días llenos busy days empezar hoy start today começar hoje días pasados past days tamaño entradas entry size tamanho letra font densidad density' },
  { label: 'Eventos máximos por día', route: 'calendars', anchor: 'cal-view', keywords: 'max events per day más' },
  { label: 'Eventos locales', route: 'local', anchor: 'local-list', keywords: 'local events eventos familia recurrente repetir crear evento' },
  { label: 'Cumpleaños', route: 'birthdays', anchor: 'bday-list', keywords: 'birthday aniversário cumple edad age' },
  { label: 'Importar cumpleaños (CSV)', route: 'birthdays', anchor: 'bday-list', keywords: 'csv import pegar paste' },
  { label: 'Mostrar la edad en los cumpleaños', route: 'birthdays', anchor: 'bday-settings', keywords: 'age edad idade show' },
  { label: 'Ocultar eventos por palabra clave', route: 'filters', anchor: 'flt-rules', keywords: 'hide filter ocultar no disponible blocked' },
  { label: 'Renombrar eventos', route: 'filters', anchor: 'flt-rules', keywords: 'rename replace cambiar título' },
  { label: 'Forzar emoji o color de una serie', route: 'filters', anchor: 'flt-rules', keywords: 'style emoji color override' },
  { label: 'Vista previa de los próximos 14 días', route: 'filters', anchor: 'flt-preview', keywords: 'preview próximos eventos' },
  { label: 'Iconos automáticos (emoji por palabra clave)', route: 'icons', anchor: 'ico-rules', keywords: 'icon rules emoji keyword' },
  { label: 'Cuentas atrás', route: 'countdowns', anchor: 'cd-list', keywords: 'countdown faltan días navidad viaje contagem' },
  { label: 'Cuentas atrás automáticas (cumpleaños, eventos marcados)', route: 'countdowns', anchor: 'cd-auto', keywords: 'auto include birthdays flagged' },
  { label: 'Ubicación del tiempo', route: 'weather', anchor: 'wx-main', keywords: 'weather location city ciudad lat lon open-meteo' },
  { label: 'Fuente de los datos del tiempo', route: 'weather', anchor: 'wx-source', keywords: 'weather source provider data open-meteo met norway yr pirate weather model ecmwf icon gfs api key fuente modelo clave licencia' },
  { label: 'Previsión por horas y días', route: 'weather', anchor: 'wx-main', keywords: 'forecast hourly days previsión' },
  { label: 'Sensores de Home Assistant para el tiempo', route: 'weather', anchor: 'wx-ha', keywords: 'indoor temperatura humedad sensor', feature: 'homeassistant' },
  { label: 'Fuentes de noticias (RSS)', route: 'news', anchor: 'news-feeds', keywords: 'rss feed news noticias titulares' },
  { label: 'Lista de tareas', route: 'todo', keywords: 'todo tasks tareas pendientes' },
  { label: 'Mensaje personalizado', route: 'message', keywords: 'message mensaje bienvenida' },
  // Avisos
  { label: 'Enviar un aviso ahora', route: 'alerts', anchor: 'al-send', keywords: 'announce alert send aviso notificación anuncio', feature: 'announcements' },
  { label: 'Avisos activos', route: 'alerts', anchor: 'al-active', keywords: 'active alerts quitar', feature: 'announcements' },
  { label: 'Mensajes programados (basura, recordatorios)', route: 'alerts', anchor: 'al-sched', keywords: 'scheduled recurring basura lixo recordatorio', feature: 'schedules' },
  { label: 'Sonido y volumen de los avisos', route: 'alerts', anchor: 'al-screen', keywords: 'sound chime volumen volume' },
  // Integraciones
  { label: 'Galería de fotos', route: 'photos', keywords: 'photos upload subir galería' },
  { label: 'Conexión con Home Assistant', route: 'homeassistant', anchor: 'ha-conn', keywords: 'home assistant token url' },
  { label: 'Timbre y cámara', route: 'homeassistant', anchor: 'ha-doorbell', keywords: 'doorbell timbre campainha camera cámara puerta door', feature: 'doorbell' },
  // servers without a live camera (Marco Cloud) have no Home Assistant page: the card is in API & webhooks
  { label: 'Timbre', route: 'api', anchor: 'api-doorbell', keywords: 'doorbell timbre campainha camera cámara puerta door foto snapshot', feature: 'doorbell', unless: 'doorbellLive' },
  { label: 'Tokens de API', route: 'api', anchor: 'api-tokens', keywords: 'token api bearer webhook', feature: 'apiTokens' },
  { label: 'Ejemplo de Home Assistant (rest_command)', route: 'api', anchor: 'api-examples', keywords: 'yaml rest_command automation curl', feature: 'webhooks' },
  // Sistema
  { label: 'Pantallas (crear, duplicar, predeterminada)', route: 'screens', anchor: 'scr-list', keywords: 'screens profiles salón cocina slug' },
  { label: 'Modo privado (invitados)', route: 'screen', anchor: 'scr-privacy', keywords: 'privacy private guests busy ocupado invitados convidados privado lock candado horario schedule', feature: 'privacy' },
  { label: 'Pantallas conectadas', route: 'displays', keywords: 'displays connected kiosk raspberry ip resolución' },
  { label: 'Dispositivos vinculados', route: 'displays', anchor: 'disp-paired', keywords: 'paired devices pair code revoke revocar vincular emparelhar' },
  { label: 'Acceso a las pantallas', route: 'security', anchor: 'sec-display', keywords: 'display access private open privado abierto aberto key clave enlace', feature: 'openDisplayAccess' },
  { label: 'Exportar configuración', route: 'backups', anchor: 'bk-export', keywords: 'export backup descargar json', feature: 'importExport' },
  { label: 'Importar configuración', route: 'backups', anchor: 'bk-import', keywords: 'import restore subir json', feature: 'importExport' },
  { label: 'Copias automáticas', route: 'backups', anchor: 'bk-auto', keywords: 'backups automatic restore restaurar versiones', feature: 'backups' },
  { label: 'Descargar fotos (.zip)', route: 'backups', anchor: 'bk-photos', keywords: 'photos gallery zip download export fotos galería descargar transferir', feature: ['importExport', 'gallery'] },
  { label: 'Registro de actividad', route: 'activity', keywords: 'activity log logins registro' },
  { label: 'Cambiar contraseña', route: 'security', anchor: 'sec-password', keywords: 'password contraseña palavra-passe', feature: 'passwordLogin' },
  { label: 'Emails de Google permitidos', route: 'security', anchor: 'sec-google', keywords: 'google login email permitir', feature: 'googleLogin' },
  { label: 'Cerrar sesión en todos los dispositivos', route: 'security', anchor: 'sec-sessions', keywords: 'logout sessions', feature: ['passwordLogin', 'googleLogin'] },
  { label: 'Nombre del hogar', route: 'security', anchor: 'acc-household', keywords: 'household hogar casa nombre name rename renombrar', feature: 'accountMenu' },
  { label: 'Sesiones abiertas', route: 'security', anchor: 'acc-links', keywords: 'sessions sesiones sessões logout dispositivos devices', feature: 'accountMenu' },
  { label: 'Estado de las fuentes', route: 'status', keywords: 'status health salud errores' },
  { label: 'Actualizaciones', route: 'status', anchor: 'updates', keywords: 'update updates actualizar actualización atualizar atualização version versión versão upgrade nueva new nova automático automatic', feature: 'updates' },
];
