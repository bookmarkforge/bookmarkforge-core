# BookmarkForge Scripts

This directory contains the build, verification, and operational tooling for
the project. **The authoritative inventory is `package.json`** (156 declared
scripts) plus the ~230 standalone files in this folder — this README explains
how they are organized rather than listing each one.

## How scripts are invoked

Almost everything runs through npm scripts defined in `package.json`. The
consolidated entry points are:

| Command | What it runs |
|---------|--------------|
| `npm run check` | Full offline gate chain (~60 gates) |
| `npm run check:all` | The five big groups: security, quality, content, brand, build |
| `npm run check:pr` | PR gate: typecheck + lint + fast tests + security/config gates |
| `npm run check:deploy` / `check:nightly` | Release/nightly chains |
| `npm run ci:local` | What CI runs locally (all typechecks + lint + tests + build + check) |
| `npm run test:fast` / `test:slow` / `test:all` | Bounded test profiles |
| `npm run e2e:smoke` / `e2e` | Playwright batteries |
| `npm run help` | Prints the common-command cheat sheet |

Individual gates are also runnable directly, e.g.
`node scripts/check-secrets-in-commit.mjs` or `npm run check:seo`.

## Naming conventions

- `check-*` — verification gates that fail fast (the `check:*` npm aliases map to these)
- `validate-*` — configuration/security validation of deploy artifacts
- `build-*` / `generate-*` — build and content generation
- `test-*` / `run-*` — test runners and profiles
- `benchmark-*` / `drill-*` / `load-test-*` — performance and disaster-recovery drills
- `doctor-*` / `audit-*` — diagnostics and audit machinery
- `deploy-*` / `staging-*` / `production-*` / `rollback*` — operations (private infra)
- `monitoring-*` / `nightly-*` — alerting and nightly reporting
- `export-public-repo.mjs` — produces the public MIT export (private tooling)

## Key subdirectories

- `__tests__/` — vitest suites for the scripts themselves
- `tooling/` — internal helpers (e.g. the bounded linter)
- `translations/` — landing translation sources (30 locales)
- `templates/` — landing page templates
- `public-export/` — overlay files applied by `export-public-repo.mjs`
  (excluded from the export itself; they become the public tree's files)

## Notes

- Gates listed in the `check` chain are frozen by `check-inspector-freeze`;
  adding a new chain gate requires an ADR that names it.
- Baseline JSON files (`*-baseline.json`) are ratchets: they freeze current
  debt and fail when it grows. Regenerate only with the documented update
  flag, never by hand.
- Scripts that touch secrets, deploys, or the public export are private-repo
  tooling and are excluded from the MIT export by `export-public-repo.mjs`.
