# Seguridad

## Controles activos

- TypeScript estricto y ESLint con reglas de seguridad propias.
- AES-GCM y derivación Argon2id/HKDF para datos del vault.
- Sanitización centralizada con DOMPurify.
- CSP, SRI y cabeceras de aislamiento/protección.
- Sesiones de IA con cookies `HttpOnly`, `Secure` bajo HTTPS, `SameSite=Strict` y token CSRF.
- Sesiones con expiración, límite de cardinalidad y rate limiting.
- HMAC obligatorio para señales P2P en producción.
- Límites de payload, conexiones, rooms y peers.
- Validación SSRF/IP para fetches controlados.
- Backups cifrados y rollback acotado.

## Configuración obligatoria de producción

- `NODE_ENV=production`.
- `AI_SESSION_REQUIRE_LICENSE=1`.
- `AI_SESSION_ORIGINS` con una lista exacta, separada por comas, de orígenes HTTPS.
- `ENFORCE_SIGNAL_HMAC=1`.
- `TRUST_PROXY=1` sólo cuando el reverse proxy sobrescribe correctamente `X-Forwarded-For` y `X-Forwarded-Proto`.
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` montado como secreto, nunca incluido en la imagen.
- `GEMINI_API_KEY`, `WHOP_API_KEY`, tokens administrativos y credenciales TURN sólo mediante secret manager.
- Redis sin puerto publicado al host y con contraseña cuando la política de infraestructura lo requiera.

## Gestión de sesiones

Las sesiones de IA son efímeras y se autentican mediante cookie de sesión más CSRF doble (`Cookie` + `X-CSRF-Token`). La identidad de licencia no debe confundirse con una cuenta de usuario general. Si se añaden cuentas, implementar OIDC/OAuth2 con expiración corta, rotación de refresh tokens, revocación, MFA opcional y auditoría.

## Secretos

No se deben commitear archivos `.env` reales, claves privadas, tokens ni credenciales. Ejecuta:

```bash
npm run check:secrets-in-commit
```

Si una credencial fue expuesta, revócala y rótala; eliminarla del archivo no invalida una exposición previa.

## RGPD

Estas medidas son controles técnicos, no una certificación legal. Antes del lanzamiento hay que documentar responsable, finalidades, base jurídica, minimización, retención, derechos, encargados/subencargados, transferencias internacionales, consentimiento y procedimiento de incidentes.

## Validación externa requerida

- SAST y dependencia/SBOM.
- DAST de endpoints HTTP.
- Pentest del proxy, sesiones, integraciones, WebSocket y flujos de backup.
- Revisión manual WCAG y privacidad.
