# Que nos falta — deuda pendiente del pre-lanzamiento

> Estado del working tree: **2026-09-01**. Este archivo documenta lo que falta
> para el lanzamiento público. Las fuentes vivas son `docs/audit.md`,
> `docs/launch-checklist.md`, `docs/ROPA.md` y `docs/ops-nightly.md` — este
> archivo es el índice consolidado, no la autoridad.

## 1. El working tree está sin commitear (bloqueo #1)

- **105 archivos modificados + 22 sin trackear** — toda la capa de operaciones
  del nightly (scripts, tests, workflow, docs) y la auditoría de seguridad
  siguen **sin commitear** en el working tree.
- Si se pierde el checkout o se hace un push parcial, se pierde trabajo no
  versionado. **Antes de nada**: revisar el diff, commitear por unidades
  lógicas (AGENTS.md dice "no staging amplio, stage exactamente lo del commit").
- Ficheros huérfanos en la raíz que probablemente son artefactos de test:
  `nightly-trends.svg`, `nightly-consistency.svg`, `nightly-trends-summary.md`,
  `blob-report/` — decidir si se suben como baselines o se ignoran.

## 2. Infraestructura de GitHub sin configurar

- **No hay `git remote` configurado** — no se puede pushear nada. `git remote -v`
  devuelve vacío.
- **README con 5 URLs placeholder `OWNER/`** (badges de CI, nightly, cobertura,
  runs fallidos, último release). Hasta que exista el remote real no se puede
  sustituir el slug.
- **CODEOWNERS inexistente** — único gate en rojo (P0). Requiere crear los 5
  equipos en la org y ejecutar `codeowners:apply-org` (ver `scripts/apply-codeowners-org.mjs`).
- **Ruleset `main-protection.json` sin importar** — la protección de `main`
  (checks obligatorios, SAST como required) existe como archivo local pero no
  está activa en GitHub.
- **`kpi-staging` / `drill-quarterly`**: el código y los workflows existen
  localmente pero **nunca se han pusheado** — en GitHub aún no existen esos
  jobs en `nightly.yml` (nota del audit.md §P1-4; `drill-quarterly.yml` ya está
  en `.github/workflows/`).

## 3. Secrets y credenciales reales (código listo, sin valores)

- **Webhooks Slack reales**: `NIGHTLY_ALERT_WEBHOOK_URL`, `ANALYTICS_ALERT_WEBHOOK_URL`,
  `DRILL_ALERT_WEBHOOK_URL` — el envío está codificado y testeado, pero necesita
  las URLs reales como secrets de GitHub.
- **`STAGING_ANALYTICS_ADMIN_TOKEN`** (required para `kpi-staging`; el script
  falla closed sin él).
- **Bucket S3 + credenciales AWS para el embed presigned** de los SVGs
  (`TRENDS_SVG_BUCKET`, `CONSISTENCY_SVG_BUCKET`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`) — documentados en `.env.example` y `docs/ops-nightly.md`,
  sin valores reales. **Falta además decidir el cleanup del bucket**
  (lifecycle o borrado post-run) para no acumular objetos con URLs caducadas.

## 4. Cierre legal y organizativo (P0/P1, externos)

- **ROPA con campos `⚠ COMPLETAR` pendientes** (responsable, base jurídica,
  DPAs, transferencias, incidencias — ~34 campos según audit.md). Marcar el
  checklist solo cuando no quede ninguno.
- **Sentry**: código con redacción PII y opt-in listo (`src/telemetry/remoteErrorReporter.ts`),
  falta `VITE_SENTRY_DSN` real + firmar el DPA (ROPA §7).
- **RPO/RTO y SLOs sin confirmación firmada** — los drills miden RTO empírico
  (rollback < 60 s, restore < 120 s) pero falta la firma del objetivo oficial.
- **Pentest real** documentado como pendiente (no hay evidencia de ataque externo).
- **Revisión manual WCAG/privacidad** pendiente (la a11y automatizada axe-core
  existe y es fuerte; la manual no).

## 5. Documentación que falta o está incompleta (gaps conocidos de AGENTS.md)

- **Registro ADR**: completado para el catálogo de anclas — ADR-001/019/026/027/028/
  029/030/032/033/034/037 existen en disco (ver `AGENTS.md` §7); ADR-040/042
  aparecen solo en prosa (freeze de inspectores, `ThemeService`) y ADR-031/035/036
  no están asignados. Pendiente opcional: crear los registros restantes.
- **`eslint-rules/README.md` no existe** (las reglas custom se auto-documentan
  en headers, pero falta el índice).
- **`docs/architecture.md` → "Decisiones pendientes"**: persistencia central
  multiusuario (abierta a propósito), política formal de migraciones RxDB
  (abierta a propósito), y SLO/RPO/RTO (arriba).
- **Cobertura de `docs/architecture.md`** declarada como gap en AGENTS.md
  (verificar qué secciones del sistema no están cubiertas).
- **`.husky/pre-commit` no existe** — husky está en `prepare` pero sin hook;
  CI es el punto de enforcement (documentado en AGENTS.md, pero el hook local
  sería más rápido de feedback).

## 6. Deuda técnica conocida (código)

- **Test flaky**: `scripts/__tests__/monitoring-alerts.test.mjs` →
  `API_DEGRADADO end-to-end` falla intermitentemente en el run completo
  (basado en latencia real con temporizadores) y pasa aislado. No está
  relacionado con el nightly, pero es ruido en cada `test:fast` y puede
  enmascarar fallos reales — arreglarlo (injectar reloj/retries) o marcarlo.
- **Nightly ops — pendientes opcionales sugeridos** (no solicitados aún):
  - Extraer los pasos `Sign SVG URL` / `Rewrite summary` a una action
    compuesta reutilizable (hoy duplicados en `nightly-trends` y
    `nightly-consistency`).
  - Cleanup del bucket S3 (ver §3).
  - Paridad de leyenda de rampa en el SVG de consistencia (el de tendencias ya
    tiene `streak 1 → N → gate`; consistencia aún no).

## 7. Orden sugerido de ejecución

1. **Commitear el working tree** (§1) — nada más puede avanzar sin versión.
2. **Configurar el remote** y sustituir `OWNER` en el README (§2).
3. **Importar ruleset + CODEOWNERS** (desbloquea el único gate rojo).
4. **Secrets reales** (webhooks, token staging, DSN Sentry) (§3).
5. **Cierre legal** (ROPA, DPA, RPO/RTO firmado) (§4) — externo, paralelo.
6. **Docs** (ADR registry, eslint-rules/README) (§5) — barato, elimina gaps del repo.
7. **Deuda técnica** (§6) — test flaky primero, después refactors opcionales.
