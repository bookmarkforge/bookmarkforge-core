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
- The public export includes an auditable `manifest.json` and fails if a Pro
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

## Core MIT

Includes local vault, bookmark CRUD, notes, basic search, basic import/export,
vault security, interface, PWA/extensions, i18n, and organization views not
identified as Pro.

## Pro proprietary

Includes, among others, local AI (WebLLM/Ollama on the client), RAG and
specialized agents, P2P sync, flashcards, PDF/OCR, advanced exports, advanced
backups, and associated commercial services. The server AI proxy no longer
exists (removed in 2026-09): AI features are client-side and call the provider
with the user's own key. The exact list and its paths are maintained in
`scripts/pro-boundary.mjs` and consumed equally by the exporter, the
compilation boundary generator, and the `check:open-core` gate; if a
discrepancy exists, the automated exclusion prevails until the maintainer
reviews it.

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
