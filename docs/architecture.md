# Architecture

## Open Core model

The private repository combines an MIT Core with proprietary Pro components.
The distribution separation is not based solely on folders: the exporter
maintains an explicit list of Pro files and the `check:open-core` gate checks
the materialized result. The Core includes vault, CRUD, notes, basic
import/export, search, security, and interface. Pro includes advanced AI, RAG,
agents, P2P sync, flashcards, PDF/OCR, advanced exports, and advanced backups.
The normative classification lives in `OPEN-CORE.md` and
`scripts/export-public-repo.mjs`.

## Components

- **Frontend:** React + TypeScript + Vite. Heavy routes and features are lazy-loaded.
- **Local persistence:** RxDB over IndexedDB. Schemas live in `src/db`.
- **Cryptography:** `EncryptionService` delegates to `crypto.worker.ts`; the current format uses AES-GCM with Argon2id/HKDF derivation.
- **Domain services:** `src/services` encapsulates backup, recovery, sync, licensing, AI, and sanitization.
- **Companion server:** `server/src` implements minimal HTTP, licenses/entitlement, client events, aggregated analytics, healthcheck, and WebSocket signaling. **No AI proxy**: calls go directly from the browser to the provider the user configured.
- **Sync:** WebRTC transports data between clients; WebSocket only performs signaling. TURN is optional and uses ephemeral credentials.
- **Operations:** Docker Compose separates `web` and `api`, both stateless. The reverse proxy terminates TLS and serves assets.

## Trust boundaries

1. The browser contains the unlocked vault only while the session needs it.
2. The signaling server must not be considered trusted for vault confidentiality.
3. AI provider credentials live encrypted in the user's vault and are used from the browser. The server does not receive, store, or need them; the license signing key is the only server credential and lives in a secret manager.
4. The server maintains no shared state between instances: no Redis, database, or session cache.
5. Cloud integrations are considered third parties and require consent, minimal scopes, and revocation handling.

## Scalability

The server has connection, room, peer, payload, and rate limits. HTTP endpoints are stateless and scale horizontally only with a load balancer. **WebSocket signaling does not**: room and peer state lives in process memory, so scaling it requires a shared adapter or affinity routing (without one of the two, rooms are split between replicas and signals stop being delivered).

To grow, you also need:

- Load balancer with WebSocket support and affinity policy.
- Metrics for connections, rooms, memory, latency, and errors.
- Load tests before increasing limits.

Client capacity is limited by IndexedDB memory, indexing cost, vault size, and device power. Unlimited capacity must not be promised.

## Recorded decisions (baseline 2026-08-31)

- **AI proxy removal (2026-09):** the server no longer proxies AI provider calls. The user's key lives encrypted in their vault and calls go directly from the browser, so the server stopped needing `GEMINI_API_KEY`, the AI CSRF session, per-identity quotas, the circuit breaker, and the Redis that shared that state between replicas. These were also removed from compose, validators, and `openapi.yaml`; `check:compose-config` and `check:runtime-config` now fail if AI configuration reappears without a reader.
- **SLO/RPO/RTO:** reference values recorded in `docs/operations.md` → "SLOs and objectives" (availability 99.9%/30 days, p95 signaling < 500 ms, 5xx < 0.5%, WS saturation < 70%; **RPO 24 h**, **RTO 24 h** vault / **4 h** topology). Pending only the responsible party's official confirmation and their quarterly review (launch-checklist item 3).
- **Versioned contracts:** `docs/openapi.yaml` (OpenAPI 3.1.0) covers the companion server's HTTP endpoints; the contract with the license provider (Whop) is documented as P2 debt.
- **Opt-in business analytics:** `server/src/business-analytics.ts` + `src/services/analyticsForwarder.ts` (see `docs/audit.md` §5 and ROPA §3 T8).

## Pending decisions

- Multiuser central persistence if the product ceases to be exclusively local-first (kept open on purpose).
- Formal RxDB migration policy (kept open on purpose).
- Official confirmation (responsible party's signature) of SLO/RPO/RTO and executed quarterly disaster simulation.
