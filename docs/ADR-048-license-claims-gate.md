# ADR-048: `check:license-claims` license gate

- **Status:** accepted (implemented: `scripts/check-license-claims.mjs` is in the `npm run check` chain with its suite in `scripts/__tests__/check-license-claims.test.mjs` and its own step in `ci.yml`)
- **Date:** 2026-09-16

## Context

BookmarkForge is MIT: the root `LICENSE`, `package.json`, the
Open Core model (`OPEN-CORE.md`) and the exported public repo's `LICENSE`
all say so. Even so, a wave of localized documentation ended up publishing **AGPL-3.0** in
thirty translated user manuals, their PDFs, the Pocket landing's comparison table, the commercial licenses
line of the legal terms and the license metadata of the OpenAPI spec. It is the same kind of drift that
`check:claim-drift` (ADR-047) hunts, but over legal claims: a license
cited in marketing is not a dependency fact, it is a promise to the
user, and no visible surface may name a license the project does not apply.

The concrete failure this gate prevents: **license drift in the corpus
visible to the user** — any mention of AGPL/GPL/LGPL/Apache/MPL/EUPL/
EPL/CC-BY or another third-party license in manuals, landings, legal pages or
API metadata, or a broken MIT contract in `package.json`, `LICENSE` or
OpenAPI. Without a gate, that drift is only caught in manual review (where it failed
for weeks here: the public overlay was already fixed and the private
sources were not).

It is "detectable by drift detection" in ADR-028's sense because the
gate is deterministic and bidirectional: (1) negative token-based
denylist scan — injecting any third-party license token into the corpus makes
CI fail (verified in drill: restoring `AGPL-3.0-or-later` in a manual
breaks the gate with exit 1); (2) positive claims — the root MIT contract
(`package.json` = `"MIT"`, `LICENSE` = MIT text, OpenAPI = MIT, every manual
with a license header = MIT) must still hold. The adversarial suite
(`scripts/__tests__/check-license-claims.test.mjs`, 12 cases; the bounded
runner excludes the `scripts/__tests__/` collection and runs in CI's `slow-tests` job)
mutates each direction in temporary fixtures and requires the gate to
detect it.

## Decision

1. **Corpus scope.** Exactly the surfaces where a license is
   a claim: the 30 user manuals (`.md`, `-styled.html`, `.pdf`)
   in `docs/`, the two pairs of the public overlay
   (`scripts/public-export/manual-usuario*.md/.pdf`), the `pocket-alternative`
   landing (HTML + translation source), the `privacy-and-terms` legal
   page (HTML + translation source), `docs/openapi.yaml`,
   `package.json` and the **self** entry of `package-lock.json`. All of it
   included in the public export, so the exported repo runs the
   identical gate in its CI.
2. **Dependency licenses out of scope.** The license entries
   of the real dependencies in `package-lock.json` are facts, not
   claims — many are legitimately Apache/BSD/other. The gate parses
   the JSON and validates only `packages[""].license`, and does not scan the rest of the
   lockfile. The same excludes `node_modules` by construction.
3. **Denylist, not allowlist.** An allowlist of MIT wordings
   would break legitimate phrasing ("dual licensed", NOTICE references)
   and would hide exactly the drift the gate exists to
   catch. The denied tokens cover AGPL (and any
   "Affero" variant), LGPL, GPLv2/v3, Apache-2.0, MPL-2.0, EUPL, EPL-2.0, BSD
   2/3-Clause, CC-BY and "proprietary license". If a genuine false positive
   appears, the pattern is narrowed in the gate — it is never bypassed.
4. **PDFs via targeted extraction.** PDFs carry no plain text: the
   extractor reconstructs printable ASCII runs and filters by license vocabulary,
   robust to the text-operator fragmentation of the
   generator (pdfkit). Regenerating the 30 PDFs is
   `npm run docs:pdf:localized`; the gate validates the artifact, not the process.
5. **Registration in the freeze (O-1).** `check:license-claims` is registered in
   `KNOWN_GATES` as `docs` — the same category as `check:claim-drift`:
   it validates the truth of claims visible to the user (legal here,
   numeric there) and is not a Markdown-format inspector. This ADR
   is the justification the freeze requires; the registry keeps `KNOWN_GATES`
   ordered.
6. **Wiring.** `check:license-claims` in `package.json`, inside the
   `npm run check` chain (after `check:pocket-onboarding-copy`,
   grouped with the user-visible content gates), and an **own step** in
   `ci.yml` ("Enforce MIT license claims") so license drift
   shows up as a separate red check, not buried in the aggregator — the same
   pattern as `check:brand-logo` and `check:claim-drift`.

## Consequences

- Any reintroduction of AGPL or another third-party license into manuals,
  PDFs, landings, legal pages or API metadata breaks CI with a message
  naming the file and the pattern.
- The root MIT contract is anchored: changing `package.json` away from `MIT`,
  swapping the `LICENSE` text or removing MIT from OpenAPI breaks the gate
  even if no document mentions it.
- Maintenance: a new third-party license that a third party might cite
  is added as a denylist token (one line). A false positive is narrowed
  as a pattern (one line). The corpus inventory is centralized in
  `corpusEntries()`.
