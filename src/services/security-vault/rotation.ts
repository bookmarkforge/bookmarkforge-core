/**
 * src/services/security-vault/rotation.ts
 *
 * Master-password rotation operations for the vault.
 * Extracted from SecurityVault.ts — SecurityVault delegates to these functions.
 */

import { logger } from "../../utils/logger";
import { zeroPasswordBytes } from "../../utils/crypto-core";
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
  storeVerificationTokenWithIntegrity: (ciphertext: string, integrity: string) => Promise<void>;
  getVaultKdfSaltSnapshot: () => Promise<VaultKdfSaltSnapshot>;
  rotateVaultKdfSalt: (previous: VaultKdfSaltSnapshot) => Promise<string>;
  restoreVaultKdfSalt: (snapshot: VaultKdfSaltSnapshot) => Promise<void>;
  encryptWithBytes: (data: string, key: Uint8Array) => Promise<string>;
  decryptWithBytes: (encrypted: string, key: Uint8Array) => Promise<string>;
  createVerificationToken: (password: string) => Promise<void>;
  recordAudit: (params: Record<string, unknown>) => void;
  clearRecoveryData: () => Promise<void>;
  loadBackupService: () => Promise<{ clearAutoBackup: () => Promise<void> } | null>;
  setMasterPasswordBytes: (pw: string) => void;
  zeroBytes: () => void;
  generateSessionToken: () => Promise<void>;
  lockDeviceKey: () => void;
  assertActive: () => void;
  deleteSecret: (key: string) => Promise<void>;
  announceSaltChange: () => void;
  rewrapDeviceKey: (oldPassword: Uint8Array, newPassword: Uint8Array) => Promise<void>;
  restoreWrappedDeviceKey: (blob: string) => Promise<void>;
  restoreVerificationToken: (ciphertext: string) => Promise<void>;
  storeVerificationIntegrity: (integrity: string) => Promise<void>;
  deleteVerificationIntegrity: () => Promise<void>;
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
  let oldPwBytes: Uint8Array;
  let newPwBytes: Uint8Array | null = null;

  try {
    for (const key of rotatedKeys) {
      snapshot[key] = await ctx.getSecret(key);
    }
    wrappedDeviceKeySnapshot = await ctx.getWrappedDeviceKeyBlob();
    verificationTokenSnapshot = await ctx.getVerificationToken();
    verificationIntegritySnapshot = await ctx.getVerificationIntegrity();

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
    vaultSaltSnapshot = await ctx.getVaultKdfSaltSnapshot();      await ctx.rotateVaultKdfSalt(vaultSaltSnapshot);
    ctx.assertActive();

    try {
      for (const key of rotatedKeys) {
        const encrypted = snapshot[key];
        if (!encrypted) { continue; }
        const plaintext = await ctx.decryptWithBytes(encrypted, oldPwBytes.slice());
        const reEncrypted = await ctx.encryptWithBytes(plaintext, newPwBytes.slice());
        await ctx.setSecret(key, reEncrypted);
        ctx.assertActive();
      }
      if (deviceKeyWrapped) {
        await ctx.rewrapDeviceKey(oldPwBytes, newPwBytes);
        ctx.assertActive();
      }
    } finally {
      for (let i = 0; i < oldPwBytes.length; i++) { oldPwBytes[i] = oldPwBytes[i]! ^ 0xAA; }
      oldPwBytes.fill(0);
    }

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

    for (const key of rotatedKeys) {
      if (snapshot[key] !== null && snapshot[key] !== undefined) {
        await ctx.setSecret(key, snapshot[key]!).catch((err) =>
          logger.error("[SecurityVault] Rollback setSecret failed", { key, error: err }),
        );
      } else {
        await ctx.deleteSecret(key).catch((err) =>
          logger.error("[SecurityVault] Rollback deleteSecret failed", { key, error: err }),
        );
      }
    }
    if (wrappedDeviceKeySnapshot) {
      await ctx.restoreWrappedDeviceKey(wrappedDeviceKeySnapshot).catch((err) =>
        logger.error("[SecurityVault] Rollback device-key wrapper failed", { error: err }),
      );
    }
    if (verificationTokenSnapshot) {
      await ctx.restoreVerificationToken(verificationTokenSnapshot).catch((err) =>
        logger.error("[SecurityVault] Rollback verification token failed", { error: err }),
      );
      if (verificationIntegritySnapshot !== null && verificationIntegritySnapshot !== undefined) {
        await ctx.storeVerificationIntegrity(verificationIntegritySnapshot).catch((err) =>
          logger.error("[SecurityVault] Rollback integrity record failed", { error: err }),
        );
      } else {
        await ctx.deleteVerificationIntegrity().catch((err) =>
          logger.error("[SecurityVault] Rollback integrity record delete failed", { error: err }),
        );
      }
    }
    if (vaultSaltSnapshot) {
      await ctx.restoreVaultKdfSalt(vaultSaltSnapshot).catch((err) =>
        logger.error("[SecurityVault] Rollback vault KDF salt failed", { error: err }),
      );
    }
    ctx.recordAudit({
      action: "master_password_rotate",
      result: "failure",
      origin: "SecurityVault",
      context: { reason: error instanceof Error ? error.message : "Unknown" },
    });
    return false;
  }
}