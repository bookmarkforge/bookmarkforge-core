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
| `docs/ROPA.md` | vivo | Inventario RGPD; contiene campos operativos/legales por completar. |
| `docs/api.md` | vivo | Vista general de la API del servidor acompañante. |
| `docs/architecture.md` | vivo | Arquitectura y decisiones pendientes. |
| `docs/audit-report-2026-09-02.md` | vivo | Informe de auditoría concreto con hallazgos B-1, M-1 y derivados. Enlazado de forma activa. |
| `docs/audit-report-2026-09-04.md` | vivo | Informe de re-verificación; referencia el bloqueo legal del ROPA y gates. |
| `docs/audit.md` | vivo | Fuente principal de auditoría continua y ledger de hallazgos. |
| `docs/drill-run-2026-08-31-rollback-docker.md` | archivo | Evidencia concreta de un drill histórico; el estado vivo lo tiene `docs/operations.md`. |
| `docs/github-secrets-and-push-runbook.md` | vivo | Runbook de secretos y push. |
| `docs/google-search-runbook.md` | vivo | Runbook de Google Search: Search Console, envío del sitemap y cobertura noindex de /app. |
| `docs/history-attribution.md` | archivo | Atribución histórica; útil como registro, no como fuente principal actual. |
| `docs/internal-security-checklist.md` | vivo | Checklist interno de seguridad. |
| `docs/launch-checklist.md` | vivo | Checklist de lanzamiento; fuente de varios gates automatizados. |
| `docs/legacy-compatibility-plan.md` | vivo | Plan de compatibilidad/migración de formatos old. |
| `docs/legacy-schema-version-map.md` | vivo | Registro versionado de esquemas RxDB activos; se genera desde src/db/schema.ts para diagnóstico de compatibilidad sin acceso al vault. |
| `docs/openapi.yaml` | vivo | Especificación OpenAPI 3.1.0 del servidor acompañante. |
| `docs/operations.md` | vivo | Operaciones, SLOs de referencia, drills, gates nocturnos, evidencia. |
| `docs/ops-nightly.md` | vivo | Operaciones nocturnas, anclas de auditoría, gates. |
| `docs/que-nos-falta.md` | vivo | Resumen de deudas pendientes. |
| `docs/release-note-r3-4.md` | vivo | Notas de release. |
| `docs/sast-triage.md` | vivo | Guía de triaje SAST. |
| `docs/support-data-loss-runbook.md` | vivo | Runbook de soporte para pérdida de datos: 3 caminos de recuperación, plantillas y prevención. |
| `docs/security.md` | vivo | Controles de seguridad, RGPD, configuración obligatoria de producción. |
| `docs/server-api-index.md` | vivo | Índice detallado de endpoints del servidor. |
| `docs/staging-smoke.md` | vivo | Notas de smoke de staging. |

Nota: `docs/drill-run-2026-08-31-rollback-docker.md` se clasifica como `archivo`, no como `retirable`, porque el repositorio tiende a mantener evidencia histórica. Esta fase **no lo retira**. Enfocamos la retirada solo en documentos que cumplan `retirable` y que además no sean necesarios para la cadena histórica.

## Decisión para esta fase

Esta fase **no retira archivos**. La clasificación confirma que:

- No hay documentos en estado `retirable`.
- Hay exactamente dos documentos en estado `archivo`: `docs/history-attribution.md` y `docs/drill-run-2026-08-31-rollback-docker.md`.
- El resto está `vivo`.

Si en el futuro un documento pasa a `retirable`, este índice debe actualizarse antes de tocar el filesystem, y la retirada debe incluir:
1. Actualización de `docs/docs-state-index.md`.
2. Búsqueda de referencias locales en `docs/`, `.github/`, `scripts/`, `src/tests/`, `AGENTS.md` y `CONTRIBUTING.md`.
3. Confirmación de que el documento retirado era realmente alcanzable desde los canales vivos antes de borrarlo.

## Registro de cambios de esta fase

- Se crea `docs/docs-state-index.md` como índice autoritativo de estado documental.
- No se eliminan documentos en esta fase porque la clasificación no encontró candidatos `retirable` sin valor histórico.