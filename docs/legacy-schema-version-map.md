# Schema version map — BookmarkForge

This file records the RxDB schema version map active for the current codebase.

It is automatically generated from `src/db/schema.ts`. Do not edit manually.
Its function is to offer a stable compatibility/migration diagnosis without touching real vault data.

| Collection | Version | Encrypted fields |
|---|---|---|
| `bookmarkSchema` | 8 | `` |
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

Note: the version is read from the `version` property declared in the corresponding RxDB schema.
