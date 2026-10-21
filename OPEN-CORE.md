# BookmarkForge Open Core Model

BookmarkForge uses an **Open Core** model: the core that allows saving,
organizing, importing, searching, and protecting a vault is published under the
MIT license; certain commercial features and advanced services remain
proprietary and are distributed under a Pro license.

## What this means in practice

- You can study, run, modify, and redistribute the MIT Core respecting `LICENSE`.
- The private development repository also contains Pro code. The MIT license
  **does not automatically cover everything that appears in this checkout**.
- `scripts/export-public-repo.mjs` produces the public repository and removes
  Pro components, private contracts, internal operations, and secrets.
- The public export includes an auditable `public/manifest.json` and fails if a Pro
  file appears in the result.
- The name, logo, and domains of BookmarkForge remain subject to the trademark
  policy in `TRADEMARKS.md`; the MIT license does not grant trademark rights.

## Compilation boundary

Excluding Pro files is not enough: the Core **imports** them. Without anything
in their place, the export would materialize but not compile (327 module not
found errors). `scripts/pro-boundary.mjs` closes that boundary at export time,
without touching a single line of product code:

- for each proprietary module referenced, the public tree publishes at the
  original path a pair consisting of
  - `<path>.d.ts`, the type surface generated from the real code (declarations
    only, no comments or implementation), which is what keeps the exported
    Core's `tsc` clean;
  - `<path>.js`, an inert module that exposes the same names. Its values can be
    called, constructed, and chained without ever throwing an exception (an
    Open Core build must not break its startup on a Pro call) and warns once
    per property, so that a reached Pro surface is identified instead of faking
    that it works;
- specifiers that write the `.ts` extension (Vite worker URLs, development URL
  imports in end-to-end tests) lose the extension so they resolve to the
  generated pair;
- configuration entries that only **name** a Pro file (coverage exclusions,
  dependency lists) are removed, because in the export there is nothing for
  them to point to.

Tests that read the proprietary implementation from disk and verify its text
are Pro behavior tests, so they are not copied: they live in the private
repository.

`check:open-core` verifies that boundary. In the private repository it only
registers the policy (Pro implementations must be there); in an exported tree
it checks the complete set: no Pro implementation present, every reference
covered by a marked pair without explicit extension, and consistent MIT
metadata. Since the public repository **is** an export, its CI re-audits its
own boundary on every run.

## Pro runtime loading

The compilation boundary prevents the export from breaking; the entitlement
gate decides what executes. Core components no longer statically import
non-AI Pro modules (backups, PDF extraction, P2P sync): they resolve them
through `src/services/pro-access.ts` (MIT), which queries
`licenseService.hasProAccess()` before requesting the first byte of the Pro
chunk:

- a Free user does not download Pro code — the request itself is behind the
  gate — and the call rejects with `ProUnavailableError`, a typed error that
  the interface presents as a "requires Pro" state or upgrade prompt, never as
  a silent dead button;
- a Pro user with a valid license loads the real implementation on demand,
  in its own chunk;
- the AI tree follows the same rule with product nuance: the license decision
  (exact list in `scripts/pro-boundary.mjs`) declares Pro only the real
  proprietary surfaces — the local runtime (WebLLMService), the RAG
  orchestration (GlobalRAGService), the expert agent registry, and flashcard
  generation — while the rest of the tree (cloud BYOK via ProviderManager, the
  RAGEngine embeddings engine that powers the Free plan's semantic search,
  TTS) is Core MIT and remains directly importable. Core consumers of the
  four Pro AI modules resolve them through the loader; degradation is honest:
  the capability probe resolves false, diagnostics report "not initialized",
  and the agents panel shows the upgrade prompt;
- when a placeholder surface is actually touched, the helper emits the
  `open-core:pro-reached` event and the loader rejects with
  `ProUnavailableError` instead of delivering the inert module;
  `ProRequiredBoundary` (mounted in MainApp) converts either signal into the
  "Available in Pro" panel, so a Core build explains the absence instead of
  faking it;
- `check:pro-imports` prevents this situation from eroding: it fails if any
  Core file — AI tree included — re-links statically to a Pro module outside
  the seam. There is no tolerated zone: every reference either goes through
  the loader or is part of the Pro side itself.

## Feature classification

Every shipped feature belongs to exactly one side. The machine-readable list of
**Pro implementations** is `scripts/pro-boundary.mjs` (`PRO_MODULE_PATHS`), read
equally by the exporter, the placeholder generator, `check:open-core` and
`check:pro-imports`; `check:open-core` fails if a path declared there is not
named in this table, so the published document cannot drift from the enforced
boundary.

"Tier" is the shipped product classification
(`src/constants/pricing.ts`). "Boundary" says **where** the line is
implemented: *excluded* means the implementation is proprietary code absent
from the public export (replaced there by a generated `.d.ts` + inert `.js`
pair), *core module* means the code is MIT and any entitlement is decided at
runtime by `licenseService.hasProAccess()`.

| Feature | Tier | Boundary |
|---|---|---|
| Local vault: bookmarks, notes, documents, tags, organization views, knowledge graph | Core | Core modules, no Pro reference |
| Vault security: AES-GCM, Argon2id, device key, lock/unlock, vault sharing/export | Core | Core modules, no Pro reference |
| Smart search: full-text plus on-device semantic search | Core (Free) | Core: `src/services/ai/RAGEngine.ts` (embedding + similarity engine, no LLM calls) |
| AI with your own API key (cloud BYOK, incl. Ollama) | Core (Free) | Core: `src/services/ai/ProviderManager.ts`, `src/services/ai/providers/**` |
| Import, basic export (JSON/HTML), templates | Core | Core: `src/services/UniversalImporter.ts`, `src/services/UniversalExporter.ts` |
| Folder sync (bidirectional vault↔folder, local filesystem) | Core | Core: `src/services/FolderSyncService.ts` |
| PWA, browser extension, web clipper | Core | Core: `extension/**`, `public/**` |
| Interface, i18n (30 locales), themes, landing and manual surfaces | Core | Core: `public/locales/**`, `scripts/build-landings.cjs` |
| Entitlement, the Pro seam, and the "requires Pro" degradation UI | Core | Core: `src/services/LicenseService.ts`, `src/services/pro-access.ts`, `src/components/ProRequiredState.tsx` |
| Companion server (self-hosting: health, licenses, client events, signaling relay) | Core | Core: `server/**` |
| P2P device-to-device sync (transport, signaling, protocol) | Pro | Excluded: `src/services/WebRTCSyncService.ts`, `src/services/SyncService.ts`, `src/services/sync/signaling.ts`, `src/services/sync/replication.ts`, `src/services/webrtc-sync/protocol.ts`, `src/services/webrtc-sync/validation.ts` |
| Encrypted backups and disk backups | Pro | Excluded: `src/services/BackupService.ts`, `src/services/DiskBackupService.ts` |
| Local AI runtime (on-device model, no API key) | Pro | Excluded: `src/services/ai/WebLLMService.ts` |
| RAG chat over your data | Pro | Excluded: `src/services/ai/GlobalRAGService.ts` |
| Expert agents | Pro | Excluded: `src/services/ai/SpecializedAgentsService.ts` |
| Flashcards and spaced repetition | Pro | Excluded: `src/services/ai/FlashcardService.ts` |
| PDF/OCR text extraction | Pro | Excluded: `src/services/pdfService.ts` |
| Pro entitlements of otherwise-Core code (free-tier bookmark cap, activation limit) | Pro | Core module with a runtime gate: `src/db/database.ts` (`FREE_LIMITS.maxBookmarks`), `src/constants/license.ts` (`maxActivationsPerLicense`) |

Two rules keep the table honest at the edges:

- **Pro is an exact file list, never a directory.** Mixed trees keep their Core
  parts: `src/services/webrtc-sync/compare.ts` (the revision comparator the Core
  folder sync imports) and the AI tree's Core modules (`RAGEngine`,
  `ProviderManager`, `VectorIndexService`) stay MIT while their Pro siblings are
  excluded.
- **The P2P sync surface degrades honestly.** The Core-side sync UI
  (`src/components/sync/**`) holds no Pro implementation: it resolves the
  replication manager through `src/services/pro-access.ts`, so a Free user
  downloads no Pro byte and the widget reports the true local-first state
  instead of a dead control. There is no server-side AI proxy any more
  (removed in 2026-09): server-side AI features are client-side and call the
  provider with the user's own key.

## Contributions

Core contributions are accepted under MIT. Do not send Pro code or copy
third-party code with an incompatible license. Before opening a change that
crosses the Core/Pro boundary, document the decision and update the export
gate.

## Trademark

A fork of the Core must use a different name, logo, and domain, and must not
suggest it is an official version of BookmarkForge. See `TRADEMARKS.md` in the
public export.

## Legal status

This document explains the technical distribution intent; it is not legal
advice. Before publishing a commercial version, the maintainer must review
copyright ownership, dependency licenses, and file-by-file classification.
