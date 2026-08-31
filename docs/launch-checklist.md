# Checklist de pre-lanzamiento — BookmarkForge

- **Última revisión:** 2026-08-30
- **Fuente:** derivado de [docs/audit.md](audit.md), [docs/security.md](security.md), [docs/operations.md](operations.md) y [docs/internal-security-checklist.md](internal-security-checklist.md).
- **Cómo usar:** marca `[x]` cuando el punto esté completo. Cada punto indica dónde está la evidencia o el estado actual. "Evidencia" = documento/archivo donde verificar; "Gate" = comando automatizado que lo comprueba.

---

## 🔴 Bloqueante — sin esto, no lanzar

- [ ] **1. CODEOWNERS con equipos reales**
  Sustituir los placeholders `@YOUR_GITHUB_ORG/*` por los equipos reales de la organización. Mientras permanezcan, los cambios protegidos quedan bloqueados.
  - Evidencia: [.github/CODEOWNERS](../.github/CODEOWNERS), hallazgo en [docs/audit.md](audit.md) §2.
  - Gate: `npm run check:codeowners` (falla mientras existan placeholders); coherencia con la org configurada vía `CODEOWNERS_ORG` (CI).
  - **Pasos:**
    1. Crear los equipos en GitHub (org → Settings → Member privileges → Teams): `maintainers`, `security`, `platform`, `backend`, `frontend` (o los reales).
    2. Sustituir el placeholder con un solo comando (previsualiza antes con `--dry-run`):
       ```bash
       npm run codeowners:apply-org -- --org TU_ORG --dry-run
       npm run codeowners:apply-org -- --org TU_ORG
       ```
    3. Confirmar que el gate pasa: `npm run check:codeowners`.
    4. Configurar la variable de repositorio `CODEOWNERS_ORG=TU_ORG` en GitHub (Settings → Secrets and variables → Actions → Variables) para que CI valide la coherencia.
    5. Verificar manualmente en GitHub que los equipos existen y ven el repositorio (Settings → Collaborators and teams).

- [ ] **2. Protección de `main` importada y activa**
  Importar el ruleset `.github/rulesets/main-protection.json` en GitHub (Settings → Rules → Rulesets). Debe exigir PR, aprobaciones, Code Owners y checks obligatorios.
  - Evidencia: [.github/rulesets/main-protection.json](../.github/rulesets/main-protection.json), instrucciones en [.github/branch-protection.md](../.github/branch-protection.md).
  - Gate: `npm run check:launch-checklist` — valida que el payload sea correcto para la API (checks obligatorios presentes y **sin** campos de export como `source`/`id`).
  - **Pasos:**
    1. Importar en GitHub: **Settings → Rules → Rulesets → New branch ruleset → Import a ruleset** con `.github/rulesets/main-protection.json`, o vía API:
       ```bash
       gh api --method POST -H 'Accept: application/vnd.github+json' \
         /repos/ORG/REPO/rulesets --input .github/rulesets/main-protection.json
       ```
    2. Sustituir los placeholders de [.github/CODEOWNERS](../.github/CODEOWNERS) antes de activarlo si `require_code_owner_review` está habilitado (punto 1).
    3. Abrir un PR de prueba que toque criptografía/infraestructura y comprobar owners y checks.
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
  - Evidencia: [docs/ROPA.md](ROPA.md) (plantilla de cierre RGPD — completar los campos `⚠ COMPLETAR`), [docs/security.md](security.md) → "RGPD" (controles técnicos ≠ certificación legal); reconocido como deuda en [docs/audit.md](audit.md) §2 y §5.
  - **Pasos:**
    1. Completar en [docs/ROPA.md](ROPA.md) los campos `⚠ COMPLETAR`: responsable (§1), base jurídica y retención de logs (§3/§5), DPA firmados (§7), mecanismo de transferencia por proveedor (§8), registro de consentimiento (§9), contactos y plazos del procedimiento de incidentes (§10), responsable de la revisión trimestral (§12).
    2. Verificar que la tabla Art. 6 del inventario (§3) refleja el despliegue real antes de lanzar.
    3. Confirmar con revisión legal (la plantilla es operativa, no un dictamen).

---

## 🟠 Validación externa — revisión independiente

- [ ] **6. Pentest (prueba de ataque real)**
  Probar el proxy de IA, sesiones, integraciones, WebSocket y flujos de backup. Documentado como pendiente.
  - Evidencia: [docs/audit.md](audit.md) §2 ("Pentest documentado como pendiente"), [docs/security.md](security.md) → "Validación externa requerida", [docs/internal-security-checklist.md](internal-security-checklist.md) → "No se puede verificar localmente".

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
  - Gate: tests unitarios `src/tests/server/business-analytics.test.ts` y `src/tests/services/analyticsForwarder.test.ts`; smoke end-to-end verificado (POST 204, KPIs 200, 401 sin token, 400 inválido).

- [x] **11. Prueba de carga del companion server**
  Validar los límites actuales (conexiones WS, rate limits, proxy IA) con carga real. Implementado en [scripts/load-test-server.mjs](../scripts/load-test-server.mjs) (`npm run test:load`): arranca el servidor aislado contra un mock upstream de IA y valida los presupuestos alineados con los SLO de [docs/operations.md](operations.md) — p95 join y relay de señalización < 500 ms, p95 del proxy IA < 3 s, éxito ≥ 99 %, saturación (rechazo 1013 por encima de `MAX_CONNECTIONS`) y `/health` vivo bajo carga.
  - Evidencia: [scripts/load-test-server.mjs](../scripts/load-test-server.mjs), `npm run test:load`, `--json` para CI. Pendiente operativo: primer run contra staging con carga real.

- [ ] **12. Contratos versionados con integraciones externas**
  Documentar formalmente los contratos (p. ej. OpenAPI) con Whop y los proveedores de IA. Riesgo de dependencia sin contrato versionado.
  - Evidencia: [docs/audit.md](audit.md) §1 ("Integraciones | Mixto") y §5 (Whop).

- [ ] **13. Simulacro de desastre trimestral**
  El drill mensual de restauración ya existe (`npm run drill:backup-restore`); falta el ensayo completo trimestral de recuperación registrado (RPO/RTO).
  - Evidencia: [docs/operations.md](operations.md) → "Simulacro de restauración (drill mensual)" y "Recuperación ante desastre"; [docs/audit.md](audit.md) §6 ("simulacro trimestral sin ejecutar").

- [ ] **14. Checklist de publicación de extensiones**
  Preparar la publicación en Chrome Web Store / AMO (descripción, capturas, política de privacidad de la extensión).
  - Evidencia: [docs/audit.md](audit.md) §5 ("Falta checklist ASO/tiendas de extensiones").

---

## 🟢 Verificación del entorno — no verificable desde el repositorio

- [ ] **15. Secretos, environments y revisores de GitHub Actions**
  Revisar qué secretos existen, qué entornos están configurados y quién puede lanzar despliegues.
  - Evidencia: [docs/internal-security-checklist.md](internal-security-checklist.md) → "No se puede verificar localmente" (configuración de environments y revisores).

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
