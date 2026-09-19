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
| `docs/ADR-026-documentation-retirement.md` | vivo | Registro de decisión arquitectónica. |
| `docs/ADR-040-docs-markdown-gate-fusion.md` | vivo | Registro de decisión arquitectónica. |
| `docs/api.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/docs-state-index.md` | vivo | Inventario canónico generado por scripts/doctor-docs-index.mjs. |
| `docs/legacy-schema-version-map.md` | vivo | Mapa de compatibilidad de esquemas generado desde src/db/schema.ts. |
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
| `docs/openapi.yaml` | vivo | Contrato OpenAPI versionado del servidor companion. |
| `docs/operations.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/PENDIENTES.md` | transitorio | Registro de trabajo pendiente y deuda conocida. |
| `docs/pricing-decision.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/RELEASE-STATUS.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/ROPA.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |
| `docs/security.md` | vivo | Documento presente en el checkout; revisar su estado antes de retirarlo. |

## Política de retiro

Los documentos retirados no se reintroducen automáticamente. Antes de eliminar un documento presente, debe marcarse `retirable`, documentarse el motivo y pasar el gate de referencias. Los documentos críticos de operación, seguridad y cumplimiento no se consideran retirables: deben mantenerse o sustituirse por un documento equivalente.
