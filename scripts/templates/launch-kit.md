# Launch kit — BookmarkForge directory & community submissions

Internal copy for directory submissions and community posts. Claims must stay
within the accurate list: local-first, encrypted vault (AES-256-GCM + Argon2id),
optional on-device AI and BYO-API-key providers, imports from Pocket /
Raindrop / Omnivore / HTML / CSV / JSON / Markdown, Open Core (MIT core),
free tier, no account required for local use. Do NOT claim zero-knowledge
sync, user counts, or press quotes.

Site: https://www.bookmarkforgeapp.com  ·  App: https://www.bookmarkforgeapp.com/app

## Taglines (pick per directory)

- EN: "Your private, local-first AI bookmark vault"
- EN alt: "Bookmark manager with on-device AI — your data never leaves your machine"
- EN alt: "The encrypted second brain for your browser"
- ES: "Tu bóveda de marcadores privada con IA local" <!-- i18n-allow: Spanish tagline for ES directory submissions -->
- ES alt: "Gestor de marcadores cifrado, con IA que no espía tus datos" <!-- i18n-allow: Spanish tagline for ES directory submissions -->

## Short description (~50 words, EN)

BookmarkForge is a local-first knowledge vault for your bookmarks. Everything
is encrypted on your device (AES-256-GCM, Argon2id) and stored in your browser —
no account, no tracking, no server-side copies. Optional AI runs on-device or
with your own API keys: auto-tagging, semantic search, summaries and digests.
Imports from Pocket, Raindrop, Omnivore, browsers and Markdown. Open Core, MIT.

## Short description (~50 words, ES) <!-- i18n-allow: Spanish description for ES directory submissions -->

BookmarkForge es una bóveda de conocimiento local-first para tus marcadores. <!-- i18n-allow -->
Todo se cifra en tu dispositivo (AES-256-GCM, Argon2id) y se guarda en tu <!-- i18n-allow -->
navegador: sin cuenta, sin rastreo, sin copias en servidores. IA opcional en <!-- i18n-allow -->
local o con tus propias claves: auto-etiquetado, búsqueda semántica, resúmenes <!-- i18n-allow -->
y digests. Importa desde Pocket, Raindrop, Omnivore, navegadores y Markdown. <!-- i18n-allow -->
Open Core, MIT.

## Long description (~120 words, EN — for Product Hunt / detailed fields)

Every browser has a bookmarks bar; nobody has a system. BookmarkForge turns
your saved links into a private, searchable knowledge vault.

- **Private by design**: AES-256-GCM encryption with Argon2id key derivation.
  Your vault lives in your browser's IndexedDB — we never see it.
- **AI that respects you**: optional on-device models (WebLLM/Transformers.js)
  or bring-your-own API keys. Auto-tagging, semantic search, embeddings,
  summaries — all optional, all yours.
- **Imports everything**: Pocket HTML, Raindrop, Omnivore, browser bookmark
  exports, CSV/JSON, Markdown, ZIP vaults — with dedup and rollback.
- **A real app, not a demo**: encrypted backups, versioning, knowledge
  dashboards, browser extension, 30 languages, works offline (PWA).
- **Open Core**: the core is MIT-licensed on GitHub. Pro adds cloud sync,
  local translation and more.

Free tier, no account needed to start.

## Directory & launch submission checklist

Per directory, have ready: logo (512px+ PNG), 3-5 screenshots (1280×800),
 tagline, short desc, long desc, category, tags, website URL, GitHub URL
 (github.com/bookmarkforge/bookmarkforge-core), pricing (Freemium),
 platform (Web / Browser extension / PWA / Self-hosted option).

Suggested tags EN: bookmark manager, read-it-later, PKM, second brain,
knowledge management, privacy, encrypted, offline-first, AI, self-hosted,
open source, productivity, web clipper.

Suggested categories: Productivity / Bookmarks & Read-Later / AI Tools /
Knowledge Management / Privacy & Security / Open Source.

### Paid directories — SKIP for now (verified 2026-10)

- There's An AI For That: $49 minimum ($437 featured); only free lane is a
  monthly X-thread lottery.
- Futurepedia, TopAI.tools ($47+), Easy With AI ($125): pay-to-play, weak
  organic traffic for a site at our authority level.
- BetaList: paid only (~$39).
Revisit paid directories only after the site has real traffic/conversions.

### Launch platforms (free or ~$15, do these FIRST — they concentrate traffic)

| Platform | Cost | Link / notes |
| --- | --- | --- |
| Show HN | Free | news.ycombinator.com/submit — see post draft below |
| Peerlist Launchpad | Free | peerlist.io/launchpad — needs a founder profile, launches weekly |
| Uneed | Free queue (slow) / $14.99 fast-track | uneed.best — the $15 fast-track is the one paid option worth it |
| Fazier | Free w/ backlink badge / $29 | fazier.com — daily board, active indie community |
| Microlaunch | Free monthly batch | microlaunch.net — month-long exposure |
| Dev Hunt | Free (long queue) | devhunt.org — GitHub sign-in, open-source friendly |
| Smol Launch / TinyLaunch / StartupBase | Free | smaller boards, still worth 10 min each |

Stack 2-3 launches over 2-3 weeks instead of betting on one day.

### Passive directories (free, slow SEO trickle — do in background)

- SaaSHub — submit at saashub.com (free)
- Slant — answer "best bookmark managers" questions at slant.co
- awesome-selfhosted — PR at github.com/awesome-selfhosted/awesome-selfhosted
- selfh.st — community index of self-hosted apps, add via their repo
- Launching Next — free reviewed listing, evergreen dofollow
- AlternativeTo — DONE, track status
- directree.io — free listing with claim flow

## Strategy note (verified against real 2026 data)

Directories send tens of visits, not thousands — they are passive SEO links.
The real spikes come from launch platforms (Show HN, Peerlist, Uneed, Fazier)
which concentrate attention in one day. Plan: 3-4 launches staggered over
2-3 weeks + passive directories in the background. Total effort ~1-2 days.

## Show HN post (English, HN audience loves this pitch)

Title: Show HN: BookmarkForge – Encrypted, local-first AI bookmark vault (open core)

Body:

I got tired of bookmark managers that are either cloud services that read
everything you save, or local tools with no intelligence. So I built
BookmarkForge: a vault where your bookmarks are AES-256-GCM encrypted on
your own device (IndexedDB + WebCrypto + Argon2id), and AI features
(auto-tagging, semantic search, summaries) run optionally on-device or
with your own API keys.

- Imports: Pocket, Raindrop, Omnivore, browser exports, CSV/JSON, Markdown
- 30 languages, PWA with offline support, browser extension
- Open Core: MIT core on GitHub, Pro adds sync/translation
- No account needed; free tier

It's live at https://www.bookmarkforgeapp.com — I'd love feedback,
especially on the crypto/storage layer (it's the part I'm least sure about).

## Product Hunt retry checklist (what "not prepared enough" usually means)

- [ ] GIF/screen recording ≤60s showing the core loop (import → search → result)
- [ ] 4-6 gallery images 1270×760 (real UI, not mockups)
- [ ] tagline ≤60 chars: "Private AI bookmark vault — your data stays yours"
- [ ] first comment written in advance (maker story, why, what's next)
- [ ] launch Tue–Thu, 12:01 AM PT sharp
- [ ] reply to EVERY comment in the first 4 hours
- [ ] share the launch link to your own channels at go-time (email list,
      Twitter/X, Reddit, communities) — PH rewards early velocity
- [ ] optional: ask 3-5 friendly people to leave genuine comments (not upvotes)

## Reddit post drafts (genuine "I built" angle — works better than promo)

r/selfhosted:
Title: [Self-hosted] BookmarkForge – encrypted local-first bookmark vault with optional on-device AI
Body: Short story of the problem (cloud bookmark managers read everything),
what it does, tech stack (React, IndexedDB, WebCrypto, workers), link, ask
for feedback on the encryption approach.

r/privacy:
Title: I built a bookmark manager where your data never leaves your device
Body: privacy-first pitch, no telemetry, encrypted vault, optional BYO-key AI.
Link + honest limitations.

r/ObsidianMD / r/productivity:
Title: Tired of saving links you never read? I built a "second brain" for bookmarks
Body: the backlog pain, digest/knowledge features, link. Frame as "feedback
wanted", not "download now".

## Rules for all posts

- Disclose you're the maker (always).
- Lead with the problem, not the product.
- One link only, at the end.
- Respond to every comment for 48h.
- Never post the same text in multiple subs same day (shadowban risk).
