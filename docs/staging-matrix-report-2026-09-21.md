# Informe de matriz de staging — 2026-09-21

## Alcance

Se ejecutó la matriz local aislada de staging sin tocar producción:

- `/health` del companion server.
- Superficie HTTP/API y eventos de cliente.
- Handshake WebSocket de señalización.
- Activación y ciclo de licencia.
- Backup/restore cifrado y en claro.
- Build de producción y critical-path smoke con Chromium.
- Certificación WebRTC según el informe Playwright disponible.

## Resultados

| Área | Resultado | Evidencia |
|---|---:|---|
| Build de producción | PASS | `npm run launch:smoke:prod` |
| Critical paths | PASS | 7/7 Playwright: vault, recovery, licencia y backup |
| `/health` local | PASS | `npm run local-smoke`: HTTP 200, `{ status: "ok" }` |
| CSP/COOP del frontend servido | PASS | smoke de producción: CSP presente y COOP `same-origin` |
| Eventos de cliente | PASS | `/api/client-events` acepta `csp-violation-spike` con HTTP 204 |
| WebSocket signaling | PASS | handshake `join` → `joined` contra `ws://127.0.0.1:8787` |
| Ciclo de licencia mock | PASS | 21/21 checks en `npm run license-smoke` |
| Licencia en critical path real | PASS | activación válida e inválida en `launch-smoke:prod` |
| Backup cifrado `.bmf` | PASS | restore y verificación de datos; RTO 4.242 s |
| Backup JSON | PASS | restore y verificación de datos; RTO 4.110 s |
| WebRTC certificado | PASS | Chromium, Firefox y WebKit: 3/3 contratos pasados |
| Typecheck/lint | PASS | `npm run typecheck:prod` y `npm run lint` |
| Policy tests | PASS | 3/3 tests de staging |

## Correcciones realizadas durante el drill

- `scripts/drill-backup-restore.mjs`: sustitución del shim `npx.cmd`, que fallaba con `EINVAL` en Windows, por la invocación directa del CLI local de Playwright.
- `scripts/local-smoke.mjs`: apagado ordenado de los procesos hijos y espera del cierre WebSocket; evita la aserción de libuv que provocaba salida 127 después de checks exitosos en Windows.

## Limitaciones de evidencia

- `check:staging-http` exige `STAGING_URL` HTTPS y no se ejecutó contra un dominio remoto porque no se proporcionó un endpoint de staging. Por tanto, no existe todavía evidencia externa de HSTS ni de headers del reverse proxy.
- El `local-smoke` no activó licencia contra una clave privada local porque el archivo de firma gitignored no estaba configurado; el ciclo mock sí pasó y el critical-path de producción sí ejercitó el servicio de firma real del entorno de smoke.
- La certificación WebRTC valida el informe Playwright nocturno disponible; no sustituye una nueva ejecución multi-navegador contra un endpoint público con TURN.

## Decisión Go/No-Go

**GO para staging local aislado.**

**NO-GO para declarar producción verificada todavía**, hasta ejecutar con un endpoint HTTPS real:

```bash
STAGING_URL=https://staging.example.com npm run check:staging-http
PROD_BASE_URL=https://staging.example.com npm run production-smoke
LICENSE_SMOKE_BASE_URL=https://staging.example.com \
  LICENSE_SMOKE_KEY=<clave-de-prueba> npm run license-smoke
```

También debe repetirse el drill de WebRTC desde al menos dos redes externas y conservar el informe como artefacto de release.
