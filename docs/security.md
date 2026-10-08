# Production security

## Mandatory configuration

The companion API runs with:

```text
NODE_ENV=production
AI_SESSION_ORIGINS=https://<public-domain>
ENFORCE_SIGNAL_HMAC=1
LICENSE_SIGNING_PRIVATE_KEY_FILE=/run/secrets/license_signing_key
WHOP_LICENSE_API_URL=https://<verified-adapter>
WHOP_API_KEY=<secret-from-secret-manager>
```

`TRUST_PROXY=1` is only allowed behind a managed reverse proxy that overrides `X-Forwarded-For`. `WS_ALLOWED_ORIGINS` must be configured with authorized public origins. Secrets are not stored in the repository or in `VITE_*` variables.

## Controls

- CSP, HSTS, COEP, COOP, `nosniff`, and `frame-ancestors` are validated via HTTP/CSP gates.
- Docker images are pinned by digest and the web server runs without root.
- Admin endpoints require a token and are disabled if no token is configured.
- Sensitive endpoints apply origin validation, body limits, and rate limiting.
- P2P signaling uses room secrets, HMAC, and connection, room, and payload limits.
- Events and errors must be redacted; never log passwords, keys, or vault content.

## Pre-deployment validation

Run `npm run check:security-internal`, `npm audit --omit=dev --audit-level=high`, `npm run check:runtime-config`, `npm run check:http-config`, `npm run check:compose-config`, and the production smoke. Any configuration failure blocks the release.

## Security incidents

Contain the service, rotate affected credentials, preserve evidence without user data, invalidate compromised images, and document the root cause. Never request passwords or recovery phrases from users.

### Personal data breach procedure (GDPR)

All personal data breaches are managed with the templates in `legal/plantillas/` and the checklist `legal/plantillas/checklist-violacion-seguridad.md`. Each incident opens a `BMF-INC-[YYYY]-[NNN]` identifier and only its reference is noted in `legal/REGISTRO.md`, never complete personal data.

**72-hour clock (art. 33).** Notification to the supervisory authority (AEPD or other competent authority) is made without undue delay and, where possible, within 72 hours from when the controller had reasonable knowledge; delays are documented with their reason. The operational template is `legal/plantillas/notificacion-art-33-autoridad.md`: deadline control, data controller, nature of breach, categories and approximate volume of data, likely consequences, and measures taken.

**Communication to data subjects (art. 34).** When the breach is likely to entail a high risk, it is communicated to affected parties in clear language with `legal/plantillas/notificacion-art-34-interesados.md`: what happened, what data may be affected, what it means for the user, measures taken, and recommendations. If individual communication is not possible, an equivalent public measure is used. Secrets, credentials, or details that facilitate an ongoing attack are never included.

**Vault and credentials.** Templates require distinguishing between local, encrypted, and metadata data, and only affirming that the vault was not affected if the technical investigation confirms it. BookmarkForge never requests by email, chat, or phone the vault password, license key, or recovery phrase.

**Evidence and closure.** Preserve logs, configurations, provider messages, and hashes without user data; save final copy, acknowledgments, and sending date in the encrypted repository; complete root cause, corrective measures, and review of the implicated provider's DPAs.
