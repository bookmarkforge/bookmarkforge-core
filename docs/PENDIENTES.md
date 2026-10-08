# Pending

Live register of open debt. Updated on 2026-09-19 (branch `release/v1.0.0`, `D:/bookmark7`, Node 24.17.0). The audit that originated this list (branch `main`, 01:55 UTC) was surpassed on several fronts: what is already closed is preserved at the end, in "Resolved", with its evidence, to not lose traceability.

## Current Status

- `npm run check`: green, complete chain with freeze intact.
- `npx vitest run scripts/__tests__/`: 1246 tests, 0 failures.
- Components: **0 failures**. `src/tests/components` + `src/tests/security`: 194 files, 2609 green tests. The 9 audit failures are closed (and a tenth appeared, `lazyComponents`).
- `npm run check:chunks`: passes with `dist/` regenerated.
- `npm run check:release-target`: **confirmed** (`bookmarkforge/bookmarkforge`) — the release path is available again.
- Working tree: 25 modified and 4 added without commit (legal templates). The controlled retirement and GDPR consolidation are already committed (`32b4b6a`, `2ce321b`).

## P0 — Git and husky environment

Reconfined today, no changes regarding the audit:

- The checkout lives in `D:/bookmark7` and belongs to another Windows SID, so every git command needs `git -c safe.directory=D:/bookmark7 ...`; the alternative is the global exception `git config --global --add safe.directory D:/bookmark7`. Without it, any operation responds `detected dubious ownership`.
- The practical consequence: `npm run prepare` (husky) fails with `fatal: not in a git directory` and **does not install hooks**. `.husky/` is in `.gitignore`, so every checkout must recreate them.
- `npm run check:repository-hygiene` passes as well, but the real effect is a local repo running without hooks.

## P1 — Incomplete mock contracts in tests

Sweep done today with `node scripts/tooling/mock-contract-audit.mjs` (AST audit
of `vi.mock`): 59 files with some mock that does not cover its module's contract,
613 findings, of which **22 are about a module that the test imports
directly** (`[dir]`, the rest is noise from modules reachable only by
transitive import). Component tests were already closed.

**Status 2026-10-02: the 22 direct-import contracts below are CLOSED.** Every
factory listed here now provides its members, pinned by the ratchet
`node scripts/tooling/mock-contract-audit.mjs` — 22/22 mock paths present,
with 12 adversarial tests in `scripts/__tests__/mock-contract-audit.test.mjs`
(comment-only factories, `vi.hoisted` objects, spread/computed-key overrides
and shorthand `undefined` all fail closed). The 10 touched suites run green
(268 tests). The general AST sweep (59 files / 613 findings, the rest
transitive-import noise) remains open.

- `src/tests/security/p0-legacy-share-mismatch.regression.test.ts` → 10
  `secureStorage` members used by `SecurityVault` and
  `security-vault/integrity.ts` (`getVerificationIntegrity`,
  `storeVerificationTokenWithIntegrity`, `restoreWrappedDeviceKeyBlob`,
  `purgeExpiredPendingKeys`, …).
- `src/tests/services/SecurityVault.test.ts` and
  `p0-vault-rotation-rollback-drill.test.ts` → `auditLog.verifyIntegrity`
  (`SecurityVault`), and `AuditLogService.test.ts` →
  `secureStorage.isDeviceKeyMaterialized` / `isDeviceKeyWrapped`
  (`AuditLogService`).
- `src/tests/services/verifyBridgeMessage.test.ts` → `SECURE_STORAGE_KEYS`
  (`BroadcastBridgeService`, `db/database`, `VaultIntegration`).
- `src/tests/services/AnalyticsService.test.ts` → `safeRemove` from
  `safeStorage` (`AnalyticsService`, `ConsentService`).
- `src/tests/services/ai/warmup-latch.integration.test.ts` →
  `resourceManager.isHighEndDevice` (`ProviderManager`) and
  `buildSafeUserContent` from `ai/utils` (`WebLLMService`).
- `src/tests/services/integrations/cloudSync.*.test.ts` →
  `loadDiskBackupService` from `pro-access` (`BackupService`).
- `src/tests/memory/MemoryEngine.lifecycle.test.ts` → `memoryPipeline.onNewMessage`.
- `src/tests/services/ai/SemanticCacheService.test.ts` → `redactSecrets` from
  the logger (`EncryptionService`).

Deferred from the same pass: `storeVerificationTokenWithIntegrity` on
`buildRotationContext` (`SecurityVault.ts`) has no caller in `rotation.ts` — a
dead adapter awaiting a retirement decision; its member contract is pinned
regardless.

Separately, there is the `lucide-react` noise (93 icons in 9 component tests):
they are explicit stubs with `data-testid`, so completing them would add icons
for branches that never mount; it is left as a style decision, not as debt.

## P2 — Deliberate prunings still to do

- **Integridad de aserciones en la suite human-like (deuda grande, decidida 2026-09-24).** De los 2050 tests de `src/tests/human-like/examples` (161 ficheros, heredados de `bace7c2` del 2026-09-22), **1589 (77,5 %) son vacuos**: su única aserción vive dentro de un `if (await loc.isVisible(…).catch(() => false))`, así que pasan exactamente cuando la función que nombran NO existe — 123 de los 160 ficheros originales (120 tras los pagos de 2026-09-24: `advanced-alerts-tests.spec.ts` reescrito de 10 vacuos a 5 tests reales contra el contrato de toasts de sonner, y `canvas-graph-tests.spec.ts` reescrito de 15 vacuos a 5 tests reales contra los contratos verificados de xyflow/d3) no pueden fallar jamás (uno de ellos, `advanced-alerts-tests.spec.ts` §74.3, llega a afirmar que el botón de cerrar sigue visible DESPUÉS de pulsarlo). El job nightly "Human-like E2E" ha estado verde tanto si la app funciona como si no. Medición: `node scripts/analyze-vacuous-tests.mjs`; ratchet: `npm run check:vacuous-tests` (congela el número en `scripts/vacuous-tests-baseline.json` y falla si crece; corre en el job `coverage` del nightly). El suites multi-user (`tests/e2e`) está sano: 7 tests vacuos en 6 ficheros (5,2 % de 134) tras la primera remediación (2026-09-24): `diag-integrity.spec.ts` imprimía su comparación "identical" sin afirmarla y ahora es un `expect` real (verificado en verde); `demo-automation.spec.ts` es una demo de 5 min sin ninguna aserción que corría cada noche — ahora es opt-in (`BMF_RUN_DEMO_AUTOMATION=true`). Limitación documentada del clasificador: un "empty" significa "sin `expect` en el callback del test", no "no puede fallar" — `a11y` y `launch-smoke` asierten vía helpers que lanzan; las 6 entradas restantes del baseline están auditadas a mano, fichero a fichero, en su `reason`.
  **Censo equivalente en vitest (2026-09-24): sin teatro.** El 14,6 % bruto que produce el clasificador sobre `src/tests` + `scripts/__tests__` es ruido de alcance: incluye la suite Playwright de human-like (que vitest no ejecuta) y cuenta como "empty" los tests que asierten con APIs ajenas a `expect`. Clasificación fina de los 72 tests señalados fuera de human-like: 16 usan helpers de aserción (`expectClaim` y similares), 41 son contratos no-throw deliberados ("does not fail if…" — el contrato ES no lanzar), 15 son guarded legítimos, **0 cuerpos verdaderamente vacíos**; 8 ficheros más usan `node:assert`, fast-check o snapshots (invisibles para el AST, todos verificados a mano). No se crea gate para vitest: no hay deuda que ratchetar. La remediación —reescribir o retirar los 94 ficheros `advanced-*`— es una decisión de producto y no cabe en una ronda de auditoría; lo que este gate no permite es que el número crezca.
- `src/services/pro-access.ts`: sus exports siguen sin consumidores internos (verificado hoy), pero es la superficie frontera Open Core / export público; quitarlos arriesga el placeholder del export.
- `src/utils/crypto-core.ts` → `resetSessionSalt`: definido y sin llamadas en `src/` (verificado). Se mantiene porque es adyacente al trabajo de rotación de sal.
- `scripts/__tests__/monitoring-alerts.test.mjs` → test `API_DEGRADADO end-to-end` flaky en run completo (latencia real con timers), PASS aislado. No afecta nightly; ruido en `test:fast`. Inyectar reloj/mocks de timers o marcar `retry` cuando se toque ese área.

## P3 — Pulido del Security Dashboard

Verificado hoy: los tres puntos siguen abiertos.

- El item de sidebar usa `app_securityDashboard`, largo para una rail de 220 px, y se trunca. Acortarlo exige una clave nueva (`app_security` no existe hoy en los locales) y actualizar los 30 idiomas sin romper el delta de `npm run check:i18n`.
- Valores aproximados en la UI de `src/components/SecurityDashboard.tsx`: `encryptionFormat` fijo `AES-256-GCM` y `KDF` fijo `Argon2id (v4/v5)`, con `vaultKdfSalt` recortado. `src/services/security-vault/salt-registry.ts` tiene el inventario real y no está cableado al componente.
- El refresco automático es un `setInterval` de 30 s sin pausa por visibilidad, así que despierta la pestaña en background; moverlo a un hook con visibilidad o al store lo reduciría.

## Changes pending commit

- Documentación de esta sesión: los tres borrados del retiro controlado, `docs/audit.md`, `docs/launch-checklist.md`, `docs/security.md`, `docs/operations.md`, `docs/docs-state-index.md`, `docs/CHANGELOG.md`, los ADR nuevos (`docs/ADR-060-legal-consolidation-gate.md` y `docs/ADR-061-controlled-retirement-2026-09-19.md`) y el gate de consolidación legal con su test (`scripts/check-legal-consolidation.mjs`, `scripts/__tests__/check-legal-consolidation.test.mjs`).
- Informe unificado de presupuestos: `scripts/build-budget-report.mjs` genera un JSON que combina los tres presupuestos (estático, chunks, navegador) en `dist/reports/budget-report.json`. Incluye test unitario (`scripts/__tests__/build-budget-report.test.mjs`), npm script (`npm run build:budget-report`) y documentación en `scripts/tooling/README.md`.
- Dependencias: `package.json` y `package-lock.json` sin `md-to-pdf`, `puppeteer` ni `markdown-it` (el lock baja 1403 líneas). Ahora además `check:removed-deps` (`scripts/check-removed-deps.mjs` + su test) bloquea que vuelvan a `src/`: escáner sintáctico sobre las formas que cargan un módulo (`import`, `export … from`, `import = require`, `import()`/`require()`/`require.resolve`, `vi.mock`/`jest.requireActual`), sin falsos positivos por menciones en comentarios ni por `userAgent.includes("puppeteer")` en `src/utils/environmentDetection.ts`. Validado con `npm run typecheck`, `npm run lint`, `npm run test:fast` y `npm run check`.
- Ajenos a este trabajo, presentes en el árbol y sin tocar: `src/constants/navigation.ts` y `src/services/importer.markdown.ts`.
- Los documentos y sus artefactos van juntos: el índice y el baseline codifican también el retiro, así que commitear el changelog sin los borrados deja el CI en rojo.

## Resolved since the audit

| Audited debt | Closure evidence |
|---|---|
| 90 documentos borrados y gates de docs en rojo | Corpus restaurado y renumerado a `ADR-059` (`384bdea`); retiro controlado de 3 documentos con consentimiento de `npm run check:docs-retire` y rationale en `ADR-061`. Índice en 103 documentos. |
| 62 archivos fuera del escaneo de `check:docs-markdown` | Baseline regenerado: 102 archivos, 34 ADR, 0 hallazgos. |
| `check:documented-doc-references` sin índice | 82 documentos vivos, 256 referencias locales resueltas. |
| 9 fallos de `scripts/__tests__` por corpus e índice ausentes | Suite completa: 1246 tests, 0 fallos. |
| Clave `securityVaultChangedInAnotherTab` ausente en locales y `check:i18n` en rojo | Integrada con el delta de nube en `24ba20c`; `npm run check:i18n` pasa. |
| 8 vars y secrets de workflows sin documentar | `npm run check:workflows` pasa. |
| `check:inspector-freeze`: `check:docs-markdown` sin ADR en la cadena | El gate queda registrado en `ADR-040`; el freeze pasa con el gate cableado. |
| `check:pocket-onboarding-copy` con `docs/onboarding-emails.md` ausente | Documento restaurado; el gate pasa. |
| `dist/` ausente y `check:chunks` en SKIP | `npm run build:ci` regeneró `dist/`; `npm run check:chunks` valida los invariantes de chunks y el tamaño de entrada. |
| `security-vault/auth.ts`, `rotation.ts` y `secrets.ts` sin rastrear, con «integración pendiente» | Integrados y trackeados (`c9f5804`). |
| `check:release-target` en rojo por el slug provisional | `bookmarkforge/bookmarkforge` confirmado como destino real; la lista de slugs provisionales queda vacía y el guardián de regresión exige que las cuatro superficies sigan coincidiendo (ADR-058 enmendado). |
| Git ilegible en un checkout propiedad de otro usuario | `readRemotes` y el `ls-files` del export invocan git con `safe.directory`, así que el remoto confirmado ya no se reporta como ausente. El arreglo global de `safe.directory` en la máquina sigue en la deuda de git/husky de arriba. |
| 9 fallos de componentes (8 en `BlockEditor.branches`, 1 en `Onboarding`) | **Harness en los 8 primeros**: el mock de `useBlockEditorLogic` no aportaba `lang`, que el hook real siempre devuelve (`i18n.language`), así que el editor hacía `undefined.startsWith("es")`; añadido, con dos tests nuevos que fijan el diccionario (`en` y `es-MX`, el caso regional por el que existe el `startsWith`). **Harness + producto en el noveno**: el mock de `sonner` no tenía `dismiss`; y el flujo real quedó blindado porque un `dismiss` que fallaba abortaba el reboot y reportaba como fallida una restauración ya commiteada. 31/31 verdes en ambos archivos. |
| 10.º fallo de componentes: `lazyComponents.test.ts` (no listado en la auditoría) | `SecurityDashboard` entró al barrel de `src/components/app/lazyComponents.ts` en `59644c6` sin actualizar la lista congelada de la expectativa. Actualizada (export deliberado: ruteado en `AppRoutes.tsx` y usado por `Settings.tsx`) y añadido su mock, que el propio archivo exige a todos los targets de `lazy()`. |

## What to do now

1. The `safe.directory` exception so git and husky work in this checkout.
2. Commit the full documentation area, including the changelog and derived artifacts.
3. Decide whether to shorten the dashboard label by paying the cost across 30 locales.

## Fuentes

Verificación de esta actualización: `npm run check` (verde, freeze intacto), `npm run check:i18n`, `npm run check:workflows`, `npm run check:pocket-onboarding-copy`, `npm run check:inspector-freeze`, `npm run check:chunks`, `npm run check:release-target`, `npx tsc --noEmit`, `npm run test:fast` (152 archivos, presupuestos de timing intactos), `npx vitest run src/tests/components src/tests/security` (194 archivos, 2609 tests, 0 fallos) y `git -c safe.directory=D:/bookmark7 status --porcelain`.
