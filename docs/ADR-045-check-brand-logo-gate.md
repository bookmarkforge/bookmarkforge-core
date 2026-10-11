# ADR-045: Record and documentation for the `check:brand-logo` brand gate

- **Status:** accepted (implemented: `scripts/check-brand-logo-consistency.mjs` is in the `npm run check` chain with its adversarial suite in `scripts/__tests__/check-brand-logo-consistency.test.mjs`)
- **Date:** 2026-09-09

## Context

The BookmarkForge brand appears on many surfaces: the PWA manifest, the
extension manifests, `browserconfig`, the `favicon`/`apple-touch` links
of the HTML files, the `<image>` data-URIs embedded in public SVGs (such as
the `og-image` card) and the inline logo of the landings. Historically, a standard
"placeholder" logo could sneak back into the app, the landings or the
extension without anyone noticing: brand degradation was silent and
only caught in visual review.

`check:brand-logo` closes that gap with a single source: the canonical artwork
`public/icons/logo-512.png`. The gate fails if any brand PNG or SVG icon
inline deviates from that canonical file, so a placeholder cannot
come back without breaking CI.

The freeze inspector (O-1, `docs/ADR-028-gate-drift-detection.md`) requires that
every new gate be governed: either it is protected core, or it is registered in
`KNOWN_GATES` with an explicit category, or an ADR justifies it.
`check:brand-logo` is not a documentation-format inspector (it does not validate
`docs/`): it is a visual identity contract for the product, the same family
as `check:static-brand` (brand tokens in CSS/HTML). This decision records it
formally and documents what it validates and how to run it, with governance
parity with the rest of the repo's gates — in particular with `check:seo`
(`docs/ADR-043-check-seo-gate.md`), with which it shares the `meta` category
in the freeze and the adversarial-suite pattern.

## Decision

1. **Gate scope.** `node scripts/check-brand-logo-consistency.mjs`
   validates two surfaces:
   - **PNG icons** — every PNG icon referenced from the known brand
     surfaces (PWA manifest, extension manifests,
     `browserconfig`, `favicon`/`apple-touch` links in HTML and `<image>` data-URIs
     embedded in public SVGs such as the `og-image` card) is
     decoded and compared **pixel by pixel** against the canonical artwork
     (`public/icons/logo-512.png`) after resampling to 64×64. A missing, non-square,
     undecodable or visually different icon makes
     the gate fail. The similarity threshold (`THRESHOLD`) absorbs
     resampler differences between icon variants; a genuinely
     different brand measures ~4× above the threshold.
   - **Inline brand SVGs** — hand-drawn placeholder SVGs
     (viewBox `"0 0 128 128"`, the old trapezoidal path, the brand-tile
     rects) in HTML/TSX/JS/SVG sources make the gate fail: the brand
     must be the canonical PNG (`/logo-64.png`), never a rewritten approximation.
2. **Pure gate with no dependencies.** No `--fix`; Node core only —
   deliberately **not** dependent on `sharp`, so it runs even with a
   broken `node_modules` (like the chain's other gates).
3. **How to run it.** `node scripts/check-brand-logo-consistency.mjs`;
   it runs in the `npm run check` chain and in `check:ci`. Its adversarial suite
   (`scripts/__tests__/check-brand-logo-consistency.test.mjs`, `test:slow` profile)
   mutates every piece of the contract and requires the gate to detect it.
4. **Registration in the freeze.** `check:brand-logo` is registered in
   `KNOWN_GATES` of `scripts/check-inspector-freeze.mjs` as `meta` — the
   same category as `check:static-brand` and `check:seo`: it is not a
   documentation-format inspector, so O-1 does not require an ADR for it;
   this ADR documents the decision and its contract all the same.

## Consequences

- Every new brand surface (an icon, a manifest, an HTML file) must
  be added to the gate's scan list, or it can degrade without
  detection — the gate only watches what it knows.
- Changing the canonical artwork (`public/icons/logo-512.png`) or regenerating the
  derived icons requires updating the gate and its suite: resampling to
  64×64 is the comparison contract.
- Referenced PNGs must be square and decodable; a "standard" placeholder
  icon breaks CI before it reaches production.
- The gate is implemented and in the chain; this ADR records the decision and
  serves as the canonical reference for what it validates and how to run it, with governance
  parity with `docs/ADR-043-check-seo-gate.md`.