// ADR-019: Argon2id migration / Security hardening (master password vault)
import { encryptionService } from "./EncryptionService";
import { secureStorage } from "./SecureStorage";
import { logger } from "../utils/logger";
import { getRateLimitState, useRateLimitStore } from "../store/rateLimitStore";
import { generateSecureToken } from "../utils/secureRandom";
import { safeGet, safeSet } from "../store/safeStorage";

// Stub for audit log - removed in Core export
const auditLog = {
  record: async () => {
    // Intentional silence: audit log removed for Core export
  },
  verifyIntegrity: async () => ({ valid: true, checked: 0, error: null }),
  flushPending: async () => {
    // Intentional silence: audit log removed for Core export
  },
};
const _rotateAuditSessionId = () => {
  // Intentional silence: audit log removed for Core export
};
import { STORAGE_KEYS } from "../constants/storage-keys";
import { SECURITY_CONFIG } from "../constants/config";
import { zeroPasswordBytes } from "../utils/crypto-core";
import { logRateLimited } from "../utils/boundedLog";
import type { ZeroMemoryProcessor } from "../utils/wasm-zero-memory";
import {
  SECURE_STORAGE_KEYS,
  VERIFICATION_INTEGRITY_KEY,
} from "./security-vault/constants";
import { constantTimeCompare } from "./security-vault/compare";
import { loadBackupService } from "./pro-access";
import { createVerificationToken } from "./security-vault/integrity";
import { deriveShareCredential, parseShareSalt } from "./security-vault/share";
import {
  encryptSecret as encryptSecretWithContext,
  decryptSecret as decryptSecretWithContext,
} from "./security-vault/secrets";
import { verifyPassword as verifyPasswordWithContext } from "./security-vault/auth";
import { rotateMasterPassword as rotateMasterPasswordWithContext } from "./security-vault/rotation";
import { announceVaultKdfSaltChange } from "./security-vault/kdf-salt-sync";
import {
  ensureVaultKdfSalt,
  migrateVaultSecretsToVaultSalt,
  restoreVaultKdfSalt,
  rotateVaultKdfSalt,
  snapshotVaultKdfSalt,
  type VaultKdfSaltSnapshot,
} from "./security-vault/kdf-salt";


// Re-exported for backward compatibility — the canonical definition lives in
// security-vault/constants.ts (refactor, no behavior change).
export { SECURE_STORAGE_KEYS } from "./security-vault/constants";

/**
 * Manages the master password in memory and provides secure access to
 * encrypted secrets stored in IndexedDB. Tokens are ephemeral and
 * auto-rotated; secrets are encrypted with AES-256-GCM via EncryptionService.
 *
 * @example
 * ```ts
 * securityVault.unlock('my_password');
 * await securityVault.encryptSecret('sk-abc', 'openai_key');
 * const key = await securityVault.decryptSecret('openai_key');
 * securityVault.lock();
 * ```
 */
class SecurityVault {
  // Fase 9: purge expired pending_api_key on first initialization.
  // Called lazily — only runs once, the first time any vault method
  // triggers the init path. Prevents stale plaintext API keys from
  // persisting in IndexedDB beyond 7 days when the vault stays locked.
  private static _purgePendingCalled = false;
  // B1 (audit 2026-08-13): the flag is only set on SUCCESS. A transient
  // failure (e.g. IndexedDB blocked by another tab) retries on the next
  // lifecycle call instead of silently skipping the cleanup for the rest
  // of the process — an expired plaintext pending key must not persist
  // past 7 days just because the first purge attempt hiccuped.
  private static async _purgePendingOnce(): Promise<void> {
    if (SecurityVault._purgePendingCalled) return;
    try {
      await secureStorage.purgeExpiredPendingKeys();
      SecurityVault._purgePendingCalled = true;
    } catch (error) {
      // The cleanup is retried on the next lifecycle call; keep the failure
      // visible because an expired pending key must not become unobservable.
      logRateLimited(
        "warn",
        "security-vault-pending-key-purge",
        "Failed to purge expired pending secrets; will retry",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private masterPasswordBytes: Uint8Array | null = null;
  // A shared-vault session is deliberately separate from the local master
  // password. It can unlock the app/session on a fresh device, but it must
  // never be exposed through withMasterPasswordBytes() or used to replace an
  // existing master password.
  private shareCredentialBytes: Uint8Array | null = null;
  private zeroMemoryProcessor: ZeroMemoryProcessor | null = null;
  private sessionToken: string | null = null;
  private sessionExpiry: number = 0;
  private readonly SESSION_TTL_MS = SECURITY_CONFIG.SESSION_TOKEN_TTL_MS;
  private readonly SESSION_ROTATION_INTERVAL_MS = SECURITY_CONFIG.SESSION_ROTATION_INTERVAL_MS;
  private readonly RECOVERY_DATA_KEY = SECURE_STORAGE_KEYS.RECOVERY_DATA;
  private readonly API_KEY_KEY = SECURE_STORAGE_KEYS.API_KEY;
  private readonly VERIFICATION_KEY = SECURE_STORAGE_KEYS.VERIFICATION;
  // S1 fix: HMAC integrity layer over the verification token so an attacker
  // who deletes or replaces the token ciphertext in IndexedDB cannot bypass
  // password verification — the HMAC won't validate without the real password.
  // The canonical constants live in security-vault/constants.ts.
  private rotationTimer: number | null = null;
  private readonly MAX_UNLOCK_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 5 * 60 * 1000;
  private readonly allowedCallers = new WeakSet<object>();
  // Password rotation rewrites several independent encrypted records. Keep
  // the operation single-flight so concurrent settings clicks cannot interleave
  // snapshots, re-encryptions, and device-key rewrapping.
  private rotationPromise: Promise<boolean> | null = null;
  // Serializes the asynchronous lock finalization. The password/session state
  // is cleared synchronously, while the audit batch is flushed before the
  // device key is dropped from memory.
  private lockPromise: Promise<void> | null = null;
  // Bound the interval in which the device key remains materialized solely to
  // flush the lock audit. IndexedDB can be blocked by another context; a
  // security transition must never wait forever or retain key material.
  private readonly LOCK_AUDIT_FLUSH_TIMEOUT_MS = 2_000;
  // Incremented on every lock so an in-flight password rotation cannot
  // re-unlock the vault after the user explicitly locked it.
  private vaultGeneration = 0;
  // Session rotation tracking.
  private sessionRotationActive = false;
  private static readonly INTERNAL_MARKER = {};

  // Secret storage map (for SecretsContext delegation).
  private secrets = new Map<string, string>();
  // Recovery data (encrypted, from IndexedDB).
  private recoveryData: string | null = null;
  // Wrapped device key blob (from Phase 9 device-key separation).
  private wrappedDeviceKeyBlob: string | null = null;
  // Whether the device key is currently wrapped with the master password.
  private isDeviceKeyWrapped = false;
  // Whether the device key is materialized in memory.
  private isDeviceKeyMaterialized = false;
  // Verification token ciphertext (IndexedDB).
  private verificationToken: string | null = null;
  // Verification integrity HMAC (IndexedDB).
  private verificationIntegrity: string | null = null;
  // Per-vault KDF salt snapshot.
  private vaultKdfSaltSnapshot: VaultKdfSaltSnapshot | null = null;
  // True when the vault has been successfully unlocked.
  private isUnlocked = false;
  // Backup service instance (lazy-loaded).
  private backupService: { clearAutoBackup: () => Promise<void> } | null = null;

  // State listeners: subsystems (e.g. the AI VaultIntegration) subscribe so
  // they can purge/restore in-memory secrets in lockstep with the vault.
  private lockListeners = new Set<() => void>();
  private unlockListeners = new Set<() => void>();

  private get rl() {
    return getRateLimitState();
  }

  private zeroBytes(): void {
    if (!this.masterPasswordBytes) {return;}
    const bytes = this.masterPasswordBytes;
    try {
      this.zeroMemoryProcessor?.zeroBytes(bytes);
    } catch (err) {
      logger.warn(
        "[SecurityVault] WASM zero-memory failed, using JS fallback",
        {
          error: err,
        },
      );
      // Max-effort fallback (ADR): use zeroPasswordBytes
      zeroPasswordBytes(bytes);
    }
    if (!this.zeroMemoryProcessor) {
      zeroPasswordBytes(bytes);
    }
    this.masterPasswordBytes = null;
  }

  private clearShareCredential(): void {
    if (this.shareCredentialBytes) {
      for (let i = 0; i < this.shareCredentialBytes.length; i++) { this.shareCredentialBytes[i] = this.shareCredentialBytes[i]! ^ 0xAA; }
      this.shareCredentialBytes.fill(0);
      this.shareCredentialBytes = null;
    }
  }


  private async hasExistingVaultState(
    emptyLocalDatabase = false,
  ): Promise<boolean> {
    if (await this.hasMasterPassword()) {return true;}
    if (this.masterPasswordBytes !== null) {return true;}

    // Protect legacy installations whose setup flag was lost or never
    // existed. Any password-encrypted verification token, recovery record,
    // or persisted DB key means this is not a blank device. A passwordless
    // auto-key/salt pair is ignored only when CollaborationService has
    // independently verified that the local database is empty; this is the
    // migration case created by the "skip password" first-run flow.
    const [
      hasDbKey,
      hasAutoDbKey,
      hasVaultSalt,
      hasApiKey,
      hasVerification,
      hasRecovery,
    ] = await Promise.all([
      secureStorage.hasSecret(SECURE_STORAGE_KEYS.DB_KEY),
      secureStorage.hasSecret("vault_crypto_key"),
      secureStorage.hasSecret("vault_salt"),
      secureStorage.hasSecret(SECURE_STORAGE_KEYS.API_KEY),
      secureStorage.getVerificationToken(),
      secureStorage.hasRecoveryDataRaw(),
    ]);
    return (
      hasDbKey ||
      hasApiKey ||
      (!emptyLocalDatabase && (hasAutoDbKey || hasVaultSalt)) ||
      hasVerification !== null ||
      hasRecovery
    );
  }

  private async initZeroMemoryProcessor(): Promise<void> {
    const { createZeroMemoryProcessor } =
      await import("../utils/wasm-zero-memory");
    this.zeroMemoryProcessor = await createZeroMemoryProcessor();
    logger.info("[SecurityVault] WASM zero-memory processor initialized");
  }

  /**
   * Unlocks the vault with the master password. Rate-limited: after 5 failed
   * attempts the vault is locked for 5 minutes.
   * @param password - The user's password (minimum 12 characters)
   * @returns `true` when unlocked successfully, `false` when rejected or rate limited
   */
  async unlock(password: string): Promise<boolean> {
    // Do not race a previous lock's audit flush/device-key teardown. Callers
    // that ignored lock() still get a safe lifecycle boundary here.
    if (this.lockPromise) {
      await this.lockPromise;
    }

    // Fase 9: best-effort cleanup of expired pending keys on any unlock
    // attempt. This runs once per process lifetime and is non-blocking.
    SecurityVault._purgePendingOnce();

    if (typeof password !== "string" || !password.trim()) {
      logger.warn(
        "[SecurityVault] Invalid password input - empty string rejected",
      );
      this.recordFailedAttempt();
      return false;
    }

    // Legacy behavior (audit M-05): the stored master password is the
    // trimmed form — " a" and "a" unlock the same vault. Kept for
    // backward compatibility with vaults created before the whitespace
    // guard was added to rotateMasterPassword(); new and rotated
    // passwords can no longer be whitespace-padded.
    const trimmedPassword = password.trim();
    if (trimmedPassword.length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH) {
      logger.warn(
        "[SecurityVault] Password too short - minimum %d characters required",
        SECURITY_CONFIG.MIN_PASSWORD_LENGTH,
      );
      this.recordFailedAttempt();
      return false;
    }

    const rl = this.rl;
    if (Date.now() < rl.lockoutUntil) {
      const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
      logger.warn(
        "[SecurityVault] Rate limited - muitas tentativas de desbloqueio",
        {
          remainingSeconds: remaining,
        },
      );
      return false;
    }

    // Verify the password against the stored token BEFORE accepting it
    const passwordValid = await this.verifyPassword(trimmedPassword);
    if (!passwordValid) {
      this.recordFailedAttempt();

      logger.warn("[SecurityVault] Invalid password rejected");
      this.recordAudit({
        action: "vault_unlock_failed",
        result: "failure",
        origin: "SecurityVault",
        context: { reason: "Invalid password" },
      });

      return false;
    }

    // Order: resolve the master-password state FIRST. The raw flag read
    // never touches the device key, so it is safe while the vault is
    // still wrapped — and it decides whether the device key must be
    // materialized (existing vault) or created + wrapped (first-time
    // setup) below.
    const masterPasswordSet = await this.hasMasterPassword();

    // Audit H5: materialize the device key NOW that the password checked
    // out — BEFORE any wrap decision. The verification token is
    // password-encrypted only (readable while locked), so this is the
    // first point where the wrapped device key can be unwrapped. Fail
    // closed — never regenerate.
    const deviceKeyReady = await this.unlockDeviceKey(trimmedPassword);
    if (!deviceKeyReady) {
      this.recordFailedAttempt();

      logger.error(
        "[SecurityVault] Device key unavailable after password verification — vault locked closed",
      );
      this.recordAudit({
        action: "vault_unlock_failed",
        result: "failure",
        origin: "SecurityVault",
        context: { reason: "Device key unwrap failed" },
      });

      return false;
    }

    // ── A-1: per-vault Argon2id salt (best-effort, never blocks the unlock) ──
    // Runs after the device key is materialized (SecureStorage is readable and
    // writable from here) and before any password-encrypted write below, so a
    // token minted on this path is already v6-keyed. Legacy blobs are re-wrapped
    // in the same step; a failure leaves them under the legacy fixed salt, where
    // they stay readable.
    const vaultKdfSaltHex = await this.installVaultKdfSalt();
    if (vaultKdfSaltHex) {
      await this.migrateVaultToPerVaultSalt(trimmedPassword);
    }

    // SECURITY: create verification token ATOMICALLY before setting any
    // session state. If the process dies between setting masterPasswordBytes
    // and persisting the token, the vault would be left unverifiable on
    // reload — accepting any new password (tampering risk).
    // Keep token creation inside the guarded activation block. If crypto or
    // IndexedDB fails here, the device key must be torn down just like any
    // later activation failure; otherwise unlock() rejects while a locked
    // vault retains a materialized key in memory.
    let hasToken: boolean;
    try {
      hasToken = await secureStorage.hasSecret(this.VERIFICATION_KEY);
      if (!hasToken) {
        await createVerificationToken(trimmedPassword);
      }

      // A successful unlock without a pre-existing verification token is the
      // first-run registration path: verifyPassword() rejects tokenless
      // populated vaults, so it is safe to materialize and wrap the device
      // key now. Do not recalculate "any vault state" after creating the
      // token—the newly written integrity record would make a fresh vault
      // look pre-existing and leave its device key unwrapped.
      if (!masterPasswordSet && !hasToken) {
        await secureStorage.wrapDeviceKeyWithPassword(trimmedPassword);
      } else if (!masterPasswordSet) {
        // Legacy vaults may have lost only the setup flag. Restore the flag
        // without minting a new wrapper or orphaning existing ciphertext.
        await secureStorage.setMasterPasswordConfiguredFlag();
        logger.info(
          "[SecurityVault] Master-password flag restored on existing vault (no re-wrap)",
        );
      }

      this.clearShareCredential();
      this.masterPasswordBytes = new TextEncoder().encode(trimmedPassword);
      this.isUnlocked = true;
      this.initZeroMemoryProcessor().catch((err) =>
        logger.warn("[SecurityVault] Zero-memory init failed post-unlock", {
          error: err,
        }),
      );
      await this.generateSessionToken();
      this.startSessionRotation();

      useRateLimitStore.getState().resetAttempts();

      this.recordAudit({
        action: "vault_unlock",
        result: "success",
        origin: "SecurityVault",
      });

      // Notify AFTER the vault is fully unlocked so listeners can safely
      // decrypt secrets (masterPasswordBytes + session token are ready).
      this.notifyUnlockListeners();
      return true;
    } catch (error) {
      this.zeroBytes();
      this.isUnlocked = false;
      this.sessionToken = null;
      this.sessionExpiry = 0;
      this.stopSessionRotation();
      // The password was verified and the device key may already have been
      // materialized. Tear it down on every activation failure, including
      // token creation, wrapping, and session-token failures.
      secureStorage.lockDeviceKey();
      this.isDeviceKeyMaterialized = false;

      this.recordFailedAttempt();

      logger.error("[SecurityVault] Failed to process password", { error });

      this.recordAudit({
        action: "vault_unlock_failed",
        result: "failure",
        origin: "SecurityVault",
        context: { reason: "Decryption or process failure" },
      });

      return false;
    } finally {
      // H2: verify the HMAC attestation chain over the audit log. A broken
      // link means the stored log was tampered with (or corrupted) outside
      // the unlocked session — surfaced as an audit entry. Fire-and-forget:
      // this must NEVER affect the unlock outcome, so the call is defensive
      // and fully isolated from the try/catch result.
      this.verifyAuditIntegrityAfterUnlock();
    }
  }

  /**
   * Records a failed unlock attempt and applies a lockout
   * once the attempt limit is reached.
   */
  private recordFailedAttempt(): void {
    useRateLimitStore.getState().incrementAttempt();
    this.checkAndSetLockoutIfNeeded();
  }

  /**
   * Stub for audit recording - removed in Core export
   */
  private recordAudit(_params: Record<string, unknown>): void {
    // Intentional silence: audit log removed for Core export
  }

  /**
   * Checks the failed-attempt counter and applies the lockout when the
   * limit is reached.
   */
  private checkAndSetLockoutIfNeeded(): void {
    const rl = this.rl;
    // NOTE: the caller already incremented unlockAttempts via incrementAttempt().
    // Here we only check whether the limit was reached — without adding 1 extra.
    if (rl.unlockAttempts >= this.MAX_UNLOCK_ATTEMPTS) {
      useRateLimitStore
        .getState()
        .setLockout(Date.now() + this.LOCKOUT_DURATION_MS);
      logger.warn(
        "[SecurityVault] Automatic lockout activated after repeated failures",
      );
    }
  }

  /**
   * Checks whether ANY vault state exists that would indicate this is not
   * a fresh installation. Used to detect tampering when the verification
   * token is missing but other vault artifacts remain.
   */
  private async hasAnyVaultState(_emptyLocalDatabase = false): Promise<boolean> {
    if (await this.hasMasterPassword()) {return true;}
    const results = await Promise.all([
      secureStorage.hasSecret(SECURE_STORAGE_KEYS.DB_KEY),
      secureStorage.hasSecret(SECURE_STORAGE_KEYS.API_KEY),
      secureStorage.isDeviceKeyWrapped(),
      secureStorage.hasRecoveryDataRaw(),
      secureStorage.hasSecret(VERIFICATION_INTEGRITY_KEY),
    ]);
    return results.some(Boolean);
  }

  /**
   * Creates a verification token encrypted with the master password.
   * The token is used in unlock() to validate that the password is correct
   * before marking the vault as unlocked.
   *
   * Audit H5: stored RAW (password-encrypted only, no device-key layer).
   * It must be readable while the vault is locked so the password can be
   * verified BEFORE the wrapped device key is unwrapped — the device-key
   * layer would deadlock unlock().
   */

  /**
   * Fire-and-forget HMAC chain verification after a successful unlock.
   * Reports a broken chain (tampering) as an audit entry + error log.
   * Never blocks or fails unlock.
   */
  private verifyAuditIntegrityAfterUnlock(): void {
    // Audit integrity check removed for Core export
  }

  /**
   * Materialize the device key after the password verified. No-op when the
   * key is not wrapped (legacy localStorage path). Returns false on any
   * failure so unlock() fails closed.
   */
  private async unlockDeviceKey(password: string): Promise<boolean> {
    try {
      // Source of truth is the wrapped blob itself, not the boolean
      // wrapper: materialize the key whenever the blob EXISTS. A vault
      // whose blob is transiently invisible to one read must never slip
      // through as "not wrapped" — that is the exact race that used to
      // let the wrap decision below mint a fresh key and orphan every
      // ciphertext.
      const wrappedBlob = await secureStorage.getWrappedDeviceKeyBlob();
      if (wrappedBlob !== null) {
        await secureStorage.unwrapDeviceKeyWithPassword(password);
        logger.info(
          "[SecurityVault] Device key unwrapped (master-password wrapped)",
        );
      } else {
        // First-run has no wrapper yet, but encrypted storage writes still
        // require a materialized device key before setup persists metadata.
        await secureStorage.ensureDeviceKeyMaterialized();
      }
      // Post-condition: whenever the wrapped blob existed, the key MUST
      // be materialized in memory now. Fail closed rather than letting
      // the later wrap decision re-wrap with a fresh key.
      if (wrappedBlob !== null && !secureStorage.isDeviceKeyMaterialized()) {
        logger.error(
          "[SecurityVault] Device key not materialized after unwrap — failing closed",
        );
        return false;
      }
      return true;
    } catch (error) {
      logger.error("[SecurityVault] Failed to materialize device key", {
        error,
      });
      return false;
    }
  }

  /**
   * Checks whether a password is correct by attempting to decrypt the
   * stored verification token. When no token exists:
   *   - If a master password is already configured → reject (tampering)
   *   - On first run (no flag) → accept for the registration flow
   */
  /**
   * A-1: install the per-vault Argon2id salt in the crypto layer.
   *
   * Best-effort by design: the unlock path must not fail because the salt
   * could not be provisioned (the vault then simply keeps using the legacy
   * fixed salt, which is exactly the pre-change behavior).
   *
   * @returns the installed salt (32 hex) or null when unavailable.
   */
  private async installVaultKdfSalt(): Promise<string | null> {
    try {
      return await ensureVaultKdfSalt();
    } catch (error) {
      logger.warn(
        "[SecurityVault] Vault KDF salt unavailable — continuing with the legacy fixed salt",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  /**
   * A-1: transparently re-wrap master-password material under the per-vault
   * salt, once the per-vault salt is installed.
   *
   * Two targets, in order of exposure:
   *   1. the verification token + its S1 integrity record — this is the blob an
   *      attacker with device access can mount an offline dictionary against
   *      while the vault is LOCKED, so it is the primary reason for the fix.
   *      Re-minted only while it is still a legacy `v5:` payload, and always
   *      together with its integrity record (one IndexedDB transaction) so a
   *      crash can never leave a token/HMAC pair that no password unlocks.
   *   2. the other persisted password-encrypted secrets (see
   *      migrateVaultSecretsToVaultSalt).
   *
   * Never throws: the password was just verified, so the session is valid
   * whatever the outcome; the caller's unlock result is unaffected.
   */
  private async migrateVaultToPerVaultSalt(password: string): Promise<void> {
    try {
      const storedToken = await secureStorage.getVerificationToken();
      if (storedToken && !storedToken.startsWith("v6:")) {
        await createVerificationToken(password);
        logger.info(
          "[SecurityVault] Verification token re-wrapped under the per-vault KDF salt (A-1)",
        );
      }
      await migrateVaultSecretsToVaultSalt(password);
    } catch (error) {
      logger.warn(
        "[SecurityVault] Per-vault salt migration incomplete — legacy payloads remain readable",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  private async verifyPassword(password: string): Promise<boolean> {
    return verifyPasswordWithContext(password, this.buildAuthContext());
  }

   /**
    * Rate-limited password verification (RL-1).
   *
   * `verifyPassword` is deliberately private: the only way to verify a
   * password from outside the vault is through this method, which applies
   * the SAME lockout gate as unlock(). NuclearForgetService uses it to
   * confirm the master password before wiping, so a caller cannot turn the
   * vault into an unthrottled offline brute-force oracle.
   */
  async verifyPasswordRateLimited(password: string): Promise<boolean> {
    if (typeof password !== "string" || !password.trim()) {
      this.recordFailedAttempt();
      return false;
    }
    if (password.trim().length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH) {
      this.recordFailedAttempt();
      return false;
    }
    const rl = this.rl;
    if (Date.now() < rl.lockoutUntil) {
      const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
      logger.warn("[SecurityVault] verifyPassword rate limited", {
        remainingSeconds: remaining,
      });
      return false;
    }
    const valid = await this.verifyPassword(password.trim());
    if (!valid) {
      this.recordFailedAttempt();
      return false;
    }
    // Successful verification clears the counter, mirroring unlock().
    useRateLimitStore.getState().resetAttempts();
    return true;
  }

  /**
   * Rate-limited share-payload decrypt gate (RL-2).
   *
   * importSharedVault() previously decrypted the AES-GCM share payload via
   * encryptionService directly BEFORE any rate-limit check, letting an
   * attacker brute-force the share password without touching the lockout
   * counter. This method runs the decrypt INSIDE the same lockout gate as
   * unlock()/unlockFromShare(): while locked out it refuses to decrypt,
   * and a failed decrypt (wrong share password → AES-GCM auth failure)
   * counts as a failed attempt.
   *
   * @returns the decrypted share payload, or null when rate-limited/failed.
   */
  async decryptShareWithRateLimit(
    encryptedKey: string,
    sharePassword: string,
  ): Promise<string | null> {
    const rl = this.rl;
    if (Date.now() < rl.lockoutUntil) {
      const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
      logger.warn("[SecurityVault] decryptShare rate limited", {
        remainingSeconds: remaining,
      });
      return null;
    }
    try {
      const decrypted = await encryptionService.decrypt(
        encryptedKey,
        sharePassword,
      );
      return decrypted;
    } catch (error) {
      // AES-GCM authentication failure == wrong share password.
      this.recordFailedAttempt();
      logger.warn("[SecurityVault] Share password decrypt failed", {
        error,
      });
      return null;
    }
  }

  /**
   * Generates a cryptographically random session token (32 bytes).
   * Not derived from the master password — uses `generateSecureToken`.
   */
  private async generateSessionToken(): Promise<void> {
    this.sessionToken = generateSecureToken(32);
    this.sessionExpiry = Date.now() + this.SESSION_TTL_MS;
  }

  /**
   * Starts auto-rotation of the session token every 15 minutes.
   */
  private startSessionRotation(): void {
    if (this.rotationTimer !== null) {
      clearInterval(this.rotationTimer);
    }
    // L-09: `window` is undefined in SSR/test environments — guard so the
    // rotation start can never crash there (only reached after unlock in the
    // browser today, but the guard keeps it safe for future call sites).
    if (typeof window === "undefined") {return;}
    this.rotationTimer = window.setInterval(() => {
      if (!this.isLocked()) {
        this.generateSessionToken().catch((err) =>
          logger.error("[SecurityVault] Session rotation failed", {
            error: err,
          }),
        );
      } else {
        this.stopSessionRotation();
      }
    }, this.SESSION_ROTATION_INTERVAL_MS);
  }

  /**
   * Stops the session token auto-rotation timer.
   */
  private stopSessionRotation(): void {
    if (this.rotationTimer !== null) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  /**
   * Unlocks a vault from an authenticated share payload.
   *
   * Existing vaults remain password-bound: when a local master password is
   * configured (or already loaded), the share secret must still match the
   * HKDF value derived from that local password. This prevents a share from
   * silently replacing or bypassing an existing vault credential.
   *
   * A fresh device has no local master password to compare against. In that
   * case the share secret (already authenticated by CollaborationService's
   * AES-GCM payload decryption) is converted into an ephemeral, in-memory
   * device credential. It unlocks the application session without ever being
   * persisted as the local master password or exposed via
   * withMasterPasswordBytes().
   *
   * @param shareSecret - The decrypted share secret from the share payload
   * @param saltJson - JSON-serialized Uint8Array salt from the share payload
   */
  async unlockFromShare(
    shareSecret: string,
    saltJson: string,
    options: {
      allowFreshDevice?: boolean;
      /** Set only after the caller has verified the local RxDB is empty. */
      emptyLocalDatabase?: boolean;
    } = {},
  ): Promise<boolean> {
    const rl = this.rl;
    if (Date.now() < rl.lockoutUntil) {
      const remaining = Math.ceil((rl.lockoutUntil - Date.now()) / 1000);
      logger.warn("[SecurityVault] unlockFromShare rate limited", {
        remainingSeconds: remaining,
      });
      return false;
    }

    if (!/^[0-9a-f]{64}$/i.test(shareSecret)) {
      this.recordFailedAttempt();
      return false;
    }

    const allowFreshDevice = options.allowFreshDevice === true;
    const salt = parseShareSalt(saltJson, allowFreshDevice ? 16 : 1);
    if (!salt) {
      logger.error("[SecurityVault] unlockFromShare HKDF derivation failed", {
        error: new Error("Invalid share salt"),
      });
      this.recordFailedAttempt();
      return false;
    }

    // A configured or otherwise populated vault is never converted into a
    // shared session. This protects legacy installations whose setup flag is
    // missing but still contain encrypted state.
    const emptyLocalDatabase = options.emptyLocalDatabase === true;
    const existingVault = await this.hasExistingVaultState(emptyLocalDatabase);

    try {
      if (existingVault) {
        if (!this.masterPasswordBytes) {
          this.recordFailedAttempt();
          return false;
        }

        const baseKey = await crypto.subtle.importKey(
          "raw",
          this.masterPasswordBytes as Uint8Array<ArrayBuffer>,
          { name: "HKDF" },
          false,
          ["deriveBits"],
        );
        const derivedBits = await crypto.subtle.deriveBits(
          {
            name: "HKDF",
            salt: salt as Uint8Array<ArrayBuffer>,
            info: new TextEncoder().encode("bookmarkforge-share"),
            hash: "SHA-256",
          },
          baseKey,
          256,
        );
        const expected = Array.from(new Uint8Array(derivedBits), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");

        if (!constantTimeCompare(expected, shareSecret)) {
          this.recordFailedAttempt();
          return false;
        }
      } else if (allowFreshDevice && emptyLocalDatabase) {
        // Fresh-device bootstrap: the caller has already authenticated the
        // share secret by decrypting the AES-GCM payload with sharePassword.
        // Requiring an explicit empty-database attestation prevents a direct
        // caller from turning an unconfigured but populated legacy vault into
        // a share session.
        // Derive a separate credential so the raw payload secret is never
        // retained as the session's operational key.
        const derivedCredential = await deriveShareCredential(
          shareSecret,
          salt,
        );
        this.clearShareCredential();
        this.shareCredentialBytes = derivedCredential;
      } else {
        // Legacy payloads, and v2 payloads without an explicit empty-device
        // attestation, are never allowed to bootstrap a new device. This
        // preserves the old password-bound behavior while current v2 payloads
        // opt into the explicit fresh-device flow.
        this.recordFailedAttempt();
        return false;
      }
    } catch (error) {
      logger.error("[SecurityVault] unlockFromShare HKDF derivation failed", {
        error,
      });
      this.recordFailedAttempt();
      return false;
    }

    try {
      useRateLimitStore.getState().resetAttempts();
      this.recordAudit({
        action: "vault_unlock_from_share",
        result: "success",
        origin: "SecurityVault",
      });

      // SECURITY: derive a fresh session token instead of reusing the share
      // secret. The share secret is known to the remote peer that generated it;
      // reusing it as the session token would give the sharing peer a valid
      // credential for this vault session (cross-session linkability + access).
      this.isUnlocked = true;
      await this.generateSessionToken();
      this.startSessionRotation();
      this.notifyUnlockListeners();
      return true;
    } catch (error) {
      this.clearShareCredential();
      this.sessionToken = null;
      this.sessionExpiry = 0;
      this.stopSessionRotation();
      logger.error("[SecurityVault] Share session activation failed", { error });
      return false;
    }
  }

  /**
   * Returns the current session token, or `null` if locked/expired.
   * Used for sync operations that need a time-limited credential.
   */
  getSessionToken(): string | null {
    if (this.isLocked()) {
      return null;
    }
    if (Date.now() > this.sessionExpiry) {
      this.sessionToken = null;
      return null;
    }
    return this.sessionToken;
  }

  /**
   * Locks the vault and clears the master password from memory.
   * Note: JS strings are immutable and may linger in the heap until GC;
   * this is a best-effort measure to minimize the exposure window.
   */
  async lock(): Promise<void> {
    if (this.lockPromise) {
      return this.lockPromise;
    }

    // Clear sensitive session state synchronously so callers observe the lock
    // immediately. The device key remains materialized only until the audit
    // batch below has finished writing the `vault_lock` entry.
    this.vaultGeneration += 1;
    logger.info("[SecurityVault] Vault locked");

    this.zeroBytes();
    this.isUnlocked = false;
    this.clearShareCredential();
    this.sessionToken = null;
    this.sessionExpiry = 0;
    this.stopSessionRotation();

    // Notify after the vault's password/session state is cleared so listeners
    // can purge any secrets they hold in memory (e.g. decrypted AI keys).
    this.notifyLockListeners();

    const finalize = (async () => {
      try {
        // Audit flush removed for Core export
      } catch (error) {
        logger.warn("[SecurityVault] Failed to flush lock audit", { error });
      } finally {
        // Audit H5: drop the in-memory device key so no key material survives
        // the locked vault.
        secureStorage.lockDeviceKey();

        // Clear the crypto worker/main-thread session-key caches at the same
        // boundary. EncryptionService re-initializes lazily after unlock.
        void encryptionService.clear().catch((err) =>
          logger.warn("[SecurityVault] Failed to clear encryption session", {
            error: err,
          }),
        );
      }
    })();

    this.lockPromise = finalize;
    try {
      await finalize;
    } finally {
      if (this.lockPromise === finalize) {
        this.lockPromise = null;
      }
    }
  }

  /** Returns `true` if no master password is loaded in memory. */
  isLocked(): boolean {
    return this.masterPasswordBytes === null && this.shareCredentialBytes === null;
  }

  /**
   * Registers a callback invoked synchronously whenever the vault locks.
   * Returns an unsubscribe function.
   */
  onLock(listener: () => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  /**
   * Registers a callback invoked synchronously whenever the vault unlocks.
   * Returns an unsubscribe function.
   */
  onUnlock(listener: () => void): () => void {
    this.unlockListeners.add(listener);
    return () => this.unlockListeners.delete(listener);
  }

  private notifyLockListeners(): void {
    this.lockListeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        logger.warn("[SecurityVault] lock listener error", { error: err });
      }
    });
  }

  private notifyUnlockListeners(): void {
    this.unlockListeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        logger.warn("[SecurityVault] unlock listener error", { error: err });
      }
    });
  }

  /**
   * Derives an HMAC key from the in-memory master password bytes.
   * Used by BroadcastBridgeService to authenticate cross-context control
   * messages (SYNC_SETTINGS) and prevent same-origin extensions from
   * injecting an AI API key. Returns null when the vault is locked.
   */
  async deriveBridgeKey(): Promise<CryptoKey | null> {
    if (this.isLocked() || !this.masterPasswordBytes) {return null;}
    try {
      return await crypto.subtle.importKey(
        "raw",
        this.masterPasswordBytes as Uint8Array<ArrayBuffer>,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    } catch (_err) {
      return null;
    }
  }

  registerCaller(caller: object): void {
    this.allowedCallers.add(caller);
  }

  /**
   * Bytes-based variant that does NOT decode the
   * master password into a JS string (avoids an immutable heap copy that
   * cannot be zeroized). Passes the raw `Uint8Array` to the callback.
   * Prefer this over `withMasterPassword` for all new callers.
   */
  withMasterPasswordBytes<T>(
    caller: object,
    fn: (passwordBytes: Uint8Array | null) => T,
  ): T {
    if (
      caller !== SecurityVault.INTERNAL_MARKER &&
      !this.allowedCallers.has(caller)
    ) {
      throw new Error(
        "Unauthorized: caller not registered for master password access",
      );
    }
    const bytes = this.masterPasswordBytes
      ? new Uint8Array(this.masterPasswordBytes)
      : null;
    return fn(bytes);
  }

  /**
   * Checks that the vault is unlocked and masterPasswordBytes are available.
   * Logs an audit failure and throws if locked.
   */
  private assertUnlocked(key: string, action: "encrypt" | "decrypt"): void {
    if (this.isLocked() || !this.masterPasswordBytes) {
      this.recordAudit({
        action: `secret_${action}`,
        target: key,
        result: "failure",
        origin: "SecurityVault",
        context: { reason: "Vault locked" },
      });
      throw new Error("Vault is locked");
    }
  }

  /**
   * Encrypts a secret string and stores it in IndexedDB.
   * @param secret - Plaintext secret to encrypt
   * @param key - Storage key identifier (defaults to `encrypted_api_key`)
   * @returns The encrypted ciphertext
   * @throws {Error} If the vault is locked
   */
  async encryptSecret(
    secret: string,
    key: string = this.API_KEY_KEY,
  ): Promise<string> {
    return encryptSecretWithContext(secret, key, this.buildSecretsContext());
  }

  async decryptSecret(key: string = this.API_KEY_KEY): Promise<string> {
    return decryptSecretWithContext(key, this.buildSecretsContext());
  }

  /** Stores encrypted recovery data (phrase-encrypted, readable while locked). */
  async setRecoveryData(encryptedData: string): Promise<void> {
    await secureStorage.setRecoveryDataRaw(encryptedData);
  }

  /** Returns the stored recovery data, or `null` if none exists. */
  async getRecoveryData(): Promise<string | null> {
    return await secureStorage.getRecoveryDataRaw();
  }

  /** Returns `true` if recovery data has been stored. */
  async hasRecoveryData(): Promise<boolean> {
    return await secureStorage.hasRecoveryDataRaw();
  }

  /** Deletes all stored recovery data. */
  async clearRecoveryData(): Promise<void> {
    await secureStorage.clearRecoveryDataRaw();
  }

  /**
   * Migrates legacy recovery/API-key data from localStorage to IndexedDB.
   * Called once during first load after the SecureStorage upgrade.
   */
  async migrateFromLocalStorage(): Promise<void> {
    await secureStorage.migrateFromLocalStorage(
      STORAGE_KEYS.RECOVERY_DATA,
      this.RECOVERY_DATA_KEY,
    );
    await secureStorage.migrateFromLocalStorage(
      "encrypted_api_key",
      this.API_KEY_KEY,
    );
  }

  /**
   * Returns `true` if a secret exists for the given key.
   * @param key - Storage key identifier (defaults to `encrypted_api_key`)
   */
  async hasSecret(key: string = this.API_KEY_KEY): Promise<boolean> {
    return await secureStorage.hasSecret(key);
  }

  /**
   * Rotates the master password by re-encrypting all stored secrets with the new key.
   *
   * The per-vault Argon2id KDF salt is re-minted as part of the same operation
   * (A-1), so every re-wrapped `v6:` payload is keyed by the new password AND
   * the new salt — a dictionary built against the old password stops applying
   * to the vault the moment this returns `true`. All of it is undone together:
   * a failure anywhere in the middle restores the previous secrets, the wrapped
   * device key, the verification token, its S1 integrity record, and the
   * previous salt.
   *
   * @param newPassword - The new master password
   * @param oldPassword - Current password (uses in-memory bytes if omitted)
   */
  async rotateMasterPassword(
    newPassword: string,
    oldPassword?: string,
  ): Promise<boolean> {
    if (this.rotationPromise) {
      return this.rotationPromise;
    }
    const operation = this.rotateMasterPasswordWithContext(newPassword, oldPassword);
    this.rotationPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.rotationPromise === operation) {
        this.rotationPromise = null;
      }
    }
  }

  private async rotateMasterPasswordWithContext(
    newPassword: string,
    oldPassword?: string,
  ): Promise<boolean> {
    return rotateMasterPasswordWithContext(
      newPassword,
      oldPassword ?? null,
      this.buildRotationContext(this.vaultGeneration),
    );
  }

  /** Legacy implementation retained temporarily while the extracted rotation
   * path is proven by the rollback drill; it is no longer called. */
  private async rotateMasterPasswordInternal(
    newPassword: string,
    oldPassword?: string,
  ): Promise<boolean> {
    const rotationGeneration = this.vaultGeneration;
    if (this.isLocked()) {
      return false;
    }
    const assertRotationActive = (): void => {
      if (this.vaultGeneration !== rotationGeneration || this.isLocked()) {
        throw new Error("Vault locked during password rotation");
      }
    };

    // RECOVERY_DATA is intentionally NOT rotated: it stores the master
    // password encrypted with the BIP39 recovery phrase (see
    // RecoveryService.encryptMasterPasswordWithRecovery), NOT with the
    // master password. decryptWithBytes() with the master-password key
    // always fails AES-GCM auth, which made EVERY password rotation fail
    // in production (regression caught by the change-password E2E smoke
    // test). The stale copy is cleared after a successful rotation below.
    const rotatedKeys = [
      SECURE_STORAGE_KEYS.API_KEY,
      SECURE_STORAGE_KEYS.DB_KEY,
    ] as const;
    const snapshot: Record<string, string | null> = {};
    let wrappedDeviceKeySnapshot: string | null = null;
    let verificationTokenSnapshot: string | null = null;
    let verificationIntegritySnapshot: string | null = null;
    let wrappedDeviceKeySnapshotted = false;
    let verificationTokenSnapshotted = false;
    // A-1: pre-rotation KDF-salt state. Set before the salt is swapped (never
    // after), so a rotation that fails between "stored" and "installed" is
    // still fully undoable.
    let vaultSaltSnapshot: VaultKdfSaltSnapshot | null = null;
    let oldPwBytes: Uint8Array | null = null;
    let newPwBytes: Uint8Array | null = null;

    try {
      // Audit M-05: reject new passwords that unlock()'s legacy trim()
      // would silently alter — " p" and "p" must never be equivalent.
      if (
        typeof newPassword !== "string" ||
        newPassword.trim().length < SECURITY_CONFIG.MIN_PASSWORD_LENGTH
      ) {
        this.recordAudit({
          action: "master_password_rotate",
          result: "failure",
          origin: "SecurityVault",
          context: { reason: "Invalid new password length" },
        });
        return false;
      }
      if (newPassword !== newPassword.trim()) {
        this.recordAudit({
          action: "master_password_rotate",
          result: "failure",
          origin: "SecurityVault",
          context: {
            reason: "New password has leading or trailing whitespace",
          },
        });
        return false;
      }
      for (const key of rotatedKeys) {
        snapshot[key] = await secureStorage.getSecret(key);
      }
      wrappedDeviceKeySnapshot = await secureStorage.getWrappedDeviceKeyBlob();
      wrappedDeviceKeySnapshotted = true;
      verificationTokenSnapshot = await secureStorage.getVerificationToken();
      verificationTokenSnapshotted = true;
      // S1: snapshot the integrity record so it can be restored on rollback.
      verificationIntegritySnapshot =
        await secureStorage.getVerificationIntegrity();

      oldPwBytes = oldPassword
        ? new TextEncoder().encode(oldPassword)
        : this.masterPasswordBytes
          ? new Uint8Array(this.masterPasswordBytes)
          : null;
      if (!oldPwBytes)
        {throw new Error("Vault is locked or old password not available");}

      newPwBytes = new TextEncoder().encode(newPassword);

      // Audit H5: detect the wrapped device key BEFORE oldPwBytes is zeroed.
      const deviceKeyWrapped = await secureStorage.isDeviceKeyWrapped();
      assertRotationActive();

      // A-1 / ADR-046: rotate the per-vault Argon2id salt with the password.
      // The salt is the other half of the offline-attack cost, and it is only
      // worth what its corpus is worth: leaving it in place would let a
      // dictionary built against the OLD password keep applying to the blobs
      // written under the new one. Everything rewritten below (the rotated
      // secrets, the wrapped device key, the verification token) is therefore
      // re-keyed onto the new salt; `v6:` payloads embed the salt they were
      // written with, so nothing already migrated becomes unreadable whatever
      // the outcome. Decryption needs no cooperation from the module-level
      // salt (v6 carries its own, v5 uses the legacy fixed one), so swapping it
      // here cannot break the reads performed below.
      vaultSaltSnapshot = await snapshotVaultKdfSalt();
      await rotateVaultKdfSalt(vaultSaltSnapshot);
      assertRotationActive();

      try {
        for (const key of rotatedKeys) {
          const encrypted = snapshot[key];
          if (!encrypted) {continue;}
          // EncryptionService zeroizes transferred byte buffers. Pass
          // per-operation copies because the original buffers are reused for
          // every secret and for device-key rewrapping below.
          const plaintext = await encryptionService.decryptWithBytes(
            encrypted,
            oldPwBytes.slice(),
          );
          const reEncrypted = await encryptionService.encryptWithBytes(
            plaintext,
            newPwBytes.slice(),
          );
          await secureStorage.setSecret(key, reEncrypted);
        }
        // Audit H5: re-wrap the device key with the NEW password while
        // oldPwBytes is still live (zeroed in the finally below). The
        // in-memory key handle is unchanged — only its at-rest wrapper.
        if (deviceKeyWrapped) {
          await secureStorage.rewrapDeviceKeyWithPasswordBytes(
            oldPwBytes,
            newPwBytes,
          );
        }
        assertRotationActive();
      } finally {
        if (oldPwBytes) {
          for (let i = 0; i < oldPwBytes.length; i++) { oldPwBytes[i] = oldPwBytes[i]! ^ 0xAA; }
          oldPwBytes.fill(0);
          oldPwBytes = null;
        }
      }

      // Persist the new verification token before replacing the in-memory
      // password. If this write fails, the catch block can restore the old
      // token while the current session still uses the old password.
      // A-1: re-minted as a `v6:` payload, so it embeds the salt rotated above.
      await createVerificationToken(newPassword);
      assertRotationActive();
      // Generate the replacement session token while the old session is still
      // intact. After this point the remaining assignments are synchronous, so
      // a crypto failure cannot leave storage rolled back with a new password
      // still resident in memory.
      await this.generateSessionToken();
      assertRotationActive();

      zeroPasswordBytes(newPwBytes);
      newPwBytes = null;
      this.zeroBytes();
      this.masterPasswordBytes = new TextEncoder().encode(newPassword);

      // H2: re-sign the audit attestation chain with the NEW password so a
      // subsequent verifyIntegrity() does not false-positive on entries
      // signed before the rotation. Best-effort — a failure must not roll
      // back the rotation.
      try {
        const { attestationChain } = await import("./security/AttestationChain");
        await attestationChain.reSignAll();
      } catch (err) {
        logger.warn(
          "[SecurityVault] Failed to re-sign attestation chain after rotation",
          { error: err },
        );
      }

      // The stored recovery data decrypts to the OLD master password; we
      // cannot re-encrypt the new one without the recovery phrase (shown
      // only once at setup). Clear the stale copy so the recovery flow
      // reports "no data" instead of silently returning a dead password.
      await this.clearRecoveryData().catch((err) =>
        logger.warn(
          "[SecurityVault] Failed to clear stale recovery data after rotation",
          { error: err },
        ),
      );

      // Corpus hygiene: the auto-backup in IDB was encrypted with the OLD
      // password. Leaving it in place gives an attacker who harvests the IDB
      // a brute-forceable corpus under the retired key material. Clear it so
      // the next auto-backup cycle creates one under the new password. The
      // cloud-sync backup blob is similarly stale; clearing the local
      // metadata forces the next sync to re-upload with the new password.
      // Both are best-effort: a failure must not abort the committed rotation.
      try {
        // BackupService is Pro: resolved behind the hasProAccess gate. A
        // rejection (Free user, or placeholder build) is best-effort too —
        // the catch below only warns.
        const backup = await loadBackupService();
        await backup.clearAutoBackup();
      } catch (err) {
        logger.warn(
          "[SecurityVault] Failed to clear stale auto-backup after rotation",
          { error: err },
        );
      }

      this.recordAudit({
        action: "master_password_rotate",
        result: "success",
        origin: "SecurityVault",
      });
      // A-1 / ADR-046: the salt changed, so the tabs that are already open
      // must re-read it or they keep writing under the retired one. Announced
      // ONLY here — after the rotation is committed and no longer undoable: a
      // notification sent mid-rotation would make sibling tabs adopt a salt
      // this tab may still roll back, and every `v6:` payload written in that
      // window would be keyed to a salt the vault no longer holds.
      announceVaultKdfSaltChange();
      return true;
    } catch (error) {
      logger.error("[SecurityVault] Failed to rotate master password", {
        error,
      });
      for (const key of rotatedKeys) {
        if (snapshot[key] !== null && snapshot[key] !== undefined) {
          await secureStorage.setSecret(key, snapshot[key]!).catch((err) =>
            logger.error("[SecurityVault] Rollback setSecret failed", {
              key,
              error: err,
            }),
          );
        }
      }
      if (wrappedDeviceKeySnapshotted) {
        await secureStorage.restoreWrappedDeviceKeyBlob(wrappedDeviceKeySnapshot).catch((err) =>
          logger.error("[SecurityVault] Rollback device-key wrapper failed", { error: err }),
        );
      }
      if (verificationTokenSnapshotted) {
        await secureStorage.restoreVerificationToken(verificationTokenSnapshot).catch((err) =>
          logger.error("[SecurityVault] Rollback verification token failed", { error: err }),
        );
        // S1: rollback the integrity record.
        if (verificationIntegritySnapshot !== null && verificationIntegritySnapshot !== undefined) {
          await secureStorage.storeVerificationIntegrity(
            verificationIntegritySnapshot,
          ).catch((err) =>
            logger.error("[SecurityVault] Rollback integrity record failed", { error: err }),
          );
        } else {
          await secureStorage.deleteSecret(
            VERIFICATION_INTEGRITY_KEY,
          ).catch((err) =>
            logger.error("[SecurityVault] Rollback integrity record delete failed", { error: err }),
          );
        }
      }
      // A-1 / ADR-046: restore the previous KDF salt LAST, once every payload
      // under the new one has been put back. Only the in-memory half is
      // load-bearing for the current session (it continues with the OLD
      // password, so it must also continue under the derivation that password
      // was stretched with); the stored half is what the next unlock installs.
      if (vaultSaltSnapshot) {
        await restoreVaultKdfSalt(vaultSaltSnapshot).catch((err) =>
          logger.error("[SecurityVault] Rollback vault KDF salt failed", {
            error: err,
          }),
        );
      }
      this.recordAudit({
        action: "master_password_rotate",
        result: "failure",
        origin: "SecurityVault",
        context: {
          reason: error instanceof Error ? error.message : "Unknown",
        },
      });
      return false;
} finally {
      if (oldPwBytes) {
        for (let i = 0; i < oldPwBytes.length; i++) { oldPwBytes[i] = oldPwBytes[i]! ^ 0xAA; }
        oldPwBytes.fill(0);
        oldPwBytes = null;
      }
      if (newPwBytes) {
        zeroPasswordBytes(newPwBytes);
        newPwBytes = null;
      }
    }
  }

   /**
    * Deletes a secret from IndexedDB.
   * @param key - Storage key identifier (defaults to `encrypted_api_key`)
   */
  async deleteSecret(key: string = this.API_KEY_KEY): Promise<void> {
    await secureStorage.deleteSecret(key);

    this.recordAudit({
      action: "secret_delete",
      target: key,
      result: "success",
      origin: "SecurityVault",
    });
  }

  /**
   * Returns whether the master password has been configured.
   * Uses SecureStorage as primary source, with localStorage fallback for migration.
   */
  async hasMasterPassword(): Promise<boolean> {
    if (typeof window === "undefined") {return false;}
    // Raw flag read — intentionally never routed through the device-key
    // decryption path: unlock() must be able to ask "is a master password
    // configured?" BEFORE the device key is materialized, or a wrapped
    // vault would deadlock (verify → needs flag → needs device key →
    // needs password).
    if (await secureStorage.hasMasterPasswordConfiguredFlagRaw()) {return true;}
    const legacy = safeGet(STORAGE_KEYS.HAS_MASTER_PASSWORD);
    if (legacy === "true") {
      await secureStorage.setMasterPasswordConfiguredFlag();
    }
    return legacy === "true";
  }

  /**
   * Persists the master-password-configured flag to both SecureStorage and localStorage.
   */
  async setMasterPasswordFlag(): Promise<void> {
    await secureStorage.setMasterPasswordConfiguredFlag();
    try {
      safeSet(STORAGE_KEYS.HAS_MASTER_PASSWORD, "true");
    } catch (_err) {
      logger.warn("[SecurityVault] Failed to persist master password flag", { error: _err });
    }
  }

  /** Verify the audit chain without changing the unlock outcome. */
  private verifyAuditIntegrity(): void {
    this.verifyAuditIntegrityAfterUnlock();
  }

  /** Wrap the materialized device key using the real secure-storage path. */
  private async wrapDeviceKeyWithPassword(password: string): Promise<void> {
    await secureStorage.wrapDeviceKeyWithPassword(password);
    this.isDeviceKeyWrapped = true;
  }

  // ── Delegation modules (refactor: split from SecurityVault.ts) ──

  private buildAuthContext() {
    return {
      getMasterPasswordBytes: () => this.masterPasswordBytes,
      clearShareCredential: () => this.clearShareCredential(),
      setMasterPasswordBytes: (pw: string) => {
        this.masterPasswordBytes = new TextEncoder().encode(pw);
        this.isUnlocked = true;
      },
      zeroBytes: () => {
        this.zeroBytes();
        this.isUnlocked = false;
      },
      recordFailedAttempt: () => { this.recordFailedAttempt(); },
      recordAudit: (params: Record<string, unknown>) => { this.recordAudit(params); },
      generateSessionToken: async () => { this.sessionToken = await generateSecureToken(); },
      startSessionRotation: () => { this.sessionRotationActive = true; },
      stopSessionRotation: () => { this.sessionRotationActive = false; },
      notifyLockListeners: () => { this.notifyLockListeners(); },
      notifyUnlockListeners: () => { this.notifyUnlockListeners(); },
      installVaultKdfSalt: async () => { return await ensureVaultKdfSalt(); },
      migrateVaultToPerVaultSalt: async (password: string) => { await migrateVaultSecretsToVaultSalt(password); },
      verifyAuditIntegrityAfterUnlock: () => { this.verifyAuditIntegrity(); },
      unlockDeviceKeyStep: async (password: string) => {
        const ctx = this.buildAuthContext();
        return await (await import("./security-vault/auth")).unlockDeviceKeyStep(ctx, password);
      },
      hasAnyVaultState: async (emptyLocalDatabase?: boolean) => await this.hasAnyVaultState(emptyLocalDatabase),
      hasMasterPassword: async () => await this.hasMasterPassword(),
      wrapDeviceKeyWithPassword: async (password: string) => await this.wrapDeviceKeyWithPassword(password),
      setMasterPasswordConfiguredFlag: async () => await this.setMasterPasswordFlag(),
      getSessionToken: () => this.sessionToken,
      clearSession: () => { this.sessionToken = null; },
      getRateLimitState: () => this.rl,
      flushPendingAudit: async () => {
        if (typeof auditLog.flushPending === "function") await auditLog.flushPending();
      },
      clearEncryptionSession: async () => { await encryptionService.clear(); },
      getWrappedDeviceKeyBlob: async () => await secureStorage.getWrappedDeviceKeyBlob(),
      unwrapDeviceKeyWithPassword: async (password: string) => {
        await secureStorage.unwrapDeviceKeyWithPassword(password);
        this.isDeviceKeyWrapped = true;
        this.isDeviceKeyMaterialized = secureStorage.isDeviceKeyMaterialized();
      },
      ensureDeviceKeyMaterialized: async () => {
        await secureStorage.ensureDeviceKeyMaterialized();
        this.isDeviceKeyMaterialized = secureStorage.isDeviceKeyMaterialized();
      },
      isDeviceKeyMaterialized: async () => secureStorage.isDeviceKeyMaterialized(),
      lockDeviceKey: () => {
        secureStorage.lockDeviceKey();
        this.isDeviceKeyMaterialized = false;
      },
    };
  }

  private buildSecretsContext() {
    return {
      getMasterPasswordBytes: () => this.masterPasswordBytes,
      assertUnlocked: (key: string, action: "encrypt" | "decrypt") => {
        this.assertUnlocked(key, action);
      },
      recordAudit: (params: Record<string, unknown>) => { this.recordAudit(params); },
      hasMasterPassword: async () => await this.hasMasterPassword(),
      setMasterPasswordConfiguredFlag: async () => await this.setMasterPasswordFlag(),
      getSecret: async (key: string) => await secureStorage.getSecret(key),
      setSecret: async (key: string, value: string) => { await secureStorage.setSecret(key, value); },
      deleteSecret: async (key: string) => { await secureStorage.deleteSecret(key); },
      getRecoveryData: async () => await this.getRecoveryData(),
      setRecoveryData: async (data: string) => await this.setRecoveryData(data),
      clearRecoveryData: async () => await this.clearRecoveryData(),
      hasRecoveryData: async () => await this.hasRecoveryData(),
      migrateFromLocalStorage: async () => { await this.migrateFromLocalStorage(); },
    };
  }

  private buildRotationContext(rotationGeneration = this.vaultGeneration) {
    return {
      getMasterPasswordBytes: () => this.masterPasswordBytes,
      hasMasterPassword: async () => await this.hasMasterPassword(),
      getWrappedDeviceKeyBlob: async () => await secureStorage.getWrappedDeviceKeyBlob(),
      isDeviceKeyWrapped: async () => await secureStorage.isDeviceKeyWrapped(),
      isDeviceKeyMaterialized: async () => secureStorage.isDeviceKeyMaterialized(),
      getSecret: async (key: string) => await secureStorage.getSecret(key),
      setSecret: async (key: string, value: string) => { await secureStorage.setSecret(key, value); },
      getVerificationToken: async () => await secureStorage.getVerificationToken(),
      getVerificationIntegrity: async () => await secureStorage.getVerificationIntegrity(),
      storeVerificationTokenWithIntegrity: async (ciphertext: string, integrity: string) => {
        await secureStorage.storeVerificationTokenWithIntegrity(ciphertext, integrity);
      },
      getVaultKdfSaltSnapshot: async () => await snapshotVaultKdfSalt(),
      rotateVaultKdfSalt: async (previous: VaultKdfSaltSnapshot) => await rotateVaultKdfSalt(previous),
      restoreVaultKdfSalt: async (snapshot: VaultKdfSaltSnapshot) => { await restoreVaultKdfSalt(snapshot); },
      encryptWithBytes: async (data: string, key: Uint8Array) => await encryptionService.encryptWithBytes(data, key),
      decryptWithBytes: async (encrypted: string, key: Uint8Array) => await encryptionService.decryptWithBytes(encrypted, key),
      createVerificationToken: async (password: string) => await createVerificationToken(password),
      recordAudit: (params: Record<string, unknown>) => { this.recordAudit(params); },
      clearRecoveryData: async () => { await this.clearRecoveryData(); },
      loadBackupService: async () => await loadBackupService(),
      setMasterPasswordBytes: (pw: string) => {
        this.masterPasswordBytes = new TextEncoder().encode(pw);
        this.isUnlocked = true;
      },
      zeroBytes: () => {
        this.zeroBytes();
        this.isUnlocked = false;
      },
      generateSessionToken: async () => { this.sessionToken = await generateSecureToken(); },
      lockDeviceKey: () => {
        secureStorage.lockDeviceKey();
        this.isDeviceKeyMaterialized = false;
      },
      assertActive: () => {
        if (this.vaultGeneration !== rotationGeneration || this.isLocked()) {
          throw new Error("Vault locked during password rotation");
        }
      },
      deleteSecret: async (key: string) => { await secureStorage.deleteSecret(key); },
      announceSaltChange: () => { announceVaultKdfSaltChange(); },
      rewrapDeviceKey: async (oldPassword: Uint8Array, newPassword: Uint8Array) => {
        await secureStorage.rewrapDeviceKeyWithPasswordBytes(oldPassword, newPassword);
      },
      restoreWrappedDeviceKey: async (blob: string) => {
        await secureStorage.restoreWrappedDeviceKeyBlob(blob);
      },
      restoreVerificationToken: async (ciphertext: string) => {
        await secureStorage.restoreVerificationToken(ciphertext);
      },
      storeVerificationIntegrity: async (integrity: string) => {
        await secureStorage.storeVerificationIntegrity(integrity);
      },
      deleteVerificationIntegrity: async () => {
        await secureStorage.deleteSecret(VERIFICATION_INTEGRITY_KEY);
      },
    };
  }
}

export const securityVault = new SecurityVault();
