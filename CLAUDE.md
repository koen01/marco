# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Marco is a self-hosted family wall calendar and dashboard (Raspberry Pi kiosk or any browser). `docs/ARCHITECTURE.md`
(processes, data model, config schema, guaranteed behaviour) and `docs/API.md` (endpoints, event formats) are the
detailed references; read the relevant section before changing a subsystem, and update them when behaviour changes.

## Commands

```bash
npm ci
npm run dev          # API on :3000 (node --watch) + Vite on :5173 (proxies /api, /auth, /media)
                     # display http://localhost:5173/  ·  admin http://localhost:5173/admin/
npm run demo         # production build with a throw-away data dir and a fictional family (also /?demo=1)
npm test             # all server tests (node --test server/test/)
node --test server/test/ics.test.js                               # one test file
node --test --test-name-pattern="<regex>" server/test/ics.test.js # one test by name
npm run typecheck    # tsc --noEmit over web/ (display + admin)
npm run contract     # regenerate web/shared/adminContract.json
npm run build        # Vite build into dist/
shellcheck install.sh deploy/*.sh deploy/marco scripts/*.sh
bash install.sh --dry-run   # try installer changes without touching the system
```

CI (`.github/workflows/ci.yml`, Node 20 and 22) runs: `npm test`, `npx tsc --noEmit -p .`,
`node scripts/gen-contract.mjs --check`, `npm run build`, shellcheck, and a Docker build. There is no linter or formatter.

Run `npm run contract` whenever `web/admin/api.ts` or `web/shared/types.ts` changes; CI fails when the file is stale.
The generator only parses the call shapes `api.ts` already uses (`request<T>('METHOD', url, body?, opts?)`, `xhrUpload`)
and stops on anything else, and a new admin path may need an entry in its `FEATURE_RULES`.

## Architecture

One Node process (Express 5, Node >= 20) serves the API and the Vite build in `dist/`: `/` is the display, `/admin/`
the admin panel. Three codebases with different rules:

- `server/`: plain ESM JavaScript, no build step, no TypeScript. `app.js` `createApp()` builds the whole Express
  stack (host guard, sessions, CSRF, display access, routers in `routes/`, static files); `index.js` adds the store,
  listen and shutdown. Tests start the real app with `createApp()` on a random port.
- `web/display/`: vanilla TypeScript + three.js, no framework. Widgets patch the DOM in place.
- `web/admin/`: Preact + TypeScript.
- `web/shared/`: types (`types.ts` holds the config and API contracts), i18n, screen projection, used by both front ends.

### `server/core/` is shared with Marco Cloud

Marco Cloud (a hosted edition on a Workers runtime, not in this repository) copies `server/core/` as it is. So core
must stay pure: no Node built-ins (`node:*`, `Buffer`, `process`), no imports from outside the folder, no store, SSE or
HTTP modules, and only the npm packages allowlisted in `server/test/core-lint.test.js` (which enforces all of this).
The pattern is a pair of files: a core module holds validation and logic, and `server/foo.js` adds files, network and
SSE and re-exports what callers need. Most pairs are named `fooCore.js` (`backups`, `announce`, `doorbell`,
`activity`); the others are `pairing.js` → `pairCore.js`, `privacy.js` → `core/privacy.js`, `news.js` →
`newsParse.js`, `photos.js` → `imageInfo.js`.

The two editions also share the admin build. `GET /api/health` returns a `features` block (`server/capabilities.js`,
`FEATURE_KEYS`) that the admin and display read to decide which sections and actions exist (`web/admin/caps.ts`), and
`web/shared/adminContract.json` is the route contract both servers are tested against. A new feature that one edition
may lack needs a feature key, not a hard-coded assumption.

### Storage and config

No database. Everything lives in JSON files under `data/` (git-ignored, `DATA_DIR` overrides), always written with
`writeFileAtomic` (`server/store.js`). `config.json` is the configuration; `secrets.json` holds hashes, tokens and
display keys and is never sent to displays.

- Config is schema v2: **global** sections plus a list of **screen profiles**. Defaults in `server/core/defaults.js`,
  limits and validation in `server/core/validate.js`, TS type `StoredConfig`. The display and most admin pages work on
  a flat view of one screen (`AppConfig`): `flatView()` in `server/core/screens.js`, `projectScreen()` /
  `applyScreen()` in `web/shared/screens.ts`. A new setting has to be added in defaults, validation, the types and,
  for a per-screen one, considered for screens stored without the key (`mergeDefaults`).
- `config.revision` is bumped on every save and the admin sends `baseRevision` (stale gets `409`). Only real admin
  saves may write `config.json`: background work (calendar refresh, pairing, display links, commands, privacy state)
  stores its state elsewhere.

### Events pipeline

`getEvents({ from, to, screen })` in `server/calendars.js`: sources visible on the screen (ICS, Google, Microsoft,
local events, birthdays, each with its own cache and stale-on-error) → recurrence expansion in the configured time
zone → kind normalisation (airbnb, holidays) → event rules (hide / rename / style) → decoration (emoji and colour
priority chains) → sort and a stable `hash` so displays skip unchanged data. Privacy mode is applied after the
pipeline and only on the display endpoints (`server/routes/public.js`, `server/core/privacy.js`), so a display never
receives the real titles; admin lists keep them.

### Display

- Must never visibly reload for routine updates. Animate with CSS transforms and opacity only; WebGL is capped
  (30 fps, `devicePixelRatio <= 1`) and can be off entirely (`?lite=1`). It has to run on a Raspberry Pi.
- Live updates use SSE (`/api/stream`, `server/sse.js`) or polling (`/api/display/poll`, `server/pollHub.js`),
  chosen by `live` in `/api/health`. `web/display/live.ts` has one `dispatch` used by both transports: a new live
  event has to work through both.
- Access (`server/displayAccess.js`): a display key in the path (`/d/<key>`), a paired-device token, or an admin
  session; `config.security.displayAccess` is `private` or `open`. A credential always decides the screen.

## Conventions

- Avoid new runtime dependencies and never add native modules (must install on a Pi without build tools). Every
  outbound fetch has a 15 s timeout, and a failing source must not break the others.
- New server logic comes with a `node --test` test in `server/test/`. Tests run offline (fetch is stubbed) with a
  temporary data dir; admin TypeScript modules are loaded in tests through `server/test/webModules.js` (Vite SSR).
  On Node 22 `npm test` imports every `*.test.js` into one process (`server/test/index.js`), so a test must restore
  what it changes globally (`fetch`, `process.env`).
- UI text exists in English, Spanish and Portuguese, in three places. Add all three languages for each new string.
  Dutch (`nl`) is a screen language only: add it for display and server-generated text, not for the admin:
  - admin: the **Spanish string is the key** (`t('…')`), with English and Portuguese in `web/admin/i18n-dict*.ts`
  - display: `web/shared/i18n.ts`
  - server-generated text: `server/core/lib/i18n.js`
- Writing style for docs, UI strings in every language, commit messages and script output: plain and direct. No em
  dashes (use a comma, colon, parentheses or a new sentence) and no marketing words. Say what a feature does.
- User-visible changes get an entry under `## [Unreleased]` in `CHANGELOG.md` (Keep a Changelog). Its version
  section becomes the release notes and the admin's "What's new" text. `README.es.md` mirrors `README.md`.
- `install.sh` must keep working when piped into `bash` (prompts read from `/dev/tty`). It is the only installer;
  `deploy/install.sh` wraps it with `--source`.
- Never put real calendar URLs, tokens, names or other personal data in tests, fixtures or screenshots.
- Releases: a `v*` tag must match `package.json` `version`; `.github/workflows/release.yml` tests, builds, packages
  the tarball (`scripts/package-release.sh`) and publishes it. `npm run check:release` fails while a repository URL
  placeholder is left.
