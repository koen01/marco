# HTTP API

All endpoints speak JSON. TypeScript types for every request and response live in
[`web/shared/types.ts`](../web/shared/types.ts). See [ARCHITECTURE.md](ARCHITECTURE.md) for the data model.

- **Display endpoints** need the screen's **display key** (private link), a **paired-device token** or an admin
  session, unless display access is set to *open* (legacy LAN mode). See [Display access](#display-access). They
  never return calendar URLs, Google accounts, tokens or Home Assistant credentials.
- **Admin endpoints** need a session cookie (log in with `POST /api/auth/login`). Mutating requests must send
  `Content-Type: application/json` (CSRF guard; photo uploads are the multipart exception).
- **Webhooks** need `Authorization: Bearer <token>` (create tokens in *Admin → API & webhooks*).

Without a key or device token, every display endpoint accepts `?screen=<slug|id>` (case-insensitive). Absent → default
screen; unknown → default screen with `screenFallback: true` in the config. With a key or device token the screen is
the one bound to it and `?screen=` is ignored.

## Display access

`config.security.displayAccess` is `"private"` (default for new installs) or `"open"` (installs upgraded from 0.2 keep
it until you switch in *Security*).

**Credentials:** send one of them with every display request:

| Credential | Format | Where it comes from |
|---|---|---|
| Display key | UUIDv4, e.g. `3f6c0a52-9d1e-4b7a-a2c4-0e5b8f1d2c37` (case-insensitive) | The screen's private link `/d/<key>` (*Screen → Settings → Private link*) |
| Device token | `md_` + 43 base64url characters (256 bits) | Pairing (below); stored by the display in `localStorage` |
| Admin session | `cs_session` cookie | Logged-in admin (preview iframe and *View screen* in open mode, which use `/?screen=`; in private mode they use the private link) |

Header `X-Marco-Key: <key or token>` for `fetch`; `?k=<key or token>` is accepted only by `/api/stream` (EventSource
cannot send headers) and `/media/*` (images). Keys and tokens are compared in constant time and never logged.

| Situation | Response |
|---|---|
| private mode, no credential, no session | `401 { error, code: "key_required" }` |
| unknown / regenerated key, revoked device token (any mode, also with a session) | `403 { error, code: "invalid_key" }` |
| open mode, no credential | as before 0.3 (no authentication; `/media/*` only for LAN clients or a session, else `404`) |

Display responses carry `Cache-Control: private, no-store`; every response carries `Referrer-Policy: no-referrer`.
`GET /d/<key>` serves the display page (`Cache-Control: private, no-store`, `X-Robots-Tag: noindex`); the page reads
the key from its path. `GET /pair` serves the display page in pairing mode.

**Pairing** (no authentication for the display side; rate-limited):

| Method & path | Notes |
|---|---|
| `POST /api/pair/start` | `{}` → `PairStartResponse` `{ sessionId, code, expiresAt, pollMs }`. `sessionId`: 32 random bytes (base64url), known only to this display; `code`: 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, unique among pending codes, valid 10 min. `429` after 10 starts per IPv4 address / IPv6 /64 in 10 min; `503` with 100 pending codes |
| `POST /api/pair/status` | `{ sessionId }` → `{ status: "waiting", code, expiresAt }` · `{ status: "paired", token, screen: { id, slug, name }, device: { id, name } }` (exactly once, then the session is gone) · `404 { status: "expired" }`. Poll every `pollMs` (2 s): a code can only be claimed while its display polled within the last 15 s |
| `POST /api/admin/pair/claim` | Admin session. Two steps. `{ code, screenId, name? }` (code case-insensitive, spaces/dashes ignored) only finds the waiting display and answers `{ confirm: { where, screenId, screenName } }` (`where`: the display's address as this server saw it, `"localhost"` on the server itself, `""` when unknown); nothing is paired yet. The admin shows it and sends the same body with `confirm: true` → `{ device: PairedDevice }`. Marco Cloud answers the same shape, with `where` = city and country. `404 { code: "invalid_code" }` unknown / expired / already used / display not waiting; `400 { code: "unknown_screen" }`; `429 { code: "rate_limited" }` after 10 wrong codes per admin session + address, or 50 wrong codes overall, in 10 minutes (then even a right code waits). Read the error code as `code`, else `error` (Marco Cloud sends `{ error: "invalid_code" }`) |

The admin's QR on the pairing screen opens `/admin/#pair=<code>`, which opens the *Pair a screen* dialog prefilled.
The pairing screen reads `pairCodeLength` from `/api/health` and says where to open the admin: this page's
`<host>/admin`, the first of `lanAddresses` when it was opened on `localhost` (a kiosk on the server itself), or
`adminOrigin` when the server sets it. Once paired, a display opened at `/pair` stays on `/pair`; a dead private link
continues at `/` (at `/pair` when `edition` is not `'self-hosted'`).

**Links and devices** (admin session):

| Method & path | Notes |
|---|---|
| `GET /api/admin/display-links` | `{ mode, links: [{ screenId, slug, name, key, path: "/d/<key>", createdAt }], lanAddresses, publicUrl }` (keys are created for screens that have none; `lanAddresses` = this server's LAN IPv4 addresses, `publicUrl` = `PUBLIC_URL` unless it is localhost; the admin uses them for links, QR codes and kiosk commands when opened on `localhost`) |
| `POST /api/admin/display-links/:screenId/regenerate` | New key → `{ link }`. The old key stops working at once; SSE clients that used it get `revoked { code: "invalid_key" }` and are closed |
| `GET /api/admin/devices` | `{ mode, devices: PairedDevice[] }`, each `{ id, name, prefix, screenId, screenSlug, screenName, createdAt, lastSeenAt, lastIp, userAgent, connected, clientIds }` (never the token or its hash) |
| `PATCH /api/admin/devices/:id` | `{ name?, screenId? }` → `{ device }` (moving to another screen sends `reload` to the device's streams and closes them; they reconnect bound to the new screen) |
| `DELETE /api/admin/devices/:id` | Revoke: the token stops working; connected streams get `revoked` and are closed |

Saving the config with `security.displayAccess` switched from `open` to `private` sends `revoked
{ code: "key_required" }` to every display that was connected without a key (they show the pairing code). A config
saved without `security` (old admin builds, backups or exports from before 0.3) keeps the current mode.

## Display API

| Method & path | Response |
|---|---|
| `GET /api/health` | `HealthResponse`: `{ ok, uptime, version, live, edition, tenancy, runtime, pairCodeLength, features, limits?, displayOrigin?, adminOrigin?, lanAddresses? }` (see below). `live` is `'sse'` unless `MARCO_LIVE=poll` is set. A server that answers `'poll'` gets no `/api/stream` connection: the display polls `GET /api/display/poll` instead (see below). A server that answers `404` there gets a config check every 90 s, which refetches events and countdowns when `revision` changes. A missing field means `'sse'` |
| `GET /api/display/config?screen=` | `DisplayConfig`: flat view of one screen; `calendar.sources` only as `{ id, name, color, emoji, kind }`; enabled `schedules` for this screen; `privacy: { active, until, lock, next }` (see [Privacy mode](#privacy-mode); while active with *hide photos*, `background.source` is `"stock"`) |
| `GET /api/events?screen=&from=YYYY-MM-DD&to=YYYY-MM-DD` | `{ generatedAt, hash, events: CalEvent[], errors: [{ sourceId, message }] }`. While the screen is private, events are already filtered (busy blocks, hidden calendars) and `hash` starts with `p` |
| `GET /api/weather?screen=` | `{ updatedAt, locationName, current, today, daily[], hourly[], indoor, source }` (localized descriptions). `source` = `{ provider, name, model, modelName, url, licence, licenceUrl, also? }`: where the data comes from, for the credit line. Values a source does not give are `null` (MET Norway: no chance of rain outside the Nordics; some Open-Meteo models: no UV). Cached per place for at least 10 minutes (15 for Pirate Weather, MET Norway's `Expires` when longer), the last answer is kept for 6 hours when the source fails |
| `GET /api/news` | `{ updatedAt, items: [{ id, title, summary, source, date, image? }] }` (cache 15 min) |
| `GET /api/photos?screen=&count=20&after=` | `{ photos: [{ url, author?, title?, source: "stock"\|"gallery", file?, focusX?, focusY? }] }`. Gallery photos follow the screen's `background.order` (`random` \| `newest` \| `name`); hidden photos are never returned. `after` = gallery `file` the display showed last: sequential orders continue right after it (wrapping around), `random` avoids starting with it. Without `after`, the server remembers where the previous batch for that screen ended. Falls back to stock when no gallery photo is in rotation |
| `GET /api/countdowns?screen=` | `{ generatedAt, today, hash, items: [{ id, title, emoji, color, date, days, origin, age? }] }`. An admin session is still accepted here in 0.5 for admin pages loaded before the update; the admin itself uses `GET /api/admin/countdowns` |
| `POST /api/display/heartbeat` | Body `DisplayHeartbeat` (≤ 4 kB: clientId, screen, version, resolution, dpr, webgl, night state, photo frame…) → `HeartbeatResponse` |
| `GET /api/stream?screen=&client=&k=` | Server-Sent Events, see below |
| `GET /api/display/poll?screen=&client=&cursor=&rev=&hidden=&preview=` | `PollResponse`: the same events as commands, for displays without a stream. See below |
| `GET /api/display/doorbell/frame?n=` | The doorbell camera picture for this display's screen (`image/jpeg`, `image/png`, `image/webp` or `image/gif`, `Cache-Control: private, no-store`), only while that screen rings. `n` is a counter the display adds so nothing caches it. `404 { code: "no_ring" }` when the screen is not ringing (also for open display access from outside the LAN), `404 { code: "no_camera" }` when the ring has no camera, `503 { code: "homeassistant_off" }`, `502 { code: "camera_unavailable" }` (Home Assistant failed, took more than 6 s, answered something that is not an image or more than 4 MB). See [Doorbell camera](#doorbell-camera) |
| `GET /media/photos/<file>`, `GET /media/thumbs/<file>` | Gallery images and thumbnails |

### Capabilities in `/api/health`

The admin and the display read these fields to decide which sections, actions and limits apply.

- `edition`: `'self-hosted'` here. `tenancy`: `'single'`. `runtime`: `'node'`.
- `pairCodeLength`: characters in the pairing code a TV shows (`6`).
- `features`: one boolean per feature: `homeassistant`, `news`, `customCss`, `gallery`, `schedules`,
  `announcements`, `displayCommands`, `openDisplayAccess`, `insecureTls`, `googleCalendar`, `googleLogin`,
  `passwordLogin`, `apiTokens`, `webhooks`, `backups`, `importExport`, `includeSecrets`, `activity`, `setupWizard`,
  `status`, `accountMenu`, `microsoftCalendar`, `updates`, `feedback`, `privacy`, `doorbell`, `doorbellLive`. A self-hosted server turns all of them on, except
  `googleCalendar` and `googleLogin` (on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set),
  `microsoftCalendar` (Outlook and Microsoft 365 calendars, on when `MICROSOFT_CLIENT_ID` and
  `MICROSOFT_CLIENT_SECRET` are set), `accountMenu` and `feedback` (always off). `updates` is the update banner,
  *Status → Updates* and `/api/admin/update*`; Marco Cloud answers `false` and shows the CHANGELOG section of a new
  version once instead. `feedback` is Marco Cloud's *Help and feedback* form (account menu, sidebar and command
  palette), which sends `POST /api/admin/feedback` with `{ kind: 'problem'|'idea'|'other', message, meta }` to the
  people who run the service; a self-hosted admin never shows it. `privacy` is privacy mode (see
  [Privacy mode](#privacy-mode)); a server that does not filter events for it leaves it out and the admin hides the
  controls. `doorbell` is the doorbell overlay, its webhook and the admin card; `doorbellLive` means the frames are a
  live camera picture proxied from Home Assistant. A server with `doorbell` and without `doorbellLive` answers the
  frame URL with the latest snapshot it was given instead; the display works the same way with both.
- `limits` (optional): plan limits such as `screens`, `sources` or `devices`. Absent means no limit beyond the
  config validator's own caps (12 screens, 50 calendars, 20 news feeds, 1000 local events, 500 birthdays,
  100 countdowns). The admin disables "add" at the limit and flags a config that goes over it.
- `displayOrigin` (optional): absolute origin that serves `/d/<key>` and `/pair`. Absent means the same origin. The
  admin opens screens (preview, *View screen*) at `<displayOrigin or its own origin>/d/<key>` when it has the private
  links (a server in private mode, or one without open display access), else at `/?screen=<slug>`. The preview adds
  `?preview=1`: that page is never counted as a connected display and does not read or write the browser's stored
  device token, client id or cached data.
- `adminOrigin` (optional): absolute origin of the admin, for displays served from another origin. Absent means the
  same origin.
- `lanAddresses` (optional): this server's LAN addresses (as in `/api/setup/status`). Only sent to a client on the
  server itself (loopback, not relayed by an untrusted proxy, allowed host name), so the pairing screen of a kiosk on
  `http://localhost` can say where other devices reach the admin.

Clients treat a response with no `features` field (servers older than 0.5.0) as having every feature on, except
`accountMenu`, `microsoftCalendar`, `updates`, `feedback`, `privacy`, `doorbell` and `doorbellLive`. A key missing
from `features` counts as off only when `edition` is not `'self-hosted'`, and a missing `accountMenu`,
`microsoftCalendar`, `updates`, `feedback`, `privacy`, `doorbell` or `doorbellLive` is always off.

### Account mode

A multi-tenant server (`tenancy: 'multi'`) signs people in on its own account pages instead of the admin's login
screen. `GET /api/auth/me` then returns `user.method: 'account'` and an `account` block:
`{ loginUrl, accountUrl, sessionsUrl, deleteUrl, household: { name, role } }`. The admin:

- sends the browser to `loginUrl?next=<path and hash>` when it is signed out or a call answers 401. `next` is
  always a path under `/admin/`;
- after `POST /api/auth/logout`, goes to the `next` path in the response, or to `loginUrl`;
- shows the household and the account links in the header menu, and also sends `POST /api/account/lang {lang}`
  when the language changes;
- replaces the Security page with an Account page (same `#/security` route) that renames the household with
  `PATCH /api/admin/household {name}` (60 characters at most).

Links in the `account` block must be paths on the same site or `http(s)` URLs; the admin ignores anything else.

Every call the admin makes is listed in `web/shared/adminContract.json` (method, path, query keys, gating feature,
request type and top-level response keys), generated from `web/admin/api.ts` and `web/shared/types.ts` by
`npm run contract`. A server that turns a feature off answers that feature's routes with
`404 {"error":"feature_unavailable"}`.

Error codes the admin translates (`web/admin/apiErrors.ts`), read from `code` first and then `error`:
`rate_limited`, `screen_limit`, `limit_exceeded`, `feature_unavailable`, `conflict`, `photo_quota`, `readonly`. A
`details[].message` with one of these codes is translated too. Any other error shows the server's own text.

`CalEvent`: `{ id, sourceId, title, start, end, allDay, location, color, emoji, kind, multiDay, age?, busy? }`.
`start`/`end` are ISO strings with offset, or `YYYY-MM-DD` for all-day events (`end` exclusive). `busy: true` marks a
privacy-mode block: `title` is "Busy" in the screen's language, `location` and `emoji` are empty, `color` is the
calendar's.

### Server-Sent Events (`/api/stream`)

| Event | Data | When |
|---|---|---|
| `hello` | `{ revision, screenId, slug, clientId, serverVersion, now, activeAnnouncementIds, doorbellId }` | on connect. `doorbellId`: the ring on this screen or `null` (a display showing another one closes it) |
| `config` | `{ revision }` | config saved; the display refetches its config and re-renders without reloading |
| `events` | `{ hash }` | calendar data changed (also refetch countdowns) |
| `photos` | `{}` or `{ hidden: [file, …] }` | gallery changed (`hidden` lists photos just taken out of the rotation; a display showing one of them moves on right away) |
| `reload` | `{}` | "Refresh displays", display command or webhook |
| `announce` | `Announcement` | announcement sent; replayed on connect while still active |
| `announce-clear` | `{ id \| null }` | announcement removed early (`null` = all) |
| `identify` | `{ name, slug, clientId, durationSec }` | show the screen name full-screen |
| `night` | `{ mode: "on" \| "off" \| "auto" }` | night mode override |
| `privacy` | `{ active }` | privacy mode of this screen turned on or off (admin, webhook, schedule, or a period that ended); the display refetches its config, events, countdowns and photos |
| `doorbell` | `{ id, startedAt, updatedAt, expiresAt, sound, frames, refreshMs }` | someone rang; replayed on connect while it lasts. The same `id` again with a later `expiresAt` extends it. `frames: false` = no camera, `refreshMs` = time between two frame requests (750) |
| `doorbell-end` | `{ id }` | the ring was dismissed |
| `ping` | `{ t }` | every 25 s |
| `revoked` | `{ code: "invalid_key" \| "key_required" }` | the link was regenerated or replaced by an import, the device revoked or dropped by an import, the screen deleted, display access switched to private for a keyless display, or (`key_required`) the admin session a stream was opened with ended (logout, logout everywhere, password change); the server then closes the stream. Every stream's credential is re-checked after config saves, imports, session revocation and on each heartbeat |

Displays whose screen has alerts disabled do not receive `announce`.

### Poll channel (`/api/display/poll`)

Used when `/api/health` says `live: 'poll'`. The credential travels in `X-Marco-Key`, as for the other display
endpoints, and the same `401` / `403` answers apply (the display then shows the pairing or "no longer valid" screen,
so there is no `revoked` command).

| Query | Meaning |
|---|---|
| `client` | the display's client id (as on `/api/stream`) |
| `cursor` | the `cursor` of the previous answer; empty on the first poll |
| `rev` | the config revision the display has |
| `hidden` | `1` while the page is hidden |
| `preview` | `1` for the admin preview: commands still arrive, but the poll is not listed as a display |

Answer `{ revision, screenId, now, serverVersion, cursor, reset, commands, activeAnnouncementIds?, next }`:

- `commands`: in order and already filtered to this display. Each one is `{ type, ...payload }` with the SSE event
  names and payloads: `reload`, `night`, `identify` (filled in for this display), `announce`, `announce-clear`,
  `photos`, `events`, `privacy`, `doorbell` and `doorbell-end`.
- `reset: true` on the first poll, after a server restart, or for a cursor the server no longer knows. `commands` then
  only holds the announcements still active on this screen, like the replay on `/api/stream`, and old commands are
  never replayed.
- `activeAnnouncementIds`: present on a reset and whenever `commands` holds `announce` or `announce-clear`.
- `doorbellId`: present on a reset, the ring on this screen or `null`. A reset also replays that ring as a `doorbell`
  command.
- `revision`: the display refetches its config, events and countdowns when it differs from its own. `screenId`: a
  different one (the paired device was moved) reloads the page. `serverVersion`: a newer server reloads the page once.
- `next`: milliseconds until the next poll. Self-hosted answers 30 s, 3 min while hidden, and 5 s while someone has
  *Connected screens* open or just sent a command. The display adds ±10 % and keeps it between 3 s and 15 min; on
  errors it waits 5 s, doubling up to 5 min.

The self-hosted server keeps the last 500 events in memory. Commands expire: `identify` after 60 s, `announce` and
`doorbell` at their `expiresAt`, the others after 10 min. Over the poll channel a ring reaches a display on its next
poll (5 s for 3 minutes after any command, else up to 30 s), so a doorbell is only immediate with SSE. A display that polled in the last 4 minutes is listed as connected and
counts in `delivered` (at most 24 client ids per address, as for streams). A new private link, a revoked device or
a switch to private access takes its pollers off the list at once; their next poll gets `401` / `403`.

## Authentication

| Method & path | Notes |
|---|---|
| `GET /api/auth/me` | `{ user: { email, name, picture, method } \| null, needsSetup, googleConfigured, passwordLoginEnabled, mustChangePassword, passwordFromEnv }`. `method` is `'password'` or `'google'` here; Marco Cloud answers `'account'` and adds `account: { loginUrl, accountUrl, sessionsUrl, deleteUrl, household: { name, role } }` and `microsoftConfigured` (Microsoft calendars on for this account; a self-hosted server sends it too, true when `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` are set) |
| `POST /api/auth/login` | `{ password }`; `409 { needsSetup: true }` while the install has no password yet |
| `POST /api/auth/logout`, `POST /api/auth/logout-all` | log out this session / every session |
| `GET /auth/google/login` | "Sign in with Google" (email must be in `auth.allowedGoogleEmails`; if the list is empty, the first Google login made while already logged in with the password adds itself) |
| `GET /auth/google/connect` | Link a Google account for calendars (scope `calendar.readonly`, offline access); requires a session |
| `GET /auth/google/callback` | OAuth redirect URI: `${PUBLIC_URL}/auth/google/callback` |
| `GET /auth/microsoft/connect` | Link a Microsoft account for calendars (`openid email profile offline_access Calendars.Read Calendars.Read.Shared`, PKCE); requires a session and `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` |
| `GET /auth/microsoft/callback` | OAuth redirect URI: `${PUBLIC_URL}/auth/microsoft/callback`. Back to `/admin/?microsoft=<email>` or `/admin/?error=microsoft_<code>` |

## Setup (first run)

A fresh install has **no admin password** (and no default one): until the setup wizard completes, the admin panel
shows the wizard and the display shows a welcome screen. Installs that already have a password hash never enter
setup. When `ADMIN_PASSWORD` is set and no hash exists yet, it becomes the initial password at startup (headless
installs) and setup is skipped; the panel then offers to change it (`passwordFromEnv`).

| Method & path | Notes |
|---|---|
| `GET /api/setup/status` | `SetupStatus`: `{ needsSetup, googleConfigured, version, suggestedLanguage }`; while `needsSetup` also `tokenRequired`, `tokenValid` (when an `x-setup-token` header was sent; `null` otherwise; a wrong token counts towards the lockout below, `429` while locked), `defaults` and, for LAN clients, `lanAddresses` (real LAN interfaces only; empty in a container unless `LAN_ADDRESS` is set) |
| `POST /api/setup/test-ics` | `{ url }` → `TestIcsResponse` (the wizard's "Test" button). Unauthenticated, so it refuses loopback, link-local / cloud-metadata, multicast and unspecified destinations (also after redirects) and returns only generic errors (`address not allowed`, `HTTP <status>`, `could not load the calendar`) |
| `POST /api/setup/complete` | `SetupRequest` → `{ ok, user, screen: { id, slug, name, displayPath }, displayAccess }` and a session cookie (logged in). `displayPath` = the screen's private link `/d/<key>` |

`SetupRequest`: `{ password, passwordConfirm, language: es|en|pt|nl, screenName, location?: { name, lat, lon, timezone },
timezone? (when the location is skipped), units?: metric|imperial, format24?, calendars?: [{ name, url, kind: holidays|generic }] (≤ 20), photos?: { source:
stock|gallery|mixed }, layout?: { preset }, accent?: #rrggbb, ambient?: aurora|particles|none, theme?: dark|light }`.
The password must have at least 10 characters, must not be a common password or a trivial pattern (`1234567890`,
`aaaaaaaaaa`, `qwertyuiop`, `password2024!`…) and must equal `passwordConfirm` (the same rules apply to
`PUT /api/admin/password`).

Rules for the mutating setup endpoints:

- **Single use**: once a password exists they answer `409 { error: "setup already completed" }`.
- **Race-safe**: the first `complete` claims the wizard before hashing; a concurrent one gets `409`.
- **JSON only, same origin**: `Content-Type: application/json` is required (`415` otherwise, even for an empty body)
  and a present `Origin` must match the host and be an allowed host name (`403`). Requests whose `Host` is not an
  allowed name get `421` on every route except `/api/health` and `/api/hooks/*` (DNS-rebinding guard: IP literals,
  `localhost`, single-label names, `*.local`/`*.lan`/`*.home.arpa`/`*.internal`, the `PUBLIC_URL` host, `ALLOWED_HOSTS`).
- **Validation**: `400 { error, details: [{ path, message }] }`; nothing is written until everything is valid.
- **Setup token**: with `SETUP_TOKEN` set, every request needs it (`x-setup-token` header or `{ token }` in the
  body). `SETUP_REQUIRE_TOKEN=1` (set in the Docker image) and an install whose config was saved before (revision > 1,
  i.e. `secrets.json` was lost) require the random per-process token in the same way. Otherwise LAN clients need no
  token (a loopback/private address that was not relayed by a proxy missing from `TRUST_PROXY` and is not the
  container's gateway), and any other client needs the per-process token printed in the server log at startup
  (`[setup] Open http://localhost:PORT/admin/?setup=<token> to finish setup`, plus one line per detected LAN address
  and the `PUBLIC_URL` when it is not localhost; replace `localhost` with the server's address from another device).
  Missing/wrong token → `403 { code: "token_required" | "invalid_token" }`; 10 wrong tokens (on any setup endpoint,
  `/status` included) from one IPv4 address or IPv6 /64 → `429` for 10 minutes. A locked client is still let in with
  a strong token (the generated one, or a `SETUP_TOKEN` of 20+ characters), so a neighbour cannot lock the owner out.
- A `secrets.json` that exists but cannot be read stops the server at startup (it is never replaced by defaults).
- Activity entries: `auth.setup_completed`, `auth.setup_rejected` (throttled).

## Admin API (session required)

**Configuration**

| Method & path | Notes |
|---|---|
| `GET /api/admin/config` | Full `StoredConfig` |
| `PUT /api/admin/config` | Validate + save (revision + 1, backup first, SSE `config`). Body = `StoredConfig` plus an optional `baseRevision`: the revision the admin loaded. When the config was saved since then (another tab or device, or the server itself, for example the first Google sign-in adding the allowed email) the answer is `409 { error: "conflict", revision }` and nothing is written; the admin then offers to load the saved version or to save its changes on top of it (parts it did not change keep the saved value) with the new `baseRevision`. Without `baseRevision` (or `null`) the last write wins, as before 0.5. `400 { error, details: [{ path, message }] }` when invalid |
| `PUT /api/admin/password` | `{ current, next }`: same password rules as the setup wizard (`400 { code: too_short \| too_common \| too_long }`); also logs out other sessions |
| `GET /api/admin/screens/template?name=` | New `ScreenProfile` with defaults and a free slug |
| `GET /api/admin/geocode?q=&lang=` | Place search for the weather location, through this server (Open-Meteo geocoding) so the browser only talks to Marco → `{ results: [{ name, admin1, country, countryCode, lat, lon, timezone }] }` (at most 8; `q` shorter than 2 characters gives `[]`). Also open to the setup wizard while no password exists, with the same token rules as `/api/setup/*` (`x-setup-token`). `429 { error: "rate_limited" }` after 60 searches per address in 10 minutes (600 overall); answers are cached for a day; `502 { error: "geocode_unavailable" }` when Open-Meteo cannot be reached |
| `POST /api/admin/events/preview` | Body `{ from?, days? (1..60), screen?, eventRules?, iconRules?, localEvents?, birthdays? }` (draft values) → every event incl. hidden ones with `applied[]` rules and `ruleHits` |
| `GET /api/admin/countdowns?screen=` | Same answer as `GET /api/countdowns` for the screen with that id or slug (unknown → default screen); used by the Countdowns page |
| `POST /api/admin/birthdays/parse-csv` | `{ text }`: one `name;dd/mm[/yyyy]` per line (`;`, `,` or tab) → parsed rows, duplicates, errors with line numbers |
| `GET /api/admin/dashboard` | Next events, weather now, active schedules, recent activity, warnings |
| `GET /api/admin/status` | Per-source last fetch / errors, weather (`ok`, `updatedAt`, `error`, `errorCode`: `key_missing`, `key_invalid`, `rate_limited`, `http`, `bad_response`, `provider`) and news status, display count, uptime |

**Sources and integrations**

| Method & path | Notes |
|---|---|
| `GET /api/admin/google/accounts` · `DELETE /api/admin/google/accounts/:email` | Linked Google accounts |
| `GET /api/admin/google/calendars?account=` | Calendars of a linked account |
| `GET /api/admin/microsoft/accounts` · `DELETE /api/admin/microsoft/accounts/:email` · `GET /api/admin/microsoft/calendars?account=` | Linked Microsoft accounts and their own and shared calendars (`MicrosoftAccount[]`, `MicrosoftCalendarListItem[]`). `404 feature_unavailable` without `features.microsoftCalendar`; the calendar list answers `409 microsoft_reconnect` when the account must be linked again. `DELETE` answers `{ ok, manageAccess }` (Microsoft has no revoke endpoint: the pages where the access is removed) |
| `POST /api/admin/test/ics` | `{ url, insecureTls? }` → `{ ok, count, sample, error? }` |
| `POST /api/admin/test/rss` | `{ url }` → `{ ok, title, count, error? }` |
| `POST /api/admin/test/homeassistant` | `{ url, token? }` → `{ ok, version?, error? }` |
| `GET /api/admin/homeassistant/entities?domain=sensor\|weather\|camera` | `[{ entity_id, name, state, unit }]` |
| `POST /api/admin/doorbell` | Same body and answer as `POST /api/hooks/doorbell` (the *Test* button of *Home Assistant → Doorbell and camera*, with the values on screen). Logged with `via: "admin"` |
| `PUT /api/admin/homeassistant/token` | `{ token }` |
| `GET /api/admin/weather/key` | `{ set, hint }`: whether an API key for a weather source that needs one (Pirate Weather) is stored, and its last 4 characters. The key itself is never sent back |
| `PUT /api/admin/weather/key` | `{ key }` (letters, digits, `-` and `_`, 8 to 128; `""` removes it). A new key is tried once at the configured place: `400 { error: "key_invalid" }` when the source refuses it (nothing is stored); `{ set, hint, checked }` otherwise (`checked: false` when the source could not be reached). Saving the config with `weather.provider: "pirate-weather"` while no key is stored answers `400` with `weather.apiKey` |

**Photos**

| Method & path | Notes |
|---|---|
| `GET /api/admin/photos` | `[{ file, url, thumbUrl, size, mtime, w, h, focusX, focusY, uploadedAt, hidden }]` |
| `POST /api/admin/photos/check` | `{ names }` → which names already exist |
| `POST /api/admin/photos?onConflict=rename\|replace\|skip` | multipart `photos[]` (≤ 100 MB each), optional `thumbs[]` and `meta` (`[{ focusX, focusY }]`) |
| `PATCH /api/admin/photos/:file` | `{ focusX, focusY }` (0..1) and/or `{ hidden: boolean }` (take the photo out of / back into the rotation) → the photo |
| `POST /api/admin/photos/visibility` | `{ files: string[] (1..2000), hidden: boolean }` → `{ ok, updated, missing, total, inRotation }` (bulk show / hide) |
| `PUT /api/admin/photos/:file/thumb` | multipart `thumb` |
| `DELETE /api/admin/photos/:file` | |

**Displays, announcements, tokens**

| Method & path | Notes |
|---|---|
| `GET /api/admin/displays` | Connected and known displays (screen, IP, browser, resolution, dpr, WebGL, version, outdated, `access`: `key` \| `device` \| `session` \| `open`, `deviceId`, `deviceName`…) |
| `POST /api/admin/displays/command` | `{ action: "reload"\|"identify"\|"night", mode?, clientIds?, screens? }` → `{ ok, delivered }` |
| `DELETE /api/admin/displays/:clientId` | Forget an offline display |
| `POST /api/admin/refresh-displays` | `{ screens? }`, hard reload |
| `POST /api/admin/announce` | `AnnounceRequest` (see webhooks) → `{ ok, announcement, delivered }` |
| `GET /api/admin/announcements` · `DELETE /api/admin/announcements[/:id]` | Active + history; clear one or all |
| `GET /api/admin/tokens` · `POST /api/admin/tokens { name }` · `DELETE /api/admin/tokens/:id` | API tokens (the full token is returned once on creation; max 20) |

**Privacy mode** (`features.privacy`; see [Privacy mode](#privacy-mode))

| Method & path | Notes |
|---|---|
| `GET /api/admin/privacy` | `PrivacyResponse`: `{ screens: [{ screenId, slug, name, active, until, by, resumesAt, scheduled }] }` |
| `POST /api/admin/privacy` | `PrivacyRequest` (same body as the webhook) → `{ ok, changed, screens }`. The admin's quick actions send `{ mode: "on", hours: 1 }`, `{ mode: "on", hours: 3 }`, `{ mode: "on", untilTime: "06:00" }` (until tomorrow), `{ mode: "on" }` (until turned off) and `{ mode: "off" }`, with `screens: [id]` for one screen |

**Backups and activity**

| Method & path | Notes |
|---|---|
| `GET /api/admin/backups` · `POST /api/admin/backups` | List / create a manual backup |
| `GET /api/admin/backups/:id` · `POST /api/admin/backups/:id/restore` · `DELETE /api/admin/backups/:id` | Download / restore (current config backed up first) / delete |
| `POST /api/admin/export` | `{ includeSecrets }` → `marco-YYYY-MM-DD.json` (secrets = password hash, HA token, Google accounts, API tokens, display keys, paired devices (token hashes); never the session secret) |
| `POST /api/admin/import/preview` | `{ bundle, lang? }` (export bundle or a bare config) → per-section summary in `lang` (es/en/pt/nl; default: `Accept-Language`, else English), `displayAccess` (the current mode, which the import keeps) and `secretsImpact: { linksChanged, devicesRemoved, devicesAdded } \| null` (what importing the bundle's secrets would change); nothing saved |
| `POST /api/admin/import/apply` | `{ bundle, sections?, includeSecrets? }` → `{ ok, config, loggedOut? }`. `security.displayAccess` is never taken from the bundle (restores keep it too). Imported keys / devices close the streams of replaced keys and dropped devices |
| `GET /api/admin/activity?type=&level=&q=&actor=&before=&limit=` | Newest first, paged with `before=<id>` |
| `DELETE /api/admin/activity` | Clear the log |

**Updates** (self-hosted, `features.updates`; see docs/ARCHITECTURE.md *Updates*)

| Method & path | Notes |
|---|---|
| `GET /api/admin/update` | `UpdateInfo`: `{ current, latest: { version, name, notes, url, publishedAt } \| null, available, checkedAt, error, checks: 'on'\|'off'\|'env-off', install: { kind: 'release'\|'checkout'\|'docker'\|'manual', canApply, cli }, settings: { check, auto, from, to }, status, log }`. `status` is the last update: `{ state: 'requested'\|'running'\|'done'\|'current'\|'failed', from, to, target, by: 'admin'\|'auto', at, rolledBack, stalled }`; `log` the last lines of the installer's output |
| `PUT /api/admin/update/settings` | `{ check?, auto?, from?, to? }` (`HH:MM`, time zone of *Date & time*) → `UpdateInfo` |
| `POST /api/admin/update/check` | Ask GitHub now (a second call within 20 s answers the stored result) → `UpdateInfo`; `409 checks_disabled` with `MARCO_UPDATE_CHECK=0` |
| `POST /api/admin/update/apply` | Ask the update service for the latest release → `UpdateInfo` with `status.state: 'requested'`. `409` with `error`: `not_supported` (not a release install with `marco-update.path`), `busy`, `up_to_date` |

## Webhooks (`/api/hooks/*`)

Authentication: `Authorization: Bearer cs_…` only (no cookies, no tokens in URLs). JSON bodies.
Errors: `401` missing/invalid token, `400` invalid data (e.g. unknown screen), `415` body is not JSON,
`429` more than 30 requests per minute with the same token.

| Endpoint | Body | Response |
|---|---|---|
| `GET /api/hooks/ping` | none | `{ ok: true, token: "<name>" }` |
| `POST /api/hooks/announce` | `title` (≤ 120) and/or `body` (≤ 500), `emoji`, `style` (`info`/`success`/`warning`/`urgent`), `durationSec` (5–86400, default 30), `sound`, `screens` (slugs or ids; omitted = all) | `{ ok, announcement, delivered }` |
| `POST /api/hooks/reload` | `{ screens? }` | `{ ok, delivered }` |
| `POST /api/hooks/night` | `{ mode: "on"\|"off"\|"auto", screens? }` | `{ ok, delivered }` |
| `GET /api/hooks/privacy` | none | `{ screens: [{ screenId, slug, name, active, until, by, resumesAt, scheduled }] }` |
| `POST /api/hooks/privacy` | `mode` (`on`/`off`/`toggle`), at most one of `hours` (0 to 744), `until` (ISO date and time) or `untilTime` (`HH:MM`, the next time it comes round in the configured time zone); none = until turned off. `screens` (slugs or ids; omitted = all) | `{ ok, changed, screens }` (`changed`: ids of the screens that turned on or off) |
| `POST /api/hooks/doorbell` | `{ action?: "ring"\|"dismiss", seconds?, screens?, camera?, sound? }`, see [Doorbell camera](#doorbell-camera) | `{ ok, action, delivered, screens, expiresAt? }` |

`delivered` = number of connected displays that received it. Active announcements survive server restarts.

```bash
TOKEN=cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl -H "Authorization: Bearer $TOKEN" http://192.168.1.50:3000/api/hooks/ping
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Oven is on!","emoji":"🔥","style":"urgent","durationSec":600,"sound":true,"screens":["kitchen"]}' \
  http://192.168.1.50:3000/api/hooks/announce
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"on","hours":3,"screens":["living-room"]}' http://192.168.1.50:3000/api/hooks/privacy
curl -H "Authorization: Bearer $TOKEN" http://192.168.1.50:3000/api/hooks/privacy
```

Privacy changes are logged in the activity log as `privacy.changed` (`{ mode, via: "admin"|"hook", screens?, active,
until? }`).

## Privacy mode

Per screen, for when you have guests. The rules live in `server/core/privacy.js` (shared with Marco Cloud).

**What changes while a screen is private.** Each calendar has `privacy`: `"busy"` (default), `"hide"` or `"keep"`
(`calendar.sources[].privacy`; `localEvents.privacy` defaults to `"busy"`, `birthdays.privacy` and calendars of kind
`holidays` or `birthdays` default to `"keep"`).

- `busy`: the event keeps its id, start, end, all-day flag, kind and the calendar's colour; the title becomes "Busy"
  in the screen's language (Busy / Ocupado / Ocupado); location, description, emoji and age are removed. A rental
  checkout marker keeps its 🚪.
- `hide`: the event is left out.
- `keep`: unchanged.
- Countdowns: manual ones stay; those from events or birthdays stay only when their calendar is `keep`.
- Weather, news, announcements, scheduled messages, the to-do list and the message of the day do not change.
- `screens[].privacy.hidePhotos`: the background and the photo frame use stock photos only (gallery file names are
  not sent). `screens[].privacy.showLock` (default on): a small lock in the corner of the display.

All of this happens on the server, in `/api/events`, `/api/countdowns`, `/api/display/config` and `/api/photos`,
whatever the credential (the admin preview is a display too). The admin's own pages (Home, Countdowns, Filters
preview) keep showing real data.

**State.** Per screen `{ on, until, by, at }` in `data/privacy.json` (`until` = ISO time or `null` for "until turned
off"; `by` = `admin` or `hook`). It survives restarts; a period that has ended is ignored and pruned.

**Schedule.** `screens[].privacy.schedule`: up to 10 rules `{ id, enabled, days, from, to }` (`days`: 0 = Sunday,
`[]` = every day; `to < from` crosses midnight and belongs to the day it starts). Back-to-back or overlapping rules
count as one window.

**Who wins.**

1. A manual **on** (admin or webhook) lasts until its `until` (or until turned off), whatever the schedule says.
   When it would end inside a schedule window, it goes on until that window ends.
2. A manual **off** during a schedule window lasts until that window ends (the next schedule boundary), then the
   schedule takes over again. Outside a window it only clears the manual state.
3. Otherwise the screen is private while one of its rules is running (`by: "schedule"`).

**Reaching the displays.** Every change sends the `privacy` event (SSE and poll channel) to that screen's displays.
The server also keeps a timer for the next change (a period that ends, a rule that starts or ends) and sends the event
then. `privacy.next` in the display config tells the display when to ask again on its own, in case it missed the
event.

### Home Assistant

Create a token in *API & webhooks*, then in `configuration.yaml`:

```yaml
rest_command:
  marco_privacy:
    url: "http://192.168.1.50:3000/api/hooks/privacy"   # the address of your Marco server
    method: POST
    headers:
      Authorization: "Bearer TOKEN"
    content_type: "application/json"
    payload: '{"mode": "{{ mode }}"{% if hours is defined %}, "hours": {{ hours }}{% endif %}}'

automation:
  - alias: "Marco: private mode while there are guests"
    triggers:
      - trigger: state
        entity_id: input_boolean.guests
    actions:
      - action: rest_command.marco_privacy
        data:
          mode: "{{ 'on' if trigger.to_state.state == 'on' else 'off' }}"
```

`hours: 3` in `data` turns it on for three hours. To show the state in Home Assistant:

```yaml
sensor:
  - platform: rest
    name: "Marco private mode"
    resource: "http://192.168.1.50:3000/api/hooks/privacy"
    headers:
      Authorization: "Bearer TOKEN"
    value_template: "{{ 'on' if value_json.screens | selectattr('active') | list | count > 0 else 'off' }}"
    scan_interval: 60
```

### Doorbell camera

`POST /api/hooks/doorbell` puts the doorbell camera full screen on the screens for a while. Omitted fields take the
values of *Admin → Home Assistant → Doorbell and camera* (`homeassistant.doorbell` in the config).

| Field | Meaning |
|---|---|
| `action` | `"ring"` (default) or `"dismiss"` |
| `seconds` | how long the picture stays, clamped to 10 to 300 (default: the setting, 60) |
| `screens` | slugs or ids. Ring: omitted = the screens of the setting (all by default). Dismiss: omitted = every ringing screen |
| `camera` | a `camera.*` entity for this ring only (default: the setting). Anything else is `400` |
| `sound` | door chime on the screens (default: the setting, on) |

- A ring while the screen is already ringing keeps the same ring and moves its end to the later of the two times
  (it never gets shorter), and the screens chime again.
- `{ ok, action: "ring", delivered, screens: [slug], expiresAt }`; `{ ok, action: "dismiss", delivered, screens }`
  lists the screens that were ringing. Each call is logged in *Activity* (`display.doorbell`).
- The screens fetch `GET /api/display/doorbell/frame` 1 to 2 times a second while the ring lasts. Marco asks Home
  Assistant for `/api/camera_proxy/<camera>` with the stored token and hands the picture to the screen; displays that
  ask within 500 ms share one picture, so Home Assistant gets about two requests a second whatever the number of
  screens. Pictures are kept in memory only for those 500 ms and never written to disk. The token and the camera
  entity never reach a screen. Rings are kept in memory: after a server restart nothing rings.
- The overlay shows above night mode: a dimmed screen is fully lit while it rings and goes back to night mode when the
  ring ends. A screen turned off by an HDMI schedule (`deploy/screen-schedule.sh`) stays off.
- The chime uses the screen's alert volume (*Alerts*). The kiosk (`deploy/kiosk.sh`) starts Chromium with
  `--autoplay-policy=no-user-gesture-required`, so it plays without a tap; other browsers may stay silent until
  someone has touched the page once.
- Without a camera (`camera: ""`) the screens show a bell and "Someone is at the door".

**Servers with snapshots instead of a live camera** (`features.doorbell` on, `features.doorbellLive` off: Marco Cloud,
which cannot reach Home Assistant) take the picture with the ring. `POST /api/hooks/doorbell` then also accepts
`multipart/form-data` with an `image` file and the same fields as form fields (`screens` comma separated), or a raw
`image/jpeg`, `image/png` or `image/webp` body with the fields in the query (`?seconds=60&screens=hall`). The picture is
checked by its first bytes and may be 2 MB at most (`413`, `415` otherwise). Only the latest picture of the household is
kept, only while a screen rings and 10 minutes at most, and `GET /api/display/doorbell/frame` returns it to screens
that ring (`404 { code: "no_camera" }` when there is none, `refreshMs` is a few seconds). A picture sent without
`action` while the screens already ring replaces the one they show and makes the ring last longer, without a second
chime (with `action: "ring"` it rings again). A new ring without a picture never shows the picture of an earlier
one. `camera` is refused there. The admin shows the doorbell card on the *API & webhooks* page, with a test that sends a sample
picture (`POST /api/admin/doorbell` takes the same multipart form).

Home Assistant example (`configuration.yaml`; replace `marco.local`, the token and the entity ids with your own):

```yaml
rest_command:
  marco_doorbell:
    url: "http://marco.local:3000/api/hooks/doorbell"
    method: POST
    headers:
      Authorization: "Bearer cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    content_type: "application/json"
    payload: '{"action":"{{ action | default(''ring'') }}","seconds":{{ seconds | default(60) }}}'

automation:
  - alias: "Doorbell on the Marco screens"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door_doorbell
        to: "on"
    action:
      - service: rest_command.marco_doorbell
        data:
          action: ring
          seconds: 90
    mode: single

  - alias: "Front door opened: take the camera off the screens"
    trigger:
      - platform: state
        entity_id: binary_sensor.front_door_contact
        to: "on"
    action:
      - service: rest_command.marco_doorbell
        data:
          action: dismiss
```

With curl:

```bash
TOKEN=cs_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"ring","seconds":60,"screens":["kitchen"],"camera":"camera.front_door"}' \
  http://marco.local:3000/api/hooks/doorbell
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"dismiss"}' http://marco.local:3000/api/hooks/doorbell
```

