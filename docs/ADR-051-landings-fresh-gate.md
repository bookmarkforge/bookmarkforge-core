# ADR-051: `check:landings-fresh` landings freshness gate

- **Status:** accepted (implemented: `scripts/check-landings-fresh.mjs` with
  its suite in `scripts/__tests__/check-landings-fresh.test.mjs`, step
  "Enforce landing page freshness" in `ci.yml`)
- **Date:** 2026-09-17

## Context

`pocket-alternative.html` derived from its translation JSON for weeks: it was
a hand-maintained HTML file whose source of truth evolved without anyone
regenerating the page. This round's sync fixed it by enabling its
generation in `build-landings.cjs` — but nothing prevented the drift from
coming back: a manual HTML edit, a template touched without a rebuild, or an
updated JSON with the HTML left behind in the commit all passed
unnoticed until a reader saw contradictory copy.

It is the same pattern as ADR-048/049/050 (parallel sources that diverge), but
with one particularity: here the truth materializes into committed files
(`public/*.html`), so the validation is about **freshness** — the artifact
must be exactly what the generator produces today — not about semantics.

## Decision

1. **In-memory render, not rebuild + worktree diff.** The gate renders
   the pages with the same Nunjucks environment, filters and templates as the build
   (`renderAll()`, exported by `build-landings.cjs` for this purpose) and compares
   against the committed files **without writing anything into `public/`**. A
   rebuild+diff would be fragile against the checkout's CRLF conversion
   and would dirty the tree on local runs.
2. **Normalized EOL comparison.** The builder writes LF; git may
   convert to CRLF on Windows. The comparison happens after normalization, so a fresh
   clone does not fail spuriously.
3. **Complete contract and orphans.** Every page the build produces must
   exist and match (missing = error); every file in `public/` that
   matches the generator's naming patterns but is no longer produced by the build
   is flagged as an orphan (renaming an output requires deleting the old one
   in the same PR). `404.html`/`404-<lang>.html` are exempt: they are
   static by declaration until the generator gains 404 support (TODO
   in `build-landings.cjs`).
4. **Actionable failure.** Each drift names the file and the first line of the diff,
   with the remedy (`npm run build:landings`). Exit 2 if the render throws —
   fail-closed like the gates of this family.
5. **`meta` category in the freeze (O-1).** It does not validate factual truth (that is
   `check:page-figures`, ADR-050) but the artifact↔source relationship: build
   hygiene, like `check:chunks` or `check:seo`. This ADR justifies the
   registration to `KNOWN_GATES`.
6. **Wiring.** `check:landings-fresh` in `package.json`, in the
   `npm run check` chain (alongside the public-content gates) and its own step in
   `ci.yml`. `build:landings` remains the only writer of these pages.

## Consequences

- No generated page can be hand-edited again: the PR that does so
  fails with the exact line of divergence.
- Changing a template or JSON without committing the regenerated HTML breaks CI — regeneration
  stops being an optional step that gets forgotten.
- The `build-landings.cjs` refactor (exported outputs, `renderAll`) is
  behavior-preserving: verified byte by byte against the 7 previous HTML files.
- Maintenance: the output naming pattern lives in a single regex; giving
  the generator 404 support means extending `renderAll` + the regex + this ADR.
