# Companion Server API — BookmarkForge

> **Private infrastructure.** The companion server (`server/src`) and the
> license function (`api/license/`) are NOT part of the MIT public export —
> this index documents the hosted deployment's backend for operators. See
> `OPEN-CORE.md` for the boundary.

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

The authoritative table of the routes the companion server answers lives in
`server/src/route-table.ts`. `npm run check:security` fails if the router
dispatches an undeclared route, if a declared route is never dispatched, or if
a route appears under a paid namespace without an enforcement point.

The `/api/license/*` endpoints below are served by the serverless function
(`api/license/[action].ts`), not by the signaling server; the signaling server
no longer mounts license routes.

### 2.1 `GET /health`

- **Purpose:** minimal liveness for healthchecks and uptime probes.
- **Authentication:** none.
- **Response:** brief plain text, no operational counters or identifiers.
- **Cache:** no-store.

---

### 2.2 `GET /api/license/health`

- **Purpose:** health of the license provider integration.
- **Authentication:** none; public liveness probe. The origin allow-list,
  Origin gate and rate limit apply to the POST license actions, not here.
- **Response:** `200` if the signing service and provider are configured,
  `503` otherwise; in production a missing allowlist also returns `503`
  (`ORIGIN_NOT_CONFIGURED`) before the readiness payload.

---

### 2.3 `POST /api/license/activate`

- **Purpose:** exchange a purchased key for a signed entitlement proof.
  Public by design: the caller does not yet have a proof to present.
- **Body:** JSON `{ license_key, instance_name | instance_id, seat_token? }`
  (snake_case; `license_key` required, at least one instance identifier).
- **Response:** `200 { payload, signature }` with the signed proof.
- **Errors:** `400` invalid body · `403` origin · `429` rate limit ·
  `502` provider failure · `503` signing service not configured.
- **Rate limiting:** in-memory per-IP windows (60 requests/minute per IP, 600 global).
  Best-effort only — serverless instances do not share state, so distributed
  deployments should use an external rate limiter (e.g., CDN/WAF) for stronger guarantees.

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

### 2.6 `GET /admin`

- **Purpose:** signaling server diagnostics.
- **Authentication:** `X-Signaling-Admin-Token`.
- **Notes:** never transports client data.

---

### 2.7 `POST /csp-report` and `GET /csp-report`

- **Purpose:** receive CSP violation reports and read collected ones.
- **`POST`:** public; the browser does not attach credentials. Filtered by origin
  and rate-limited by IP. Responds `204`.
- **`GET`:** requires `X-CSP-Admin-Token`.
- **Retention:** bounded in-memory ring; optional JSONL persistence.

---

### 2.8 `GET /og` and `GET /og-image.svg`

- **Purpose:** public Open Graph card generation for social sharing.
- **Authentication:** none.
- **Response:** `/og` returns the HTML wrapper; `/og-image.svg` serves the SVG
  card image it references.

---

## 3. HTTP routing and general security

- **Origins:** `hasValidOrigin()` compares the received `Origin` with an explicit
  allow-list. The license surface (`api/license/*`) requires that list in
  production and never derives it from `Host`; an empty list returns `503` and a
  request without `Origin` returns `403`.
- **Rate limits:** the license actions apply
  per-IP windows inside their handlers; signaling handlers never re-verify a
  license proof (plan resolution is client-side from the signed payload).
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
  - `join`: client → server with `room` and a `roomVerifier` credential
    (HMAC of the room secret under a dedicated domain; audit A3
    2026-11-05). The room secret itself never leaves the client — the
    server stores only the verifier, compares it in constant time for
    membership, and cannot recompute the signal HMAC key, so it can
    neither read nor forge signals. Legacy `roomSecret` joins are still
    accepted for pre-2026-11 clients and converted to a verifier
    immediately. Public relays never receive the verifier
    (`VITE_P2P_SIGNALING_URL` decides per socket), so in relay mode the
    room has no credential to validate.
  - `joined`: server → all room members with the peer IDs.
  - `signal`: client ↔ server to relay signals between peers. `signalAuth`
    is relayed verbatim; the server only enforces its 64-hex format in
    credentialed rooms (`ENFORCE_SIGNAL_HMAC`), because cryptographic
    verification moved to the receiving peer, which holds the secret.
- **Limits:** connections, rooms, peers per room, payload size, and `join` rate are
  bounded and configurable by environment.

---

## 5. State and persistence

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
- `LICENSE_ALLOWED_ORIGINS` — allow-list for `POST /api/license/*`
  (mandatory in production; `AI_SESSION_ORIGINS` remains a legacy alias)
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` / `LICENSE_SIGNING_PRIVATE_KEY_PKCS8`
- `WHOP_LICENSE_API_URL`, `WHOP_API_KEY`, `LICENSE_PROVIDER_ALLOW_HTTP`
- `SIGNALING_ADMIN_TOKEN`
- `CSP_REPORT_ADMIN_TOKEN`, `CSP_REPORT_*`
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
