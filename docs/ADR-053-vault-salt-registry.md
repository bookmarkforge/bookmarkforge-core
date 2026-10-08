# ADR-053: Single per-vault salt registry — consolidation of `kdf_salt` and `vault_salt`

- **Status:** proposed
- **Date:** 2026-09-17

## Context

Today **two** random salts persisted per vault coexist, under two completely
different registration regimes:

1. **`kdf_salt`** (`SECURE_STORAGE_KEYS.KDF_SALT`, on-disk key
   `"kdf_salt"`) — the Argon2id salt of the master corpus (ADR-046) and, since its
   scope extension, of the Voy index. It has a full lifecycle:
   provisioning (`ensureVaultKdfSalt`), rotation snapshot/rollback
   (`snapshotVaultKdfSalt`/`restoreVaultKdfSalt`), rotation together with the password
   (`rotateVaultKdfSalt`) and cross-tab synchronization (`kdf-salt-sync.ts`).
   It lives in `src/services/security-vault/kdf-salt.ts`.
2. **`vault_salt`** — the input salt of `deriveDbKey`
   (`crypto-core.deriveDbKey`), which produces the RxDB storage key.
   Minted once with a CSPRNG in `src/db/database.ts` (with legacy migration
   from localStorage), referenced as a **string literal** `"vault_salt"`
   without a shared constant, without snapshot, without sync. It never rotates: rotating it
   would change the KDF input of the DB key and make the entire
   existing RxDB store unreadable.

The status quo has three problems, all of them governance and none cryptographic:

- **Diffuse ownership**: nothing in the tree declares that `vault_salt` is a
  per-vault salt that is deliberately *non-rotating*, nor that its value must not be touched.
  The next agent to "clean up" salts faces two similar keys and
  no documentation of why they differ.
- **Refactor drift risk**: a naive "unification" of values
  (using `kdf_salt` as the `deriveDbKey` input, or vice versa) would silently
  re-key the RxDB store or the master corpus. Today only discipline
  and ADR-046's tests prevent it.
- **Double inventory**: ADR-052 (Phase 1) needs to report the state of
  per-vault secrets; doing so requires a single queryable registry instead of
  chasing scattered literals.

What this ADR consolidates is the **registry**, not the material: the salts'
  values cannot be merged (see A-1) nor renamed on disk (see A-2).

## Decision

1. **Single registry module**: `src/services/security-vault/salt-registry.ts`
   exports typed descriptors (no values, contracts only):

   ```ts
   // Contract sketch — the real implementation arrives with Phase A.
   export interface VaultSaltDescriptor {
     /** Shared key constant (e.g. SECURE_STORAGE_KEYS.KDF_SALT). */
     storageKey: string;
     /** Readable purpose, for diagnostics and logs (no secrets). */
     purpose: "master-kdf" | "db-key-kdf";
     /** ADR that governs this salt's lifecycle. */
     governance: string;
     /** Does it rotate when the master password rotates? */
     rotatesWithPassword: boolean;
     /** Does it require cross-tab propagation (kdf-salt-sync)? */
     syncCrossTab: boolean;
   }
   ```

   With two initial entries: `kdf_salt` (`rotatesWithPassword: true`,
   `syncCrossTab: true`, governed by ADR-046) and `db_salt` — the code
   name for `deriveDbKey`'s salt — (`rotatesWithPassword: false`,
   `syncCrossTab: false`, governed by this ADR). All readers and
   writers import the constant from the registry; the scattered
   `"vault_salt"` literal across the tree is forbidden.

2. **The on-disk `vault_salt` key does not change.** The on-disk name is a persisted
   format, not an implementation detail: existing vaults remain readable
   without a value migration. Only the registry changes at the
   code level.

3. **`db_salt`'s non-rotation is deliberate and documented in the
   descriptor.** ADR-046's rollback table (§4) only includes `kdf_salt`
   because rotation **never writes** `db_salt`; this ADR promotes that exclusion
   from accident to contract (`snapshotVaultKdfSalt` must not be "completed" with
   `db_salt` in the future). When the password is rotated, the next unlock derives
   a new DB key with the **same** `db_salt` and re-wraps
   `encrypted_db_key` under the v6 master layer — without touching the RxDB store.

4. **Minting independence.** Both salts are minted with a CSPRNG and never
   one from the other, nor from device identifiers (same
   reason as A-9 in ADR-046: coupling lifecycles turns a device-key
   re-wrap into a silent re-derivation of everything else).

5. **Unified diagnostics (ADR-052 link).** The sunset's Phase 1 exposure counter
   reports per registry entry (detected format,
   `v5:`/`v6:`), a single inventory for both salts.

6. **Governance of new entries.** Adding a third per-vault salt requires
   a registry entry with its referencing ADR; the `audit-anchors`
   catalog is a candidate to anchor the registry module as
   security-critical source (same pattern as `secure-storage-source`).

7. **Implementation phases:**
   - **Phase A — registry.** Create `salt-registry.ts` with the two descriptors,
     migrate `database.ts` and `kdf-salt.ts` to the shared constants,
     unit test of invariants (see Consequences). A purely
     structural change: zero behavior changes, zero touches on disk.
   - **Phase B — diagnostics.** Wire ADR-052's counter to the registry.
   - **Phase C — anchor.** Register the module in `audit-anchors` as a source.

## Consequences

- **+** Single, typed inventory: a refactor touching any salt fails
  typecheck or shows up in the registry diff, not in a hidden literal.
- **+** The lifecycle asymmetry (rotating / non-rotating) goes from tribal knowledge to
  declarative, in the code itself.
- **+** ADR-052 gets its inventory without duplicating discovery.
- **−** One more indirection module; the cost is one import per
  consumer.
- **−** The historical on-disk name `vault_salt` coexists with the code
  name `db_salt`; it is accepted for compatibility (A-2) and documented in
  the descriptor.
- **Tests anchoring the contract (Phase A):** registry invariants — distinct
  on-disk keys between entries, `kdf_salt.rotatesWithPassword ===
  true`, `db_salt.rotatesWithPassword === false`, no shared values —
  plus `database.ts`'s existing suite (behavior intact) and ADR-046's P0
  (rollback with no changes).

## Rejected alternatives

- **A-1. Merging values: a single salt for both KDFs.** Changing the
  `deriveDbKey` input produces a different DB key → an RxDB store unreadable for
  every existing vault. It would also couple lifecycles: if `kdf_salt` rotated
  with the password, every rotation would re-key the entire store. It is
  exactly the class of data loss that ADR-046's A-3/A-6 rejected.
- **A-2. Renaming the on-disk `vault_salt` key.** It breaks existing vaults
  without a value migration (read the old key, write the new key,
  delete the old one), which buys nothing: uniqueness is already guaranteed and the
  goal is the code registry, not on-disk aesthetics.
- **A-3. Rotating `db_salt` with the password too.** O(corpus) re-keying of the
  RxDB store on every password change, with mass-loss risk if
  re-encryption fails halfway, and no benefit: the DB key already lives encrypted
  under the v6 master layer — an attacker needs to break that layer before
  `db_salt`'s constancy gains them anything.
- **A-4. Single JSON blob (`vault_salts`) in SecureStorage.** It requires a value
  migration (A-2 again), creates a single corruption point for both salts
  and complicates ADR-046's rollback, which operates on the individual
  `kdf_salt` key. A code-level registry with stable on-disk keys achieves
  the goal without touching data.
