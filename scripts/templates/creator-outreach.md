# Creator outreach kit — BookmarkForge

Internal template for the `creators:find` pipeline. English only; translate
per creator when needed.

## Product briefing (accurate claims only)

- Local-first AI knowledge vault: bookmarks, notes and documents stay on the
  user's device; the vault is encrypted (AES-256-GCM, Argon2id KDF).
- Optional local AI (WebLLM/Transformers.js in workers) and BYO-API-key cloud
  providers — no server-side AI key, no tracking.
- Imports from Pocket, Raindrop, Omnivore, generic HTML/CSV/JSON, Markdown.
- Open Core: core app is MIT; Pro adds cloud sync, local translation, etc.
- Free tier exists; no account required for local use.

Do NOT claim: "fully offline AI for everything", "zero-knowledge sync"
(sync is E2E-encrypted but exists), specific user counts, or press quotes.

## Short email (YouTube creators with business email)

Subject: Quick collab idea — BookmarkForge (private AI bookmark vault)

Hi {{name}},

I built BookmarkForge — a local-first, encrypted bookmark/knowledge vault with
optional on-device AI (tagging, semantic search, summaries). No tracking, no
account needed, your data never leaves your machine unless you want it to.

I think it fits your {{channel niche}} content. Would you be open to trying it
and, if you like it, making a short video? Happy to set you up with a Pro
license for testing and an affiliate-style arrangement if you're interested.

The app: {{utmLink}}

Thanks either way,
{{your name}}

## DM / comment opener (Instagram, TikTok, X)

Hey {{name}} — loved your video on {{video title}}. I make BookmarkForge, a
private/local-first AI bookmark vault (encrypted, no tracking). Think it'd
resonate with your audience — want early access + a license to check it out?

## Follow-up (after 5–7 days, one only)

Hi {{name}}, just bumping this in case it got buried — no worries if not a
fit. The app is free to try: {{utmLink}}

## Tracking

- Pipeline tracker: `scripts/templates/creator-outreach-tracker.csv`. Its
  first 14 columns match the `creators:find` CSV output exactly — append
  result rows directly, then fill the tracking columns:
  `status` (`new` → `contacted` → `replied` → `negotiating` → `video_live` →
  `dead`), `contactedDate`, `repliedDate`, `videoLiveDate`, `videoUrl`,
  `licenseIssued`, `licenseKeyId`, `notes`.
- Import into Google Sheets/Excel for filtering and sorting; the file is
  UTF-8 CSV, commas quoted.
- Each creator gets a unique `utmLink` (`utm_content=<handle>`).
- The app does not read UTM params itself; measure via host analytics
  (Vercel/Netlify) or issue per-creator license keys (`licenseIssued` /
  `licenseKeyId` columns) for conversion counts.
