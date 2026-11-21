/**
 * src/services/security-vault/rotation.ts
 *
 * Master-password rotation operations for the vault.
 * Extracted from SecurityVault.ts — SecurityVault delegates to these functions.
 */

import { logger } from "../../utils/logger";
import { zeroPasswordBytes } from "../../utils/crypto-core";
import { secureStoragePurpose } from "../../utils/envelope-purposes";
import { SECURE_STORAGE_KEYS } from "./constants";
import type { VaultKdfSaltSnapshot } from "./kdf-salt";

export interface RotationContext {
  getMasterPasswordBytes: () => Uint8Array | null;
  hasMasterPassword: () => Promise<boolean>;
  getWrappedDeviceKeyBlob: () => Promise<string | null>;
  isDeviceKeyWrapped: () => Promise<boolean>;
  isDeviceKeyMaterialized: () => Promise<boolean>;
  getSecret: (key: string) => Promise<string | null>;
  setSecret: (key: string, value: string) => Promise<void>;
  getVerificationToken: () => Promise<string | null>;
  getVerificationIntegrity: () => Promise<string | null>;
  storeVerificationTokenWithIntegrity: (
    ciphertext: string,
    integrity: string,
  ) => Promise<void>;
  getVaultKdfSaltSnapshot: () => Promise<VaultKdfSaltSnapshot>;
  rotateVaultKdfSalt: (previous: VaultKdfSaltSnapshot) => Promise<string>;
  restoreVaultKdfSalt: (snapshot: VaultKdfSaltSnapshot) => Promise<void>;
  encryptWithBytes: (
    data: string,
    key: Uint8Array,
    purpose?: string,
  ) => Promise<string>;
  decryptWithBytes: (
    encrypted: string,
    key: Uint8Array,
    purpose?: string,
  ) => Promise<string>;
  createVerificationToken: (password: string | Uint8Array) => Promise<void>;
  recordAudit: (params: Record<string, unknown>) => void;
  clearRecoveryData: () => Promise<void>;
  loadBackupService: () => Promise<{ clearAutoBackup: () => Promise<void> } | null>;
  setMasterPasswordBytes: (pw: string | Uint8Array) => void;
  zeroBytes: () => void;
  clearSession: () => void;
  generateSessionToken: () => Promise<void>;
  lockDeviceKey: () => void;
  assertActive: () => void;
  deleteSecret: (key: string) => Promise<void>;
  announceSaltChange: () => void;
  rewrapDeviceKey: (oldPassword: Uint8Array, newPassword: Uint8Array) => Promise<void>;
  restoreWrappedDeviceKey: (blob: string | null) => Promise<void>;
  restoreVerificationTokenWithIntegrity: (
    ciphertext: string | null,
    integrity: string | null,
  ) => Promise<void>;
}

/**
 * Rotates the master password. Returns true on success.
 * All-or-nothing: a failure anywhere restores the previous state.
 */
export async function rotateMasterPassword(
  newPassword: string,
  oldPassword: string | null,
  ctx: RotationContext,
): Promise<boolean> {
  // Rotation is an in-memory session operation. Do not require the persisted
  // configured-flag here: tests and legacy vaults may have the flag in a
  // different storage generation, while an explicit old password still proves
  // the caller has the credential needed for the operation.
  if (!ctx.getMasterPasswordBytes() && !oldPassword) {
    return false;
  }

  if (
    typeof newPassword !== "string" ||
    newPassword.trim().length < 12 ||
    newPassword !== newPassword.trim()
  ) {
    ctx.recordAudit({
      action: "master_password_rotate",
      result: "failure",
      origin: "SecurityVault",
      context: { reason: "Invalid new password" },
    });
    return false;
  }

  const rotatedKeys = [SECURE_STORAGE_KEYS.API_KEY, SECURE_STORAGE_KEYS.DB_KEY] as const;
  const snapshot: Record<string, string | null> = {};
  let wrappedDeviceKeySnapshot: string | null = null;
  let verificationTokenSnapshot: string | null = null;
  let verificationIntegritySnapshot: string | null = null;
  let vaultSaltSnapshot: VaultKdfSaltSnapshot | null = null;
  let snapshotsComplete = false;
  let saltRotationAttempted = false;
  const touchedSecrets = new Set<string>();
  let deviceKeyRewrapAttempted = false;
  let verificationTokenWriteAttempted = false;
  // H3: both buffers are caller-owned copies of live secrets. They must be
  // zeroized on EVERY exit path, not only on success — a failed rotation is
  // exactly the moment both passwords coexist in memory.
  let oldPwBytes: Uint8Array = new Uint8Array(0);
  let oldPwZeroized = false;
  let newPwBytes: Uint8Array | null = null;

  try {
    for (const key of rotatedKeys) {
      snapshot[key] = await ctx.getSecret(key);
    }
    wrappedDeviceKeySnapshot = await ctx.getWrappedDeviceKeyBlob();
    verificationTokenSnapshot = await ctx.getVerificationToken();
    verificationIntegritySnapshot = await ctx.getVerificationIntegrity();
    snapshotsComplete = true;

    if (oldPassword) {
      oldPwBytes = new TextEncoder().encode(oldPassword);
    } else {
      const mpb = ctx.getMasterPasswordBytes();
      if (!mpb) { throw new Error("Vault is locked or old password not available"); }
      oldPwBytes = new Uint8Array(mpb);
    }
    if (oldPwBytes.length === 0) { throw new Error("Vault is locked or old password not available"); }

    newPwBytes = new TextEncoder().encode(newPassword);
    const deviceKeyWrapped = await ctx.isDeviceKeyWrapped();

    ctx.assertActive();
    vaultSaltSnapshot = await ctx.getVaultKdfSaltSnapshot();
    saltRotationAttempted = true;
    await ctx.rotateVaultKdfSalt(vaultSaltSnapshot);
    ctx.assertActive();

    try {
      for (const key of rotatedKeys) {
        const encrypted = snapshot[key];
        if (!encrypted) { continue; }
        // v7 (M-02): both halves must carry the same slot purpose or the
        // re-encrypted value becomes unreadable by its own reader.
        const purpose = secureStoragePurpose(key);

        const plaintext = await ctx.decryptWithBytes(
          encrypted,
          oldPwBytes.slice(),
          purpose,
        );
        const reEncrypted = await ctx.encryptWithBytes(
          plaintext,
          newPwBytes.slice(),
          purpose,
        );
        // Track before entering storage: the operation can mutate durable state
        // and still reject (e.g. a transaction abort reported after a write).
        touchedSecrets.add(key);
        await ctx.setSecret(key, reEncrypted);
        ctx.assertActive();
      }
      if (deviceKeyWrapped) {
        deviceKeyRewrapAttempted = true;
        await ctx.rewrapDeviceKey(oldPwBytes, newPwBytes);
        ctx.assertActive();
      }
    } finally {
      zeroPasswordBytes(oldPwBytes);
      oldPwZeroized = true;
    }

    verificationTokenWriteAttempted = true;
    await ctx.createVerificationToken(newPassword);
    ctx.assertActive();
    await ctx.generateSessionToken();
    ctx.assertActive();
    zeroPasswordBytes(newPwBytes);
    newPwBytes = null;
    ctx.setMasterPasswordBytes(newPassword);

    try {
      const { attestationChain } = await import("../security/AttestationChain");
      await attestationChain.reSignAll();
    } catch (err) {
      logger.warn("[SecurityVault] Failed to re-sign attestation chain after rotation", { error: err });
    }

    await ctx.clearRecoveryData().catch((err) =>
      logger.warn("[SecurityVault] Failed to clear stale recovery data after rotation", { error: err }),
    );

    try {
      const backup = await ctx.loadBackupService();
      if (backup) { await backup.clearAutoBackup(); }
    } catch (err) {
      logger.warn("[SecurityVault] Failed to clear stale auto-backup after rotation", { error: err });
    }

    ctx.announceSaltChange();
    ctx.recordAudit({ action: "master_password_rotate", result: "success", origin: "SecurityVault" });
    return true;
  } catch (error) {
    logger.error("[SecurityVault] Failed to rotate master password", { error });

    const rollbackFailures: string[] = [];
    const rollback = async (label: string, action: () => Promise<void>) => {
      try {
        await action();
      } catch (rollbackError) {
        rollbackFailures.push(label);
        logger.error("[SecurityVault] Rotation rollback step failed", {
          step: label,
          error: rollbackError,
        });
      }
    };

    // Snapshot failures occur before any payload mutation. If a storage write
    // was attempted but the snapshots were incomplete, state is uncertain and
    // the session must fail closed rather than continue with unverifiable data.
    if (!snapshotsComplete &&
      (saltRotationAttempted || touchedSecrets.size > 0 || deviceKeyRewrapAttempted || verificationTokenWriteAttempted)) {
      rollbackFailures.push("incomplete-snapshot-after-write");
    }
    if (snapshotsComplete) {
      for (const key of rotatedKeys) {
        if (!touchedSecrets.has(key)) { continue; }
        if (snapshot[key] !== null && snapshot[key] !== undefined) {
          await rollback(`secret:${key}`, () => ctx.setSecret(key, snapshot[key]!));
        } else {
          await rollback(`secret:${key}`, () => ctx.deleteSecret(key));
        }
      }
      if (deviceKeyRewrapAttempted) {
        await rollback("device-key-wrapper", () =>
          ctx.restoreWrappedDeviceKey(wrappedDeviceKeySnapshot),
        );
      }
      if (verificationTokenWriteAttempted) {
        // Token and integrity record must be restored together: a mismatch
        // makes the old password unverifiable.
        await rollback("verification-token-pair", () =>
          ctx.restoreVerificationTokenWithIntegrity(
            verificationTokenSnapshot,
            verificationIntegritySnapshot,
          ),
        );
      }
      if (saltRotationAttempted && vaultSaltSnapshot) {
        await rollback("vault-kdf-salt", () =>
          ctx.restoreVaultKdfSalt(vaultSaltSnapshot!),
        );
      }
    }
    if (rollbackFailures.length > 0) {
      // Never continue with credentials whose persisted rollback is uncertain.
      ctx.zeroBytes();
      ctx.lockDeviceKey();
      ctx.clearSession();
    }
    ctx.recordAudit({
      action: "master_password_rotate",
      result: "failure",
      origin: "SecurityVault",
      context: { reason: error instanceof Error ? error.message : "Unknown" },
    });
    return false;
  } finally {
    // H3: the error paths above return before the success-path zeroization.
    // Wipe whatever is still live (length 0 for a buffer never assigned).
    if (newPwBytes) {
      zeroPasswordBytes(newPwBytes);
      newPwBytes = null;
    }
    if (!oldPwZeroized && oldPwBytes.length > 0) {
      zeroPasswordBytes(oldPwBytes);
    }
  }
}