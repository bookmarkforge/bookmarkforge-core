# Operaciones

## Preflight de release

Ejecutar en CI y antes de una release:

```bash
npm ci
npm run typecheck:prod
npm run lint
npm run test
npm run build:ci
npm run check
npm run check:secrets-in-commit
npm run check:launch-checklist:strict  # falla si algún 🔴 bloqueante está sin completar
```

El despliegue de producción debe ser aprobado, usar imágenes identificadas por SHA y conservar el artefacto y los resultados de los gates. El `check:launch-checklist:strict` se ejecuta además automáticamente: cada noche en `nightly.yml` (job `launch-readiness`) y como Punto 10 del gate pre-deploy `check-blindeo.mjs` (bloquea despliegues a producción con bloqueantes abiertos).

## Health y observabilidad

- `GET /health` es liveness y no expone contadores ni identificadores operativos.
- `SIGNALING_ADMIN_TOKEN` protege diagnósticos del servidor de señalización.
- `CSP_REPORT_ADMIN_TOKEN` protege informes CSP.
- Los eventos de cliente se almacenan de forma acotada y pueden generar alertas mediante webhook HTTPS.
- Los logs deben ser estructurados y no contener secretos, contraseñas, prompts ni documentos.
- Correlacionar frontend, API, IA y señalización mediante un identificador de trazabilidad sin PII.

## SLOs y objetivos (baseline pre-lanzamiento)

Valores de referencia definidos; revisar trimestralmente o al alcanzar 5× el tráfico actual.

| Métrica | Objetivo | Ventana | Medición |
|---|---|---|---|
| Disponibilidad de api + web | 99.9% | 30 días | healthchecks + uptime probe |
| Latencia p95 del proxy de IA | < 3 s | 28 días | `GET /api/services/ai/metrics` |
| Latencia p95 de señalización (join) | < 500 ms | 28 días | logs de señalización |
| Tasa de errores 5xx | < 0.5% | 5 minutos | logs estructurados |
| Saturación de conexiones WS | < 70% del límite | 5 minutos | diagnósticos admin |
| Error-spike de clientes críticos | 0 eventos | 10 minutos | collector `/api/client-events` |

**RPO:** 24 h — el cliente genera backups automáticos cifrados diarios (cliente + copia
local). El servidor no aloja datos del vault; el RPO de estado operativo (Redis) es
inmaterial y no se usa como backup del vault.

**RTO:** 24 h para restauración completa de un vault; 4 h para recuperar la topología
servidor (imágenes por SHA) + Redis si procede.

Guardia: responsables y canal de alertas deben registrarse antes del lanzamiento
público; severidades según la plantilla de incidentes.

## Modelo comercial y soporte — Lifetime v1 (sin suscripción)

BookmarkForge es local-first y cifrado: el operador no puede ver el vault.
El soporte se apoya en un Help Center estático y un diagnóstico redactado
copiable desde la app.

**Precios v1 (src/constants/pricing.ts, landing, /help):**

| Tier | Precio | Qué incluye | Supply |
|---|---|---|---|
| Free | $0 forever | 1 000 bookmarks, 1 dispositivo, full-text + semantic search, knowledge graph, AI con API key propia | ilimitado |
| Pro Lifetime v1 · Early Bird | **$59** (→ $79 regular → $99 tras tracción) | Ilimitado, 3 dispositivos + P2P sync, Local AI (WebLLM/Ollama) + RAG + agentes, flashcards, PDF/OCR, 10+ exports, vault. <em>Lifetime de v1 · 12 meses de features · security forever · v2 60% off</em> | 200 |
| Founder | **$99** lifetime v1 | Mismo Pro v1 + badge Founder # + beta v2 + 60% off v2/v3 lifetime | 100 |

Upgrade v2/v3: **$89 nuevos / $35 owners v1 (60% off)**. Sin upgrade, v1 sigue
funcional para siempre. Línea legal canónica en `/help#pricing`, `privacy-and-terms.html` §Terms
y `landing.html` pricing-legal: `Lifetime license for BookmarkForge v1. Includes all v1.x updates and 12 months of feature updates. Security updates forever. Future majors 60% off.` Reembolso 30 días vía Whop (card/PayPal/crypto; el operador nunca ve la tarjeta).

**Help Center:** `public/help.html` en `/help` (EN-only; hreflang x-default). Contiene
pricing, SLA, troubleshooting (vault/storage/P2P/WebLLM), 9 códigos `BF-E101..202` y la
sección `Copy diagnostic`. Routing: `public/_redirects` + `public/nginx.conf` + `netlify.toml`
(`200` a `help.html`). Añadir `/help` al sitemap si se localiza; hoy no es bloqueante
(`check:seo` no lo exige).

**Diagnóstico redactado:** `src/utils/supportDiagnostics.ts` + botón `Settings → Advanced → Copy diagnostic`
(`src/components/settings/AdvancedSection.tsx`). No incluye contenido del vault, URLs ni prompts:
`version | browser | counts | storage % | P2P | AI | errors | BF-E | build`. IP solo como
hash salteado (ROPA §3/§6). El usuario lo pega en email/Discussions; cubre el 90% de tickets.

**SLA soporte:**

| Tier | Canal | Respuesta (Mon–Fri) |
|---|---|---|
| Free | Self-service: `/help` + GitHub Discussions | Best effort (comunidad) |
| Pro | `bookmarkforge@proton.me` (subject: Pro) + diagnóstico | **48h** |
| Founder | Email priority (subject: Founder #) | **24h** + beta queue |

Soporte nunca pide password del vault ni frase de 24 palabras. Sin frase = vault irrecuperable
por diseño (BF-E101). Ver `/help#sla` y `#bf-e`.

## Gate nocturno de KPIs de negocio (staging)

El job `kpi-staging` de `.github/workflows/nightly.yml` ejecuta
`npm run kpi-report` contra staging y **pagina** cuando una métrica cae por
debajo de su umbral:

- **Métricas:** DAU/WAU/MAU y retención D7/D30 de la cohorte más reciente que
ya tenga la antigüedad necesaria (el gate no mide cohortes demasiado jóvenes).
- **Umbrales (repo vars, opcionales):** `KPI_MIN_DAU`, `KPI_MIN_WAU`,
  `KPI_MIN_MAU` (enteros ≥ 0) y `KPI_MIN_D7_PCT`, `KPI_MIN_D30_PCT`
  (proporción 0..1). Sin configurar, el job es solo informe (exit 0).
- **Paginación:** por debajo del umbral el script emite el evento estructurado
  `analytics_kpi_below_threshold`, dispara el webhook HTTPS
  `ANALYTICS_ALERT_WEBHOOK_URL` (p. ej. Slack; `http` rechazado, misma política
  que los demás canales de alerta) y sale 1 → la run de CI queda en FAIL.
- **Evidencia:** artifact `kpi-report-<run_id>` (30 días) con el JSON del
  informe + evaluación.
- Requiere en staging: `ANALYTICS_ADMIN_TOKEN` configurado en el companion
  server (secret `STAGING_ANALYTICS_ADMIN_TOKEN` en CI) — sin él el endpoint
  devuelve 503 y el job falla a propósito (requiere atención del operador).

Ejecución local:

```bash
ANALYTICS_ADMIN_TOKEN=... ANALYTICS_BASE_URL=https://staging... \
  KPI_MIN_DAU=10 KPI_MIN_D7_PCT=0.15 node scripts/kpi-report.mjs
```

### Conexión a Slack (Incoming Webhook)

**1 · Crea el webhook en Slack** — en el workspace, *Settings → Incoming
Webhooks* (o crea una app `Incoming Webhook`) y elige el canal de alertas
(p. ej. `#ops-alerts`). Slack expide una URL del tipo
`https://hooks.slack.com/services/T000/B000/xxxx`.

**2 · Regístrala como secreto en GitHub** para que el job `kpi-staging` la
inyecte:

```bash
gh secret set ANALYTICS_ALERT_WEBHOOK_URL --repo <owner>/<repo>
```

El script **detecta automáticamente** si la URL es un Incoming Webhook de
Slack (`hooks.slack.com/services`) y, en ese caso, envía un payload nativo
`{ text, blocks }` con mrkdwn. Cualquier otro webhook HTTPS recibe el JSON
estructurado del evento. `http` se rechaza (misma política de los demás
canales de alerta).

### Payload de ejemplo

Con un umbral roto, el job `kpi-staging` hace `POST` con JSON. En un Incoming
Webhook de Slack el cuerpo es:

```json
{
  "text": "⚠️ BookmarkForge — KPIs por debajo del umbral",
  "blocks": [
    { "type": "section", "text": { "type": "mrkdwn", "text": "⚠️ *KPIs por debajo del umbral*" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "> *generatedAt* 2026-08-31T00:10:00.000Z\n> *Installs* 120\n> *DAU / WAU / MAU* 42 / 180 / 350\n> *Violación:* DAU=42 por debajo del umbral 60" } }
  ]
}
```

Y para un webhook HTTPS no-Slack (p. ej. un colector propio), el payload es el
evento estructurado:

```json
{
  "event": "analytics_kpi_below_threshold",
  "generatedAt": "2026-08-31T00:10:00.000Z",
  "dau": 42,
  "wau": 180,
  "mau": 350,
  "activeInstalls": 120,
  "violations": ["DAU=42 por debajo del umbral 60"]
}
```

## Simulacro de restauración (drill mensual)

El drill automatiza el procedimiento mensual completo (crear backup de una
instalación de referencia → restaurar en perfil limpio → comparar conteos y
hashes):

```bash
npm run drill:backup-restore
```

Ejecuta `tests/e2e/drill-backup-restore.spec.ts` contra el stack de staging:

1. **BASELINE** — vault con 3 bookmarks + 1 documento sembrados; conteo y hashes.
2. **EXPORT** — fase A: `.bmf` cifrado real vía UI; fase B: JSON en claro.
3. **DISASTER** — IndexedDB borrada + reload; el vault queda bloqueado, nunca
   se crea un vault vacío silencioso.
4. **RESTORE** — importación desde el archivo; tiempo del camino medido y gateado
   (RTO de referencia < 120 s).
5. **VERIFY** — conteos y títulos idénticos a la línea base.

El script reporta una tabla PASS/FAIL por fase y sale 0/1 (CI-ready). Programa
la ejecución mensual (cron) y regístrala en el checklist operativo.

**Evidencia de ejecución local (re-run) — 2026-08-31:** ✅ PASS — `npm run drill:backup-restore` (exit 0, `ok:true`, `degraded:[]`):

| Fase | Resultado | RTO medido | Gate |
|---|---|---|---|
| restore_plaintext (JSON) | PASS | **6.5 s** (6528 ms) | < 120 s |
| restore_bmf (cifrado .bmf) | PASS | **6.6 s** (6640 ms) | < 120 s |
| playwright (spec) | PASS | 2 passed / 0 failed | exit 0 |
| rto_gate | PASS | ambos caminos < gate | sin degradación (`drill_rto_degraded` no emitido) |


## Simulacro de recuperación ante desastre (DR drill)

**Frecuencia:** el ensayo de **backup-restore** corre **cada mes** en
`.github/workflows/nightly.yml` (job `drill-backup-restore`, día 1 de cada mes
03:17 UTC + `workflow_dispatch`), y el ensayo completo de ambos caminos corre
**cada trimestre** en `.github/workflows/drill-quarterly.yml` (primer día de
enero/abril/julio/octubre a las 06:00 UTC + `workflow_dispatch`). Ambos cubren
los caminos de recuperación contra la topología staging local:

> **Alerta de degradación del RTO.** El drill pasa si la restauración cumple el
gate RTO (< 120 s por defecto). Si una restauración **supera el umbral de
degradación** (`DRILL_RTO_WARN_MS`, default 90 % del gate = 108 s) sin romper el
gate, el script emite el evento `drill_rto_degraded` y dispara el webhook HTTPS
`DRILL_ALERT_WEBHOOK_URL` (misma política `https`-only que el gate de KPIs),
pero la run **no falla** — es una señal temprana antes de romper el SLO. Para
verla en el run del drill se puede apuntar `DRILL_ALERT_WEBHOOK_URL` al canal
de incidencias (p. ej. un webhook de Slack).

1. **Backup-restore (job `backup-restore`)** — `npm run drill:backup-restore`:
   baseline → desastre → restore → verify, con gate RTO de referencia < 120 s.
2. **Rollback por imagen (job `rollback-docker`)** — `DRILL_DOCKER=1 node
   scripts/drill-rollback.mjs` contra `docker-compose.staging.yml`: baseline →
   kill del api → detección (monitoring) → rollback por imagen (CAMINO A,
   gate < 60 s) → re-verificación. Construye las imágenes REALES del tag
   `prod-*` previo desde su worktree, de modo que el rollback sea imagen == código.

3. **KPI collector (job `kpi-collector-local`)** — `npx tsx
   scripts/kpi-local-collector-check.mjs` valida el pipeline de analítica
   contra un servidor LOCAL (sin staging): arranca el collector real
   (`createAnalyticsHandler`) en 127.0.0.1, siembra un dataset con cohorte de
   retención D7 madura, hace un POST `/api/analytics/events` en vivo y corre
   el gate `kpi-report` con umbrales exactos (DAU/WAU/MAU + retención D7).

Precondiciones que el workflow resuelve:

- **Historial y tags:** `fetch-depth: 0` + `fetch-tags: true` (el rollback
  requiere ≥ 2 tags `prod-*`; sin ellos el drill falla de forma explícita —
  crear tags con `scripts/deploy-prod.mjs`).
- **Secreto de firma de licencias:** `node scripts/generate-license-keys.mjs
  --server-key-only` escribe solo el PKCS#8 gitignored (el compose staging
  necesita el archivo; los archivos commiteados quedan intactos).
- **Evidencia:** cada job sube un artifact `drill-{backup-restore,rollback}-<run_id>` y `kpi-local-collector-<run_id>`
  (salida JSON + `test-results/`) con retención de 90 días y escribe el resumen
  en el job summary de la run.

Registro del drill: cada run del workflow es la evidencia (RPO/RTO y resultado
PASS/FAIL); anotar el enlace de la run en el checklist operativo trimestral y
revisar los SLOs de la sección anterior en la misma ventana.

### Evidencia de ejecución local — 2026-08-31 (rollback Docker)

Run completa con `DRILL_DOCKER=1` desde un worktree aislado en `8f44a84` (los
tags `prod-*` de release en formato `prod-YYYYMMDD-HHMM-<sha>` creados para el
rollback: deploy actual `prod-20260831-1320-00b24d6`, target `prod-20260831-1315-8f44a84`).

**Resultado: ✅ PASS** — 6 fases en 167.4 s (exit 0):

| Fase | Resultado | Detalle | Tiempo |
|---|---|---|---|
| PREP | PASS | imágenes del tag previo ya existen, sin build | 2.1 s |
| BASELINE | PASS | 11/11 checks (health, AI session/proxy/SSE, TTS, imagen, client-events, WS signaling) | 14.2 s |
| KILL | PASS | api caído, mocks vivos | 6.1 s |
| DETECT | PASS | `APP_CAIDA` detectado · `BUNDLE_CORRUPTO` probe OK (SRI) | 113.5 s |
| ROLLBACK | PASS | **CAMINO A (imagen por SHA) medido 12.2 s < 60 s (GATE)** — rollback exit 0 | 23.0 s |
| RE-VERIFY | PASS | 11/11 checks post-rollback | 0.2 s |

Hallazgos de la ejecución (corregidos durante el run):

1. **El drill no levantaba `redis`** — el api es fail-closed sobre
   `AI_PROXY_REDIS_URL` y BASELINE fallaba con `SESSION_STORE_UNAVAILABLE`;
   fix aplicado: `up -d ... redis` en `scripts/drill-rollback.mjs`.
2. **`rollback.mjs` exige tags `prod-YYYYMMDD-HHMM-<sha>`** (formato de
   `deploy-prod.mjs`); los tags con sufijo (`prod-YYYYMMDD-NNNN-<sufijo>`) los
   rechaza con `Invalid target tag format` — crear los tags de release con
   `scripts/deploy-prod.mjs`.
3. **Compose hardcodeaba `AI_SESSION_ORIGINS` a 18080** — corregido: ahora
   interpola `http://127.0.0.1:${HTTP_PORT:-18080},http://localhost:${HTTP_PORT:-18080}`
   en `docker-compose.staging.yml`, así el drill funciona con puertos no
   estándar (verificado: `HTTP_PORT=18085 docker compose config` → orígenes y
   puerto publicados a 18085; default 18080).
4. **En run local desde worktree**, el smoke necesita `node_modules` para el
   `import("ws")` dinámico (en CI lo instala `npm ci`).

Evidencia JSON del run (fases y tiempos) registrada en el artifact de CI.

### Evidencia de ejecución local (re-run) — 2026-08-31 (rollback Docker)

Re-ejecución completa con `DRILL_DOCKER=1` desde un worktree aislado en HEAD 
`949f6b7` (post fix de build hermenéutico + redis), sobre los mismos tags de 
release (deploy actual `prod-20260831-1320-00b24d6`, target `prod-20260831-1315-8f44a84`).

**Resultado: ✅ PASS** — 6 fases en 224.6 s (exit 0):

| Fase | Resultado | Detalle | Tiempo |
|---|---|---|---|
| PREP | PASS | imágenes del tag previo existentes (web/api:8f44a84), sin build | 2.3 s |
| BASELINE | PASS | 11/11 checks (build de imágenes HEAD + smoke: health, AI session/proxy/SSE, TTS, imagen, client-events, WS signaling) | 87.5 s |
| KILL | PASS | api caído, mocks vivos | 6.2 s |
| DETECT | PASS | `APP_CAIDA` detectado · `BUNDLE_CORRUPTO` probe OK (SRI) | 108.0 s |
| ROLLBACK | PASS | **CAMINO A (imagen por SHA) medido 9.6 s < 60 s (GATE)** — HEAD=8f44a84=target, rollback exit 0 | 17.2 s |
| RE-VERIFY | PASS | 11/11 checks post-rollback | 0.3 s |

Evidencia JSON del run (fases y tiempos) registrada en el artifact de CI.


## Prueba de carga del companion server

`npm run test:load` arranca un servidor aislado (límites propios + mock upstream
de IA) y valida los presupuestos de los SLO de esta sección:

- **Señalización:** p95 join < 500 ms y p95 relay en sala < 500 ms con carga
  concurrente; saturación: rechazo 1013 por encima de `MAX_CONNECTIONS` y
  `/health` 200 tras la ráfaga.
- **Proxy IA:** p95 de `/api/services/ai/generate` < 3 s contra el mock
  (latencia simulada configurable), tasa de éxito ≥ 99 % y cero 5xx del proxy.

Los límites anti-abuso se elevan a propósito (se mide capacidad, no throttling);
ese aspecto lo cubren los tests unitarios del servidor. Salida 0/1 (CI-ready),
con `--json` para consumo por pipelines. Presupuestos en `BUDGETS` al inicio
[del script](../scripts/load-test-server.mjs). Ejecutar trimestralmente y
registrar el resultado; primer run contra staging queda pendiente.

## Backups

El cliente dispone de backups automáticos cifrados en almacenamiento local y copia de disco cuando el navegador lo permite. El backup manual debe ser cifrado salvo decisión explícita del usuario.

Procedimiento mínimo mensual:

1. Crear backup cifrado de una instalación de referencia.
2. Verificar tamaño, formato y metadatos.
3. Restaurar en un perfil limpio de staging.
4. Comparar conteo y hashes de documentos no sensibles.
5. Registrar duración, resultado y versión.

No guardar contraseñas junto con backups. Las claves y los datos deben tener ciclos de vida y controles de acceso separados.

## Recuperación ante desastre

1. Declarar incidente y congelar despliegues.
2. Confirmar alcance y última copia válida.
3. Restaurar infraestructura desde imágenes por SHA.
4. Restaurar Redis sólo si contiene estado necesario; no usarlo como backup del vault.
5. Ejecutar smoke tests y healthchecks.
6. Verificar autenticación, licencias, IA y señalización.
7. Comunicar estado y documentar causa raíz.
8. Ejecutar postmortem y actualizar runbooks.

## Rollback

El rollback debe apuntar a una imagen previamente validada, no reconstruir desde `latest`. No debe borrar IndexedDB ni datos locales del usuario. Probar el procedimiento en staging antes de habilitarlo para producción.

## Rotación

Rotar inmediatamente cualquier secreto expuesto y, como mínimo, de forma periódica:

- claves de IA,
- API keys de licencias,
- tokens administrativos,
- claves TURN,
- claves de firma.
