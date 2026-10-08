# Companion Server API — BookmarkForge

The companion server is BookmarkForge's minimal backend. It resides in `server/src` and runs with:

```bash
npx tsx server/src/index.ts
```

By default it listens on `ws://0.0.0.0:8787`. In production it must sit behind a
reverse proxy that terminates TLS; the server itself speaks HTTP for the endpoints
documented below and WebSocket for P2P signaling.

This document is aligned with the server's actual handlers
(`server/src/index.ts` and the modules it mounts). It is not a separate
specification: if the code changes, this index must be updated.

---

## 1. General design

- **Minimal HTTP:** the server is a manual `http.createServer`, no framework.
- **No AI proxy:** the server does not talk to AI providers nor store AI
  credentials. Calls go directly from the browser, with the key the user saved
  in their own vault.
- **No vault content:** none of the endpoints receive or store bookmarks, notes,
  documents, or prompts.
- **Fail-closed:** handlers validate body, origins, tokens, and limits explicitly;
  given a missing configuration they respond `503` rather than degrading security.
- **Non-cacheable responses:** most handlers set `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` and `Content-Security-Policy:
  default-src 'none'; base-uri 'none'; frame-ancestors 'none'`.
- **Any other HTTP request:** returns `426 Upgrade Required`. The server only
  speaks HTTP for the documented paths; everything else is WebSocket.
- **No shared state:** the production topology is two stateless services. No Redis
  or server database.

---

## 2. HTTP endpoints

The authoritative table of routes and their access level lives in
`server/src/route-table.ts`. `npm run check:pro-routes` fails if the router
dispatches an undeclared route, if a declared route is never dispatched, or if
the dispatcher ceases to be connected to the entitlement guard.

### 2.1 `GET /health`

- **Purpose:** minimal liveness for healthchecks and uptime probes.
- **Authentication:** none.
- **Response:** brief plain text, no operational counters or identifiers.
- **Cache:** no-store.

---

### 2.2 `GET /api/license/health`

- **Purpose:** health of the license provider integration.
- **Authentication:** none; origin allow-list + rate limit by IP.
- **Response:** `200` if the provider responds, `503` if the signing service is
  not configured.

---

### 2.3 `POST /api/license/activate`

- **Purpose:** exchange a purchased key for a signed entitlement proof.
  Public by design: the caller does not yet have a proof to present.
- **Body:** JSON with license identity (`licenseKey`, `deviceId`).
- **Response:** `200 { payload, signature }` with the signed proof.
- **Errors:** `400` invalid body · `403` origin · `429` rate limit ·
  `502` provider failure · `503` signing service not configured.

---

### 2.4 `POST /api/license/validate`

- **Purpose:** revalidate an existing key. Reached while the vault can still be
  locked, so it carries no proof.
- **Errors:** same codes as `activate`.

---

### 2.5 `POST /api/license/deactivate`

- **Purpose:** release an activation (lost device). Requiring a proof here would
  strand a lost device.
- **Response:** `200 { ok: true }`.

---

### 2.6 `POST /api/license/entitlement`

- **Purpose:** authoritative response of the **plan** by verifying the proof the
  client already possesses.
- **Body:** `{ payload, signature }`.
- **Response `200`:**
  - `{ plan: "pro", source: "license", deviceId, validatedAt, … }`
  - `{ plan: "free", source: "none", reason, message }` — a definitive
    response, not an error: allows explicitly degrading to Free instead of
    staying in the offline grace window.
- **`503 SIGNING_KEY_INVALID`:** the deployment's public key is unusable.
  Not a degradation; the client retains its verified offline state.
- **Others:** `400` invalid body · `403` origin · `405` method · `413` proof
  too large · `429` rate limit.
- **Origins:** allow-list `AI_SESSION_ORIGINS` (historical name: the endpoint
  responds to the license plan, not an AI session). Empty is only tolerated
  outside production.

---

### 2.7 `GET /admin`

- **Purpose:** signaling server diagnostics.
- **Authentication:** `X-Signaling-Admin-Token`.
- **Notes:** never transports client data.

---

### 2.8 `POST /csp-report` and `GET /csp-report`

- **Purpose:** receive CSP violation reports and read collected ones.
- **`POST`:** public; the browser does not attach credentials. Filtered by origin
  and rate-limited by IP. Responds `204`.
- **`GET`:** requires `X-CSP-Admin-Token`.
- **Retention:** bounded in-memory ring; optional JSONL persistence.

---

### 2.9 `POST /api/client-events` and `GET /api/client-events`

- **Purpose:** client degradation telemetry (storage pressure, bundle integrity
  spikes).
- **`POST`:** sent **only** after explicit user consent.
  Pseudonymous payload with no content; shape validation + rate limit by IP.
- **`GET`:** collector diagnostics with `X-Client-Events-Admin-Token`;
  responds `503` if not configured.
- **CRITICAL threshold:** can trigger an HTTPS webhook if configured.
- **Retention:** bounded in-memory ring; does not persist by default.

---

### 2.10 `GET /api/client-events/retry-stats`

- **Purpose:** accumulated retry counters from the client reporter.
- **Authentication:** none; rate limit by IP.

---

### 2.11 `POST /api/analytics/events`

- **Purpose:** ingest an aggregated opt-in daily bucket.
- **Body:** `{ iid, batchId, counts }`. `iid` is the SHA-256 of a random id per
  installation (never a user identity); `counts` are daily totals of a closed
  list of event types.
- **Idempotency:** `batchId` makes ingestion additive; a retry of the same batch
  does not duplicate. Without `batchId` the per-day replacement semantics is
  preserved.
- **Response:** `204`. `503` with `Retry-After` if the per-installation state
  reaches its cap (fail-closed, without silently discarding data).
- **Privacy:** IP is hashed with salt; no PII and no content.

---

### 2.12 `GET /api/analytics/kpis`

- **Purpose:** aggregated KPIs (DAU/WAU/MAU, cohort retention, funnel).
- **Authentication:** `X-Analytics-Admin-Token`; `503` if not configured.
- **Privacy:** only aggregates.

---

## 3. HTTP routing and general security

- **Origins:** `hasValidOrigin()` compares the received `Origin` with an explicit
  allow-list and, failing that, with the origin derived from `Host` (plus
  `X-Forwarded-Proto` when `TRUST_PROXY` is active). Endpoints that receive
  browsers — licenses and entitlement — apply it.
- **Single admission per request:** the entitlement guard resolves the context
  once per request and attaches it under a non-writable symbol; subsequent
  handlers read that context and **do not re-verify**.
- **Tokens:** admin tokens are compared in constant time. Identity tokens are
  hashed before use as a policy key.
- **Body:** all endpoints with body validate maximum size. Malformed JSON or
  non-object produces `400`.
- **Common error codes:**
  - `400`: invalid request or malformed JSON.
  - `403`: disallowed origin (`CSRF_ORIGIN`) or invalid token.
  - `405`: method not allowed.
  - `413`: body too large.
  - `426`: unsupported HTTP route (WebSocket expected).
  - `429`: rate limit.
  - `502`: upstream provider error.
  - `503`: service not configured or unavailable.

---

## 4. WebSockets (P2P signaling)

The server is also a WebSocket signaling server. It is not a REST API, but it
is part of its contract.

- **Upgrade:** any connection that does not match the preceding HTTP paths receives
  `426`; the client must use WebSocket for the rest.
- **Origins:** if `WS_ALLOWED_ORIGINS` is defined, upgrades from other origins are
  rejected with `403`. Empty = no check (local development).
- **Main messages:**
  - `init`: server → client with `yourPeerId` and optionally `iceServers`
    (ephemeral TURN credentials when relay is configured).
  - `join`: client → server with `room` and optional `roomSecret`. The client
    only sends this to its configured self-hosted server
    (`VITE_P2P_SIGNALING_URL`); public relays never receive it (A-3),
    so in relay mode the room has no secret to validate.
  - `joined`: server → all room members with the peer IDs.
  - `signal`: client ↔ server to relay signals between peers.
- **Protection:** rooms with secrets require HMAC on every signal
  (`ENFORCE_SIGNAL_HMAC=1` in production); the server validates sender, room,
  target peer, payload size, rate limits, and anti-replay window.
- **Limits:** connections, rooms, peers per room, payload size, and `join` rate are
  bounded and configurable by environment.

---

## 5. State and persistence

- **Analytics:** memory + optional `ANALYTICS_STATE_FILE` with atomic write.
- **Client events:** bounded in-memory ring; does not persist by default.
- **CSP reports:** bounded in-memory ring; optional JSONL persistence.
- **Licenses:** no own state; depends on external provider and signing key.
- **Signaling:** in-process memory state; does not persist across restarts.

---

## 6. Minimal API-relevant configuration

Defaults are documented in the handlers. These are the environment variables
that directly affect the endpoints:

- `PORT`, `HOST`
- `NODE_ENV`
- `TRUST_PROXY`
- `WS_ALLOWED_ORIGINS`
- `AI_SESSION_ORIGINS` — allow-list for `POST /api/license/entitlement`
  (mandatory in production)
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` / `LICENSE_SIGNING_PRIVATE_KEY_PKCS8`
- `WHOP_LICENSE_API_URL`, `WHOP_API_KEY`, `LICENSE_PROVIDER_ALLOW_HTTP`
- `SIGNALING_ADMIN_TOKEN`
- `CSP_REPORT_ADMIN_TOKEN`, `CSP_REPORT_*`
- `CLIENT_EVENTS_ADMIN_TOKEN`, `CLIENT_EVENTS_*`, `CLIENT_EVENTS_WEBHOOK_URL`
- `ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_*`
- `TURN_RELAY_HOST`, `TURN_STATIC_AUTH_SECRET`, `TURN_*`
- `ENFORCE_SIGNAL_HMAC`

Defaults are in the code; malformed values fall back to the documented default.

---

## 7. Relationship with existing documentation

- `docs/api.md` is the high-level view of the protocol and endpoints.
- `docs/openapi.yaml` is the OpenAPI 3.1 specification of this same surface.
- This index is the endpoint reference aligned with the actual handlers.

---

## 8. Optional next steps

- Add request/response examples per endpoint extracted from tests.
- Generate the OpenAPI spec from the route table so it cannot drift.
