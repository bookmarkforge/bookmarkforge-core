# 🔍 SUPER-PROMPT: Auditoría Total y Corrección de BookmarkForge

> Instrucciones para un agente de IA: ejecuta la auditoría completa del proyecto **BookmarkForge**
> (app local-first de conocimiento personal: React 19 + TypeScript + RxDB/IndexedDB + WebRTC P2P +
> companion server Node/ws, monetización vía Whop, AGPL-3.0). Después de auditar el 100% de las
> áreas, **corrige todo lo que haga falta**, priorizando por severidad.

---

## ROL Y MÉTODO

1. **No inventes evidencia.** Cada veredicto debe citar archivos, líneas o comandos reales.
2. Trabaja por fases: (1) Inventario completo → (2) Auditoría por área → (3) Correcciones → (4) Verificación.
3. Ejecuta los checks del repo ANTES y DESPUÉS de cada corrección.
4. Respeta las convenciones existentes: documentos en español en `docs/`, scripts en `scripts/`, tests en `src/tests/` y `tests/` (Playwright en `tests/e2e/`).
5. No toques producción, no despliegues, no hagas push. Los cambios se quedan en el working tree.
6. Al terminar, actualiza `docs/audit.md` (si existe) o créalo con el resumen y puntuaciones, y reporta una tabla de hallazgos → acción → estado.

## 0) INVENTARIO (ejecutar primero)

```bash
git status --short                          # estado del working tree
git log --oneline -15                       # historial reciente
find . -maxdepth 2 -type d -not -path '*/node_modules/*' -not -path '*/.git/*' | sort
cat package.json                            # scripts, deps, devDeps, overrides
cat README.md                                # propósito, requisitos, doc links
ls docs/ .github/workflows/ scripts/ src/ server/ tests/ extension/ .zap/    # mapeo completo
```

Registra en una tabla: cada directorio, su propósito y los archivos clave con conteo de líneas.

## 1) ARQUITECTURA Y VIABILIDAD TÉCNICA

**Preguntas a responder (con evidencia):**
- ¿Es el stack adecuado? React/TS/Vite front, RxDB/IndexedDB datos, Node/ws server, WebRTC sync.
- ¿Límites de confianza claros? (`docs/architecture.md`): servidor nunca recibe el vault salvo consentimiento.
- ¿Escalabilidad? Redis opcional, límites de conexiones/rooms/peers/payloads, rate limits. ¿Faltan pruebas de carga?
- ¿Modularidad? `src/` (UI), `server/` (backend), `extension/`, `scripts/`, `docs/`. ¿Hay acoplamientos raros?
- ¿Integraciones estables? IA multi-proveedor + mocks en staging; Whop licencias. ¿Contratos versionados?

**Checks:** `npm run typecheck` · `npm run build:ci` · revisar `docs/architecture.md` vs realidad del código.

## 2) SEGURIDAD Y CUMPLIMIENTO LEGAL

**Preguntas:**
- Cifrado en tránsito: TLS/HSTS/`upgrade-insecure-requests` (`public/_headers`, nginx). ¿Config real?
- Cifrado en reposo: AES-GCM + Argon2id/HKDF en workers. ¿Cerraduras/borrado de memoria?
- Autenticación: sesiones IA efímeras (cookie HttpOnly + SameSite=Strict + CSRF doble). ¿OAuth2/JWT donde haga falta?
- XSS/inyección: DOMPurify, CSP, sin SQL (solo IndexedDB). ¿Sanitización en todos los render de HTML?
- Secretos: `npm run check:secrets-in-commit` (¿falla? ¿hay claves reales commiteadas?).
- Políticas RGPD: `public/privacy-and-terms.html`, inventario de tratamientos, retención, derechos, consentimiento (`ConsentBanner`, keys `forge_consent_*`).
- DAST: `.zap/`, `dast-nightly.yml`. SAST: `sast.yml` (¿existe?, ¿qué severidad bloquea?).

**Checks:** `npm run check:security-internal` · `npm run check:secrets-in-commit` · `npm run check:zap-baseline` · `npm run check:codeowners` · revisar CODEOWNERS (¿placeholders `@YOUR_GITHUB_ORG/*` todavía?).

## 3) GESTIÓN DEL DESARROLLO Y CÓDIGO FUENTE

**Preguntas:**
- Calidad: TS estricto, ESLint 9 + rules custom (`eslint-rules/`), husky + lint-staged. ¿Hay fails de lint?
- Versionado: `main-protection.json` (PR obligatorio, approvals, Code Owners, linear history). ¿Importado en GitHub? ¿Placeholders sin sustituir?
- Testing: Vitest unit/integración, Playwright E2E multi-config, axe-core WCAG AA, fast-check, visual. ¿Cobertura por área con gates (`check-coverage-areas`)?
- CI/CD: `ci.yml` (gates), `nightly.yml`, `staging-deploy/rollback/smoke.yml`, imágenes por SHA. ¿Drills automatizados (rollback, backup-restore)?
- ¿Tests rotos o skips sin explicación? (`eslint-rules/no-unexplained-test-skip.mjs`)

**Checks:** `npm run lint` · `npm run test:fast` · `npm run test:rollback` · revisar `scripts/test-fast.mjs` para la lista de áreas cubiertas.

## 4) EXPERIENCIA DE USUARIO (UX/UI)

**Preguntas:**
- Usabilidad: onboarding, tour, prefetch de rutas, i18n en 20+ idiomas con checks de completitud.
- Consistencia visual: Mantine + Tailwind 4, `check:static-brand-tokens`, `check:no-unbounded-text` (desbordes).
- Accesibilidad: axe-core WCAG A/AA en `tests/e2e/a11y.spec.ts`; ARIA en extension. ¿Revisión manual pendiente?
- Rendimiento percibido: skeletons (`OptimizedSkeleton`, `SuspenseFallback`), lazy-loading, `bundle-report.md`, perf-scale con presupuestos.

**Checks:** `npm run check:i18n` · `npm run check:no-unbounded-text` · `npm run check:tailwind-drift` · `npm run check:static-brand` · `npm run check:bundle-size` (si existe) · revisar `tests/e2e/a11y.spec.ts` y `tests/e2e/visual-testing.spec.ts`.

## 5) GESTIÓN DE PRODUCTO Y VIABILIDAD DE NEGOCIO

**Preguntas:**
- MVP delimitado: bookmarks, documentos, vault cifrado, IA. ¿Scope creep?
- Monetización: Whop checkout + license server con firma (`server/src/license-signing.ts`), mocks en staging, rate limits. ¿Adaptador propio sin contrato versionado?
- Analítica: `AnalyticsService` local con consentimiento (`ConsentBanner`). ¿Existe algún canal de analítica de negocio opt-in no-PII agregado al servidor? ¿Dashboard de KPIs (retención D1/D7/D30) utilizable?
- Lanzamiento: PWA + extensiones Chrome/Firefox. ¿Checklist de tiendas/ASO?

**Checks:** revisar `src/services/AnalyticsService.ts` y `src/components/settings/AnalyticsDiagnostics.tsx` (¿el gate de consentimiento usa `CONSENT_ANALYTICS` o solo `bmf_local_error_storage`?), `docs/launch-checklist.md` (si existe).

## 6) OPERACIONES, MONITOREO Y MANTENIMIENTO

**Preguntas:**
- Monitoreo de errores: ¿error reporting con redacción de PII y consentimiento opt-in al servidor propio? (gap conocido: reporter local sin forwarder).
- Observabilidad: collector `/api/client-events` (storage-pressure, spikes, webhook threshold), logs estructurados sin PII, trazabilidad.
- Documentación: README + `docs/` (architecture/security/operations/api/audit). ¿Diagramas? ¿Swagger/OpenAPI o pruebas de contrato?
- Contingencia: backups cifrados automáticos, drill mensual (`drill:backup-restore`), rollback drill (`drill:rollback`), RPO=24h/RTO=24h+4h, SLOs documentados. ¿Guardia/canal de alertas registrados?

**Checks:** `npm run drill:backup-restore` · `npm run drill:rollback` con `DRILL_DOCKER=1` si hay Docker · `npm run check:monitoring` (si existe) · revisar `scripts/monitoring-alerts.mjs`.

## 7) PRIORIZACIÓN Y CORRECCIÓN

Procesa los hallazgos con este orden:

1. **P0 – Bloqueantes de lanzamiento** (rompen gates, exponen datos, placeholder en CODEOWNERS, secretos commiteados, bug que pierde datos). Corrige YA.
2. **P1 – Primer trimestre** (observabilidad de errores con redacción, analítica opt-in, pruebas de carga, cumplimiento legal formal).
3. **P2 – Medio plazo** (contratos versionados OpenAPI, simulacro de desastre trimestral formal, ASO tiendas).

Para CADA corrección:
- Haz el cambio mínimo, respetando convenciones del repo.
- Añade tests si toca lógica nueva (Vitest en `src/tests/` o `scripts/__tests__/`, Playwright en `tests/e2e/`).
- Verifica: `npm run typecheck:prod` + `npm run lint` + test unitario del área afectada.
- Actualiza `docs/audit.md` (hallazgos → acción → estado).

## 8) ENTREGA

Termina con:
1. Tabla de puntuaciones por área (0-10) y nota global.
2. Lista de hallazgos: **Qué → Dónde → Severidad → Hecho/Pendiente**.
3. Comandos de verificación ejecutados y sus resultados.
4. Siguientes acciones recomendadas (máx. 5, accionables).

---

*Este super-prompt describe el proceso; el agente debe ejecutarlo de verdad sobre el repo actual.*