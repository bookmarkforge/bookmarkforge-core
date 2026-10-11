# ADR-064 — Audit ledger freshness gate

- **Estado:** accepted
- **Fecha:** 2026-09-23
- **Deciders:** BookmarkForge team

## Contexto

the private `audit.md` publishes a "Verified status" table with the form command → observable, and its foundational rule is that each assertion carries the command that backs it. But nothing re-executed that table: its assertions aged in green. In the 2026-09-23 re-verification the document still said **exit 2 · 3 errors** for `npm run typecheck` while the tree produced 69 error lines in 3 loci, and **"~97 gates `check:*`"** when the chain executes 50 gates (the 99 are *declared* scripts, not executed). That is the drift model of ADR-028 applied to a document: the ledger does not break, it becomes obsolete.

The neighboring gate `check:audit-drift` (ADR-047 and anchors) watches the opposite: that the **code** does not drift away from the ledger anchors. The other direction was missing — that the **ledger** does not drift away from the tree.

## Decisión

`check:audit-freshness` is added to the `npm run check` chain. The gate parses the status table and verifies each row according to the `Mode` column, which becomes mandatory:

| Mode | Verification |
|---|---|
| `chain` | the command is a gate of the `npm run check` chain; the gate checks it remains in it (execution is the chain's) |
| `exec` | executed and compare the documented exit code and each fragment between backticks against real output |
| `deep` | like `exec`, only under `--deep` (heavy for every `npm run check`) |
| `network` | like `exec`, only under `--allow-network` (`npm audit` talks to the registry) |
| `self` | the command contains the gate itself or is the suite that runs its test: its number is **derived** from the tree (chain size, fast profile files) because re-executing it would be recursive |

**Fail-closed invariants** (never omitted): table absent or empty; row without `Mode` or with unknown mode; command that is not `npm run <script>`, `npm audit [flags]` nor `node scripts/<file>.mjs`; script that does not exist in `package.json`; `chain` row naming a script outside the chain; `self` row without registered derivation or whose published number is not exactly the derived one; `npm audit` outside `network` mode; an output claim written as inequality (`exit ≠ 0`); and any documented exit code that does not match the real one.

The output claim is always a **pinned** code (`exit N`). An inequality is rejected instead of being read as the implicit `0`: accepting it as a valid form would turn a red row green without checking anything, which is exactly the failure mode this gate exists to end. On 2026-09-23 `npm run typecheck` was the only red row, with an unstable code (1/2/1 with identical output due to tsc's `incremental` race) and its errors in a WIP locus that grew and shrank daily; for that row there existed a per-command locus rule and an `exit ≠ 0` form. Both were removed when the tree turned green: they were a special case hardcoded to a command name no row used, and keeping them would have left in the gate a verification path nothing exercises. If the tree becomes red in a sustained way again, the author restores the rule together with its row — freshness is paid with an edit, also in the gate itself.

## Relationship with gate governance

Registered in `check-inspector-freeze` with category `docs`: a documentary format gate needs an ADR that names it, and this one does. The ADR travels in the public export (`PUBLIC_DOCS`), because the private `audit.md` is **not** published: in the exported tree the gate declares "not shipped" instead of failing, since the export re-curs `docs/` and only inherits the chain as is. In the private tree, an absent ledger does fail (distinguished by the presence of `docs/docs-state-index.md`, a private document).

The fast profile file count — the number the table publishes for `npm run test:fast` — now has a single owner: `scripts/test-files.mjs`, extracted from `scripts/test-bounded.mjs` so the runner and the gate do not maintain two separate traversals of the same tree.

## Consecuencias

- Adding a row to the table is no longer decorative: without verifiable `Mode`, the chain fails.
- Heavy and network commands run in CI in the step named `npm run check:audit-freshness:deep` (`--deep --allow-network`); the local chain keeps the cheap ones.
- A tree that gets fixed (WIPs disappear and typecheck turns green) makes the gate fail and forces updating the document: freshness is paid with an edit, not with an annual read. It happened the same day: when `npm run typecheck` turned green, the row was rewritten to `exit 0` and with it the locus rule and `exit ≠ 0` form were removed, remaining without user.
- The "Live surface" table (`grep`/`ls` with numbers in observable) remains outside the gate: verifying it requires declaring mode per row as here. It is the next natural segment.
