# Inventario documental — BookmarkForge

Este índice se genera desde los documentos presentes en el checkout. Un documento eliminado deja de aparecer aquí; cualquier retiro debe quedar trazado en `docs/PENDIENTES.md` o en un ADR.

## Estados

| Estado | Significado |
|---|---|
| `vivo` | Documento activo o usado por un flujo del proyecto. |
| `transitorio` | Documento pendiente de consolidación. |
| `archivo` | Evidencia histórica conservada. |
| `retirable` | Puede eliminarse únicamente tras pasar `check:docs-retire`. |

## Documentos presentes

| Documento | Estado | Nota |
|---|---|---|
| `docs/ADR-001-check-static-brand.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-019-argon2id-migration.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-026-post-audit-hardening-wave-1.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-027-post-audit-hardening-wave-2.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-028-gate-drift-detection.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-029-webrtc-sync-hardening.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-030-security-tier-regression-umbrella.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-032-disk-backup-pruning.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-033-restore-surface-auth-errors.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-034-backup-age-and-storage-quota.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-037-backup-deletion-ownership.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-038-constant-time-hmac-attestation.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-039-sw-integrity-runtime.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-040-docs-markdown-gate-fusion.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-042-css-only-user-themes.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-043-check-seo-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-044-og-image-policy.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-045-check-brand-logo-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-046-vault-kdf-salt-rotation.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-047-claim-drift-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-048-license-claims-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-049-manual-figures-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-050-page-figures-gate-and-planner.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-051-landings-fresh-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-052-v5-format-sunset.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-053-vault-salt-registry.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-054-check-quick-tier.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-055-collapsible-surfaces.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-056-documented-npm-commands-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-057-documented-reference-integrity-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-058-release-target-confirmation-gate.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-059-documentation-retirement.md` | vivo | Registro de decisión arquitectónica. |
| `docs/api.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/architecture.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/audit-report-2026-09-02.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/audit-report-2026-09-04.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/audit.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/deployment-runbook.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/docs-state-index.md` | vivo | Inventario canónico generado por scripts/doctor-docs-index.mjs. |
| `docs/drill-run-2026-08-31-rollback-docker.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/edge-case-hardening-vault-audit.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/github-secrets-and-push-runbook.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/google-search-runbook.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/history-attribution.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/index.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/internal-security-checklist.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/ios-day0-session-sheet.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/ios-manual-test-script.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/launch-checklist.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/launch-day-smoke.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/legacy-compatibility-plan.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/legacy-schema-version-map.md` | vivo | Mapa de compatibilidad de esquemas generado desde src/db/schema.ts. |
| `docs/legal-closing-package.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/manual-usuario-ar.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-bg.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-cs.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-da.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-de.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-el.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-en.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-fi.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-fr.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-he.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-hi.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-hr.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-hu.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-id.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-it.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-ja.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-ko.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-nl.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-no.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-pl.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-pt.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-ro.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-ru.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-sv.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-th.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-tr.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-uk.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-vi.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario-zh.md` | vivo | Manual localizado de usuario. |
| `docs/manual-usuario.md` | vivo | Manual localizado de usuario. |
| `docs/onboarding-emails.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/ONBOARDING.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/openapi.yaml` | vivo | Contrato OpenAPI versionado del servidor companion. |
| `docs/operations.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/ops-nightly.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/p2p-sync-manual-test-script.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/p2p-sync-session-prep.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/PENDIENTES.md` | transitorio | Registro de trabajo pendiente y deuda conocida. |
| `docs/pricing-decision.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/que-nos-falta.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/release-note-r3-4.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/RELEASE-STATUS.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/ROPA.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/sast-triage.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/scripts-inventory-scanner-limits.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/security.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/SELF-HOSTING.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/server-api-index.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/staging-smoke.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/support-data-loss-runbook.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |

## Política de retiro

Los documentos retirados no se reintroducen automáticamente. Antes de eliminar un documento presente, debe marcarse `retirable`, documentarse el motivo y pasar el gate de referencias. Los documentos críticos de operación, seguridad y cumplimiento no se consideran retirables: deben mantenerse o sustituirse por un documento equivalente.
