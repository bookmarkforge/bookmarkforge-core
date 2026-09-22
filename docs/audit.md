# Auditoría técnica — BookmarkForge (ledger verificable)

- **Última verificación ejecutada:** 2026-09-22, sobre el working tree en la rama `release/v1.0.0`.
- **Alcance:** auditoría estática de código, configuración, CI y documentación. No incluye pentest, prueba de carga en producción ni revisión legal formal.
- **Regla del documento:** cada afirmación lleva el comando que la respalda y el observable esperado. Si una afirmación no puede reproducirse desde este checkout, se declara explícitamente como ejecución histórica o deuda externa — no se afirma. No hay puntuaciones: un número de 0 a 10 no es reproducible y las rondas 6–7 de este mismo ledger demostraron que un "9.2 global" se llegó a calcular sobre un árbol que no compilaba.

## Estado verificado (2026-09-22)

| Comando | Observable en esta fecha |
|---|---|
| `npm run check` | exit 0 (cadena completa de ~97 gates `check:*`) |
| `npm run test:fast` | exit 0 · 163 archivos de test |
| `npm run lint` | exit 0 |
| `npm run typecheck` | **exit 2** — 3 errores, todos en specs sin trackear de `src/tests/human-like/examples/` (WIP ajeno a este árbol entregable; ver "Deudas abiertas") |
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| `node scripts/check-page-figures.mjs` | `ok: 61 pages agree with code (freeCap=1000, devices={0,3}, prices=59/79, refund=30d, revalidation=48h, recovery=24w)` |
| `npm run check:launch-checklist` | `Resumen: 12/12 verificables completados · 0 pendientes · 5 manuales` |

> **Nota:** `check:launch-checklist` solo examina el checkout. La producción puede servir un artefacto más antiguo que este árbol (ver A11-2). Este es el motivo por el que `scripts/check-sitemap-coverage.mjs` es un gate de repositorio y no una sonda HTTP.

## Superficie viva (instantánea)

| Afirmación | Verificación (comando → observable) |
|---|---|
| Stack: React 19 + TS estricto + Vite; RxDB 17 + IndexedDB; Node ≥20 + `ws`; Mantine 9 | `node -e "const p=require('./package.json'); console.log(p.dependencies.react, p.dependencies.rxdb, p.dependencies['@mantine/core'], p.devDependencies.typescript)"` → `^19.2.8 ^17.4.0 ^9.5.1 ^5.9.3`. `197` scripts npm en total |
| Cripto: AES-256-GCM + Argon2id/HKDF en Web Worker; borrado de memoria WASM | `ls src/utils/crypto-core.ts src/utils/argon2-kdf.ts src/services/EncryptionService.ts src/utils/wasm-zero-memory.ts` → los 4 existen |
| Sanitización centralizada | `grep -rln "DOMPurify" src/services/SanitizationService.ts` → 1 match |
| HSTS presente en `_headers` (incluidos los bloques por-path) | `grep -c "Strict-Transport-Security" public/_headers` → `5` |
| Sitemap con 61 URLs (raíz + 30 landings + pocket + 30 legales) | `grep -c "<loc>" public/sitemap.xml` → `61` |
| Superficie muerta del proxy de IA retirada del servidor y de la API doc | `grep -rn "services/ai" server/src/*.ts \| wc -l` → `0` · `grep -c "services/ai" docs/openapi.yaml` → `0` · `grep -m1 "openapi:" docs/openapi.yaml` → `openapi: 3.1.0` |
| Server sin `ai-proxy.ts`; helpers compartidos en `proxy-utils.ts` | `ls server/src/ai-proxy.ts` → no existe · `ls server/src/proxy-utils.ts` → existe |
| Mocks de IA eliminados | `ls scripts/ai-mock.mjs scripts/ai-mock-https.mjs` → ambos inexistentes |
| 11 workflows, todas las actions externas pineadas por SHA-256 de 40 chars | `ls .github/workflows/*.yml \| wc -l` → `11` · `grep -rcE "uses: [^@]+@[0-9a-f]{40}" .github/workflows/*.yml` → cada fichero ≥1 y `grep -rnE "uses: [^@]+@v[0-9]" .github/workflows` → sin resultados |
| ZAP pineado por SHA | `grep -n "zaproxy/action-baseline" .github/workflows/dast-nightly.yml` → `@de8ad967d3548d44ef623df22cf95c3b0baf8b25` |
| Compose prod: imágenes por `IMAGE_TAG` (no hay tags mutables de base que pinear en ese fichero) | `grep -c "@sha256" docker-compose.prod.yml` → `0`; las líneas `image:` son `bookmarkforge/web:${IMAGE_TAG:?…}` / `bookmarkforge/api:…`. `grep -c "@sha256" docker-compose.staging.yml` → `1`. Gate: `npm run check:image-pins` → exit 0 |
| Dockerfile: el stage `deps` elimina el hook `prepare` antes de `npm ci --omit=dev` | `sed -n '9,15p' Dockerfile` → `npm pkg delete scripts.prepare && npm ci --omit=dev` |
| Presupuestos de cifras vigilados en 61 superficies | `node scripts/check-page-figures.mjs` → `ok: 61 pages agree with code` (ver tabla de estado) |
| Smoke de producción sin endpoints muertos | `node scripts/local-smoke.mjs` → pasa (3 checks estáticos + health + client-events + WS) · `grep -c "services/ai" scripts/production-smoke.mjs` → `0` |
| Prueba de carga mide la superficie actual (señalización, no proxy IA) | `grep -n "load-test" .github/workflows/nightly.yml` → job `load-test` con `node scripts/load-test-server.mjs --connections=50 --json` · `grep -c "services/ai" scripts/load-test-server.mjs` → `0` |
| Alertas: webhooks documentados, sonda de negocio sobre endpoint vivo | `grep -c "DRILL_ALERT_WEBHOOK_URL\|ANALYTICS_ALERT_WEBHOOK_URL" .env.example` → `2` · `grep -n "API_PROBE_BUSINESS_PATH" scripts/monitoring-alerts.mjs` → `POST /api/license/entitlement` |
| Registro de idiomas con fuente única (30 locales) | `grep -rln "landing-registry" scripts functions` → los consumidores derivan del registro; `npm run check:seo` → exit 0 (`302 to all 29 localized landings`) |

## Ledger histórico de hallazgos

Formato: cada fila conserva el hallazgo y la **evidencia verificable hoy** (comando → observable esperado). "Corregido" significa que el observable se cumple en este checkout; no es una afirmación sobre ejecuciones pasadas de CI (ver "Lo que este documento no afirma").

### App y producto

| ID | Hallazgo (estado original) | Evidencia verificable |
|---|---|---|
| B1 | **Consentimiento RGPD roto:** `AnalyticsService`, `errorReporter` y `clientEventReporter` leían la key legacy `bmf_local_error_storage` en vez de las keys del `ConsentBanner` (`forge_consent_*`); la elección del usuario no tenía efecto | `grep -rln "forge_consent_analytics" src --include="*.ts"` → `src/constants/storage-keys.ts`, `src/services/AnalyticsService.ts`, `src/services/analyticsForwarder.ts` (key única compartida). Tests: `npx vitest run src/tests/error-logging/errorReporter.test.ts` → 45 passed |
| B2 | **Complemento del anterior:** el toggle de telemetría en `SecuritySection.tsx` escribía en la key legacy y no sincronizaba con los servicios | `npx vitest run src/tests/components/settings/SecuritySection.test.tsx` → en verde; el test afirma la escritura en las keys `forge_consent_*` y la limpieza de las legacy |
| B3 | **Notificaciones SRS nunca entregadas:** `await navigator.serviceWorker.ready` cuelga para siempre sin SW registrado; el fallback `new Notification()` era inalcanzable | `sed -n '89,95p' src/services/NotificationService.ts` → usa `getRegistration()` (resuelve `undefined`) con fallback. `npx vitest run src/tests/services/NotificationService.test.ts` → en verde, incluida la ruta sin registro |
| B4 | **TTS/imagen de Gemini rompían el contrato:** base64 desnudo vs data URL esperada (B7-1), y el PCM de TTS sin cabecera RIFF/WAVE era un archivo corrupto aunque el mime dijera `audio/wav` (B8-1) | `ls src/utils/audioFormat.ts` → existe; `grep -n "toPlayableAudioDataUrl" src/services/ai/TTSService.ts` → usado en la ruta de TTS. `npx vitest run src/tests/utils/audioFormat.test.ts` → 27 passed (los tests leen la cabecera con su propio `DataView`, no reusan los parsers del módulo) |
| B5 | Claves i18n incompletas (`ai_error_serverError` ausente en español: errores 5xx en inglés en la UI española) | `grep -c "ai_error_serverError" public/locales/es.json public/locales/en.json` → `1` en ambas |
| B6 | Permisividad muerta en el firewall: `getGeminiProxyPreset()` presembraba el origen de `VITE_GEMINI_PROXY_URL`, variable ya retirada | `grep -rn "getGeminiProxyPreset" src --include="*.ts"` → 0 matches |
| B7 | Tests que afirmaban superficie eliminada (`hasGeminiKey`, validación de la URL del proxy) mantenían viva la descripción de un producto que ya no existe | `grep -rn "hasGeminiKey" src --include="*.ts" --include="*.tsx" \| grep -v test` → 0 matches |
| B8 | Catch silencioso en `useRxDB` (errores de query ocultos devolviendo `[]`) y en smart-links de `useBlockEditorLogic` | `grep -n "logger.warn" src/hooks/useRxDB.tsx` → línea 89 · `grep -n "logger.warn" src/components/block-editor/useBlockEditorLogic.ts` → líneas 395 y 464 |
| B9 | E2E de primer arranque colgaba por KDF Argon2id con parámetros de escritorio en el webServer de Playwright | `sed -n '92,97p' playwright.config.ts` → el webServer lanza Vite con `--mode test` (activa `ARGON2_PARAMS_TEST`) |
| B10 | Accesibilidad automatizada | `ls tests/e2e/a11y.spec.ts` → existe (axe-core en E2E). La revisión **manual** WCAG sigue pendiente y es deuda externa a este repo |

### Infraestructura y supply-chain

| ID | Hallazgo (estado original) | Evidencia verificable |
|---|---|---|
| A1 | DAST nocturno sin pin SHA y con digest placeholder de la imagen ZAP | `grep -n "zaproxy/action-baseline" .github/workflows/dast-nightly.yml` → SHA de 40 chars; `grep -c "REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST" .github/workflows/*.yml` → 0 |
| A2 | Actions de GitHub por tag mutable (`@v4`) en 7 workflows | `grep -rnE "uses: [^@]+@v[0-9]" .github/workflows` → sin resultados; gate `npm run check:workflows` → exit 0 (exige pin por SHA de 40 chars a toda action externa) |
| A3 | Imágenes Docker por tag mutable | `grep -c "@sha256" docker-compose.staging.yml` → `1`; en prod las imágenes llegan por `IMAGE_TAG`. Gate: `npm run check:image-pins` → exit 0. *Nota honesta:* la fila histórica afirmaba "todas pineadas por digest" para un compose que hoy construye por `IMAGE_TAG`; el gate vigente es la fuente |
| A4 | Falsos positivos en validadores (`validate-workflows` con refs locales, `validate-runtime-config` con CRLF/bloques `command:`) | `npm run check:workflows` y `npm run check:runtime-config` → exit 0 (los validadores llevan los arreglos; sus tests de contrato van en `test:fast`) |
| A5 | Fuga de dominio: `exporter.formatters.ts` y `security.txt` usaban `bookmarkforge.app`; `security.txt` con email no documentado | `grep -rln "bookmarkforge\.app" src server public` → sin resultados · `grep "Contact" public/.well-known/security.txt` → `mailto:bookmarkforge@proton.me` |
| A6 | `Permissions-Policy` del servidor sin `interest-cohort=()` | `grep -n "interest-cohort" server/src/ai-proxy.ts` → el archivo ya no existe; el header vive en la capa de headers actual (`npm run check:csp` → exit 0) |
| A7 | Staging: `AI_SESSION_ORIGINS` hardcodeada a un puerto → 403 `CSRF_ORIGIN` con `HTTP_PORT` no estándar | `grep -n "HTTP_PORT" docker-compose.staging.yml` → interpolación `http://127.0.0.1:${HTTP_PORT:-18080}` |
| A8 | Redis desplegado en producción sin consumidor (resto de la retirada del proxy de IA) | `grep -c "AI_PROXY_REDIS_URL" docker-compose.prod.yml` → `0` |
| A9 | El renderer de nginx destruía `_headers` y `sitemap.xml` con `--write` (plantillas obsoletas duplicadas) | Propiedad única rediseñada (Ronda 10): `npx vitest run src/tests/scripts/nginx-render.test.ts` → 5 passed (reparación quirúrgica, idempotencia byte a byte, guardas FAIL, abort all-or-nothing); `npx vitest run scripts/__tests__/nginx-render-renderers.test.mjs` → en verde; `npm run check:nginx-render` → exit 0 |
| A10 | Smoke/monitor/load-test apuntando a endpoints eliminados (`/api/services/ai/*`) | `grep -c "services/ai" scripts/production-smoke.mjs scripts/load-test-server.mjs` → `0` en ambos · `grep -n "API_PROBE_BUSINESS_PATH" scripts/monitoring-alerts.mjs` → `POST /api/license/entitlement`; `npx vitest run scripts/__tests__/monitoring-alerts.test.mjs` → en verde |
| A11 | Conteos congelados ("12/12") impresos por `deploy-prod`/`rollback`/`monitoring-alerts` | `grep -n "production-smoke PASS" scripts/deploy-prod.mjs` → etiqueta agnóstica al conteo (sin número fijo) |
| A12 | El checklist exigía `AI_SESSION_REQUIRE_LICENSE` (control que el servidor ya no implementa) → ítem en rojo permanente | `npm run check:launch-checklist` → `12/12 verificables · 0 pendientes` (ver tabla de estado) |

### Operaciones y CI (drills, KPIs, carga)

| ID | Hallazgo (estado original) | Evidencia verificable |
|---|---|---|
| O1 | `nightly.yml` invocaba un script inexistente con args inválidos en el job de carga | `grep -n "load-test" .github/workflows/nightly.yml` → `node scripts/load-test-server.mjs --connections=50 --json` (script y args reales) |
| O2 | Sin simulacro trimestral en CI; el drill de backup-restore solo corría en el ensayo trimestral | `grep -n "rollback-docker\|backup-restore" .github/workflows/drill-quarterly.yml` → jobs presentes · `grep -n "drill-backup-restore" .github/workflows/nightly.yml` → job mensual (cron día 1) con alerta de degradación de RTO |
| O3 | Sin gate nocturno de KPIs de negocio (DAU/WAU/MAU sin vigilancia) | `grep -n "kpi-staging" .github/workflows/nightly.yml` → job presente · `ls scripts/__tests__/kpi-report.test.mjs` → existe |
| O4 | El collector de analítica solo se validaba contra staging | `grep -n "kpi-collector-local" .github/workflows/drill-quarterly.yml` → job que valida el pipeline contra un servidor local, sin secretos ni red externa |
| O5 | Build de imagen del tag previo roto para el drill de rollback (hook `prepare` fallaba en `npm ci --omit=dev`) | `sed -n '11,15p' Dockerfile` → `npm pkg delete scripts.prepare` antes de `npm ci --omit=dev`. *Nota:* la fila histórica atribuía el arreglo a `--ignore-scripts`; el mecanismo actual es el `npm pkg delete` (el stage `build` necesita sus postinstalls) |
| O6 | El drill de rollback Docker levantaba un stack incompleto (redis ausente) | Obsoleto por A8: el redis ya no existe en ninguna compose; `scripts/drill-rollback.mjs` levanta license-mock + companion server. *La ejecución PASS documentada (2026-08-31) fue evidencia de ejecución sobre ese estado anterior — no reproducible desde este checkout sin Docker y tags `prod-*`* |
| O7 | Carga: presupuestos del proxy IA sin sujeto | `grep -c "services/ai" scripts/load-test-server.mjs` → `0`; mide señalización (join/relay p95, saturación, `/health`) |

### Drift de verificación (las rondas 6–8)

La lección estructural de este ledger: el código evolucionó (retirada del proxy de IA, gate Pro por loader) y sus verificaciones siguieron describiendo la versión anterior. `npm run check` y `test:fast` daban verde mientras `npx vitest run` (suite completa) tenía 8 archivos y 35 tests en rojo.

| ID | Hallazgo | Evidencia verificable |
|---|---|---|
| D1 | Test que colgaba E2E en el webServer (ver B9) | `sed -n '92,97p' playwright.config.ts` |
| D2 | OpenAPI documentando 6 endpoints inexistentes; docs describiendo un proxy eliminado; `docs/audit.md` citando `server/src/ai-session.ts` (archivo borrado) | `grep -c "services/ai" docs/openapi.yaml` → `0` · `ls server/src/ai-proxy.ts server/src/ai-session.ts` → inexistentes |
| D3 | Compose y validadores **exigiendo** infraestructura muerta (redis en prod, `ai-mock` en staging) | `grep -c "AI_PROXY_REDIS_URL" docker-compose.prod.yml` → `0` · `ls scripts/ai-mock.mjs` → no existe · `npm run check:compose-config && npm run check:runtime-config` → exit 0 (con guarda que falla si reaparece config de IA sin lector) |
| D4 | Tests doblando el módulo Pro en vez del loader (`loadBackupService`/`loadWebLLMService`); respuesta simulada del proxy eliminado | `npm run test:fast` → exit 0 (163 archivos) |
| D5 | Dos commits con el mismo asunto (higiene de historia) | `git log --format=%s \| sort \| uniq -d` → `Remove Gemini proxy: route directly to Gemini API` (registrado, no corregible sin reescritura) |

### Deuda de mantenibilidad declarada (no corregida, medible)

| ID | Hallazgo | Verificación |
|---|---|---|
| M1 | Duplicación residual de helpers en `server/src` pese a `proxy-utils.ts` | `grep -rc "function clientIp" server/src --include="*.ts"` → 4 ficheros con copia (`business-analytics`, `client-events`, `index`, `proxy-utils`). Criterio declarado: los helpers con límites de body/rate-limit distintos se conservan localmente a propósito |
| M2 | `PAID_PATH_PREFIXES` vacío: el gate `check:pro-routes` está cableado pero no hay rutas Pro declaradas | `grep -n "PAID_PATH_PREFIXES" server/src/route-table.ts` → `= []` · `npm run check:pro-routes` → exit 0 (`11 routes classified, 16 dispatched, 0 entitlement-gated`). Añadir la primera ruta pagada debe activar el gate |
| M3 | Clasificación legal del proveedor de IA con BYO-key (tercero del usuario vs encargado del operador) | Decisión legal pendiente, anotada en el ROPA/paquete legal; no reescribible sin asesoramiento (deuda externa) |

## Deudas abiertas

Verificables desde el repo:

1. **`npm run typecheck` en rojo** (3 errores) por specs sin trackear de `src/tests/human-like/examples/` (`advanced-avatars-tests.spec.ts`, `aria-texts-tests.spec.ts`). Son WIP de otro frente, no parte del árbol entregable; el estado se re-evalúa cuando esos ficheros entren o desaparezcan. Comando: `npm run typecheck`.
2. **A11-2 — producción no corresponde al checkout.** Sondas del 2026-09-22: `curl -s -o /dev/null -w "%{http_code}" https://bookmarkforge.com/…` → `/` = 200; `/ar/`, `/es/`, `/sitemap.xml`, `/privacy-and-terms.html` = **404**. No es válido afirmar que el sitemap de este checkout está publicado ni enviar sus 61 URLs a Search Console. Cierre: desplegar este checkout, repetir las sondas y correr `node scripts/check-hreflang-graph.mjs https://bookmarkforge.com`.
3. **M1/M2** (tabla anterior): duplicación de helpers declarada y rutas Pro sin declarar — ambas con comando de medición.

Deudas declaradas **no verificables desde el repo** (se listan para que existan; ninguna puede cerrarse con código):

- Importación del ruleset en GitHub: `.github/rulesets/main-protection.json` existe en el checkout (`ls .github/rulesets/main-protection.json`), pero su activación en el remoto es una acción externa y **este documento no afirma nada sobre el estado real de protección de la rama remota**.
- DSN de Sentry + DPA firmado (ROPA §7) para activar el reporte remoto opt-in.
- URLs reales de los webhooks de alerta (`ANALYTICS_ALERT_WEBHOOK_URL`, `DRILL_ALERT_WEBHOOK_URL`) y sus secretos en GitHub.
- RPO/RTO objetivos firmados (los drills miden RTO empírico con gates; el objetivo oficial es una decisión organizativa).
- Revisión manual WCAG (la automatizada va en E2E: `tests/e2e/a11y.spec.ts`).
- ROPA: `grep -c "⚠ COMPLETAR" docs/ROPA.md` → **0** en esta fecha (el inventario ya no tiene campos marcados sin completar; la confirmación legal formal sigue siendo externa).

## Lo que este documento ya no afirma

Retirado por no sostenible desde el repositorio:

- **Puntuaciones por área y global** (8.6 → 9.2 → "meta 9.5"): subjetivas y no reproducibles; la ronda 6 demostró que el 9.2 se calculó sobre un árbol que no compilaba. Un lector que quiera una valoración tiene los comandos de la tabla de estado.
- **Filas de "Protección de main: ✅"**: un JSON local no afirma nada sobre el estado de la rama remota. Se sustituye por el observable del fichero local y la deuda externa de su importación.
- **"Repositorio de mantenedor único"** como afirmación de gobernanza: sustituida por datos observables — `git shortlog -sn HEAD` (4 identidades de commit), `git log --merges \| wc -l` → `0`, 0 PRs/merges en el historial. Sin afirmaciones sobre revisiones, equipos ni responsabilidades.
- **Conteos heredados** ("11/13", "633 tests", "~70 scripts"): sustituidos por el output del gate en la fecha de verificación; el número vivo es el que imprime el comando.

## Lo que este documento no puede probar

- Que los workflows de GitHub se hayan ejecutado alguna vez (no hay PRs ni merges en el historial): todo gate de CI es teoría hasta el primer push. Comando de contexto: `git log --merges --oneline \| wc -l` → `0`.
- Ejecuciones históricas (drill Docker PASS del 2026-08-31, primer run del smoke, E2E en navegador real): son evidencia de ejecución registrada en `docs/operations.md` y en este ledger como historia; **no** se re-ejecutan desde este checkout sin Docker, tags `prod-*` o despliegue.
- Comportamiento en producción (ver A11-2): ningún gate local sustituye las sondas contra el dominio real tras un despliegue.

## Metodología

1. Toda fila del ledger se re-verificó contra el working tree antes de conservarse; las que ya no se sostenían se corrigieron hacia el observable real (A3, O5, O6, B5) o se retiraron.
2. Los comandos se ejecutaron el 2026-09-22 en Windows (Git Bash); los observables son texto de salida o códigos de exit, no interpretaciones.
3. La clasificación vive en este fichero; los gates viven en `scripts/check-*.mjs`. Cuando una afirmación depende de un gate, el gate manda sobre este documento.
4. Próxima actualización: re-ejecutar la tabla de estado y las sondas de A11-2 tras el próximo despliegue; cualquier fila nueva de hallazgo entra con su comando o no entra.
