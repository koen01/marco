# Contributing to Marco

Thanks for your interest! Bug reports, ideas, translations and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/mr-reb00t/marco.git
cd marco
npm ci
npm run dev      # API on :3000 (node --watch) + Vite on :5173 → http://localhost:5173/ and /admin/
npm run demo     # or: a production build with a fictional family and sample photos
```

Requirements: Node.js 20 or newer (22 LTS recommended). No native modules and no database: data lives in JSON files.

## Before you open a pull request

```bash
npm test                 # server tests (node --test); MARCO_SKIP_BROWSER=1 npm test skips the headless Chrome ones
npx tsc --noEmit -p .    # type check (display + admin)
npm run contract         # if you changed web/admin/api.ts or web/shared/types.ts (CI checks it is up to date)
npm run build            # production build
shellcheck install.sh deploy/*.sh deploy/marco scripts/*.sh   # if you changed a shell script
```

Publishing a fork? Point the repository URLs (READMEs, `web/shared/project.ts`, `.github/`) at your fork;
`npm run check:release` fails while a repository URL placeholder is left (CI runs it for `v*` tags).

- Keep the server plain ESM JavaScript (no build step) and avoid new runtime dependencies: it has to run well on a
  Raspberry Pi. Every JSON data file is written atomically (`writeFileAtomic`).
- New server logic should come with a `node --test` test in `server/test/`.
- Logic that needs no files, network or SSE goes in `server/core/`, which Marco Cloud also runs: no Node built-ins
  (`node:*`, `Buffer`, `process`) and no imports from outside the folder. `server/test/core-lint.test.js` checks it.
- The display must never visibly reload for routine updates; animate with CSS transforms/opacity only and keep the
  WebGL layers capped (see `docs/ARCHITECTURE.md`).
- UI text: the admin uses the Spanish string as the translation key (`t('…')`) with English/Portuguese entries in
  `web/admin/i18n-dict*.ts` and Dutch/Danish entries in `web/admin/i18n-dict-nl.ts` and `i18n-dict-da.ts` (the
  Familia rows in `i18n-dict-family.ts`); the display uses `web/shared/i18n.ts`; server-generated text uses
  `server/core/lib/i18n.js`. Please add all five languages when you add a string (ask for help in the PR if you
  only speak some of them; a missing Dutch or Danish value shows the English one, and
  `server/test/i18n-complete.test.js` lists what is missing).
- Writing style (docs, UI strings in every language, commit messages, script output): plain and direct. No em
  dashes (use a comma, colon, parentheses or a new sentence) and no marketing words. Say what a feature does.
- Installer changes: try `bash install.sh --dry-run` first, and keep `install.sh` working when it is piped into
  `bash` (prompts read from `/dev/tty`).
- Never put real calendar URLs, tokens, names or other personal data in tests, fixtures or screenshots.
  `npm run demo` and `/?demo=1` provide a fictional dataset for screenshots.

## Translations

A new language needs entries in the three dictionaries above plus the language list in `web/shared/types.ts`
(`Lang`). Open an issue first so we can coordinate.

## Reporting bugs

Use the issue templates. Include the version (admin → Status, or `GET /api/health`), how you installed it, and the
display hardware/browser. Remove private data from logs and screenshots.

By contributing you agree that your contributions are licensed under the MIT License of this project.
