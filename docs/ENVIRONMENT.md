# Environment Variables Reference (Core Only)

This document describes environment variables for the MIT-licensed Core.

**IMPORTANT:** This repository contains only the Core features. Pro-specific variables (P2P sync, TURN server, licensing) are intentionally excluded.

## Quick Start

For local development, most variables have safe defaults. Only configure what you need:

```bash
# For local development, most vars have safe defaults
npm run dev
```

For custom configuration, see the variables below.

---

## VITE_* Variables (Client Bundle)

These variables are **inlined into the client bundle at build time** by Vite.

### Application Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_APP_VERSION` | No | `"dev"` | Application version string |
| `VITE_BUILD_HASH` | No | `""` | Git commit SHA (auto-injected by CI) |
| `VITE_DB_NAME` | No | `"bookmarkforge"` | IndexedDB database name |

### Development Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_DEV_MODE` | No | `""` | Development mode flag for experimental features |
| `VITE_DISABLE_NETWORK_FIREWALL` | No | `false` | Disable network firewall (⚠️ dev only) |
| `VITE_FORCE_MEMORY_STORAGE` | No | `false` | Force in-memory DB (⚠️ data lost on refresh) |
| `VITE_FORCE_DEXIE_STORAGE` | No | `false` | Force Dexie.js instead of RxDB |

### Legacy Vault Migration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_ALLOW_V5_LEGACY_READ` | No | `false` | Allow reading v5 vault format (⚠️ security risk) |

**Security Note:** The v5 format uses a static salt, making vaults vulnerable to precomputed Argon2id attacks. This is disabled by default. Only enable temporarily for migration, then disable immediately.

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

### AI Provider Configuration (Core: BYO Only)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_MODEL_SELF_HOST_URL` | No | `""` | URL for self-hosted AI models (Ollama, custom) |

**Example:** `http://localhost:11434` (for Ollama)

### Debugging

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_FETCH_PROXY_URL` | No | `""` | Optional proxy URL for fetch requests (dev only) |

**Note:** Leave empty in production.

---

## Boot Validation Flags

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_ENV_BOOT_STRICT` | No | `false` | Fail immediately if required env var missing |
| `VITE_ENV_PREFIX_STRICT` | No | `false` | Only allow VITE_* prefixed vars in client code |

---

## Server-Side Variables

These variables are used by the companion server and Docker Compose. They are **NOT** available in the client bundle.

### Server Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `"production"` | Node environment (development/production) |
| `HOST` | No | `"0.0.0.0"` | Server bind address |
| `PORT` | No | `8787` | Server port for companion API |
| `TRUST_PROXY` | No | `"1"` | Trust X-Forwarded-* headers (behind proxy) |

### Read-Only Mode

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `READ_ONLY` | No | `"true"` | Run server in read-only mode (production-safe) |

---

## Docker Compose Variables

Used by `docker-compose.prod.yml` and `docker-compose.staging.yml`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAGE_TAG` | Yes | `""` | Container image SHA digest (auto-injected) |
| `HTTP_PORT` | No | `"8080"` | External HTTP port for web service |

---

## Variables NOT Included (Pro Only)

The following Pro-specific variables are **intentionally excluded** from this Core repository:

- `VITE_P2P_SIGNALING_URL` - P2P signaling (Pro)
- `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` - TURN server (Pro)
- `VITE_WHOP_CHECKOUT_URL_EARLY` - Whop checkout (Pro licensing)
- `VITE_WHOP_CHECKOUT_URL_REGULAR` - Whop checkout (Pro licensing)
- `CLIENT_EVENTS_*` - Client events webhook (Pro operations)
- `WS_ALLOWED_ORIGINS` - WebSocket origins (Pro sync)
- `TURN_RELAY_HOST` / `TURN_STATIC_AUTH_SECRET` - TURN relay (Pro)

These belong in the private Pro repository and are generated during the export process.

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
- Add Pro-specific variables to this repository

---

## Validation

The project includes automated environment validation:

```bash
# Validate environment configuration
npm run check:env

# Check for secrets in commits
npm run check:secrets-in-commit

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
# .env.local for local development (Gitignored)
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
VITE_SENTRY_DSN=${SENTRY_DSN}

# Server
NODE_ENV=production
READ_ONLY=true
```

Deploy using Docker Compose:

```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## Additional Documentation

- [Security Model](security.md) - Security practices
- [Architecture](architecture.md) - System architecture
- [AGENTS.md](../AGENTS.md) - Engineering conventions
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guide
