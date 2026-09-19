# Pendientes

Registro vivo de la deuda abierta. Actualizado el 2026-09-19 (rama `release/v1.0.0`, `D:/bookmark7`, Node 24.17.0). La auditoría que originó esta lista (rama `main`, 01:55 UTC) quedó superada en varios frentes: lo ya cerrado se conserva al final, en «Resueltas», con su evidencia, para no perder la trazabilidad.

## Estado actual

- `npm run check`: verde, cadena completa con el freeze intacto.
- `npx vitest run scripts/__tests__/`: 1246 tests, 0 fallos.
- Componentes: **0 fallos**. `src/tests/components` + `src/tests/security`: 194 archivos, 2609 tests verdes. Los 9 fallos de la auditoría están cerrados (y apareció un décimo, `lazyComponents`).
- `npm run check:chunks`: pasa con `dist/` regenerado.
- `npm run check:release-target`: **confirmado** (`bookmarkforge/core`) — la ruta de release vuelve a estar disponible.
- Árbol de trabajo: 25 modificados y 4 añadidos sin commitear (las plantillas legales). El retiro controlado y la consolidación GDPR ya están commiteados (`32b4b6a`, `2ce321b`).

## P0 — Entorno git y husky

Reconfinado hoy, sin cambios respecto de la auditoría:

- El checkout vive en `D:/bookmark7` y pertenece a otro SID de Windows, así que cada comando de git necesita `git -c safe.directory=D:/bookmark7 ...`; la alternativa es la excepción global `git config --global --add safe.directory D:/bookmark7`. Sin ella, cualquier operación responde `detected dubious ownership`.
- La consecuencia práctica: `npm run prepare` (husky) falla con `fatal: not in a git directory` y **no instala los hooks**. `.husky/` está en `.gitignore`, así que cada checkout debe recrearlos.
- `npm run check:repository-hygiene` pasa igualmente, pero el efecto real es un repo local corriendo sin hooks.

## P1 — Contratos de mocks incompletos en tests

Barrido hecho hoy con `node scripts/tooling/mock-contract-audit.mjs` (auditoría AST
de `vi.mock`): 59 archivos con algún mock que no cubre el contrato de su módulo,
613 hallazgos, de los que **22 son sobre un módulo que el test importa
directamente** (`[dir]`, el resto es ruido de módulos alcanzables solo por
import transitivo). Los tests de componentes ya están cerrados; quedan los de
servicios/seguridad, todos de la misma forma: el test pasa porque la rama que
usa ese miembro nunca se ejercita.

- `src/tests/security/p0-legacy-share-mismatch.regression.test.ts` → 10 miembros
  de `secureStorage` que `SecurityVault` y `security-vault/integrity.ts` usan
  (`getVerificationIntegrity`, `storeVerificationTokenWithIntegrity`,
  `restoreWrappedDeviceKeyBlob`, `purgeExpiredPendingKeys`, …).
- `src/tests/services/SecurityVault.test.ts` y
  `p0-vault-rotation-rollback-drill.test.ts` → `auditLog.verifyIntegrity`
  (`SecurityVault`), y `AuditLogService.test.ts` → `secureStorage.isDeviceKeyMaterialized`
  / `isDeviceKeyWrapped` (`AuditLogService`).
- `src/tests/services/verifyBridgeMessage.test.ts` → `SECURE_STORAGE_KEYS`
  (`BroadcastBridgeService`, `db/database`, `VaultIntegration`).
- `src/tests/services/AnalyticsService.test.ts` → `safeRemove` de `safeStorage`
  (`AnalyticsService`, `ConsentService`).
- `src/tests/services/ai/warmup-latch.integration.test.ts` →
  `resourceManager.isHighEndDevice` (`ProviderManager`) y `buildSafeUserContent`
  de `ai/utils` (`WebLLMService`).
- `src/tests/services/integrations/cloudSync.*.test.ts` → `loadDiskBackupService`
  de `pro-access` (`BackupService`).
- `src/tests/memory/MemoryEngine.lifecycle.test.ts` → `memoryPipeline.onNewMessage`.
- `src/tests/services/SemanticCacheService.test.ts` → `redactSecrets` del logger
  (`EncryptionService`).

Aparte queda el ruido de `lucide-react` (93 iconos en 9 tests de componentes):
son stubs explícitos con `data-testid`, así que completarlos añadiría iconos para
ramas que nunca se montan; se deja como decisión de estilo, no como deuda.

## P2 — Podas deliberadas que siguen sin hacer

- `src/services/pro-access.ts`: sus exports siguen sin consumidores internos (verificado hoy), pero es la superficie frontera Open Core / export público; quitarlos arriesga el placeholder del export.
- `src/utils/crypto-core.ts` → `resetSessionSalt`: definido y sin llamadas en `src/` (verificado). Se mantiene porque es adyacente al trabajo de rotación de sal.
- `scripts/__tests__/monitoring-alerts.test.mjs` → test `API_DEGRADADO end-to-end` flaky en run completo (latencia real con timers), PASS aislado. No afecta nightly; ruido en `test:fast`. Inyectar reloj/mocks de timers o marcar `retry` cuando se toque ese área.

## P3 — Pulido del Security Dashboard

Verificado hoy: los tres puntos siguen abiertos.

- El item de sidebar usa `app_securityDashboard`, largo para una rail de 220 px, y se trunca. Acortarlo exige una clave nueva (`app_security` no existe hoy en los locales) y actualizar los 30 idiomas sin romper el delta de `npm run check:i18n`.
- Valores aproximados en la UI de `src/components/SecurityDashboard.tsx`: `encryptionFormat` fijo `AES-256-GCM` y `KDF` fijo `Argon2id (v4/v5)`, con `vaultKdfSalt` recortado. `src/services/security-vault/salt-registry.ts` tiene el inventario real y no está cableado al componente.
- El refresco automático es un `setInterval` de 30 s sin pausa por visibilidad, así que despierta la pestaña en background; moverlo a un hook con visibilidad o al store lo reduciría.

## Cambios pendientes de commit

- Documentación de esta sesión: los tres borrados del retiro controlado, `docs/audit.md`, `docs/launch-checklist.md`, `docs/security.md`, `docs/operations.md`, `docs/docs-state-index.md`, `docs/CHANGELOG.md`, los ADR nuevos (`docs/ADR-060-legal-consolidation-gate.md` y `docs/ADR-061-controlled-retirement-2026-09-19.md`) y el gate de consolidación legal con su test (`scripts/check-legal-consolidation.mjs`, `scripts/__tests__/check-legal-consolidation.test.mjs`).
- Informe unificado de presupuestos: `scripts/build-budget-report.mjs` genera un JSON que combina los tres presupuestos (estático, chunks, navegador) en `dist/reports/budget-report.json`. Incluye test unitario (`scripts/__tests__/build-budget-report.test.mjs`), npm script (`npm run build:budget-report`) y documentación en `scripts/tooling/README.md`.
- Dependencias: `package.json` y `package-lock.json` sin `md-to-pdf`, `puppeteer` ni `markdown-it` (el lock baja 1403 líneas). Ahora además `check:removed-deps` (`scripts/check-removed-deps.mjs` + su test) bloquea que vuelvan a `src/`: escáner sintáctico sobre las formas que cargan un módulo (`import`, `export … from`, `import = require`, `import()`/`require()`/`require.resolve`, `vi.mock`/`jest.requireActual`), sin falsos positivos por menciones en comentarios ni por `userAgent.includes("puppeteer")` en `src/utils/environmentDetection.ts`. Validado con `npm run typecheck`, `npm run lint`, `npm run test:fast` y `npm run check`.
- Ajenos a este trabajo, presentes en el árbol y sin tocar: `src/constants/navigation.ts` y `src/services/importer.markdown.ts`.
- Los documentos y sus artefactos van juntos: el índice y el baseline codifican también el retiro, así que commitear el changelog sin los borrados deja el CI en rojo.

## Resueltas desde la auditoría

| Deuda auditada | Evidencia del cierre |
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
| `check:release-target` en rojo por el slug provisional | `bookmarkforge/core` confirmado como destino real; la lista de slugs provisionales queda vacía y el guardián de regresión exige que las cuatro superficies sigan coincidiendo (ADR-058 enmendado). |
| Git ilegible en un checkout propiedad de otro usuario | `readRemotes` y el `ls-files` del export invocan git con `safe.directory`, así que el remoto confirmado ya no se reporta como ausente. El arreglo global de `safe.directory` en la máquina sigue en la deuda de git/husky de arriba. |
| 9 fallos de componentes (8 en `BlockEditor.branches`, 1 en `Onboarding`) | **Harness en los 8 primeros**: el mock de `useBlockEditorLogic` no aportaba `lang`, que el hook real siempre devuelve (`i18n.language`), así que el editor hacía `undefined.startsWith("es")`; añadido, con dos tests nuevos que fijan el diccionario (`en` y `es-MX`, el caso regional por el que existe el `startsWith`). **Harness + producto en el noveno**: el mock de `sonner` no tenía `dismiss`; y el flujo real quedó blindado porque un `dismiss` que fallaba abortaba el reboot y reportaba como fallida una restauración ya commiteada. 31/31 verdes en ambos archivos. |
| 10.º fallo de componentes: `lazyComponents.test.ts` (no listado en la auditoría) | `SecurityDashboard` entró al barrel de `src/components/app/lazyComponents.ts` en `59644c6` sin actualizar la lista congelada de la expectativa. Actualizada (export deliberado: ruteado en `AppRoutes.tsx` y usado por `Settings.tsx`) y añadido su mock, que el propio archivo exige a todos los targets de `lazy()`. |

## Qué hacer ahora

1. Excepción de `safe.directory` para que git y husky funcionen en este checkout.
2. Commitear el área de documentación completa, incluidos el changelog y los artefactos derivados.
3. Decidir si se acorta el label del dashboard pagando el costo en 30 idiomas.

## Fuentes

Verificación de esta actualización: `npm run check` (verde, freeze intacto), `npm run check:i18n`, `npm run check:workflows`, `npm run check:pocket-onboarding-copy`, `npm run check:inspector-freeze`, `npm run check:chunks`, `npm run check:release-target`, `npx tsc --noEmit`, `npm run test:fast` (152 archivos, presupuestos de timing intactos), `npx vitest run src/tests/components src/tests/security` (194 archivos, 2609 tests, 0 fallos) y `git -c safe.directory=D:/bookmark7 status --porcelain`.
