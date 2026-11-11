# BookmarkForge — programmatic Shorts renderer

Renders vertical (1080×1920) marketing Shorts from **real screen recordings**
of the app using [Remotion](https://www.remotion.dev) (React → video).

This is the "footage-real + automated-editing" pipeline from
`docs/marketing/automation.md`: you record the product once, the machine
assembles hook → clips → captions → progress bar → CTA. Nothing here
generates fake product footage or AI avatars.

## Setup (once)

```bash
cd video
npm install
```

**Windows ARM64:** neither Remotion's Chrome Headless Shell nor its
ffmpeg compositor ships an ARM64 build. Two workarounds are wired in:

- `REMOTION_BROWSER_EXECUTABLE` → any installed Chromium (Edge works) for
  the screenshot/browser side.
- `scripts/patch-remotion-arm64.mjs` (runs automatically as `postinstall`)
  extracts the x64 compositor binaries and patches the arch check — they
  run under Windows Prism emulation. Render speed is ~3-4× slower than
  native x64 but works.

```bash
REMOTION_BROWSER_EXECUTABLE="C:\\Program Files (x86)\\Microsoft\\EdgeCore\\<ver>\\msedge.exe" node scripts/make-short.mjs ...
```

## Record real clips automatically (Playwright)

`public/clips/` ships with five real screen recordings made by
`scripts/make-clips.mjs`, which drives the actual app in headless Chromium
(portrait 540×960 ≈ 9:16) and saves one `.webm` per scene:

- `vault-setup.webm` — first-run vault creation (only recorded once)
- `vault-unlock.webm` — unlock screen → dashboard
- `dashboard-tour.webm` — cinematic scroll through the dashboard
- `save-bookmark.webm` — quick capture → saved → bookmarks list
- `search.webm` — bookmarks view → live search

Re-record anytime (the vault persists in `video/.profile/`):

```bash
node scripts/make-clips.mjs
```

It starts `vite --mode test` on :5199 automatically. Delete
`video/.profile/` to force a fresh vault setup recording.

## Assets

- `public/clips/` — real screen recordings (webm/mp4). Re-record with
  `make-clips.mjs` or drop in your own captures.
- `public/brand/logo-mark.png`, `logo.png` — already copied from `public/`.
- Optional: `public/narration.mp3` for voice-over (generate with any TTS;
  keep the script human-approved first).

## Render a short

```bash
node scripts/make-short.mjs \
  --hook "Stop losing your bookmarks." \
  --clip clips/vault-unlock.mp4:6:"Everything you save stays on your device." \
  --clip clips/search.mp4:5:"Find anything in seconds." \
  --cta "bookmarkforgeapp.com" \
  --cta-sub "Private. Local-first. Free forever." \
  --out out/short-01.mp4
```

Clip spec: `<path>:<seconds>[:<caption>]`. Paths are relative to
`video/public/`. Duration adapts automatically (hook 2.5s + clips + CTA 3s).

## Preview interactively

```bash
cd video && npm run dev   # Remotion Studio at localhost:3000
```

Edit `src/theme.ts` `DEFAULT_PROPS` or pass `--props` to experiment.

## Publishing

Exports a standard h264 mp4 (yuv420p) ready for YouTube Shorts, TikTok and
Reels. Schedule it through Buffer/Postiz **after human review** — same
approval-first policy as `docs/marketing/n8n-article-to-social.json`.

## Brand tokens

Colors in `src/theme.ts` mirror `public/brand-tokens.css`
(`--accent-primary: #0ea5e9`). Keep them in sync if the brand changes.
