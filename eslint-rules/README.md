# eslint-rules — BookmarkForge custom rules

The project's own ESLint rules (plugin `bmf` in `eslint.config.js`). Each rule
is self-documented in its JSDoc header; this README is the index. Each rule
has its unit suite next to it (`*.test.mjs`, RuleTester/Vitest).

## Rules

### `bmf/no-silent-catch`
**Scope:** non-test code (`src/**`, `scripts/**`, `server/src/**`, `extension/**`).
An empty `catch` (no statements, only comments) must declare that intent
explicitly with `catch { /* INTENTIONAL SILENCE: <precise reason> */ }`.
A structural rule protecting the `AGENTS.md` §4 convention: errors are never
swallowed silently. It excludes test trees, where catch-and-fail is idiomatic.
→ `no-silent-catch.mjs`

### `bmf/no-unbounded-text`
**Scope:** `src/**/*.tsx`.
Flags JSX elements that render dynamic text inside a "fitted" container without
a defensive marker (`truncate`, `line-clamp-N`, `max-w-*`). Prevents text
overflow in the UI. The associated E2E gate is `check:no-unbounded-text`
(baseline in `scripts/no-unbounded-text-baseline.json`).
→ `no-unbounded-text.mjs`

### `bmf/no-unbounded-card-header`
**Scope:** `src/**/*.tsx`.
Companion to `no-unbounded-text` with a deliberately narrower scope: only
`<h1>`–`<h4>` inside `<div>` card wrappers. It is the pilot that runs before the
base rule is widened.
→ `no-unbounded-card-header.mjs`

### `bmf/no-securityvault-mock-without-lock`
**Scope:** `src/tests/**`.
A `vi.mock("../../services/SecurityVault", …)` that does not provide `onLock`
and `onUnlock` in the returned object breaks at import time with
`TypeError: X.onLock is not a function` (ProviderManager, TTSService,
SemanticCacheService, VaultIntegration, AgentService and TaggingService register
lock callbacks at construction). The rule requires lock/unlock lifecycle
symmetry in any vault mock (`AGENTS.md` §7).
→ `require-securityvault-mock-lock-unlock.mjs`

### `bmf/no-unexplained-test-skip`
**Scope:** `tests/e2e/**`.
`test.skip()` / `test.fixme()` / `test.todo()` must carry an explicit reason,
so a silenced test cannot be committed and forgotten.
→ `no-unexplained-test-skip.mjs`

### `bmf/no-unbounded-loop`
**Scope:** `src/services/**`, `src/workers/**`, `src/utils/**`, `src/tests/**`.
Flags `for(;;)` / `while(true)` loops without a guaranteed termination
mechanism. Motivation: a loop with no exit once shipped in
`GarbageCollectionService.pruneVersions()`.
→ `no-unbounded-loop.mjs`

### `bmf/require-adr-template`
**Scope:** `docs/ADR-*.md`.
Requires every new ADR to carry the five sections of the repo template, that
the `Status`/`Date` metadata carry a value, and that the first heading be
`# ADR-###: <title>` with the number matching the filename.

**Bilingual labels.** Each section accepts its Spanish label **or** its English
equivalent:

| Canonical (diagnostics) | Accepted spellings |
|---|---|
| `Estado` | `Estado`, `Status` |
| `Fecha` | `Fecha`, `Date` |
| `Contexto` | `Contexto`, `Context` |
| `Decisión` | `Decisión`, `Decision` |
| `Consecuencias` | `Consecuencias`, `Consequences` |

Matching is accent-insensitive on **both** sides — the accepted spellings and
the scanned line — so `## Decisión` and `## Decision` resolve to the same
section. A file may mix both languages across sections. The canonical Spanish
labels stay the ones named in diagnostics so failure messages remain stable.
Rationale: the repository is being translated to English, and the template must
keep enforcing the same five sections in either language rather than letting
English ADRs escape the guard.

Both forms are accepted: `**Estado:** aceptado` / `- **Status:** accepted`
(bold list item — also `**Estado** : value` and `**Estado: value**`) or a
heading from `## Contexto` up to `###### Context` (the section must not be
empty below the heading).

ESLint ships no Markdown parser: the rule runs on a trivial line-based parser
(`lib/markdown-parser.mjs`) plugged in as `languageOptions.parser` in the
`docs/ADR-*.md` block of `eslint.config.js`. The rule self-gates on the
filename, so the rest of the repo's Markdown is out of scope. The corpus
verifies clean — any new ADR missing the template breaks `npm run lint`.
→ `require-adr-template.mjs`

## Wiring in `eslint.config.js`

- The plugin is registered as `bmf` in the file blocks
  `src/**`, `tests/e2e/**`, `scripts/**`, `server/src/**`, `extension/**`.
- Each rule is enabled with its own scope (see the table above). Exclusions go
  in `ignores`, never as `!`-prefixed globs in `files` (see the note inside
  `eslint.config.js` about minimatch negation).

## Tests

Each rule has its suite in the same directory (`npm run test:fast` runs them
along with the rest). To add a new rule:

1. Create `eslint-rules/<rule>.mjs` with a self-documenting JSDoc header.
2. Create `eslint-rules/<rule>.test.mjs` with RuleTester covering valid and
   invalid cases, including the angle that motivated the rule.
3. Register it in `eslint.config.js` (plugin + activation block with scope).
4. If the rule needs a baseline (like `no-unbounded-text`), add the matching
   `check:*` script to `package.json` and its baseline in `scripts/`.