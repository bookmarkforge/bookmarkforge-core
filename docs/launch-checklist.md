# Checklist de pre-lanzamiento — BookmarkForge

- **Última revisión:** 2026-09-12
- **Fuente:** derivado de [docs/audit.md](audit.md), [docs/security.md](security.md), [docs/operations.md](operations.md) y [docs/internal-security-checklist.md](internal-security-checklist.md).
- **Cómo usar:** marca `[x]` cuando el punto esté completo. Cada punto indica dónde está la evidencia o el estado actual. "Evidencia" = documento/archivo donde verificar; "Gate" = comando automatizado que lo comprueba.
- **Programa Security Champions:** Ver [`.github/SECURITY_CHAMPIONS.md`](../.github/SECURITY_CHAMPIONS.md) para designación, responsabilidades y escalamiento.

---

## 🔴 Bloqueante — sin esto, no lanzar

- [ ] **1. `Enforce mandatory security gates` activo en rama `main`**
   El ruleset `.github/rulesets/main-protection.json` debe incluir `Enforce mandatory security gates` como check obligatorio. Este gate ejecuta `npm run check:security-internal` en cada PR.
   - Evidencia: [.github/rulesets/main-protection.json](../.github/rulesets/main-protection.json), [.github/branch-protection.md](../.github/branch-protection.md).
   - Gate: `npm run check:launch-checklist` — valida que el payload sea correcto para la API (`Enforce mandatory security gates` presente y **sin** campos de export como `source`/`id`).
   - **Pasos:**
     1. Verificar que el ruleset importado en GitHub incluye `Enforce mandatory security gates`.
     2. Abrir un PR de prueba que toque criptografía/infraestructura y comprobar que el check bloquea cambios si falla.
   - Pendiente manual: reimportar el ruleset tras cualquier cambio en los checks obligatorios.

- [ ] **2. Protección de `main` importada y activa**
  Importar el ruleset `.github/rulesets/main-protection.json` en GitHub (Settings → Rules → Rulesets). Debe exigir PR y checks obligatorios; el repositorio tiene un único mantenedor y no depende de aprobación externa.
  - Evidencia: [.github/rulesets/main-protection.json](../.github/rulesets/main-protection.json), instrucciones en [.github/branch-protection.md](../.github/branch-protection.md).
  - Gate: `npm run check:launch-checklist` — valida que el payload sea correcto para la API (checks obligatorios presentes y **sin** campos de export como `source`/`id`).
  - **Pasos:**
    1. Importar en GitHub: **Settings → Rules → Rulesets → New branch ruleset → Import a ruleset** con `.github/rulesets/main-protection.json`, o vía API:
       ```bash
       gh api --method POST -H 'Accept: application/vnd.github+json' \
         /repos/ORG/REPO/rulesets --input .github/rulesets/main-protection.json
       ```
    2. Abrir un PR de prueba que toque criptografía/infraestructura y comprobar que los checks obligatorios bloquean cambios si fallan.
  - Pendiente manual: reimportar el ruleset tras cualquier cambio en los checks obligatorios.

- [ ] **3. RPO/RTO y SLOs registrados y confirmados**
  Los valores de referencia ya existen en `docs/operations.md`; falta **confirmarlos oficialmente** (aprobación del responsable) y fijar revisión trimestral.
  - Evidencia: [docs/operations.md](operations.md) → "SLOs y objetivos": disponibilidad 99,9% (30 días), p95 proxy IA < 3 s, p95 señalización < 500 ms, 5xx < 0,5%, saturación WS < 70%, error-spike 0; **RPO 24 h**, **RTO 24 h** (vault) / **4 h** (topología servidor).
  - Deuda conocida: [docs/architecture.md](architecture.md) → "Decisiones pendientes" (SLO/RPO/RTO sin fijar formalmente).

- [ ] **4. Responsable y canal de alertas antes del lanzamiento**
  Nombrar quién recibe los avisos de incidentes y el canal de contacto (página de estado, email).
  - Evidencia: [docs/operations.md](operations.md) → "Guardia: responsables y canal de alertas deben registrarse antes del lanzamiento público".

- [ ] **5. Cierre legal RGPD**
  Documentar: responsable del tratamiento, finalidades, base jurídica, minimización, retención, derechos, encargados/subencargados, transferencias internacionales, consentimiento y procedimiento de incidentes.
  - Evidencia: [docs/ROPA.md](ROPA.md) — **campos operativos rellenados (2026-08-31)**: bases jurídicas y retención por tratamiento (§3/§5), registro de consentimiento y plazos de respuesta (§9), procedimiento de incidentes (§10), revisión trimestral fijada (§12). Quedan solo campos `⚠ DATO PERSONAL`: identidad legal del operador (§1), autoridad de control (§1), DPA firmados por proveedor (§7/§8). [docs/security.md](security.md) → "RGPD" (controles técnicos ≠ certificación legal); reconocido como deuda en [docs/audit.md](audit.md) §2 y §5.
  - **Pasos restantes (externos, del operador):**
    1. Rellenar §1: nombre legal, sede y autoridad de control competente.
    2. Firmar/conservar los DPA por proveedor (§7/§8): hosting, Sentry, proveedores de IA.
    3. Confirmar con revisión legal (la plantilla es operativa, no un dictamen).

---

- [ ] **16. Smoke de rutas críticas en verde contra la build de producción**
  Batería Playwright de 7 tests que ejercita las rutas que no pueden fallar el día 1: bóveda con contraseña de 12 caracteres, recuperación con la frase de 24 palabras, activación de licencia Pro con firma real (+ clave inválida fallando cerrado) y round-trip de backup cifrado .bmf tras pérdida total simulada.
  - Evidencia: [docs/launch-day-smoke.md](launch-day-smoke.md) (runbook: topología, triage, relación con claves de firma).
  - Gate: `npm run smoke:launch` — veredicto "ALL CRITICAL PATHS GREEN — cleared to release".
  - Complemento de dispositivo real: certificar un iPhone con [docs/ios-manual-test-script.md](ios-manual-test-script.md) (creación de bóveda, frase de 24 palabras, backup .bmf fuera del dispositivo y la expulsión de IndexedDB de Safari a los 7 días) — Android emulado queda cubierto por `npm run e2e:mobile`.
  - Complemento de dispositivo real para sync: certificar el emparejamiento P2P iPhone ↔ escritorio con [docs/p2p-sync-manual-test-script.md](p2p-sync-manual-test-script.md) (doble QR con cámaras reales, sync en la LAN, conflictos LWW y verificación air-gapped) — la lógica ya está automatizada en `tests/e2e/vault-sync-real.spec.ts`.

## 🟠 Validación externa — revisión independiente

- [ ] **6. Pentest (prueba de ataque real)**
   Probar el proxy de IA, sesiones, integraciones, WebSocket y flujos de backup. Documentado como pendiente.
   - Evidencia: [docs/audit.md](audit.md) §2 ("Pentest documentado como pendiente"), [docs/security.md](security.md) → "Validación externa requerida", [docs/internal-security-checklist.md](internal-security-checklist.md) → "No se puede verificar localmente".
   - **Progreso:** `scripts/penetration-test.mjs` — runner de pentest con 7 fases (reconocimiento, escaneo de vulnerabilidades, pruebas de autenticación, revisión criptográfica, OWASP Top 10, lógica de negocio, generación de informe). Flujo CI en `.github/workflows/pen-test.yml` (mensual + pre-producción).
   - Gate: `node scripts/penetration-test.mjs --target <url> --scope full` genera informes JSON/MD en `pen-test-reports/`. Todos los hallazgos CRITICAL y HIGH deben remediarse antes del despliegue a producción.

- [ ] **7. Revisión manual de accesibilidad (WCAG) y privacidad**
  La revisión automática (axe-core WCAG A/AA en CI) ya existe; falta la revisión manual con personas (lector de pantalla, teclado, contraste) y la revisión humana de la política de privacidad.
  - Evidencia: [docs/audit.md](audit.md) §4 ("Revisión manual WCAG documentada como pendiente"), [docs/security.md](security.md) → "Validación externa requerida".

- [ ] **8. SAST independiente (CodeQL + Semgrep) en CI**
  Capa de análisis estático independiente con política de severidad (bloquear High/Critical) y anotaciones en los PR.
  - Evidencia: [.github/workflows/sast.yml](../.github/workflows/sast.yml) (jobs "CodeQL analysis" y "Semgrep analysis"), `scripts/check-sarif-severity.mjs` con tests, [guía de triage del primer run](sast-triage.md); añadidos como checks obligatorios en el ruleset de `main` (pendiente reimportarlo en GitHub).
  - Gate: `npm run check:workflows` (valida los workflows), `npm run check:sarif-severity` (gate sobre un SARIF).
  - Pendiente: ejecutar el primer run (workflow_dispatch), triagear los hallazgos y registrar el resultado en `docs/sast-triage-log.md` (plantilla en `docs/sast-triage.md` §7).

---

## 🟡 Poco después del lanzamiento (primer trimestre)

- [ ] **9. Registro de errores con redacción PII y opt-in**
  Error reporting remoto (Sentry) con `beforeSend` sancador, **desactivado por defecto**: solo envía si el operador configura `VITE_SENTRY_DSN` **y** el usuario opta en el banner de consentimiento.
  - Evidencia: [src/telemetry/remoteErrorReporter.ts](../src/telemetry/remoteErrorReporter.ts) (URLs sin query, secretos redactados, sin identidad, consentimiento por evento; SDK con import dinámico), `@sentry/browser` en `package.json`, [docs/ROPA.md](ROPA.md) §3 T7 y §7, [docs/audit.md](audit.md) §6.
  - Gate: `npm run check:launch-checklist` (verifica dependencia + módulo con redacción y opt-in).
  - Pendiente operativo: configurar el DSN del operador y firmar el DPA con Sentry (ROPA §7) antes de activarlo en producción.

- [x] **10. Analítica de negocio opt-in (decisión tomada e implementada 2026-08-31)**
  Canal opt-in, agregado y no-PII: el cliente envía UN bucket diario por instalación (conteos por tipo de evento, sin contenido del vault, sin IP, sin id crudo — solo el SHA-256 de un id de instalación aleatorio) al companion server cuando el usuario opta en el banner (`forge_consent_analytics`, default OFF). El servidor agrega DAU/WAU/MAU, retención por cohorte D1/D7/D30 y funnel de activación; GET `/api/analytics/kpis` con token admin (`ANALYTICS_ADMIN_TOKEN`) y estado persistible (`ANALYTICS_STATE_FILE`).
  - Evidencia: [server/src/business-analytics.ts](../server/src/business-analytics.ts), [src/services/analyticsForwarder.ts](../src/services/analyticsForwarder.ts), `npm run kpi-report`, [docs/ROPA.md](ROPA.md) §3 T8 y §4.
  - Gate: tests unitarios `src/tests/server/business-analytics.test.ts` y `src/tests/services/analyticsForwarder.test.ts`; smoke end-to-end verificado (POST 204, KPIs 200, 401 sin token, 400 inválido). La vigilancia automatizada del canal es el ítem 19 (Gate nocturno de KPIs).

- [x] **11. Prueba de carga del companion server**
  Validar los límites actuales (conexiones WS, rate limits, proxy IA) con carga real. Implementado en [scripts/load-test-server.mjs](../scripts/load-test-server.mjs) (`npm run test:load`): arranca el servidor aislado contra un mock upstream de IA y valida los presupuestos alineados con los SLO de [docs/operations.md](operations.md) — p95 join y relay de señalización < 500 ms, p95 del proxy IA < 3 s, éxito ≥ 99 %, saturación (rechazo 1013 por encima de `MAX_CONNECTIONS`) y `/health` vivo bajo carga.
  - Evidencia: [scripts/load-test-server.mjs](../scripts/load-test-server.mjs), `npm run test:load`, `--json` para CI. Pendiente operativo: primer run contra staging con carga real.

- [ ] **12. Contratos versionados con integraciones externas**
  Documentar formalmente los contratos (p. ej. OpenAPI) con Whop y los proveedores de IA. Riesgo de dependencia sin contrato versionado.
  - Evidencia: [docs/audit.md](audit.md) §1 ("Integraciones | Mixto") y §5 (Whop).

- [x] **13. Simulacro de desastre trimestral (automatizado y ejecutado 2026-08-31)**
  El ensayo completo trimestral está formalizado en CI: `.github/workflows/drill-quarterly.yml` (primer día de cada trimestre + dispatch manual) ejecuta el drill de backup-restore (RTO < 120 s) **y** el drill de rollback Docker (CAMINO A por imagen < 60 s, imágenes reales del tag `prod-*` previo). Requiere ≥ 2 tags `prod-*` en el repo.
  - Evidencia: [.github/workflows/drill-quarterly.yml](../.github/workflows/drill-quarterly.yml), [docs/operations.md](operations.md) → "Simulacro trimestral de recuperación ante desastre" y "Evidencia de ejecución local (re-run) — rollback Docker"; [docs/drill-run-2026-08-31-rollback-docker.md](drill-run-2026-08-31-rollback-docker.md).
  - **Ejecutado (2026-08-31)** contra el stack local y tags `prod-*` reales (`prod-20260831-1320-00b24d6` → `prod-20260831-1315-8f44a84`):
    - **Rollback Docker** (`DRILL_DOCKER=1`): 6 fases, exit 0 — CAMINO A por imagen **9.6 s < 60 s (gate)** · BASELINE/RE-VERIFY 11/11 (re-run 224.6 s; primera run 167.4 s, CAMINO A 12.2 s).
    - **Backup-restore** (`npm run drill:backup-restore`): restore BMF 6.6 s / plaintext 6.5 s, gate RTO < 120 s, `degraded: []` (sin alerta).
    - **Ensayo mensual** en `nightly.yml` (job `drill-backup-restore`, día 1 de mes 03:17 UTC + dispatch) con alerta de degradación del RTO (`DRILL_ALERT_WEBHOOK_URL`).
  - Pendiente externo: primera run en CI — requiere push del repo a GitHub (los workflows aún no existen en el remoto) y ≥ 2 tags `prod-*` remotos; registrar el enlace de la run como evidencia trimestral.

- [ ] **14. Checklist de publicación de extensiones**
  Preparar la publicación en Chrome Web Store / AMO (descripción, capturas, política de privacidad de la extensión).
  - Evidencia: [docs/audit.md](audit.md) §5 ("Falta checklist ASO/tiendas de extensiones").

- [x] **19. Gate nocturno de KPIs (automatizado y verificado 2026-08-31)**
  La analítica opt-in (ítem 10) deja de ser un colector pasivo: `kpi-report.mjs` calcula DAU/WAU/MAU y retención D1/D7/D30 por cohorte y los contrasta con umbrales configurables (`KPI_MIN_DAU/WAU/MAU`, `KPI_MIN_D7/D30_PCT`); por debajo de umbral emite `analytics_kpi_below_threshold` y dispara un webhook HTTPS (payload nativo Slack para `hooks.slack.com`, sin PII; `http` rechazado). El job `kpi-staging` en `nightly.yml` lo corre contra staging (token admin `STAGING_ANALYTICS_ADMIN_TOKEN`) y **falla la run** si un KPI cae. El collector se valida a sí mismo en CI contra un servidor local (`kpi-collector-local` en `drill-quarterly.yml`).
  - Evidencia: [scripts/kpi-report.mjs](../scripts/kpi-report.mjs), [.github/workflows/nightly.yml](../.github/workflows/nightly.yml), [scripts/kpi-local-collector-check.mjs](../scripts/kpi-local-collector-check.mjs), [docs/operations.md](operations.md) → "Gate nocturno de KPIs" y "Conexión a Slack (Incoming Webhook)".
  - Gate: 17 tests unitarios de `kpi-report` (incl. detección de Slack y shape del payload); harness local ejecutado en PASS (DAU/WAU/MAU + retención D7 con umbrales exactos, exit 0).
  - Pendiente externo: configurar en GitHub los secrets (`STAGING_ANALYTICS_ADMIN_TOKEN`, `ANALYTICS_ALERT_WEBHOOK_URL`) y vars (`KPI_MIN_*`, `STAGING_URL`) y activar el token admin en staging (mismo valor que el secret).

---

## 🟢 Verificación del entorno — no verificable desde el repositorio

- [ ] **15. Secretos, environments y permisos de GitHub Actions**
  Revisar qué secretos existen, qué entornos están configurados y quién puede lanzar despliegues.
  - Evidencia: [docs/internal-security-checklist.md](internal-security-checklist.md) → "No se puede verificar localmente" (configuración de environments y permisos).

- [ ] **16. Seguridad real de staging y producción**
  Revisar la infraestructura desplegada: TLS, usuario no-root, Redis sin puerto público, puertos de staging ligados a loopback, etc. (el código fuerza casi todo; falta inspeccionar el despliegue).
  - Evidencia: [docs/security.md](security.md) → "Configuración obligatoria de producción"; [docs/internal-security-checklist.md](internal-security-checklist.md) → "No se puede verificar localmente".
  - Gates: `npm run check:http-config`, `npm run check:compose-config`, `npm run check:runtime-config`, `npm run check:docker-context`.

- [ ] **17. DAST autenticado activado**
  El escaneo ZAP nocturno básico ya corre; el autenticado permanece deshabilitado a propósito (`if: ${{ false }}`). Ya están verificados: contexto (`.zap/authenticated.context`), digest de imagen `sha256:781a2bda…5081ef` (tag stable) y SHA de la action `de8ad967…b8b25` (tag `v0.15.0`, tag anotado firmado PGP, verificado contra el release oficial). Falta: que staging suministre los secretos reales (`STAGING_DAST_CONTEXT_B64`, `STAGING_DAST_CONTEXT_PASSWORD`) y validar el scan autenticado contra el entorno.
  - Evidencia: [.github/workflows/dast-nightly.yml](../.github/workflows/dast-nightly.yml) (pasos deshabilitados con el contrato de credenciales documentado), [docs/internal-security-checklist.md](internal-security-checklist.md) → "No se puede verificar localmente".
  - Gates: `npm run check:zap-baseline`, `npm run check:zap-context`, `npm run check:zap-workflow`, `npm run check:workflows`.

- [ ] **18. Configuración obligatoria de producción verificada**
  `NODE_ENV=production`, `AI_SESSION_REQUIRE_LICENSE=1`, `AI_SESSION_ORIGINS` exactos, `ENFORCE_SIGNAL_HMAC=1`, `TRUST_PROXY` solo si procede, claves solo por secret manager.
  - Evidencia: [docs/security.md](security.md) → "Configuración obligatoria de producción".
  - Gate: `npm run check:env`, `npm run check:secrets-in-commit`.

---

## Evidencia automatizada (gates)

Ejecutar antes del lanzamiento y en CI; resultados conservados como evidencia (ver [docs/operations.md](operations.md) → "Preflight de release"):

```bash
npm ci
npm run typecheck:prod
npm run lint
npm run test
npm run build:ci
npm run check
npm run check:security-internal
npm run check:secrets-in-commit
npm run check:audit
```

Progreso del checklist (verifica lo verificable y marca el resto como manual):

```bash
npm run check:launch-checklist          # informe (exit 0)
npm run check:launch-checklist:strict  # falla si algún 🔴 bloqueante está sin completar
```

Ejecución automática del modo estricto: job `launch-readiness` en [.github/workflows/nightly.yml](../.github/workflows/nightly.yml) (verificación diaria) y Punto 10 del gate pre-deploy `scripts/check-blindeo.mjs` (bloquea despliegues a producción mientras haya bloqueantes abiertos, vía `deploy-prod.mjs` Fase A).

La lista completa de controles cubiertos y de lo que **no** puede verificarse localmente está en [docs/internal-security-checklist.md](internal-security-checklist.md).
