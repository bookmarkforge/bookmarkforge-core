# ADR-046: Vault KDF salt rotation together with the master password

- **Status:** accepted (implemented in `src/services/security-vault/kdf-salt.ts`
  and `SecurityVault.rotateMasterPassword`; regression in
  `src/tests/security/p0-vault-kdf-salt.regression.test.ts` and
  `src/tests/services/SecurityVault.test.ts`; E2E
  `tests/e2e/vault-change-password.spec.ts`)
- **Date:** 2026-09-12

## Context

Master key derivation stretched the password with Argon2id against a
**constant salt shared by the whole bundle**
(`bookmarkforge-v5-master-key`, `bookmarkforge-session-master-key-v6`). A
single Argon2id pass over a candidate password served against any vault in the
world, which is exactly what RFC 9106 forbids by requiring a unique salt per
password.

A-1 closed that gap for provisioning and migration: each vault mints 16 random
bytes, persists them in `SecureStorage`
(`SECURE_STORAGE_KEYS.KDF_SALT` → `"kdf_salt"`) and installs them in the
cryptographic layer. New payloads come out `v6:` and **carry their own embedded
salt**; earlier `v5:` ones are still read with the fixed legacy salt.
The salt is public metadata: what is protected is its uniqueness, not its
secrecy. (See also `docs/ADR-019-argon2id-migration.md` for the earlier migration
of the Argon2id parameters.)

What A-1 **did not** cover is password rotation: `rotateMasterPassword`
invalidated the password but kept the salt. The hostile artifact is not the
password, it is the **corpus of blobs encrypted with it** — the verification
token (H5, stored without the device-key layer, so it stays readable with the
vault locked), `encrypted_db_key`, `encrypted_api_key` and the wrapped device
key itself. A harvested corpus is worth exactly what the salt that produced it
is worth: leaving the salt intact handed anyone who had already built a
dictionary against the **old** password a dictionary that still applied to blobs
written under the **new** one. "I changed my password" was only true online, not
against an offline attack.

Constraints that shape the decision:

- Rotation must not invalidate already-encrypted data. Shares, backups and
  pre-migration blobs must keep decrypting, including if the operation is
  undone. `v6:` guarantees this by construction: decryption never consults the
  module salt (a `v6:` uses its own embedded one; a `v5:` uses the fixed legacy).
- **Unlocking** must never break because of the salt. Rotation, on the other
  hand, is an explicit authenticated operation: if it cannot complete, it must
  fail and undo itself, never pretend success.
- There may be more than one open tab, and the vault can lock mid-operation
  (`vaultGeneration` + `isLocked()` abort the rotation). And the salt is not
  shared state: it lives in module memory, so a rotation did not reach an
  already-open tab until it reloaded — that tab kept writing under the retired
  salt (see Decision 8).
- `RECOVERY_DATA` does **not** rotate: it is encrypted with the recovery phrase,
  not with the password. Treating it as a rotatable secret was a production bug
  that made **every rotation fail** (reintroducing it is a regression).

## Decision

1. **The salt rotates in the same operation as the password**, and before
   re-wrapping any payload. It is the only moment where the salt must change
   mandatorily: the password stops being valid there, and with it the value of
   the corpus that salt produced.
2. **Swap order: snapshot → persist → install.** Never the other way round
   (see "Rejected alternatives" A-3).
   - *Persist first*: a crash cannot leave the vault encrypting under a salt
     storage has not seen; the next unlock would adopt the old stored salt and
     split the vault into two derivations.
   - *Install second*: nothing is written with the new salt until the vault is
     committed to it, which is why `restoreVaultKdfSalt` is a complete undo.
     The prior state is **passed** into `rotateVaultKdfSalt` instead of being
     re-read there, so it cannot pick up its own half-finished write.
3. **Everything encrypted with the password is re-wrapped**, not just the salt:

   | Artifact | How it is re-keyed | Reason |
   |---|---|---|
   | `encrypted_db_key`, `encrypted_api_key` | `decryptWithBytes` + `encryptWithBytes` with the new password; they come out `v6:` with the new salt | they are the corpus an attacker would harvest |
   | wrapped device key (H5) | `rewrapDeviceKeyWithPasswordBytes(old, new)` while the old password bytes are still alive | the in-memory handle does not change, only its at-rest envelope |
   | verification token (H5) | `createVerificationToken(newPassword)` | it is the official verification oracle; it must end up under the new password **and** the new salt |
   | token's S1 integrity record | reissued with the token | a desynchronized record would make verification fail on next startup |

4. **Rollback contract.** A failure at any point restores, in this order,
   everything that had been written:

   | Artifact | Prior snapshot | Restoration |
   |---|---|---|
   | `encrypted_api_key`, `encrypted_db_key` | per-key value before touching anything | `setSecret` of the prior value |
   | wrapped device key | `getWrappedDeviceKeyBlob()` | `restoreWrappedDeviceKeyBlob` |
   | verification token | `getVerificationToken()` | `restoreVerificationToken` |
   | S1 integrity record | `getVerificationIntegrity()` | `storeVerificationIntegrity` or `deleteSecret` if it did not exist |
   | KDF salt | `snapshotVaultKdfSalt()` → `{ stored, installed }` | `restoreVaultKdfSalt()`, **last** |

   Contract rules:

   - **The salt is restored last**, once every payload written under the new one
     has been put back. The **in-memory** half is what sustains the current
     session (it is still on the old password, so it must stay on the
     derivation that password was stretched with); the **stored** half is what
     the next unlock will install. Both attempt to restore, even if the write
     fails.
   - **`stored: undefined` is not `null`.** `undefined` means "the read failed"
     (device key locked) and is not "restored" by deleting a value that was
     never seen; `null` means "there was no salt" and is deleted.
   - **`restoreVaultKdfSalt` never throws.** It runs on the failure path: if it
     threw, it would mask the original error that caused the rollback.
   - The snapshot is taken **before** touching the salt, so a rotation that dies
     between "persisted" and "installed" is still undoable.
5. **Rotation fails loudly; provisioning does not.** `rotateVaultKdfSalt`
   propagates the error if the new salt cannot be persisted (the caller undoes
   and returns `false`), unlike `ensureVaultKdfSalt`, which runs on the unlock
   path and therefore degrades to legacy mode with a warning instead of
   breaking unlock.
6. **Broken RNG = error, not an apparent rotation.** If the freshly minted salt
   matches the previous one (probability 2^-128: by then the generator is
   broken), it retries once and then **throws**
   (`Vault KDF salt rotation produced a repeated salt`): returning the same salt
   would declare a rotation that did not happen.
7. **Serialization.** `rotationPromise` makes two concurrent rotations share a
   single operation instead of stepping on each other. It serializes
   **rotations, not writes**: another service writing during the rollback window
   (milliseconds) would do so under the new salt.
8. **Propagation to open tabs.** The salt lives in module state, so a rotation
   only reached the other tabs on reload. The tab that rotates **announces** the
   change and the others **re-read the salt from storage**
   (`kdf-salt-sync.ts` + `adoptVaultKdfSaltFromStorage`):
   - **The message carries no value, only the trigger.** Any script from the
     origin can write to a `BroadcastChannel` (which is why `BroadcastBridgeService`'s
     external channel is HMAC-signed) and here there is no shared key to sign
     with: after a rotation the two tabs have **different** passwords. Storage
     is the authority, so a forged message only causes a re-read of the same
     salt, never the installation of an attacker-chosen one (the downgrade that
     would matter: a chosen salt makes a single dictionary reusable again).
   - **Only a confirmed rotation is announced**, never a reversible one:
     announcing midway would leave the other tabs on a salt this one can still
     undo, with every `v6:` written in that window pinned to a salt the vault no
     longer has. If the rotation is undone, nothing is announced, storage
     returns to the previous salt and the tabs — which never moved — stay
     consistent with it.
   - **Idempotent and safe against late or duplicate deliveries:** the handler
     re-reads the CURRENT salt, so a repeated, reordered or post-rollback
     message converges to the same value instead of resurrecting the
     unconfirmed one.
   - **It only listens while the vault is unlocked** (reading the salt needs the
     device key), and the channel closes on lock. A locked tab needs nothing: it
     can neither read the salt nor write with it, and its next unlock provisions
     the current one.
   - **The password is not transmitted**: the adopting tab keeps the old one in
     memory, and that is recorded as a warning (see Consequences).

## Consequences

- A dictionary built against the previous password stops applying to the vault
  as soon as `rotateMasterPassword` returns `true`, because the rewritten
  payloads are pinned to a new password **and** a new salt.
- Nothing already migrated becomes unreadable, whatever happens: decrypting a
  `v6:` depends on neither the module salt nor the stored one. Backups, shares
  and a tab that still has the old salt keep decrypting.
- A rotation writes several payloads + the token + the wrapper + the integrity
  record. The cost is that of an explicit, infrequent operation, in exchange for
  the rollback covering exactly those writes.
- **The two-live-salts window closes without a reload:** an open tab adopts the
  rotated salt as soon as the rotation is confirmed (verified end-to-end with
  two real tabs in
  `tests/e2e/vault-kdf-salt-cross-tab.spec.ts`), so it stops accumulating
  ciphertext under the retired salt. The case the notification does **not**
  cover is a tab without `BroadcastChannel` (private mode, old browser): that one
  stays on the previous salt until reload, which is the previous behavior, not a
  worse one.

### Scope extension (2026-09-17): the Voy index derives under the same per-vault salt

The persisted vector search index (AES-GCM envelope of the
`voy.worker.ts` worker) maintained a parallel encrypted corpus whose KDF was
**not** covered by this ADR: `deriveIndexKey` stretched the password with
Argon2id against `SHA-256("bookmarkforge-voy-index-v1")[0..16]`, a bundle
constant identical for every vault — exactly the failure class A-1 fixed for the
master corpus. A dictionary built against the harvested IndexedDB index was
valid against any vault's.

Alignment with this ADR (2026-09-17):

- **Updated `SET_KEY` contract:** `VectorIndexService.setVaultKey` reads the
  installed per-vault salt (`getVaultKdfSaltHex`) and sends it explicitly
  (`{ passwordBytes, vaultSalt, keyId }`). The constant `userId` field is
  retired. The order already guaranteed by this ADR makes the change safe:
  unlock installs the salt **before** firing `onUnlock` listeners, and the
  index key is installed from there.
- **Fail-closed at both ends:** the worker validates `vaultSalt` as 32 hex and
  rejects `SET_KEY` before deriving (the `passwordBytes` are zeroized
  regardless); with no salt installed, the service does not send `SET_KEY` and
  degrades to the existing `ensureVaultKey` lane — in-memory search yes,
  encrypted persistence no. An index is never written under the wrong salt.
- **Password rotation included for free:** since the index salt is the same one
  this ADR rotates, re-derivation after a rotation re-keys the index corpus
  without additional code.
- **Envelope compatibility:** indexes already persisted under the retired
  constant salt are **not** migrated; on the next unlock the re-derived key
  (new salt) fails AES-GCM authentication and the existing fail-closed
  `LOAD_INDEX` path purges the record and rebuilds the index from the source
  RxDB collections. With no plaintext exposure: the cost is a one-time reindex
  per vault.
- **Regression anchors:** `p0-voy-dedup.regression.test.ts` (roundtrip: the
  reopened envelope requires the same salt in both `SET_KEY`s),
  `voy.worker.test.ts` (malformed `vaultSalt` rejected without deriving, with
  zeroization) and `VectorIndexService.test.ts` (`SET_KEY` carries the
  per-vault salt; the retired constant never reaches the worker). Files:
  `src/services/ai/VectorIndexService.ts`, `src/workers/voy.worker.ts`.
- **The adopting tab is left with a stale credential.** Its in-memory password
  is the **old** one: the adopted salt makes it write `v6:` under the new salt
  but pinned to the previous password, which the new password (the one the user
  now has) does not open after a reload. It is the prior hazard of rotating with
  several tabs open — and propagation does not worsen it, it improves it: that
  corpus goes from being under the retired salt (whose precomputation the
  attacker already paid for) to being under a unique one. Closing it entirely
  would require transmitting the new password between tabs, which is exactly
  what is not done; the honest answer is to log in again, and adopting the salt
  does not break that tab's own reads (the master key cache is indexed by salt).
- The salt remains public metadata and is neither encrypted nor derived from
  anything: the property maintained is uniqueness + rotation, not secrecy.
- Tests anchoring the contract: `rotateVaultKdfSalt` (persist before install,
  loud failure without installing anything, repeated-salt rejection, failed read
  reported as unknown, real re-keying) and `restoreVaultKdfSalt`
  (both halves, deleting a nonexistent salt, not deleting the unreadable,
  malformed salt treated as absent) in
  `src/tests/security/p0-vault-kdf-salt.regression.test.ts`; the three
  rotation tests covering rollback, early abort and full re-wrapping in
  `src/tests/services/SecurityVault.test.ts`, including both ends of the
  notification (announced once after confirmation, **not** announced if the
  rotation is undone); cross-tab propagation (adoption from storage,
  indifference to a forged salt, malformed/absent/unreadable salts rejected,
  real `stop` and absence of `BroadcastChannel`) in the same P0 file; and two
  end-to-end checks: that the salt **actually changes** (read from the H5 token's
  ciphertext, in `tests/e2e/vault-change-password.spec.ts`) and that a **second
  tab** adopts the new salt without a reload and starts writing with it
  (`tests/e2e/vault-kdf-salt-cross-tab.spec.ts`).

## Rejected alternatives

- **A-1. Keep the salt during rotation (status quo).** This is the failure this
  ADR fixes: the harvested corpus survives the password change and an old
  dictionary still holds. It would only require the attacker to repeat their
  work if the salt changed.
- **A-2. Deterministic salt derived from the password** (for example
  `HKDF(password, "salt")`). Reproduces the failure class A-1 removed: the salt
  stops being unique per vault (two vaults with the same password share a
  derivation) and becomes guessable/harvestable together with the password. It
  would also make rotation cosmetic: the "new" salt would be verifiable from the
  candidate password.
- **A-3. Install first and persist afterwards.** A crash between both steps
  leaves payloads written under a salt storage does not know; the next unlock
  installs the old salt and the vault is split between two derivations, with
  potentially irrecoverable data. That is why the order is a decision and not a
  detail.
- **A-4. Rotate without rollback (fail-forward), for simplicity.** A vault
  half-re-wrapped (one secret with the new password and another with the old,
  the token desynchronized from its S1 record) cannot be undone from the UI and
  can cost the data. We prefer an operation that fails cleanly over one that
  fails halfway.
- **A-5. Rotate the salt without re-wrapping existing blobs.** Changing only
  the metadata reduces nothing: already-harvested blobs would stay pinned to the
  old salt, and the attacker would only have to use the previous salt they
  already know. Rotation is worth what gets re-keyed, not what gets written to
  the metadata store.
- **A-6. New vault or full migration instead of in-place rotation.** Much more
  invasive (it would invalidate shares and force a re-import), and it would add
  nothing against the offline attack: the secret objects are the same and would
  have to be re-wrapped anyway.
- **A-7. Rotate the salt on every unlock** ("free" defense in depth). It
  defends against nothing while the password does not change — the harvested
  corpus and its salt are still the same pair — and it would add a write and an
  extra Argon2id derivation to the path that must never fail, which is exactly
  what makes `ensureVaultKdfSalt` silent and rotation loud.
- **A-8. Not persisting the salt and taking it from the last decrypted
  payload.** It is circular during provisioning (a new vault has no payload to
  read it from) and would add an extra read on every write to reconstruct a
  value the cryptographic layer needs available.
- **A-9. Deriving the salt from already-existing material** (device key, vault
  id) instead of using the RNG. It couples two lifecycles: re-wrapping or
  regenerating the device key would silently change the derivation, and rotation
  would stop producing a value independent of everything that survives the
  change.
- **A-10. Snapshot without distinguishing "no salt" from "could not read".**
  Restoring by deleting when the read failed would destroy the vault's real salt
  based on an assumption, and the next unlock would mint a different one: loss
  of access to everything written `v5:` under the lost salt.
- **A-11. Transmitting the new salt in the cross-tab message.** It saves one
  storage read and turns the channel into a way to install a third-party value: a
  `BroadcastChannel` is writable by any script from the origin, and after the
  rotation the tabs share no key to sign with (they have different passwords). An
  attacker-chosen salt reintroduces A-1's failure — a single dictionary becomes
  useful for many vaults again. With a payload-free trigger, storage decides and
  the forgery is inert.
- **A-12. Announcing as soon as the new salt is installed** (before re-wrapping
  the payloads and before confirmation). Faster adoption, and in exchange the
  other tabs would move to a salt this operation can still undo: a rollback
  would leave the neighbors pinned to a value the vault no longer has, writing
  with it. It is announced on confirmation, not on installation.
- **A-13. Locking the other tabs when the rotation is detected**, as a strong
  form of "stop writing". It is safer for the data than staying with a stale
  credential, but it is a product decision (it evicts the user from a tab they
  did not touch) and is not necessary for the goal: the adopted salt already
  prevents ciphertext accumulating under the retired one, and the way the
  ordinary tab resolves its stale credential — logging in again — is still
  available. The decision is recorded here as not taken, not as impossible.