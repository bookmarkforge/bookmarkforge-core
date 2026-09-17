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
| `AI_SESSION_REQUIRE_LICENSE` | License required for AI (1=yes, 0=no) | `1` |

> **Security note:** `AI_SESSION_REQUIRE_LICENSE` defaults to `1` and production
> REFUSES `0` (throws error on startup). This cannot be disabled in production.

## Architecture

BookmarkForge can be self-hosted with the following components:

- **Signaling server:** Node.js + WebSocket (port 8787)
- **AI proxy:** Node.js proxy for Gemini/OpenAI
- **License server:** Node.js with Whop adapter
- **Docker Compose:** available for production

See `docker-compose.prod.yml` for the full topology.

## Server API

### License Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Liveness probe |
| `/api/license/activate` | POST | Activate license with Whop |
| `/api/license/validate` | POST | Revalidate existing license |
| `/api/license/deactivate` | POST | Release activation slot |
| `/api/license/entitlement` | POST | Verify Pro/Free status |

### AI Endpoints (Pro only)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/services/ai/session` | POST | Create AI session with license |
| `/api/services/ai/generate` | POST | Text generation |
| `/api/services/ai/generate-tts` | POST | Text-to-speech |
| `/api/services/ai/generate-image` | POST | Image generation |

### Analytics Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics/events` | POST | Opt-in analytics |
| `/api/analytics/kpis` | GET | Analytics KPIs (admin token) |

## Security Architecture

- Private signing key never leaves the server
- Browser never calls Whop directly
- All license validation is server-side with RSA-PSS signatures
- Entitlement guard is the single enforcement point
- Sessions track license expiry (not just cookie TTL)
- Build-time gate ensures all paid routes are guarded
