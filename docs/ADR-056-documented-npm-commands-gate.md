# ADR-056: Documented npm commands gate

- **Status:** accepted (implemented in `scripts/check-documented-npm-commands.mjs`)
- **Date:** 2026-09-18

## Context

Runbooks and checklists are an operational interface: an `npm run` command that
does not exist in `package.json` is not a harmless typo, it is a broken release
procedure. The audit found two historical smoke names, `smoke:launch`
and `smoke:launch:dev`, which did not match the real `launch:smoke` and
`launch:smoke:prod` scripts.

Script tests contain fixtures with deliberately nonexistent gate
names to exercise validators. Therefore the scan must be limited to the
documentary contracts and workflows (`README.md`, `AGENTS.md`,
`CONTRIBUTING.md`, `OPEN-CORE.md`, `docs/` and `.github/`), not the whole tree.

## Decision

1. Add `check:documented-npm-commands` to the official `npm run check` chain.
2. Extract every `npm run <script>` reference from the operational documents and
   verify it against `package.json.scripts`.
3. Emit file and line for each nonexistent command and fail closed.
4. Register the gate in `KNOWN_GATES` as a documentation inspector (`docs`).
5. Exclude scripts and tests from the corpus because they contain examples and fixtures
   that are not operational instructions.

## Consequences

- A script rename or removal immediately breaks the gate if a
  live instruction still points at the old name.
- Validator examples can keep using fictitious commands without
  contaminating the documentary contract.
- The gate does not verify that the command is safe, that its secrets are
  configured or that the procedure completes: it only guarantees that the
  invoked name exists. Those properties remain covered by the
  workflow, environment and launch-checklist gates.
- Exported repositories that omit an optional root remain
  verifiable; the reader ignores missing roots but never ignores a
  found document containing an invalid command.
