# BookmarkForge

> Distribution model: **Open Core**. The public Core is licensed under MIT;
> Pro features identified in `OPEN-CORE.md` are proprietary and not covered
> by that license.

Local-first personal knowledge application: encrypted storage, offline
operation, optional P2P sync, and AI features that call **directly** to the
provider the user configures.

## Project status

<!-- Status 2026-09-19: `bookmarkforge/core` is the confirmed destination —the remote,
     package.json, badges, and exported RELEASE-NOTES match—, but there is no
     evidence yet of verified PRs or CI runs on GitHub. Before publishing, run
     workflows against the remote repository; see docs/github-secrets-and-push-runbook.md
     and docs/audit.md. -->

> **Note**: Badges point to the confirmed destination `bookmarkforge/core`; the
> `check:release-target` gate returns 0 while the four surfaces match.
> Run `npm run check:ci` locally to verify everything passes before push.

[![CI](https://github.com/bookmarkforge/core/actions/workflows/ci.yml/badge.svg)](https://github.com/bookmarkforge/core/actions/workflows/ci.yml) · [![Nightly validation](https://github.com/bookmarkforge/core/actions/workflows/nightly.yml/badge.svg)](https://github.com/bookmarkforge/core/actions/workflows/nightly.yml) · [failed runs](https://github.com/bookmarkforge/core/actions/workflows/nightly.yml?query=conclusion%3Afailure) · [latest release](https://github.com/bookmarkforge/core/releases/latest) · [nightly operation](docs/ops-nightly.md)

## Requirements

- Node.js `>=20.19.0`
- npm
- Docker Compose for containerized environments

## Local development

```bash
npm ci
cp .env.example .env
npm run typecheck
npm run lint
npm run test:fast
npm run dev
```

The frontend runs with Vite in PWA mode. The companion server starts with
`npm run server` and exposes **P2P WebSocket signaling**, `/health`, license
endpoints (`/api/license/*`), CSP reports, opt-in client telemetry, and
opt-in aggregated analytics. The server does not receive vault content.

### AI providers

There is no AI proxy on the server. Each call goes directly from the browser
to the chosen provider, with a key the user saves encrypted in their own vault
(`securityVault`) from Settings:

- Cloud: Gemini, OpenAI, Anthropic, Groq, Hugging Face, OpenRouter.
- Local: Ollama and in-browser models with WebLLM.

Security consequence: the user's key never passes through our servers, and the
server does not need (nor accept) any AI credentials. Cloud calls are made
directly from the browser with the user's key.

## Verification before merging

```bash
npm run typecheck:prod
npm run lint
npm run test:fast
npm run build:ci
npm run check
```

Real secrets must not be introduced into the repository. Use a secret manager
or environment variables outside version control. `scripts/check-secrets-in-commit.mjs`
runs as a CI gate.

## Architecture

```text
Browser / PWA / Extension
          |
          | HTTPS/WSS
          v
Reverse proxy (TLS, CSP, static assets)
          |
          +--> Web frontend (React/Vite)  ---> User's AI providers (BYO key)
          |
          +--> Companion server (Node/ws)
                  +--> P2P WebSocket signaling
                  +--> licenses and entitlement (Ed25519/RSA-PSS)
                  +--> health, CSP reports, opt-in telemetry

Client: React + TypeScript + RxDB/IndexedDB + Web Workers + WebRTC
Cryptography: AES-GCM, Argon2id/HKDF, keys managed in workers
```

The client is the primary source of vault data. The two services in the
production topology are **stateless**: there is no shared database or Redis.

## Production

The topology is in `docker-compose.prod.yml` (services `web` and `api`).
Requires configuring secrets and endpoints via the deployment environment.
Deployment must use SHA-identified images, run all gates, and maintain a
tested rollback procedure.

```bash
npm run check:env
npm run check:secrets-in-commit
npm run check:marketing
npm run build:ci
npm run production-smoke
```

Do not run deployment scripts against production without explicit operational
approval.

## Security and privacy

- TLS must terminate at the reverse proxy with HTTPS redirect and HSTS.
- Configure `AI_SESSION_ORIGINS` with the exact browser origins. It is the
  allow-list for `POST /api/license/entitlement` and a **mandatory** variable
  in production: without it the production compose will not start. The name is
  historical (the endpoint responds to the license *plan*, not an AI session).
- The license public key lives in two copies (`src/services/licenseKeys.ts` and
  `server/src/license-public-key.ts`). `node scripts/generate-license-keys.mjs
  --sync-server-key` aligns them and `npm run check:license-keys` fails if they
  diverge.
- Keep `ENFORCE_SIGNAL_HMAC=1` in production.
- Do not expose internal service ports to the host; compose publishes on loopback.
- Do not log passwords, keys, prompts, or vault content.
- Automatic backups are encrypted; restoration must be tested periodically.

Encryption and technical measures alone do not constitute a GDPR compliance
statement. The controller must maintain records of processing, retention,
rights, providers, and legal basis.

## Minimal operation

- `/health` is a liveness endpoint with no sensitive data.
- Configure `SIGNALING_ADMIN_TOKEN` and `CSP_REPORT_ADMIN_TOKEN` only in the
  secret manager.
- Review structured events, critical errors, saturation, connections, latency,
  and availability.
- Define and record RPO/RTO before public launch.
- Run a backup restore at least monthly and a disaster simulation quarterly.

## Licenses and Open Core model

- [Open Core model](OPEN-CORE.md)
- [Core MIT license](LICENSE)
- [Pro proprietary license](PRO-LICENSE.md)
- [Trademark policy](scripts/public-export/TRADEMARKS.md)

The private checkout contains the Core and Pro components. To obtain the
reproducible public repository use `node scripts/export-public-repo.mjs`; do
not publish the complete checkout as if everything were under MIT.

## Documentation

- [Documentation index](docs/index.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Operations](docs/operations.md)
- [Companion server API](docs/api.md)
- [OpenAPI specification](docs/openapi.yaml)
- [Audit](docs/audit.md)
- [ROPA (GDPR)](docs/ROPA.md)
- [Launch checklist](docs/launch-checklist.md)
- [Commercial positioning](docs/positioning.md)
- [30-day commercial validation plan](docs/market-validation-plan.md)
- [Self-hosting](docs/SELF-HOSTING.md)
- [Engineering conventions](AGENTS.md)
- [Contributor onboarding](docs/ONBOARDING.md)

### User manuals

Each language has a Markdown version (source) and a PDF generated from the same
content.

| Language | Markdown | PDF |
|---|---|---|
| Spanish | [manual-usuario.md](docs/manual-usuario.md) | [manual-usuario.pdf](docs/manual-usuario.pdf) |
| English | [manual-usuario-en.md](docs/manual-usuario-en.md) | [manual-usuario-en.pdf](docs/manual-usuario-en.pdf) |

The other 28 locales live in `docs/manual-usuario-<code>.md` (+ `.pdf`) and are
listed in [docs/index.md](docs/index.md). The intermediate `*-styled.html` files
are generated with `npm run docs:pdf:localized` and are not versioned.

### Scripts and tools

168 build, verification, and operations scripts in `scripts/README.md`.
Checks are organized into 8 groups for faster iteration:

| Group | Time | Usage |
|---|---|---|
| `core-integrity` | ~3s | `npm run check:core-integrity` |
| `security-environment` | ~4s | `npm run check:security-environment` |
| `quality-code` | ~25s | `npm run check:quality-code` |
| `content-integrity` | ~12s | `npm run check:content-integrity` |
| `brand-visual` | ~5s | `npm run check:brand-visual` |
| `security-depth` | ~8s | `npm run check:security-depth` |
| `build-verification` | ~60s | `npm run check:build-verification` |
| `workflow-pipeline` | ~5s | `npm run check:workflow-pipeline` |

For fast iteration: `npm run ci:fast` (~7s) or `npm run check:ci-groups --fast`.
See `scripts/README.md` for the complete tool catalog.

---

*BookmarkForge v1.0.0 — Open Core: MIT Core + proprietary Pro.*
