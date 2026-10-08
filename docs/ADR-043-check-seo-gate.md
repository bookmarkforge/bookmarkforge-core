# ADR-043: Record and documentation for the `check:seo` gate

- **Status:** accepted (implemented: `scripts/check-seo.mjs` is in the `npm run check` chain with its adversarial suite in `scripts/__tests__/check-seo.test.mjs`)
- **Date:** 2026-09-09

## Context

The site's indexable surface grew to 30 localized landings
(en/es/fr/de/pt/it plus 24 more locales), the comparison page `/pocket-alternative`, the SPA
shell and the 404 page — each one with its own canonical, hreflang, Open Graph, Twitter Cards
and JSON-LD, plus a noindex contract that keeps the private app out of
the index (`_headers`, `netlify.toml`, `robots.txt`, `offline.html` and
`sitemap.xml`). All of that SEO identity relied on convention without verification:
a broken canonical, an `og:image` without an asset or a `/app` leak in the sitemap
silently degrade ranking and index privacy, and they are only
discovered weeks later in Search Console.

The freeze inspector (O-1, `docs/ADR-028-gate-drift-detection.md`) requires that
every new gate be governed: either it is protected core, or it is registered in
`KNOWN_GATES` with an explicit category, or an ADR justifies it. `check:seo` is
not a documentation-format inspector (it does not validate `docs/`): it is a
contract for the product's static surface, the same family as
`check:static-brand` (brand tokens in CSS/HTML). This decision records it
formally and documents what it validates and how to run it, with governance
parity with the rest of the repo's gates.

## Decision

1. **Gate scope.** `node scripts/check-seo.mjs` validates:
   - **Landings** (`public/landing.html` + `es/fr/de/pt/it.html`): `<html
     lang>`, `<title>`, meta description, exact canonical, complete hreflang set
     (30 languages + `x-default` in the generated artifacts; the historical family
     of six landings remains covered by the primary contract), the 9 Open Graph meta tags (with `og:url` ==
     canonical and `og:image` pointing at an existing asset in `public/`),
     Twitter Cards and parseable JSON-LD with the `WebSite`,
     `Organization`, `SoftwareApplication` and `FAQPage` types (with real questions).
   - **Single page** (`public/pocket-alternative.html`): same contract without the
     hreflang requirement.
   - **Legal pages** (`public/privacy-and-terms.html` + the five localized
     copies at `/es|fr|de|pt|it/privacy-and-terms.html`): canonical,
     complete hreflang set for the legal cluster (30 languages + `x-default` in the
     generated artifacts), OG and Twitter, with no
     JSON-LD requirement (a legal document does not declare FAQPage).
   - **Auxiliary pages** (`index.html` and `public/404.html`): canonical +
     complete OG/Twitter set, and identity consistency with the EN landing
     (`og:site_name` and `og:image` identical).
   - **Noindex contracts**: `X-Robots-Tag: noindex` for `/app`, `/capture` and
     `/offline*` in `_headers` and `netlify.toml`; `Disallow` in `robots.txt`;
     noindex meta in `offline.html`; and that `sitemap.xml` does not list `/app` but
     does list the six landings, `/pocket-alternative` and the six legal pages,
     and annotates the complete set of `xhtml:link` hreflang alternates
     (30 languages + `x-default`) on each landing (x-default → `/`) and on each
     legal page (x-default → the EN one), with the `xmlns:xhtml` namespace
     declared — sitemap-level hreflang, mirroring the HTML `<head>` of
     each cluster.
   - SEO identity is derived from the real domain (`csp-config.js`), so
     a change to `BOOKMARKFORGE_DOMAIN` cannot desynchronize the
     contract without CI failing.
   - **Language negotiation**: the `/` root must redirect with 302 (never
     301 — negotiation must remain temporary to preserve the
     EN canonical) to the localized landing matching the primary language of
     `Accept-Language`, both in `public/nginx.conf` (Docker path) and in
     `functions/_middleware.js` (Cloudflare Pages) and `netlify.toml`
     (conditional `conditions = { Language = [...] }` rules with 302,
     listed before the 200 rewrite of `/`), with the same language map
     and the same primary-language semantics — Netlify ignores q-values
     and matches against the first language of the header, like the nginx regexes.
   - **Manual language preference** (so the redirect does not bother a
     user who has chosen): the `?lang=<code>` parameter (on the nav/footer
     language links of the landings) is the strongest signal — it
     sets a persistent cookie (`bf_lang`, read by nginx and the
     middleware; `nf_lang`, Netlify's native override for its
     Language conditions) and 302-redirects to the clean URL. Once set, the cookie
     **overrides** `Accept-Language` negotiation (including the
     `en` value: "the user already chose, do not re-negotiate") — in nginx the
     negotiation lives in the internal `/_negotiate` location, which is only
     reached when there is NO cookie; the middleware replicates the semantics; and
     `landing.js` sets both cookies when a language link is clicked or when
     loading with `?lang=`. The gate requires the contract in all three sources.
   - **Visible language links**: the nav/footer language links of the
     landings must carry `lang` and `hreflang` (with the same value),
     point at the correct landing with `?lang=<code>`, cover the 6
     languages and link each page's own version.
   - **Consistent legal terminology**: the 6 privacy-and-terms documents must keep
     the key legal terms per jurisdiction
     — correct GDPR acronym (RGPD in es/fr/pt, DSGVO in de, GDPR in
     en/it), ROPA, opt-in, the "data controller" term
     (Verantwortlicher/titolare/…) and the license's "entitlement state"
     phrase (which once came back as a literal translation of "rule of
     law": Estado de derecho / État du droit / Stato del diritto — the gate <!-- i18n-allow -->
     pins it in its unambiguous form).
2. **How to run it.** `npm run check:seo` (or `node scripts/check-seo.mjs`
   directly; it is a pure gate, with no `--fix` and no dependencies outside
   Node core). It runs in the `npm run check` chain and in `check:ci`. Its
   adversarial suite (`scripts/__tests__/check-seo.test.mjs`, `test:slow` profile)
   mutates every piece of the contract and requires the gate to detect it.
3. **Registration in the freeze.** `check:seo` is registered in `KNOWN_GATES` of
   `scripts/check-inspector-freeze.mjs` as `meta` — the same category as
   `check:static-brand` and `check:brand-logo`: it is not a documentation-format
   inspector, so O-1 does not require an ADR for it; this ADR documents the
   decision and its contract all the same.

## Consequences

- Every addition to the SEO surface (a new landing language, a new page,
  an `og:image` change) must update the gate at the same time: if a new page
  does not declare the complete hreflang set, or a landing is left out of the
  sitemap, CI fails with an actionable message.
- Adding a seventh language requires touching `LANDING_LANGS`/`LANDING_LOCALES` in
  `check-seo.mjs` and `LANDING_LANGS` in `scripts/nginx-render.mjs` (plus the
  server rules) — the gate flags what is missing. The sitemap entry is
  added by hand in `public/sitemap.xml` (a manual file since A9-1; the
  renderer only rewrites URL hosts, it never regenerates).
- The noindex contract is revocable in a verifiable way: removing a
  `Disallow` or an `X-Robots-Tag` without touching the gate breaks CI before the
  private app can appear in the index.
- The gate is implemented and in the chain; this ADR records the decision and
  serves as the canonical reference for what it validates and how to run it.

## hreflang graph verification (2026-09-09)

`scripts/check-hreflang-graph.mjs` validates over real HTTP the same
checks an external hreflang validator would, for the 60 current localized pages (30 landings + 30 legal): complete sets (30 languages +
`x-default`), absence of broken links, **bidirectionality** (if A
declares `es → /es/`, /es/ must declare `en → A`), self-reference,
`x-default` per cluster (landings → `/`, legal → the EN one) and no crossing
between clusters; it also crosses the HTML set with the sitemap's
`xhtml:link` for the 60 URLs. Verified adversarially: removing an alternate in
`dist/` triggers all three failure kinds and exit code 1.

```bash
npm run build
npm run preview -- --port 4173 --strictPort &
node scripts/check-hreflang-graph.mjs http://localhost:4173 --files  # local (resolves /fr/ → /fr.html)
```

Historical result from 2026-09-09: **12 pages, 84 alternates, bidirectional
graphs intact, exit 0.** Per-URL external validators cannot be used yet:
`bookmarkforgeapp.com` still serves the legacy deployment (the EN legal
page returns 404 — see the previous section). After deploying, repeat in live
mode against the public domain:

```bash
node scripts/check-hreflang-graph.mjs https://bookmarkforgeapp.com
```

## External sitemap verification (2026-09-09)

The sitemap was validated with two external validators (neither from the repo),
after a real finding that was fixed:

1. **sitemap.js** (the official npm sitemap library, installed in a
   temporary directory): `XMLToSitemapItemStream` with `ErrorLevel.WARN` —
   **61/61 valid `<url>` entries** (changefreq, priority, loc limits).
2. **libxml2** (the engine behind `xmllint`, via `libxmljs2` with precompiled
   binaries) against the **official sitemaps.org schema**:
   `processContents="lax"` in the `xs:any` wildcard (the 2008 `strict`
   variant predates Google's hreflang extension and rejects `xhtml:link` in
   any sitemap with hreflang — verified) — **well-formed and VALID**.

**Finding fixed**: the sitemap emitted `xhtml:link` between `<loc>` and
`<lastmod>`, but the 2008 schema validates the sequence in order
(`loc, lastmod?, changefreq?, priority?, xs:any`) and rejected `lastmod`.
The renderer was reordered to emit the alternates **at the end** of the
`<url>` block — an order compatible with the official schema and with Google/Bing
(which parse any order). The renderer, `check:seo`, the graph validator
and the tests remain green; the sitemap contract is
order-independent.

Per-URL web validators (e.g. xml-sitemaps.com, which only accepts
`sitemapurl`) cannot be used until deployment: production returns 404 at
`/sitemap.xml` (legacy site, see previous sections).

```bash
# Reproduce (outside the repo):
mkdir -p /tmp/smval && cd /tmp/smval && npm init -y && npm i sitemap libxmljs2
curl -sO https://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd
sed 's/processContents="strict"/processContents="lax"/' sitemap.xsd > sitemap-lax.xsd
node validate.mjs <path>/public/sitemap.xml sitemap-lax.xsd
```

## Verification with curl against production (2026-09-09)

Real check of negotiation on `https://bookmarkforgeapp.com/` (IP
`178.156.204.210`, no CDN in front):

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" -H "Accept-Language: fr-FR,fr;q=0.9,en;q=0.8" https://bookmarkforgeapp.com/
```

| Accept-Language (primary) | Expected (contract) | Observed |
| --- | --- | --- |
| `fr-FR,fr;q=0.9,en;q=0.8` | 302 → `/fr/` | 200 (no redirect) |
| `de-DE,de;q=0.9,en;q=0.8` | 302 → `/de/` | 200 (no redirect) |
| `it-IT,it;q=0.9,en;q=0.8` | 302 → `/it/` | 200 (no redirect) |
| `pt-PT,pt;q=0.9,en;q=0.8` | 302 → `/pt/` | 200 (no redirect) |
| `es-ES,es;q=0.9,en;q=0.8` | 302 → `/es/` | 200 (no redirect) |
| `en-US,en;q=0.9,fr;q=0.8` | 200 (EN) | 200 |
| no header | 200 (EN) | 200 |
| `ja;q=0.9` | 200 (EN) | 200 |
| `GET /fr/` (direct) | 200 | 404 |

**Conclusion: production does NOT serve the current build or `nginx.conf`.**
The page answering `/` is legacy — title *"Bookmark Forge - Links to
Bookmarks Converter"*, 47 329 bytes, versus the current `landing.html`'s
31 151 — and the 5 localized routes return 404. Language negotiation
(fr/de/it/pt/es → 302, EN → 200) is correct in the repo artifact
(`public/nginx.conf`, verified by `check:seo` and its adversarial suite),
but it awaits deployment: `scripts/deploy-prod.mjs --deploy
--verify` is the intended path. Until then, this table documents the
real state: the production contract is not met.
