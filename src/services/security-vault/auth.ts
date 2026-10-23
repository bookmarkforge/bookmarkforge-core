/**
 * src/services/security-vault/auth.ts
 *
 * Password and device-key primitives used by SecurityVault.
 *
 * H2 (2026-10-20 audit): this module used to export a second, complete copy of
 * the unlock/lock sequence (`performUnlock`, `performLock`, `unlockFromShare`,
 * `verifyPasswordRateLimited`, `decryptShareWithRateLimit`,
 * `installVaultKdfSaltAndMigrate`) plus an `AuthContext` shaped for it. None of
 * those were imported: SecurityVault keeps its own implementations, and only
 * `verifyPassword` and `unlockDeviceKeyStep` are used. Keeping the duplicate
 * was a hazard rather than dead weight — the unused `unlockFromShare` branch
 * did `setMasterPasswordBytes("")`, i.e. it would report the vault unlocked
 * with an empty master password. Removing it leaves exactly one source of
 * truth for the unlock sequence.
 */

import { encryptionService } from "../EncryptionService";
import { secureStorage } from "../SecureStorage";
import { logger } from "../../utils/logger";
import { zeroPasswordBytes } from "../../utils/crypto-core";
import { VERIFICATION_PLAINTEXT } from "./constants";
import { constantTimeCompare } from "./compare";
import { validateVerificationIntegrity } from "./integrity";

// ── Context type ──

/** Minimal context that the operations below need from SecurityVault. */
export interface AuthContext {
  hasAnyVaultState: (emptyLocalDatabase?: boolean) => Promise<boolean>;
  recordAudit: (params: Record<string, unknown>) => void;
  recordFailedAttempt: () => void;
  getWrappedDeviceKeyBlob: () => Promise<string | null>;
  unwrapDeviceKeyWithPassword: (password: string) => Promise<void>;
  ensureDeviceKeyMaterialized: () => Promise<void>;
  isDeviceKeyMaterialized: () => Promise<boolean>;
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
    // P-06: validateVerificationIntegrity only imports the bytes (it does not
    // consume them); decryptWithBytes DOES consume its buffer per the
    // crypto-core ownership contract. Hand it a fresh copy so the finally
    // below wipes exactly one still-intact buffer — the consumer wipes its
    // own — instead of tripping the fail-closed "possible reuse" warning on
    // every verification that reaches the decrypt step.
    const integrityOk = await validateVerificationIntegrity(stored, passwordBytes);
    if (!integrityOk) {
      logger.warn("[SecurityVault] Verification integrity check failed — rejecting");
      return false;
    }
    const decrypted = await encryptionService.decryptWithBytes(
      stored,
      new Uint8Array(passwordBytes),
    );
    return constantTimeCompare(decrypted, VERIFICATION_PLAINTEXT);
  } catch (error) {
    logger.warn("[SecurityVault] Password verification failed", { error });
    return false;
  } finally {
    zeroPasswordBytes(passwordBytes);
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
