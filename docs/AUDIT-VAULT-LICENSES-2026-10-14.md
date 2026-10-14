# Audit — Vault and License Management (BookmarkForge)

Date: 2026-10-14 · Scope: vault (lifecycle/crypto/persistence) + licenses (client/server/enforcement) · Method: static reading + local gates · Deliverable: Markdown report

Gates executed (all green before adding this file):
- `check:pro-imports` OK — no Core static import of a Pro module outside `pro-access.ts` (54 files, 72 allowed references)
- `check:license-keys` OK — committed public key verifies fixture; server key matches client
- `check:pro-routes` OK — 11 routes classified, 16 dispatched, 0 entitlement-gated
- `check:open-core` OK — Pro policy registered (13 exact paths); private tree present
- `check:compose-config` OK — signing key mounted as Compose secret

## 1. Vault — verdict

The vault is well designed (fail-closed, zeroization, S9/H5 separation, per-vault salts). No encryption bypass or silent key regeneration found. Findings are hardening items, not breakage.

### 1.1 Verified strengths

- Explicit buffer ownership: `crypto-core.ts:412-434` (`zeroPasswordBytes` with double-fill + reuse warning), `SecurityVault.ts:1085-1122` (`withMasterPasswordBytes` hands out a copy and wipes it in `finally`, including async paths via `result.finally(wipe)`).
- `lock()` (`SecurityVault.ts:938-1009`) clears sensitive state synchronously (generation bump + `zeroBytes` + flags) before the async audit flush; the `unlock()` `catch` (`SecurityVault.ts:395-418`) tears down the device key on every activation failure.
- S9 separation: JWK in `localStorage bmf_device_key_jwk` vs ciphertexts in `IDB bookmarkforge_secure_vault/secrets` (`SecureStorage.ts:54-56,65`); H5 wrap never regenerates (`SecureStorage.ts:312-457`).
- `MutationGuard` (`services/security/MutationGuard.ts:85-162`): derives HMAC in a contiguous buffer, zeroizes it, checks `isLocked`, clears cache on `onLock/onUnlock`. Correct pattern.
- Wire formats: self-describing `v6:` with embedded salt (`crypto-core.ts:524-569`) — reads never depend on local state (ADR-046). Legacy `v5:` read path has a kill-switch (`crypto-core.ts:571-580`, ADR-052 Phase 3).

### 1.2 Vault findings

| ID | Sev | Finding | Evidence | Recommendation |
|----|-----|---------|----------|----------------|
| V-1 | Medium | `string` secret contracts on the hot path (unlock/rotate/wrap) cannot be zeroized; the code admits this as best-effort. | `SecurityVault.ts:238,262` (`unlock(password: string)`, `trimmedPassword`), `SecureStorage.ts:312,412` (`wrap/unwrap(password: string)`) | Migrate entry points to `Uint8Array` (`withMasterPasswordBytes` is the existing pattern); minimize `string` lifetime and avoid intermediate `trim()` copies duplicating heap. |
| V-2 | Medium | Inconsistent zeroization: `encrypt/decrypt/deriveDbKey` use plain `fill(0)`, not the double-fill + warning `zeroPasswordBytes`. Buffer reuse across two calls stays silent. | `crypto-core.ts:473,547,596,633,693` (`pwBytes.fill(0)`) vs `zeroPasswordBytes` at `412-434` | Unify on `zeroPasswordBytes` (logger sink on main thread, `console.warn` in worker). Only `decryptWithSessionKey:795-832` clones defensively for this bug — extend the pattern. |
| V-3 | Low | `lock()` clears the session cache fire-and-forget (`void encryptionService.clear()`, `SecurityVault.ts:993-997`). A stale worker could answer after replacement. | `SecurityVault.ts:991-997`, `EncryptionService.ts:602-622` (does reject pendings + terminate worker) | Partially mitigated (guards + pending rejection). Harden: `await` with a bounded timeout in `lock()` instead of `void`. |
| V-4 | Low | `ensureVaultKdfSalt` cannot tell "no salt yet" from "salt unreadable" (returns `null` = legacy mode for both); on persist failure it uses a memory-only salt → corpus over N salts + extra Argon2 per row. | `security-vault/kdf-salt.ts:93-130` | Distinguish the three states in the return + metric; document the cost as one extra derivation per payload (`v6` is self-describing, no access loss). |
| V-5 | Low | Throwing lock listeners are swallowed (`notifyLockListeners`, `SecurityVault.ts:1034-1042`). A cache failing to clear could stay alive. | `SecurityVault.ts:1034-1042` | `MutationGuard.sign` re-checks `isLocked` before using cache (`88-92`) — mitigated. Add a listener-failure counter for observability. |

No post-lock key resurrection confirmed: `EncryptionService.clear()` resets both caches and terminates the worker; the surviving `vaultKdfSalt` is salt only (not secret). Cross-tab `adopt` leaves `masterPasswordBytes` stale with a `warn` — accepted as a known low-exploitability risk (requires process access).

## 2. Licenses — verdict

Signing and verification are correct (RSA-PSS/SHA-256/salt 32, key-sorted canonical JSON, byte-compatible client↔server, pinned by contract tests). Private key stays out of the bundle (Compose secret, enforced by `validate-compose-config.mjs:45-46` and `validate-runtime-config.mjs:33`). However, **local-feature enforcement is client-side only by design** — the structural risk to accept or fix consciously.

### 2.1 Verified strengths

- The client only verifies (`licenseSigning.ts:112-131`), never signs; a modified bundle cannot forge Pro without the server-held private key.
- `persistVerified` (`LicenseService.ts:250-286`) rejects bad signatures or broken device binding + clears state + audits. Legacy/unsigned state is rejected (`196-207`).
- `getEntitlements` (`LicenseService.ts:478-523`): never grants with `signatureValid !== true`; offline grace requires a positively verified signature + honors signed `expiresAt`.
- Fail-closed server: `entitlement.ts` (deny reasons, `LICENSE_PROOF_MAX_AGE_MS = 30d` cap, 5m skew); `entitlement-guard.ts:152-165` answers 503 on invalid signing key so operator misconfig never downgrades payers.
- Online revocation works: `validateInBackground` (`LicenseService.ts:663-676`) with `INVALID → clearState`.

### 2.2 License findings

| ID | Sev | Finding | Evidence | Recommendation |
|----|-----|---------|----------|----------------|
| L-1 | High (by design) | Local-feature enforcement is client-side only: Backup/PDF/WebLLM/RAG run after local `hasProAccess()`. Patching `hasProAccess/loadProService` in the bundle = free Pro. Today `PAID_PATH_PREFIXES = []` (no server route gated). | `pro-access.ts:113-156`, `LicenseService.ts:526-529`, `server/src/route-table.ts:36` | Conscious decision: (a) accept — local Pro value is not server-extractable; the real gate is not downloading the chunk + honest placeholder; (b) if any Pro feature costs server money (inference, relay), declare it under a paid prefix + `access: entitlement` (the `check:pro-routes` gate already enforces it). Never leave a costly route unclassified. |
| L-2 | Medium | Cloning `bf_license_state + bf_device_id` (both copyable localStorage) duplicates Pro until `expiresAt`/30d. Binding is correct but not hardware-anchored. | `LicenseService.ts:147,209-211,281` | Accept for consumer licenses (5-activation cap bounds it: `constants/license.ts`); for stronger needs, bind `instanceId` server-side on each `validate` and shorten `expiresAt` for monthly plans. |
| L-3 | Medium | Indefinite grace with locked vault: without key (`getStoredLicenseKeyAsync → null`) `validateInBackground` returns `true` without revalidating (`LicenseService.ts:642-647`). A user who never unlocks SecureStorage never gets revoked. | `LicenseService.ts:635-647` | Bound it: if the key stays inaccessible beyond N days (or `cacheTtlMs` + margin), downgrade to Free until unlock; log `license_grace_vault_locked` for observability. |
| L-4 | Low | Revocation window 48h (client) – 30d (server) + manipulable local clock extends grace until `expiresAt`. | `constants/license.ts:cacheTtlMs 48h`, `entitlement.ts:28` (30d), `LicenseService.ts:460,506-507` (`Date.now()`) | Call `/entitlement` on every online boot (not only after TTL) and prefer monotonic/server time when online; document the window as accepted. |
| L-5 | Low | Two public-key copies (`licenseKeys.ts` vs `server/license-public-key.ts`) + server `publicKeySpki` override + `VITE_LICENSE_SIGNING_URL` pointable at a rogue signer. | `licenseKeys.ts:14-25`, `entitlement.ts:101-106`, `networkFirewall.ts:60-62` | The `--check` gate already covers drift (green today). Harden: pin `VITE_LICENSE_SIGNING_URL` to same-origin/https in prod + test failing on http override in prod builds. Verify the `Dockerfile` has no broad `COPY server/` dragging `.license-signing-key.pkcs8` (gitignored). |

Note: the "empty allowlist" from the earlier analysis is `scripts/context-boundaries.allowlist.json` (layer gate, must stay empty) — not a license bypass.

## 3. Prioritized recommendations

1. **Decide L-1 in writing (ADR or runbook):** which Pro is a "client honor gate" vs which future route requires server proof. Classify any costly route as paid from the first PR (`check:pro-routes` enforces it).
2. **Bound locked-vault grace (L-3)** + observability log. Smallest change with the largest anti-revocation-evasion effect.
3. **Unify zeroization (V-2)** on `zeroPasswordBytes` + migrate `string` entry points to bytes (V-1), starting with `unlock`/`wrap/unwrap`.
4. **`await` with timeout in `lock()` (V-3)** instead of `void clear()`.
5. **Signing-URL pin + Dockerfile check (L-5)** and `/entitlement` call on online boot (L-4).

## 4. Scope and limits

- No E2E, fuzzing, DAST/ZAP, or timing tests executed; dynamic gates from AGENTS.md are out of this pass.
- The Whop provider (network, credentials, webhooks) was not reviewed beyond the server-side adapter.
- The materialized public export (`export-public-repo.mjs` dry mode) was not audited; only the registered policy.
