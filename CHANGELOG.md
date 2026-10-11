# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Start on today (`calendar.startToday`, per screen, *Calendars → Calendar view*): the month, two weeks and week grids
  start on today instead of the first day of the week, so days that have passed take no room. Each row is seven days
  from today and the weekday header follows. Off by default; `?startToday=0|1` tries it on one display.
- Entry size (`calendar.fontScale`, per screen, *Calendars → Calendar view*, 40% to 150%): the size of the events in
  the month, two weeks and week grids, separate from the screen's text size. A smaller size fits more events and
  longer titles per day while the clock, weather and day numbers stay as they are. `?calfs=0.6` tries it on one display.

## [0.6.1] - 2026-10-11

### Added
- Doorbell on servers without a live camera (`features.doorbellLive` off, Marco Cloud): the ring carries a snapshot
  from Home Assistant (multipart `image` or a raw image body), and the admin shows the doorbell card on *API &
  webhooks* with a Home Assistant example and a test with a sample picture.

### Fixed
- Doorbell: when the picture arrives after the ring has started, screens that are already ringing now show it.

## [0.6.0] - 2026-10-11

### Added
- Private mode per screen, for when you have guests. While it is on, events of each calendar show as "Busy" (time,
  length and calendar colour only), are hidden, or stay as they are (*In private mode*, per calendar; holidays and
  birthdays stay by default). The server filters events and countdowns before they reach the display, so the screen
  never receives the real titles, places or notes. Optional per screen: stock photos instead of the gallery, and a
  small lock in the corner (on by default).
- Private mode can be turned on from Home (1 h, 3 h, until tomorrow, until turned off; one screen or all), on a
  schedule per screen (days and times, may cross midnight), or from Home Assistant with `POST /api/hooks/privacy`
  (`GET` reads the state). The admin shows a banner while it is on, and it turns off by itself when the time is up.
- Doorbell camera. `POST /api/hooks/doorbell` (`{ action: "ring" | "dismiss", seconds?, screens?, camera? }`) puts a
  Home Assistant camera full screen on the chosen screens for 10 to 300 seconds (60 by default), with a door chime.
  Ringing again makes it last longer; `dismiss` (for example when the door opens) takes it away. It shows above night
  mode and private mode, so a dimmed screen wakes up while it lasts and goes back to night mode afterwards.
- *Home Assistant → Doorbell and camera*: the camera entity, time on screen, screens, door chime and a *Test* button.
  The picture goes through Marco (`GET /api/display/doorbell/frame`), only to screens that are ringing at that
  moment, one or two frames a second, shared between screens for half a second. The Home Assistant token never
  reaches a screen and no picture is stored. Rings are logged in *Activity*.
- Compact busy days (`calendar.compactBusyDays`, per screen, *Calendars → Calendar view*): in the month, two weeks and
  week grids, a day that cannot fit its events at normal size lists them as small one-line entries (emoji, time or
  all-day colour, title) below its multi-day bars. Week rows share the height by how many events they have, with
  room for the dates and one event in every row; rows stay equal while every week fits. Only what still does not fit
  takes turns (*Rotate busy days*) or shows "+N". On for new screens, off for existing ones.
- `features.privacy`, `features.doorbell` and `features.doorbellLive` in `/api/health`.
- Display demo: `?demo=1` with `&private=1` (private mode), `&doorbell=1` or `&doorbell=nocam` (a ring with a drawn
  camera picture, or without one) and `&busy=2` (a whole month packed with events). They can be combined. Also
  `?compact=0|1` and `?weeks=1..8` on any screen.

## [0.5.3] - 2026-10-11

### Fixed
- Status: the weather and news cards no longer cut "23 seconds ago" in narrow cards; the text wraps under itself.

## [0.5.2] - 2026-10-11

### Added
- Admin: *Help and feedback* form on servers that offer it (`features.feedback`, Marco Cloud only), with a GitHub link.

### Changed
- The admin sidebar shows the Marco logo and wordmark instead of "Family calendar".
- Installer menu: *Server only* is option 1 and *All in one* option 2 (the default for a device with a desktop is still All in one).
- **Long titles slide in more places**: timed chips in the month, Two weeks and week grids, the pills next to the
  clock ("In 23 min · …", check-outs, birthdays), countdowns, scheduled messages and the news headline. A chip title
  cut after a few lines in a month cell now scrolls up a line at a time, like film credits, and comes back; its box
  keeps its size, and the time stays on top when it has a line to itself. The news headline slides once, within the
  time each item shows.
- An event alone on its day in a month cell can use all the free height of the day instead of stopping at three
  lines; days shared with other events keep about two lines per event.

## [0.5.1] - 2026-10-10

### Added
- **Apple iCloud calendars**: *Calendars → Linked accounts → Link account* now offers Apple iCloud. It opens a short
  guide (iPhone or iPad, Mac, iCloud.com) to get the calendar's public link, then tests the link and adds it as an
  iCal calendar. `webcal://` links are accepted. No server setup needed.
- **Long titles slide**: an all-day or multi-day bar in the month or week grid, or a title in the Agenda, Today,
  Per person and Board views, that does not fit slides slowly to show the rest, waits, and slides back. Titles that
  fit never move, timed chips in month cells keep their "…", and nothing moves when the device asks for reduced
  motion. With `?lite=1` at most six titles move at once.
- **Busy days take turns**: a day in the month or Two weeks grid with more events than fit shows them in turns every
  8 seconds, and the "+N more" label becomes a page count ("1/2"). Bars that cover several days stay where they are;
  when they fill every row of a day, the bottom one leaves that day free so the day's own events still show.
- Both are on by default and can be turned off per screen in *Calendars → Calendar view*; `?marquee=0` and
  `?rotate=0` turn them off for a test, and `?demo=1&busy=1` adds a busy day and long titles to the demo.

### Changed
- New demo video and README animation in the Modern style, with no flicker: layouts, an alert from a phone, weather
  effects, a portrait screen, the admin and the night clock.
- **Sign in with Google is off on self-hosted servers** by default: the admin uses the server's password, and Google
  is for calendars. `MARCO_GOOGLE_LOGIN=1` turns it on; servers that already sign in with Google only (password off,
  allowed emails set) keep it.
- **Google Calendar** leaves out Google Workspace working-location entries ("Home", "Office").
- The linked accounts chooser closes with an X instead of a Cancel button.

### Security
- Every response now sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and
  `frame-ancestors 'self'`, so no other site can frame the admin. The display and admin pages (also as `/index.html`
  and `/admin/index.html`) are never cached, and admin changes refuse a `Sec-Fetch-Site` other than `same-origin`.
- With Google sign-in off, sessions made with Google before end too, and the Google callback refuses a sign-in.
  The OAuth purpose (sign in or link calendars) is kept in the session instead of being read back from the state
  the browser returns.

### Fixed
- Turning *Rotate busy days* off now brings back the "+N more" label at once; before, a busy day kept its page
  count ("1/2") and kept turning it until the screen reloaded.
- With the Modern style, emoji in text fall back to the bundled emoji font, so an offline device without a color
  emoji font no longer shows empty boxes.
- The activity log names the *Display access* change instead of showing the raw `security` key, and the search
  finds *Download photos (.zip)*.
- The demo in Portuguese (`?demo=1&lang=pt`) is now Portuguese everywhere: to-dos, the message, holidays, places,
  news and the wind direction no longer fall back to English.
- A display that shows the pairing or invalid link screen before it ever loaded its settings no longer keeps asking
  the server for them every 10 seconds.
- Calendar errors in the Home source list and the Home Assistant *Test connection* result are shown in the admin's
  language, like on the Status page, instead of the raw technical text.
- Changing the time zone in *Date & time* now also rebuilds the calendar view from calendars without a time zone
  of their own (floating times), even when a screen asked for its events while the calendars were being reloaded.
- A very long title in the next-event capsule under the clock no longer pushes it past the edge of the side panel.
- Today: when the all-day chips do not fit next to the title, the last ones are left out instead of the first one
  losing the start of its title.
- A large font size (*Screen → Font size*) no longer pushes the clock's last digit onto a second line: the clock
  never wraps and shrinks to the width of its column.
- With the Modern style the screen now fades in once the first photo is ready, so the glass cards never show a
  plain dark background that turns into blur a second later, and the first photo's tone applies at once (the
  glass and the chips no longer fade to a new opacity right after the screen appears).
- Marco Cloud: sign-up goes straight to Inicio, with a welcome card to put Marco on a TV.

### Added
- **Microsoft calendars**: link Outlook.com, Hotmail or Microsoft 365 accounts (read only) and pick their calendars,
  including the ones other people shared with you. Optional on a self-hosted server: it needs your own Microsoft Entra
  app (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, see *Connecting Outlook, Hotmail or Microsoft 365* in the
  README); without it the option is not shown. Calendar sources get a new type `microsoft` (`microsoftAccount`,
  `microsoftCalendarId`), `/api/health` a new `features.microsoftCalendar` and `/api/auth/me` a `microsoftConfigured`.
  Tokens are kept in `data/secrets.json` and go into exports with secrets, like Google accounts.
- **Linked accounts** (*Calendars*): one card for Google and Microsoft accounts. *Link account* asks which provider
  when both are set up, and every linked account is listed one below the other with its calendars.

## [0.5.0] - 2026-10-10

A Modern display style with glass options, six new layouts, a choice of free weather sources, alerts and display commands in poll mode, a capability block in `/api/health` that the admin follows, a pairing
confirm step, place search through the server, and the shared logic moved into `server/core`.

### Added
- **Update notices and updates from the admin**: once a day the server asks GitHub which release is the latest (one
  `GET` to the public API, no identifier, `If-None-Match` so an unchanged answer is not downloaded again) and the
  admin shows a banner, *Marco 0.5.1 is available*, with the release notes. On installs made with the one-line
  installer, **Update now** installs it from the admin: the server writes `data/update/request`, a systemd path unit
  (`marco-update.path`, installed by the installer) runs `marco update --requested` as root, and the admin follows
  the progress, shows the log and the result (updated, or rolled back to the previous version) and reloads itself;
  the screens reload on their own. Docker and git installs get the commands to copy instead. *Status → Updates* has
  the daily check switch, *Check now* and **automatic updates** (off by default) inside a time window, 03:00 to
  05:00 by default; a version that fails is not retried. `MARCO_UPDATE_CHECK=0` turns the check off. New feature
  flag `updates` in `/api/health` (self-hosted only) and `GET /api/admin/update`, `PUT /api/admin/update/settings`,
  `POST /api/admin/update/check`, `POST /api/admin/update/apply`. Marco Cloud shows a one-time *What's new* with the
  CHANGELOG section of a new version instead. Installs updated from 0.4 get the button after one more
  `marco update` on the server.
- **More date formats** (*Date & time > Date format*): US style with the year ("Saturday, October 10, 2026"), numeric month/day/year and day/month/year ("Saturday, 10/10/2026", tagged in the admin so the order is clear) and ISO 8601 ("Saturday, 2026-10-10"). The admin preview now uses the display's own renderer. *Custom* takes your own pattern (`datetime.dateCustom`, up to 60 characters) with `{dddd}` `{ddd}` `{d}` `{dd}` `{mmmm}` `{mmm}` `{m}` `{mm}` `{yyyy}` `{yy}` and any text, with clickable variables and a live preview. Date formats are a compact grid.
- **Weather sources** (*Weather → Data source*, `weather.provider`): besides Open-Meteo, the forecast can now come from
  [MET Norway](https://api.met.no/) (Locationforecast 2.0, worldwide, no key) or [Pirate Weather](https://pirateweather.net/)
  (your own free key, 10,000 calls a month; Marco uses about 3,000). With Open-Meteo you can also pick the forecast
  model (`weather.model`): *Automatic* (as before), ECMWF IFS, DWD ICON, NOAA GFS, Météo-France, UK Met Office, GEM
  or JMA. Each source shows a short description and its licence in the admin, and the screens credit it in small type
  next to the weather (*Open-Meteo*, *Open-Meteo · ECMWF IFS*, *MET Norway*), in Classic and Modern, as the CC BY
  licences ask. `GET /api/weather` has a new `source` field. The Pirate Weather key is pasted in *Weather*, tried once
  (`PUT /api/admin/weather/key`), kept in `data/secrets.json`, included in exports with secrets and never sent back.
  Values a source does not give (chance of rain from MET Norway outside the Nordics, UV from some models) are left
  out instead of showing a dash. MET Norway's sleet now has its own description ("Sleet"). The provider code lives in
  `server/core/weather.js`, so Marco Cloud offers the same sources.
- **Display style** (*Layout → Display style*, `screen.style`): every screen can now be *Modern* or *Classic* (the look so far).
  New installs and new screens start Modern; screens saved before this release keep Classic, so nothing changes
  until you pick it. *Modern* is a more minimal, Apple-like look: glass widget
  cards over the photo with a light edge, a Lock Screen clock with the date on top, the month grid in the iOS
  Calendar idiom (no column lines, today as a filled circle, colour dots for timed events), agenda days as list
  cards, a Weather-widget layout, notification-style alerts and scheduled messages. It works with every layout,
  portrait and landscape, the light and dark themes, night mode, the weather effect and `?lite=1` (solid cards
  instead of blur). Modern uses the system font (SF on Apple devices) and falls back to the bundled Inter
  elsewhere. Preview it with `?style=modern` (or `?style=classic`).
- **Glass options for the Modern style** (*Layout → Glass*, `screen.glass`, shown when a screen uses Modern), in the
  spirit of the iPhone's glass settings: *Appearance* (*Clear*, *Tinted*, or *Automatic*, which follows each photo:
  clearer over dark photos, more tinted over bright ones), *Transparency* (from see-through to solid), *Blur*, *Tint*
  (*Dark*, *Light* with dark text, or *From the photo*, a deep version of the current photo's colour) and *Edge
  highlight*. A live preview over a dark and a bright sample photo shows the result. The defaults are the Modern look
  as it was. Everything is a few CSS variables, so it costs nothing extra on the Pi; with `?lite=1` there is still no
  blur and the cards stay solid. Preview with `?glass=clear|tinted|auto`, `&glassOpacity=0..1`, `&glassBlur=0..40`,
  `&glassTint=dark|light|photo`, `&glassEdge=0|1`.
- **Six new layouts** (*Layout*, `layout.preset`), each in landscape and portrait, Classic and Modern, light and dark,
  night mode and `?lite=1`:
  - *Today* (`today`): the day hour by hour with a line for now and past events dimmed, the next event in large type
    and the weather for the coming hours. Made for the kitchen in the morning.
  - *Per person* (`people`): one column per calendar with today and tomorrow. Choose up to five calendars in
    *Layout → Columns per person* (`layout.people`); holidays and birthdays go in a shared line above.
  - *Photo frame* (`photoFrame`): the photo with a small clock, temperature and next event card in a corner of your
    choice (`layout.corner`: `tl`, `tr`, `bl`, `br`). Made for a portrait frame.
  - *Two weeks* (`twoWeeks`): this week and the next as a roomy grid, today highlighted.
  - *Board* (`board`): a family organisation board with the to-do list, countdowns, the message of the day, upcoming
    birthdays and a short agenda.
  - *Bedside* (`bedside`): a huge, very dim clock with the next event and the temperature; deeper and dimmer during
    the night window. No photo and no animation.
  Preview with `?preset=today|people|photoFrame|twoWeeks|board|bedside`, `&people=<ids>` and `&corner=tl|tr|bl|br`.
  The setup wizard still offers the five original layouts; the new ones are in *Layout*.
- Demo URL parameters `?empty=1` (no events, countdowns or to-dos) and `?photos=0` (no background photo) to check
  the empty states of every layout.
- **Poll channel for displays** (`GET /api/display/poll`): with `MARCO_LIVE=poll` (or any server that answers
  `live: 'poll'`), displays get announcements, identify, night mode, refresh, gallery and calendar changes from a
  short poll instead of the stream. The server picks the delay: 30 s, 5 s while *Connected screens* is open or right
  after a command, 3 min while the page is hidden. A server restart or a lost cursor replays the active
  announcements, never old commands. A display that polled in the last 4 minutes is listed as connected and counts
  in "sent to N screens". Version reloads and moved devices work in this mode too, and the heartbeat drops to every
  10 min. A server without the endpoint still gets the 90 s config check. In poll mode the admin's "sent" messages
  say that screens get the command within about 90 s.
- **Capabilities in `GET /api/health`**: `edition`, `tenancy`, `runtime`, `pairCodeLength` and a `features` block
  (plus optional `limits` and `displayOrigin`). The admin reads it at start: sections, palette actions and search
  results for features a server turns off are hidden, and add buttons stop at the server's limits. A server that
  sends no `features` keeps everything on, so older servers look the same as before.
- **Pairing confirm step**: claiming a code first shows which display is waiting (its address) and pairs only after
  the owner confirms. The code length comes from `/api/health`.
- **Place search through the server** (`GET /api/admin/geocode`): the weather location search and the setup wizard
  no longer call Open-Meteo from the browser. Rate limited and cached for a day.
- **Account mode in the admin** for servers that sign users in with their own account pages (`user.method:
  'account'`): sign-in and sign-out follow the server's links, the header menu shows the household and the account
  links, and the Security page becomes *Account* on multi-tenant servers.
- **Save conflicts**: the admin sends the revision it loaded with every save (`baseRevision`). If the settings were
  saved since then, from another tab, another device or the server itself (the first Google sign-in adds the
  allowed email), the server answers `409 conflict` and writes nothing. The admin then offers to load the saved
  version or to save its own changes on top of it; parts it did not change keep the saved value. Saves without
  `baseRevision` (admin pages loaded before the update) still overwrite, as before.
- `GET /api/admin/countdowns?screen=` for the Countdowns page. `GET /api/countdowns` still accepts an admin
  session in this release.
- The admin translates the error codes a server can answer with (`rate_limited`, `screen_limit`,
  `limit_exceeded`, `feature_unavailable`, `conflict`, `photo_quota`, `readonly`) in Spanish, English and
  Portuguese.
- `web/shared/adminContract.json`, generated by `npm run contract` from the admin API client and the shared types,
  and checked in CI.
- Emoji: a Noto Color Emoji subset with the picker's emoji and the default icon rules is served by Marco itself, so
  the admin and the display show the same glyphs.

### Changed
- **Weather cache**: one forecast per place, shared by every language and screen (it was fetched once per language),
  for at least 10 minutes and, with MET Norway, until the `Expires` time it gives (then asked again with
  `If-Modified-Since`). Coordinates are rounded to 2 decimals (about 1 km) before they are sent. When the source
  fails, the last forecast stays for up to 6 hours, and *Status* shows why (for example a refused key).
- **Ambient backdrop**: the *Aurora* now looks like real northern lights: folding curtains with fine vertical rays
  that shimmer slowly, green and teal at the lower edge fading to violet at the top, gentle brightness pulses and a
  dither so the soft gradients never band. In the light theme it is a very faint pastel tint. *Particles* are now
  soft bokeh dust in three depths (small specks far away, larger blurred discs close by, a few big out-of-focus orbs)
  drifting with parallax and a slight twinkle, tinted by the accent colour; on the light theme they are soft pastel
  discs. Same cost as before: the aurora still renders at ¼ resolution and refreshes at 15 fps, at most 150 particles,
  nothing with `?lite=1`.
- **Weather effect**: it now follows how strong the weather is (drizzle and light snow are sparse, heavy rain and
  snow dense). *Rich*: drops on the glass act as small lenses (the photo seen through them flipped, a darker rim and
  a highlight) with a mist of micro droplets, sliding drops stop and go and leave a trail of beads, rain streaks fall
  at three depths, thunderstorms add a slanted downpour and lightning (a flash and a second flicker, never at night;
  plain rain no longer flashes), snow falls at four depths with soft out-of-focus flakes close by, fog shows slow
  banks of mist near the bottom, and clear days get softer sun shafts with a faint lens flare. *Simple*: rain and snow
  particles have depth (size, speed and softness). The photo and the text are never blurred.
- Every screen link in the admin (preview, *View screen*, screen cards, Home, Connected screens) comes from one
  helper. With private links it opens `/d/<key>` (with `?preview=1` for the preview); in open mode it keeps
  `/?screen=<slug>`.
- The pure server logic (config validation, backups and import, announcements, feed parsing, image headers,
  activity redaction, pairing codes, CSV, schedules) lives in `server/core`, with no Node built-ins or file access,
  so Marco Cloud can run the same code. A test keeps it that way.
- The display's SSE client and the poll channel share one event dispatcher, with the same checks for every event.
- `MARCO_LIVE` is passed through in `docker-compose.yml`.

### Fixed
- Pairing and “link no longer valid” screens: the code no longer runs under the QR code. Everything is sized from
  the width as well as the height (a tall browser window no longer makes the text, the code and the QR wider than
  their columns), the code shrinks to fit its column for 6 or 8 characters, and on 1440p, 4K and large desktop
  windows the card stops growing and stays centred. Preview with `?demo=1&pair=1` (or `pair=invalid`, `&pairLen=8`).
- Modern style, *Big time* layout: the agenda card no longer runs under the news bar. It shows whole rows only and
  drops the ones that do not fit (then the countdowns), instead of a faded, cut off last row. In portrait the weather
  card spans the full width again.
- Broken or non-image files in the gallery are read once instead of up to three times (up to 16 MB) each time the
  photo list is rebuilt.
- The admin preview no longer reads or writes the browser's stored device token, client id or cached data, so it
  cannot replace a real display's identity in the same browser or show another display's cached data.
- A pairing page opened at `/pair` stays there after pairing.
- Weather or background settings saved with a feature the server turns off stay visible with a note, so they can be
  changed back.
- Sign-in redirects reject paths with whitespace or control characters.
- Installer: run as a regular user with no terminal (`curl | bash` from a script, `marco update` from cron), it
  stopped at `sudo -v` even when sudo needs no password, as on Raspberry Pi OS. On a 0.4.0 install made as a regular
  user, `marco update` still asks for the sudo password once (it runs the 0.4.0 installer); with no terminal, use
  `sudo marco update` or run the one-line installer again.
- Installer: Raspberry Pi OS 32-bit on a Pi 4 or 5 (64-bit kernel, 32-bit programs) gets the armv7l Node.js build
  instead of an arm64 one that cannot run.
- Kiosk: the log `/tmp/marco-kiosk.log` (`marco logs` on a screen-only device) is written with Wayfire, LXDE-pi and
  other desktops too, not only labwc. Chromium from a snap (Ubuntu) gets a profile folder it is allowed to write to.
- Installer: the files that run as root (the `marco` command, the stored installer, the systemd unit) are taken from
  the release package right after its checksum is checked, not from the install folder that belongs to the service
  user, and a rollback puts the previous systemd unit back as it was. The `marco` command and the stored installer are
  replaced by rename, so a running `marco update` keeps reading its own copy. Links in place of `releases/`,
  `current` or `.env` are refused, and folders are handed to the service user without following links.
- Installer: a kiosk link with no server address is refused; updating a screen-only install shows the saved link;
  an all-in-one install warns when `kiosk.env` still points at another server. `marco help` no longer prints a
  line of code.


## [0.4.0] - 2026-10-09

A realistic weather effect over the photo, a polling mode for hosts without a live stream, and a language fix for
the pairing screen.

### Added
- **Weather effect** (*Background → Weather effect*, `background.weatherFx`): *Off*, *Simple* (the light rain and
  snow particles from earlier versions, still the default) or *Realistic*: drops on the glass that bend the photo
  only inside each drop, faint rain streaks, layered snow and soft sun rays on clear days. No blur or tint, so the
  calendar stays easy to read, and no flashes at night. *Realistic* needs WebGL and the WebGL photo transition;
  `?lite=1` turns the effect off.
- Demo URL parameters `?wx=clear|rain|snow|drizzle|thunder` and `?wxfx=off|simple|rich` to preview the weather and
  the effect without waiting for the forecast.
- **Poll mode for displays**: when `GET /api/health` returns `live: 'poll'`, the display skips the live stream and
  checks the config revision every 90 seconds. Self-hosted servers return `live: 'sse'` and keep the live stream.

### Fixed
- A screen whose private link was regenerated or whose paired device was revoked now keeps the language it was
  showing on the "This link is no longer valid" and pairing screens, instead of switching to the browser's language.

## [0.3.0] - 2026-10-09

Private display links and pairing, a one-line installer with the `marco` command, release packages, more icon
rules, a new logo and new screenshots, diagram and demo video.

### Added
- **Private display links**: every screen gets an unguessable link `/d/<key>` (random UUIDv4, 122 bits) shown in
  *Screen → Settings → Private link* with copy, QR code, open, **Regenerate link** and the ready-made Raspberry Pi
  command. The key binds the screen (`?screen=` is ignored with it).
- **Device pairing**: a display without a key (or at `/pair`) shows a 6-character code (31-symbol alphabet without
  look-alikes) and a QR code to `/admin/#pair=<code>`; *Connected screens → Pair a screen* claims it for a screen and the
  waiting display receives its own revocable device token (256 bits, stored hashed) through a secret pairing session
  id. Codes live 10 minutes, are single use, only valid while the display waits, and claims are rate-limited.
- *Connected screens*: how each display got in (private link, paired device, admin session, no key), **Paired devices**
  with last seen, edit (rename / move to another screen) and **Revoke**.
- **Display access** setting (*Security*): `private` (default for new installs) or `open` (legacy LAN mode). The
  dashboard, *Connected screens* and *Screen → Settings* recommend switching while open.
- Displays with a regenerated link, a revoked device or no key switch live (SSE `revoked`) to a "This link is no longer
  valid" / pairing screen that shows no family data and wipes the display's cached data.
- Setup wizard: the *Done* step shows the screen's private link and QR code (and the kiosk command with it); a display
  showing the welcome screen switches to a pairing code when setup completes.
- API: `GET /api/admin/display-links`, `POST /api/admin/display-links/:screenId/regenerate`, `GET/PATCH/DELETE
  /api/admin/devices[/:id]`, `POST /api/admin/pair/claim`, `POST /api/pair/start`, `POST /api/pair/status`; display
  credentials in `X-Marco-Key` (or `?k=` for the SSE stream and `/media/*`); `access`/`deviceName` in
  `GET /api/admin/displays`; `security.displayAccess` in the config. Exports with secrets carry the display keys and
  paired devices (hashes), so an import on a new server keeps every link and device working.
- `npm run demo` runs in private mode and prints each screen's private link (plus a paired demo device).
- **One-line installer**: `curl -fsSL https://marcohome.app/install | bash` (`install.sh` at the repository root).
  It asks what the device should do (all in one, server only, or screen only for a server elsewhere), or takes
  `--mode all|server|kiosk --url <private link> --port --dir --user --version --yes`. It checks the system (Debian
  12/13, Raspberry Pi OS Bookworm/Trixie, Ubuntu 22.04+; x86_64, arm64, armv7), the Raspberry Pi model, the desktop
  (labwc, Wayfire, X11, or X started from `~/.xinitrc`) and the read-only overlay, installs Node.js 22 when needed
  (checked against `SHASUMS256.txt`), downloads the prebuilt release and verifies its SHA-256, sets up the systemd
  service and the kiosk, and ends with the admin address and a QR code. `--dry-run` prints every action without
  changing anything; `--update` and `--uninstall [--purge]` are built in (uninstall asks first, with no as the
  default answer, and needs `--yes` when there is no terminal). Until a release is published it builds
  from git. A kiosk-only install downloads the four kiosk scripts it needs, so git is not required.
- **`marco` command**: `marco status`, `logs [-f]`, `restart`, `update` (checksum verified, switched in one step,
  rolled back if the new version does not start, never to an older version without `--force`), `url` (admin address and each screen's private link with QR
  codes), `version`, `uninstall` (keeps your data unless `--purge`).
- **Release packages**: tagging `v*` builds `marco-<version>.tar.gz` (server, built web interface, deploy scripts,
  no `node_modules`) with a `.sha256`, and publishes a GitHub release with the notes from this changelog plus
  `install.sh` and `install.sh.sha256`, so the installer can be checked before it runs. CI runs shellcheck on every
  shell script.
- **More icon rules**: 35 categories with about 400 keywords in English, Spanish and Portuguese (train, pharmacy,
  exams, swimming, haircut, coffee, drinks, parties, work, deliveries, repairs, cleaning, bin day, garden,
  deadlines, music lessons, babysitter and more). The list lives in `web/shared/iconRules.json`, shared by the
  server and the web UI. Existing installs get the new keywords and categories once, added after their own rules;
  nothing is removed or reordered, and rules deleted afterwards stay deleted (marker file `data/.iconrules-v2`).
- Gallery: choose which photos are in the rotation: an always-visible eye toggle on each photo (with a confirmation
  toast), an "N of M in rotation" counter, *All / In rotation / Hidden* filters and a selection mode to show or hide
  many photos at once. Hidden photos stay in the gallery (flag stored in `photos/.meta.json`, kept on replace) and
  are skipped by the display immediately; if everything is hidden the screen falls back to stock photos.
- Background → *Photo order*: `random` (default; shuffled without repeating the previous batch), `newest` or `name`.
  Sequential orders continue where the screen left off (`GET /api/photos?after=`) and wrap around.
- API: `PATCH /api/admin/photos/:file` accepts `{ hidden }`; new `POST /api/admin/photos/visibility` for bulk
  changes; `background.order` in the screen config; the `photos` stream event may carry `{ hidden: [...] }`.
- **Docs and media**: new screenshots of every admin page, the setup wizard, the display layouts and the pairing
  flow (WebP, in `docs/screenshots/`), a "How it works" diagram for light and dark themes, an animated preview and a
  poster frame (`docs/media/`). A 48-second demo video (`marco-demo.mp4`) is linked from the READMEs; it is kept in a fixed `media` release on
  GitHub because it is too big for the repository. The
  READMEs (English and Spanish) are rewritten around the one-line installer, with instructions to check it before
  running it.

### Changed
- The display API (`/api/display/*`, `/api/events`, `/api/weather`, `/api/news`, `/api/photos`, `/api/countdowns`,
  `/api/stream`, heartbeat) and `/media/*` require a display key, a device token or an admin session in private mode
  (`401 key_required` / `403 invalid_key`, no data). **Upgrading keeps your displays working**: a config saved by 0.2
  loads with display access `open`; switch to private in *Security* after opening each display's private link (or
  pairing it). Restoring an older backup or importing an older export keeps the current mode.
- Raspberry Pi docs and the setup wizard use the private link as the kiosk URL; on an all-in-one install
  `deploy/kiosk.sh` turns a keyless `http://localhost` URL into the screen's private link (read from the local data
  folder on every Chromium start; the kiosk log shows it redacted). `deploy/Caddyfile.example` explains what to expose
  in each mode.
- The private-link card and the setup wizard show the one-line kiosk command
  (`curl -fsSL https://marcohome.app/install | bash -s -- --mode kiosk --url <link>`).
- `deploy/install.sh` is now a thin wrapper around `install.sh` for git checkouts (same options as before, plus
  `--dry-run`); `marco update` on such an install runs `git pull` and rebuilds.
- `deploy/marco.service` takes the data folder and the `.env` path from the installer.
- Kiosk: Chromium starts with `--force-device-scale-factor=1` (override it in `KIOSK_EXTRA_ARGS`) and
  `--disable-translate`.
- New logo: two arches, one with the sun and one with the moon, inside an M-shaped frame. It replaces the calendar
  badge in the admin sidebar, login, setup wizard and the display's welcome and pairing screens, and comes as a
  favicon set (`favicon.svg`, 32 px PNG, 180 px `apple-touch-icon.png`, 512 px icon). Lockups for light and dark
  backgrounds are in `docs/`. The display page title is now "Marco".
- The server's Express app is built by `server/app.js` (`createApp()`), so the tests exercise the real middleware stack.
- Text clean-up in the docs, the admin and the display: plainer wording, and no em dashes in English, Spanish or
  Portuguese strings. Empty values in the admin show "–".

### Security
- Display keys, device tokens and pairing session ids are compared in constant time and never logged (server log URLs
  and activity-log data are redacted); every response sends `Referrer-Policy: no-referrer`, keyed responses
  `Cache-Control: private, no-store`, and `/d/*` adds `X-Robots-Tag: noindex`. Threat model and brute-force math in
  `SECURITY.md`.
- Open display streams follow every credential change, not only *Regenerate link* / *Revoke*: each stream keeps a hash
  of the key or device token it opened with and is re-checked after config saves, imports, session revocation and on
  every heartbeat. Importing secrets that replace a screen's key or drop a paired device closes the streams still
  using them (`revoked { code: "invalid_key" }`), and the import preview lists the links and devices it would change.
- Live streams opened with an admin session (previews, "View screen") close on *Log out everywhere*, a password change,
  an imported password, a disabled login method, a plain logout of the same browser and after the session lifetime.
- Moving a paired device to another screen closes its stream (after `reload`), so a client that ignores `reload` no
  longer receives the old screen's announcements.
- Restoring a backup or importing a bundle never changes *Display access*. The import preview says the mode is kept.
- The installer writes `.env` and `kiosk.env` with mode 600, never prints a private link in full, and keeps the
  folders it creates in a user's home owned by that user.

## [0.2.0] - 2026-10-09

First public release.

### Display
- Month calendar (configurable weeks), agenda and week views; five layouts (`bigCalendar`, `leftRight`, `topBottom`,
  `bigTime`, `agenda`), portrait and landscape, small-screen sizing and adaptive legibility over photos.
- Automatic emoji icons from editable keyword rules; birthdays with age ("🎂 Grandma Isabel (72)").
- Vacation-rental feeds (Airbnb "Reserved", Booking, property-management tools): check-in → check-out bars, guests as
  🧑🏻/🧒🏻/👶🏻/🐶 icons, 🚪 checkouts, blocked dates.
- Clock with seconds, weather (Open-Meteo or Home Assistant, indoor sensors, rain effect), RSS news ticker, countdowns,
  to-do list, message of the day, highlights ("Check-in today", "Next: …").
- Background photos (stock or your own gallery) with WebGL transitions, focal-point aware cropping and an ambient
  aurora; `?lite=1` for low-power devices; night mode.
- Invisible live refresh via Server-Sent Events, offline tolerance, instant announcements with chime, scheduled
  messages, identify / reload / night commands, multi-screen profiles (`?screen=slug`), built-in demo (`?demo=1`).

### Admin panel
- First-run setup wizard (language, admin password with strength meter, location, calendars with holiday presets and
  iCal test, look, display URL + QR code); no default password, optional `SETUP_TOKEN`; the display shows a welcome
  screen with a QR code until setup is done.
- Password and Google sign-in (allow-list), sessions management.
- Calendars (iCal/ICS and Google Calendar via OAuth), icon rules, local events with recurrence, birthdays (CSV import),
  filters & overrides with live preview, countdowns, weather, news, Home Assistant, photo gallery (in-browser
  optimisation, HEIC conversion, thumbnails, focal-point editor, duplicate handling).
- Multiple screens, connected displays, announcements and scheduled messages, API tokens and webhooks,
  backups / export / import, activity log, home dashboard, command palette (Ctrl/Cmd+K), English / Spanish / Portuguese.

### Deployment
- Raspberry Pi installer (all-in-one, server-only or kiosk-only with `--url`), systemd service, Chromium kiosk script,
  HDMI schedule script, Caddy example, Docker image and Compose file, `npm run demo`.

### Security
- Host-name allowlist against DNS rebinding (LAN names, IP addresses, `PUBLIC_URL`, `ALLOWED_HOSTS`); the CSRF
  guard also checks the `Origin` against it.
- "From the LAN" ignores clients relayed by a proxy missing from `TRUST_PROXY` and, for setup and weak passwords, the
  container gateway; the Docker image always asks for the setup token (`SETUP_REQUIRE_TOKEN=1`).
- Setup-token failures are counted on every setup endpoint (per IPv4 address / IPv6 /64, bounded table); an
  unreadable `secrets.json` stops the server instead of reopening setup; a previously configured install needs the token.
- The unauthenticated setup iCal test refuses loopback / link-local / metadata destinations and returns generic errors.
- Gallery photos (`/media/*`) are served only to LAN clients or a signed-in admin; an `ADMIN_PASSWORD` that breaks the
  password rules is LAN-only.
