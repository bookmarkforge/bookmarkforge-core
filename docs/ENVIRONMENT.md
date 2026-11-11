# Environment Variables Reference

This document describes all environment variables used by BookmarkForge.

## Quick Start

For local development, most variables have safe defaults. Only configure what you need:

```bash
# Minimal setup for local development
cp docs/ENVIRONMENT.md .env.local
# Edit .env.local with your values
npm run dev
```

## Variable Categories

### 🔴 Required for Production
- `VITE_P2P_SIGNALING_URL` - P2P signaling server
- `WS_ALLOWED_ORIGINS` - WebSocket origin allow-list
- `CLIENT_EVENTS_IP_HASH_SALT` - IP privacy salt

### 🟡 Recommended for Production
- `VITE_SENTRY_DSN` - Error reporting (optional but recommended)
- `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` - WebRTC TURN server
- `CLIENT_EVENTS_WEBHOOK_URL` - Alert webhook

### 🟢 Optional / Development Only
- `VITE_DISABLE_NETWORK_FIREWALL` - Disable firewall (dev only)
- `VITE_FORCE_MEMORY_STORAGE` - In-memory DB (testing only)
- `VITE_ALLOW_V5_LEGACY_READ` - Legacy v5 vault support (migration only)

---

## VITE_* Variables (Client Bundle)

These variables are **inlined into the client bundle at build time** by Vite. They are available in the browser via `import.meta.env`.

### Application Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_APP_VERSION` | No | `"dev"` | Application version string |
| `VITE_BUILD_HASH` | No | `""` | Git commit SHA (auto-injected by CI) |
| `VITE_DB_NAME` | No | `"bookmarkforge"` | IndexedDB database name |
| `VITE_DEV_MODE` | No | `""` | Development mode flag for experimental features |

### Storage Overrides (Development/Testing Only)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_DISABLE_NETWORK_FIREWALL` | No | `false` | Disable network firewall (⚠️ NEVER in production) |
| `VITE_FORCE_MEMORY_STORAGE` | No | `false` | Force in-memory DB (⚠️ data lost on refresh) |
| `VITE_FORCE_DEXIE_STORAGE` | No | `false` | Force Dexie.js instead of RxDB |

### Legacy Vault Migration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_ALLOW_V5_LEGACY_READ` | No | `false` | Allow reading v5 vault format (⚠️ security risk) |

**Security Note:** The v5 format uses a static salt, making vaults vulnerable to precomputed Argon2id attacks. This is disabled by default (cutoff activated). Only enable temporarily for migration, then disable immediately.

### E2E Testing Flags (Never in Production)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_E2E_PREVIEW_DIAGNOSTICS` | No | `false` | Publish storage diagnostic hook |
| `VITE_E2E_KDF_DIAGNOSTICS` | No | `false` | Publish KDF parameters for mobile testing |
| `VITE_TEST_BUILD` | No | `false` | Mark build as test build |

### Telemetry & Error Reporting

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_SENTRY_DSN` | No | `""` | Sentry DSN for remote error reporting (optional) |

**Privacy Note:** Error reporting is opt-in. Users must consent via banner before any data is sent. Leave empty to keep error reporting strictly local.

### Network Firewall & P2P Sync

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_P2P_SIGNALING_URL` | Yes (Pro) | `""` | WebSocket signaling server URL for P2P sync |
| `VITE_WHOP_CHECKOUT_URL_EARLY` | No | `""` | Whop checkout URL for early bird pricing |
| `VITE_WHOP_CHECKOUT_URL_REGULAR` | No | `""` | Whop checkout URL for regular pricing |
| `VITE_TURN_URL` | No | `""` | TURN server URL for WebRTC NAT traversal |
| `VITE_TURN_USERNAME` | No | `""` | TURN server username |
| `VITE_TURN_CREDENTIAL` | No | `""` | TURN server credential (⚠️ secret) |
| `VITE_FETCH_PROXY_URL` | No | `""` | Optional proxy URL for fetch requests (dev only) |
| `VITE_MODEL_SELF_HOST_URL` | No | `""` | URL for self-hosted AI models (Ollama, custom) |

### Boot Validation Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_ENV_BOOT_STRICT` | No | `false` | Fail immediately if required env var missing |
| `VITE_ENV_PREFIX_STRICT` | No | `false` | Only allow VITE_* prefixed vars in client code |

---

## Server-Side Variables

These variables are used by the companion server (`server/src/index.ts`) and Docker Compose. They are **NOT** available in the client bundle.

### Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `"production"` | Node environment (development/production) |
| `HOST` | No | `"0.0.0.0"` | Server bind address |
| `PORT` | No | `8787` | Server port for companion API |
| `TRUST_PROXY` | No | `"1"` | Trust X-Forwarded-* headers (behind proxy) |

### WebSocket & P2P

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WS_ALLOWED_ORIGINS` | Yes | `""` | Space-separated WebSocket origin allow-list |
| `SIGNALING_IP_HASH_SALT` | Yes (production) | `""` | Salt for hashing client IPs in signaling logs/metrics — must be ≥32 chars; the server refuses to boot in production without it (falls back to the per-boot instance id in development, so hashes are NOT stable across restarts) |
| `MAX_CONNECTIONS` | No | `"512"` | Global WebSocket connection cap; excess sockets are closed with 1013 |
| `MAX_ROOMS` | No | `"2048"` | Maximum concurrent sync rooms |
| `MAX_PEERS_PER_ROOM` | No | `"64"` | Peers per room (clamped to `MAX_CONNECTIONS`) |
| `JOIN_LIMIT` | No | `"120"` | Join attempts per IP per window (rate limit) |

**Example:** `https://bookmarkforgeapp.com https://staging.bookmarkforgeapp.com`

**Load testing:** the connection caps above are boundary-tested by
`server/src/__tests__/connection-caps.test.ts`, which boots the real server
with a reduced `MAX_CONNECTIONS` and asserts the overflow socket is closed
with 1013 while the accepted set stays alive. For capacity planning beyond
the boundary (e.g. expected concurrent sync users), run a WS-level load
test (k6/artillery) against a staging deployment before launch — no such
sustained-load harness ships in this repo yet.

### Read-Only Mode

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `READ_ONLY` | No | `"true"` | Run server in read-only mode (production-safe) |

### TURN Relay (Optional)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TURN_RELAY_HOST` | No | `""` | TURN relay host for WebRTC proxying |
| `TURN_STATIC_AUTH_SECRET` | No | `""` | Static auth secret for TURN server (⚠️ secret) |

### Client Events Endpoint (Alert Webhook)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLIENT_EVENTS_WEBHOOK_URL` | No | `""` | HTTPS webhook URL for client event alerts |
| `CLIENT_EVENTS_ADMIN_TOKEN` | No | `""` | Admin token for diagnostics endpoint |
| `CLIENT_EVENTS_CRITICAL_CLIENTS` | No | `"3"` | Threshold for triggering alert |
| `CLIENT_EVENTS_WINDOW_MS` | No | `"600000"` | Time window for counting (10 minutes) |
| `CLIENT_EVENTS_LIMIT` | No | `"30"` | Rate limit per window |
| `CLIENT_EVENTS_MAX` | No | `"200"` | Maximum before hard drop |
| `CLIENT_EVENTS_IP_HASH_SALT` | Yes | `""` | Salt for IP address hashing (privacy) |

**Security Notes:**
- `CLIENT_EVENTS_WEBHOOK_URL` MUST be https-only (enforced by gate)
- Alert webhooks are delivered over a socket pinned to the address the server
  validated, and redirects are **not** followed: point
  `CLIENT_EVENTS_WEBHOOK_URL` / `CSP_REPORT_WEBHOOK_URL` at the final HTTPS
  endpoint, never at a redirector or URL shortener (a 3xx counts as a failed
  delivery)
- `CLIENT_EVENTS_IP_HASH_SALT` is REQUIRED in production for IP privacy (minimum 32 characters)
- Use a unique random string per deployment

**IP-Hash Salt Requirements (M4):**
All IP-hash salts (`SIGNALING_IP_HASH_SALT`, `CSP_REPORT_IP_HASH_SALT`, `CLIENT_EVENTS_IP_HASH_SALT`, `ANALYTICS_IP_HASH_SALT`) must be at least 32 characters in production to prevent dictionary attacks on hashed IPs. The server will fail to start if these requirements are not met.

---

## Docker Compose Variables

Used by `docker-compose.prod.yml` and `docker-compose.staging.yml`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAGE_TAG` | Yes | `""` | Container image SHA digest (auto-injected) |
| `HTTP_PORT` | No | `"8080"` | External HTTP port for web service |

---

## Security Best Practices

### ✅ DO

- Use secrets manager (GitHub Secrets, AWS Secrets Manager, etc.) for production
- Rotate credentials regularly
- Use strong, unique values for salts and secrets
- Keep `.env` files in `.gitignore`
- Validate environment at boot (`VITE_ENV_BOOT_STRICT=true` in production)

### ❌ DON'T

- Commit `.env` files to version control
- Use weak or predictable salts
- Set `VITE_DISABLE_NETWORK_FIREWALL=true` in production
- Set `VITE_ALLOW_V5_LEGACY_READ=true` permanently
- Include real API keys in `.env.example` files

---

## Validation

The project includes automated environment validation:

```bash
# Validate environment configuration
npm run check:security

# Check for secrets in commits
npm run check:workflows

# Validate Docker Compose configuration
npm run check:compose-config

# Validate runtime configuration
npm run check:runtime-config
```

These gates run in CI and will fail if:
- Required variables are missing
- Webhook URLs are not https-only
- Credentials are present in committed files
- Configuration drifts from baseline

---

## Example: Local Development

```bash
# .env.local for local development
VITE_APP_VERSION=1.0.0
VITE_DB_NAME=bookmarkforge-dev
VITE_DISABLE_NETWORK_FIREWALL=true  # Only for local dev
VITE_MODEL_SELF_HOST_URL=http://localhost:11434  # Ollama
```

```bash
# Start development server
npm run dev
```

---

## Example: Production

```bash
# .env.production (NEVER commit this)
VITE_APP_VERSION=1.0.0
VITE_P2P_SIGNALING_URL=wss://signaling.bookmarkforgeapp.com
VITE_TURN_URL=turn:turn.bookmarkforgeapp.com:3478
VITE_TURN_USERNAME=${TURN_USERNAME}
VITE_TURN_CREDENTIAL=${TURN_CREDENTIAL}
VITE_SENTRY_DSN=${SENTRY_DSN}

# Server
NODE_ENV=production
WS_ALLOWED_ORIGINS=https://bookmarkforgeapp.com
CLIENT_EVENTS_IP_HASH_SALT=${IP_HASH_SALT}
CLIENT_EVENTS_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
```

Deploy using Docker Compose:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Additional Documentation

- [Security Model](security.md)
- [Self-Hosting Guide](SELF-HOSTING.md)
- [Deployment Policy](../DEPLOY-POLICY.md)
- [AGENTS.md](../AGENTS.md) - Engineering conventions
