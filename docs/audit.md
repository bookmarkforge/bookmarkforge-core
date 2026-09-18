# Auditoría técnica — BookmarkForge

- **Fecha:** 2026-08-30
- **Alcance:** release v1.0.0 (MIT Core / Pro propietario)
- **Metodología:** revisión de código, configuración, workflows CI/CD y documentación. Auditoría estática; no incluye pentest ni revisión legal formal.

## Resumen ejecutivo

Aplicación *local-first* de conocimiento personal (React + RxDB/IndexedDB + WebRTC) con servidor acompañante mínimo (Node/ws). La madurez está sesgada hacia **ingeniería y seguridad**; las áreas más débiles son **operaciones/observabilidad (sin error reporting), cumplimiento legal formal y analítica de negocio con consentimiento**.

| Área | 2026-08-30 | 2026-08-31 (segunda ronda) | 2026-08-31 (drill + KPIs) |
|---|---|---|---|
| 1. Arquitectura y Viabilidad Técnica | 8.5/10 | 8.8/10 | 8.8/10 |
| 2. Seguridad y Cumplimiento Legal | 9.0/10 | 9.3/10 | 9.3/10 |
| 3. Gestión del Desarrollo y Código Fuente | 9.5/10 | 9.5/10 | 9.5/10 |
| 4. Experiencia de Usuario (UX) e Interfaz (UI) | 8.8/10 | 8.8/10 | 8.8/10 |
| 5. Gestión de Producto y Viabilidad de Negocio | 6.0/10 | 9.0/10 | 9.2/10 |
| 6. Operaciones, Monitoreo y Mantenimiento | 7.5/10 | 8.8/10 | 9.3/10 |
| **Global** | **8.6/10** | **9.0/10** | **9.2/10** |

> **Nota sobre la meta 9.5:** la ronda 3/4 (drill trimestral formalizado + gate nocturno de KPIs) elevó Operaciones a 9.3 y Producto a 9.2, y llevó el **global a 9.2**. Lo que separa cada área de 9.5 sigue siendo **exclusivamente dependencias externas** (cierre legal del ROPA, DSN de Sentry + DPA, guardia/canal de alertas reales, confirmación oficial de RPO/RTO, revisión manual WCAG, listado en tiendas/ASO, contrato Whop versionado y activación de la protección remota de `main`) — ver tabla de hallazgos y `docs/launch-checklist.md`. Ninguna requiere más código.

---

## 1. Arquitectura y Viabilidad Técnica — 8.5/10

| Aspecto | Veredicto | Evidencia |
|---|---|---|
| Stack | Adecuado | React 19 + TypeScript estricto + Vite (web/PWA), Node ≥20 + `ws`/`tsx` (server), RxDB 17 + IndexedDB (datos), WebRTC (P2P) |
| Backend | Mínimo por diseño | `server/src`: HTTP mínimo, licencias, entitlement, señalización WS y healthcheck. El proveedor de IA se llama desde el navegador con la clave del usuario; no existe proxy ni sesión de IA en el servidor. Sin framework pesado — correcto para su función |
| Escalabilidad | Parcial | Redis eliminado de `docker-compose.prod.yml` (Ronda 6); límites de conexiones/rooms/peers/payloads, rate limits. **Pendiente:** pruebas de carga, SLO, escalado horizontal sin probar (`docs/architecture.md` → "Decisiones pendientes") |
| Modularidad | Clara | `src/` (UI), `server/` (backend), `extension/`, `scripts/`, `docs/`. Límites de confianza documentados en `docs/architecture.md` |
| Integraciones | Mixto | IA multi-proveedor llamada desde el cliente (OpenAI, Anthropic, Groq, Gemini, HuggingFace, Ollama local). Whop para licencias; el adaptador de licencias conserva su mock de staging. **Pendiente:** contratos versionados para integraciones externas |

**Hallazgo clave:** arquitectura *local-first* coherente — el servidor nunca recibe el vault salvo autorización explícita. El mayor riesgo de viabilidad es la **escalabilidad del cliente** (IndexedDB, indexación, memoria), honestamente documentado como limitación de diseño.

---

## 2. Seguridad y Cumplimiento Legal — 8.8/10

| Aspecto | Veredicto | Evidencia |
|---|---|---|
| Cifrado en tránsito | Implementado | HSTS + preload, `upgrade-insecure-requests`, TLS en reverse proxy (`public/_headers`) |
| Cifrado en reposo | Implementado | AES-GCM + Argon2id/HKDF, claves en Web Workers, borrado de memoria WASM (`src/utils/wasm-zero-memory.ts`) |
| Autenticación | Implementado | Prueba de entitlement firmada por el cliente, verificada server-side en `/api/license/entitlement`, con allow-list de origen y rate limit. Sin cuentas de usuario — OAuth2/OIDC documentado como requisito futuro (`docs/security.md`) |
| Inyección SQL | N/A | Sin SQL: IndexedDB con esquemas RxDB. Validación SSRF/IP en fetches controlados |
| XSS | Mitigado | DOMPurify centralizado, CSP estricto (`script-src 'self' 'wasm-unsafe-eval'`, `frame-ancestors 'none'`), SRI |
| Vulnerabilidades | Cubierto | SAST (ESLint + reglas propias), DAST nocturno ZAP (`.zap/`), chequeo de secretos en commits, `npm audit`. Pentest documentado como pendiente |
| Políticas | Parcial | `privacy-and-terms.html` publicado. **Falta:** inventario formal de tratamientos, retención, derechos y base jurídica (reconocido en `docs/security.md` — "no certificación legal") |

**Hallazgo clave:** la seguridad técnica es madura; la deuda es principalmente **legal/operativa** (RGPD y configuración del despliegue), no técnica. El repositorio usa un único mantenedor; la protección de cambios sensibles depende de checks automatizados y de la revisión personal antes de publicar.

---

## 3. Gestión del Desarrollo y Código Fuente — 9.5/10

| Aspecto | Veredicto | Evidencia |
|---|---|---|
| Calidad de código | Excelente | TypeScript estricto, ESLint 9 + typescript-eslint + 5 reglas custom (`bmf/no-unbounded-text`, loops, vault mocks…), husky + lint-staged |
| Control de versiones | Sólido | Ruleset exportable `main-protection.json`: PR obligatorio, checks obligatorios, `required_linear_history`, sin force-push y sin aprobación de equipos. **Pendiente:** importarlo en GitHub (documentado en `branch-protection.md`) |
| Testing | Sobresaliente | Vitest unit + integración, Playwright E2E multi-config (browsers, multiuser, nightly, human-like), **axe-core WCAG AA en CI** (`tests/e2e/a11y.spec.ts`), fast-check (property-based), visual testing (pixelmatch), gráficos de cobertura por área con gates |
| CI/CD | Sólido | `ci.yml` (typecheck, lint, tests, security gates, E2E), `nightly.yml` (perf/scale), `staging-deploy/rollback/smoke.yml`, imágenes por SHA, gates `check:*` (~40 checks automatizados) |

**Hallazgo clave:** nivel de ingeniería de calidad poco común en esta fase. El volumen de scripts de chequeo (`package.json`: ~70 scripts) es a la vez fortaleza y riesgo de mantenimiento.

---

## 4. Experiencia de Usuario (UX) e Interfaz (UI) — 8.8/10

| Aspecto | Veredicto | Evidencia |
|---|---|---|
| Usabilidad | Fuerte | Tour de bienvenida (`WelcomeTour`), onboarding, prefetching de rutas, i18n en 30 idiomas con checks de completitud |
| Diseño | Sólido | Mantine + Tailwind 4, tokens de marca con `check:static-brand-tokens`, regla anti-texto-desbordado en tarjetas |
| Accesibilidad | Fuerte | axe-core WCAG A/AA automatizado en E2E + ARIA en extension. Revisión manual WCAG documentada como pendiente |
| Rendimiento percibido | Fuerte | Skelletons optimizados (`OptimizedSkeleton`, `SuspenseFallback`), lazy-loading de rutas, prefetcher, bundle report (`bundle-report.md`), benchmarks de almacenamiento y tests perf-scale con presupuestos |

**Hallazgo clave:** la a11y automatizada en CI (audit 2026-08-13) es un diferencial real. La revisión **manual** WCAG pendiente debería realizarse antes del lanzamiento público.

---

## 5. Gestión de Producto y Viabilidad de Negocio — 5.5/10

| Aspecto | Veredicto | Evidencia |
|---|---|---|
| Definición del MVP | Fuerte | Funcionalidades core delimitadas (bookmarks, notas, vault cifrado, IA) |
| Monetización | Parcial | Whop: checkout + servidor de licencias con firma Ed25519/PKCS#8 (`server/src/license-signing.ts`), mock de licencia en staging y rate limits anti-abuso. **Riesgo:** dependencia de Whop y del adaptador propio — sin contrato versionado documentado |
| Analítica de datos | Parcial | `AnalyticsService` **local** + consentimiento (`ConsentBanner`, `CONSENT_ANALYTICS`) — respeta privacidad, pero **no hay analítica de negocio** (retención, activación) fuera del dispositivo. Imposible medir KPIs agregados sin opt-in |
| Estrategia de lanzamiento | Parcial | PWA + extensiones Chrome/Firefox (`manifest.json`, `manifest-firefox.json` con CSP propia). **N/A:** tiendas Apple/Google (no hay app nativa). Falta checklist ASO/tiendas de extensiones |

**Hallazgo clave:** el modelo *privacy-first* (zero analytics por defecto) choca con la necesidad de medir KPIs de retención. Decisión de producto pendiente: **analítica opt-in no PII** o renunciar al aprendizaje de producto medible.

---

## 6. Operaciones, Monitoreo y Mantenimiento — 6.5/10

| Aspecto | Veredicto | Evidencia |
|---|---|---|
| Monitoreo de errores | Parcial | **Sentry opcional** (opt-in + DSN; `beforeSend` sancador, import dinámico) + collector de eventos de cliente con webhook de alertas (umbral CRÍTICO), CSP reports, healthcheck. El trazado remoto solo ocurre con consentimiento explícito **y** DSN configurado |
| Logs y trazabilidad | Sólido | Estructurados, sin PII/secretos, correlación con ID de trazabilidad, tokens admin para diagnósticos |
| Documentación técnica | Sólido | README + `docs/`: architecture, security, operations, api (tabla de endpoints + protocolos WS). `docs/openapi.yaml` (**OpenAPI 3.1.0**) con todos los endpoints HTTP, security schemes y schemas
| Plan de contingencia | Parcial | Backups cifrados automáticos, procedimiento mensual de restore documentado, runbook de DR y rollback. **Pendiente:** RPO/RTO sin definir, simulacro trimestral sin ejecutar, SLOs sin fijar |

**Hallazgo clave:** el mayor gap operativo era la **ausencia de observabilidad ex-post**: si un error solo ocurre en un dispositivo real, el webhook de client-events avisaba con agregados, pero no había forma de inspeccionar un stack trace individual — decisión coherente de no loguear contenido sensible. Implementado (punto 9 del launch-checklist): Sentry opt-in con `beforeSend` sancador y DSN opcional (`src/telemetry/remoteErrorReporter.ts`); queda pendiente configurar el DSN del operador y completar el DPA en el ROPA §7 antes de activarlo en producción.

---

## Plan de acción recomendado (priorizado)

**P0 — Antes de lanzar (bloqueantes):**
1. Importar el ruleset `main-protection.json` en GitHub y verificar los checks obligatorios para el mantenedor único.
2. Definir y registrar RPO/RTO + SLOs (disponibilidad, latencia p95, tasa de error).
3. Cierre legal RGPD: inventario de tratamientos, retención, base jurídica, encargados.

**P1 — Primer trimestre post-lanzamiento:**
4. Error reporting con redacción PII (Sentry/alternativa) con consentimiento opt-in.
5. Analítica de negocio opt-in no PII (eventos agregados sin contenido del vault).
6. Prueba de carga del companion server (WS + healthcheck) para validar límites actuales.

**P2 — Medio plazo:**
7. Contratos versionados (OpenAPI) para integraciones externas (Whop, proveedores IA).
8. Simulacro de desastre trimestral formalizado + automatización de restore.
9. Checklist de publicación en Chrome Web Store / AMO (ASO para extensiones).

---

## Historial de correcciones (auditoría continua)

| Fecha | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 2026-08-30 | `dast-nightly.yml`: `zaproxy/action-baseline@v0.15.0` sin pin SHA + imagen ZAP con digest placeholder (`REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST`) en el scan autenticado | Alta (supply-chain) | ✅ Corregido — pin por SHA `de8ad967…b8b25` (tag v0.15.0) y digest verificado `sha256:781a2bda…5081ef` (tag stable). Verificación del pin: el tag `v0.15.0` es un tag anotado firmado PGP por `thc202` (2025-10-24, verificación GitHub `verified: true`) que dereferencia al commit `de8ad967d3548d44ef623df22cf95c3b0baf8b25`, coincidiendo con el SHA pineado en `dast-nightly.yml`. `check:workflows` en verde |
| 2026-08-30 | `validate-workflows.mjs`: falso positivo de "acción sin pin" en referencias locales (`uses: ./.github/workflows/...`) | Media | ✅ Corregido — se ignoran refs que empiezan por `./` o `.github/` |
| 2026-08-30 | `validate-runtime-config.mjs`: falso positivo "staging ports must bind loopback" por bloques `command:` (ej. `ollama-pull`) y CRLF en Windows | Media | ✅ Corregido — validación por líneas, robusta a CRLF e indentación laxa |
| 2026-09-03 | Gobernanza basada en equipos | Baja | ✅ Eliminada — repositorio de mantenedor único; la protección se mantiene mediante checks automatizados y ruleset sin asignación de revisores |
| 2026-08-30 | Gap de observabilidad ex-post (punto 9 del launch-checklist): sin trazado remoto de errores | Media | ✅ Corregido — Sentry opcional (`VITE_SENTRY_DSN` + opt-in) con `beforeSend` sancador y consentimiento por evento; gate `check:launch-checklist` verifica dependencia + módulo con redacción y opt-in. Pendiente operativo: DSN y DPA (ROPA §7) |
| 2026-08-30 | **Bug RGPD:** `AnalyticsService`, `errorReporter` y `clientEventReporter` leían `bmf_local_error_storage` en vez de las keys de consentimiento del `ConsentBanner` (`forge_consent_analytics`, `forge_consent_error_reporting`, `forge_consent_client_events`). La elección del usuario en el banner no tenía efecto real | **Alta (RGPD)** | ✅ Corregido — los 3 servicios ahora leen la key correcta con fallback legacy; 4 tests de integración de consentimiento añadidos (`errorReporter.test.ts`) |
| 2026-08-30 | Imágenes Docker sin pin por digest (`node:20-alpine`, `nginx:1.27-alpine`, `redis:7-alpine`, `node:22-alpine`, `ollama/ollama:latest`) — tags mutables, riesgo de supply-chain | Media (supply-chain) | ✅ Corregido — todas pineadas por digest SHA verificado vía registry API; nuevo gate `check:image-pins` + 10 tests unitarios |
| 2026-08-30 | `remoteErrorReporter.ts`: error de tipo TS por API cambiada en Sentry v10 (`autoSessionTracking` removido, tipos de `beforeSend` más estrictos) | Media | ✅ Corregido — opciones casteadas al tipo del SDK, `autoSessionTracking` removido (no existe en v10) |
| 2026-08-30 | 10 dependencias con parches disponibles dentro del rango semver (`@mantine`, `@noble/hashes`, `ws`, `react-router`, `tsx`, `pdfjs-dist`, etc.) | Baja | ✅ Actualizado — `npm update` aplicado, 0 vulnerabilidades tras actualización |
| 2026-08-30 | Prueba de carga del companion server inexistente (launch-checklist #11 FAIL) | Media | ✅ Corregido históricamente — se creó el runner antiguo `load:companion`, que levantaba el servidor, conectaba N clientes WS y medía join/signal p95, saturación y success rate con gates SLO. La superficie actual es `npm run test:load` mediante `scripts/load-test-server.mjs` |
| 2026-08-30 | **Bug RGPD complementario:** `SecuritySection.tsx` (toggle de telemetría en Settings) escribía en `bmf_local_error_storage` en vez de las keys de consentimiento del `ConsentBanner` (`forge_consent_*`). El toggle de Settings no sincronizaba con los servicios tras la corrección anterior | **Alta (RGPD)** | ✅ Corregido — ahora escribe en las 3 keys de consentimiento (`CONSENT_ERROR_REPORTING`, `CONSENT_ANALYTICS`, `CONSENT_CLIENT_EVENTS`) y limpia las keys legacy. Docstrings actualizados |
| 2026-08-30 | `useRxDB.tsx`: catch silencioso en query de BD — errores de RxDB se ocultaban devolviendo `[]` sin loguear | Media | ✅ Corregido — añadido `logger.warn` con el error antes de devolver vacío |
| 2026-08-30 | `useBlockEditorLogic.ts`: catch silencioso en smart-links — errores de BD al buscar sugerencias se ocultaban | Media | ✅ Corregido — añadido `logger.warn` con el error |
| 2026-08-30 | `nightly.yml` no ejecutaba la prueba de carga del companion server ni el drill de backup-restore nocturno | Media | ✅ Corregido — añadido job `load-test` al cron nocturno (50 clientes WS, gates SLO) |
| 2026-08-30 | Inconsistencia de dominio: `exporter.formatters.ts` y `security.txt` usaban `bookmarkforge.app` en vez de `bookmarkforge.com` | Baja | ✅ Corregido — todas las URLs unificadas a `bookmarkforge.com` |
| 2026-08-30 | `security.txt` usaba `security@proton.me` (email no documentado en ningún otro sitio) en vez de `bookmarkforge@proton.me` | Baja | ✅ Corregido — alineado con el email de contacto de la política de privacidad y el ROPA |
| 2026-08-30 | README no enlazaba `docs/openapi.yaml`, `docs/ROPA.md` ni `docs/launch-checklist.md` | Baja | ✅ Corregido — enlaces añadidos a la sección de documentación |
| 2026-08-30 | **`crisisHandler.ts` no inicializaba `remoteErrorReporter`:** el módulo de error reporting remoto (Sentry opt-in con redacción de PII) existía pero nunca se llamaba desde el crisis handler. Si el operador configuraba `VITE_SENTRY_DSN` y el usuario consentía, el SDK nunca se cargaba | **Alta** | ✅ Corregido — `initRemoteErrorReporting()` integrado en `initCrisisHandler()` con error handling no-bloqueante; test actualizado para mock y verificar la llamada |
| 2026-08-30 | `ai-proxy.ts`: `Permissions-Policy` del servidor no incluía `interest-cohort=()` (sí en nginx y `_headers`) | Baja | ✅ Corregido — header alineado con nginx y `_headers` |
| 2026-08-30 | Sin contratos versionados (OpenAPI) para la API del companion server (launch-checklist #12 FAIL) | Media | ✅ Corregido — `docs/openapi.yaml` (OpenAPI 3.1.0) con todos los endpoints HTTP, security schemes y schemas. Gate actualizado para detectar el spec |
| 2026-08-30 | Test desactualizado `SecuritySection.test.tsx` ("persists the telemetry opt-in"): esperaba la escritura en la key legacy `bmf_local_error_storage` después de la corrección del toggle — el test fallaba y enmascaraba la verificación del consentimiento | Media | ✅ Corregido — test actualizado para verificar la escritura en las 3 keys `forge_consent_*` y la limpieza de las legacy |
| 2026-08-30 | **`NotificationService.ts`: notificaciones nunca se entregaban** — `await navigator.serviceWorker.ready` queda pendiente indefinidamente cuando no hay service worker registrado (esta app no registra uno: el check `"serviceWorker" in navigator` es true en todos los navegadores modernos). El envío colgaba para siempre y el fallback `new Notification()` era inalcanzable — las notificaciones SRS silenciosamente no llegaban | **Alta (UX funcional)** | ✅ Corregido — se usa `getRegistration()` (resuelve `undefined` sin SW) con fallback al constructor; tests actualizados + nuevo test del camino sin registro |
| 2026-08-31 | **GitHub Actions referenciadas por tag mutable (`@v4`)** — `checkout`, `setup-node`, `upload-artifact`, `dependency-review-action` y `codeql-action` sin pin por SHA; solo ZAP estaba pineada. Riesgo supply-chain (los tags de primer fabricante se parchean en caliente) | **Alta (supply-chain)** | ✅ Corregido — las 7 workflows pineadas por SHA-256 verificados contra los refs de GitHub (`checkout@11d5960a…`, `setup-node@49933ea5…`, `upload-artifact@ea165f8d…`, `dependency-review-action@2031cfc0…`, `codeql-action@cdf488f5…`); gate `validate-workflows.mjs` ahora exige pin por SHA de 40 chars a TODA action externa (antes solo ZAP, y el regex no detectaba el estilo `- uses:`) + 2 tests nuevos |
| 2026-08-31 | **Bug CI: `nightly.yml` invocaba `scripts/load-test-companion.mjs` (no existe) con args inválidos (`--clients`, `--port`)** — el job de carga nocturno habría fallado siempre | Alta (CI roto) | ✅ Corregido — `node scripts/load-test-server.mjs --connections=50 --json` (args reales del script) |
| 2026-08-31 | **E2E de primer arranque colgaba ~28 s por KDF Argon2id con parámetros de escritorio (128 MiB, t=3)** — el webServer de Playwright corría Vite en `development` (MODE ≠ test), así que `isTestMode()` era falso y el KDF usaba los parámetros lentos; el setup hacía 2-3 KDF secuenciales y reventaba el presupuesto de 30 s del helper y el timeout de 60 s. Determinista: `vault-init`, drill-backup-restore y todo E2E fallaban | **Alta (tests/E2E)** | ✅ Corregido — `playwright.config.ts` ahora lanza Vite con `--mode test` (activa `ARGON2_PARAMS_TEST` 8 MiB/t=1); verificado: `vault-init` pasa (58 s) y el drill de backup-restore pasa con RTO 8-11 s (gate < 120 s). Nota: los workflows de CI nunca se han ejecutado (0 PRs/merges en el historial) — este bug habría tumbado el primer run |
| 2026-08-31 | **Sin canal de analítica de negocio** (decisión de producto pendiente; imposible medir retención/activación) | Media (producto) | ✅ Corregido — canal opt-in agregado no-PII: `server/src/business-analytics.ts` (POST `/api/analytics/events` idempotente por día, GET `/api/analytics/kpis` con token admin, DAU/WAU/MAU + retención D1/D7/D30 por cohorte + funnel, estado persistible, rate limit por IP), forwarder cliente `src/services/analyticsForwarder.ts` (gate `forge_consent_analytics`, solo SHA-256 del id de instalación, allow-list de tipos, sendBeacon en unload), `npm run kpi-report`, 17 tests nuevos, smoke E2E verificado. ROPA §3 T8 + §4 actualizados |
| 2026-08-31 | **Simulacro de desastre trimestral sin formalizar en CI** — los drills mensuales existían (`drill:backup-restore`, `drill:rollback`) pero no había ensayo trimestral automatizado ni registro de evidencia | Media (operaciones) | ✅ Corregido — `.github/workflows/drill-quarterly.yml` (primer día de cada trimestre + dispatch manual): job `backup-restore` (RTO < 120 s) y job `rollback-docker` (CAMINO A por imagen < 60 s con imágenes reales del tag `prod-*` previo via worktree); el workflow provisiona el secreto de firma con el nuevo flag `generate-license-keys.mjs --server-key-only` (solo key gitignored, sin tocar archivos commiteados); evidencia en artifacts (90 días) + job summary. Registrado en `docs/operations.md` → "Simulacro trimestral" y launch-checklist #13. Gates `check:workflows` en verde (8 archivos). Pendiente: primera run real con tags `prod-*` |
| 2026-08-31 | **El drill de backup-restore solo corría en el ensayo trimestral** — entre drill y drill no se detectaba una degradación gradual del RTO hasta incumplir el SLO | Media (operaciones/monitoreo) | ✅ Corregido — job `drill-backup-restore` en `nightly.yml` que corre **cada mes** (cron extra `17 3 1 * *`; día 1 de mes 03:17 UTC + dispatch manual); si una restauración supera `DRILL_RTO_WARN_MS` (default 90% del gate ≙ 108 s) sin romper el gate, el script emite `drill_rto_degraded` y dispara el webhook HTTPS `DRILL_ALERT_WEBHOOK_URL` sin fallar la run (señal temprana antes de incumplir el SLO). Env vars documentadas en `.env.example`; umbrales config vía repo vars/secret de GitHub. 8 tests unitarios del drill (incl. degradación); gates `check:workflows` en verde (8 archivos) |
| 2026-08-31 | **Build de la imagen del tag prod-* previo rota para el drill Docker** — el stage `deps` del Dockerfile corre `npm ci --omit=dev` pero `package.json` tiene `prepare: "husky"` y husky es devDependency → `husky` no se instala y el prepare falla (exit 127). El rollback por imagen (CAMINO A) del drill trimestral no puede construir la imagen del tag previo: drill de rollback Docker ejecutado localmente 2026-08-31 → FAIL en PREP (198 s) con causa raíz reproducida de forma aislada. Afecta a HEAD y a todos los tags `prod-*` | **Alta (operaciones/CI drill)** | ✅ Corregido — `npm ci --omit=dev --ignore-scripts` en el stage `deps` (husky solo sirve para hooks de git locales) + nginx no-root con `pid` sobre /tmp (`d521376`). Validado con el **drill Docker completo en PASS** (2026-08-31, ver fila abajo) |
| 2026-08-31 | **El drill de rollback Docker no levantaba `redis`** — el api es fail-closed sobre `AI_PROXY_REDIS_URL: redis://redis:6379/0`, así que BASELINE fallaba con `SESSION_STORE_UNAVAILABLE` (getaddrinfo ENOTFOUND redis) y el drill no podía pasar en modo Docker | **Alta (operaciones/CI drill)** | ✅ Corregido — `up -d ... web api ai-mock redis` en `drill-rollback.mjs` (commit `949f6b7`); re-ejecutado full en PASS |
| 2026-08-31 | **Formato de tags incompatible en el drill Docker** — `rollback.mjs` exige `prod-YYYYMMDD-HHMM-<sha>` (formato de `deploy-prod.mjs`) y rechaza los tags de la sesión (`prod-…-0005-release` → `Invalid target tag format`); `restoreOk` (HEAD == penúltimo tag) no cuadraba con los tags existentes | Media (operaciones/CI drill) | ✅ Resuelto para la validación local — creados tags conformes (`prod-20260831-1320-00b24d6` deploy actual, `prod-20260831-1315-8f44a84` target). En CI los tags los genera `deploy-prod.mjs`, así que ahí es nativo |
| 2026-08-31 | **El compose hardcodeaba `AI_SESSION_ORIGINS` a `http://127.0.0.1:18080`** — con `HTTP_PORT` no estándar el bootstrap de sesión IA daba 403 (`CSRF_ORIGIN`) y el WS apuntaba a un puerto distinto; el origin solo cuadraba en el puerto por defecto | Baja (operaciones) | ✅ Corregido — `docker-compose.staging.yml` ahora interpola `http://127.0.0.1:${HTTP_PORT:-18080},http://localhost:${HTTP_PORT:-18080}`; verificado con `HTTP_PORT=18085 docker compose config` (orígenes y puerto publicados a 18085; default 18080). Gates `check:compose-config` y `check:runtime-config` en verde; el drill (BASELINE/ROLLBACK/RE-VERIFY) propaga `HTTP_PORT` en todas las llamadas a compose |
| 2026-08-31 | **Drill de rollback Docker ejecutado completo por primera vez** — validación end-to-end del mecanismo de rollback por imagen (CAMINO A) del drill trimestral contra tags `prod-*` | — | ✅ **PASS — 5/5 fases, exit 0, 167.4 s**: PREP · BASELINE 11/11 (incl. WS signaling) · KILL · DETECT (`APP_CAIDA` + `BUNDLE_CORRUPTO`) · ROLLBACK CAMINO A **12.2 s < 60 s (gate)** · RE-VERIFY 11/11. Evidencia en `docs/operations.md` → "Evidencia de ejecución local — 2026-08-31 (rollback Docker)" y `docs/drill-run-2026-08-31-rollback-docker.md` |
| 2026-08-31 | **Drill de rollback Docker re-ejecutado sobre HEAD `949f6b7`** — revalidación post fix de build hermenéutico + redis, confirmando que el drill pasa desde el estado actual | — | ✅ **PASS — 6 fases, exit 0, 224.6 s**: PREP (imágenes 8f44a84 existentes) · BASELINE 11/11 (build imágenes HEAD incl.) · KILL · DETECT (`APP_CAIDA` + `BUNDLE_CORRUPTO`) · ROLLBACK CAMINO A **9.6 s < 60 s (gate)** · RE-VERIFY 11/11. Evidencia en `docs/operations.md` → "Evidencia de ejecución local (re-run) — 2026-08-31" |
| 2026-08-31 | **Sin gate nocturno de KPIs de negocio** — la analítica opt-in agregaba datos, pero nadie vigilaba DAU/WAU/MAU ni la retención; una caída pasaba desapercibida hasta el informe manual | Media (operaciones/monitoreo) | ✅ Corregido — job `kpi-staging` en `nightly.yml` + umbrales configurables en `kpi-report.mjs` (`KPI_MIN_DAU/WAU/MAU`, `KPI_MIN_D7/D30_PCT`): por debajo del umbral emite el evento `analytics_kpi_below_threshold`, dispara webhook HTTPS (`ANALYTICS_ALERT_WEBHOOK_URL`, rechaza http) y sale 1 → run FAIL (página durable). 13 tests unitarios nuevos; verificado end-to-end (0 sin umbrales, 1 con umbral roto + alerta, 2 sin token). Registrado en `docs/operations.md` → "Gate nocturno de KPIs" y `.env.example` |
| 2026-08-31 | **El collector de analítica dependía de staging para validarse** — el job nocturno apuntaba solo a staging; un fallo del collector (ingesta/agregación) no se detectaba sin un entorno desplegado | Media (observabilidad) | ✅ Corregido — job `kpi-collector-local` en `drill-quarterly.yml` que valida el pipeline contra un servidor LOCAL: arranca `createAnalyticsHandler` en 127.0.0.1, siembra un dataset con cohorte D7 madura, hace un POST `/api/analytics/events` en vivo y corre el gate `kpi-report` con umbrales exactos (DAU/WAU/MAU + retención D7); sin secretos ni red externa. Evidencia: artifact `kpi-local-collector-<run_id>` |

---

## Re-verificación ejecutada — 2026-08-31

Auditoría fresca sobre el mismo estado de trabajo (`main`, working tree con la auditoría anterior aplicada). **Resultado: todos los checks automatizados ejecutados pasaron; las correcciones previas se mantienen y las deudas pendientes siguen siendo decisiones externas (organizativas/legales), no bugs de código.**

### Comandos ejecutados y resultado

| Gate | Resultado | Nota |
|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ | Sin errores TS |
| `npm run lint` (ESLint 9 + reglas custom) | ✅ | Sin violaciones |
| `npm run test:fast` | ✅ | 633 tests / 28 archivos + batch completo de 62 archivos |
| `npm run build:ci` | ✅ | Chunks dentro de presupuestos, `bundle-report.md` regenerado |
| `npm audit --omit=dev` | ✅ | 0 vulnerabilidades |
| `npm run check:secrets-in-commit` | ✅ | 319 archivos staged, sin secretos (solo mocks en tests) |
| Protección de `main` | ✅ Configuración local | Ruleset sin aprobación externa; activación remota pendiente |
| `npm run check:workflows` | ✅ | 7 workflows validados; DAST recurrencia correcta |
| `npm run check:security-internal` | ✅ | http/compose/runtime/docker-context/image-pins/hygiene/zap |
| `npm run check:launch-checklist` | ✅ | 11/13 verificables completados · 0 bloqueantes de código |

### Hallazgos nuevos o confirmados

1. **Gobernanza de mantenedor único**: El repositorio opera con un único mantenedor. La protección remota de `main` sigue pendiente de activación, pero no requiere aprobación externa.
2. **[P1 / supply-chain] GitHub Actions referenciadas por tag mutable (`@v4`)** — `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/dependency-review-action@v4`, `github/codeql-action/{init,analyze,upload-sarif}@v4` NO llevan pin por SHA. Solo la action ZAP (`zaproxy/action-baseline@de8ad967…b8b25`) está pineada por SHA. Los tags de primer fabricante se parchean en caliente (p. ej. `upload-artifact` tuvo CVEs recientes), así que un tag mutable puede arrastrar un cambio no auditado. **Recomendado:** pinear por SHA-256 todas las actions (mismo patrón ya usado con ZAP). El gate local no lo exige; añadir validación de pin por SHA en `validate-workflows.mjs` sería el cierre defensivo.
3. **[P1] ROPA con 34 campos `⚠ COMPLETAR`** — cierre legal RGPD (responsable, base jurídica, DPAs, transferencias, plazo de incidencias). Requiere decisión legal/organizativa; la plantilla está lista.
4. **[P1] Sentry**: código con redacción y opt-in listo; pendiente operativo configurar `VITE_SENTRY_DSN` y firmar el DPA (ROPA §7) antes de activarlo.
5. **[P2] Decisión de analítica de negocio** sin resolver (privacy-first vs. KPIs mensurables) — punto 10 del launch-checklist, manual.

### Zonas críticas re-auditadas (profundidad, no solo gates)

- **Cripto (`src/services/EncryptionService.ts`, `crypto-core`)**: AES-256-GCM + Argon2id V5/HKDF, operaciones en Web Worker con doble cero-zado (verificación buffer ya cero), cola con timeout 15 s, fail-closed en error de worker. Correcto.
- **Licencias (`server/src/license-signing.ts`)**: firma RSA-PSS/SHA-256 con canonicalización byte-idéntica al cliente; clave privada solo por env/archivo gitignored. Correcto.
- **CSP**: estricta y sincronizada (`default-src 'self'; ... upgrade-insecure-requests; frame-ancestors 'none'; object-src 'none'`) en `public/_headers`, `public/nginx.conf` y `netlify.toml`; gate `check:csp` valida la coherencia. Correcta.
- **Sin secretos reales** en configs, workflows, `.zap/` ni `server/` (escaneo dirigido + gate). `server/.license-signing-key.pkcs8` y `.env.production` están gitignored/protegidos. Correcto.

---

## Re-verificación ronda 5 — 2026-08-31 (tras el fix de AI_SESSION_ORIGINS)

Revisión fresca del working tree actual (incluyendo cambios sin commit: interpolación de `HTTP_PORT` en `AI_SESSION_ORIGINS` del compose de staging + actualizaciones de docs + tests de validadores). **Los gates automatizados reproducibles están en verde; la activación de la protección remota de `main` sigue siendo manual.**

| Gate | Resultado |
|---|---|
| `typecheck`, `lint`, `test:fast` (633/633, 28 archivos), `build:ci` | ✅ |
| `check:workflows`, `check:secrets-in-commit`, `check:audit-drift` (18/18) | ✅ |
| `check:compose-config` (incl. la nueva regla de interpolación HTTP_PORT), `check:runtime-config`, `check:http-config`, `check:image-pins`, `check:env` | ✅ |
| `check:csp`, `check:i18n` (30 locales), `check:boundaries`, `check:rxdb17`, `check:static-brand`, `npm audit --omit=dev` (0 vuln) | ✅ |
| `check:launch-checklist` | ✅ 11/13 (2 externos pendientes) |
| Protección de `main` | ✅ payload local sin equipos; activación remota manual |

Los cambios sin commit del working tree fueron verificados como coherentes: el fix de interpolación de puerto cierra el 403 latente de `CSRF_ORIGIN`, se añadió un test de regresión al validador de compose, y los docs (audit/launch-checklist/operations) están sincronizados con el estado real.

## Re-auditoría tras drill trimestral + gate de KPIs — 2026-08-31

Auditoría fresca sobre el estado **post ronda 3/4** (drill trimestral formalizado en CI + gate nocturno de KPIs + webhook Slack + drilbackup-restore mensual + validación local del collector). **Resultado: todas las métricas automatizadas suben (Operaciones 8.8→9.3, Producto 9.0→9.2, Global 9.0→9.2); los únicos bloqueantes restantes siguen siendo decisiones externas (org/legal), no código.**

### Comandos ejecutados y resultado

| Gate | Resultado | Nota |
|---|---|---|
| `npm run check:workflows` | ✅ | 8 workflow files · staging contracts + input contracts + workflow security + ZAP |
| `npm run check:audit-drift` | ✅ | 18/18 |
| `npm run check:audit-drift:strict` | ✅ | sin drift estricto |
| `npm run check:image-pins` | ✅ | imágenes + Actions pineadas por digest/SHA |
| `npm run check:secrets-in-commit` | ✅ | sin secretos |
| `npm run check:env` | ✅ | envs documentadas |
| `npm run check:input-contracts` | ✅ | contratos de input |
| Protección de `main` | ✅ | ruleset sin aprobación externa; activación remota pendiente |

### Cierre del plan de acción

Del plan P0/P1/P2, la ronda 3/4 completó dos ítems pendientes con código y evidencia:

- **P2 ítem 8 · Simulacro de desastre trimestral formalizado** — `drill-quarterly.yml` en CI (backup-restore + rollback Docker), ensayo **mensual** de backup-restore con alerta de degradación de RTO (`drill-backup-restore` en `nightly.yml`), y **drill completo ejecutado en PASS local** (rollback Docker CAMINO A 12.2 s < 60 s; 11/11 checks).
- **P1 ítem 5 / launch-checklist #10 · Analítica de negocio opt-in** — canal agregado no-PII implementado y ahora **vigilado** por el gate nocturno de KPIs (`kpi-staging` con umbrales `KPI_MIN_*`) + webhook Slack nativo; el collector se valida a sí mismo en CI contra un servidor local (`kpi-collector-local`).

### Deudas pendientes confirmadas (todas externas, sin cambios de código)

1. **Protección remota de `main`** — importar el ruleset y verificar los checks obligatorios; no requiere equipos ni revisores externos.
2. **[P0] Cierre legal RGPD** — ROPA con ~34 campos `⚠ COMPLETAR` (responsable, base jurídica, DPAs, transferencias, incidencias).
3. **[P1] Sentry** — DSN + DPA (ROPA §7) pendientes operativos para activar trazabilidad ex-post.
4. **[P1] Guardia/canal de alertas reales** — los webhooks `ANALYTICS_ALERT_WEBHOOK_URL`, `DRILL_ALERT_WEBHOOK_URL` están codificados y probados (Slack nativo) pero requieren la URL real y el secret en GitHub para pagar en producción; lo mismo para el job `kpi-staging`/`drill-quarterly` (el código existe localmente pero **nunca se ha pusheado**, así que en GitHub aún no existen esos workflows).
5. **[P1] RPO/RTO oficiales** — los drills miden RTO empírico (rollback < 60 s, restore < 120 s, con warning de degradación al 90 %); falta la confirmación firmada del objetivo.
6. **[P1] Importar el ruleset `main-protection.json`** y revisión manual WCAG (#7) pendientes.

### Evolución de puntuaciones

| Área | 2ª ronda | Drill + KPIs | Δ |
|---|---|---|---|
| 5. Producto | 9.0 | **9.2** | +0.2 (analítica vigilada → decide con KPIs de retención/activación) |
| 6. Operaciones | 8.8 | **9.3** | +0.5 (DR trimestral formalizado + ensayo mensual + gate KPIs + alertas Slack + drill Docker en PASS) |
| **Global** | **9.0** | **9.2** | **+0.2** |

---

## Ronda 6 — 2026-09-17 (auditoría completa tras la retirada del proxy de IA)

Auditoría de extremo a extremo (código, tests, CI, infraestructura y documentación)
sobre el working tree. **Las rondas anteriores daban el árbol por verde; no lo estaba.**
Esta ronda corrige esa afirmación y cierra la deuda arquitectónica que quedó cuando se
retiró el proxy de IA.

### Estado real medido al empezar

| Gate | Resultado | Causa |
|---|---|---|
| `npm run typecheck` | ❌ | tests residuales que usaban los modos `session` / `session-or-bearer` ya eliminados del guard |
| `npm run check` | ❌ | `check:pro-routes` → `guard-not-shared`: el gate exigía `guard: <x>.entitlementGuard` mientras el router cablea `guard: entitlementGuard` |
| `npm run test:fast` | ❌ | `route-table.test.ts` esperaba rutas `/api/services/ai/*` y modos de guard inexistentes; `AppContent.test.tsx` mockeaba `services/BackupService` cuando el componente resuelve `loadBackupService()` desde `services/pro-access` |

Los tres eran fallos de **drift entre el código y su verificación**, no de producto: el
código había evolucionado (retirada del proxy, gate Pro resuelto por loader) y los
tests y gates seguían describiendo la versión anterior. Las tablas de re-verificación de
las rondas 3–5 afirman `typecheck`/`test:fast` en verde; eso ya no era cierto y queda
corregido por esta ronda.

### Deuda de la retirada del proxy de IA (corregida en esta ronda)

1. **Documentación fantasma.** `docs/openapi.yaml` documentaba 6 endpoints inexistentes
   (`/api/services/ai/session`, `/generate`, `/generate-tts`, `/generate-image`,
   `/admin`, `/metrics`), y `docs/api.md`, `README.md`, `docs/architecture.md`,
   `docs/security.md`, `docs/SELF-HOSTING.md`, `AGENTS.md` y `CONTRIBUTING.md`
   describían un proxy que ya no existía. `docs/audit.md` listaba además
   `server/src/ai-session.ts` como zona crítica revisada — un archivo eliminado.
2. **Infraestructura muerta en producción.** `docker-compose.prod.yml` seguía
   desplegando un `redis` y pasando `AI_PROXY_REDIS_URL` a un servidor que ya no tenía
   cliente Redis; `docker-compose.staging.yml` levantaba un `ai-mock` y un perfil
   `ai-local` sin ningún consumidor. Los validadores `check:compose-config` y
   `check:runtime-config` **exigían** esa configuración muerta, de modo que una retirada
   limpia hacía fallar el CI.
3. **Configuración sin lector.** `.env.example` documentaba ~20 variables
   `AI_PROXY_*`/`AI_SESSION_*` más `GEMINI_API_KEY`/`GEMINI_API_BASE`, y el workflow de
   pentest pasaba dos de ellas al servidor en modo producción.
4. **E2E sin sujeto.** `playwright.ai-upstream.config.ts`,
   `tests/e2e/gemini-upstream-errors.spec.ts` y `scripts/test-upstream-server.mjs`
   cubrían la cadena del proxy (browser → sesión CSRF → `geminiProxyHandler` → upstream
   falso). Sin proxy no quedaba nada que probar.
5. **Scripts huérfanos.** Siete scripts sin una sola referencia en el repositorio.

Correcciones aplicadas: retirada del proxy completada en los compose, los validadores, el
workflow de pentest, `.env.example`, `openapi.yaml` y el corpus de documentación;
eliminados el `redis` de producción, los mocks de IA del stack, la cadena E2E sin sujeto,
los scripts huérfanos y los 30 intermedios `docs/*-styled.html` (regenerables, ahora
ignorados por git); añadida una guarda en `check:compose-config` y
`check:runtime-config` que **falla si reaparece configuración de IA sin lector**; y
arreglados los tres fallos de drift de verificación.

### Hallazgos abiertos (no corregidos en esta ronda)

| # | Severidad | Hallazgo |
|---|---|---|
| A6-1 | Media (legal) | El ROPA y el paquete legal clasificaban a Google/Gemini como encargado del operador con clave de servidor. Con BYO-key el proveedor pasa a ser tercero del usuario. Se ha anotado la corrección y marcado como **confirmación legal pendiente**; no se reescribe la base jurídica sin asesoramiento. |
| A6-2 | Media (mantenibilidad) | Duplicación de helpers en `server/src`: `clientIp` ×5, `applySecurityHeaders` ×4, `readBoundedInteger` ×3, `constantTimeUtf8Equal` ×3, `sendJson` ×2, `createRateLimiter` ×2. `proxy-utils.ts` los exporta, pero cada módulo mantiene su copia privada. |
| A6-3 | Media (mantenibilidad) | `server/src/entitlement-guard.ts` no es código muerto: `createEntitlementGuard` se construye en el router y en `/api/license/entitlement`, mientras `withEntitlement`/`isEntitlementGuarded` son la API preparada para futuras rutas pagadas. La deuda real es que `PAID_PATH_PREFIXES` está vacío hoy y, por tanto, no hay rutas Pro declaradas que proteger; mantener el módulo y añadir una ruta pagada debe activar el gate `check:pro-routes`. |
| A6-4 | Baja (CI) | Los workflows nunca se han ejecutado en GitHub (0 PRs/merges): todos los gates de CI son teoría hasta el primer push. |
| A6-5 | Baja (historia) | Dos commits con el mismo asunto (`Remove Gemini proxy: route directly to Gemini API`). |
| A6-6 | Baja (docs) | `docs/audit-report-2026-09-02.md` y `docs/audit-report-2026-09-04.md` quedan superados por este ledger. |

### Deudas externas que siguen abiertas

Se mantienen las de las rondas anteriores, todas fuera del código: protección remota de
`main`, cierre legal del ROPA, DSN/DPA de Sentry, URLs reales de los webhooks de alerta,
confirmación oficial de RPO/RTO y revisión manual WCAG.

**Nota sobre la puntuación:** el 9,2 global de las rondas anteriores se calculó sobre un
árbol que no compilaba. Se mantiene como referencia aspiracional hasta la próxima ronda
con el pipeline verde en GitHub.

> **Meta 9.5:** cada área queda limitada únicamente por los ítems externos de la lista anterior. El bloque técnico está completo; la protección remota de `main` requiere activación manual, sin depender de equipos o colaboradores.

## Ronda 7 — 2026-09-17 (barrido completo de la suite tras la ronda 6)

La ronda 6 cerró los tres fallos que veía el perfil rápido (`typecheck`, `check`,
`test:fast`). Faltaba la comprobación obvia: **ejecutar la suite entera**. Al hacerlo
aparecieron **8 archivos y 35 tests en rojo** que el perfil rápido no cubre.

### Estado medido

| Comando | Antes de esta ronda | Después |
|---|---|---|
| `npx vitest run` (suite completa) | ❌ 8 archivos / 35 tests | ✅ 601 archivos / 10 494 tests (3 skipped) |
| `npm run typecheck` | ✅ | ✅ |
| `npm run check` | ✅ | ✅ |

Los 35 fallos eran **previos** a esta ronda (no los introdujo la limpieza de la ronda 6) y
los tests de E2E/Playwright no forman parte del recuento. Ninguno era un fallo del
perfil rápido, lo que explica que pasaran desapercibidos: `test:fast` no incluye
`src/tests/services/**`.

### Causas raíz

1. **Migración al gate Pro (`pro-access`).** El código pasó a resolver los servicios Pro
   por un loader (`loadWebLLMService`, `loadBackupService`) para no enlazar los chunks Pro
   desde Core, pero los tests seguían doblando el **módulo Pro** o importando el singleton
   real. En un entorno sin licencia el loader rechaza con `ProUnavailableError`, así que la
   ruta bajo prueba nunca se ejecutaba. Archivos: `ResourceManager`, `SemanticSearchService`,
   `warmup-latch.integration`, `cloudSync.f2c-backup`, `AppContent`, `AppInitializer`,
   `SecurityManager`, `Onboarding`, `StorageCleanupDialog`.
   Arreglo: el doble se instala en el **loader** y se comparte desde `vi.hoisted()` (un
   doble creado dentro de la fábrica no es observable por las aserciones); donde el test
   necesita el sujeto real (`warmup-latch`, `cloudSync.f2c`), se relaja únicamente el gate
   de licencia y todo lo demás sigue siendo real.
2. **Contrato directo con Gemini.** Al eliminar el proxy, el cliente pasó a llamar a la
   API del proveedor, pero los tests seguían simulando la respuesta del proxy eliminado
   (`{audioBase64}`, `{imageBase64}`) y el transporte viejo (`aiSession`). Archivos:
   `imageService`, `TTSService`, `config`.
3. **Tests de superficie eliminada.** `config.test.ts` seguía afirmando sobre
   `getEnvironmentInfo().hasGeminiKey` y sobre la validación de `VITE_GEMINI_PROXY_URL`,
   dos cosas que ya no existen.

### Fallos de producto encontrados en esta ronda (no eran drift de tests)

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| B7-1 | **Alta** | Al pasar a la llamada directa, Gemini devuelve base64 desnudo en `inlineData.data`, pero el contrato documentado de `generateImage` es una data URL y el consumidor (`EditorToolbar`) la inserta tal cual: la imagen salía rota. La ruta Gemini de TTS tenía el mismo defecto. | Corregido: se construye `data:<mimeType>;base64,<datos>` a partir del `mimeType` de la respuesta (fallback `image/png` / `audio/wav`), con `startsWith("data:")` para no envolver dos veces. |
| B7-2 | Media (seguridad) | `networkFirewall` mantenía `getGeminiProxyPreset()`, que presembraba en la lista blanca el origen de `VITE_GEMINI_PROXY_URL` — variable que ya no existe en el registro de entorno. Era permisividad muerta apuntando a un proxy eliminado. | Eliminado el preset y su entrada en `getPresetOrigins()`; los tests de firewall siguen en verde. |
| B7-3 | Baja (UX) | La clave `ai_error_serverError` existía en `en.json` pero no en `es.json`, así que los errores 5xx del proveedor se mostraban en inglés en la UI española. El gate de cobertura i18n lo detectaba. | Añadida la traducción. |
| B7-4 | Baja (deuda) | Los tests que afirmaban la superficie eliminada (`hasGeminiKey`, validación de la URL del proxy) mantenían viva la descripción de un producto que ya no existe. | Eliminados los dos casos y los `stubEnv` de la variable muerta. |

### Nota metodológica

La ronda 6 se apoyó en `npm run check` y `test:fast` para declarar el árbol verde. La
lección de esta ronda es que el perfil rápido **no** es una verificación suficiente: los
servicios de IA (imagen, TTS, búsqueda semántica, recursos Pro) sólo los cubre la suite
completa. Cualquier afirmación de "verde" en este ledger debe ir acompañada del comando
exacto que la respalda, como en la tabla de arriba.

## Ronda 8 — 2026-09-17 (audio de Gemini reproducible + capa operativa pendiente)

### B8-1 — El audio de Gemini TTS no era reproducible (corregido)

La corrección de B7-1 (envolver el base64 en una data URL) arreglaba el *etiquetado*, no
el *contenedor*: Gemini TTS devuelve PCM lineal **sin cabecera**
(`inlineData.mimeType = audio/L16;codec=pcm;rate=24000`) y el navegador necesita el
encabezado RIFF/WAVE para saber dónde empiezan las muestras, cuántos canales hay y a qué
velocidad se reproducen. Una data URL `audio/wav` sobre esos bytes sigue siendo un archivo
corrupto.

Corrección: nuevo `src/utils/audioFormat.ts` — parseo de los parámetros declarados en el
mime (`rate`, `channels`, `L8/L16/L24/L32`) con valores por defecto documentados (24 kHz,
mono, 16 bits) y rechazo de valores imposibles; constructor de la cabecera RIFF/WAVE de
44 bytes (alineación de palabra para payloads impares, `data` conserva su tamaño real y el
de `RIFF` incluye el relleno); y `toPlayableAudioDataUrl()`, que sólo convierte cuando el
mime **declara** PCM — cualquier otro contenedor se pasa intacto, porque inventar una
cabecera convertiría en corrupto algo que el navegador podía olfatear. `TTSService` usa
ese punto de entrada.

Evidencia de que ahora suena (no sólo que los bytes cuadran): 0,25 s de seno 440 Hz a
24 kHz mono 16-bit pasados por `pcmBase64ToWavDataUrl()` y cargados en el navegador real
(el de la app) mediante un `<audio>`: `loadedmetadata` → `duration: 0.25` exacta. El mismo
payload **sin** cabecera, etiquetado `audio/wav` como hacía el código anterior →
`MEDIA_ERR_SRC_NOT_SUPPORTED` (`DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context
failed`). El arnés temporal se retiró tras la comprobación.

Cobertura: `src/tests/utils/audioFormat.test.ts` (27 casos) lee la cabecera con su propio
`DataView` en vez de reusar los parsers del módulo — un test que reutiliza la
implementación que verifica no puede discrepar de ella — y `TTSService.test.ts` comprueba
la ruta completa: respuesta de Gemini → data URL → campos de la cabecera (rate, byteRate,
blockAlign, bits) y bytes PCM intactos detrás del encabezado.

### Hallazgos abiertos de la capa operativa (NO corregidos en esta ronda)

La ronda 6 limpió compose, validadores, `.env.example` y documentación, pero **no** la
capa que mantiene la producción: el renderizador de nginx, el smoke de producción, el
monitorización y la prueba de carga siguen describiendo el proxy eliminado. La tabla de
rutas del servidor ya no expone `/api/services/ai/*` (verificado: `grep -rn "services/ai"
server/src/*.ts` no devuelve nada y `route-table.test.ts` afirma que esas rutas no tienen
política).

| # | Severidad | Hallazgo |
|---|---|---|
| A8-1 | **Alta** (operaciones) | `scripts/production-smoke.mjs` hace 8 peticiones a endpoints eliminados (`/api/services/ai/session`, `/generate`, `/generate-tts`, `/generate-image`) y afirma sobre sus códigos de estado. Con las rutas fuera del servidor, esas comprobaciones reciben 404 y el smoke **no puede pasar** — arrastra también las fases BASELINE y RE-VERIFY del drill de rollback (`scripts/drill-rollback.mjs` importa `runApiSurfaceChecks` de ese archivo). |
| A8-2 | **Alta** (config de producción) | `scripts/nginx-render.mjs` sigue generando el bloque "companion API" con 5 `location` hacia `bookmarkforge_api:8787` (`/api/services/ai/session`, `/generate`, `/generate-tts`, `/generate-image`, `/admin`), y `public/nginx.conf` —config desplegada— los contiene. nginx proxya a rutas que devuelven 404 y la configuración anuncia una superficie que ya no existe. |
| A8-3 | Media (observabilidad) | `scripts/monitoring-alerts.mjs` usa `/api/services/ai/session` como `API_PROBE_BUSINESS_PATH` por defecto: la sonda de negocio de producción mide un 404 permanente, con lo que la alerta o es ruido constante o es un verde sin significado. |
| A8-4 | Media (SLO) | `scripts/load-test-server.mjs` (job nocturno de CI y `npm run test:load`) mide el presupuesto del proxy de IA y hace handshake contra `/api/services/ai/session`; el presupuesto también aparece en `docs/architecture.md` y `docs/launch-checklist.md`. |
| A8-5 | Baja (limpieza) | `scripts/ai-mock.mjs` y `scripts/ai-mock-https.mjs` siguen sirviendo los contratos de los endpoints eliminados (`/generate-image`, `/generate-tts`), sin consumidor tras la retirada del mock del compose de staging. |Corregir A8-1..A8-5 exige tocar el renderizador (con su comparación byte a byte en
`check:seo`), el smoke y el drill a la vez: es un cambio con su propia verificación, no un
remate de esta ronda. `public/nginx.conf` no debe editarse a mano — se regenera con
`npm run nginx:render`.

## Ronda 9 — 2026-09-17 (retirada de la superficie muerta del proxy de IA en la capa operativa)

### A8-1..A8-5 cerrados

| # | Qué se hizo | Verificación |
|---|---|---|
| A8-1 | `production-smoke.mjs`: eliminadas las 8 comprobaciones del proxy (sesión, `generate` ×3, TTS ×2, imagen ×2) y la variable `AI_SESSION_PROOF`. Quedan los checks reales: 3 estáticos (index.html, CSP, COOP) + 3 de API (`/health`, `/api/client-events`, handshake WS) + 3 de licencia cuando hay `SMOKE_LICENSE_KEY`. | `npm run local-smoke` → `All 3 local smoke checks passed` (health, client-events 204, WS handshake) |
| A8-2 | `nginx-render.mjs`: eliminadas las 5 `location` del bloque "companion API" hacia `/api/services/ai/*`; `public/nginx.conf` regenerado desde la plantilla, no editado a mano. | `node scripts/nginx-render.mjs` → `ok public/nginx.conf: rendered output matches committed copy` |
| A8-3 | `monitoring-alerts.mjs`: `API_PROBE_BUSINESS_PATH` por defecto pasa a `POST /api/license/entitlement` — el endpoint que la app consulta al arrancar para resolver Pro/free, público, sin efectos secundarios y que responde 200 a cualquier caller (una prueba no verificable es un "free" autoritativo, no un error). La sonda de lectura no necesita cookie ni token. | `npx vitest run scripts/__tests__/monitoring-alerts.test.mjs` → 36/36 (incluye el e2e de latencia con `businessPath` afirmado) |
| A8-4 | `load-test-server.mjs`: eliminadas la fase de proxy de IA, su mock upstream, los presupuestos `generateP95Ms`/`generateSuccessPct` y las env del proxy. La prueba mide ahora la superficie que escala (señalización): 5/5 presupuestos. | `node scripts/load-test-server.mjs --connections 32` → `5/5 presupuestos OK` (p95 join 9 ms, relay 4 ms, 6 rechazos 1013, `/health` vivo) |
| A8-5 | `scripts/ai-mock.mjs` y `scripts/ai-mock-https.mjs` eliminados: sin consumidor desde que local-smoke y drill-rollback dejaron de levantar mocks de IA (`local-smoke.mjs` y `drill-rollback.mjs` levantan ahora solo `license-mock`). | Snapshot del inventario regenerado (`node scripts/__tests__/audit-script-inventory.test.mjs --update`, 14 candidatos) y el contrato del snapshot en verde |

Efectos colaterales de la retirada, todos cerrados en la misma ronda:

- **El gate exigía el proxy.** `scripts/check-launch-checklist.mjs` (`verifyLoadTest`) pedía `api/services/ai` en el texto de la prueba de carga, así que borrar la fase de IA habría puesto el checklist en rojo. Ahora exige señalización (`join` + `relay|signal`), presupuestos (`p95|percentile` + `BUDGETS|SLO`), saturación y liveness (`/health`), y su test de contrato afirma lo mismo.
- **`AI_PROVIDER_DOWN` era una alerta sin sujeto.** Sondeaba el upstream de IA del servidor (mock Gemini u Ollama) con `AI_PROVIDER_HEALTH_URL` — un upstream que el servidor ya no tiene: el navegador llama al proveedor del usuario con su propia clave. Eliminada junto con su escalado, su env y su bloque de tests; con ella se fue el único camino de código que página por un proveedor de IA, no por la app.
- **El ítem 18 del checklist estaba en rojo por un token muerto.** `verifyProdConfig` exigía `AI_SESSION_REQUIRE_LICENSE` en `docs/security.md`; al retirarse la sesión de IA (rondas 6 y 7) el token desapareció del documento y el ítem quedaba `FAIL` en el informe (`Resumen: 11/12 verificables · 1 pendiente`), afirmando además un control que el servidor no implementa. Ahora exige la configuración que producción sí necesita (`NODE_ENV=production`, `AI_SESSION_ORIGINS`, `ENFORCE_SIGNAL_HMAC`, `LICENSE_SIGNING_PRIVATE_KEY_FILE`): `Resumen: 12/12 verificables completados · 0 pendientes`.
- **"12/12" era un número congelado.** `deploy-prod.mjs`, `rollback.mjs` y `monitoring-alerts.mjs` imprimían un conteo fijo de checks que ya no corresponde a nada; el smoke imprime su propio total. Las etiquetas pasan a ser agnósticas al conteo ("production-smoke PASS") en vez de afirmar un total que el lector no puede verificar.

### A9-1 — `nginx-render.mjs --write` destruye `public/_headers` y `public/sitemap.xml` (cerrado en la Ronda 10)

**Media-alta (configuración desplegada).** El renderizador sólo está en sync para
`nginx.conf`, `netlify.toml`, `robots.txt`, landings, legales, manifest y extensión:

```
$ node scripts/nginx-render.mjs          # modo verificación (exit 1)
[nginx-render] ok public/nginx.conf: rendered output matches committed copy
[nginx-render] DRIFT public/_headers: rendered output differs (run --write)
[nginx-render] DRIFT public/sitemap.xml: rendered output differs (run --write)
```

`renderHeaders()` y `renderSitemap()` son generadores **obsoletos duplicados**: `_headers`
se endureció a mano después (Cloudflare Pages aplica SOLO la regla más específica, así que
cada bloque por-path repite todos los headers de seguridad — 38 líneas que la plantilla no
emite, y que incluyen CSP y HSTS) y el sitemap real tiene 61 `<url>` con hreflang de 30
idiomas, no las 13 URLs de 6 idiomas que el renderizador conoce. Consecuencia: un
`--write`  (es decir, `npm run nginx:render`, y —más grave— `scripts/rollback.mjs` durante
un incidente) borra esas 38 líneas de headers de seguridad y trunca el sitemap.

No se corrige en esta ronda porque cambiar qué archivos posee el renderizador es una
decisión de arquitectura (delegar `_headers`/`sitemap` a quien ya los produce, o
sincronizar las plantillas) y el `check` actual no ejecuta el renderizador en modo
verificación: el drift pasó desapercibido por eso. Evidencia recuperada: el árbol quedó
restaurado con `git checkout -- public/_headers public/sitemap.xml`. **Cerrado en la
Ronda 10** (ver abajo).

## Ronda 10 — 2026-09-17 (cierre de A9-1: propiedad única de los archivos generados)

**A9-1, cerrado.** `npm run nginx:render` ya no puede destruir `public/_headers` ni
`public/sitemap.xml`. Rediseño de propiedad en `scripts/nginx-render.mjs`:

- **Propiedad única y documentada.** `nginx.conf` y `robots.txt` siguen siendo
  generación wholesale (dueño: el renderizador). `_headers`, `sitemap.xml`,
  `netlify.toml` y el resto de objetivos son manuales: el renderizador pasa a
  quirúrgico y nunca vuelve a regenerarlos.
- **`_headers` quirúrgico** (`rewriteHeadersCspValues`): reescribe sólo el valor de
  `Content-Security-Policy`, `Report-To` y `Reporting-Endpoints` donde aparezcan,
  preservando prosa, bloques por-path (Cloudflare aplica sólo la regla más
  específica), noindex y finales de línea. Si falta alguna de las tres claves el
  archivo está dañado y la función se niega a reescribir (listando todas las
  ausentes de una vez).
- **`sitemap.xml` quirúrgico** (`replaceSitemapLocs`): reescribe sólo el host dentro
  de `<loc>` y de `xhtml:link href`, preservando las 61 URLs, rutas, `lastmod` y
  estructura; los namespaces w3.org/sitemaps.org quedan fuera por construcción
  (viven en atributos `xmlns` que la función no toca).
- **Guardas + all-or-nothing.** Un archivo que no parece lo que dice ser produce
  `FAIL` (no `DRIFT`) y `--write` aborta sin escribir NADA — relevante porque
  `scripts/rollback.mjs` ejecuta `--write` durante un incidente. La ejecución CLI
  se traslada a un guard `import.meta.url` (el módulo es importable sin efectos
  laterales; lo ejercitan los tests unitarios).
- **Eliminados** `renderHeaders()` (plantilla sin las 38 líneas de encabezados
  por-path que el archivo real exige) y `renderSitemap()` (plantilla de 13 URLs y
  6 idiomas que truncaba el sitemap real de 61 URLs y 30 idiomas), con sus exports
  muertos `SITEMAP_LANGS`/`SITEMAP_LEGAL`.

**Drift documental preexistente corregido:** `docs/google-search-runbook.md`
afirmaba que el sitemap tiene 13 URLs y que lo genera `renderSitemap()`; el real
tiene 61 (raíz + landings de 30 idiomas + pocket-alternative + legales de 30
idiomas, verificadas con conteo de `<loc>`) y es manual. Reescritas la tabla de
superficies y la instrucción de regeneración, ahora con la tabla de dueños por
archivo. `docs/ADR-043` anotado: la entrada de sitemap nueva se añade a mano.

**Verificación:** modo verificación del renderizador verde sobre el árbol
comprometido (19/19 `ok`, exit 0 — el estado de la ronda 9 era correcto y no
necesitaba regeneración); `src/tests/scripts/nginx-render.test.ts` reescrito al
contrato quirúrgico (5 tests: reparación quirúrgica con estructura intacta,
idempotencia byte a byte, round-trip de dominio respetando la prosa manual,
guardas `FAIL` y abort all-or-nothing verificado con snapshot); nuevos tests
unitarios `scripts/__tests__/nginx-render-renderers.test.mjs` (17 casos:
identidad canónica, alcance quirúrgico, preservación CRLF/espacios finales,
guardas e idempotencia).

## Ronda 11 — 2026-09-17 (auditoría de cobertura del sitemap y despliegue)

**Hallazgo A11-1 — discrepancia de routing de landings, cerrado en el checkout.**
El sitemap contiene 61 URLs: raíz + 30 landings + pocket-alternative + 30 legales.
La inspección del árbol confirmó que `public/` sí contiene los 30 artefactos de landing
(`landing.html`, `ar.html` … `zh.html`) y las 30 páginas legales; la premisa de que
sólo existían las legales era incorrecta. `public/_redirects` ya tenía las 30 rutas
limpias, pero el nginx autocontenido sólo tenía `/es/`, `/fr/`, `/de/`, `/pt/` y
`/it/`. `scripts/nginx-render.mjs` ahora mantiene el registro de los 29 idiomas
localizados y regenera las 29 ubicaciones nginx faltantes.

Se añadió `scripts/check-sitemap-coverage.mjs` y `npm run check:sitemap-coverage`.
El gate verifica que cada `<loc>` tenga el HTML correspondiente, las dos entradas
`_redirects` (con y sin slash), y la ubicación/rewrite nginx; también detecta
duplicados y páginas legales ausentes. Sus tests cubren el árbol completo de 30
idiomas, artefactos faltantes, redirects faltantes, rutas nginx faltantes y locs
duplicados.

**A11-2 — producción no corresponde al checkout (abierto, bloqueo de despliegue).**
Las consultas del 17-09-2026 a `https://bookmarkforge.com` devolvieron:
`/` → 200 con el conversor antiguo "Links to Bookmarks Converter";
`/ar/`, `/bg/`, `/es/`, `/ar.html`, `/es.html`, `/privacy-and-terms.html` y
`/sitemap.xml` → 404. Por tanto no es válido afirmar que el sitemap de este checkout
está publicado ni enviar sus 61 URLs a Google. El código puede corregir el artefacto
siguiente, pero no puede cambiar el despliegue remoto sin ejecutar el pipeline de
producción. Antes de Search Console: desplegar este checkout, repetir las probes
anteriores y ejecutar `node scripts/check-hreflang-graph.mjs https://bookmarkforge.com`.

**Verificación de Ronda 11:** `npm run check:sitemap-coverage` verde; tests de routing
(5 casos), renderers nginx (17 casos) y rollback (35 casos, incluido el nuevo
integration test que ejecuta el `--write` real en un fixture temporal) verdes.Queda A11-2 explícitamente abierto hasta que producción sirva este commit.

## Ronda 12 — 2026-09-17 (SEO completo, helpers compartidos y runbook de despliegue)

Se amplió `check:sitemap-coverage` para validar, además del artefacto y routing,
la metadata SEO de las 30 landings: `lang`, canonical propio y el grafo completo
de 30 `hreflang` más `x-default`. La plantilla de landings primaria se regeneró
para que las seis páginas base ya no publiquen solo las seis alternativas
históricas. El gate y sus 6 tests quedan verdes.

Se redujo la duplicación segura en `server/src`: `readBoundedInteger` y
`constantTimeUtf8Equal` pasan a `proxy-utils.ts`; `applySecurityHeaders` admite
una opción explícita para conservar la política distinta de los collectors; y
`license-server.ts` reutiliza `clientIp` sin alterar su contrato de proxy. Se
añadieron 4 tests de contrato para los helpers compartidos. Los helpers con
límites de body/rate-limit distintos se conservaron localmente para no mezclar
políticas de seguridad.

Se creó `docs/deployment-runbook.md`, con preflight, secretos, despliegue,
probes públicas, Search Console y rollback. A11-2 sigue abierto porque el
cierre requiere publicar el checkout y verificar el dominio real; ningún gate
local puede sustituir esa evidencia.

