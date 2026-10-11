<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-lockup-dark.svg">
  <img src="docs/logo-lockup-light.svg" width="300" alt="Marco: dos arcos, uno con el sol y otro con la luna, junto a la palabra Marco">
</picture>

### El día de tu familia, enmarcado.

Un *marco* de fotos que también enmarca el día de tu familia.

**Un calendario familiar de pared y panel de información para una Raspberry Pi, o cualquier navegador, que alojas tú mismo.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white)](#docker)
[![Languages](https://img.shields.io/badge/i18n-English%20%C2%B7%20Espa%C3%B1ol%20%C2%B7%20Portugu%C3%AAs-orange)](#)

[English](README.md) · **Español**

<a href="https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4"><img src="docs/media/hero.webp" width="100%" alt="Marco en la pantalla del salón: foto de fondo, reloj, tiempo y calendario mensual; llega un aviso de Home Assistant que dice que la lavadora ha terminado"></a>

[Web: marcohome.app](https://marcohome.app) · [Marco Cloud](https://app.marcohome.app/signup) · [Vídeo de demostración (MP4, en inglés)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

```bash
curl -fsSL https://marcohome.app/install | bash
```

</div>

### Dos formas de usarlo

- **En tu propio equipo (autoalojado):** una Raspberry Pi, un servidor doméstico o un NAS en tu red, instalado con
  el comando de arriba, con [Docker](#docker) o [a mano](#instalación-manual-nodejs). Gratis y de código abierto, y
  tus datos se quedan en casa. Todo este README trata de esta opción.
- **Marco Cloud, si no quieres tener un servidor:** la misma aplicación y el mismo panel de administración,
  alojados por nosotros en [app.marcohome.app](https://app.marcohome.app). Es gratis para familias, funciona sobre
  Cloudflare y guarda tus datos en la UE. [Crea una cuenta](https://app.marcohome.app/signup), añade tus calendarios
  y abre el enlace de tu pantalla en una tele, una tablet o una Raspberry Pi.

Más sobre las dos opciones en la web: [marcohome.app](https://marcohome.app).

## Por qué

Marco está inspirado en [DAKboard](https://dakboard.com/): una pantalla de pared que muestra de un vistazo el
calendario familiar, la hora, el tiempo, fotos y noticias. Es una **alternativa gratuita, de código abierto y
autoalojada** que ejecutas en tu propia Raspberry Pi, servidor doméstico o NAS **dentro de tu red local**. Si lo alojas
tú, no hay cuenta, ni suscripción, ni nube de por medio: tu configuración, tus fotos y los datos de tus calendarios se quedan en casa.
El único tráfico saliente va a los calendarios, al tiempo y a las fuentes de noticias que *tú* conectes.

> Marco es un proyecto independiente. No está afiliado, respaldado ni vinculado de ningún modo a DAKboard;
> DAKboard es una marca registrada de su propietario.

**Contenido:** [Funciones](#funciones) · [Cómo funciona](#cómo-funciona) · [Instalación](#instalación) ·
[Pruébalo](#pruébalo-en-un-minuto) · [Kiosco con Raspberry Pi](#kiosco-con-raspberry-pi) ·
[Google Calendar](#conectar-google-calendar) · [Otras integraciones](#otras-integraciones) · [Fotos](#fotos) ·
[Pantallas, avisos y API](#varias-pantallas-avisos-y-la-api) · [Configuración](#referencia-de-configuración) ·
[Seguridad](#seguridad) · [Desarrollo](#desarrollo)

## Funciones

### La pantalla

![Marco en español en una pantalla de 1920x1080: reloj, destacados, cuentas atrás, tiempo y un calendario mensual con eventos, cumpleaños y estancias de alquiler vacacional](docs/screenshots/display-es.webp)

| | |
|---|---|
| ![Diseño de agenda](docs/screenshots/display-agenda.webp) | ![Diseño de reloj grande sobre una foto](docs/screenshots/display-bigtime.webp) |
| ![Vista semanal](docs/screenshots/display-week.webp) | ![Tema claro, calendario a la izquierda y foto a la derecha](docs/screenshots/display-light.webp) |
| ![Aviso a pantalla completa enviado desde Home Assistant](docs/screenshots/display-announcement.webp) | ![Reloj analógico, efecto de lluvia y un mensaje programado](docs/screenshots/display-rain.webp) |

**Un diseño para cada habitación.** *Hoy*, *Por persona*, *Marco de fotos*, *Dos semanas*, *Tablero* y *Mesilla*:

| | |
|---|---|
| ![Diseño Hoy: el día hora a hora con una línea de ahora, el próximo evento en grande y el tiempo por horas](docs/screenshots/display-today.webp) | ![Diseño Por persona: una columna por calendario con lo de hoy y lo de mañana](docs/screenshots/display-people.webp) |
| ![Diseño Marco de fotos: la foto con una tarjeta pequeña con la hora en una esquina](docs/screenshots/display-photoframe.webp) | ![Diseño Dos semanas: la cuadrícula del mes con dos filas amplias](docs/screenshots/display-twoweeks.webp) |
| ![Diseño Tablero: agenda, mensaje del día, cuentas atrás, tareas y cumpleaños](docs/screenshots/display-board.webp) | ![Diseño Mesilla: un reloj grande y tenue con el próximo evento y la temperatura](docs/screenshots/display-bedside.webp) |

**Moderno o Clásico, por pantalla.** Moderno es el de serie; Clásico mantiene el aspecto original:

![La misma pantalla con el estilo Moderno (izquierda) y el Clásico (derecha)](docs/screenshots/display-modern-vs-classic.webp)

**Opciones de cristal** (estilo Moderno): cristal automático, transparente o tintado, con tono oscuro, claro o del
color de la foto, transparencia, desenfoque y borde de luz:

![El panel lateral con cinco ajustes de cristal: automático (el de serie), transparente, tintado, tono claro y tono de la foto](docs/screenshots/display-glass.webp)

<img src="docs/screenshots/display-portrait-1080x1920.webp" width="280" align="right" alt="Diseño vertical de 1080x1920">

- **Calendario:** vistas de mes (con número de semanas configurable), agenda y semana; once diseños (*calendario
  grande*, *dos semanas*, *izquierda/derecha*, *arriba/abajo*, *agenda*, *hoy*, *por persona*, *tablero*, *hora
  grande*, *marco de fotos*, *mesilla*), en horizontal o vertical, y cada calendario con su propio color.
- **Días llenos:** un día con más eventos de los que caben los muestra en líneas pequeñas, y las semanas con más
  eventos ocupan más alto; lo que aun así no cabe se muestra por turnos.
- **Un diseño para cada habitación:** *Hoy* muestra el día hora a hora con una línea de ahora, el próximo evento en
  grande y el tiempo de las próximas horas (la cocina por la mañana). *Por persona* da a cada calendario su columna
  con lo de hoy y lo de mañana (eliges hasta cinco en *Diseño*). *Tablero* es un tablón de organización familiar:
  tareas, cuentas atrás, el mensaje del día, los próximos cumpleaños y una agenda corta. *Marco de fotos* deja la
  foto sola, con una tarjeta pequeña con la hora en la esquina que elijas. *Mesilla* es un reloj enorme y muy tenue
  con el próximo evento y la temperatura, que se atenúa más por la noche. *Dos semanas* es la cuadrícula del mes con
  dos filas amplias.
- **Dos estilos por pantalla:** *Moderno* (el de serie), un aspecto minimalista al estilo de Apple, con tarjetas de
  cristal sobre la foto, reloj de pantalla de bloqueo y una cuadrícula de mes como la de iOS, o *Clásico*. El estilo
  es independiente del diseño.
- **Opciones de cristal** del estilo Moderno, por pantalla: automático (se adapta a cada foto), transparente o
  tintado; transparencia, desenfoque, tono oscuro, claro o de la foto y borde de luz, con vista previa en *Diseño*.
- **Emojis automáticos:** 🎂 cumpleaños, ✈️ vuelos, 🩺 médico, 🎒 colegio, ⚽ deporte, 🍽️ cenas, 💼 reuniones, 🏖️
  vacaciones, 🚗 coche, 🐾 veterinario y más, a partir de reglas de palabras clave editables (35 categorías con unas
  400 palabras clave en inglés, español y portugués de serie).
- **Cumpleaños con edad:** "🎂 Abuela Isabel (72)", desde un calendario de cumpleaños o introducidos en la
  administración.
- **Fuentes de alquiler vacacional** (el "Reserved" de Airbnb, Booking o herramientas de gestión de alojamientos que
  publican títulos como `🏠 Guest - 4p+1m` y líneas de descripción `Adults/Children/Infants`): barras de entrada →
  salida a lo largo de los días, huéspedes como iconos 🧑🏻🧒🏻👶🏻🐶, 🚪 salidas, avisos destacados de "Entrada hoy" y
  fechas bloqueadas que puedes ocultar.
- **Destacados y cuentas atrás:** "En 18 min · Llamada con cliente", "Salida · Mañana", "🎃 Fiesta de Halloween ·
  ¡Mañana!", "✈️ Viaje a Madeira · En 12 días".
- **Tiempo:** condiciones actuales y previsión por horas y por días de la fuente gratuita que elijas:
  [Open-Meteo](https://open-meteo.com/) (sin clave de API y con modelo a elegir: ECMWF, DWD ICON, NOAA GFS,
  Météo-France, UK Met Office y más), [MET Norway](https://api.met.no/) (sin clave) o
  [Pirate Weather](https://pirateweather.net/) (con tu propia clave gratuita). Las pantallas indican la fuente en letra
  pequeña. También tu propia entidad de tiempo y sensores interiores de [Home Assistant](https://www.home-assistant.io/);
  lluvia/nieve animadas.
- **Teletipo de noticias** desde cualquier fuente RSS/Atom, una lista de tareas y un mensaje del día.
- **Fondo de fotos:** fotos de stock o tu propia galería, transiciones WebGL, zoom lento, un suave efecto ambiental de
  "aurora" y **recorte inteligente** que mantiene al protagonista (caras, mascotas) en la parte de la pantalla que no
  tapan el reloj ni el tiempo.
- **Fácil de leer:** el desenfoque y el sombreado de los paneles se adaptan a la foto; las pantallas pequeñas usan un
  texto relativamente más grande; el modo noche atenúa la pantalla según un horario.
- **Actualizaciones en directo:** los cambios guardados en la administración aparecen en un segundo mediante
  Server-Sent Events; los datos se actualizan sin recargar la página y, si el servidor desaparece, la pantalla sigue
  mostrando los últimos datos.
- **Avisos:** tarjetas a pantalla completa con un sonido ("🧺 La lavadora ha terminado") y **mensajes
  programados** ("🗑️ Sacar la basura", mar. y vie. de 20:00 a 22:00).
- **Modo privado** por pantalla para cuando hay invitados: los eventos se ven como "Ocupado" (o se ocultan), a mano,
  con horario o desde Home Assistant, y el servidor los filtra antes de que lleguen a la pantalla.
- **Pensado para la Pi:** límite de 30 fps, se pausa cuando está oculta y `?lite=1` desactiva WebGL por completo.

<br clear="right">

### El panel de administración

| | |
|---|---|
| ![Inicio de la administración en español](docs/screenshots/es-admin-home.webp) | ![Calendarios con una cuenta de Google vinculada](docs/screenshots/es-admin-calendars-google.webp) |
| ![Filtros y cambios: ocultar, renombrar y dar estilo a eventos](docs/screenshots/admin-filters.webp) | ![Cumpleaños: próximos cumpleaños y lista de personas](docs/screenshots/admin-birthdays.webp) |
| ![Galería de fotos con contador de rotación, filtros y ojo para ocultar cada foto](docs/screenshots/admin-photos.webp) | ![Editor del punto focal de una foto](docs/screenshots/admin-photos-focus.webp) |
| ![Pantallas conectadas con su estado y controles](docs/screenshots/admin-displays.webp) | ![Tokens de API y ejemplo para Home Assistant](docs/screenshots/admin-api.webp) |

- **Panel de inicio:** pantallas conectadas, próximos eventos, estado de los calendarios, tiempo, avisos activos,
  actividad reciente y acciones rápidas (recargar, identificar, modo noche, enviar un aviso).
- **Calendarios:** URL iCal/ICS (incluidas `webcal://` y HTTPS con certificado autofirmado), **Google Calendar**
  mediante OAuth, **Outlook / Microsoft 365**, **Apple iCloud** (con una guía para sacar el enlace público del
  calendario), festivos predefinidos, y por calendario: color, emoji, tipo (general / alquiler vacacional /
  cumpleaños / festivos) y frecuencia de actualización.
- **Eventos locales** (puntuales o que se repiten cada semana / mes / año, con excepciones) y **cumpleaños** (con
  importación desde CSV).
- **Filtros y cambios:** oculta ("Not available"), renombra o fuerza el emoji/color de una serie, con una vista previa
  en directo de los próximos 14 días. **Reglas de iconos** con un probador. **Cuentas atrás**.
- **Galería de fotos:** arrastrar y soltar, optimización en el navegador (rotación EXIF, redimensionado, miniaturas),
  conversión de **HEIC** del iPhone, punto focal automático con editor manual y gestión de nombres duplicados.
- **CSS personalizado** por pantalla, para los cambios que no cubren los ajustes.
- **Varias pantallas** (salón, cocina, pasillo), cada una con su propio diseño, fondo, calendarios y widgets, y una
  página de **Pantallas conectadas** (resolución, navegador, versión, recargar / identificar / modo noche por
  dispositivo).
- **Enlaces privados y vinculación de pantallas:** cada pantalla tiene un enlace imposible de adivinar (`/d/<clave>`,
  código QR, regenerar con un clic) y los dispositivos nuevos se vinculan con un código de 6 caracteres; los
  dispositivos vinculados se pueden renombrar o revocar.
- **Avisos:** envíalos al momento o prográmalos; **tokens de API y webhooks** para Home Assistant y scripts.
- **Cámara del timbre:** cuando llaman a la puerta, Home Assistant avisa a Marco y las pantallas muestran la cámara a
  pantalla completa durante un rato, con sonido de timbre (también despierta las pantallas en modo noche).
- **Copias de seguridad** (automáticas, exportar/importar con vista previa), **registro de actividad**, **paleta de
  comandos** (Ctrl/Cmd + K), diseño adaptado al móvil, en inglés / español / portugués.

| | | |
|---|---|---|
| ![Paleta de comandos buscando el modo noche](docs/screenshots/admin-home-palette.webp) | ![Editor de eventos locales](docs/screenshots/admin-local-edit.webp) | ![Diálogo de conflicto al subir una foto con el mismo nombre](docs/screenshots/admin-photos-conflict.webp) |
| ![Pantallas: un perfil por habitación](docs/screenshots/admin-screens.webp) | ![Página de avisos: enviar un aviso al momento](docs/screenshots/admin-alerts.webp) | ![Registro de actividad con filtros](docs/screenshots/admin-activity.webp) |
| ![Copias de seguridad: exportar, importar y restaurar](docs/screenshots/admin-backups.webp) | ![Cuentas atrás: fechas manuales y automáticas](docs/screenshots/admin-countdowns.webp) | ![Reglas de iconos con probador en vivo](docs/screenshots/admin-icons.webp) |
| ![Página de diseño: estilo Moderno o Clásico, cristal y vista previa de la pantalla](docs/screenshots/admin-layout.webp) | ![Lista de eventos locales](docs/screenshots/admin-local.webp) | ![Página de inicio de sesión](docs/screenshots/admin-login.webp) |

| | |
|---|---|
| ![Página de diseño: los once diseños con miniaturas](docs/screenshots/admin-layouts.webp) | ![Ajustes de cristal con vista previa sobre una foto oscura y otra clara](docs/screenshots/admin-layout-glass.webp) |

<p align="center">
  <img src="docs/screenshots/mobile-home.webp" width="230" alt="Administración en un móvil: inicio">
  <img src="docs/screenshots/mobile-home-menu.webp" width="230" alt="Administración en un móvil: menú">
  <img src="docs/screenshots/mobile-calendars.webp" width="230" alt="Administración en un móvil: calendarios">
</p>

## Cómo funciona

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/how-it-works-dark.webp">
  <img src="docs/media/how-it-works-light.webp" width="100%" alt="Cómo funciona Marco (diagrama en inglés): Google Calendar, fuentes iCal, el tiempo de Open-Meteo, noticias RSS y Home Assistant (webhook de entrada) alimentan el servidor de Marco en casa (Raspberry Pi, NAS o mini PC), que guarda calendarios, fotos y avisos. Envía actualizaciones en directo a la tele del salón y a un kiosco con Raspberry Pi mediante enlaces privados y a una tablet de la cocina mediante un código de vinculación. Lo administras desde el móvil o el portátil.">
</picture>

- Un pequeño **servidor Node.js** (sin base de datos ni módulos nativos) descarga y guarda en caché tus calendarios,
  el tiempo y las noticias, almacena tus ajustes y fotos en una carpeta `data/` y sirve dos aplicaciones web.
- Las **pantallas** son simplemente navegadores: una Raspberry Pi en modo kiosco, una tablet antigua, el navegador de
  una smart TV. Cada una abre el **enlace privado** de su pantalla (`/d/<clave>`) o se **vincula** con un código.
  Reciben los cambios al momento mediante Server-Sent Events.
- El **panel de administración** en `/admin/` funciona desde cualquier móvil u ordenador de tu red.
- Home Assistant puede enviar avisos y activar el modo noche mediante webhooks, y Marco puede leer su tiempo y sus
  sensores.

Más detalles: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/API.md](docs/API.md).

## Instalación

Hay cuatro formas de ejecutar Marco. Elige una:

| Forma | Para qué |
|---|---|
| [Instalador de una línea](#instalador-de-una-línea) | Una Raspberry Pi, un servidor doméstico o cualquier máquina Debian / Ubuntu. Versión ya compilada, servicio de systemd, kiosco y el comando `marco` |
| [Docker](#docker) | Un NAS o una máquina que ya ejecuta contenedores |
| [Instalación manual](#instalación-manual-nodejs) | macOS, Windows, otros sistemas Linux, o si quieres ver cada paso |
| [Pruébalo](#pruébalo-en-un-minuto) | Una demo desechable con una familia ficticia, sin configurar nada |

### Instalador de una línea

```bash
curl -fsSL https://marcohome.app/install | bash
```

Si `marcohome.app` todavía no responde, usa el mismo script directamente desde GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/mr-reb00t/marco/main/install.sh | bash
```

Ejecútalo con tu usuario normal (pide `sudo` cuando lo necesita). Funciona en Debian 12/13, Raspberry Pi OS (Bookworm
o Trixie) y Ubuntu 22.04 o posterior, en x86_64, arm64 y armv7. Pregunta qué debe hacer este dispositivo (el
instalador habla en inglés):

```
What should this device do?
  1) Server only: other screens and browsers connect to it
  2) All in one: the server and the screen on this device
  3) Screen only (kiosk): show a Marco server that runs on another machine
```

1 es solo servidor (otras pantallas y navegadores se conectan a él), 2 todo en uno (servidor y pantalla en este
dispositivo) y 3 solo pantalla o kiosco (muestra un servidor de Marco que está en otra máquina).

Después muestra lo que ha encontrado (sistema, modelo de Raspberry Pi, escritorio, overlay de solo lectura,
instalación existente) y pregunta antes de cambiar nada. El instalador:

- instala Node.js 22 si falta Node o es anterior a la 20 (la versión oficial, comprobada con `SHASUMS256.txt`);
- descarga la última versión publicada (`marco-<versión>.tar.gz`) y comprueba su SHA-256 antes de descomprimirla.
  Mientras no haya ninguna versión publicada, clona el repositorio y lo compila;
- crea `.env` (modo 600) con un `SESSION_SECRET` aleatorio, instala el servicio de systemd `marco` y lo arranca;
- para la pantalla: instala Chromium, añade el kiosco al inicio automático del escritorio, desactiva el apagado de
  pantalla y oculta el cursor;
- instala el [comando `marco`](#el-comando-marco);
- termina con la dirección del panel y un código QR que puedes escanear con el móvil para abrir el
  [asistente de configuración](#primeros-pasos-el-asistente-de-configuración).

Si lo vuelves a ejecutar, actualiza la instalación y conserva el modo que elegiste. Nunca toca tus datos.

#### Léelo antes de ejecutarlo

Pasar un script de Internet directamente a `bash` significa confiar en él. Si prefieres leerlo antes, descárgalo,
compruébalo y ejecuta el archivo. Cada versión publicada en GitHub incluye `install.sh` y su suma de comprobación junto
al paquete:

```bash
curl -fsSLO https://github.com/mr-reb00t/marco/releases/latest/download/install.sh
curl -fsSLO https://github.com/mr-reb00t/marco/releases/latest/download/install.sh.sha256
sha256sum -c install.sh.sha256      # debe mostrar: install.sh: OK
less install.sh                     # léelo
bash install.sh --dry-run           # muestra cada comando y cada archivo que escribiría, sin cambiar nada
bash install.sh
```

`--dry-run` también funciona con la línea única: `curl -fsSL https://marcohome.app/install | bash -s -- --dry-run`.

#### Opciones

Las opciones van después de `bash -s --`, por ejemplo
`curl -fsSL https://marcohome.app/install | bash -s -- --mode server --port 8080 --yes`.

| Opción | Significado |
|---|---|
| `--mode all\|server\|kiosk` | Qué instalar (se pregunta si no se indica y hay una terminal) |
| `--url <enlace>` | El enlace privado de la pantalla para el kiosco (*Administración → Pantalla → Ajustes → Enlace privado*) |
| `--port <n>` | Puerto del servidor (por defecto `3000`) |
| `--dir <ruta>` | Carpeta de instalación (por defecto `~/marco`, o `/opt/marco` si se ejecuta como root) |
| `--user <nombre>` | Usuario que ejecuta el servidor y la sesión de escritorio (por defecto: tú, o `$SUDO_USER`) |
| `--version <x.y.z>` | Instala esa versión en lugar de la última |
| `--yes`, `-y` | No pregunta, usa los valores por defecto |
| `--dry-run` | Muestra cada acción sin cambiar nada |
| `--update` | Actualiza una instalación existente (lo mismo que volver a ejecutar el instalador) |
| `--uninstall [--purge]` | Desinstala Marco; `--purge` borra también la carpeta de datos (configuración, fotos, copias) |
| `--skip-apt` | No instala paquetes del sistema |
| `-h`, `--help` | Muestra la ayuda |

Si se ejecuta como root sin `--user`, el servidor se ejecuta como `$SUDO_USER`; si no lo hay, como el usuario con
inicio de sesión automático en el escritorio (modos con pantalla) o como un usuario de sistema nuevo llamado `marco`
(solo servidor).

#### Dónde queda cada cosa

```
~/marco/                  (o /opt/marco)
├── current -> releases/0.6.1   la versión en marcha, se cambia en un solo paso al actualizar
├── releases/                   la versión actual y la anterior (para volver atrás)
├── data/                       configuración, secretos, fotos, copias (se conservan al actualizar y desinstalar)
└── .env                        puerto y otros ajustes, consulta .env.example
/etc/marco.conf                 qué se instaló y dónde (lo lee el comando marco)
/usr/local/bin/marco            el comando marco
/etc/systemd/system/marco-update.path, marco-update.service   el botón Actualizar del panel (ver Actualizaciones)
~/.config/marco/kiosk.env       ajustes del kiosco (modos pantalla y todo en uno)
```

### El comando `marco`

| Comando | Qué hace |
|---|---|
| `marco status` | Estado del servicio, versión y dirección |
| `marco logs [-f]` | Registro del servidor (`-f` lo sigue); en un dispositivo solo kiosco, el registro del kiosco |
| `marco restart` | Reinicia el servidor |
| `marco update [--force]` | Instala la última versión: comprueba la suma, cambia de versión en un solo paso y vuelve atrás si la nueva no arranca. Se detiene si no puede llegar a GitHub y nunca instala una versión anterior; `--force` reinstala la misma versión o permite una anterior |
| `marco url` | Dirección del panel y el enlace privado de cada pantalla, con códigos QR |
| `marco version` | Versión instalada y la última publicada |
| `marco uninstall [--purge]` | Desinstala Marco; tus datos se conservan salvo que añadas `--purge`. Pregunta antes (la respuesta por defecto es no); sin terminal necesita `--yes` |

### Actualizaciones

Una vez al día el servidor pregunta a GitHub cuál es la última versión. Si hay una más nueva, el panel muestra un
aviso, *Marco 0.5.1 disponible*, con las novedades. Cómo se actualiza depende de cómo instalaste Marco:

| Instalación | Cómo actualizar |
|---|---|
| Instalador de una línea | **Actualizar ahora** en el panel (o `marco update` en el servidor). Se descarga la nueva versión, se comprueba su suma, se cambia en un solo paso y se vuelve atrás si no arranca. El panel enseña el progreso y se recarga solo, y las pantallas se recargan por su cuenta |
| Docker | `git pull && docker compose up -d --build` en la carpeta de `docker-compose.yml` (el panel lo indica) |
| Copia de git | `marco update` si se preparó con `deploy/install.sh`; si no, `git pull && npm ci && npm run build` y reiniciar |

Las **actualizaciones automáticas** vienen desactivadas. Actívalas en *Estado → Actualizaciones* (instalaciones hechas
con el instalador de una línea) y elige el horario, por defecto entre las 03:00 y las 05:00 en la zona horaria de
*Fecha y hora*. Una versión que no arranca se deshace y no se vuelve a intentar; la siguiente sí.

Cómo funciona el botón: el servidor se ejecuta con un usuario normal y no puede actualizarse a sí mismo. Escribe
`data/update/request`; una unidad *path* de systemd que instala el instalador (`marco-update.path`) lo detecta y arranca
`marco-update.service`, que ejecuta `marco update --requested` como root, igual que `sudo marco update`. Del aviso solo
importa que exista, así que lo único que el servidor puede pedir es «la última versión». El progreso y la salida del
instalador quedan en `data/update/` para el panel. Las instalaciones que se actualizan desde la 0.4 tienen el botón
después de ejecutar `marco update` una vez más en el servidor (dice que ya está al día y añade las unidades).

Privacidad: la comprobación es un único `GET` diario a `api.github.com`, sin identificador ni versión (si la respuesta
no ha cambiado, ni siquiera se vuelve a descargar). Desactívala en *Estado → Actualizaciones*, o del todo con
`MARCO_UPDATE_CHECK=0` en `.env`.

### Docker

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
docker compose up -d        # construye la imagen y la arranca en el puerto 3000
docker compose logs marco | grep setup   # la URL de configuración de un solo uso
```

Después abre esa URL de configuración (cambia `localhost` por la dirección del servidor si estás en otro dispositivo)
y sigue el [asistente de configuración](#primeros-pasos-el-asistente-de-configuración). **No hay contraseña por
defecto**: la crea el asistente. En Docker el asistente pide **siempre** este código de un solo uso (la imagen define
`SETUP_REQUIRE_TOKEN=1`), porque dentro de un contenedor cualquier cliente puede parecer de la red local. Los datos se
guardan en el volumen `marco-data` (`/data` dentro del contenedor). La imagen se ejecuta con un usuario sin privilegios
de root y tiene un health check en `/api/health`. Sin Compose:
`docker build -t marco . && docker run -d -p 3000:3000 -v marco-data:/data marco`.
Para actualizar: `git pull && docker compose up -d --build`.

> **Instalaciones expuestas o remotas** (un VPS, una redirección de puertos, un proxy inverso): pon
> `SETUP_TOKEN=<valor aleatorio largo>` en el `.env` junto a `docker-compose.yml` (p. ej.
> `echo "SETUP_TOKEN=$(openssl rand -hex 16)" >> .env`) *antes* del primer arranque. Así el asistente no funciona sin
> él y nadie más puede quedarse con tu instalación nueva; abre `http://<dirección-del-servidor>:3000/admin/?setup=<token>`.
> Las instalaciones sin navegador pueden definir `ADMIN_PASSWORD` en su lugar (se omite el asistente y el panel propone
> cambiarla después).
>
> **Docker detrás de un proxy inverso** (Caddy, nginx, cloudflared, en el mismo host o no): el proxy llega al
> contenedor a través del bridge de Docker, así que define `TRUST_PROXY=172.16.0.0/12` (o la dirección del proxy) en
> ese `.env`. Si no, el servidor no ve la dirección real del cliente: los visitantes que pasan por el proxy se tratan
> como remotos y la cookie de sesión no se marca `Secure`. **Compose solo pasa al contenedor las variables que
> aparecen en `docker-compose.yml`** (`SETUP_TOKEN`, `SETUP_REQUIRE_TOKEN`, `ADMIN_PASSWORD`, `PUBLIC_URL`,
> `ALLOWED_HOSTS`, `TRUST_PROXY`, `COOKIE_SECURE`, `SESSION_SECRET`, `LAN_ADDRESS`, las claves de Google); añade
> ahí las demás.

### Instalación manual (Node.js)

Requisitos: **Node.js 20 o superior** (se recomienda 22 LTS) en Linux, macOS o Windows.

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
npm ci
cp .env.example .env        # opcional: PORT, PUBLIC_URL, claves de Google, SETUP_TOKEN
npm run build
npm start                   # http://localhost:3000/  y  http://localhost:3000/admin/
```

Para actualizar: `git pull && npm ci && npm run build` y reinicia `npm start`. En una máquina basada en Debian,
`./deploy/install.sh` convierte esa copia en un servicio de systemd (y un kiosco) sin moverla de sitio; usa el mismo
instalador con esta carpeta como origen, y después `marco update` hace `git pull` y vuelve a compilar. Sus opciones:
`--no-kiosk` (solo servidor), `--kiosk-only --url <enlace>`, `--url <enlace>`, `--user <nombre>`, `--skip-apt`,
`--dry-run`.

### Primeros pasos: el asistente de configuración

Una instalación nueva no tiene contraseña de administración ni ajustes propios. La primera vez que abres
`http://<server-ip>:3000/admin/`, un **asistente de configuración** te guía en unos dos minutos, y la pantalla
(`http://<server-ip>:3000/`) muestra una bienvenida con la dirección del panel y un código QR hasta que terminas.

| | |
|---|---|
| ![Asistente, paso 1: bienvenida e idioma](docs/screenshots/setup-1-welcome.webp) | ![Paso 2: contraseña con medidor de seguridad](docs/screenshots/setup-2-password.webp) |
| ![Paso 3: ciudad, zona horaria, unidades y formato de hora](docs/screenshots/setup-3-location.webp) | ![Paso 4: festivos por país y fuentes iCal con botón Probar](docs/screenshots/setup-4-calendars.webp) |
| ![Paso 5: nombre, diseño, color, fotos y efecto ambiental](docs/screenshots/setup-5-look.webp) | ![Paso 6: el enlace privado de la pantalla con código QR y resumen](docs/screenshots/setup-6-done.webp) |

1. **Bienvenida**: elige el idioma (English, Español, Português).
2. **Contraseña del panel**: al menos 10 caracteres, nada obvio (`password123`, `1234567890`, `qwertyuiop`),
   escrita dos veces; un medidor te ayuda. La pantalla en sí nunca necesita contraseña.
3. **Ubicación**: busca tu ciudad (Open-Meteo, sin clave de API); la zona horaria viene con ella (o del navegador);
   después elige °C/°F y reloj de 24 h o 12 h. ¿El navegador no tiene Internet? Escribe las coordenadas u omite la
   ubicación y añádela más tarde (el tiempo la necesita; la zona horaria se guarda igualmente).
4. **Calendarios**: marca los festivos de tu país (preseleccionados según la ciudad), pega direcciones iCal (`.ics`)
   y pulsa **Probar** para comprobarlas. Google Calendar: pega la *dirección secreta en formato iCal* del calendario,
   o vincula la cuenta después si el servidor tiene [un cliente OAuth de Google](#conectar-google-calendar).
5. **Aspecto**: nombre de la pantalla, diseño, color de acento, tema claro u oscuro, fotos de fondo (stock ahora, tu
   galería más tarde) y efecto ambiental.
6. **Listo**: el **enlace privado** de la pantalla para abrir en la tele o la Raspberry Pi (botón de copiar y código
   QR; si hiciste la configuración en el propio servidor como `localhost`, usa su dirección de la red local), un
   resumen y consejos (`?lite=1` para dispositivos lentos, el comando de una línea para el kiosco con el enlace
   privado). Ya tienes la sesión iniciada y entras al panel. Una pantalla que mostraba la bienvenida pasa a mostrar un
   [código de vinculación](#enlaces-privados-y-vinculación-de-pantallas).

<img src="docs/screenshots/setup-mobile.webp" alt="El asistente de configuración en un móvil" width="260" align="right">

El asistente también funciona en el móvil, y todo lo que configura se puede cambiar después en el panel.

**Quién puede usarlo.** Los endpoints de configuración solo funcionan mientras no exista una contraseña (después
responden `409`), solo un navegador puede completarlos y además:

- desde tu **red local** el asistente funciona sin más: la dirección del cliente es loopback o privada, la petición no
  llega a través de un proxy inverso que falte en `TRUST_PROXY` y (en un contenedor) no es la pasarela del contenedor;
- desde **cualquier otro sitio** necesita la URL de un solo uso que el servidor escribe al arrancar:
  `[setup] Open http://localhost:3000/admin/?setup=<token> to finish setup` (`marco logs | grep setup`,
  `journalctl -u marco | grep setup`, `docker compose logs marco | grep setup` o la terminal donde corre
  `npm start`). El registro muestra `localhost` con el puerto real y las direcciones de la red local que detecta;
  desde otro dispositivo usa la dirección del servidor en lugar de `localhost` (y, en Docker, el puerto publicado);
- con **`SETUP_TOKEN`** definido, el token se exige desde cualquier sitio. Es lo recomendable para VPS, proxies
  inversos y todo lo que sea accesible desde Internet. `SETUP_REQUIRE_TOKEN=1` (por defecto en la imagen Docker) hace
  lo mismo con el token generado del registro. Una instalación que ya estaba configurada pero perdió
  `data/secrets.json` también lo pide.

El servidor solo responde a nombres de host conocidos (protección contra DNS rebinding, en el que una web maliciosa
apunta su propio nombre a tu servidor): direcciones IP, `localhost`, nombres de una sola etiqueta (`raspberrypi`),
`*.local`, `*.lan`, `*.home.arpa`, `*.internal`, el host de `PUBLIC_URL` y lo que pongas en `ALLOWED_HOSTS`. El resto
recibe `421`.

Actualizar una instalación existente nunca muestra el asistente: si ya hay una contraseña guardada, no cambia nada.
Con `ADMIN_PASSWORD` definido y sin contraseña guardada, se usa esa contraseña (instalaciones sin navegador) y el panel
sugiere cambiarla.

![Bienvenida en una instalación nueva con la dirección del panel y un código QR](docs/screenshots/display-welcome.webp)

<br clear="right">

## Pruébalo en un minuto

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
npm ci
npm run demo
```

`npm run demo` compila la interfaz web si hace falta y arranca un servidor con un **directorio de datos desechable**
lleno de una familia ficticia: dos pantallas ("Living room" y "Kitchen"; "Salón" y "Cocina" con `--lang es`), eventos
locales, cumpleaños, cuentas atrás, filtros, una fuente de alquiler vacacional y un calendario escolar (servidos
localmente), fotos de ejemplo de picsum.photos con puntos focales, un token de API y algo de historial de actividad. Tu
carpeta `data/` real nunca se toca.

- Pantalla: la demo muestra el **enlace privado** de cada pantalla (`http://localhost:3000/d/<clave>`);
  <http://localhost:3000/pair> muestra un código para probar *Pantallas conectadas → Vincular una pantalla*
- Administración: <http://localhost:3000/admin/>, contraseña **`demo-calendar`**
- Opciones: `--port 3080`, `--lang es` (o `pt`), `--no-photos`, `--data ./demo-data --keep`

![La pantalla de la cocina de la demo: tema claro, agenda, lista de tareas y tiempo en directo](docs/screenshots/display-kitchen-live.webp)

¿Solo quieres ver la pantalla? Cualquier instancia en marcha muestra un conjunto de datos de ejemplo integrado en
`/?demo=1` (añade `&lang=es`, `&preset=agenda`, `&theme=light`, `&style=modern`, `&announce=success`, `&sched=1`,
`&now=2026-10-09T10:42`, `&wx=rain|snow|clear` con `&wxfx=rich` para ver el efecto del tiempo, `&pair=1` para la pantalla de vinculación).

**Vídeo de demostración.** Un recorrido de un minuto en el estilo Moderno: la vista de mes, un aviso enviado desde el
móvil, los diseños Hoy y tablero, el marco de fotos, los estilos Clásico y cristal, los efectos del tiempo, una
pantalla vertical, el panel (diseños, calendarios, galería) y el reloj tenue de noche para el dormitorio.

[![Vídeo de demostración: la pantalla del salón en estilo Moderno con el calendario del mes, el tiempo y los próximos eventos](docs/media/poster.webp)](https://github.com/mr-reb00t/marco/releases/download/media/marco-demo.mp4)

## Enlaces privados y vinculación de pantallas

Desde la 0.3 todas las pantallas son **privadas** por defecto: un navegador solo muestra el calendario si ha abierto el
**enlace privado** de la pantalla o se ha **vinculado** desde el panel. Si no, muestra un código de vinculación y nada
más. Así Marco es seguro en redes compartidas (wifi de un piso compartido, oficina) y puedes acceder desde Internet
detrás de HTTPS.

| | |
|---|---|
| ![Enlace privado de la pantalla con código QR, botón para regenerar y comando para la Raspberry Pi](docs/screenshots/admin-private-link.webp) | ![Vincular una pantalla: código, pantalla y nombre del dispositivo](docs/screenshots/admin-pairing-dialog.webp) |
| ![Una pantalla nueva sin clave muestra un código de vinculación y un código QR](docs/screenshots/display-pairing.webp) | ![Enlace regenerado o dispositivo revocado: «Este enlace ya no es válido»](docs/screenshots/display-invalid-link.webp) |

- **Enlace privado:** *Pantalla → Ajustes → Enlace privado* muestra el enlace de la pantalla seleccionada, p. ej.
  `http://homeserver.lan:3000/d/3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37`, con **Copiar**, un **código QR**, **Abrir**,
  **Regenerar enlace** y el comando listo para pegar en la Raspberry Pi. Guárdalo como marcador en una tablet, úsalo
  como URL del kiosco o escanea el QR con el dispositivo. El enlace es la llave: quien lo tenga ve esa pantalla (y solo
  esa, porque `?screen=` se ignora), así que úsalo solo en tus dispositivos.
- **Vinculación:** sin teclear enlaces largos en una tele. Abre la dirección normal (`http://homeserver.lan:3000/` o
  `/pair`) en el dispositivo nuevo y mostrará un **código de 6 caracteres** grande y un código QR. En el móvil abre
  *Pantallas conectadas → Vincular una pantalla* (o escanea el QR: abre el panel con el código ya escrito), escribe el
  código, elige la pantalla y un nombre. El panel te enseña entonces la dirección de la pantalla que espera con ese
  código; confirma que es la que tienes delante. El dispositivo arranca en un par de segundos y guarda su propia llave en el
  almacenamiento del navegador. Va bien para tablets, teles y navegadores que sigues usando. El kiosco de la
  Raspberry Pi abre Chromium en modo incógnito (nada sobrevive a un reinicio), así que a él dale el enlace privado.
- **Dispositivos vinculados:** *Pantallas conectadas* los lista con la pantalla que muestran y cuándo se vieron por
  última vez; **Editar** los renombra o los pasa a otra pantalla y **Revocar** les corta el acceso.
- **Regenerar / revocar:** *Regenerar enlace* cambia la clave al instante; las pantallas que usaban el enlace antiguo
  (o un dispositivo revocado) pasan a «Este enlace ya no es válido», borran sus datos en caché y ofrecen un código de
  vinculación nuevo.
- **Modo de acceso a las pantallas** (*Seguridad → Acceso a las pantallas*): **Privado** (por defecto en las
  instalaciones nuevas) o **Abierto (red local)**, el comportamiento de la 0.2, en el que `/` y `/?screen=<slug>`
  funcionan sin clave. **Al actualizar desde la 0.2 se mantiene Abierto** para que ningún kiosco se quede en blanco, y
  el panel recomienda cambiarlo: primero abre en cada pantalla su enlace privado (o vincúlala); al guardar Privado, las
  pantallas sin clave muestran un código de vinculación (si vuelves a Abierto, regresan solas en unos 30 s). La vista
  previa del panel y *Ver pantalla* siguen funcionando con tu sesión en ambos modos. Restaurar una copia o importar un
  archivo nunca cambia este modo.

| | |
|---|---|
| ![Seguridad: acceso privado de las pantallas y contraseña](docs/screenshots/admin-security.webp) | ![Pantallas conectadas y dispositivos vinculados](docs/screenshots/admin-displays-paired.webp) |

La clave es un **UUIDv4** aleatorio (122 bits aleatorios): fácil de leer y teclear en una Pi (hexadecimal en
minúsculas, sin letras ambiguas) e imposible de adivinar. Los cálculos de fuerza bruta, qué se registra (nada secreto)
y el modelo de amenazas completo están en [SECURITY.md](SECURITY.md#private-display-links-and-pairing-threat-model)
(en inglés).

## Kiosco con Raspberry Pi

Pensado para Raspberry Pi OS **Bookworm** o **Trixie** (64 bits, con escritorio) en una Pi 4 o 5; una Pi 3 funciona
con `?lite=1`. El kiosco es Chromium a pantalla completa, arrancado por la sesión de escritorio. El instalador lo
configura para labwc y Wayfire (Raspberry Pi OS con escritorio) y para X11 con LXDE.

![Calendario grande en una pantalla de Raspberry Pi de 1280x720](docs/screenshots/display-1280x720.webp)

<img src="docs/screenshots/mobile-private-link.webp" alt="Administración en un móvil: enlace privado y código QR" width="230" align="right">

### A. Servidor y pantalla en la misma Pi (todo en uno)

```bash
curl -fsSL https://marcohome.app/install | bash -s -- --mode all
sudo reboot
```

Tras reiniciar, la pantalla muestra la bienvenida con un código QR: escanéalo con el móvil para usar el
[asistente de configuración](#primeros-pasos-el-asistente-de-configuración). Al terminar, la pantalla muestra un
**código de vinculación**: vincúlala desde el móvil para empezar ya, o simplemente reinicia. En una instalación todo en
uno el kiosco abre **por sí solo el enlace privado de la pantalla predeterminada**. Lo lee de la carpeta de datos local
cada vez que arranca Chromium, así que recoge un enlace regenerado en el siguiente reinicio.
`--url "http://localhost:3000/?screen=kitchen"` elige otra pantalla del mismo modo. Una vinculación sola no sobrevive a
un reinicio ahí, porque el navegador del kiosco va en modo incógnito.

### B. Servidor en otra máquina, la Pi solo lo muestra (solo kiosco)

Ejecuta el servidor en un servidor doméstico, NAS o host Docker ([Instalación](#instalación)). Después copia el
comando de *Pantalla → Ajustes → Enlace privado* (o de `marco url` en el servidor) y ejecútalo en la Pi:

```bash
curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url http://homeserver.lan:3000/d/3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37
sudo reboot
```

El enlace decide qué pantalla muestra esta Pi. Aquí no sirve vincular con código: el navegador del kiosco va en modo
incógnito y lo olvidaría en el siguiente reinicio. Esto instala solo Chromium y el inicio automático del kiosco (sin
Node.js ni servidor), deja los scripts del kiosco en `~/.local/bin/`, guarda el enlace en `~/.config/marco/kiosk.env`
(modo 600), desactiva el apagado de pantalla y oculta el cursor. El enlace nunca se muestra completo: el instalador y
el registro del kiosco muestran `/d/<private link>`. En el modo de acceso **abierto** sigue funcionando
`--url "http://homeserver.lan:3000/?screen=kitchen"`.

<br clear="right">

### Notas sobre el escritorio y el sistema

- **Inicio de sesión automático:** el kiosco necesita una sesión de escritorio que arranque sola. Si la Pi usa
  lightdm, el instalador activa el inicio de sesión automático en el escritorio con `raspi-config`.
- **Inicio de sesión en consola y `startx`:** si la Pi inicia sesión en la consola y arranca X desde `~/.xinitrc` (sin
  gestor de pantalla), el instalador no edita ese archivo. Muestra la línea que tienes que poner al final:
  `exec ~/.local/bin/marco-kiosk >/tmp/marco-kiosk.log 2>&1` (la ruta exacta aparece en la salida del instalador).
- **Sistema de archivos de solo lectura (overlay):** si proteges la tarjeta SD con el sistema de archivos overlay de
  Raspberry Pi OS, cualquier cambio se pierde al reiniciar. El instalador lo detecta y se detiene con estos pasos
  (`--dry-run` los muestra sin detenerse):

  ```bash
  sudo raspi-config nonint disable_overlayfs && sudo reboot
  curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url <enlace privado>
  sudo raspi-config nonint enable_overlayfs && sudo reboot
  ```

  Con el overlay activado, mantén el *servidor* (y su carpeta `data/`) en otra máquina (topología B).

### Consejos para el kiosco

- La configuración del kiosco está en `~/.config/marco/kiosk.env` (`KIOSK_URL`, `KIOSK_CLIENT`,
  `KIOSK_EXTRA_ARGS`). Tras *Regenerar enlace*, vuelve a ejecutar el instalador con `--url <enlace nuevo>` (o pon el
  enlace nuevo en `KIOSK_URL`). El registro es `/tmp/marco-kiosk.log` (`marco logs` en una Pi solo kiosco). El script
  espera al servidor, reinicia Chromium si se cierra y añade `client=<hostname>` para que el dispositivo conserve su
  nombre en *Pantallas conectadas*.
- **¿Demasiado grande o demasiado pequeño?** Chromium arranca con escala 1, sea cual sea el zoom del escritorio.
  Añade `KIOSK_EXTRA_ARGS="--force-device-scale-factor=0.8"` (o `1.25`) a `kiosk.env`. La pantalla también tiene un
  ajuste de escala de texto por pantalla.
- **Burbuja de traducción**: la página declara `translate="no"` y el kiosco arranca Chromium con la traducción
  desactivada, así que Chromium no debería ofrecer traducir el calendario.
- **Apagar la pantalla por la noche**: ejecuta `marco-schedule off` y `marco-schedule on` desde cron en una Pi que solo
  hace de pantalla (está en `~/.local/bin`), o `~/marco/current/deploy/screen-schedule.sh off|on` en una instalación
  todo en uno (`/opt/marco/current/...` si se instaló como root). La cabecera del script tiene ejemplos de crontab. O
  simplemente usa el modo noche con atenuación desde la administración.
- **Pi lenta**: pon el efecto ambiental en *ninguno* y la transición en *fundido*, o usa `?lite=1` en `KIOSK_URL`.

Comandos útiles: `marco status`, `marco logs -f`, `marco restart`, `marco update`, `marco url`.

## Conectar Google Calendar

Tienes dos opciones. **OAuth** (recomendado) ofrece actualizaciones casi en tiempo real y te permite elegir los
calendarios de una lista; la **dirección secreta iCal** no necesita ninguna configuración, pero se actualiza despacio.
Ambas son de solo lectura.

### 1. Crea un proyecto de Google Cloud y un cliente OAuth

1. Ve a <https://console.cloud.google.com/>, inicia sesión y **crea un proyecto** (p. ej. `marco`).
2. **APIs y servicios → Biblioteca** (*APIs & Services → Library*) → busca **Google Calendar API** → **Habilitar**
   (*Enable*).
3. Abre **Google Auth Platform** (antes "Pantalla de consentimiento de OAuth"):
   - **Marca** (*Branding*): nombre de la app (p. ej. *Marco*), tu email de asistencia y el email de contacto
     del desarrollador. Guarda.
   - **Público** (*Audience*): tipo de usuario **Externo** (*External*). En **Usuarios de prueba** (*Test users*) añade
     tu propia dirección de Google (y la de cualquier otra persona cuyos calendarios quieras vincular).
   - **Acceso a datos** (*Data access*, opcional): puedes añadir los permisos (scopes) `openid`, `email`, `profile` y
     `https://www.googleapis.com/auth/calendar.readonly`; Marco los solicita de todas formas.
4. **Clientes → Crear cliente → Aplicación web** (*Clients → Create client → Web application*):
   - **URI de redireccionamiento autorizados** (*Authorized redirect URIs*): `<PUBLIC_URL>/auth/google/callback`,
     exactamente, p. ej. `http://localhost:3000/auth/google/callback` o
     `https://calendar.example.com/auth/google/callback` (mismo esquema, host y puerto, sin barra final).
   - Créalo y copia el **ID de cliente** (*Client ID*) y el **Secreto del cliente** (*Client secret*).
5. Ponlos en `.env` y reinicia:

   ```ini
   PUBLIC_URL=http://localhost:3000
   GOOGLE_CLIENT_ID=<your-client-id>
   GOOGLE_CLIENT_SECRET=<your-client-secret>
   ```

   `marco restart` (o `docker compose up -d`, o reinicia `npm start`). Con el instalador de una línea, `.env` está en la
   carpeta de instalación (`~/marco/.env` o `/opt/marco/.env`).

> **Pruebas frente a producción.** Mientras el estado de publicación de la app sea **Prueba** (*Testing*), solo los
> usuarios de prueba pueden iniciar sesión y Google **hace caducar los tokens de actualización a los 7 días**: los
> calendarios de Google dejan de actualizarse al cabo de una semana hasta que vuelvas a pulsar *Conectar*. Para uso
> personal no pasa nada si no te importa volver a conectar cada semana. Para evitarlo, **publica** la app (*Público →
> Publicar app*). Google exige entonces una URL de página principal y de política de privacidad en un dominio
> autorizado y, como la app no está verificada, verás una pantalla de "app no verificada" al vincular tu cuenta
> (*Configuración avanzada → Ir a … (no seguro)*). Marco solo pide acceso de lectura.

### 2. El problema del URI de redireccionamiento (y tres formas de resolverlo)

Google solo acepta URI de redireccionamiento en **dominios públicos con `https://`** o en **`http://localhost`**. Una
dirección de la red local como `http://192.168.1.50:3000/auth/google/callback` se rechaza (`redirect_uri_mismatch` /
"redireccionamiento no válido"). Elige una de estas opciones:

**Opción A: `localhost` solo para vincular (la más sencilla).** Define `PUBLIC_URL=http://localhost:3000` y registra
`http://localhost:3000/auth/google/callback`. Después abre la administración *como localhost* solo cuando vayas a
vincular una cuenta: en el propio servidor o desde tu portátil a través de un túnel SSH:

```bash
ssh -L 3000:localhost:3000 user@<server-ip>
# después abre http://localhost:3000/admin/ en tu portátil y pulsa "Vincular cuenta"
```

El token de actualización se guarda en el servidor y se renueva automáticamente, así que el resto del tiempo usas la
administración con normalidad en `http://<server-ip>:3000/admin/` (solo vincular una cuenta de Google necesita la URL de
localhost).

**Opción B: tu propio dominio con HTTPS.** Pon delante un proxy inverso con un certificado válido, define
`PUBLIC_URL=https://calendar.example.com` y registra `https://calendar.example.com/auth/google/callback`.

- **Caddy** (Let's Encrypt automático): consulta [`deploy/Caddyfile.example`](deploy/Caddyfile.example). Explica qué
  exponer en cada modo de acceso: en modo privado las pantallas pueden pasar por el proxy con sus claves; en modo
  abierto solo deben ser accesibles desde Internet las rutas de administración, inicio de sesión y configuración
  inicial (más `/assets` y `/media`). Las fotos de la galería en `/media/` solo se envían a clientes de la red local, a
  claves de pantalla válidas o a un administrador con sesión iniciada.

  ```bash
  sudo apt install caddy
  sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile   # edita el dominio
  sudo systemctl reload caddy
  ```

- **Cloudflare Tunnel** (sin abrir puertos): `cloudflared tunnel create calendar`, dirige `calendar.example.com` a
  `http://localhost:3000` en la configuración del túnel y, si quieres, protégelo con Cloudflare Access. Los
  Server-Sent Events funcionan a través del túnel.
- Define **`TRUST_PROXY`** siempre que el proxy no se conecte desde `127.0.0.1`: un proxy en **otra máquina**
  (`TRUST_PROXY=<proxy-ip>`) o **cualquier proxy delante del contenedor Docker** (`TRUST_PROXY=172.16.0.0/12`, el
  bridge de Docker). Sin él, el servidor ve la dirección del proxy en lugar de la del visitante: todo el que pasa por
  él se trata como remoto (se exige el token de configuración y se rechaza lo que es solo para la red local) y la
  cookie de sesión no se marca `Secure`. El registro avisa de un proxy no fiable cuando ocurre.

**Opción C: sin OAuth, la dirección secreta iCal.** En Google Calendar en la web → ⚙️ *Configuración* → elige el
calendario → *Integrar el calendario* → **Dirección secreta en formato iCal** (*Secret address in iCal format*). Añade
esa URL como fuente **iCal**. No necesitas ningún proyecto de Google Cloud; sin embargo, Google actualiza esta fuente
con retraso (de minutos a horas) y cualquiera que tenga la URL puede leer el calendario: trátala como una contraseña.

### 3. Elige tus calendarios

**Administración → Calendarios → Cuentas de Google → Vincular cuenta**, acepta los permisos y marca los calendarios que
quieres mostrar. Cada uno se convierte en una fuente a la que puedes cambiar el nombre y asignar un emoji, un color y un
**tipo**: p. ej., un calendario que solo contiene cumpleaños → tipo *Cumpleaños* (🎂 y edades), un calendario de
festivos → *Festivos*. Puedes vincular varias cuentas de Google.

**Para entrar en la administración** se usa la contraseña del servidor. Google es solo para los calendarios: "Iniciar
sesión con Google" está desactivado en un servidor de casa. Si de verdad lo quieres (por ejemplo para quitar la
contraseña), pon `MARCO_GOOGLE_LOGIN=1` en `.env` y añade las direcciones en **Seguridad → Emails de Google
permitidos**. Los servidores que ya entran solo con Google (contraseña desactivada y emails permitidos) lo conservan.

## Conectar Outlook, Hotmail o Microsoft 365

Opcional y de solo lectura. Con tu propia app de Microsoft Entra, *Calendarios → Cuentas vinculadas → Vincular
cuenta* ofrece también **Microsoft**: cuentas personales (Outlook.com, Hotmail, Live) y cuentas del trabajo o del
centro educativo (Microsoft 365). Sin ella la opción no aparece, y la dirección ICS del calendario (*Outlook →
Configuración → Calendario → Calendarios compartidos → Publicar un calendario*) sigue funcionando.

1. Entra en <https://entra.microsoft.com/> → **Registros de aplicaciones → Nuevo registro**:
   - **Tipos de cuenta compatibles**: *Cuentas en cualquier directorio organizativo y cuentas personales de
     Microsoft*.
   - **URI de redirección**: plataforma **Web**, `<PUBLIC_URL>/auth/microsoft/callback`, por ejemplo
     `http://localhost:3000/auth/microsoft/callback` (Microsoft, como Google, solo acepta `http://` para
     `localhost`; mira las opciones de la URI de redirección más arriba).
2. **Permisos de API → Agregar un permiso → Microsoft Graph → Permisos delegados**: `Calendars.Read`,
   `Calendars.Read.Shared`, `offline_access`, `openid`, `email`, `profile`. Las cuentas personales no necesitan
   consentimiento de administrador.
3. **Certificados y secretos → Nuevo secreto de cliente**, copia su **Valor**, y el **Id. de aplicación (cliente)**
   de *Información general*. Ponlos en `.env` y reinicia:

   ```ini
   MICROSOFT_CLIENT_ID=<id-de-aplicacion>
   MICROSOFT_CLIENT_SECRET=<valor-del-secreto>
   ```

Marco guarda los tokens de cada cuenta en `data/secrets.json` (Microsoft entrega un token de actualización nuevo cada
hora y se guarda el último). *Desvincular* los borra; desde aquí no se pueden revocar en Microsoft, así que para
retirar el acceso entra en <https://account.live.com/consent/Manage> (cuenta personal) o en
<https://myapps.microsoft.com> (cuenta del trabajo o del centro educativo). Los secretos de cliente caducan (de 6 a 24
meses): crea uno nuevo antes y actualiza `.env`.

## Añadir un calendario de Apple iCloud

iCloud no se vincula con una cuenta como Google o Microsoft: Marco lee el enlace público de cada calendario.
*Calendarios → Cuentas vinculadas → Vincular cuenta → Apple iCloud* abre una guía corta para sacarlo:

- **iPhone o iPad:** app Calendario → *Calendarios* → ⓘ junto al calendario → activa *Calendario público* →
  *Compartir enlace* → *Copiar*.
- **Mac:** app Calendario → icono de compartir junto al calendario (o clic derecho → *Compartir calendario*) →
  *Calendario público* → copia la dirección `webcal://`.
- **iCloud.com:** icloud.com/calendar → icono de compartir junto al calendario → *Calendario público* → *Copiar*.

Pega el enlace en la guía: Marco lo prueba y lo añade como calendario iCal (los enlaces `webcal://` valen). No hace
falta configurar nada en el servidor. Cualquiera que tenga el enlace puede ver el calendario, aunque es largo e
imposible de adivinar; para retirarlo, desactiva *Calendario público* en iCloud.

## Otras integraciones

- **Fuentes iCal / ICS:** cualquier URL `http(s)://` o `webcal://`: colegio, club deportivo, trabajo, festivos
  (conjuntos predefinidos para varios países en *Calendarios → Añadir rápido*), plataformas de alquiler vacacional.
  *Probar* muestra cuántos eventos se han leído. Si la fuente usa un **certificado autofirmado**, activa *Certificado
  autofirmado* solo en esa fuente (o añade tu CA con `NODE_EXTRA_CA_CERTS`). Una fuente que falla nunca rompe las
  demás; los errores aparecen en *Estado* y *Actividad*.
- **Alquileres vacacionales:** establece el tipo en *Alquiler vacacional*. Las entradas "Reserved" / "Not available"
  de Airbnb se convierten en barras "Reserva · Huésped" (las fechas bloqueadas se pueden ocultar con un filtro); las
  fuentes que ya formatean los títulos como `🏠 Guest - 4p+1m` conservan su emoji y convierten el número de huéspedes en
  iconos; las líneas `Adults: 2 / Children: 1 / Infants: 1 / Pets: 1` de la descripción (también
  `Adultos/Niños/Bebés/Mascotas`) dan 🧑🏻🧑🏻 🧒🏻 👶🏻 🐶.
- **Tiempo:** define la ubicación (búsqueda por nombre o coordenadas) y las unidades en *Tiempo* y elige la fuente
  en *Tiempo → Fuente de los datos* (`weather.provider`). Todas son gratuitas:

  | Fuente | Clave | Notas |
  |---|---|---|
  | [Open-Meteo](https://open-meteo.com/) (predeterminada) | no | Usa el mejor modelo para tu zona o el que elijas en *Modelo de previsión* (`weather.model`: `best_match`, `ecmwf_ifs`, `icon_seamless`, `gfs_seamless`, `meteofrance_seamless`, `ukmo_seamless`, `gem_seamless`, `jma_seamless`). Algunos modelos no dan probabilidad de lluvia ni índice UV, o dan menos días; esos datos no se muestran. Gratis para uso no comercial; datos con licencia CC BY 4.0. |
  | [MET Norway](https://api.met.no/) | no | Locationforecast 2.0 del instituto meteorológico de Noruega, para todo el mundo. Solo da probabilidad de lluvia en los países nórdicos; la salida y la puesta del sol se calculan. Marco se identifica con su User-Agent y respeta la hora de `Expires` que indica el servicio (unos 30 minutos). Datos con licencia CC BY 4.0 y NLOD. |
  | [Pirate Weather](https://pirateweather.net/) | tuya, gratuita | Crea una clave en [pirate-weather.apiable.io](https://pirate-weather.apiable.io/) y pégala en *Tiempo*. El plan gratuito permite 10.000 consultas al mes; Marco consulta como mucho cada 15 minutos (unas 3.000). La clave se comprueba una vez y se guarda en `data/secrets.json`. |

  Cada fuente se guarda en caché por lugar durante al menos 10 minutos y la comparten todas las pantallas e idiomas;
  si la fuente falla, las pantallas siguen mostrando la última previsión hasta 6 horas. Las pantallas muestran el
  nombre de la fuente en letra pequeña junto al tiempo (*Open-Meteo*, *Open-Meteo · ECMWF IFS*, *MET Norway*), como
  pide la licencia CC BY.
- **Home Assistant:** en Home Assistant abre tu **perfil → Seguridad → Tokens de acceso de larga duración → Crear
  token**; en *Administración → Home Assistant* introduce la URL (p. ej. `http://homeassistant.local:8123`) y el token,
  pulsa *Probar conexión* y, después, elige en *Tiempo* una entidad `weather.*` y/o entidades `sensor.*` de temperatura
  y humedad interiores. El token se queda en el servidor. Home Assistant también puede **enviar avisos** a las
  pantallas; consulta [webhooks](#tokens-de-api-y-webhooks).
- **Noticias (RSS/Atom):** añade cualquier fuente en *Noticias*. Algunos sitios bloquean los clientes que no son
  navegadores; el servidor ya usa el User-Agent de un navegador de escritorio. Usa *Probar* para comprobar una fuente.

## Fotos

- Las fotos de **stock** vienen de [picsum.photos](https://picsum.photos/) (gratis, sin clave). **Galería** usa tus
  propias fotos; **Mixto** alterna ambas. Configura el intervalo, el brillo, la transición y el efecto ambiental en
  *Fondo*.
- **Orden de las fotos** (*Fondo*): *Aleatorio* (al azar, sin repetir las fotos de la tanda anterior), *Más
  recientes primero* o *Por nombre*. Los órdenes secuenciales siguen donde lo dejó la pantalla y vuelven a empezar al
  terminar.
- **Elige qué fotos se muestran**: cada foto de la galería tiene un botón con un ojo para sacarla de la rotación (o
  devolverla) sin borrarla. El contador indica cuántas están en rotación; filtra por *En rotación* / *Ocultas* y usa
  *Seleccionar* para mostrar u ocultar muchas fotos a la vez. Si todas las fotos de la galería están ocultas, la
  pantalla usa fotos de stock.
- Sube fotos en **Administración → Galería** arrastrándolas y soltándolas (JPG, PNG, WebP, AVIF, GIF y **HEIC** del
  iPhone, hasta 100 MB cada una). Las fotos se optimizan **en tu navegador** antes de subirlas (se giran según los
  datos EXIF, se redimensionan a un máximo de 2560 px y se guardan como JPEG, con una miniatura de 480 px), así que ni
  el servidor ni la Pi tienen que procesar imágenes.
- El **punto focal** se detecta automáticamente (prominencia visual + tonos de piel). Haz clic en una foto para
  ajustarlo: el editor muestra exactamente lo que recortarán el panel lateral y los diseños a pantalla completa,
  incluidas las franjas que tapan el reloj y el tiempo.
- Consejo: las **fotos en vertical** encajan mejor en el panel lateral del diseño *calendario grande*; las fotos en
  horizontal quedan mejor en *hora grande* y *izquierda/derecha*.
- Si subes un archivo con un nombre que ya existe, se te pregunta si quieres sustituirlo, conservar ambos u omitirlo.
  Las fotos copiadas a mano en `data/photos/` se pueden optimizar más tarde con *Optimizar y encuadrar fotos
  existentes*.

## Varias pantallas, avisos y la API

### Pantallas y pantallas conectadas

Crea varias **pantallas** en *Sistema → Pantallas* ("Salón", "Cocina", "Pasillo"). Cada una tiene su propio diseño,
tema, fondo, widgets y conjunto de calendarios; los calendarios, las reglas y las integraciones son compartidos. Un
dispositivo muestra una pantalla con su [enlace privado](#enlaces-privados-y-vinculación-de-pantallas) o vinculándolo a
ella (en modo abierto también con `http://<server-ip>:3000/?screen=<slug>`; sin `?screen`, la predeterminada ★). El
selector **Editando: Salón ▾** de la cabecera de la administración elige qué pantalla editan las páginas que se
configuran por pantalla.

*Sistema → Pantallas conectadas* muestra todos los navegadores que están mostrando una pantalla (IP, navegador,
resolución, densidad de píxeles, WebGL, versión, último latido y cómo entró: enlace privado, dispositivo vinculado o
sin clave) con los botones **Recargar**, **Identificar** (muestra el nombre de la pantalla en letras grandes durante
10 s) y **Noche / Día / Auto**, además de **Vincular una pantalla** y la lista de dispositivos vinculados. Las
pantallas desactualizadas se señalan; *Recargar* las arregla.

### Avisos y mensajes programados

*Avisos → Enviar aviso ahora*: título, texto, emoji, estilo (*info*, *éxito*, *advertencia*, *urgente*), duración,
sonido y pantallas de destino. Los avisos activos sobreviven a un reinicio del servidor. Los *Mensajes programados*
aparecen a horas fijas en los días de la semana elegidos (las franjas pueden cruzar la medianoche).

### Tokens de API y webhooks

Crea un token en *Administración → API y webhooks* (se muestra una sola vez; solo se guarda un hash). Después, desde
Home Assistant:

```yaml
# configuration.yaml
rest_command:
  marco_alert:
    url: "http://homeserver.lan:3000/api/hooks/announce"
    method: POST
    headers:
      Authorization: "Bearer cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    content_type: "application/json"
    payload: >-
      {"title": {{ title | tojson }}, "body": {{ (body | default('')) | tojson }},
       "emoji": {{ (emoji | default('🔔')) | tojson }}, "style": "{{ style | default('info') }}",
       "durationSec": {{ duration | default(120) }}, "sound": true}

automation:
  - alias: "Aviso: lavadora terminada"
    triggers:
      - trigger: state
        entity_id: sensor.washing_machine_status
        to: "finished"
    actions:
      - action: rest_command.marco_alert
        data:
          title: "La lavadora ha terminado 🧺"
          emoji: "🧺"
          style: "success"
          duration: 300
```

O con `curl`:

```bash
TOKEN=cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl -H "Authorization: Bearer $TOKEN" http://homeserver.lan:3000/api/hooks/ping
# aviso urgente en la pantalla de la cocina durante 10 minutos
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"¡Horno encendido!","emoji":"🔥","style":"urgent","durationSec":600,"sound":true,"screens":["kitchen"]}' \
  http://homeserver.lan:3000/api/hooks/announce
# recargar todas las pantallas / modo noche on|off|auto
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' http://homeserver.lan:3000/api/hooks/reload
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"mode":"on"}' http://homeserver.lan:3000/api/hooks/night
```

Límites: 30 peticiones por minuto por token; errores `401` (token incorrecto), `400` (datos no válidos), `415` (no es
JSON), `429` (límite de peticiones). Referencia completa: [docs/API.md](docs/API.md).

### Copias de seguridad y actividad

- Cada vez que guardas, se conserva la configuración anterior en `data/backups/` (las 20 más recientes; varios
  guardados seguidos cuentan como uno). *Sistema → Copias de seguridad* permite descargarlas, restaurarlas o borrarlas
  y crear copias manuales.
- **Exportar** descarga todo en un único archivo JSON, opcionalmente con los secretos (hash de la contraseña, token de
  Home Assistant, cuentas de Google, tokens de API; guárdalo en un lugar seguro). **Importar** muestra qué cambia en
  cada sección antes de aplicarlo.
- *Sistema → Actividad* registra los inicios de sesión (y los intentos fallidos), los guardados, las restauraciones,
  los avisos, el uso de la API, las conexiones de pantallas y los errores de calendarios. Las contraseñas, los tokens
  y las URL de los calendarios nunca se registran.

## Referencia de configuración

### Variables de entorno (`.env`)

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `HOST` | `0.0.0.0` | Dirección en la que escucha |
| `PUBLIC_URL` | se deduce de cada petición | URL de la administración a través de tu dominio, usada para la redirección de Google OAuth `${PUBLIC_URL}/auth/google/callback`; su host también se acepta en la comprobación de nombres de host |
| `ALLOWED_HOSTS` | ninguno | Nombres de host adicionales a los que responde el servidor, separados por comas (`.example.com` = también subdominios). Las IP, `localhost`, los nombres de una etiqueta y `*.local`/`*.lan`/`*.home.arpa`/`*.internal` funcionan siempre; el resto recibe `421` (protección contra DNS rebinding) |
| `SESSION_SECRET` | aleatorio (guardado en `data/secrets.json`) | Secreto que firma la cookie de sesión |
| `SETUP_TOKEN` | ninguno | Exige este token (al menos 16 caracteres) para usar el asistente de configuración inicial (`/admin/?setup=<token>`). Sin él, el asistente funciona desde la red local y, desde fuera, pide el token que se escribe en el registro en cada arranque |
| `SETUP_REQUIRE_TOKEN` | ninguno (`1` en Docker) | `1` = el asistente pide siempre el token del registro, también desde la red local |
| `ADMIN_PASSWORD` | ninguno | Solo instalaciones sin navegador: contraseña inicial en lugar del asistente (se usa hasta que se guarda una contraseña; el panel propone cambiarla). Un valor que no cumple las reglas del asistente (menos de 10 caracteres o una contraseña común) solo funciona desde la red local y hay que cambiarlo |
| `LAN_ADDRESS` | detectada | Dirección de este servidor en la red local para el código QR de bienvenida de la pantalla (defínela en Docker, donde no se puede detectar) |
| `DATA_DIR` | `./data` (`/data` en Docker, `<carpeta de instalación>/data` con el instalador) | Dónde se guardan la configuración, los secretos, las fotos y las copias de seguridad |
| `COOKIE_SECURE` | según la petición | `1` = cookie siempre `Secure`, `0` = nunca |
| `TRUST_PROXY` | `loopback` | IP o rangos de los proxies inversos que pueden definir `X-Forwarded-*`. Necesario para un proxy en otro host y para cualquier proxy delante de Docker (`172.16.0.0/12`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ninguno | Cliente OAuth de Google ([guía](#conectar-google-calendar)) |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | ninguno | App de Microsoft Entra para calendarios de Outlook y Microsoft 365 ([guía](#conectar-outlook-hotmail-o-microsoft-365)) |
| `NODE_EXTRA_CA_CERTS` | ninguno | Certificados de CA adicionales para fuentes iCal con una CA privada |
| `TZ` | la zona de *Fecha y hora* (sigue los cambios al momento) | Zona horaria del proceso (usada para las horas iCal "flotantes"). Definirla aquí la fija |
| `MARCO_UPDATE_CHECK` | activada | `0` = no preguntar nunca a GitHub si hay una versión nueva (sin aviso de actualización) |

Con Docker Compose solo llegan al contenedor las variables que aparecen en `docker-compose.yml`; el `.env` de al lado
les da valor.

### Directorio de datos

```
data/
├── config.json          # todos los ajustes (pantallas, calendarios, reglas, eventos, cumpleaños)
├── secrets.json         # hash de la contraseña, secreto de sesión, tokens de Google y Home Assistant, hashes de los tokens de API,
│                        #   claves de los enlaces privados, hashes de las llaves de los dispositivos vinculados,
│                        #   clave de API del tiempo (modo 600)
├── photos/              # galería (+ .thumbs/ y .meta.json con los puntos focales y las fotos ocultas)
├── backups/             # copias de seguridad de la configuración automáticas y manuales
├── cache/               # cachés de las fuentes
├── activity.jsonl       # registro de actividad
├── announcements.json   # avisos activos + historial
├── displays.json        # pantallas conocidas
└── update/              # última comprobación, ajustes de actualización y registro de la última actualización
```

Haz copia de seguridad de toda la carpeta (o usa *Exportar*) para conservarlo todo.

### Parámetros de URL de la pantalla

| Parámetro | Efecto |
|---|---|
| `/d/<clave>` | Enlace privado de una pantalla (la clave decide la pantalla) |
| `/pair` | Muestra un código de vinculación (también en modo abierto) |
| `?screen=<slug>` | Muestra ese perfil de pantalla (la predeterminada si no se indica o no existe); solo en modo abierto o con sesión del panel |
| `?lite=1` | Sin efectos WebGL (dispositivos lentos) |
| `?demo=1` | Datos de ejemplo integrados (no necesita datos del servidor) |
| `?lang=en\|es\|pt` | Fuerza el idioma |
| `?preset=…` `?view=month\|agenda\|week` `?theme=dark\|light` `?style=classic\|modern` `?side=left\|right` `?clock=analog` | Fuerza opciones de diseño (útil para hacer pruebas) |
| `?preset=today\|people\|photoFrame\|twoWeeks\|board\|bedside` `?people=<ids de calendario, separados por comas>` `?corner=tl\|tr\|bl\|br` | Prueba los diseños nuevos, las columnas de *Por persona* y la esquina de *Marco de fotos* |
| `?glass=clear\|tinted\|auto` `?glassOpacity=0..1` `?glassBlur=0..40` `?glassTint=dark\|light\|photo` `?glassEdge=0\|1` | Fuerza las opciones de cristal del estilo Moderno |
| `?wxfx=off\|simple\|rich` | Fuerza el efecto del tiempo; con `?demo=1`, `?wx=rain\|drizzle\|thunder\|snow\|clear` (o un código WMO, p. ej. `45` para niebla) fuerza el tiempo |
| `?ambient=aurora\|particles\|none` | Fuerza el fondo ambiental detrás del calendario |
| `?demo=1&pair=1` `?demo=1&pair=invalid` `&pairLen=6\|8` | Muestra la pantalla de vinculación o la de “enlace ya no válido” con un código de ejemplo (sin servidor) |
| `?empty=1` `?photos=0` | Con `?demo=1`: sin eventos, cuentas atrás ni tareas, o sin foto de fondo (para ver los estados vacíos) |
| `?marquee=0\|1` `?rotate=0\|1` | Desactiva (o activa) los títulos largos que se deslizan (eventos del calendario, las píldoras junto al reloj, las cuentas atrás, el titular de las noticias; los de varias líneas suben línea a línea) y los días con muchos eventos que los muestran por turnos (*Calendarios → Vista del calendario*); con `?demo=1`, `&busy=1` añade un día lleno y títulos largos para probarlo |
| `?compact=0\|1` `?weeks=1..8` | Desactiva (o activa) los días llenos en compacto: un día en el que no caben sus eventos los muestra en líneas pequeñas y las filas de semanas se reparten el alto según los eventos que tienen (*Calendarios → Vista del calendario*); `?weeks=` muestra ese número de semanas, `?dense=1` muestra cada día como una lista con los títulos completos, `?calfs=0.4..1.5` cambia el tamaño de las entradas de la cuadrícula y `?startToday=1` empieza la cuadrícula en hoy en vez de en el primer día de la semana. Con `?demo=1`, `&busy=2` llena todo el mes |
| `?client=<name>` | Nombre de este dispositivo en *Pantallas conectadas* (lo define el script del kiosco) |

## Seguridad

Marco se diseñó para una red doméstica; desde la 0.3 las pantallas son **privadas por defecto**.

- **Pantallas** (`/`, `/d/<clave>` y la API de la pantalla: `/api/display/*`, `/api/events`, `/api/weather`,
  `/api/news`, `/api/photos`, `/api/countdowns`, `/api/stream`, `/media/*`): necesitan la clave del enlace privado, la
  llave de un dispositivo vinculado o una sesión del panel; si no, responden `401`/`403` sin datos. Las claves se
  comparan en tiempo constante, nunca se registran y no salen en el referer (`Referrer-Policy: no-referrer`) ni en
  cachés (`no-store`). En modo **abierto** (instalaciones actualizadas desde la 0.2 hasta que lo cambies) la API de la
  pantalla no pide nada: entonces **no la expongas a Internet**.
- **Protegido**: la administración (`/admin/`, `/api/admin/*`) requiere una sesión (contraseña y/o cuentas de Google
  permitidas); los webhooks requieren un token de tipo bearer.
- Una instalación nueva **no tiene contraseña por defecto**; la crea el
  [asistente de configuración](#primeros-pasos-el-asistente-de-configuración). Define `SETUP_TOKEN` si el servidor es
  accesible desde fuera de tu red local antes de terminar la configuración.
- Los nombres de host desconocidos se rechazan (protección contra DNS rebinding); añade tu dominio con `PUBLIC_URL` /
  `ALLOWED_HOSTS`.
- Si quieres acceso remoto, usa un **proxy inverso con HTTPS** ([ejemplo de Caddy](deploy/Caddyfile.example)). En modo
  privado las pantallas también pueden pasar por él; en modo abierto expón solo las rutas de administración, inicio de
  sesión y configuración inicial. Usa una **contraseña segura** y `TRUST_PROXY` siempre que el proxy no se conecte
  desde loopback (otro host o Docker). En redes que no controlas, usa HTTPS para que nadie pueda capturar una clave.
- Las URL de calendarios, RSS y Home Assistant que introduces en la administración las descarga **el servidor**,
  direcciones de la red local incluidas.
- Mantén en privado `.env`, `data/secrets.json`, las exportaciones con secretos y `data/backups/`.
- El instalador y `marco update` comprueban el SHA-256 de cada paquete (y de Node.js) antes de instalarlo.
  Las compilaciones desde git (solo antes de la primera versión, o en instalaciones que se compilaron desde git) no
  tienen suma que comprobar.
- El botón *Actualizar ahora* del panel nunca da permisos de root al servidor: solo crea un archivo que vigila una
  unidad de systemd de root, y esa unidad siempre instala la última versión, con la suma comprobada
  ([Actualizaciones](#actualizaciones)).

Consulta [SECURITY.md](SECURITY.md) para informar de una vulnerabilidad.

## Desarrollo

```bash
npm ci
npm run dev          # servidor en :3000 (node --watch) + Vite en :5173 (hace de proxy de /api, /auth, /media)
                     # pantalla http://localhost:5173/  ·  administración http://localhost:5173/admin/
npm test             # tests del servidor (node --test)
npm run typecheck    # TypeScript (pantalla + administración)
npm run build        # compilación de producción en dist/
```

| Carpeta | Contenido |
|---|---|
| `server/` | API con Express 5, JavaScript ESM sin más, sin paso de compilación (`routes/`, `lib/`, `test/`) |
| `web/display/` | La pantalla: TypeScript sin frameworks + three.js |
| `web/admin/` | El panel de administración: Preact + TypeScript |
| `web/shared/` | Tipos compartidos, i18n, reglas de iconos, recorte por punto focal, logo |
| `install.sh` | El instalador de una línea |
| `deploy/` | Comando `marco`, instalador para copias de git, unidad de systemd, scripts del kiosco y del horario de pantalla, ejemplo de Caddy |
| `scripts/` | `npm run demo`, empaquetado de versiones y notas de versión |
| `docs/` | [Arquitectura](docs/ARCHITECTURE.md), [API](docs/API.md), capturas de pantalla, logo e imágenes del README |

Las contribuciones son bienvenidas: lee [CONTRIBUTING.md](CONTRIBUTING.md). Notas de versión: [CHANGELOG.md](CHANGELOG.md).

## Licencia

[MIT](LICENSE) © 2026 colaboradores de Marco. Los componentes de terceros mantienen sus propias licencias, en
particular el decodificador HEIC (LGPL-3.0, cargado como un fragmento independiente sin modificar) y las fuentes Inter /
Outfit (OFL-1.1); consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Agradecimientos

- [DAKboard](https://dakboard.com/), por la idea de un panel de pared (este proyecto no está afiliado a él).
- [Open-Meteo](https://open-meteo.com/) y [MET Norway](https://api.met.no/): API meteorológicas gratuitas (datos bajo
  CC BY 4.0), y [Pirate Weather](https://pirateweather.net/).
- [Lorem Picsum](https://picsum.photos/) y los fotógrafos de Unsplash, por las fotos de stock.
- [three.js](https://threejs.org/), [Preact](https://preactjs.com/), [Vite](https://vite.dev/),
  [Express](https://expressjs.com/), [node-ical](https://github.com/jens-maus/node-ical), [rrule](https://github.com/jkbrzt/rrule),
  [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser), [heic-to](https://github.com/hoppergee/heic-to),
  [Inter](https://rsms.me/inter/) y [Outfit](https://fonts.google.com/specimen/Outfit).
