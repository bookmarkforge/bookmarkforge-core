# Release note — Ronda 3/4: Drill trimestral de DR + Gate nocturno de KPIs

- **Fecha:** 2026-08-31
- **Rama:** `main` · **Commit base del rango:** `b2d371a` → `949f6b7` (ronda) — HEAD actual incluye además fixes de estabilidad de otra sesión (`d789c83`)
- **Alcance:** operaciones/CI, monitoreo, producto
- **Impacto en puntuación global (docs/audit.md):** **9.0 → 9.2/10**

---

## Resumen ejecutivo

La ronda 3/4 formaliza los dos últimos gaps operativos pendientes de la release:
(1) el **simulacro de desastre (DR) trimestral** ahora es un workflow de CI con
rollback real por imagen, y (2) la **analítica de negocio opt-in** deja de ser un
colector pasivo y pasa a ser un **gate nocturno vigilado** con umbrales y alertas.
Ambos drills se ejecutaron **completos en PASS** contra el stack local como
evidencia de que la cadena funciona. Ningún gate se rompió.

## Qué se entregó

### 1. Drill trimestral de desastre (DR) — `feat(drill)`

| Entrega | Detalle |
|---|---|
| `drill-quarterly.yml` | Workflow trimestral (cron + dispatch manual): job `backup-restore` (RTO < 120 s) y job `rollback-docker` (CAMINO A por imagen < 60 s, imágenes reales del tag `prod-*` previo vía worktree) |
| Job `drill-backup-restore` en `nightly.yml` | Ensayo **mensual** de backup-restore (día 1 de mes 03:17 UTC + dispatch) con alerta de degradación de RTO (`drill_rto_degraded` → webhook HTTPS `DRILL_ALERT_WEBHOOK_URL`, sin fallar la run) |
| Job `kpi-collector-local` en `drill-quarterly.yml` | Valida el collector de analítica contra un **servidor local** (sin staging/secretos): `createAnalyticsHandler` en 127.0.0.1 + POST `/api/analytics/events` en vivo + gate `kpi-report` con umbrales exactos |
| Fix de build hermenéutico | `Dockerfile` stage `deps` con `--ignore-scripts` (husky roto con `--omit=dev` bloqueaba el rollback por imagen) + nginx no-root con `pid` sobre `/tmp` |
| Fix de redis en el drill | `up -d ... redis` — el api es fail-closed sobre `AI_PROXY_REDIS_URL`; sin redis, BASELINE fallaba con `SESSION_STORE_UNAVAILABLE` |

### 2. Gate nocturno de KPIs — `feat(monitoring)`

| Entrega | Detalle |
|---|---|
| `kpi-report.mjs` | Informe + gate: umbrales `KPI_MIN_DAU/WAU/MAU`, `KPI_MIN_D7/D30_PCT`; evento `analytics_kpi_below_threshold` + webhook HTTPS cuando un KPI cae |
| Webhook Slack-native | Detección de URLs `hooks.slack.com` → payload `{text, blocks}` mrkdwn sin PII; otros webhooks HTTPS mantienen el JSON estructurado; `http` se rechaza |
| Job `kpi-staging` en `nightly.yml` | Correla `kpi-report` contra staging con token admin (`STAGING_ANALYTICS_ADMIN_TOKEN`); por debajo de umbral → run FAIL (página durable) |
| Harness `kpi-local-collector-check.mjs` | Dataset determinista con cohorte D7 madura; valida ingesta + agregación + gate sin depender de un entorno desplegado |

## Evidencia de gates (verificada 2026-08-31)

| Gate | Resultado |
|---|---|
| `check:workflows` (8 workflows) | ✅ |
| `check:audit-drift` / `audit-drift:strict` | ✅ |
| `check:image-pins` / `check:secrets-in-commit` / `check:env` / `check:input-contracts` | ✅ |
| `npm run lint` | ✅ sin violaciones |
| `npm run test:fast` | ✅ 633 tests / 28 archivos + batch completo de 62 archivos |
| Tests de scripts (drill + KPI) | ✅ 25/25 (`drill-backup-restore` 8/8 · `kpi-report` 17/17) |
| `check:codeowners` | ⚠️ único en rojo — placeholder `@YOUR_GITHUB_ORG/*` (decisión de org, externa) |

## Ejecución real de los drills (evidencia)

### Rollback Docker — `DRILL_DOCKER=1` · ✅ PASS (re-run sobre HEAD `949f6b7`)

| Fase | Resultado | Tiempo |
|---|---|---|
| PREP (imágenes del tag previo) | PASS | 2.3 s |
| BASELINE (11/11 checks, incl. build imágenes HEAD + WS signaling) | PASS | 87.5 s |
| KILL (api caído, mocks vivos) | PASS | 6.2 s |
| DETECT (`APP_CAIDA` + `BUNDLE_CORRUPTO` SRI) | PASS | 108.0 s |
| ROLLBACK **CAMINO A (imagen por SHA)** | PASS | **9.6 s < 60 s (gate)** |
| RE-VERIFY (11/11 post-rollback) | PASS | 0.3 s |

Exit 0 · 6 fases · 224.6 s. (Primera ejecución de la ronda: PASS 167.4 s, CAMINO A 12.2 s.)

### Backup-restore mensual — `npm run drill:backup-restore` · ✅ PASS

| Fase | RTO medido | Gate |
|---|---|---|
| restore_plaintext (JSON) | 6.5 s | < 120 s |
| restore_bmf (cifrado .bmf) | 6.6 s | < 120 s |
| playwright spec | 2 passed / 0 failed | exit 0 |
| rto_gate | sin degradación (`degraded: []`) | < 120 s |

Evidencia completa en `docs/operations.md` → "Simulacro de restauración (drill mensual)" y "Evidencia de ejecución local (re-run) — rollback Docker".

## Impacto en puntuaciones (docs/audit.md)

| Área | Antes | Después |
|---|---|---|
| 5. Producto / Negocio | 9.0 | **9.2** |
| 6. Operaciones / Monitoreo | 8.8 | **9.3** |
| **Global** | **9.0** | **9.2** |

## Deudas pendientes para la release (externas, sin cambios de código)

1. **CODEOWNERS** con `@YOUR_GITHUB_ORG/*` — sustituir org + importar ruleset `main-protection.json`.
2. **Cierre legal RGPD** — ROPA con ~34 campos `⚠ COMPLETAR`.
3. **Sentry** — DSN + DPA antes de activar trazabilidad ex-post.
4. **Activación en GitHub** — push de `main` + tags `prod-*`, secrets/vars de los jobs (`STAGING_ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_ALERT_WEBHOOK_URL`, `DRILL_ALERT_WEBHOOK_URL`, `KPI_MIN_*`, `STAGING_URL`, `DRILL_RTO_*`). Los workflows aún no existen en el remoto.
5. **RPO/RTO oficiales** — confirmación firmada (los drills miden RTO empírico: rollback < 60 s, restore < 120 s).

---

*Verificación reproducible:* `npm run check:workflows` · `npm run lint` · `npm run test:fast` · `DRILL_DOCKER=1 node scripts/drill-rollback.mjs --json` · `node scripts/drill-backup-restore.mjs --json`
