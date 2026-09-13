# Mapa de versiones de esquema — BookmarkForge

Este archivo registra el mapa de versiones del esquema RxDB activo para la codebase actual.

Se genera automáticamente desde `src/db/schema.ts`. No se edita a mano.
Su función es ofrecer un diagnóstico estable de compatibilidad/migración sin tocar datos reales del vault.

| Colección | Versión | Campos cifrados |
|---|---|---|
| `bookmarkSchema` | 7 | `` |
| `chunkSchema` | 3 | `` |
| `documentAttachmentSchema` | 2 | `` |
| `documentSchema` | 2 | `` |
| `flashcardSchema` | 2 | `` |
| `folderSchema` | 4 | `` |
| `highlightSchema` | 3 | `` |
| `insightSchema` | 3 | `` |
| `messageSchema` | 4 | `` |
| `templateSchema` | 3 | `` |
| `versionSchema` | 2 | `` |

Nota: la versión se lee desde la propiedad `version` declarada en el esquema RxDB correspondiente.
