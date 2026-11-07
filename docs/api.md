# Companion server API

BookmarkForge exposes a companion server for P2P signaling, health, client events, analytics, and administrative diagnostics. License endpoints are **not** served by it: they belong to the serverless function in `api/license/[action].ts` (see [server-api-index.md](./server-api-index.md)), which the companion stopped mounting on 2026-10-19.

The normative contract is in [`docs/openapi.yaml`](./openapi.yaml). Protected endpoints apply origin validation, rate limiting, body limits, and admin tokens where appropriate.

## Companion endpoints

- `GET /health`: minimal healthcheck.
- `POST /api/client-events`: redacted technical events.
- `POST /api/analytics/events`: aggregated opt-in analytics.
- `GET /admin`: signaling diagnostics, protected by token.

## License endpoints (serverless function)

- `POST /api/license/activate`: license activation.
- `POST /api/license/validate`: license validation.
- `POST /api/license/entitlement`: server-authoritative plan resolution.
- `GET /api/license/health`: provider health.

The server does not receive vault content and does not act as a general proxy for AI providers.
