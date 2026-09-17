# Que nos falta — deuda pendiente del pre-lanzamiento

> Estado del working tree: **2026-09-17 — revisión de deudas tras las rondas 10–11**. Este archivo documenta lo que falta
> para el lanzamiento público. Las fuentes vivas son `docs/audit.md`,
> `docs/launch-checklist.md`, `docs/ROPA.md` y `docs/ops-nightly.md` — este
> archivo es el índice consolidado, no la autoridad.

## 1. Estado del working tree — cambios locales pendientes de commit

- Las rondas de auditoría 6–11 y los hardenings de tests están aplicados en el checkout, pero siguen sin commit porque no se debe crear un commit sin autorización explícita.
- El árbol contiene cambios relacionados y eliminaciones de artefactos obsoletos; no se ha descartado ni sobrescrito trabajo ajeno.
- `npm run typecheck`, `npx vitest run` y `npm run check` son la evidencia actual de consistencia local.
- Los artefactos de auditorías anteriores (`nightly-trends.svg`, `nightly-consistency.svg`, `blob-report/`, `.tmp-audit*`) no forman parte del checkout activo.

## 2. Infraestructura de GitHub sin configurar — ⚠️ BLOQUEANTE REMOTO (único)

- **No hay `git remote` configurado** — `git remote -v` vacío. Nada de lo anterior existe en GitHub
  hasta hacer `git push`. Ver `docs/github-secrets-and-push-runbook.md` para el push + secrets.
- **README con 5 URLs placeholder `OWNER/`** — intencionalmente retenido hasta tener slug real
  (ver §7 paso 2). Los badges apuntan a `OWNER/bookmarkforge`; sustituir tras `git remote add`.
- Gobernanza **mantenedor único** (`required_approving_review_count: 0`) — la protección es 7 checks
  fail-closed, no aprobadores externos.
- **Ruleset ` .github/rulesets/main-protection.json` sin importar** — payload `POST /repos/{owner}/{repo}/rulesets`
  listo (7 required_status_checks: Enforce mandatory security gates + Typecheck + Playwright E2E +
  Production build + Dependency review + CodeQL + Semgrep). Importar tras el push: Settings → Rules →
  Rulesets → Import, o `gh api --method POST /repos/ORG/REPO/rulesets --input .github/rulesets/main-protection.json`.
- **`kpi-staging` / `drill-quarterly` / `nightly.yml` 11 jobs + `sast.yml` + `dast-nightly.yml`** existen solo
  local — en GitHub no hay workflows hasta el push; la primera run de SAST/DAST/drill ocurrirá allí.

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

## 4. Cierre legal y organizativo (P0/P1, externos) — pendiente de firma humana

- **ROPA** (`docs/ROPA.md` 2026-08-31, revisión trimestral §12 fijada): cierre operativo 100% (T1-T8,
  bases Art.6, retención, derechos, procedimiento 72h Arts.33-34). Quedan solo campos
  `⚠ DATO PERSONAL` no deducibles del repo: identidad legal/sede/autoridad de control (§1) y
  **DPA firmados** por proveedor (§7 hosting/Sentry, §8 transferencias IA). `launch-checklist` #5 PASS
  en local porque los campos operativos están completos — el resto es firma externa.
- **Sentry**: `src/telemetry/remoteErrorReporter.ts` con `beforeSend` sancador + opt-in por evento,
  `VITE_SENTRY_DSN` vacío por defecto (correcto). Activarlo exige DSN real **y** DPA Sentry (ROPA §7).
- **RPO/RTO y SLOs** — baselines registrados en `docs/operations.md` (99.9%/30d,
  p95 señalización <500ms, 5xx <0.5%, WS <70%; RPO 24h, RTO 24h vault/4h topología). Drills miden
  RTO empírico (rollback <60s verificado 9.6s, restore <120s verificado 6.6s); pendiente solo
  confirmación firmada del responsable (launch-checklist #3 PASS local).
- **Pentest real** documentado como pendiente (no hay evidencia de ataque externo) — launch-checklist #6 MANUAL.
- **Revisión manual WCAG/privacidad** pendiente — axe-core WCAG A/AA automatizado existe (`tests/e2e/a11y.spec.ts`);
  pendiente la pasada humana (lector pantalla/teclado/contraste) — launch-checklist #7 MANUAL.

## 5. Documentación que falta o está incompleta (gaps conocidos de AGENTS.md) — residual

- **Modelo Lifetime + Help (2026-09-13 en disco, pendiente commit):** pricing lifetime versionado
  (`src/constants/pricing.ts` Free/Pro $59→$79/Founder $99, v1 12 meses + security forever, v2 60% off),
  Help Center `/help` (`public/help.html` + `/help` routing + `supportDiagnostics.ts` + SLA Pro 48h/Founder 24h),
  FAQ 6x + JSON-LD 4 Offers. Ops actualizado en `docs/operations.md` §Modelo comercial. Pendiente
  reflejar en `launch-checklist` si se quiere gate de pricing/SLA.
- **Registro ADR — completo 2026-09-13**: 19 ADRs vivos (001/019/026/027/028/029/030/032/033/034/037/038/039/040/042/043/044/045/046;
  ver `docs/docs-state-index.md` + `AGENTS.md` §7). **ADR-040 ya implementado** (`scripts/check-docs-markdown.mjs`
  + `scripts/docs-markdown-baseline.json`, 44 files, 4 reglas, integrado en `npm run check` y aceptado por el
  freeze). **ADR-042** temas solo-CSS decidido (D4 `ThemeService.ts`). Números libres sin asignar: 031/035/036/041.
- **`eslint-rules/README.md` ya existe** y documenta las reglas custom; este gap
  queda cerrado. Mantenerlo actualizado al añadir nuevas reglas.
- **`docs/architecture.md` → "Decisiones pendientes"**: persistencia central
  multiusuario (abierta a propósito), política formal de migraciones RxDB
  (abierta a propósito), y SLO/RPO/RTO (arriba).
- **Cobertura de `docs/architecture.md`** declarada como gap en AGENTS.md
  (verificar qué secciones del sistema no están cubiertas).
- **`.husky/pre-commit` no existe** — husky está en `prepare` pero sin hook;
  CI es el punto de enforcement (documentado en AGENTS.md, pero el hook local
  sería más rápido de feedback).

## 6. Deuda técnica conocida (código) — menor, no bloqueante

- **Baseline visual 2026-09-02 — aceptado y versionado**: `settings-panel-chromium-win32.png` regenerado (+54.3%
  deriva) tras capturar splash `Loading…` por carrera lazy de `Settings`. Fix: `Suspense fallback={null}` en
  `MainApp.tsx` + espera de diálogo. Nuevo baseline 2.477 colores vs 186, fingerprint estable — commiteado
  en `e50bfa8`; `check:baseline-drift` hoy en verde local.
- **Test flaky**: `scripts/__tests__/monitoring-alerts.test.mjs` → `API_DEGRADADO end-to-end` flaky en run
  completo (latencia real con timers), PASS aislado. No afecta nightly; ruido en `test:fast` — inyectar
  reloj/retries o marcar `retry` cuando se toque ese área.
- **Nightly ops — opcionales sugeridos (no solicitados)**: extraer `Sign SVG URL`/`Rewrite summary` a action
  compuesta (duplicado hoy en `nightly-trends`/`nightly-consistency`); lifecycle del bucket S3 presigned
  (objetos caducan por URL pero no se borran — decidir cleanup); paridad de rampa `streak 1→N→gate` en SVG
  de consistencia (hoy solo en tendencias).

## 7. Orden sugerido de ejecución — actualizado 2026-09-13

1. **Commitear la migración Lifetime** (§1) — 80 ficheros en disco (pricing + help + landings + routing).
2. **Configurar el remote** y sustituir `OWNER` en el README (§2) — `docs/github-secrets-and-push-runbook.md`.
3. **Importar el ruleset de `main`** y verificar los 7 checks obligatorios (PR dummy).
4. **Secrets reales** (webhooks, `STAGING_ANALYTICS_ADMIN_TOKEN`, `STAGING_URL`, DSN Sentry) (§3).
5. **Cierre legal** (identidad ROPA §1, DPA firmados, RPO/RTO/guardia firmados) (§4) — externo, paralelo.
6. **Docs residual** (`eslint-rules/README.md` si se quiere índice) (§5).
7. **Deuda técnica** (§6) — post-launch, no bloqueante.
