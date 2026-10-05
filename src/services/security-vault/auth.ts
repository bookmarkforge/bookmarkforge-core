/**
 * src/services/security-vault/auth.ts
 *
 * Auth/identity operations for the master-password vault.
 * Extracted from SecurityVault.ts (refactor, no behavior change).
 * SecurityVault delegates to these functions via buildAuthContext().
 */

import { encryptionService } from "../EncryptionService";
import { secureStorage } from "../SecureStorage";
import { logger } from "../../utils/logger";
import { zeroPasswordBytes } from "../../utils/crypto-core";
import { useRateLimitStore } from "../../store/rateLimitStore";
import { SECURITY_CONFIG } from "../../constants/config";
import { SECURE_STORAGE_KEYS, VERIFICATION_PLAINTEXT } from "./constants";
import { constantTimeCompare } from "./compare";
import { createVerificationToken, validateVerificationIntegrity } from "./integrity";
import { deriveShareCredential, parseShareSalt } from "./share";

// ── Context type ──

/** Minimal context that auth operations need from SecurityVault. */
export interface AuthContext {
  getMasterPasswordBytes: () => Uint8Array | null;
  clearShareCredential: () => void;
  setMasterPasswordBytes: (pw: string) => void;
  zeroBytes: () => void;
  recordFailedAttempt: () => void;
  recordAudit: (params: Record<string, unknown>) => void;
  generateSessionToken: () => Promise<void>;
  startSessionRotation: () => void;
  stopSessionRotation: () => void;
  notifyLockListeners: () => void;
  notifyUnlockListeners: () => void;
  installVaultKdfSalt: () => Promise<string | null>;
  migrateVaultToPerVaultSalt: (password: string) => Promise<void>;
  verifyAuditIntegrityAfterUnlock: () => void;
  unlockDeviceKeyStep: (password: string) => Promise<boolean>;
  hasAnyVaultState: (emptyLocalDatabase?: boolean) => Promise<boolean>;
  hasMasterPassword: () => Promise<boolean>;
  wrapDeviceKeyWithPassword: (password: string) => Promise<void>;
  setMasterPasswordConfiguredFlag: () => Promise<void>;
  getSessionToken: () => string | null;
  clearSession: () => void;
  getRateLimitState: () => { unlockAttempts: number; lockoutUntil: number };
  flushPendingAudit: () => Promise<void>;
  clearEncryptionSession: () => Promise<void>;
  getWrappedDeviceKeyBlob: () => Promise<string | null>;
  unwrapDeviceKeyWithPassword: (password: string) => Promise<void>;
  ensureDeviceKeyMaterialized: () => Promise<void>;
  isDeviceKeyMaterialized: () => Promise<boolean>;
  lockDeviceKey: () => void;
}

/**
 * Verifies a password against the stored verification token.
 * When no token exists:
 *   - If a master password is already configured → reject (tampering)
 *   - On first run (no flag) → accept for the registration flow
 */
export async function verifyPassword(
  password: string,
  ctx: AuthContext,
): Promise<boolean> {
  const stored = await secureStorage.getVerificationToken();
  if (!stored) {
    const hasState = await ctx.hasAnyVaultState();
    if (hasState) {
      logger.error(
        "[SecurityVault] Verification token missing but vault state exists — rejecting (possible tampering)",
      );
      ctx.recordAudit({
        action: "vault_unlock_failed",
        result: "failure",
        origin: "SecurityVault",
        context: { reason: "Verification token missing while vault state exists (tampering detected)" },
      });
      return false;
    }
    return true;
  }

  const passwordBytes = new TextEncoder().encode(password);
  try {
    const integrityOk = await validateVerificationIntegrity(stored, passwordBytes);
    if (!integrityOk) {
      logger.warn("[SecurityVault] Verification integrity check failed — rejecting");
      return false;
    }
    const decrypted = await encryptionService.decryptWithBytes(stored, passwordBytes);
    return constantTimeCompare(decrypted, VERIFICATION_PLAINTEXT);
  } catch (error) {
    logger.warn("[SecurityVault] Password verification failed", { error });
    return false;
  } finally {
    zeroPasswordBytes(passwordBytes);
  }
}

/**
 * Rate-limited password verification (RL-1).
 */
export async function verifyPasswordRateLimited(
  password: string,
  ctx: AuthContext,
): Promise<boolean> {
  if (typeof password !== "string" || !password.trim()) {
    ctx.recordFailedAttempt();
    return false;
  }
  if (password.trim().length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH) {
    ctx.recordFailedAttempt();
    return false;
  }
  const rl = useRateLimitStore.getState();
  if (Date.now() < rl.lockoutUntil) {
    const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
    logger.warn("[SecurityVault] verifyPassword rate limited", { remainingSeconds: remaining });
    return false;
  }
  const valid = await verifyPassword(password, ctx);
  if (!valid) { ctx.recordFailedAttempt(); return false; }
  useRateLimitStore.getState().resetAttempts();
  return true;
}

/**
 * Rate-limited share-payload decrypt gate (RL-2).
 */
export async function decryptShareWithRateLimit(
  encryptedKey: string,
  sharePassword: string,
  ctx: AuthContext,
): Promise<string | null> {
  const rl = useRateLimitStore.getState();
  if (Date.now() < rl.lockoutUntil) {
    const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
    logger.warn("[SecurityVault] decryptShare rate limited", { remainingSeconds: remaining });
    return null;
  }
  try {
    return await encryptionService.decrypt(encryptedKey, sharePassword);
  } catch (error) {
    ctx.recordFailedAttempt();
    logger.warn("[SecurityVault] Share password decrypt failed", { error });
    return null;
  }
}

/**
 * Unlocks a vault from an authenticated share payload.
 */
export async function unlockFromShare(
  shareSecret: string,
  saltJson: string,
  ctx: AuthContext,
  options: { allowFreshDevice?: boolean; emptyLocalDatabase?: boolean } = {},
): Promise<boolean> {
  const rl = useRateLimitStore.getState();
  if (Date.now() < rl.lockoutUntil) {
    const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
    logger.warn("[SecurityVault] unlockFromShare rate limited", { remainingSeconds: remaining });
    return false;
  }

  if (!/^[0-9a-f]{64}$/i.test(shareSecret)) {
    ctx.recordFailedAttempt();
    return false;
  }

  const allowFreshDevice = options.allowFreshDevice === true;
  const salt = parseShareSalt(saltJson, allowFreshDevice ? 16 : 1);
  if (!salt) { ctx.recordFailedAttempt(); return false; }

  const emptyLocalDatabase = options.emptyLocalDatabase === true;
  const existingVault = await ctx.hasAnyVaultState(emptyLocalDatabase);

  try {
    if (existingVault) {
      const mpBytes = ctx.getMasterPasswordBytes();
      if (!mpBytes) { ctx.recordFailedAttempt(); return false; }
      const pwSlice = new Uint8Array(mpBytes);
      const baseKey = await crypto.subtle.importKey(
        "raw", pwSlice, { name: "HKDF" }, false, ["deriveBits"],
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "HKDF", salt: salt as Uint8Array<ArrayBuffer>, info: new TextEncoder().encode("bookmarkforge-share"), hash: "SHA-256" },
        baseKey, 256,
      );
      const expected = Array.from(new Uint8Array(derivedBits), (b) => b.toString(16).padStart(2, "0")).join("");
      if (!constantTimeCompare(expected, shareSecret)) { ctx.recordFailedAttempt(); return false; }
    } else if (allowFreshDevice && emptyLocalDatabase) {
      const _derivedCredential = await deriveShareCredential(shareSecret, salt);
      ctx.clearShareCredential();
      ctx.setMasterPasswordBytes("");
    } else {
      ctx.recordFailedAttempt();
      return false;
    }
  } catch (_error) {
    ctx.recordFailedAttempt();
    return false;
  }

  try {
    useRateLimitStore.getState().resetAttempts();
    ctx.recordAudit({ action: "vault_unlock_from_share", result: "success", origin: "SecurityVault" });
    await ctx.generateSessionToken();
    ctx.startSessionRotation();
    ctx.notifyUnlockListeners();
    return true;
  } catch (_error) {
    ctx.clearShareCredential();
    ctx.clearSession();
    ctx.stopSessionRotation();
    return false;
  }
}

/**
 * Performs the device-key unlock step. Returns true on success.
 */
export async function unlockDeviceKeyStep(ctx: AuthContext, password: string): Promise<boolean> {
  try {
    const wrappedBlob = await ctx.getWrappedDeviceKeyBlob();
    if (wrappedBlob !== null) {
      await ctx.unwrapDeviceKeyWithPassword(password);
      logger.info("[SecurityVault] Device key unwrapped (master-password wrapped)");
    } else {
      await ctx.ensureDeviceKeyMaterialized();
    }
    if (wrappedBlob !== null && !(await ctx.isDeviceKeyMaterialized())) {
      logger.error("[SecurityVault] Device key not materialized after unwrap — failing closed");
      return false;
    }
    return true;
  } catch (error) {
    logger.error("[SecurityVault] Failed to materialize device key", { error });
    ctx.recordFailedAttempt();
    return false;
  }
}

/**
 * A-1: install the per-vault Argon2id salt and migrate legacy secrets.
 * Returns the installed salt (32 hex) or null when unavailable.
 */
export async function installVaultKdfSaltAndMigrate(ctx: AuthContext, password: string): Promise<string | null> {
  const vaultKdfSaltHex = await ctx.installVaultKdfSalt();
  if (vaultKdfSaltHex) {
    await ctx.migrateVaultToPerVaultSalt(password);
  }
  return vaultKdfSaltHex;
}

/**
 * Performs the full unlock sequence. Returns true on success.
 */
export async function performUnlock(password: string, ctx: AuthContext): Promise<boolean> {
  if (ctx.getRateLimitState().lockoutUntil > Date.now()) {
    const remaining = Math.ceil((ctx.getRateLimitState().lockoutUntil - Date.now()) / 1000);
    logger.warn("[SecurityVault] Rate limited during unlock", { remainingSeconds: remaining });
    return false;
  }

  const passwordValid = await verifyPassword(password, ctx);
  if (!passwordValid) {
    ctx.recordFailedAttempt();
    logger.warn("[SecurityVault] Invalid password rejected");
    ctx.recordAudit({ action: "vault_unlock_failed", result: "failure", origin: "SecurityVault", context: { reason: "Invalid password" } });
    return false;
  }

  const masterPasswordSet = await ctx.hasMasterPassword();
  const deviceKeyReady = await unlockDeviceKeyStep(ctx, password);
  if (!deviceKeyReady) {
    ctx.recordFailedAttempt();
    logger.error("[SecurityVault] Device key unavailable after password verification — vault locked closed");
    ctx.recordAudit({ action: "vault_unlock_failed", result: "failure", origin: "SecurityVault", context: { reason: "Device key unwrap failed" } });
    return false;
  }

  const _vaultKdfSaltHex = await installVaultKdfSaltAndMigrate(ctx, password);

  const hasToken = await secureStorage.hasSecret(SECURE_STORAGE_KEYS.VERIFICATION);
  if (!hasToken) {
    // Static import (unified): the module is already in the static chain via
    // SecurityVault.ts, so the former dynamic import here never produced a
    // real chunk split — Rollup emitted INEFFECTIVE_DYNAMIC_IMPORT instead.
    await createVerificationToken(password);
  }

  try {
    if (!masterPasswordSet && !hasToken) {
      await ctx.wrapDeviceKeyWithPassword(password);
    } else if (!masterPasswordSet) {
      await ctx.setMasterPasswordConfiguredFlag();
      logger.info("[SecurityVault] Master-password flag restored on existing vault (no re-wrap)");
    }

    ctx.clearShareCredential();
    ctx.setMasterPasswordBytes(password);
    await ctx.generateSessionToken();
    ctx.startSessionRotation();
    useRateLimitStore.getState().resetAttempts();
    ctx.recordAudit({ action: "vault_unlock", result: "success", origin: "SecurityVault" });
    ctx.notifyUnlockListeners();
    return true;
  } catch (error) {
    ctx.zeroBytes();
    ctx.recordFailedAttempt();
    logger.error("[SecurityVault] Failed to process password", { error });
    ctx.recordAudit({ action: "vault_unlock_failed", result: "failure", origin: "SecurityVault", context: { reason: "Decryption or process failure" } });
    return false;
  } finally {
    ctx.verifyAuditIntegrityAfterUnlock();
  }
}

/**
 * Performs the full lock sequence.
 */
export async function performLock(ctx: AuthContext): Promise<void> {
  ctx.recordAudit({ action: "vault_lock", result: "success", origin: "SecurityVault" });
  ctx.zeroBytes();
  ctx.clearShareCredential();
  ctx.clearSession();
  ctx.stopSessionRotation();
  ctx.notifyLockListeners();

  const finalize = (async () => {
    try {
      ctx.lockDeviceKey();
      await ctx.flushPendingAudit();
    } catch (error) {
      logger.warn("[SecurityVault] Failed to flush lock audit", { error });
    } finally {
      await ctx.clearEncryptionSession();
    }
  })();

  try {
    await finalize;
  } finally {
    ctx.clearSession();
  }
}