# Companion server API

BookmarkForge exposes a companion server for P2P signaling, health, and administrative diagnostics. It collects **zero telemetry**: the client never transmits usage, error, or analytics data off-device. License endpoints are **not** served by it: they belong to the serverless function in `api/license/[action].ts` (see [server-api-index.md](./server-api-index.md)), which the companion stopped mounting on 2026-10-19.

The normative contract is in [`docs/openapi.yaml`](./openapi.yaml). Protected endpoints apply origin validation, rate limiting, body limits, and admin tokens where appropriate.

## Companion endpoints

- `GET /health`: minimal healthcheck.
- `GET /og`, `GET /og-image.svg`: public Open Graph card generation.
- `POST /csp-report`, `GET /csp-report`: CSP violation ingest (public POST, browser security reports) and admin read.
- `GET /admin`: signaling diagnostics, protected by token.

## License endpoints (serverless function)

The license backend is private Pro infrastructure and is **not** part of the
public MIT export; these paths exist only on the hosted deployment.

- `POST /api/license/activate`: license activation.
- `POST /api/license/validate`: license revalidation.
- `POST /api/license/deactivate`: release an activation slot.
- `GET /api/license/health`: provider health.

There is no `/api/license/entitlement` route: plan resolution happens
client-side from the signed payload returned by `activate`/`validate`.

The server does not receive vault content and does not act as a general proxy for AI providers.
