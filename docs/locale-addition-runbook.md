# Runbook: add a locale to landings

End-to-end verification (2026-09-22) of the flow that the comment in
`scripts/landing-registry.mjs` describes as *"A new locale now means ONE edit
here (plus its page, translations and share card); every layer above follows,
and the gates fail if a layer's checked-in output lags"*.

Method: faithful sandbox clone of the worktree (tar of everything except `.git`, `node_modules`
and test artifacts) and simulated locale 31 (`sl`, Slovenian), with its page,
its two translation entries, its legal page and its manual taken from `sv` as
copy substitute to be able to execute the full chain. The chain was executed
until green, counting and attributing each mandatory edit. No repo file
was modified for this verification.

**Re-verified 2026-09-22, already committed the registry refactor**, and after
two changes that move the figures in this document:

1. `check-manual-figures.mjs` derives its manual list from the registry, so
   **the manual translation becomes a mandatory layer** (previously it was
   invisible: the literal list of 30 ignored the new locale).
2. `check-claim-drift.mjs` adds a coverage pin derived from the registry:
   no declared landing can remain outside its scan surface.
   That pin does NOT watch the page existence — that is from `check:page-figures`
   and `check:landings-fresh`.

The numbers in the following sections are from the re-verification.

## Verdict

The assertion "one edit in the registry" does not hold in the direction that
matters (adding a locale). Measured: **12 edits in 9 files, 2 new files
(copy and manual), 3 regenerations and 12 tests pinned in 9 test files**.
Half of those edits exist because there are layers that **do not** derive
from the registry, and there are gates that fail with messages pointing to the
wrong place.

What does hold: the routing/edge layer (nginx, middleware, page switcher,
`netlify.toml`, `_redirects`) either derives from the registry or is a
mechanical one-line edit, and **all** gaps are covered by some gate (no
half locale passes the chain silently), except the two blind spots in the
gaps section.

## Measured inventory

| # | File | Edit | What requires it |
|---|---|---|---|
| L1 | `scripts/landing-registry.mjs` | +1 row in `LANDING_LANGS` | the registry itself |
| L2 | `scripts/landing-registry.mjs` | +1 row in `LOCALE_REGION` | silent: without it the row comes out `sl_undefined` |
| L3 | `scripts/templates/landing/landing.njk` | +1 literal line of `<link rel="alternate" hreflang>` | `check:seo` (the `<head>` is a literal list of 31 lines; no loop) |
| L4 | the new locale translation (`scripts/translations/<locale>.json`) | new file (34 copy blocks) | the builder detects languages by translation files |
| L5 | `scripts/landing-translations.json` | +1 entry | `check:landing-free-plan` (secondary coverage) |
| L6 | `scripts/privacy-translations.json` | +1 entry | `check:seo` (legal coverage) + `check-sitemap-coverage` (legal page) |
| L7 | `scripts/check-landing-free-plan.mjs` | +1 row in `WEDGE_TABLE` | the gate does not know the language: `search="?"`, `smart="?"` |
| L8 | `public/landing.js` | +1 code in the literal array `LANG_CODES` | `check:seo` («LANG_CODES missing "sl"») |
| L9 | `public/sitemap.xml` | +1 alternate line in 60/61 blocks (62 edits) and +2 new blocks (76 lines) | `check:sitemap-coverage`. **No generator exists** |
| L10 | `public/_redirects` | +3 rules | `check:sitemap-coverage` |
| L11 | `netlify.toml` | +1 `Language` rule (5 lines) | `check:seo` |
| L12 | Regenerate | `npm run build:landings` (31 pages), `generate-privacy-pages` (26 pages), `nginx-render --write` | the gates compare with versioned |
| L13 | 9 test files | 12 tests pinned with the 30 world | deliberate tripwires (one says it literally) |
| L14 | `docs/<manual-endonym>-<locale>.md` (the `MANUAL_FILES` entry) | new file | `check:manual-figures` **now derives its list from the registry**: without the manual, it fails |

The tests that must be touched and why:

| File | Assertion |
|---|---|
| `scripts/__tests__/landing-registry.test.mjs` | 5 counts (30/29/30/31/32) |
| `scripts/__tests__/build-landings-sync.test.mjs` | explicit tripwire: *"expected the 30-locale derivation, found 31 — update this contract when the locale set changes"* |
| `scripts/__tests__/check-seo.test.mjs` | exact set of 30 languages in the `<head>` |
| `scripts/__tests__/check-landing-free-plan.test.mjs` | `WEDGE_TABLE` covers exactly 30 locales |
| `scripts/__tests__/check-landings-fresh.test.mjs` | contract of 31 generated pages |
| `scripts/__tests__/check-page-figures.test.mjs` | synthetic tree of 61 surfaces |
| `scripts/__tests__/check-sitemap-coverage.test.mjs` | list of expected failures with the synthetic sitemap |
| `scripts/__tests__/rollback.test.mjs` | 61 `<loc>` in the versioned sitemap |

## What each gate catches, by direction

The system has two sources that must match (registry rows and
translation files) but **neither commands the other**: the builder
detects languages by `scripts/translations/*.json`, and the routing gates
follow the registry. The two desynchronization directions fail differently.

| Direction | Registry | Translations | Verdict (measured in re-verification) |
|---|---|---|---|
| Registry only (L1 without L4) | 31 | 30 | **6 fail**: `check:seo`, `check:landing-free-plan`, `check:sitemap-coverage`, `check:page-figures`, `check:manual-figures` (new layer) and `nginx-render verify`. **4 blind**: `check:landings-fresh`, `check:claim-drift`, `check:license-claims` and `check:brand-logo` |
| Translation only (L4 without L1) | 30 | 31 | **2 fail**: `check:seo` — with the opaque message «must point to undefined (found /sl/?lang=sl)» — and `check:landing-free-plan`. **7 blind**: `check:sitemap-coverage`, `check:page-figures`, `check:landings-fresh`, `check:claim-drift`, `check:manual-figures`, `check:license-claims` and `nginx-render verify`. The page exists and is servable without sitemap, without nginx rewrite and without `Language` rule in Netlify |

Added after that re-verification: `check:landing-smoke` (ADR-062) opens
the 31 routes **from the registry** in Chromium and requires 200 with the `<html lang>` of its
locale. Therefore it is not blind in the first direction —a locale only in the
registry is served by the SPA fallback with `lang="en"` and the gate fails by
`lang`—, and it is in the second: an orphan page not in the
registry does not enter its route list. It raises the server with the same
routing contract (`public/_redirects`) as the edge.

Nuance measured in the second direction: `check:claim-drift` does not see
the *routing* inconsistency, but **does police the data** of that orphan page
(it discovers `public/*.html` by glob): injecting it with "5,000 bookmarks" reports
3 claims drifted and exits 1. What remains uncovered there is the routing, not the
content.

## Gaps found

### The sitemap is 100 % manual

No script writes `public/sitemap.xml` (only validators read it). Each
new locale requires inserting an alternate line in **all** existing
blocks plus two new blocks, and the cost grows quadratically: each
`<url>` carries the complete set of alternates (31 today, 32 with the new). Adding
the 32nd requires ≈63 modified blocks and ≈200 lines.

### `check-landings-fresh` does not consult the registry

It iterates the disk (`readdirSync(publicDir)`) and translation files. Therefore
it stays green in the **two** desynchronization directions: it does not see a
declared locale without page, nor an orphan page without declaration. It is the
gate whose job is "is the versioned output in sync with its sources?" and never
compares with the routing source of truth. Additionally its orphan detection
only covers `landing.html`, the five primaries and `pocket-alternative*`
(`GENERATED_NAME_RE`), so an orphan `public/sv.html` is also not detected.

### `WEDGE_TABLE` fails blaming the copy

`check-landing-free-plan` maintains its own vocabulary per language (30 rows).
With a language not in the table, the gate fails (correctly: fails closed) but
reports it as a copy problem and ends with *"Fix the COPY (preferred)"*,
when the real fix is a row in its table. The table has no completeness
gate against the registry (unlike the registry consumers).

### Duplicate and silent OG region

`LOCALE_REGION` (registry) and `ogLocale` (translation file) declare the
same thing separately. Omitting the registry row does not fail: the row comes
out `sl_undefined` and nobody validates it against `ogLocale`.

### Two worlds of 30 without a gate to unite them

`src/constants/locales.ts` (`SUPPORTED_LANGUAGES`, with its bucket-routing,
`CRITICAL_LOCALE_CODES` and `SMALL_FALLBACK_LOCALES`) has today exactly the
same 30 codes as the landing registry, but they are independent lists.
Adding locale 31 to landings leaves the app UI at 30: the landing
offers a language whose preference cookie the app does not recognize, and **no gate
detects it** (the i18n gates and the middleware test pass with 31 landing
locales and 30 app locales).

### Obsolete assertion in the registry

The registry comment says that the browser preference logic
(`public/landing.js`) derives from the registry "via the generated artifact". It is not
exact: `landing.js` is a manually maintained file with a literal array of 30
codes. What saves it is that `check:seo` pins it against the registry.

### The third literal list of manuals

`check-license-claims.mjs` maintains its own manual language list (29 +
the master = 30), literal like the one `check-manual-figures` had before
deriving it. Measured: with the registry at 31 and a new manual present, that gate
still validates 30 manuals and exits 0 — it does not require the new locale's manual.
It is the same class that was closed in `check-manual-figures`, and is closed the same
way (one line: `LANDING_CODES` filtered from the master).

## How to reproduce

1. Faithful clone: `tar -cf - --exclude=.git --exclude=node_modules . | (cd <sandbox> && tar -xf -)`.
2. Baseline: the gates in the inventory section at exit 0.
3. Apply L1 without L4 and run the battery (direction "registry only").
4. Apply L4 without L1, run `npm run build:landings` and the battery (direction "translation only").
5. Apply L1-L8 + L14 (copying the copy and manual from the model language), run `build:landings`, `generate-privacy-pages` and `nginx-render --write`, and see what remains: only the trio without generator (L9-L11).
6. Apply L9-L11 counting the edits, and check the battery in green.
7. Run the `scripts/__tests__` suites in the 31-locale clone: 12 tests pinned with the 30 world distributed in 9 files, and none in the tests derived from the registry (manuals and coverage pin survive the new locale).

## Recommendation

Derive (or generate) the lists that today are copied by hand in three different
languages: the alternates of the template's `<head>`, `WEDGE_TABLE`,
`LANDING_CODES` of `landing.js`, the manual list of `check-license-claims`
and —above all— `public/sitemap.xml`, `_redirects` and `netlify.toml`, whose cost
per locale is quadratic. A completeness gate that requires a row in
`WEDGE_TABLE`/`LOCALE_REGION` for each registry locale, and a gate that
compares the landing world with `SUPPORTED_LANGUAGES` (or documents that they
must diverge), would close the rest.
