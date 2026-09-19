# Pendientes

## Resumen

Auditoria del 2026-09-19, 01:55 UTC (rama `main`, `D:/bookmark7`, Node 24.17.0).

* Gates del tier rapido: **8/8 PASS**.
* Gates del tier completo: **6 fallos nuevos**, todos por el estado del working tree (ver abajo).
* Tests rapidos: **540 passed / 3 failed** en el lote 1, **326 passed / 6 failed** en el lote 2 — 9 fallos en `scripts/__tests__/docs-*.test.mjs`, mismos 6 preexistentes no vistos antes por el paralelismo del runner.
* `src/tests/components`: **2046 passed / 9 failed** en `BlockEditor.branches.test.tsx` (8) y `Onboarding.test.tsx` (1) — preexistentes/ajenos, se deja trazabilidad.
* 90 archivos borrados sin stagear, 61 modificados, 4 sin rastrear. `dist/` y `dist-extension/` borrados (regenerables).

## El working tree ya trae trabajo ajeno

Estos cambios **no son mios**; estaban aqui al empezar. Siguiendo las reglas de la sesion, no los resto ni los asumo. Si quieres terminarlos o revertirlos, es una decision tuya.

* Modificados (heredados)
  * `src/components/Onboarding.tsx`
  * `src/components/app-initializer/AppInitializer.tsx`
  * `src/observability/ObservabilityHub.ts`
  * `src/services/SecurityVault.ts` (313 lineas)
  * `src/services/analyticsForwarder.ts` y `src/tests/services/analyticsForwarder.test.ts`
  * `src/services/security-vault/kdf-salt-sync.ts`
  * `scripts/audit-drift-baseline.json`
  * `scripts/i18n-backlog-baseline.json`
  * `scripts/i18n-quality-baseline.json`
  * `tests/e2e/legacy-vault-seeder.ts`
  * `tests/e2e/vault-auth-encryption-migration.spec.ts`
  * `tests/e2e/vault-migration-progress.spec.ts`
* Sin rastrear (heredados)
  * `src/services/security-vault/auth.ts`
  * `src/services/security-vault/rotation.ts`
  * `src/services/security-vault/secrets.ts`
* Observabilidad/privacidad: el `SecurityVault` modificado es critico — toca cifrado/salt de KDF. El `AppInitializer` nuevo introdujo `t("securityVaultChangedInAnotherTab")` sin registrarla en locales, y por eso rompe `check:i18n` (ver pendiente 2).
* Esos tres archivos nuevos sin rastrear (`auth.ts`, `rotation.ts`, `secrets.ts`) contienen los exports `installVaultKdfSaltAndMigrate`, `performLock` y `performUnlock` marcados como sin uso: es integracion pendiente, no codigo muerto.

## Pendientes por prioridad

### P0 — Restauran los gates de docs y 9 tests

* **90 archivos trackeados borrados**, todos de documentacion. El `git status` compara el working tree con `main`:

  * `README.md`, `AGENTS.md`, `CONTRIBUTING.md`
  * `docs/` casi completo: todos los `ADR-*.md`, `ONBOARDING.md`, `ROPA.md`, `SELF-HOSTING.md`, `api.md`, `architecture.md`, `audit*.md`, `deployment-runbook.md`, `docs-state-index.md`, `github-secrets-and-push-runbook.md`, `que-nos-falta.md`, `support-data-loss-runbook.md` y demas
  * `extension/PRIVACY.md`, `legal/` entero, `scripts/README.md`, `scripts/tooling/README.md`, `server/README.md`

  No los toque por tu primera instruccion ("no tocar los docs ya borrados"). La consecuencia es:

  * **Antes de mis cambios**, 62 archivos ya dejaban de ser escaneados por `check:docs-markdown` (baseline 94, scan 32). Con este documento el scan es 33.
  * Hoy **`check:docs-markdown`** reporta cobertura drift (preexistente).
  * **`check:documented-doc-references`** — `FAIL missing docs/docs-state-index.md`.
  * **`scripts/__tests__/**`** — 9 tests fallan porque leen el corpus de ADRs y el indice:
    * `check-docs-markdown.test.mjs` (2), `check-inspector-freeze.test.mjs` (1), `docs-retire-policy.test.mjs` (3), `docs-state-index.test.mjs` (2), `legacy-schema-map.test.mjs` (1).

  **Opciones**:

  * Restaurar los docs (`git checkout -- docs/ README.md AGENTS.md CONTRIBUTING.md` y lo que falte) y pasar por `scripts/check-docs-retire.mjs` para retirar lo que sea retirable con consentimiento (`retirable` en el estado mas rationale, gate debe pasar antes de borrar).
  * O consolidar el retiro: recrear `docs/docs-state-index.md`, marcar como `retirable` con nota a lo retirado, hacer pasar el gate y commitear.

  `docs/legacy-schema-version-map.md` se autogenera desde `src/db/schema.ts`; el runner de tests lo regenero identico a `HEAD` (por eso el conteo paso de 91 a 90). No bloquea nada.

### P0 — i18n roto por el trabajo en curso ajeno

* `t("securityVaultChangedInAnotherTab")` usada en `src/components/app-initializer/AppInitializer.tsx` (del diff ajeno) no existe en `public/locales/en.json`. Resultado:

  * `check:i18n` — `FAIL 1 t() key(s) missing from en.json` (i18n-completeness, estado 1). `es.json` tampoco la tiene.
  * Hay 30 locales, asi que cada delta cuenta: anadir la clave solo en `en.json` no basta, habria que actualizar `public/locales/*.json` y los baselines.

  **Opciones**: anadir la clave a todas las locales (con traducciones o fallback en ingles) o revertir la linea del `AppInitializer` hasta que el feature se termine.

### P0 — Entorno git / husky

* El repo esta en `D:/bookmark7` propiedad de otro SID, asi que `git` pide `git config --global --add safe.directory D:/bookmark7` o usar `-c safe.directory=...`. Sin esa excepcion, `npm run prepare` (husky) falla con `fatal: not in a git directory` y **no instala hooks** (y `.husky/` esta en `.gitignore`, asi que cada checkout debe recrearlos).
* `check:repository-hygiene` pasa hoy, pero `husky` no corre localmente.

### P1 — Lotes de tests fallidos no tocados

* `src/tests/components/BlockEditor.branches.test.tsx` (8 tests): `BlockEditor.tsx:106` hace `dictionary: lang.startsWith("es") ? es : en`. El mock `logic` del test no aporta `lang` (`undefined`). `BlockEditor.tsx` esta **intacto** en git (sin modificar), asi que es fallo preexistente del harness. Reproducible sin mis cambios.
* `src/tests/components/Onboarding.test.tsx` (1 test): `Onboarding.tsx` ya venia modificado por el otro agente (ver diff). El restore de `.json` no dispara `reloadMock`.

### P1 — Workflows con vars/secrets no documentados

* `check:workflows` → `check:workflow-vars-documented` FAIL:

  * `secrets.STAGING_DAST_CONTEXT_B64`, `secrets.STAGING_DAST_CONTEXT_PASSWORD` (dast-nightly.yml)
  * `vars.STAGING_URL` (dast-nightly.yml, nightly.yml, staging-deploy.yml)
  * `secrets.CODECOV_TOKEN`, `secrets.STAGING_ANALYTICS_ADMIN_TOKEN`, `vars.CONSISTENCY_MIN_CONSECUTIVE_PHANTOM` (nightly.yml)
  * `secrets.STAGING_SMOKE_ADMIN_TOKEN`, `secrets.STAGING_SMOKE_TOKEN` (staging-deploy.yml, staging-smoke.yml)

  **Deudas**: documentarlos en `.env.example` o `docs/` (ojo, `docs/` esta retirado).

### P1 — Contenido que referencia docs retirados

* `check:inspector-freeze` — `FAIL new gate "check:docs-markdown" in the check chain has no ADR`. La cadena `npm run check` anadio `check:docs-markdown` sin registrarlo en `KNOWN_GATES` ni darle un ADR (`ADR-028` cubre drift, pero este inspeccion no `security`/`language`). O se escribe el ADR (p. ej. `ADR-040`, que ademas esta borrada) o se anade la categoria explicita en `check-inspector-freeze.mjs`.
* `check:pocket-onboarding-copy` — 5 violaciones: lee `docs/onboarding-emails.md`, borrado. Mensajes que faltan: smart-search, Raindrop yearly comparison, no-device-cap, any-device wording (y `ENOENT` sobre el archivo).

### P2 — Estado regenerable

* `dist/` y `dist-extension/` borrados (artefactos gitignored, 50 MB). `check:chunks` hoy hace `SKIP: dist/assets not found` con `--allow-missing-dist`; en CI falla cerrado sin `--allow-missing-dist`. Para validar chunk boundaries y bundle size hay que regenerar: `npm run build:ci`.

### P2 — Mis cambios no commiteados (si los quieres commitear)

* `package.json` y `package-lock.json`: `md-to-pdf`, `puppeteer`, `markdown-it` quitados (−119 paquetes transitivos). Verificado con `typecheck` y `lint`; `test:fast` descarta transitos `chokidar`, `chromium-bidi`, etc.
* 43 archivos de `src/` tocados por el barrido de codigo muerto (9 declaraciones muertas borradas, `export` retirado en ~60 simbolos de uso interno). 2 simbolos fueron revertidos tras cazar 2 regresiones `TS4053` en `declaration --emitDeclarationOnly`: `NextReviewState` y `MaintenanceHistoryEntry` son tipos inferidos de `FlashcardService` (Pro) y `IntelligentMaintenanceService`; dejarlos sin export rompe el `.d.ts`.
* `src/components/Settings.tsx` + `src/components/SecurityDashboard.tsx` (integracion).
* `src/tests/components/Settings.test.tsx` (mocks de `useRxDB` y selector de cierre precisado) + **nuevo** `src/tests/components/SecurityDashboard.test.tsx` (3 tests, guarda de regresion del conteo NaN y del scroll vs callback).
* `src/constants/navigation.ts` (id `security`), `src/components/Sidebar.tsx` (meta `security` con `ShieldCheck`), `src/components/app/lazyComponents.ts` y `src/components/app/AppRoutes.tsx` (ruta `/security`). Este documento.
* `src/memory/memoryRecordSchema.ts` requirio limpiar 4 importaciones huerfanas (`MemoryAtom` y demas).

### P2 — Poda que quedo sin hacer a proposito

* `src/services/pro-access.ts` (10 exports `BackupServiceClass`, `requireProService`, `setSyncFacade` y demas): la deteccion los vio huerfanos pero es la superficie frontera Open Core / export publico. Quitarlos arriesga el placeholder del export.
* `src/utils/crypto-core.ts` `resetSessionSalt`: sin referencia textual (ocurrencia 1), pero es adyacente al trabajo de rotacion de salt y lo deje.
* `src/services/security-vault/auth.ts`, `rotation.ts`, `secrets.ts`: sin rastrear y no podables.

### P3 — Pulido del Security Dashboard

* El item de sidebar usa `app_securityDashboard` ("Security Dashboard") en las 30 locales. Es largo para una rail de 220 px y acaba truncado. Un label corto (`app_security` = "Security") exigiria una clave nueva y actualizar las 30 locales sin que el delta de `check:i18n` se vaya a rojo.
* Valores aproximados en la UI: `encryptionFormat` fijo `"AES-256-GCM"`, `kdfStatus` heuristico, `KDF` fijo `"Argon2id (v4/v5)"` y `vaultKdfSalt` recortado. `src/services/security-vault/salt-registry.ts` tiene el inventario real; cablearlo daria el estado v6/v5 verdadero y el kdf real.
* El auto-refresh cada 30 s no se pausa cuando la pestaña esta oculta; un `useVisibilityPolling` o hacerlo en el store reduciria wakeups de background.

## Estado fino de gates a 2026-09-19

### PASS (tier rapido, 8/8)

* `check:boundaries`
* `check:env`
* `check:open-core`
* `check:pro-imports`
* `check:compose-config`
* `check:runtime-config`
* `check:license-keys`
* `check:server-log-ip-privacy`

### PASS (otros, muestra)

* `check:documented-npm-commands`
* `check:audit-drift` (24/24 anclas presentes)
* `check:claim-drift`
* `check:english-only` (1029 archivos de `src/` segun el gate)
* `check:repository-hygiene`
* `check:e2e-helpers`
* `check:secrets-in-commit`
* `check:http-config`
* `check:docker-context`
* `check:image-pins`
* `check:pro-routes`
* `check:workflow-security`
* `check:static-brand`
* `check:brand-logo`
* `check:tailwind-drift`
* `check:seo`
* `check:sitemap-coverage`
* `check:csp`
* `check:extension-csp`
* `check:license-claims`
* `check:landing-free-plan`
* `check:manual-figures`
* `check:page-figures`
* `check:landings-fresh`
* `check:no-unbounded-text`
* `check:override-cve`
* `check:direct-cve`
* `typecheck`, `typecheck:prod`
* `lint` (1400 archivos)
* `check:e2e-selectors`
* `check:boundaries`

### FAIL (estado actual del working tree, no de esta tarea)

* `check:docs-markdown` — cobertura drift (62 borrados)
* `check:documented-doc-references` — `docs/docs-state-index.md` ausente
* `check:i18n` — clave `securityVaultChangedInAnotherTab` de otro agente
* `check:inspector-freeze` — `check:docs-markdown` sin ADR registrado
* `check:workflows` → `check:workflow-vars-documented` — 8 vars/secrets sin documentar
* `check:pocket-onboarding-copy` — `docs/onboarding-emails.md` ausente y 4 mensajes

### SKIP (necesita rebuild)

* `check:chunks` — `SKIP: dist/assets not found --allow-missing-dist`
* `performance-budget` / `bundle-size` — requieren `dist/` y cobertura

## Que hacer ahora

* Cerrar el retiro de docs o restaurarlos. Mientras el estado este a medias, `docs-state-index`, `docs-retire-policy`, `docs-markdown` y `legacy-schema-map` seguiran fallando y `check:i18n` arrastrara esa clave nueva.
* Dar de alta `securityVaultChangedInAnotherTab` en `public/locales/*.json` y actualizar los baselines `i18n-*.json`.
* Registrar `check:docs-markdown` en `KNOWN_GATES` (o escribir el ADR) y documentar las 8 variables de workflows.
* Recrear `docs/onboarding-emails.md` o retirar su politica.
* Arreglar el harness de `BlockEditor.branches.test.tsx` (mock `logic` debe aportar `lang`) y el flow de restore de `Onboarding.test.tsx`. La otra rama de `SecurityVault` (`observability/ObservabilityHub.ts` y demas) debe cerrar su ciclo antes de mergear.
* Reconstruir `dist/` (`npm run build:ci`) para revalidar `check:chunks` y el presupuesto de bundle.
* `git config --global --add safe.directory D:/bookmark7` para que `git` y `husky` funcionen bajo este SID.
* Construir mis cambios pendientes: los tests ya blindan el arreglo del conteo y la ruta `/security` heredara su `onOpenSettings`→`onNavigate("settings")`. Si quieres una etiqueta corta en el sidebar, toca anadir `app_security` en las 30 locales.

## Fuentes

* `G="git -c safe.directory=D:/bookmark7"`, `G status --porcelain`, `npm run check:quick`, `npm run test:fast` (152 filas, 2 lotes), `npm run check:docs-markdown` y los demas gates con `npm run ... 2>&1 | tail`. Tiempos: `lint` ~20 s, `test:fast` ~34 s, tier rapido ~2,6 s. Grafo de imports construido sobre 1756 archivos (1024 alcanzables en `src/`).
