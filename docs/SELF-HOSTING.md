# Self-Hosting Guide (Internal)

> This document is NOT included in public exports.
> For internal use only.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_WHOP_CHECKOUT_URL` | Whop checkout URL for Pro | `https://whop.com/checkout/<your-product-id>` |
| `VITE_APP_VERSION` | App version | `1.0.0` |
| `VITE_DB_NAME` | IndexedDB database name | `bookmarkforge_v5` |
| `VITE_SENTRY_DSN` | Sentry DSN for error reporting | *(optional)* |
| `AI_SESSION_ORIGINS` | Exact browser origins allowed to call `POST /api/license/entitlement` | `https://bookmarkforgeapp.com` |

> **Security note:** `AI_SESSION_ORIGINS` is **required in production** — the
> production Compose file refuses to start without it. Any other origin receives
> `403 CSRF_ORIGIN`. The name is historical: the endpoint answers the license
> *plan*, it is not an AI session.

## Architecture

BookmarkForge self-hosts as two stateless services. AI requests go from the
browser straight to the provider the user configured, using a key stored in the
user's own encrypted vault. No AI credential is configured on the server.

- **Web:** static assets (React/Vite build) served behind the reverse proxy.
- **API (companion server):** Node.js + `ws` on port 8787 — P2P signaling,
  licensing/entitlement, health, CSP reports and opt-in telemetry.
- **Docker Compose:** `docker-compose.prod.yml` for production,
  `docker-compose.staging.yml` for local staging (with `license-mock`).

Neither service keeps shared state: no Redis, no database, no session store.

## Server API

### License Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness probe |
| `/api/license/health` | GET | License provider health |
| `/api/license/activate` | POST | Activate license with Whop |
| `/api/license/validate` | POST | Revalidate existing license |
| `/api/license/deactivate` | POST | Release activation slot |
| `/api/license/entitlement` | POST | Verify Pro/Free status |

### Telemetry and Diagnostics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/client-events` | POST/GET | Opt-in degradation events / collector diagnostics |
| `/api/client-events/retry-stats` | GET | Reporter retry counters |
| `/api/analytics/events` | POST | Opt-in daily aggregate |
| `/api/analytics/kpis` | GET | Analytics KPIs (admin token) |
| `/admin` | GET | Signaling diagnostics (admin token) |
| `/csp-report` | GET/POST | CSP violation reports |

There are **no AI endpoints**. `docs/openapi.yaml` is the authoritative spec, and
`server/src/route-table.ts` is the authoritative route table.

## Security Architecture

- Private signing key never leaves the server and is mounted as a Compose secret
- Browser never calls Whop directly
- All license validation is server-side with RSA-PSS signatures
- Entitlement guard is the single enforcement point for paid routes
- `check:pro-routes` fails the build when the router and the route table disagree
- `check:compose-config` / `check:runtime-config` fail when Compose reintroduces
  retired provider credentials or upstream configuration
