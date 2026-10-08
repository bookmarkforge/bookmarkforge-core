# ADR-049: `check:manual-figures` figures gate

- **Status:** accepted (implemented: `scripts/check-manual-figures.mjs` is in the `npm run check` chain with its suite in `scripts/__tests__/check-manual-figures.test.mjs` and its own step in `ci.yml`)
- **Date:** 2026-09-16

## Context

After fixing the license drift (ADR-048), an audit of figures across
the 30 translated manuals confirmed the manuals were clean — but it
uncovered that the **same class of drift** existed in the pricing sources:
`scripts/privacy-translations.json` and `docs/pricing-decision.md` advertised
Free with "1 device" while the code (`src/constants/pricing.ts`) explicitly
says "Works on any device — each keeps its own vault". The finding
followed ADR-048's pattern: parallel sources that fall behind the code
without anyone noticing until a reader suffers for it.

The manuals are the surface with the highest figure-per-word density in the project:
prices ($0/$59/$79/$89/$35/$99/$39), limits (1,000 Free bookmarks,
devices, 200 early birds), deadlines (30-day refund,
license revalidation every 48 hours) and policy (24-word recovery
phrase, 12-character minimum password). Today no barrier prevents
a manual edit — or a new translation — from introducing a figure the
code no longer honors.

It is "detectable by drift detection" in ADR-028's sense: the gate is
deterministic and bidirectional. (1) **Truth parsed from the code**: the gate
extracts the canonical values from `src/constants/pricing.ts`,
`src/constants/license.ts` (`cacheTtlMs`), `src/constants/config.ts`
(`MIN_PASSWORD_LENGTH`) and `src/services/RecoveryService.ts` (`wordCount`),
without duplicating them; if a constant is renamed, the gate fails closed instead
of guessing. (2) **Directional rules**: every manual line asserting
a price, a device limit, a bookmark cap, a refund deadline,
a revalidation window, a recovery word count
or a discount percentage must match the code. Injecting "$69" or
"up to 5 devices" into a manual breaks CI (verified in drill). The adversarial suite
(`scripts/__tests__/check-manual-figures.test.mjs`, 14 cases; the
bounded runner excludes the `scripts/__tests__/` collection and runs in CI's
`slow-tests` job) mutates truth and manuals in temporary fixtures and
requires the gate to detect each direction.

## Decision

1. **Scope.** The 30 `docs/manual-usuario*.md` — the source from which the
   PDFs and the `-styled.html` are generated (`npm run docs:pdf:localized`), and the
   complete set that travels in the public export. Validating the Markdown
   validates the whole family; the generated artifacts are covered when
   regenerated from these sources.
2. **No duplicating truth.** The canonical values are parsed from the code on
   each run. Changing a price in `pricing.ts` without updating the
   manuals breaks the gate immediately — and moving the price *does* require
   touching the code first, which is where truth lives.
3. **Contextual rules, not global ones.** A number in a manual is not
   automatically a claim: numbered steps, product versions
   (v2/v3), the P2P token, years and percentages without discount context are
   noise and are discarded. Each rule requires its noun and its context in the
   30 languages ("up to 3", "最大3台", "bis zu drei"), with per-language
   "no limit" markers (including compound negations like "nu are
   limită de dispozitive", which only exist in the raw line). The v3 owner
   price ($39) is derived from the discount (`floor(99 × 0.4)`), without
   introducing a third source of truth.
4. **Directional, not inventory-based.** The gate validates what the manuals
   *say*; whether a figure is present at all is `check:claim-drift`'s job
   over the app's surfaces. Missing prices in condensed manuals
   is not an error.
5. **Registration in the freeze (O-1).** `check:manual-figures` is registered in
   `KNOWN_GATES` as `docs` — the same category as `check:claim-drift` and
   `check:license-claims`: it validates the truth of claims visible to the
   user. This ADR is the justification the freeze requires.
6. **Wiring.** `check:manual-figures` in `package.json`, in the
   `npm run check` chain (grouped with the user-visible content gates, behind
   `check:license-claims`), and an **own step** in `ci.yml` ("Enforce manual
   figure claims") so that figure drift shows up as a separate red check —
   the same pattern as `check:license-claims` and `check:claim-drift`.
   The gate only reads sources included in the public export, so the
   exported repo runs the identical gate in its CI.

## Consequences

- Any figure that diverges from the code in any language breaks CI with a
  message naming file, line and the expected canonical value.
- Changing a price/limit/deadline constant in the code requires updating
  the 30 manuals in the same PR — exactly the coordination that failed twice
  ("1 device", AGPL).
- Maintenance: a new language in the manuals adds its noun and its
  markers to the context regexes (one line per regex). A false positive
  is narrowed as a pattern — the gate is never bypassed.
