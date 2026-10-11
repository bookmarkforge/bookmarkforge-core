# ADR-044: Per-page Open Graph card policy (`OG_IMAGE_POLICY`)

- **Status:** accepted (implemented in `scripts/check-seo.mjs`, with adversarial suite in `scripts/__tests__/check-seo.test.mjs`)
- **Date:** 2026-09-09

## Context

The site has two social share cards in `public/`, twins in
style (brand navy background, real embedded logo, 1200×630):

- `og-image.png` — the general product card ("Your Local-First Digital
  Brain").
- `og-image-pricing.png` — the pricing card ("Simple, Fair Pricing" /
  "Free forever · Pro $79 one-time — no subscriptions") with the two tier
  cards side by side — Free $0/month and Pro $79 once, each with its
  highlights — copy verified against the `#pricing` section of the landing.

When the pricing card was created, it was undecided which page should use it.
`og:image` is a per-URL tag: crawlers ignore `#anchors`, so
"sharing the pricing section" does not exist — the
`/#pricing` fragment shares the whole landing and its general card. The assignment
is made at page level and depends on what each page's body sells. Without a
written rule, every new page would return to the ambiguity that motivated
the brand passes: asset mixes nobody notices.

The `check:seo` gate (ADR-043) already validated that `og:image` existed and that the
asset was in `public/`, plus requiring identity consistent with the
EN landing on auxiliary pages; it did not decide *which* card corresponds to
each page.

## Decision

1. **Default card.** Every page uses `og-image.png` (the general product
   card) except those listed in `OG_IMAGE_POLICY`.
2. **Exception: pricing-oriented pages.** `/pocket-alternative` uses
   `og-image-pricing.png`: its whole body is the Pocket migration
   pitch built around the free tier and the single $79 Pro (its comparison table
   and its JSON-LD `Offer` declare exactly those prices), so its share
   card sells prices, not the product summary.
3. **Auxiliary pages untouched.** The SPA shell (`index.html`) and `404.html`
   keep inheriting identity from the EN landing (brand consistency), i.e.
   the general card; the policy adds no exceptions for them.
4. **Copy synchrony in the brand gate.** The
   `check:brand-logo` gate extends its guard 3 to the cards' copy: the
   texts of `og-image-pricing.svg` (tier names, prices, highlights)
   must be backed by the live `#pricing` section of the EN landing
   (token-based rule — a highlight may condense several bullets, but
   no meaningful word may be left orphaned), and the texts of
   `og-image.svg` must be the brand copy registered in the gate itself
   (`BRAND_NAME` / `BRAND_SLOGAN` — the slogan "Your Local-First Digital
   Brain" lives only in the cards, so the gate is its single source).
   Changing the landing price without regenerating the card — or the slogan without
   updating the gate — breaks CI naming the orphaned words.
5. **Enforcement in the gate.** `validateLandingHtml` now requires the exact
   `og:image` value that `ogImageForFile(file)` assigns to the page
   (with `cfg.ogImage` as an optional override for the auxiliary pages, which
   keep their consistency against the EN landing). A `twitter:image` that does not
   match `og:image` already failed and still fails, so both networks
   necessarily share the card. The policy lives next to the
   page inventories (`LANDING_PAGES`, `SINGLE_PAGES`, `LEGAL_PAGES`)
   and their adversarial tests cover: an entry that does not correspond to a real
   page, a wrong card detected, and the repo's real pages
   aligned with the policy.

## Consequences

- Adding a new page forces it to declare (or inherit by default) its
  card; using the pricing one on a page with no pricing pitch — or the
  general one on a future dedicated pricing page — breaks CI with an
  actionable message (`og:image must be … per OG_IMAGE_POLICY`).
- If a dedicated `/pricing` page ever exists, adding it to
  `OG_IMAGE_POLICY` pointing at `og-image-pricing.png` is one line in the
  gate and one on the page; the documentation and verification already exist.
- The two cards remain twins in style and verified by
  `check:brand-logo` (embedded logo against `logo-512.png`), so
  whatever card a page shares keeps the brand.
- **Localized cards (og-image-<lang>.png).** The five local landings
  (es, fr, de, pt, it) now use their own card (`og-image-es.png`,
  `og-image-fr.png`, `og-image-de.png`, `og-image-pt.png`, `og-image-it.png`)
  with the same style, same embedded logo and same brand name, but with
  the slogan translated into that landing's language (`Tu cerebro digital local y
  privado` / `Ton cerveau numérique local et privé` / `Dein lokaler und
  privater digitaler Geist` / `Seu cérebro digital local e privado` / `Il
  tuo cervello digitale locale e privato`). The policy includes them in
  `OG_IMAGE_POLICY` and the `check:seo` gate requires the exact per-page value.
  The `check:brand-logo` gate (Guard 1) verifies that the embedded logo of
  each matches the canonical artwork, and Guard 3 verifies that the translated
  slogan appears (token by token) in that same landing's `og:description`,
  so a localized copy change that orphans the
  card's slogan breaks CI naming the orphaned words.
  The PNG cards are generated from the same base SVG
  (`public/og-image.svg`) with the localized slogan; the process is documented
  in `scripts/og-image-locale-gen.mjs` (a single sharp function + the logo
  data-URI from the base SVG).
