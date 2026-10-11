# ADR-019: Argon2id migration and V4/V5 encryption formats

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from the code and the private `audit.md`)

## Context

The local-first vault needs encryption at rest that resists offline attacks.
The legacy `v2:` format used PBKDF2, a KDF with no GPU/ASIC resistance and with
parameters that fell short against current hardware. In addition, the
cryptographic operations ran on the renderer's main thread, which
let the KDF block the UI and complicated memory zeroization.

## Decision

1. **Argon2id is the only forward KDF.** Base data key
   derivation uses Argon2id with elevated memory parameters; domain
   keys are separated with HKDF (`crypto-core.ts`). The legacy `v2:` format
   (PBKDF2) remains **read-only** to allow migrating existing vaults;
   new code never writes `v2:`.
2. **Stable wire formats** (contract documented in `AGENTS.md` §2):
   - `v6:` = base64(`vault_salt(16) || hkdf_salt(16) || iv(12) || ciphertext`) — current write format.
   - `v5:` = `hkdf_salt(16) || iv(12) || ciphertext` — legacy read-only.
   - `v4:` = `salt(16) || iv(12) || ciphertext` — Argon2id per operation (legacy of the migration itself).
   - `v2:` = PBKDF2 — read-only.
3. **Cryptography off the main thread.** Background derivation and encryption
   live in `src/workers/crypto.worker.ts`, so the heavy KDF
   never blocks the UI and key material is materialized in an isolated context.
4. **Memory zeroization as a contract.** Password buffers are
   consumed in place after derivation (`zeroPasswordBytes`); maximum-effort
   zeroing is a double fill (`fill(0)` → XOR `0xAA` → `fill(0)`) to
   defeat compiler elision. The full operational detail is in
   `AGENTS.md` §2, which is the normative reference for this contract.
5. **Visible migration progress.** Row rewrites during the schema
   version bump (`src/db/migration-progress.ts`) show a progress
   overlay (`tests/e2e/vault-migration-progress.spec.ts`) because an Argon2id
   migration can take minutes on slow hardware.
6. **Test vs production parameters.** Vite's test mode uses reduced
   Argon2id parameters (8 MiB, t=1) so the E2E suite does not pay the
   128 MiB KDF (~28 s) on every setup; production keeps the strong parameters
   (`isProdBuild()` in `playwright.config.ts`).

## Consequences

- The `v6:`/`v5:`/`v4:`/`v2:` formats are frozen wire contracts: any
  change requires a new ADR and a migratory read path.
- Files in this domain carry the header anchor `// ADR-019: …`
  (`crypto-core.ts`, `argon2-kdf.ts`, `crypto.worker.ts`, `database.core.ts`,
  `EncryptionService.ts`, `SecureStorage.ts`, `SecurityVault.ts`, etc.).
- The `check:audit-drift` gate watches the regression anchors tied to this
  domain; removing or renaming anchored tests is an ADR-level change.
- The cost of strong derivation makes vault creation/unlock
   deliberately slow; the parameters are not relaxed without an ADR.
