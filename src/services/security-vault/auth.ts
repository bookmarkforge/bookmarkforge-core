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
 * `verifyPassword` is used (unlock() has its own private device-key step).
 * Keeping the duplicate
 * was a hazard rather than dead weight — the unused `unlockFromShare` branch
 * did `setMasterPasswordBytes("")`, i.e. it would report the vault unlocked
 * with an empty master password. Removing it leaves exactly one source of
 * truth for the unlock sequence.
 */

import { encryptionService } from "../EncryptionService";
import { secureStorage } from "../SecureStorage";
import { logger } from "../../utils/logger";
import {
  LegacyV5FormatRemovedError,
  isLegacyV5FormatRemovedError,
  zeroPasswordBytes,
} from "../../utils/crypto-core";
import { copyPasswordBytes } from "../../utils/passwordBytes";
import { SECURE_STORAGE_KEYS, VERIFICATION_PLAINTEXT } from "./constants";
import { secureStoragePurpose } from "../../utils/envelope-purposes";
import { constantTimeCompare } from "./compare";
import { validateVerificationIntegrity } from "./integrity";

// ── Context type ──

/** Minimal context that the operations below need from SecurityVault. */
export interface AuthContext {
  hasAnyVaultState: (emptyLocalDatabase?: boolean) => Promise<boolean>;
  recordAudit: (params: Record<string, unknown>) => void;
}

/**
 * Verifies a password against the stored verification token.
 * When no token exists:
 *   - If a master password is already configured → reject (tampering)
 *   - On first run (no flag) → accept for the registration flow
 */
export async function verifyPassword(
  password: string | Uint8Array,
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

  // Bytes at the boundary: a string is encoded once here; a byte caller's
  // buffer is copied so the finally below zeroizes exactly one owned buffer.
  const passwordBytes = copyPasswordBytes(password);
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
      // v7 (M-02): same slot binding the token was written with.
      secureStoragePurpose(SECURE_STORAGE_KEYS.VERIFICATION),
    );
    return constantTimeCompare(decrypted, VERIFICATION_PLAINTEXT);
  } catch (error) {
    // ADR-052 Phase 3: a verification token still in the retired v5 format is
    // NOT a wrong password — no retry can fix it. Surface the typed, actionable
    // error so the caller can explain the remedy instead of looping on
    // "invalid password".
    if (isLegacyV5FormatRemovedError(error)) {
      logger.warn(
        "[SecurityVault] Verification token uses the retired v5 legacy format",
      );
      throw new LegacyV5FormatRemovedError();
    }
    logger.warn("[SecurityVault] Password verification failed", { error });
    return false;
  } finally {
    zeroPasswordBytes(passwordBytes);
  }
}
