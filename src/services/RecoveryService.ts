import * as bip39 from "bip39";
import { encryptionService } from "./EncryptionService";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";

const MIN_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

/**
 * RecoveryService - Generates and manages recovery phrases for the master password.
 * Rate-limiting is persisted to localStorage to survive page reloads.
 */
class RecoveryService {
  private lastAttempt: number;
  private attemptCount: number;

  constructor() {
    const storedLast = safeGet(STORAGE_KEYS.RECOVERY_LAST_ATTEMPT);
    const storedCount = safeGet(STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT);
    const now = Date.now();
    const parsedLast = storedLast === null ? 0 : Number(storedLast);
    const parsedCount = storedCount === null ? 0 : Number(storedCount);

    // Treat persisted throttling state as untrusted input. Reject malformed,
    // fractional, negative, and future timestamps so a tampered localStorage
    // value cannot permanently disable recovery or bypass the attempt cap.
    this.lastAttempt = Number.isSafeInteger(parsedLast) && parsedLast >= 0
      ? Math.min(parsedLast, now)
      : 0;
    this.attemptCount = Number.isSafeInteger(parsedCount) && parsedCount >= 0
      ? Math.min(parsedCount, MAX_ATTEMPTS)
      : 0;
  }

  /**
   * Sanitizes a recovery phrase input.
   */
  private sanitizePhrase(phrase: string): string {
    return phrase
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  /**
   * Validates the format of a recovery phrase before BIP39 validation.
   */
  private validatePhraseFormat(phrase: string): boolean {
    if (phrase.length < 50 || phrase.length > 300) {
      return false;
    }
    if (!/^[a-z\s]+$/.test(phrase)) {
      return false;
    }
    const wordCount = phrase.split(" ").filter((w) => w.length > 0).length;
    if (wordCount !== 24) {
      return false;
    }
    return true;
  }

  /**
   * Persists the current in-memory rate-limit state to localStorage.
   * Silently no-ops if localStorage is unavailable.
   */
  private syncToStorage(): void {
    try {
      safeSet(STORAGE_KEYS.RECOVERY_LAST_ATTEMPT, String(this.lastAttempt));
      safeSet(STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT, String(this.attemptCount));
    } catch (_err) {
      // localStorage unavailable
    }
  }

  /**
   * Generates a new 24-word recovery phrase.
   */
  generateRecoveryPhrase(): string {
    return bip39.generateMnemonic(256);
  }

  /**
   * Validates a recovery phrase with additional sanitization, persistent
   * rate-limiting, and brute-force lockout protection.
   */
  validateRecoveryPhrase(phrase: string): boolean {
    const now = Date.now();
    if (typeof phrase !== "string") {
      return false;
    }

    if (this.attemptCount >= MAX_ATTEMPTS) {
      if (now - this.lastAttempt < LOCKOUT_DURATION_MS) {
        return false;
      }
      this.attemptCount = 0;
    }

    if (now - this.lastAttempt < MIN_INTERVAL_MS) {
      return false;
    }

    this.lastAttempt = now;
    this.attemptCount += 1;
    this.syncToStorage();

    const sanitized = this.sanitizePhrase(phrase);
    if (!this.validatePhraseFormat(sanitized)) {
      return false;
    }

    return bip39.validateMnemonic(sanitized);
  }

  /**
   * Validate a recovery phrase without incrementing the rate-limit counter.
   * Used internally by encrypt/decrypt flows where the caller has already
   * entered their own phrase (not a brute-force attempt).
   */
  private validateRecoveryPhraseInternal(phrase: string): boolean {
    const sanitized = this.sanitizePhrase(phrase);
    if (!this.validatePhraseFormat(sanitized)) {
      return false;
    }
    return bip39.validateMnemonic(sanitized);
  }

  /**
   * Encrypts the master password using a recovery phrase.
   */
  async encryptMasterPasswordWithRecovery(
    password: string,
    phrase: string,
  ): Promise<string> {
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("Master password cannot be empty");
    }
    if (typeof phrase !== "string") {
      throw new Error("Invalid recovery phrase");
    }
    const sanitized = this.sanitizePhrase(phrase);

    if (!this.validateRecoveryPhraseInternal(phrase)) {
      throw new Error("Invalid recovery phrase");
    }

    return await encryptionService.encrypt(password, sanitized);
  }

  /**
   * Decrypts the master password using a recovery phrase.
   */
  async decryptMasterPasswordWithRecovery(
    encryptedPassword: string,
    phrase: string,
  ): Promise<string> {
    if (typeof encryptedPassword !== "string" || encryptedPassword.length === 0) {
      throw new Error("Invalid encrypted password");
    }
    if (typeof phrase !== "string") {
      throw new Error("Invalid recovery phrase");
    }
    const sanitized = this.sanitizePhrase(phrase);

    // Use the rate-limited path for decryption — this is a recovery attempt
    // and should be subject to brute-force protection.
    if (!this.validateRecoveryPhrase(phrase)) {
      throw new Error("Invalid recovery phrase");
    }

    return await encryptionService.decrypt(encryptedPassword, sanitized);
  }
}

export const recoveryService = new RecoveryService();
