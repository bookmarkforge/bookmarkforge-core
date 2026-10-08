# ADR-062 — Smoke gate for landings

- **Status:** accepted (implemented: `scripts/check-landing-smoke.mjs` with its
  suite in `scripts/__tests__/check-landing-smoke.test.mjs`, `npm run
  check:landing-smoke` in `check:deploy` and `check:build-verification`, and an
  own step "Smoke the landing routes in a real browser" in the `build` job of
  `ci.yml`)
- **Date:** 2026-09-21 (implemented: 2026-09-24)

## Context

The public entry pages are served as static HTML and do not go through the
React shell. A correct build does not guarantee that routes, forms, legal
links, basic SEO and absence of console errors work in a browser.

## Decision

The release runs both halves of this decision:

1. **`npm run check:landings-fresh`** (ADR-051): the committed HTML must be
   identical to the reproducible render of its template and translations. Offline,
   inside `npm run check`.
2. **`npm run check:landing-smoke`** (this ADR): a local static server that
   applies the same routing contract as the edge (`public/_redirects`:
   200 rewrites, the splat, its `!` exclusions and the SPA fallback) and opens
   in Chromium the 31 routes of the registry (`landing-registry.mjs`: 30 landings
   plus the Pocket page). Per route it checks:

   - **navigation** — HTTP 200, `<html lang>`/`dir` matching those of the
     translation the page was rendered from, non-empty `<title>`, and every
     same-origin link on the page resolving to 200;
   - **critical resources** — stylesheets, scripts, icons, manifest,
     images and its own `og:image`: 200 with a non-empty body. The check does not
     stop at the status code: `_redirects` excludes `.css/.js/.png/…` from
     the splat but **not** `.gif`, so a removed GIF answers 200 with the shell's
     HTML — broken image, no 404 and no console error — and only the
     served `content-type` gives it away;
   - **console** — zero console errors from the origin itself and zero uncaught
     exceptions. A blocked third-party resource is recorded as a note: this
     harness has no network and must not invent one.

The gate does **not** enter `npm run check`: that chain is offline by contract
(ADR-064) and this gate needs a Chromium binary. Its place is the release path
(`check:deploy`; `check:nightly` inherits it, and `check:build-verification`
groups it with the other browser gate) and an own step in the `build` job of
`ci.yml`, which already installs Chromium for `test:performance`.

The note this ADR carried — "that check remains a manual step of the
release checklist" — was also false:
`docs/launch-checklist.md` does not mention landings in any form
(`grep -rn "landing" docs/launch-checklist.md` → no results). There was no gate
nor manual step: this half of the decision did not exist anywhere.

## Criterion

A template or translation change regenerates `public/` and is reviewed in the same
change. A smoke failure blocks the release; the manual purchase,
accessibility and consent checks remain separate and must be recorded
in the release checklist.

## Consequences

On its first run the gate found two live defects, neither visible
to a render diff:

- the EN (root) landings linked in the footer to `/en/privacy-and-terms.html`,
  a route that does not exist: the EN legal page lives at the root and only the five
  localized primaries have a directory. The rule was already encoded in
  `check-seo`, `check-sitemap-coverage`, `check-hreflang-graph` and
  `check-page-figures`; the template was the only place that ignored it;
- the landings referenced `<img src="/landing-demo-tour.gif">`, an asset
  retired together with the demo-media pipeline, which the SPA fallback served
  as a 200 `text/html`.

The generated HTML is still treated as a versioned artifact and the gate adds the
obligation that routes genuinely open; it does not replace manual review
of conversion, accessibility or compliance.
