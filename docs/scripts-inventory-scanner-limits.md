# Scripts inventory entry: scanner limits

- **Status:** active; operational documentation of the `check:audit-script-snapshot` gate.
- **Owner:** project maintainer.
- **Last review:** 2026-09-24 (the gate was declared in `package.json` and registered
  in the inspector freeze as on-demand; see `CONTRIBUTING.md`).

## Purpose

The gate `check:audit-script-snapshot` (and its snapshot `.tmp-audit-script-candidates.txt`)
maintains a list of **candidates without known references** in `scripts/`. This
list is the result of a static scanner that traverses the repository searching
for references to files in `scripts/`.

This document enumerates what **the scanner cannot see**, so that cleanup
reviewers know that the candidate list is a **lower bound**, not an
exhaustive inventory of what is alive.

## What the scanner detects

The scanner searches, statically:

- Imports `import ... from "scripts/..."` and `require("scripts/...")`.
- Path references in JS/CSS/HTML/JSON/YAML/TOML files in the repo.
- References in `package.json` → `scripts.*`.
- References in `.github/workflows/*.yml` (only `ci.yml` and workflows the
  scanner explicitly configures).
- References in project configuration files (docker-compose, Dockerfile,
  netlify, nginx, etc.) when appearing as literal strings.

## What the scanner does NOT detect (lower bound)

### 1. Paths built at runtime (runtime data-driven joins)

The scanner does not execute code. If a script builds the path to another script at
runtime, the scanner does not see the dependency.

Documented example: `scripts/build-ci.mjs` does:

```js
const rollupWasmLoader = join(ROOT, "scripts", "rollup-wasm-loader.cjs");
const useRollupWasm = process.platform === "win32" && process.arch === "arm64";
const nodeOptions = [process.env.NODE_OPTIONS, useRollupWasm
  ? `--require=${rollupWasmLoader}` : ""].filter(Boolean).join(" ");
```

The static scanner does not see that `build-ci.mjs` requires `rollup-wasm-loader.cjs`
only in `win32 && arm64`. On the current machine (win32/arm64) the loader is
active; on other platforms it is not. Therefore the candidate list may mark
`rollup-wasm-loader.cjs` as "without known references" even though
it has real conditional use.

**Implication:** a file marked as candidate may have a conditional reference
dependent on platform, environment, environment variable or runtime state.
Before deleting any candidate, review if there is conditional use in scripts
that could load it.

### 2. References in configuration files the scanner does not traverse

The scanner traverses only files it explicitly configures. If an external
configuration file (e.g. a Makefile, external deployment script, operations
runbook, external CI script, git hook) references a script in `scripts/`,
the scanner does not see it.

**Implication:** before deleting a candidate, also review `docs/`, `AGENTS.md`,
`README.md`, `.github/`, `docker-compose*.yml`, `Dockerfile`, `netlify.toml`,
`public/nginx.conf`, `functions/`, and any other deployment or operations
configuration file that could invoke the script.

### 3. Script names built from configuration

If a script uses another script's name built from a configuration variable
(e.g. `join(ROOT, "scripts", config.scriptName)`), the scanner does not see the
dependency because the name is not a literal in the code.

**Implication:** scripts that read other scripts' names from config,
environment variables, or runtime data are not detected.

### 4. Scripts invoked by name in shells, runbooks, or operational documentation

The scanner does not execute or analyze historical shells, operations runbooks, or
documentation that describes commands to deploy, revert, or diagnose. If an
operator or a runbook executes `node scripts/shutdown.mjs` as part of a
procedure, the scanner does not register it as a reference.

**Implication:** also review `docs/operations.md`, `docs/staging-smoke.md`,
`docs/launch-checklist.md`, `docs/ops-nightly.md`, and any operations runbook
before deleting a candidate that could be invoked by name in deployment or
recovery procedures.

### 5. Scripts that are "candidates" but have conditional platform references

The scanner does not distinguish between "never referenced" and "referenced only
on certain platform". A script like `rollup-wasm-loader.cjs` may appear in the
candidate list even though it has real use in `win32/arm64`.

**Implication:** the candidate list is a lower bound. A candidate not deleted
does not prove it is dead; it only proves that the static scanner did not see
it referenced. The deletion decision requires manual review of the conditional
cases described above.

## Decision rules for cleanup

1. **The candidate list is a lower bound, not a deletion list.**
   Each candidate requires manual review before deletion.
2. **Review conditional platform references** in `scripts/build-ci.mjs` and
   other scripts that build paths or names at runtime.
3. **Review configuration and operations files** that could invoke the script
   by name (docker-compose, workflows, runbooks, documentation).
4. **Review if the script is loaded dynamically** from another script (e.g.,
   `await import(...)` with built name, or `require(...)` with variable).
5. **Review if the script is a duplicate** of functionality that already exists
   in another file (e.g. `shutdown.mjs` vs the inline copy in
   `monitoring-alerts.mjs`).
6. **Document the deletion decision** in the diff, with the reviewed evidence,
   before committing.

## Relationship with the audit gate

The gate `check:audit-script-snapshot` executes the scanner and compares the result
with `.tmp-audit-script-candidates.txt`. If the snapshot drifts (by deletion of
a referenced script, or by addition of a new script without references), the gate
fails. This ensures that the candidate list stays synchronized with the
repository reality, but **does not replace manual review** of the limits
described in this document.

The snapshot must be regenerated with
`node scripts/__tests__/audit-script-inventory.test.mjs --update` after any
change in the structure of `scripts/` that affects references, and the result must
be manually reviewed before committing:

```bash
node scripts/__tests__/audit-script-inventory.test.mjs --update
node scripts/__tests__/check-audit-script-snapshot.mjs   # verifies the contract
```

Without `--update` the script only verifies the contract against the existing
snapshot.

## See also

- `docs/legacy-compatibility-plan.md` — compatibility retirement policy.
- `scripts/__tests__/audit-script-inventory.test.mjs` — scanner implementation and
  snapshot contract.
- `.tmp-audit-script-candidates.txt` — current snapshot of candidates without known
  references.
- `scripts/check-audit-drift.mjs` — scripts inventory drift gate.
