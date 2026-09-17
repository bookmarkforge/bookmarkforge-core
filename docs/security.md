# Seguridad

## Controles activos

- TypeScript estricto y ESLint con reglas de seguridad propias.
- AES-GCM y derivación Argon2id/HKDF para datos del vault.
- Sanitización centralizada con DOMPurify.
- CSP, SRI y cabeceras de aislamiento/protección.
- Claves de proveedores de IA cifradas en el vault del usuario y usadas sólo desde el navegador: el servidor no recibe, no almacena ni necesita credenciales de IA.
- Verificación de origen en los endpoints que reciben navegadores (`CSRF_ORIGIN`) y rate limiting por IP con presupuesto acotado.
- Pruebas de entitlement firmadas (RSA-PSS/Ed25519) verificadas con la clave pública comprometida en el repositorio.
- HMAC obligatorio para señales P2P en producción.
- Límites de payload, conexiones, rooms y peers.
- Validación SSRF/IP para fetches controlados.
- Backups cifrados y rollback acotado.

## Configuración obligatoria de producción

- `NODE_ENV=production`.
- `AI_SESSION_ORIGINS` con la allow-list exacta, separada por comas, de orígenes HTTPS autorizados a llamar `POST /api/license/entitlement`. El compose de producción **exige** la variable.
- `ENFORCE_SIGNAL_HMAC=1`.
- `TRUST_PROXY=1` sólo cuando el reverse proxy sobrescribe correctamente `X-Forwarded-For` y `X-Forwarded-Proto`.
- `LICENSE_SIGNING_PRIVATE_KEY_FILE` montado como secreto, nunca incluido en la imagen.
- `WHOP_API_KEY`, tokens administrativos y credenciales TURN sólo mediante secret manager. No hay ninguna credencial de IA que configurar: el servidor no llama a proveedores.
- Ningún puerto de servicio interno publicado al host; los compose publican sólo en loopback.

## Identidad y sesiones

No hay cuentas de usuario ni sesiones de servidor. La "sesión" del vault es local: la clave maestra descifra la base IndexedDB en el navegador y las claves derivadas viven en la memoria del cliente, no en una cookie. La licencia Pro es un atributo del dispositivo (una prueba firmada), no una identidad de autenticación, y `/api/license/entitlement` sólo responde el plan. El servidor de producción no emite cookies de sesión.

Si en el futuro se añaden cuentas, implementar OIDC/OAuth2 con expiración corta, rotación de refresh tokens, revocación, MFA opcional y auditoría.

## Secretos

No se deben commitear archivos `.env` reales, claves privadas, tokens ni credenciales. Ejecuta:

```bash
npm run check:secrets-in-commit
```

Si una credencial fue expuesta, revócala y rótala; eliminarla del archivo no invalida una exposición previa.

## RGPD

Estas medidas son controles técnicos, no una certificación legal. La plantilla de cierre RGPD (responsable, finalidades, base jurídica, minimización, retención, derechos, encargados/subencargados, transferencias internacionales, consentimiento y procedimiento de incidentes) está en [docs/ROPA.md](ROPA.md); completar sus campos `⚠ COMPLETAR` antes del lanzamiento.

## Validación externa requerida

- SAST independiente (CodeQL + Semgrep en CI con gate de severidad High/Critical; ver `.github/workflows/sast.yml`, `scripts/check-sarif-severity.mjs` y la [guía de triage del primer run](sast-triage.md)). Dependencias: `npm audit` + dependency-review; SBOM formal pendiente.
- DAST de endpoints HTTP (el proxy de IA ya no existe: el alcance del DAST es licencias, telemetría, diagnósticos y señalización).
- Pentest de licencias, integraciones, WebSocket y flujos de backup.
- Revisión manual WCAG y privacidad.
