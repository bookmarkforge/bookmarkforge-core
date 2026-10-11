# ADR-052: v5 format sunset — retirement of the legacy static Argon2id salt path

- **Status:** proposed
- **Date:** 2026-09-17

## Context

A-1 (provisioning and migration, see `docs/ADR-046-vault-kdf-salt-rotation.md`)
replaced the **constant, bundle-wide shared** Argon2id salt with a
random per-vault salt: new payloads are `v6:` and **carry their own
embedded salt**. `v5:` payloads written before the migration are still read
with the legacy fixed salt — this is the deliberate read-compat decision that
avoided losing data in the A-1 wave — and today that is the only place in the
tree where the RFC 9106 violation survives (one salt for all vaults):

- `crypto-core.deriveContextSalt(context, null)` derives the legacy salt as
  `SHA-256(context)`, with contexts `bookmarkforge-v5-master-key` and
  `bookmarkforge-session-master-key-v6`. A single Argon2id pass over a
  candidate password serves against **every** `v5:` blob of **every** vault in
  the world, for as long as that blob exists.
- Opportunistic re-wrapping (`migrateVaultSecretsToVaultSalt`, on every
  unlock, with the freshly verified password) and verification-token re-minting
  move the `SecureStorage` corpus to `v6:` incrementally. Every new
  **write** is already `v6:` (an invariant anchored in
  `p0-vault-kdf-salt.regression.test.ts`).
- The residual stock that resists migration is, by construction, the one that
  **is never re-opened** with a recent build: abandoned devices, secrets in
  paths no unlock walks, and **on-disk backups written pre-A-1**
  (backups are only re-keyed when the user restores them with the
  password they were created with).

The sunset, therefore, cannot be a date: it is a condition over the real
stock of blobs. Retiring the v5 parser while real data still exists in v5 is a
data-loss decision, not a security one; keeping it indefinitely is keeping a
valid global dictionary. This ADR sets the mechanism for moving from one to the
other in a measurable, reversible and fail-closed way.

## Decision

1. **Conditional sunset, not calendar-based.** Retirement proceeds when the
   stock has been migrated, measured — not when time passes. The objective
   criterion for "migrated stock" is: **zero secrets in v5 format reported by
   the exposure instrumentation for two consecutive unlocks** on a
   given vault, plus the natural expiry of old backups by age
   (already bounded by ADR-032/ADR-034: on-disk backup pruning and
   storage quota).
2. **Phases:**
   - **Phase 0 — today (already implemented).** `v5:` read-only + opportunistic
     re-wrapping on unlock + writes always `v6:`. The executable
     matrix (`src/utils/legacy-compat-matrix.ts`) documents the
     `legacy-read-only` state of each format.
   - **Phase 1 — exposure instrumentation.** A persisted, queryable counter
     (DiagnosticService → diagnostics panel) that reports how many `SecureStorage`
     secrets persist in `v5:` format per vault, and how many were re-wrapped on
     the last unlock. No telemetry: the data is local, and this repository's
     consumer is the user/maintainer themselves.
   - **Phase 2 — residual notice.** If after N consecutive unlocks the counter
     does not reach zero, the security UI shows a non-blocking notice that
     explains what it means (the global dictionary still applies to those blobs) and
     how to force the re-wrap (an unlock with the correct password /
     restoration of the backup with a current build). It never blocks reading.
   - **Phase 3 — cutover after the criterion.** Retire the legacy derivation
     branch (`salt = null` in `deriveContextSalt`) and `v5:` parsing in decrypt,
     behind a **reversibility build flag**
     (`VITE_ALLOW_V5_LEGACY_READ`, default OFF). Without the flag, a `v5:` blob
     produces a **typed and actionable** error ("legacy format retired;
     update from an earlier build or restore from the converted backup"),
     never a cryptic failure. With the flag, a bridge build keeps
     reading alive for one release cycle for support cases.
   - **Phase 4 — removal.** Delete the flag and the dead code, move the
     compatibility-matrix row to `removed`, and retire the v5 read-compat
     tests (the ones that today anchor compatibility in
     `p0-vault-kdf-salt.regression.test.ts`, `real-crypto.integration.test.ts` and
     the `tests/e2e/legacy-vault-seeder.ts` seeder), leaving the ADR as the
     historical reference for the format.
3. **Invariants throughout the sunset:**
   - No new `v5:` writes since Phase 0 (today).
   - Retiring the parser cannot break a `v6:`: the formats are
     self-describing by prefix (`v6:`/`v5:`) and by a marker byte in the
     session-key layout, so the cutover is safe by construction.
   - Each phase hop is a reviewable code change in a PR; the Phase 3
     flag is the operational reversibility valve.
   - The per-vault salt (`kdf_salt`, ADR-046) and `deriveDbKey`'s `vault_salt`
     are untouched: this ADR only retires the `salt = null` (constant)
     path.
4. **What this ADR does not do:**
   - It does not migrate old backups: that is impossible without the password they
     were written with. They remain readable while the read path exists; after
     Phase 3 they require the bridge build (flag) or manual conversion
     (restore with an old build → unlock → re-export, already in `v6:`).
   - It does not unify `kdf_salt` and `vault_salt` into a single registry (a
     hygiene improvement independent of security).

## Consequences

- **+** The global dictionary stops serving as soon as the last `v5:` blob
  disappears, and the deadline stops being a promise: it is a counter measurable
  per vault. RFC 9106 is met again for 100% of the stock once
  Phase 3 closes.
- **+** Reversibility: any phase can be stopped; the Phase 3 flag
  allows supporting edge cases without reopening the format by default.
- **−** Until Phase 3, bundle-wide exposure persists for blobs that
  are never re-opened (abandoned devices is the dominant case). It is the
  explicit trade-off: read-compat first, measurable closure afterwards.
- **−** Support cost at Phase 3: users who update while skipping the
  bridge build will not be able to read `v5:` vaults/backups. Mitigation: the
  Phase 2 notice and keeping the flag available for one release cycle.
- **Test surface affected per phase:** the tests that today anchor
  v5 read-compat are retired in Phase 4 in the same PR that removes the code
  (retiring a test anchored by the `security-tier-4-p-regression-suite`
  umbrella requires a `audit-anchors` catalog update — an ADR-level change,
  consistent with this document).

## Rejected alternatives

- **A-1. Calendar sunset (fixed cutover date).** It does not measure the real stock:
  it either breaks data for users who still have `v5:` blobs, or it gets postponed
  indefinitely as soon as a support case appears. The measurable condition
  makes the cutover honest.
- **A-2. Forced migration (re-keying without user interaction).** Cryptographically
  impossible: re-wrapping requires the password, which only exists during
  an unlock. Forcing a vault reset is data loss, not migration.
- **A-3. Keep v5 forever.** It keeps a valid global dictionary
  against every legacy blob in the world and contradicts RFC 9106 permanently;
  it also contradicts the direction already taken by ADR-046.
- **A-4. Double-writing v5+v6 during the transition** to "guarantee"
  backward compatibility with old builds. It duplicates the harvestable corpus
  instead of reducing it and re-introduces v5 writes, which Phase 0 already closed.
- **A-5. Re-encrypting user backups in the background.** Backups can only
  be re-keyed when the user opens or restores them with the password they
  were created with; a "background" re-encryption without that material does not exist.
  Expiry by age (ADR-032/034) is the right mechanism to bound their
  lifetime.
