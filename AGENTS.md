# AGENTS.md — BookmarkForge

## Git remotes

Two remotes exist and they are **different repositories**:

- `origin` → `github.com/bookmarkforge/bookmarkforge-core` — **canonical working repo** (private checkout, Pro code).

When in doubt, push to `origin` only.

## Common commands

- Dev server: `npm run dev`
- Typecheck (all configs): `npm run typecheck` / `typecheck:prod` / `typecheck:server` / `typecheck:tests`
- Lint: `npm run lint` (batched ESLint, ~1800 files)
- Fast tests: `npm run test:fast`; full suite: `npm run test:all`
- E2E: `npm run e2e` (Playwright)
- Full local CI equivalent: `npm run check:ci` (heavy — runs every gate)

## Conventions

- Secrets live only in `.env*` files (gitignored). Never commit real values; `.env.example` is the template.
- Windows checkout: `core.autocrlf=true` is set globally; `.gitattributes` (`* text=auto`) keeps the index LF — do not "fix" EOL by hand.
- New routes on the companion server must go through `server/src/route-table.ts` (enforced by `check:pro-routes`).
- License API env vars are documented in `docs/ENVIRONMENT.md` ("License endpoint" section).
