# BookmarkForge

Local-first personal knowledge vault for your bookmarks and reading: encrypted in your browser, works offline, syncs peer-to-peer — no accounts, no tracking, no one can read your data. Not even us.

## Why it exists

Most bookmark managers store your library in someone else's cloud in plain text. BookmarkForge keeps everything **encrypted on your device** (AES-GCM with an Argon2id-derived key), so your data is yours in the strongest sense: we couldn't hand it over even if we wanted to.

- **Local-first** — the app lives in your browser; your vault works fully offline.
- **Zero-knowledge vault** — 24-word recovery phrase, tampering detection, fail-closed storage.
- **P2P sync** — optional device-to-device sync over WebRTC; servers relay encrypted traffic, never content.
- **Open Core, MIT** — audit and adapt the public Core; Pro components are not included in this export.

## Quick start (self-host / local run)

```bash
npm install
npm run dev        # http://localhost:5173
```

Build for production: `npm run build` (see `docs/architecture.md` for the full
topology: static web + signaling/licensing companion server).

## Free vs Pro

The public repository contains the MIT-licensed Core. The private distribution
adds proprietary Pro components, unlocked at runtime by a **signed license**
purchased from the official store:

| | Free | Pro |
|---|---|---|
| Bookmarks | 1,000 | Unlimited |
| Smart search (Fuse.js + semantic) | ✅ included | ✅ |
| Encrypted backups & PDF/OCR | — | ✅ |
| Flashcards from bookmarks | — | ✅ |
| P2P device sync | — | ✅ |
| Priority support | Community | Direct |

**Buy a Pro license:** [bookmarkforge.com](https://bookmarkforge.com) —
$59 Early Bird (first 200 licenses) → $79 regular.

## User Manual

- [Español](manual-usuario.md) · [English](manual-usuario-en.md)
- [PDF Español](manual-usuario.pdf) · [PDF English](manual-usuario-en.pdf)
- The full set ships in **30 languages** under `docs/`: see [docs/index.md](docs/index.md).

## Self-hosting & MIT Core

The code in this public repository is the MIT-licensed Core. You may run, study,
modify and redistribute it under the terms in `LICENSE`. Proprietary Pro
features and private infrastructure are intentionally excluded. The
BookmarkForge name and logo remain protected by `TRADEMARKS.md`.

Running the Core for yourself or your team is permitted without payment.

### Where the Pro code went

Pro code is resolved two ways in this build, both enforced in CI by
`npm run check:open-core`:

1. **Behind the entitlement gate.** Core components resolve the Pro services
   (encrypted backups, PDF/OCR extraction, P2P sync, and the proprietary AI
   surfaces — the local model runtime, RAG orchestration, expert agents and
   flashcard generation) through `src/services/pro-access.ts` (MIT), which
   calls `hasProAccess()` *before* fetching the Pro chunk. A Free user never
   downloads that code; the call rejects with a typed `ProUnavailableError`
   that the UI presents as a "requires Pro" state or upgrade prompt, never a
   silent dead button. Degradation is honest: the capability probe resolves
   false, diagnostics report the engine as not initialized, and the expert
   agents panel shows the upgrade message.2. **Client-side AI boundary.** Cloud providers are called directly by the
   browser with a user-supplied key; no server-side AI relay or placeholder is
   shipped. (The AI client tree is largely Core MIT: the BYOK cloud path and
   the embedding engine behind free smart search are open; see `OPEN-CORE.md`
   in the private tree for the exact Pro list.)



Reaching a Pro surface is never silent: the placeholder helper also dispatches
`open-core:pro-reached`, and the loader refuses to hand out a placeholder as if
it were real. Either signal opens the in-app **"Available in Pro"** panel
(`ProRequiredBoundary`), which explains what happened and links to the Pro
section with the current license price. The console line remains as the exact
call-site pointer for developers.

## Documentation

Found a vulnerability? Please report it privately — see
[SECURITY.md](.github/SECURITY.md). Please do not open public issues for
security reports.

## License

Copyright © 2026 BookmarkForge

This Core is free software: you can redistribute and/or modify it under the
terms of the MIT License in `LICENSE`.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.
