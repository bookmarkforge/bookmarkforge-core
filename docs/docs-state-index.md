# Inventario de documentos — BookmarkForge

Este archivo es la fuente de verdad sobre el estado de la documentación del repositorio. No es una guía operativa. Su función es permitir retirar, archivar o renombrar documentos con trazabilidad y sin romper referencias vivas.

## Convención de estados

| Estado | Significado |
|---|---|
| `vivo` | Documento activo que el repositorio lee en CI, gates, README o flujos reales. |
| `transitorio` | Documento útil pero pendiente de consolidar, migrar o desduplicar. |
| `archivo` | Documento histórico valioso pero fuera del camino crítico; se conserva, no se enlaza como fuente principal. |
| `retirable` | Documento obsoleto, duplicado o ya absorbido por otro; puede eliminarse una vez que no tenga referencias vivas. |

Decisión: **esta fase solo retira documentos con estado `retirable` y referencias vivas confirmadas como inexistentes o ya actualizadas.**

## Estado actual

| Documento | Estado | Nota |
|---|---|---|
| `docs/ADR-001-check-static-brand.md` | vivo | ADR de registro de gate; útil como registro, sin circuito activo actual. |
| `docs/ADR-019-argon2id-migration.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-026-post-audit-hardening-wave-1.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-027-post-audit-hardening-wave-2.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-028-gate-drift-detection.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-029-webrtc-sync-hardening.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-030-security-tier-regression-umbrella.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-032-disk-backup-pruning.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-033-restore-surface-auth-errors.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-034-backup-age-and-storage-quota.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-037-backup-deletion-ownership.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-038-constant-time-hmac-attestation.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-039-sw-integrity-runtime.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-040-docs-markdown-gate-fusion.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-042-css-only-user-themes.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-043-check-seo-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-044-og-image-policy.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-045-check-brand-logo-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-046-vault-kdf-salt-rotation.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-047-claim-drift-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-048-license-claims-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-049-manual-figures-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-050-page-figures-gate-and-planner.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-051-landings-fresh-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-052-v5-format-sunset.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-053-vault-salt-registry.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-054-check-quick-tier.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-055-collapsible-surfaces.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-056-documented-npm-commands-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ADR-057-documented-reference-integrity-gate.md` | vivo | ADR oficial del proyecto. |
| `docs/ROPA.md` | vivo | Inventario RGPD; contiene campos operativos/legales por completar. |
| `docs/SELF-HOSTING.md` | vivo | Guía interna de self-hosting; no entra en el export público. |
| `docs/api.md` | vivo | Vista general de la API del servidor acompañante. |
| `docs/architecture.md` | vivo | Arquitectura y decisiones pendientes. |
| `docs/audit-report-2026-09-02.md` | archivo | Informe de auditoría puntual (hallazgos B-1, M-1 y derivados), absorbido por `docs/audit.md`. Se conserva como evidencia. |
| `docs/audit-report-2026-09-04.md` | archivo | Re-verificación puntual, absorbida por `docs/audit.md`. Se conserva como evidencia. |
| `docs/audit.md` | vivo | Fuente principal de auditoría continua y ledger de hallazgos. |
| `docs/deployment-runbook.md` | vivo | Checklist operativo para desplegar el checkout actual y cerrar A11-2 con probes públicas. |
| `docs/docs-state-index.md` | vivo | Inventario autoritativo del estado documental (este mismo archivo). |
| `docs/drill-run-2026-08-31-rollback-docker.md` | archivo | Evidencia concreta de un drill histórico; el estado vivo lo tiene `docs/operations.md`. |
| `docs/edge-case-hardening-vault-audit.md` | vivo | Auditoría de casos límite del vault. |
| `docs/github-secrets-and-push-runbook.md` | vivo | Runbook de secretos y push. |
| `docs/google-search-runbook.md` | vivo | Runbook de Google Search: Search Console, envío del sitemap y cobertura noindex de /app. |
| `docs/history-attribution.md` | archivo | Atribución histórica; útil como registro, no como fuente principal actual. |
| `docs/index.md` | vivo | Índice de navegación de la documentación. |
| `docs/internal-security-checklist.md` | vivo | Checklist interno de seguridad. |
| `docs/ios-day0-session-sheet.md` | vivo | Hoja de sesión del día 0 en iOS. |
| `docs/ios-manual-test-script.md` | vivo | Guion de prueba manual en iPhone. |
| `docs/launch-checklist.md` | vivo | Checklist de lanzamiento; fuente de varios gates automatizados. |
| `docs/launch-day-smoke.md` | vivo | Runbook del smoke del día de lanzamiento. |
| `docs/legacy-compatibility-plan.md` | vivo | Plan de compatibilidad/migración de formatos old. |
| `docs/legacy-schema-version-map.md` | vivo | Registro versionado de esquemas RxDB activos; se genera desde src/db/schema.ts para diagnóstico de compatibilidad sin acceso al vault. |
| `docs/legal-closing-package.md` | vivo | Paquete de cierre legal: relleno del ROPA, DPAs por proveedor, orden de firma y plantillas. Evidencia del punto 5 del launch-checklist. |
| `docs/onboarding-emails.md` | vivo | Secuencia de emails de onboarding. |
| `docs/openapi.yaml` | vivo | Especificación OpenAPI 3.1.0 del servidor acompañante. |
| `docs/operations.md` | vivo | Operaciones, SLOs de referencia, drills, gates nocturnos, evidencia. |
| `docs/ops-nightly.md` | vivo | Operaciones nocturnas, anclas de auditoría, gates. |
| `docs/p2p-sync-manual-test-script.md` | vivo | Guion de prueba manual del sync P2P. |
| `docs/p2p-sync-session-prep.md` | vivo | Preparación de la sesión de sync P2P. |
| `docs/pricing-decision.md` | vivo | Decisión de precios y reparto Free/Pro. |
| `docs/que-nos-falta.md` | vivo | Resumen de deudas pendientes. |
| `docs/release-note-r3-4.md` | vivo | Notas de release. |
| `docs/sast-triage.md` | vivo | Guía de triaje SAST. |
| `docs/scripts-inventory-scanner-limits.md` | vivo | Límites del escáner de inventario de scripts. |
| `docs/security.md` | vivo | Controles de seguridad, RGPD, configuración obligatoria de producción. |
| `docs/server-api-index.md` | vivo | Índice detallado de endpoints del servidor. |
| `docs/staging-smoke.md` | vivo | Notas de smoke de staging. |
| `docs/support-data-loss-runbook.md` | vivo | Procedimiento ante pérdida de datos reportada por soporte. |

Los documentos en estado `archivo` (`history-attribution`, los dos informes de auditoría fechados y la evidencia del drill de rollback) se conservan a propósito: el repositorio mantiene evidencia histórica y `docs/audit.md` ya los resume. Enfocamos la retirada solo en documentos `retirable` que no sean necesarios para la cadena histórica.

### Familias que no se listan una por una

| Familia | Archivos | Estado | Nota |
|---|---|---|---|
| `docs/ADR-*.md` | * (en la tabla) | vivo | Registro de decisiones; `check:audit-drift` los lee por token. |
| `docs/manual-usuario-<locale>.md` | 30 | vivo | Fuente de los manuales de usuario. |
| `docs/manual-usuario-<locale>.pdf` | 30 | vivo | Entregable generado desde el `.md`. |
| `docs/manual-usuario-*-styled.html` | 0 en git | — | Intermedio de `npm run docs:pdf:localized`; dejó de versionarse en 2026-09 y está en `.gitignore`. |

## Decisión para esta fase (2026-09-17)

Esta fase **sí retira**, porque la auditoría de la ronda 6 encontró material que ya no describía el repositorio:

- Retirados 30 `docs/manual-usuario-*-styled.html` (intermedios regenerables, absorbidos por `npm run docs:pdf:localized`); la familia pasa a `.gitignore`.
- Retirada la cadena E2E `e2e:ai-upstream` (config, spec y stub) por no tener sujeto tras la retirada del proxy de IA.
- Reclasificados a `archivo` los dos informes de auditoría fechados, antes `vivo`.
- No se retira ningún `.md`: el repositorio conserva evidencia histórica.

Si en el futuro un documento pasa a `retirable`, este índice debe actualizarse antes de tocar el filesystem, y la retirada debe incluir:
1. Actualización de `docs/docs-state-index.md`.
2. Búsqueda de referencias locales en `docs/`, `.github/`, `scripts/`, `src/tests/`, `AGENTS.md` y `CONTRIBUTING.md`.
3. Confirmación de que el documento retirado era realmente alcanzable desde los canales vivos antes de borrarlo.

## Registro de cambios

- **2026-09-17 —** ronda 11 de auditoría: cobertura del sitemap de 61 URLs alineada con los 30 artefactos de landing y sus rutas `_redirects`/nginx mediante `check:sitemap-coverage`; `docs/google-search-runbook.md` actualizado. Producción está desfasada: `/` sirve el conversor antiguo y las probes de landings/sitemap devuelven 404; queda A11-2 abierto hasta desplegar este checkout. Detalle en `docs/audit.md` → "Ronda 11".
- **2026-09-17 —** ronda 10 de auditoría: cierre de A9-1 — `scripts/nginx-render.mjs` ya no puede destruir `public/_headers` ni `public/sitemap.xml` (pasan a quirúrgicos con guardas y `--write` all-or-nothing; dueño único por archivo documentado en el runbook de Google Search). Drift preexistente corregido en `docs/google-search-runbook.md` (el sitemap real tiene 61 URLs, no 13, y es manual). Detalle en `docs/audit.md` → "Ronda 10".
- **2026-09-17 —** ronda 9 de auditoría: retirada de la superficie muerta del proxy de IA en la capa operativa (nginx generado, smoke de producción, sonda `API_DEGRADADO` y prueba de carga) y de los dos mocks `ai-mock*`; `docs/operations.md`, `docs/architecture.md` y `docs/launch-checklist.md` actualizados para no describir una prueba de carga con fase de IA. Hallazgo cerrado A9-1 en la ronda 10 (`nginx-render --write` sobre `public/_headers`/`public/sitemap.xml`). Detalle en `docs/audit.md` → "Ronda 9".
- **2026-09-17 —** ronda 6 de auditoría: reescritura de `README.md`, `docs/api.md`, `docs/openapi.yaml`, `docs/server-api-index.md` y `docs/SELF-HOSTING.md` para eliminar la documentación fantasma del proxy de IA retirado; alta de la familia `-styled.html` como no versionada; reclasificación de los informes de auditoría fechados. Detalle en `docs/audit.md` → "Ronda 6".
- **2026-09 (fase previa) —** se crea `docs/docs-state-index.md` como índice autoritativo de estado documental; sin retiradas en esa fase.