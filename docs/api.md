# Companion server API

BookmarkForge exposes a companion server for P2P signaling, health, licenses, client events, analytics, and administrative diagnostics.

The normative contract is in [`docs/openapi.yaml`](./openapi.yaml). Protected endpoints apply origin validation, rate limiting, body limits, and admin tokens where appropriate.

## Main endpoints

- `GET /health`: minimal healthcheck.
- `POST /api/license/activate`: license activation.
- `POST /api/license/validate`: license validation.
- `POST /api/license/entitlement`: server-authoritative plan resolution. The reply includes `isInTrial`/`trialDaysRemaining` computed from the signed trial window (`trialStartedAt`/`trialExpiresAt`) in the license proof, never from a client-supplied timestamp.
- `POST /api/client-events`: redacted technical events.
- `POST /api/analytics/events`: aggregated opt-in analytics.
- `GET /admin`: signaling diagnostics, protected by token.

The server does not receive vault content and does not act as a general proxy for AI providers.
