# Legacy compatibility retirement plan

- **Status:** active; no legacy path is automatically removed.
- **Owner:** project maintainer.
- **Review:** on every major release and before modifying persisted formats.
- **Last technical review:** 2026-09-05.

## Objective

Reduce the cost of maintaining compatibility formats, storage keys and APIs
without breaking existing vaults or causing data loss. A path can only be retired
when evidence exists that no compatible consumers remain or when an explicit
and reversible migration is introduced.

## Current inventory

| Surface | Compatibility | Current policy | Retirement criterion |
|---|---|---|---|
| Encryption `v2:`/PBKDF2 | Legacy read, new write disabled | Decrypt and migrate to a current format during a safe operation; never write `v2:` | Metric or local diagnosis demonstrating zero `v2:` rows in supported installations, plus a tested read migration |
| Internal storage envelopes | Read of legacy and authenticated rows | Read both formats; new writes use authenticated envelope | All rows migrated and downgrade/upgrade tests preserved |
| Old consent keys | Scoped migration read | `forge_consent_*` keys are the authority; old keys grant no new permissions and are cleaned when appropriate | A major version with documented migration and proof that absence of old key does not change privacy |
| Old vault/license keys | Read migration | Copy to secure storage and clean old surface; legacy state does not grant Pro | Evidence of complete migration and recovery support for installations not opened during transition |
| RxDB schema migrations | Historical migrations | Kept because necessary to open old installations; each version is tested | Only after an explicit minimum version policy and an export/migration tool for unsupported versions |
| Analytics APIs without `batchId` | Old client semantics | Accepted as read compatibility; new clients send `batchId` | Coordinated client and server retirement in a documented protocol version |
| Container re-exports | Import compatibility | Kept while consumers exist; container is the canonical path | Import census equal to zero during a full release and consumer migration |

## Decision rules

1. **Do not confuse `fallback` with legacy.** `Suspense fallback`, browser
   degradations and fail-closed paths are current operational behavior, not
   compatibility debt.
2. **Do not delete migrations by apparent age.** Code age does not prove that
   old data does not exist in production.
3. **Do not use remote telemetry to identify vault content.** Decisions must
   rely on aggregated, opt-in, content-free diagnostics, or explicit local
   inspection.
4. **Each retirement requires:** ADR or update of relevant ADR, regression test
   of current format, release note and a recovery path.
5. **Phased removal:** mark as read-only → measure/admit a minimum version →
   migrate → retire in a major version.

## Next actions

- [ ] Add to each format's documentation the minimum read version and the
      version that stopped writing it.
- [ ] Incorporate a local diagnosis of legacy formats found, without sending
      vault content or identifiers.
- [ ] Create a support matrix by application version before retiring any
      RxDB migration.
- [ ] Review consumers of `src/container` re-exports and register the result
      in the corresponding ADR.
- [ ] When closing a path, update inventory, tests and release note in the same
      change.

## Documentary hygiene of this transition

- **ADRs appearing in the anchor catalog or justifying active gates are kept;**
  an ADR is not deleted by apparent age.
- **Dated audit reports are kept as historical evidence,** but
  `docs/audit.md`, `docs/launch-checklist.md` and gates are the current
  operational source. An old report does not authorize a current decision.
- **Drill logs are kept when they document a failure, root cause or reproducible
  recovery; they serve as learning evidence, not as current system state.
- **Release notes are kept as release history.** Temporal data (commits, counts
  and states of a run) must not be copied to living runbooks without new
  verification.
- **Pre-launch debt indexes that duplicate live sources must be retired or
  marked as archived in a separate change, after verifying they are not consumed
  by a gate. Not deleted here because the checkout already contains third-party
  modifications in those documents.

## Tooling convention during migration

The root of `scripts/` remains a compatible entrypoint surface.
New modules are located by responsibility:

| Area | Location | Rule |
|---|---|---|
| Quality and packaging | `scripts/tooling/` | lint, static analysis and budgets |
| Tests and profiles | `scripts/` during transition | entrypoints do not change name while CI consumes them |
| Security and compliance | `scripts/` during transition | move internals only with reference update and tests |
| Operations | `scripts/` during transition | do not move deployments/drills without reviewing workflows and runbooks |

Surface reduction is done by first removing unreferenced entrypoints and then
fusing duplicates, always with a contract test. A simple file move is not
considered reduction: each migration must reduce commands, duplication or
maintenance cost.


This document does not authorize deleting code, deleting local data, changing
cryptographic formats or disabling migrations. It is a decision control;
effective retirement requires evidence and separate review.
