/**
 * src/services/security-vault/secrets.ts
 *
 * Secret CRUD operations for the master-password vault.
 * Extracted from SecurityVault.ts (refactor, no behavior change).
 * SecurityVault delegates to these functions via buildSecretsContext().
 */

import { encryptionService } from "../EncryptionService";
import { zeroPasswordBytes } from "../../utils/crypto-core";
import { SECURE_STORAGE_KEYS } from "./constants";

export interface SecretsContext {
  getMasterPasswordBytes: () => Uint8Array | null;
  assertUnlocked: (key: string, action: "encrypt" | "decrypt") => void;
  recordAudit: (params: Record<string, unknown>) => void;
  hasMasterPassword: () => Promise<boolean>;
  setMasterPasswordConfiguredFlag: () => Promise<void>;
  getSecret: (key: string) => Promise<string | null>;
  setSecret: (key: string, value: string) => Promise<void>;
  deleteSecret: (key: string) => Promise<void>;
  getRecoveryData: () => Promise<string | null>;
  setRecoveryData: (data: string) => Promise<void>;
  clearRecoveryData: () => Promise<void>;
  hasRecoveryData: () => Promise<boolean>;
  migrateFromLocalStorage: (from: string, to: string) => Promise<void>;
}

/**
 * Encrypts a secret string and stores it in IndexedDB.
 */
export async function encryptSecret(
  secret: string,
  key: string,
  ctx: SecretsContext,
): Promise<string> {
  ctx.assertUnlocked(key, "encrypt");
  const pwCopy = new Uint8Array(ctx.getMasterPasswordBytes()!);
  try {
    const encrypted = await encryptionService.encryptWithBytes(secret, pwCopy);
    await ctx.setSecret(key, encrypted);
    ctx.recordAudit({ action: "secret_encrypt", target: key, result: "success", origin: "SecurityVault" });
    return encrypted;
  } finally {
    zeroPasswordBytes(pwCopy);
  }
}

/**
 * Decrypts a secret from IndexedDB.
 */
export async function decryptSecret(
  key: string,
  ctx: SecretsContext,
): Promise<string> {
  ctx.assertUnlocked(key, "decrypt");
  const encryptedSecret = await ctx.getSecret(key);
  if (!encryptedSecret) {
    ctx.recordAudit({ action: "secret_decrypt", target: key, result: "failure", origin: "SecurityVault", context: { reason: "Secret not found" } });
    throw new Error("Secret not found");
  }
  const pwCopy = new Uint8Array(ctx.getMasterPasswordBytes()!);
  try {
    const result = await encryptionService.decryptWithBytes(encryptedSecret, pwCopy);
    ctx.recordAudit({ action: "secret_decrypt", target: key, result: "success", origin: "SecurityVault" });
    return result;
  } finally {
    zeroPasswordBytes(pwCopy);
  }
}

/**
 * Deletes a secret from IndexedDB.
 */
export async function deleteSecret(key: string, ctx: SecretsContext): Promise<void> {
  await ctx.deleteSecret(key);
  ctx.recordAudit({ action: "secret_delete", target: key, result: "success", origin: "SecurityVault" });
}

/**
 * Returns whether a secret exists for the given key.
 */
export async function hasSecret(key: string, ctx: SecretsContext): Promise<boolean> {
  const result = await ctx.getSecret(key);
  return result !== null;
}

/**
 * Returns whether the master password has been configured.
 */
export async function hasMasterPassword(ctx: SecretsContext): Promise<boolean> {
  if (typeof window === "undefined") {return false;}
  if (await ctx.hasMasterPassword()) {return true;}
  return false;
}

/**
 * Persists the master-password-configured flag to both SecureStorage and localStorage.
 */
export async function setMasterPasswordFlag(ctx: SecretsContext): Promise<void> {
  await ctx.setMasterPasswordConfiguredFlag();
}

/**
 * Stores encrypted recovery data.
 */
export async function setRecoveryData(encryptedData: string, ctx: SecretsContext): Promise<void> {
  await ctx.setRecoveryData(encryptedData);
}

/**
 * Returns the stored recovery data.
 */
export async function getRecoveryData(ctx: SecretsContext): Promise<string | null> {
  return await ctx.getRecoveryData();
}

/**
 * Returns true if recovery data has been stored.
 */
export async function hasRecoveryData(ctx: SecretsContext): Promise<boolean> {
  return await ctx.hasRecoveryData();
}

/**
 * Deletes all stored recovery data.
 */
export async function clearRecoveryData(ctx: SecretsContext): Promise<void> {
  await ctx.clearRecoveryData();
}

/**
 * Migrates legacy recovery/API-key data from localStorage to IndexedDB.
 */
export async function migrateFromLocalStorage(ctx: SecretsContext): Promise<void> {
  await ctx.migrateFromLocalStorage("recovery_data", SECURE_STORAGE_KEYS.RECOVERY_DATA);
  await ctx.migrateFromLocalStorage("encrypted_api_key", SECURE_STORAGE_KEYS.API_KEY);
}