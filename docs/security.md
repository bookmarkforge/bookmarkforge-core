# Production security

## Mandatory configuration

The companion signaling server (`server/src`) runs with:

```text
NODE_ENV=production
ENFORCE_SIGNAL_HMAC=1
WS_ALLOWED_ORIGINS=https://<public-domain>
SIGNALING_IP_HASH_SALT=<random ≥32 chars>
CSP_REPORT_IP_HASH_SALT=<random ≥32 chars>
SIGNALING_ADMIN_TOKEN=<secret-from-secret-manager>
```

The license function (`api/license/`, serverless — the companion no longer
serves license routes) additionally requires `LICENSE_ALLOWED_ORIGINS`,
`LICENSE_SIGNING_PRIVATE_KEY_*`, provider credentials (`WHOP_*` or
`APP_SUMO_*` + `KV_REST_*`/`UPSTASH_*`), and `LICENSE_REISSUE_SECRET` or a
KV token for deal-code reissue. See `docs/ENVIRONMENT.md`.

`TRUST_PROXY=1` is only allowed behind a managed reverse proxy that overrides `X-Forwarded-For`. Secrets are not stored in the repository or in `VITE_*` variables.

## Controls

- CSP, HSTS, COEP, COOP, `nosniff`, and `frame-ancestors` are validated via HTTP/CSP gates.
- Docker images are pinned by digest and the web server runs without root.
- Admin endpoints require a token and are disabled if no token is configured.
- Sensitive endpoints apply origin validation, body limits, and rate limiting.
- P2P signaling uses room secrets, HMAC, and connection, room, and payload limits.
- Events and errors must be redacted; never log passwords, keys, or vault content.

## Pre-deployment validation

Run `npm run check:security-internal`, `npm audit --omit=dev --audit-level=high`, `npm run check:runtime-config`, `npm run check:http-config`, `npm run check:compose-config`, and the production smoke. Any configuration failure blocks the release.

## Accepted residual risks

Documented, deliberate trade-offs from the 2026-11-20 expert review. None is
a known vulnerability; each is bounded and monitored where possible.

- **Client-side licensing is replayable, not forgeable.** The signed
  `{payload, signature}` record plus `deviceId` grants Pro offline for at
  most `MAX_OFFLINE_GRACE_MS` (30 days) or `expiresAt`, whichever comes
  first. Seat binding is enforced server-side, so mass abuse requires
  `/activate` (consumes a seat); a single cloned state is the accepted
  exposure of a local-first app with no server-side feature gating.
- **`script-src` includes `blob:`** — required by transformers.js, which
  dynamically imports a blob: URL for the ONNX WASM backend. Worker and
  frame blob usage remain scoped to `worker-src`/`child-src`.
- **`connect-src` allows `http://localhost:11434`** (cleartext) for local
  Ollama; unavoidable for the local-AI feature, and only reachable from
  pages already executing our bundle.
- **`isAlwaysAllowed` permits any loopback port** in `networkFirewall` —
  documented in code; the origin allow-list remains the external boundary.
- **Legacy compat windows with sunset telemetry:** `roomSecret` signaling
  joins (pre-2026-11 clients transit the room secret through the relay)
  and license-key-only seat deactivation (`license_seat_legacy_deactivation`
  log event). Both are tracked to zero before cutoff.
- **Serverless rate limits are best-effort** (per-instance memory); CDN/WAF
  rules are the real perimeter for `/api/license/*` and `/csp-report`.
- **`x-real-ip`/`x-forwarded-for` are trusted unconditionally** by the
  Vercel CSP collector adapter — correct on Vercel; do not reuse that
  adapter behind a proxy that does not sanitize those headers.
- **The license signing private key lives in `.env.production.local` on
  the operator machine** — gitignored and correct, but it is the most
  sensitive file in the repo's blast radius; prefer a secrets manager for
  any shared checkout.
- **WebSocket clients without an `Origin` header are rejected** when
  `WS_ALLOWED_ORIGINS` is set — correct for browsers; non-browser clients
  must send an allow-listed Origin.

## Security incidents

Contain the service, rotate affected credentials, preserve evidence without user data, invalidate compromised images, and document the root cause. Never request passwords or recovery phrases from users.

### Personal data breach procedure (GDPR)

All personal data breaches are managed with the templates in `legal/plantillas/` and the checklist `legal/plantillas/checklist-violacion-seguridad.md`. Each incident opens a `BMF-INC-[YYYY]-[NNN]` identifier and only its reference is noted in `legal/REGISTRO.md`, never complete personal data.

**72-hour clock (art. 33).** Notification to the supervisory authority (AEPD or other competent authority) is made without undue delay and, where possible, within 72 hours from when the controller had reasonable knowledge; delays are documented with their reason. The operational template is `legal/plantillas/notificacion-art-33-autoridad.md`: deadline control, data controller, nature of breach, categories and approximate volume of data, likely consequences, and measures taken.

**Communication to data subjects (art. 34).** When the breach is likely to entail a high risk, it is communicated to affected parties in clear language with `legal/plantillas/notificacion-art-34-interesados.md`: what happened, what data may be affected, what it means for the user, measures taken, and recommendations. If individual communication is not possible, an equivalent public measure is used. Secrets, credentials, or details that facilitate an ongoing attack are never included.

**Vault and credentials.** Templates require distinguishing between local, encrypted, and metadata data, and only affirming that the vault was not affected if the technical investigation confirms it. BookmarkForge never requests by email, chat, or phone the vault password, license key, or recovery phrase.

**Evidence and closure.** Preserve logs, configurations, provider messages, and hashes without user data; save final copy, acknowledgments, and sending date in the encrypted repository; complete root cause, corrective measures, and review of the implicated provider's DPAs.
