# BookmarkForge Companion Server

Minimal HTTP + WebSocket server for P2P signaling, licenses, and analytics.

## Architecture

```
server/src/
├── index.ts              # Entry point: HTTP server + WebSocket server
├── proxy-utils.ts        # Utilities: readBoundedInteger, constantTimeUtf8Equal, clientIp
├── route-table.ts        # HTTP route policy (Pro vs Core)
├── license-server.ts     # Whop license handling (activate/validate/deactivate)
├── license-signing.ts    # Cryptographic license signing
├── license-public-key.ts # License verification public key
├── entitlement-endpoint.ts  # POST /api/license/entitlement
├── entitlement-guard.ts    # Entitlement middleware for routes
├── entitlement-context.ts  # Entitlement context
├── client-events.ts        # Client event collector (storage-pressure)
├── business-analytics.ts   # Opt-in analytics (DAU/WAU/MAU)
└── __tests__/              # Server tests
```

## Features

- **WebSocket signaling**: P2P rooms with secrets, HMAC for signals, IP-based rate limiting
- **HTTP endpoints**: `/health`, `/admin`, `/csp-report`, `/api/license/*`, `/api/client-events`, `/api/analytics/*`
- **TURN relay**: Ephemeral credentials via coturn/REST API
- **CSP reporting**: Violation collector with optional JSONL persistence
- **Rate limiting**: Time windows per IP for joins and reports
- **Heartbeat**: Sweep of dead sockets to clean rooms

## Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Liveness probe (no sensitive data) |
| GET | `/admin` | Diagnostics (requires `SIGNALING_ADMIN_TOKEN`) |
| POST | `/csp-report` | CSP violations (per-IP rate limited) |
| GET | `/csp-report` | Report dashboard (requires `CSP_REPORT_ADMIN_TOKEN`) |
| POST | `/api/license/activate` | Activate license |
| POST | `/api/license/validate` | Validate license |
| POST | `/api/license/deactivate` | Deactivate license |
| POST | `/api/license/entitlement` | Resolve Pro/Free plan |
| POST | `/api/client-events` | Storage events |
| POST | `/api/analytics/events` | Analytics events |
| WS | `/` | P2P WebSocket signaling |

## Configuration

Main environment variables:
- `PORT` / `HOST` — Server port and host
- `SIGNALING_ADMIN_TOKEN` — Token for `/admin`
- `CSP_REPORT_ADMIN_TOKEN` — Token for `/csp-report` dashboard
- `CSP_REPORT_FILE` — Path to JSONL CSP persistence file
- `TRUST_PROXY` — If `1`, uses x-forwarded-for for real IP
- `TURN_RELAY_HOST` / `TURN_STATIC_AUTH_SECRET` — TURN configuration
- `ENFORCE_SIGNAL_HMAC=1` — HMAC mandatory for signals

## Development

```bash
npm run server          # Starts the server with tsx
npm run server:watch    # Watch mode
```

## Testing

```bash
# Server tests
npx vitest run server/src/__tests__/
```

## Security

- Constant-time HMAC for room secrets and signals
- IP-based rate limiting with time windows
- WebSocket origin filtering
- CSP report anonymization (IP hash)
- TLS-only webhooks for CSP alerts
- Admin endpoints fail-closed (503 if no token)
- Dead socket reaping with heartbeat

## Status

The server is **stateless** — no database or Redis. All room state lives in memory. Services are:
- **Web**: React + Vite (frontend)
- **API**: Companion server (Node.js + WS)
- Both are stateless and independently deployable

See `docs/server-api-index.md` for the full API specification.
