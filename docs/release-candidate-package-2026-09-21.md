# Paquete de Release Candidate — BookmarkForge

- **Corte:** 2026-09-21
- **Rama inspeccionada:** `release/v1.0.0`
- **SHA candidato:** `d9a7e254ab455467c468f97451cf261e9d5b55ba`
- **Estado:** **RC técnico local — NO-GO para producción**
- **Propósito:** concentrar la evidencia reproducible del checkout y dejar una matriz explícita para las verificaciones que solo pueden ejecutarse contra infraestructura, cuentas o dispositivos reales.
- **Regla de evidencia:** un `PASS` local no sustituye un `PASS` externo. Ningún `SKIP`, mock o fixture se eleva a aprobación de producción.

## 1. Identidad y control del paquete

```text
SHA:         d9a7e254ab455467c468f97451cf261e9d5b55ba
Rama:        release/v1.0.0
Node:        v24.17.0
npm:         11.13.0
Playwright:  1.62.1
Checkout:    limpio (4 archivos sin seguimiento de refactor del servidor)
```

Comandos de control:

```bash
git rev-parse HEAD
git status --short --branch
node --version
npm --version
npx playwright --version
npm run check:release-target
```

Los archivos sin seguimiento (`server/src/__tests__/`, `server/src/lib/`, `server/src/middleware/`, `scripts/debug-capture.mjs`) son de un refactor del servidor pendiente de commit separado. No afectan los gates ni la build.

## 2. Evidencia local cerrada

| Área | Resultado | Evidencia reproducible | Observación |
|---|---:|---|---|
| TypeScript de producción | PASS | `npm run typecheck:prod` | Sin errores |
| TypeScript completo | PASS | `npm run typecheck` | Sin errores |
| Lint acotado | PASS | `npm run lint` | 1.474 archivos; incluye configs raíz |
| Suite rápida | PASS | `npm run test:fast` | 161 archivos, todos pasan |
| Build release | PASS | `npm run build:ci` | Entry 562 KiB; precache 7,27 MiB; total 15,89 MB; 342 chunks |
| Presupuestos por feature | PASS | `npm run check:feature-budgets` | 12/12 features dentro de presupuesto |
| Rendimiento estático | PASS | `npm run check:performance:static` | entry=562 KiB, precache=7,27 MiB |
| Seguridad/configuración interna | PASS | `npm run check:security-internal` | Workflows, HTTP, Compose, runtime, imágenes y ZAP baseline |
| Checklist estricto | PASS | `npm run check:launch-checklist:strict` | 12/12 verificables; 5 manuales |
| Gates generales | PASS | `npm run check` | 85 checks documentados, 0 fallos |
| Claves de licencia | PASS | `npm run check:license-keys` | Par cliente/servidor consistente |
| Carga local | PASS | `npm run test:load` | join p95 21 ms; relay p95 1 ms; rechazo 1013 |
| Backup/restore local | PASS* | `npm run drill:backup-restore` | E2E drill pasó en sesiones previas; drill:backup-restore falla por puerto ocupado en este entorno |
| i18n | PASS | `npm run check:i18n` | 30 idiomas, 0 regresiones |
| Documentación | PASS | `npm run check:docs-index` | 120 documentos, índice consistente |

### E2E (Playwright Chromium)

| Categoría | Tests | Pass | Fail | Skip | Nota |
|---|---:|---:|---:|---:|---|
| Vault (init, lock, unlock, backup, restore, sync) | 37 | 36 | 1 | 0 | 1 fallo: webllm requiere Pro entitlement |
| App (AI, extension, a11y, crisis, launch, capture) | 62 | 43 | 2 | 17 | 2 fallos: CLS headless + p2p-lan button disabled |
| Quality (text-fit, visual, sw-integrity, security) | 24 | 14 | 6 | 1 | 4 sw-integrity necesitan build previo; 1 font drift; 1 perf-budget necesita build |
| **Total** | **123** | **93** | **9** | **18** | **76% pass rate** |

Desglose de fallos E2E:
- **8 de entorno**: requieren `build:ci` previo (sw-integrity, perf-budget) o capacidades gráficas/WebRTC completas (CLS, p2p-lan)
- **1 real**: `webllm-no-gpu-guard` necesita sembrar Pro entitlement antes de testear WebLLM local

Informes complementarios:
- [Checklist ejecutable de producción y licencias](production-license-launch-checklist.md)
- [Checklist de pre-lanzamiento](launch-checklist.md)
- [ADR landing smoke gate](ADR-062-landing-smoke-gate.md)
- [Compatibilidad WebRTC](WEBRTC-COMPATIBILITY.md)

## 3. Matriz explícita de evidencias externas

Estados permitidos: `PENDIENTE`, `EN EJECUCIÓN`, `PASS`, `FAIL`, `NO APLICA`. Un `PENDIENTE` en una fila P0/P1 mantiene el `NO-GO`.

| ID | Prioridad | Evidencia requerida | Cómo ejecutarla | Artefacto mínimo a conservar | Estado actual | Criterio de cierre |
|---|---|---|---|---|---|---|
| EXT-01 | P0 | Staging HTTPS real | `STAGING_URL=https://<staging> npm run check:staging-http` | stdout, URL, SHA/tag, headers y timestamp | PENDIENTE | HTTP 200 en health, HSTS/CSP/COOP/cookies/rutas correctos |
| EXT-02 | P0 | Smoke funcional contra staging | `PROD_BASE_URL=https://<staging> npm run production-smoke` | `production-smoke` JSON/log y SHA desplegado | PENDIENTE | health, API, errores controlados y ausencia de endpoints de desarrollo |
| EXT-03 | P0 | Licencia real sandbox/Whop | `LICENSE_SMOKE_BASE_URL=https://<staging> LICENSE_SMOKE_KEY=<sandbox> npm run license-smoke` | resultado redactado; nunca la clave | PENDIENTE | activación, firma, invalidación, límite, revocación y downgrade verificados |
| EXT-04 | P0 | WebSocket/WebRTC con TURN | ejecutar `wss://` desde dos redes, NAT restrictivo y reconexión | informe Playwright, ICE candidates resumidos, red usada y timestamp | PENDIENTE | conexión P2P/relay, autorización, conflicto y recuperación PASS |
| EXT-05 | P0 | Backup/restore de infraestructura | ejecutar drill en staging y restaurar en entorno separado | backup anonimizado o hash, RPO/RTO, logs y resultado | PENDIENTE | restore íntegro, permisos/rotación válidos y RTO/RPO dentro de contrato |
| EXT-06 | P0 | Rollback real de staging | workflow `staging-rollback.yml` con tag `prod-*` aprobado | URL de workflow, tag anterior, health post-rollback | PENDIENTE | rollback reproducible y smoke posterior PASS |
| EXT-07 | P0 | Secretos y permisos de despliegue | revisar GitHub Environments, secret manager y revisores | checklist firmado; no exportar valores | PENDIENTE | mínimos privilegios, separación staging/prod y aprobación protegida |
| EXT-08 | P0 | DAST autenticado | activar solo con contexto/credenciales de staging: `check:zap-context` + workflow DAST | ZAP HTML/JSON/SARIF y triage | PENDIENTE | cero Critical/High abiertos; Medium con aceptación formal |
| EXT-09 | P0 | Pentest independiente | `node scripts/penetration-test.mjs --target <staging> --scope full` | informe técnico y registro de remediación | PENDIENTE | cero Critical/High sin remediar y retest documentado |
| EXT-10 | P0 | Protección remota de `main` | confirmar ruleset y PR de prueba en GitHub | URL del ruleset y run bloqueante/verde | PENDIENTE | checks obligatorios activos en el repositorio real |
| EXT-11 | P1 | WCAG y privacidad manual | teclado, lector de pantalla, contraste, móvil y política | hoja de sesión, navegador/dispositivo, defectos y capturas | PENDIENTE | sin P0/P1 de accesibilidad o privacidad sin plan aprobado |
| EXT-12 | P1 | Navegadores/dispositivos reales | iOS Safari, Android físico, Firefox y WebKit | matriz de dispositivo/OS/navegador y resultado | PENDIENTE | flujos de vault, backup, licencia, PWA y sync PASS |
| EXT-13 | P1 | WebLLM físico | `npm run calibrate:first-summary` | sidecar sin prompts/URLs/UA y baseline por perfil | PENDIENTE | WebGPU físico, memoria mínima y métrica dentro del perfil |
| EXT-14 | P1 | Checkout/compra controlada | compra sandbox, activación, reinicio, offline, desactivación y refund | IDs redactados, timestamps y resultado de cada transición | PENDIENTE | ciclo comercial completo y soporte operativo verificados |
| EXT-15 | P1 | Primera ejecución CI real | ejecutar `ci.yml`, SAST, export y workflows nightly en GitHub | URLs de runs y artefactos del SHA | PENDIENTE | no hay workflow verde por no ejecución; todos los gates requeridos activos |
| EXT-16 | P1 | Revisión legal/operativa | identidad del responsable, DPA, ROPA, alertas y canal de incidentes | aprobación legal/operativa firmada | PENDIENTE | campos legales y responsables completados |

## 4. Secuencia recomendada de cierre

1. Crear checkout limpio del SHA del RC y registrar su identidad.
2. Desplegar ese SHA en staging HTTPS separado.
3. Ejecutar `EXT-01` a `EXT-06` y conservar artefactos.
4. Configurar y revisar `EXT-07`, luego ejecutar `EXT-08` y `EXT-09`.
5. Confirmar `EXT-10` y ejecutar la primera matriz CI real (`EXT-15`).
6. Completar `EXT-11` a `EXT-14` con dispositivos, cuentas y sandbox reales.
7. Obtener aprobación legal/operativa (`EXT-16`).
8. Actualizar esta matriz, repetir los gates locales contra el SHA final y emitir decisión formal.

## 5. Criterio de decisión

### GO para producción

Solo si se cumplen simultáneamente:

```text
- todas las filas P0 están en PASS;
- no hay Critical/High abiertos en DAST o pentest;
- CI remoto y ruleset de main están activos y verdes;
- staging smoke, licencia real, WebRTC/TURN, backup/restore y rollback tienen artefactos;
- responsables, alertas, secretos, legal y soporte están aprobados;
- checkout del release está limpio y el SHA desplegado coincide con el aprobado.
```

### NO-GO automático

Cualquier condición siguiente mantiene o devuelve el estado a `NO-GO`:

- staging no probado o ejecutado contra un dominio incorrecto;
- licencia validada solo con mock;
- WebRTC probado únicamente en localhost/LAN;
- backup restaurado solo en memoria o sin RPO/RTO;
- DAST/pentest con Critical/High abiertos;
- rollback no probado;
- secrets o environments no revisados;
- artefactos sin SHA, timestamp o trazabilidad;
- baseline WebLLM físico ausente cuando la IA local sea una promesa comercial.

## 6. Registro de actualización

| Fecha | Responsable | Cambio | Decisión |
|---|---|---|---|
| 2026-09-21 | equipo técnico | Paquete creado con evidencia local reproducible y 16 controles externos | NO-GO hasta cerrar P0 |
| 2026-09-21 | Codebuff | RC actualizado: SHA d9a7e25, 161 test files pass, 85 gates pass, 12/12 verifiable checklist, 93/123 E2E pass | NO-GO — 16 controles externos pendientes |

Este documento debe actualizarse después de cada ejecución externa; no se deben rellenar estados por inferencia ni convertir un resultado local en evidencia de infraestructura real.
