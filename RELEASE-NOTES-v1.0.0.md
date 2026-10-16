# BookmarkForge v1.0.0 — Release Notes

*First stable release of the public repository. This repo ships the **MIT-licensed Core**; Pro features are proprietary and intentionally not part of this export.*

BookmarkForge is a local-first personal knowledge vault for your bookmarks and
reading: everything lives encrypted in your browser, works fully offline, and
syncs peer-to-peer — no accounts, no tracking, no one can read your data. Not
even us.

---

## The Core (MIT) — what ships in this release

Everything below runs in this public build exactly as released:

- **Bookmarks & reading** — full management: add, edit, tag, organize, search,
  archive; importing from Pocket, browser exports (HTML), CSV and more, with
  dates and tags preserved.
- **Rich text notes** — block-based editor (BlockNote) attached to any item.
- **Knowledge graph** — visual map of your library (D3), with calendar, Kanban
  and gallery views.
- **Smart search — included free** — instant fuzzy search (Fuse.js) plus
  semantic search over embeddings that run in your browser. No subscription.
- **Security vault** — AES-GCM encryption with an Argon2id-derived key, a
  24-word recovery phrase, tampering detection and fail-closed storage. Your
  data is yours in the strongest sense: we couldn't hand it over even if we
  wanted to.
- **Import / export** — open formats in and out (JSON, CSV, HTML); no lock-in.
- **30 languages** — full interface and documentation (see `docs/index.md`).
- **PWA + browser extension** — installable, works offline, quick capture from
  any page.
- **Free tier** — up to 1,000 items, all Core features. Forever free.

## What Pro adds (proprietary — not in this repository)

Pro is a separate, closed-source layer. Its implementation is excluded from the
public export, enforced by CI:

| Feature | What it does |
|---|---|
| Local AI (WebLLM) | LLM running inside your computer, no cloud round-trip |
| RAG chat | Grounded answers over your own library |
| 30+ expert agents | Specialized one-click analyses of your vault |
| Flashcards | Spaced-repetition study cards generated from your bookmarks |
| P2P device sync | End-to-end encrypted sync between your devices |
| PDF + OCR | Read, extract and index PDF documents |
| Encrypted backups | Automatic, versioned, encrypted local backups |
| BYOK cloud AI | Provider calls originate in the browser with the user's key (no server-side proxy) |

**Pricing** — one-time purchase, no subscription: **$59 Early Bird** (first 200
licenses) → **$79 regular**. A license covers the lifetime of v1: all v1.x
bugfixes and security updates forever, 12 months of feature updates, and you
keep v1 working forever. Future major versions (v2, v3) are separate products,
60% off for existing owners. 30-day refund, no questions asked. Buy at
[bookmarkforgeapp.com](https://bookmarkforgeapp.com).

> **Honest note for this build:** a Pro license does **not** unlock Pro
> features inside this repository, because the Pro code simply is not here. In
> a self-hosted Core build, Pro surfaces appear as a clear "Available in Pro"
> state instead of failing silently.

## How Pro is wired in this build

- Core components resolve Pro services through the entitlement gate
  `src/services/pro-access.ts` (MIT), which checks the license *before*
  fetching any Pro code — a Free user never downloads what they cannot use.
- Server-side, only signaling, licensing and telemetry endpoints are exposed;
  cloud AI calls stay in the browser and use the user's provider key.
- The exact list of proprietary modules is auditable in
  `scripts/pro-boundary.mjs`, and `npm run check:open-core` re-verifies this
  repository's boundary in CI on every push.

## Self-hosting

**Prerequisites:** Node.js ≥ 20.19.

```bash
git clone https://github.com/bookmarkforge/bookmarkforge-2026.git
cd bookmarkforge
npm install
npm run dev        # the app at http://localhost:5173
```

Production build: `npm run build`, then serve `dist/` from any static host —
the vault runs entirely in your browser.

**Companion server (optional)** — signaling for P2P, license validation and
opt-in analytics:

```bash
npm run server     # listens on :8787
```

**Docker** — a pinned multi-stage `Dockerfile` and a production
`docker-compose.prod.yml` are included.

**Bring your own key:** cloud AI providers (OpenAI, Gemini, …) are configured
in Settings; your key stays inside your vault and calls go directly from your
browser to the provider. The server no longer proxies AI calls.

Environment variables and the server API surface are documented in
[docs/architecture.md](docs/architecture.md) and
[docs/server-api-index.md](docs/server-api-index.md).

## Verification

This release was produced by the automated export pipeline: the public tree is
materialized, then typecheck, production build and the gate suite run *inside*
the exported tree on every push — the Open Core boundary cannot silently break.

## License & trademarks

- The Core is released under the [MIT License](LICENSE).
- Pro components are proprietary (see [NOTICE](NOTICE)).
- The BookmarkForge name and logo are protected under
  [TRADEMARKS.md](TRADEMARKS.md): forks must use a different name, logo and
  domain.

## Links

- Site & Pro licensing: <https://bookmarkforgeapp.com>
- User manuals in 30 languages: [docs/index.md](docs/index.md)
- Security reports: [SECURITY.md](.github/SECURITY.md) (please report privately)
