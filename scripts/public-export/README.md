# BookmarkForge

Local-first personal knowledge vault for your bookmarks and reading: encrypted in your browser, works offline, syncs peer-to-peer — no accounts, no tracking, no one can read your data. Not even us.

## Why it exists

Most bookmark managers store your library in someone else's cloud in plain text. BookmarkForge keeps everything **encrypted on your device** (AES-GCM with an Argon2id-derived key), so your data is yours in the strongest sense: we couldn't hand it over even if we wanted to.

- **Local-first** — the app lives in your browser; your vault works fully offline.
- **Zero-knowledge vault** — 24-word recovery phrase, tampering detection, fail-closed storage.
- **P2P sync** — optional device-to-device sync over WebRTC; servers relay encrypted traffic, never content.
- **Open core, AGPL-3.0** — audit every line of the crypto and the sync protocol.

## Quick start (self-host / local run)

```bash
npm install
npm run dev        # http://localhost:5173
```

Build for production: `npm run build` (see `docs/architecture.md` for the full
topology: web + signaling server + optional AI proxy companion).

## Free vs Pro

The full source is here — Free and Pro ship in the same codebase. Pro is
unlocked at runtime by a **signed license** purchased from the official store:

| | Free | Pro |
|---|---|---|
| Bookmarks | 1,000 | Unlimited |
| Flashcards from bookmarks | — | ✅ |
| Advanced export formats | — | ✅ |
| Priority support | Community | Direct |

**Buy a Pro license:** [bookmarkforge.com](https://bookmarkforge.com) —
$59 Early Bird (first 200 licenses) → $79 regular.

## Self-hosting & commercial use (AGPL-3.0)

This program is free software: you can run, study, share and modify it under
the **GNU Affero General Public License v3.0**. If you offer BookmarkForge as a
network service (modified or not), AGPL §13 requires you to offer your users
the corresponding source of your version.

Running the unmodified software for yourself or your team is exactly what the
license grants — no payment to us needed. A **commercial license** is only
required when you want to escape AGPL obligations, e.g. to:

- offer a hosted/managed BookmarkForge service **without** releasing your
  modifications' source,
- redistribute a modified, closed-source build,
- integrate BookmarkForge into a proprietary product.

Commercial licensing, support and updates: **sales@bookmarkforge.com**.

## Security

Found a vulnerability? Please report it privately — see
[SECURITY.md](.github/SECURITY.md). Please do not open public issues for
security reports.

## License

Copyright © 2026 BookmarkForge

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
