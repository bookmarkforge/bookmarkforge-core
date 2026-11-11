# Revisión completa y plan de trabajo — BookmarkForge

**Fecha:** 11 de noviembre de 2026
**Base revisada:** `main` limpio en `9412550` (`Add Free/Pro tier summary to landing and document commercial runbooks`), árbol privado `bookmarkforge-core-4`.
**Alcance:** código de aplicación (`src/`), servidor de señalización (`server/`), funciones serverless (`api/`), extensión MV3, topología de despliegue (Docker/nginx/Netlify/Vercel/CSP), Open Core, documentación de estado y cadena de puertas de calidad — ejecutando las puertas reales, no solo leyéndolas.
**Naturaleza:** revisión estática + verificación local. **No** es un pentest, ni una auditoría de la infraestructura desplegada, ni una ejecución E2E.

---

## 1. Veredicto

El núcleo del producto está en buen estado y las afirmaciones de seguridad se sostienen al leer el código: sobre `9412550`, **typecheck (prod y server), lint, `npm run check` (6/6) y `build:ci` están verdes**, el escaneo de secretos y el de fronteras de capas dan cero, `npm audit --omit=dev` da cero vulnerabilidades y los 30 locales están completos.

Pero **la suite rápida no está verde**: `npm run test:fast` sale con **código 1** por un pin de conteo en `check-landing-smoke`. Y el fallo no es cosmético: expone una clase de deriva que la propia puerta de documentación no vigila (la tabla «Live surface» de `docs/audit.md` publica cifras que el árbol ya no produce). Es exactamente el patrón «gate verde, documento mintiendo» que el proyecto dice perseguir.

Prioridad real, en una frase: **reparar el pin y el documento (P0), cerrar los tres huecos operativos que siguen abiertos desde la auditoría del 5 de noviembre (CSP en hosts estáticos, compose engañoso, tests fuera de typecheck) y sincronizar los documentos de estado con el árbol.**

### Conteo de hallazgos

| Severidad | Nº |
|---|---:|
| P0 — bloquea la afirmación «suite verde» | 1 (resuelto el 11-11-2026, ver §3) |
| P1 — alto (operabilidad/integridad de la señal) | 3 (los tres resueltos el 11-11-2026) |
| P2 — medio (deuda verificable, riesgo de deriva) | 9 (P2-9 resuelto el 11-11-2026) |
| P3 — bajo / informativo | 5 |

---

## 2. Evidencia ejecutada (11-11-2026, sobre `9412550`)

| Comando | Resultado | Observable |
|---|---|---|
| `npm run typecheck:prod` | **PASS** (exit 0) | `tsc --noEmit -p tsconfig.prod.json` |
| `npm run typecheck:server` | **PASS** (exit 0) | `tsc --noEmit -p tsconfig.server.json` |
| `npm run lint` | **PASS** (exit 0) | 1.813 archivos en 20 lotes, heap acotado 1.536 MiB |
| `npm run check` | **PASS** (exit 0) | 6/6 gates en 43,8 s (security 9,2 s · chunks · tooling-deps · content 30,4 s · brand · build) |
| `npm run test:fast` | **PASS** (exit 0) | `all 193 test files passed in 110746ms`, `[test-timing] OK — 187 file(s) within budgets` (192 archivos antes de los dos cambios de esta ronda) |
| `check:compose-config` · `check:csp` · `check:spa-routes` · `nginx-render` | **PASS** | hardening de compose + regla de variables huérfanas · ambos colectores presentes · los 4 host configs coinciden · copias renderizadas idénticas |
| `npm run build:ci` | **PASS** (exit 0) | entry 586 KiB / 768 KiB · precache 7,12 MiB / 10 MiB · 355 chunks · feature budgets 14/14 |
| `node scripts/check-context-boundaries.cjs` | **PASS** | `0 cross-layer imports, 0 allowlisted, 0 new violations` |
| `node scripts/check-secrets-in-commit.mjs` | **PASS** | 2.270 archivos enumerados, **0 secretos** |
| `node scripts/i18n-completeness.mjs` | **PASS** | 30 locales, **0/1.889 untranslated**; 1.600 claves estáticas + 4 patrones dinámicos presentes en `en.json` |
| `node scripts/check-audit-freshness.mjs` | **PASS** | 7 filas: 4 verificadas, 3 omitidas (`deep` / `network`) |
| `npm audit --omit=dev --audit-level=high` | **PASS** | `found 0 vulnerabilities` |

**Conclusión de la evidencia:** la cadena de calidad está bien construida y pasa; el único rojo es el pin de la landing. Todo lo demás de este documento es deuda verificable o riesgo de deriva, no un fallo de build.

---

## 3. Hallazgos

### P0-1 — (RESUELTO 11-11-2026) `test:fast` en rojo: el pin de enlaces internos de las landings quedó atrás

**Evidencia**

```
FAIL scripts/__tests__/check-landing-smoke.test.mjs > the counts the audit ledger publishes > sees 96 internal links across the 31 pages
AssertionError: expected 97 to be 96
 ❯ scripts/__tests__/check-landing-smoke.test.mjs:296:24
     296|     expect(links.size).toBe(96);
```

- El árbol real produce **97** enlaces internos únicos sobre las 31 landings (30 locales + `pocket-alternative`).
- El pin espera **96**.
- `docs/audit.md` publica **93** («93 internal link(s)»).
- El enlace nuevo es `/app?demo=true`, introducido por `50d9ee6` («…add demo-mode exit»), el mismo commit que añadió la CTA de demo a la landing sin actualizar el pin ni el documento.

**Por qué importa:** `test:fast` es la puerta que CI ejecuta en cada PR y la que `docs/PENDIENTES.md` (P-02/P-08) declara verde. Un rojo aquí invalida la afirmación «candidato listo» y, si se ignora, acostumbra al equipo a un perfil rojo.

**Qué hacer**

1. Actualizar el pin a 97 en `scripts/__tests__/check-landing-smoke.test.mjs:296` y corregir el comentario del bloque (63 → 93 → 96 → **97**, citando `/app?demo=true`).
2. Corregir `docs/audit.md` (fila «Landings smoke in a real browser»): `93` → `97` internal links.
3. Re-ejecutar: `npm run test:fast` (exit 0) y `node scripts/check-audit-freshness.mjs`.
4. **Mejora estructural (recomendada):** derivar el número del propio gate en lugar de fijarlo. El test ya calcula `links.size`; el documento debería leerlo igual que `check-page-figures` lee las cifras del código. Mientras siga siendo un literal, cada CTA nueva rompe CI.

**Criterio de cierre:** `npm run test:fast` exit 0 y `grep -c "97 internal links" docs/audit.md` coherente con el árbol.

**Remediación aplicada (11-11-2026):**

- `scripts/__tests__/check-landing-smoke.test.mjs:290,296` — pin y título del test actualizados a 97; el comentario del bloque documenta que el enlace nuevo es `/app?demo=true` y conserva la genealogía 63 → 93 → 96 → 97.
- `docs/audit.md:52` — `93 internal link(s)` → `97 internal link(s)`.
- Verificado: `npm run test:fast` **exit 0**, `all 192 test files passed` (103 s), `[test-timing] OK — 186 file(s) within budgets`; `check:audit-freshness`, `check:docs-markdown`, `check:no-spanish` y `check:documented-doc-references` exit 0.
- Queda pendiente la **mejora estructural** (derivar la cifra en vez de fijarla), que evita la próxima rotura por una CTA nueva.

---

### P1-1 — (RESUELTO 11-11-2026) La tabla «Live surface» estaba congelada y ninguna puerta la vigilaba

**Evidencia** (todas verificadas hoy)

| Afirmación publicada | Árbol real |
|---|---|
| `→ 199 npm scripts total` | **149** |
| `10 workflows` | **12** (`ls .github/workflows/*.yml \| wc -l`) |
| `Sitemap with 61 URLs` | **37** (`grep -c "<loc>" public/sitemap.xml`) |
| `Node ≥24` | `engines.node: ">=22.0.0"` (Node local v26.12.1) |

**Causa raíz:** `scripts/check-audit-freshness.mjs` solo parsea la sección `## Verified status` (`SECTION_RE` en la línea 80) y valida las filas de esa tabla. La sección `## Live surface (snapshot)` —que es la que contiene las cifras anteriores— **no se lee en absoluto**, así que la puerta pasa mientras el documento afirma cifras que ya no existen.

**Por qué importa:** `docs/audit.md` es el registro de evidencia del proyecto y la fuente de varias afirmaciones comerciales/compliance. Una cifra obsoleta en una tabla «verificable» es peor que una ausencia: se cita como prueba.

**Qué hacer**

1. Corregir las cuatro cifras (149 scripts, 12 workflows, 37 URLs, `Node ≥22` o subir `engines` a `>=24` de forma deliberada).
2. Extender `check-audit-freshness` para validar también las filas de `## Live surface`, con el mismo mecanismo `self`/`exec`: cada fila debe declarar un comando y una derivación, y fallar si el observable no coincide.
3. Añadir un test de la propia puerta (mutar una cifra y comprobar exit 1), como ya existe para otras.

**Criterio de cierre:** `check:audit-freshness` falla si se altera una cifra de `Live surface`; el documento coincide con el árbol.

**Remediación aplicada (11-11-2026):**

- `scripts/check-audit-freshness.mjs` gana `parseLiveSurfaceTable` y `verifyLiveSurface`: la tabla se parsea (falla si falta la sección, la tabla o las filas) y trece comprobaciones derivan la cifra del árbol y la comparan con la publicada — scripts de `package.json` (**151**), ficheros de `.github/workflows` (**12**), entradas `<loc>` de `public/sitemap.xml` (**37**), el mayor de `engines.node` (**22**), cabeceras HSTS (**5**), referencia a DOMPurify (**1**), digests en los dos compose (**0/0**), superficie muerta `services/ai` en servidor y OpenAPI (**0/0**), acciones sin SHA (**0**), locales de landing (**30**) y páginas legales (**6**). Una fila borrada, una cifra ilegible o una discrepancia fallan: no hay escape por omisión.
- `docs/audit.md`: 199 → 149 scripts, 10 → 12 workflows, «61 URLs (root + 30 landings + pocket + 30 legal)» → «37 URLs (30 landings including root + pocket + 6 legal pages)», `Node ≥24` → `Node ≥22`; y la deuda A11-2 deja de citar 61 URLs.
- Tests (`scripts/__tests__/check-audit-freshness.test.mjs`, 27 en total): parseo y fallo cerrado sin sección, tabla de fixture que cuadra, **mutación de una cifra (`sitemap: 3` contra un árbol con 2) que debe salir exit 1**, borrado de la fila que publica la cifra y comprobación de la tabla real contra el árbol real.
- Verificado: `node scripts/check-audit-freshness.mjs` → exit 0 con `live surface: 13 figure(s) verified`; suite del gate 27/27; `npm run check` 9/9 (63,7 s).

---

### P1-2 — (RESUELTO 11-11-2026) Los informes CSP se descartaban en Vercel y Netlify

**Evidencia**

- `api/csp-report.js` es un stub: acepta `POST`, responde `200 {}` y **no almacena ni reenvía nada** (comentario propio: «silences 404 errors in Vercel logs»).
- `netlify.toml:26` y `public/_headers` anuncian `report-uri /csp-report; report-to csp-endpoint`.
- El nginx autohospedado sí tiene collector real (`server/src/csp-report.ts`, con hash de IP y rate limit).

**Estado frente a la auditoría del 5-11 (A4):** el leak de metadatos al dominio del proveedor (M2) **está corregido** — el `report-uri` es relativo. Lo que sigue abierto es la segunda mitad de A4: **en los dos hosts estáticos la telemetría de violaciones CSP se pierde en silencio** mientras las cabeceras prometen lo contrario.

**Por qué importa:** una violación CSP es la señal más directa de una inyección o de una regresión de política. El operador cree tener monitorización y no la tiene; el «error-spike / csp-violation-spike» solo funciona en self-hosted.

**Qué hacer** (elegir una, no las dos)

- **(a) Implementar** el collector en la función serverless: ring buffer acotado, rate limit por IP, hash con salt, descarte de campos no allowlisteados. Reutilizar la lógica de `server/src/csp-report.ts`.
- **(b) Retirar** `report-uri`/`report-to` de los hosts sin collector y documentar que solo self-hosted recopila.

Recomendado: **(b) a corto plazo** (no prometer capacidad inexistente) y **(a) cuando exista necesidad operativa real**. Añadir una puerta que cruce «cabeceras que anuncian `/csp-report`» con «hosts que tienen collector».

**Criterio de cierre:** ninguna superficie anuncia un endpoint que descarta el informe.

**Remediación aplicada (11-11-2026):**

- `api/_csp-report-core.js` (nuevo) — contrato compartido y sin dependencias: acepta las dos formas del estándar (`csp-report` de `report-uri` y `type: csp-violation` de `report-to`), tope de 16 KB, rate limit por isolate con poda FIFO y tope de cardinalidad, redacción a **origen** (sin path/query/fragment ni `script-sample`), hash SHA-256 de la IP (24 hex, nunca la dirección) y una línea de log estructurada `csp_violation` por informe aceptado.
- `api/csp-report.js` — adaptador Vercel real: 204/400/413/429/405, `Cache-Control: no-store`, lee `req.body` o el stream con tope.
- `functions/csp-report.mjs` (nuevo) — un archivo, dos runtimes: `handler(event)` para Netlify Functions y `onRequest(context)` para Cloudflare Pages Functions, ambos sobre el core compartido.
- `netlify.toml` — redirect exacto `/csp-report` → `/.netlify/functions/csp-report` (Netlify solo autoenruta `/api/*`).
- `check:csp` — nueva regla `assessCspReportCollectors`: falla si falta un colector, si deja de usar el core compartido o si vuelve a ser un stub que descarta el informe.
- Verificado: `check:csp-sync`, `check:spa-routes`, `nginx-render` y `test:fast` (16 tests nuevos del colector).
- **Residual honesto:** el wiring de Netlify/Cloudflare no se pudo ejercitar en las plataformas reales (no hay despliegue en esta revisión); el rate limit es por isolate (best-effort, como el de licencias); el colector emite líneas estructuradas, no un almacén persistente.

---

### P1-3 — (RESUELTO 11-11-2026) `READ_ONLY` era configuración muerta y los contenedores no tenían límites

**Evidencia**

- `docker-compose.prod.yml:61` define `READ_ONLY: "true"` para `api`.
- `grep -rn "READ_ONLY" server/src api scripts` → **0 lectores**.
- No hay `read_only: true`, `tmpfs`, `mem_limit`, `cpus`, ni `logging.options.max-size/max-file` en ninguno de los dos servicios.

**Estado:** era M4 de la auditoría del 5-11 y **sigue abierto** (`cap_drop: [ALL]` y `no-new-privileges` sí están bien aplicados).

**Por qué importa:** el operador cree que el contenedor es de solo lectura y no lo es; sin límites de recursos, un pico de memoria/CPU afecta al host y los logs pueden crecer sin cota. Es engaño de configuración, no hardening incompleto.

**Qué hacer**

1. Eliminar `READ_ONLY` **o** implementarlo (`read_only: true` + `tmpfs: /tmp` donde el runtime lo permita).
2. Añadir `mem_limit`, `cpus` y `logging.options` acotados a `web` y `api`.
3. Extender `check:compose-config` para **fallar cuando el compose declare una variable de entorno que ningún módulo del servidor lee** (así `READ_ONLY` no puede volver).

**Criterio de cierre:** `docker compose config` sin variables huérfanas; límites presentes; gate que lo garantiza.

**Remediación aplicada (11-11-2026):**

- `docker-compose.prod.yml` — `READ_ONLY` eliminado (no tenía lector); el `api` pasa a `read_only: true` + `tmpfs: /tmp`; ambos servicios ganan `mem_limit`, `cpus`, `pids_limit` y `logging` con `max-size`/`max-file`. El `web` no es read-only porque nginx necesita escribir su caché y el pid (documentado en el compose).
- `scripts/validate-compose-config.mjs` — la lista de claves retiradas (blocklist) se sustituye por una regla invertida: **toda** variable declarada en el `api` debe aparecer en `server/src` (match literal, para cubrir lectores como `readIpHashSalt("CSP_REPORT_IP_HASH_SALT", …)`). Además exige el hardening anterior, así que no puede revertirse sin romper la puerta.
- Tests: `scripts/__tests__/validate-compose.test.mjs` cubre el parsing del bloque `environment`, la forma de lista, el huérfano `READ_ONLY` y cada requisito de hardening.
- Verificado: `check:compose-config`, `npm run check` 6/6 y `test:fast` 193/193.

---

### P2-1 — Cuatro tests siguen fuera del typecheck

**Evidencia:** `tsconfig.json` excluye explícitamente `src/tests/db/encryption.test.ts`, `FlashcardService.test.ts`, `GlobalRAGService.test.ts` y `SpecializedAgentsService.test.ts` (comentario: «tsc can't resolve the types»).

**Estado:** M8 de la auditoría del 5-11, **abierto**. La premisa de entonces («no hay declaraciones de los módulos Pro») ya no es del todo cierta: `src/services/pro-access.ts` publica tipos de fachada (`BackupServiceFacade`, `WebLLMServiceClass`, etc.).

**Qué hacer:** reincorporarlos usando los tipos de `pro-access.ts`, o crear `tsconfig.tests.json` (`noEmit`, `skipLibCheck`) y ejecutarlo en CI. Son precisamente los tests de cifrado de BD y servicios Pro donde un error de tipo duele más.

**Criterio de cierre:** `npm run typecheck` cubre los 4 archivos y sigue en verde.

---

### P2-2 — La CSP de producción permite loopback y estilos inline sin excepción documentada

**Evidencia:** todas las copias renderizadas (`public/nginx.conf`, `public/_headers`, `netlify.toml`, `vercel.json`) incluyen en el perfil de producción:

- `connect-src … http://localhost:11434 …` (Ollama);
- `style-src 'self' 'unsafe-inline'; style-src-attr 'unsafe-inline'`.

**Estado:** M10 de la auditoría del 5-11, **abierto y no registrado como excepción aceptada**.

**Por qué importa:** cualquier XSS puede hablar con servicios en loopback (Ollama y otros que no exijan auth) y `unsafe-inline` en estilos amplía la superficie de exfiltración visual. Mantine puede exigirlo, pero entonces debe estar **declarado** como excepción consciente.

**Qué hacer:** mover `localhost:11434` a un perfil de desarrollo o condicionarlo a `VITE_MODEL_SELF_HOST_URL`; documentar `style-src 'unsafe-inline'` en el ADR de CSP con su motivo y su fecha de revisión. **Editar siempre `scripts/csp-config.js`** y re-renderizar (`npm run nginx:render`), nunca las copias.

**Criterio de cierre:** ADR de CSP con la excepción fechada; `check:csp` verde tras cambiar solo la fuente.

---

### P2-3 — `docs/PENDIENTES.md` P-07 describe un backlog de i18n que ya no existe

**Evidencia:** P-07 afirma «the untranslated backlog, **232–263 keys per locale in 26 locales**». Hoy `node scripts/i18n-completeness.mjs` reporta `0/1889 untranslated` en los 30 locales y `scripts/i18n-backlog-baseline.json` tiene `total: 1808` sin untranslated.

**Por qué importa:** el propio registro impone la regla «every row names the observable that proves the debt». Una fila de release-blocker con una cifra que el árbol desmiente rompe la credibilidad del registro completo.

**Qué hacer:** cerrar P-07 con la evidencia de hoy (comando + salida), dejar la fila como pagada y anotar la fecha. Si se quiere conservar la vigilancia, la tiene `check:content`/`i18n-completeness` con el baseline en cero.

---

### P2-4 — `AGENTS.md` afirma que no existe hook de Husky y sí existe

**Evidencia:**

- `AGENTS.md` §6: «this checkout has **no `.husky/pre-commit` hook file** — CI is the enforcement point».
- `ls -la .husky` → `pre-commit` presente (169 bytes, 28-oct).
- `package.json` tiene `"prepare": "husky"` y `lint-staged` configurado.

**Por qué importa:** es una instrucción operativa para contribuyentes («no esperes hook local»). Si el hook existe y falla, el contribuyente no sabrá por qué su commit se rechaza; si no existe donde el documento dice, la política de lint-staged es decorativa.

**Qué hacer:** decidir la realidad (mantener el hook o retirarlo) y alinear `AGENTS.md`. Si se mantiene, documentar qué ejecuta y cómo saltarlo con criterio.

---

### P2-5 — Tres cifras distintas de «scripts npm» y ninguna correcta

**Evidencia:** `README.md:212` y `:445` → **117**; `README.md:545` → **168+**; `AGENTS.md:118` → **117**; `docs/audit.md:34` → **199**; real → **149**.

**Qué hacer:** una sola fuente. `package.json` es la fuente; `docs/npm-scripts-guide.md` debería generarse desde él (o al menos validarse con una puerta) y el resto de documentos citar sin número o con el número derivado.

---

### P2-6 — `as any` en código de producción (25) y volumen alto en tests (3.553)

**Evidencia:** `grep -rc "as any" src` → 3.578 total; excluyendo `src/tests/` → **25**; los mayores volúmenes están en tests de `WebRTCSyncService` (577), `TTSService` (212), `SyncService` (164).

**Lectura correcta:** el número global no es el problema (los tests mockean RxDB/WebRTC con genéricos opacos). Los **25 de producción** sí merecen triaje: cada uno es un punto donde el compilador deja de comprobar el contrato. No es un blocker; es deuda acotada y medible.

**Qué hacer:** listar los 25 con `grep -rn "as any" src --include=*.ts --include=*.tsx | grep -v "^src/tests/"`, clasificar (justificado con comentario vs. perezoso) y añadir una regla/acotación que impida que crezca en producción.

---

### P2-7 — `console.*` en cinco archivos de producción

**Evidencia:** 87 ocurrencias en todo `src/`; en código no-test quedan **10 ocurrencias en 5 archivos**: `src/utils/environmentDetection.ts` (5), `src/utils/crypto-core.ts` (2), `src/utils/logger.ts` (1), `src/services/ai/ProviderManager.ts` (1), `src/services/SyncService.ts` (1). El resto (~77) está en tests.

**Lectura:** `logger.ts` y probablemente `crypto-core.ts` son fallbacks justificados (no pueden depender del logger sin ciclo). `environmentDetection`, `ProviderManager` y `SyncService` deben revisarse: `AGENTS.md` §4 exige `logger` y prohíbe `console.*` en código de app.

**Qué hacer:** revisar los 3 no justificados, migrar a `logger` (con `logRateLimited` si son bucles) y dejar un comentario `INTENTIONAL SILENCE`/justificación donde el uso sea deliberado.

---

### P2-9 — (RESUELTO 11-11-2026) `npm run check:quality` estaba rojo en HEAD (knip) y la cadena `check` no lo ejecutaba

**Evidencia:** `npx knip` → `Unused exports (4)`: `BF_ERROR_CODES`, `classifyUserError`, `resetLastErrorCode` y `BF_ERROR_CODE_LIST` en `src/utils/errorCodes.ts`. `git log -S"BF_ERROR_CODES"` señala `50d9ee6` como el commit que tocó esos símbolos: el commit retiró sus usos y dejó los exports huérfanos (el archivo solo importa hoy `getLastErrorCode`, `describeErrorCode` y `noteUserError`). `npm run check` sale 0 con 6/6 gates porque su resumen descompone la calidad en `check:chunks` + `check:tooling-deps` y **no ejecuta knip**.

**Por qué importa:** es una puerta que el propio repositorio documenta como obligatoria y que hoy no está verde en HEAD; además, la cadena que el contribuyente ejecuta puede estar verde mientras esa puerta falla. Es el mismo patrón que P1-1: verde donde se mira, rojo donde no.

**Resolución (11-11-2026):** los cuatro exports huérfanos se retiraron. El primer intento añadió `ignoreExportsUsedInFile: true` a `knip.json`, que tapaba el síntoma en todo el repositorio; se retiró. El arreglo real: `BF_ERROR_CODES` era un objeto que nadie leía en runtime (solo servía de base al tipo), así que el catálogo pasó a una unión `BfErrorCode` con las etiquetas como comentarios, y `classifyUserError` quedó interno con `noteUserError` como única entrada pública. `npx knip` vuelve a verde sin comodines (solo quedan 8 hints de configuración, ninguno un export sin usar) y `tsc`/`eslint` aceptan el archivo sin `_` ni supresiones.

**Decisión sobre `npm run check`:** sí ejecuta las tres. `check:quality` es `lint && check:boundaries && … && check:knip`, y `check` encadena `check:quality`. Coste medido sobre ~78 s de cadena: ~23 s lint, ~1 s fronteras, ~6 s knip. Se quedan las tres: las fronteras porque el allowlist debe permanecer vacío (AGENTS §5) y su coste es despreciable; lint porque es la única superficie local que aplica las reglas del repo; knip porque es la que destapó este P2-9. No se replican en `check:pr`/`check:deploy` (P2-8): esas cadenas ya son listas manuales y duplicarlas empeora la deriva.

### P2-8 — Las tres cadenas agregadas de puertas son listas manuales casi idénticas

**Evidencia:** `check:pr`, `check:deploy` y `check:nightly` repiten ~50 invocaciones cada una (security + content + brand + build + gates propios), con ~90 % de solapamiento. `check:deploy` y `check:nightly` ya arrastraron duplicados en el pasado (P-24: 54 → 50 invocaciones).

**Por qué importa:** es el vector de deriva real de todo el sistema de gates. Una puerta nueva debe añadirse en hasta tres sitios, y nada detecta el olvido.

**Qué hacer:** generar las tres cadenas desde una lista única (mismo patrón que `app-routes.mjs`) o reducirlas a `npm run check` + los pasos específicos. No es urgente, pero crece con cada gate.

---

### P3-1 — Clave de firma de licencias presente en el workspace

`server/.license-signing-key.pkcs8` (1.625 bytes, 6-nov) existe y está correctamente ignorada (`.gitignore:10`). **Acción:** confirmar que es una clave de desarrollo; si alguna vez se usó la productiva en local, rotar. Verificar antes de cualquier build de imagen.

### P3-2 — El autohospedaje no ofrece activación Pro (decisión correcta, comunicación pendiente)

`public/nginx.conf:94,99` devuelve **404 explícito** con `NO_LICENSE_SERVICE` para `/api/license/*` y `/api/affiliate/*` (remodelación de A2). Es lo correcto frente a proxificar a un servidor que responde 426. **Acción:** asegurar que `docs/SELF-HOSTING.md` lo dice con claridad, para que nadie despliegue esperando activar Pro.

### P3-3 — Baselines visuales de landing solo se comparan en Windows

`tests/e2e/landing-visual.spec.ts` compara las dos capturas solo en `win32`; todos los jobs de CI corren `ubuntu-latest`. Sigue abierto (P-33). **Acción:** capturar el par `-chromium-linux` y quitar el skip de plataforma.

### P3-4 — Producción no coincide con el checkout (A11-2) y sign-off pendientes

Sondas previas: `/` = 200, pero `/ar/`, `/es/`, `/sitemap.xml`, `/privacy-and-terms.html` = 404 en producción. Es deuda abierta que ningún gate del repo puede cerrar. **Acción:** desplegar este checkout y repetir `node scripts/check-hreflang-graph.mjs https://bookmarkforgeapp.com`. Los sign-offs (ruleset, RPO/RTO, GDPR, pentest, WCAG manual) siguen siendo externos (P-09).

### P3-5 — La frescura de auditoría se verificó sin `--deep` ni `--allow-network`

Los 3 rows profundos/red quedaron omitidos localmente (esperado). **Acción:** CI debe ejecutar `check:audit-freshness:deep`; confirmar que el job existe y no se saltó.

---

## 4. Estado real de las auditorías previas

| Hallazgo 2026-11-05 | Estado verificado hoy |
|---|---|
| A1 — contenedor `api` no arranca por salts | **Corregido.** Los 4 salts son `:?` obligatorios en `docker-compose.prod.yml:57-60` |
| A2 — nginx proxifica `/api/license` y `/api/affiliate` a rutas retiradas | **Corregido como 404 explícito** en nginx; ya no hay 426 silencioso |
| A3 — rate limiter reconstruido por petición | **Corregido.** Handler y clave de firma son singletons perezosos de módulo (`getSigningKey`/`getLicenseHandler` en `api/license/[action].ts`) |
| A4 — CSP sin collector en estáticos | **Parcial.** El leak externo está cerrado (`report-uri` relativo); el descarte en Vercel/Netlify sigue → **P1-2** |
| M4 — `READ_ONLY` muerto, sin límites de contenedor | **Abierto** → P1-3 |
| M8 — 4 tests fuera del typecheck | **Abierto** → P2-1 |
| M10 — `localhost:11434` y `unsafe-inline` en CSP de producción | **Abierto** → P2-2 |
| B4 — `AGENTS.md` desactualizado respecto a Husky | **Abierto** → P2-4 |
| M6 — contraseña como string en RxDB | Sigue siendo limitación de API (documentada); sin cambio |
| 2026-11-07: extensión self-hosted, asimetría de fetchers, `/og-image.svg` | **Corregidos.** `capture-url.js` acepta cualquier host HTTPS sin userinfo; `isPublicFetchTarget` es la puerta compartida; la tabla de rutas declara `/og-image.svg` |

---

## 5. Plan de trabajo priorizado

### P0 — hoy (cierra la afirmación «suite verde»)

- [x] **Actualizar el pin** de `check-landing-smoke` a 97 y el comentario del bloque.
- [x] **Corregir `docs/audit.md`**: 93 → 97 enlaces internos.
- [x] `npm run test:fast` → **exit 0** (192/192 archivos); `node scripts/check-audit-freshness.mjs` → exit 0.
- [ ] Registrar el cierre en `docs/PENDIENTES.md` (P-02/P-08) con el observable de hoy.

### P1 — esta semana (huecos operativos abiertos)

- [x] **P1-1** Cifras de `Live surface` corregidas y derivadas por `check-audit-freshness` (4 reglas) + test de mutación.
- [x] **P1-2** Colector real en Vercel + Netlify/Cloudflare Pages, core compartido y puerta que impide volver al stub.
- [x] **P1-3** `READ_ONLY` eliminado, `read_only`+`tmpfs` y límites en compose, puerta de variables huérfanas.
- [x] **P2-9** `knip` verde y en la cadena: `lint`, `check:boundaries` y `check:knip` son gates de `npm run check`.

### P2 — este mes (deuda verificable)

- [ ] **P2-1** Reincorporar los 4 tests al typecheck (o `tsconfig.tests.json` en CI).
- [ ] **P2-2** CSP: sacar `localhost:11434` del perfil de producción y documentar `unsafe-inline` en el ADR de CSP; editar solo `scripts/csp-config.js`.
- [ ] **P2-3** Cerrar P-07 con evidencia (backlog i18n = 0).
- [ ] **P2-4** Alinear `AGENTS.md` con la realidad de Husky.
- [ ] **P2-5** Unificar la cifra de scripts npm (fuente: `package.json`).
- [ ] **P2-6** Triaje de los 25 `as any` de producción + regla que impida crecer.
- [ ] **P2-7** Migrar a `logger` los 3 `console.*` no justificados.
- [ ] **P2-8** Generar `check:pr`/`check:deploy`/`check:nightly` desde una lista única.

### P3 — cuando toque (riesgo bajo / externo)

- [ ] **P3-1** Confirmar que la clave `.pkcs8` local es de desarrollo.
- [ ] **P3-2** Documentar en `SELF-HOSTING.md` que no hay activación Pro self-hosted.
- [ ] **P3-3** Baselines visuales `-chromium-linux` (P-33).
- [ ] **P3-4** Desplegar el checkout y repetir sondas (A11-2); cerrar o aceptar por escrito los sign-offs (P-09).
- [ ] **P3-5** Confirmar `check:audit-freshness:deep` en CI.

---

## 6. Deriva documental detectada (resumen accionable)

| Documento | Dice | Realidad | Acción |
|---|---|---|---|
| `docs/audit.md` | 199 npm scripts · 10 workflows · 61 URLs · Node ≥24 · 93 enlaces · 97 enlaces internos | 151 · 12 · 37 · ≥22 · censo derivado (97 hoy) | Corregido; `check:audit-freshness` vigila la tabla y el censo de enlaces ya no se fija (11-11-2026) |
| `docs/PENDIENTES.md` P-07 | 232–263 claves sin traducir en 26 locales | 0 en 30 locales | Cerrar con evidencia |
| `AGENTS.md` §6 | «no `.husky/pre-commit` hook file» | Existe | Alinear |
| `README.md` / `AGENTS.md` | 117 scripts (y «168+») | 151 | Fuente única |
| `docs/RELEASE-STATUS.md` | Matriz 2026-10-02 (ya marcada superseded) | — | Regenerar solo en release completo |

---

## 7. Lo que esta revisión NO verificó

- **Playwright/E2E** (`e2e:smoke`, `e2e:sync`, `e2e:mobile`, nightly, human-like): no ejecutados. Los baselines visuales y el flujo multiusuario quedan sin comprobar en esta ronda.
- **Pentest, DAST/ZAP, WCAG manual, SAST de primera ejecución**: externos o de CI; no ejecutados aquí.
- **Infraestructura real** (Whop, Cloudflare, Vercel, Netlify, TLS/HSTS del proxy frontal): fuera de alcance.
- **`test:slow` completo**: no ejecutado (solo el perfil rápido). Su superficie es mayor y puede albergar rojos no vistos.
- **Docker build/stack completo**: no construido; el contrato del compose se validó con la puerta y la revisión, pero no se levantó el stack ni se comprobó `read_only`/`tmpfs` en un Docker real.
- **Colectores serverless en producción**: no se ejercitaron en Vercel, Netlify ni Cloudflare Pages reales; la verificación es local (tests + gates).
- **Concurrencia bajo carga** (k6/artillery): sigue siendo ítem operativo pre-lanzamiento (ENVIRONMENT.md).

---

## 8. Criterio de «revisión cerrada»

Se puede volver a declarar el proyecto en verde cuando, sobre un único commit:

1. `npm run test:fast` **exit 0** (P0-1) y `npm run check` 6/6.
2. `docs/audit.md` coincide con el árbol **y** `check:audit-freshness` falla si se altera una cifra de `Live surface`.
3. Ninguna superficie anuncia `/csp-report` sin collector, y el compose no declara variables que nadie lee.
4. `docs/PENDIENTES.md` no contiene ninguna fila cuyo observable el árbol desmienta.

---

*Informe generado con verificación local ejecutada el 11-11-2026. Cada hallazgo cita el comando o la ruta que lo prueba; ninguno se apoya en los informes anteriores como fuente.*
