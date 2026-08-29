import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("bip39", () => ({
  generateMnemonic: vi.fn((strength: number) => {
    if (strength === 256)
      return "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
    return "test ".repeat(24).trim();
  }),
  validateMnemonic: vi.fn((phrase: string) => {
    const words = phrase.split(" ").filter((w) => w.length > 0);
    return words.length === 24 && words.every((w) => /^[a-z]+$/.test(w));
  }),
  mnemonicToSeed: vi.fn().mockResolvedValue(new Uint8Array(64).fill(1)),
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    deriveKeyFromSeed: vi.fn().mockResolvedValue({} as CryptoKey),
    encrypt: vi.fn().mockResolvedValue("encrypted_result"),
    decrypt: vi.fn().mockResolvedValue("decrypted_result"),
  },
}));

// Mock safeStorage so tests can control whether safeSet throws.
// Default: succeeds (matches happy-dom where localStorage is available).
vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn((_key: string) => null),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
  safeClear: vi.fn(),
  safeSessionClear: vi.fn(),
}));

const recoveryService = await import("../../services/RecoveryService").then(
  (m) => m.recoveryService,
);

describe("RecoveryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (recoveryService as any).lastAttempt = 0;
    (recoveryService as any).attemptCount = 0;
  });

  describe("sanitizePhrase (private via validateRecoveryPhrase)", () => {
    it("normalizes multiple spaces", () => {
      // The sanitize is called internally by validateRecoveryPhrase
      const result = recoveryService.validateRecoveryPhrase(
        "abandon  abandon   abandon    abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art",
      );
      // After sanitizing: single spaces, 24 words
      expect(result).toBe(true);
    });

    it("converts to lowercase", () => {
      const phrase =
        "ABANDON abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ART";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(true);
    });

    it("replaces line breaks with spaces", () => {
      const phrase =
        "abandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nabandon\nart";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(true);
    });

    it("reemplaza tabs con espacios", () => {
      const phrase =
        "abandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tabandon\tart";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(true);
    });

    it("reemplaza carriage returns con espacios", () => {
      const phrase =
        "abandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rabandon\rart";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(true);
    });

    it("trim removes leading and trailing spaces", () => {
      const phrase =
        "  abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art  ";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(true);
    });
  });

  describe("validatePhraseFormat (via validateRecoveryPhrase)", () => {
    it("returns false for a very short phrase", () => {
      expect(recoveryService.validateRecoveryPhrase("corta")).toBe(false);
    });

    it("returns false for a phrase with special characters", () => {
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art!";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(false);
    });

    it("returns false for a phrase with numbers", () => {
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon 123";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(false);
    });

    it("returns false if word count is not 24", () => {
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(false);
    });
  });

  describe("generateRecoveryPhrase", () => {
    it("generates a 24-word phrase", () => {
      const phrase = recoveryService.generateRecoveryPhrase();
      const words = phrase.split(" ").filter((w) => w.length > 0);
      expect(words).toHaveLength(24);
    });

    it("generates phrase in lowercase", () => {
      const phrase = recoveryService.generateRecoveryPhrase();
      expect(phrase).toBe(phrase.toLowerCase());
    });

    it("llama a bip39.generateMnemonic con 256 bits", async () => {
      const bip39 = await import("bip39");
      recoveryService.generateRecoveryPhrase();
      expect(bip39.generateMnemonic).toHaveBeenCalledWith(256);
    });
  });

  describe("validateRecoveryPhrase", () => {
    it("validates a valid 24-word phrase", () => {
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(true);
    });

    it("returns false if the format is invalid (before bip39)", () => {
      expect(
        recoveryService.validateRecoveryPhrase("palabras insuficientes"),
      ).toBe(false);
    });

    it("returns false if bip39.validateMnemonic fails", async () => {
      const bip39 = await import("bip39");
      (bip39.validateMnemonic as any).mockReturnValueOnce(false);
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
      expect(recoveryService.validateRecoveryPhrase(phrase)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(recoveryService.validateRecoveryPhrase("")).toBe(false);
    });

    it("returns false for whitespace", () => {
      expect(recoveryService.validateRecoveryPhrase("   ")).toBe(false);
    });
  });

  describe("encryptMasterPasswordWithRecovery", () => {
    it("encripta usando encryptionService.encrypt", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
      const encrypted = await recoveryService.encryptMasterPasswordWithRecovery(
        "mi_password",
        phrase,
      );
      expect(encrypted).toBe("encrypted_result");
      expect(encryptionService.encrypt).toHaveBeenCalledWith(
        "mi_password",
        expect.any(String),
      );
    });

    it("throws error if the phrase is invalid", async () => {
      await expect(
        recoveryService.encryptMasterPasswordWithRecovery(
          "pass",
          "frase inválida",
        ),
      ).rejects.toThrow("Invalid recovery phrase");
    });

    it("rejects an empty master password before encryption", async () => {
      await expect(
        recoveryService.encryptMasterPasswordWithRecovery("", "invalid"),
      ).rejects.toThrow("Master password cannot be empty");
    });

    it("sanitizes the phrase before encrypting", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const phrase =
        "  ABANDON abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ART  ";
      await recoveryService.encryptMasterPasswordWithRecovery("pass", phrase);
      // It must have sanitized (lowercase, trim, single spaces)
      const sanitizedArg = (encryptionService.encrypt as any).mock.calls[0][1];
      expect(sanitizedArg).toBe(sanitizedArg.toLowerCase());
      expect(sanitizedArg).not.toContain("  ");
    });
  });

  describe("decryptMasterPasswordWithRecovery", () => {
    it("desencripta usando encryptionService.decrypt", async () => {
      const { encryptionService } =
        await import("../../services/EncryptionService");
      const phrase =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
      const decrypted = await recoveryService.decryptMasterPasswordWithRecovery(
        "encrypted_data",
        phrase,
      );
      expect(decrypted).toBe("decrypted_result");
      expect(encryptionService.decrypt).toHaveBeenCalledWith(
        "encrypted_data",
        expect.any(String),
      );
    });

    it("throws error if the phrase is invalid", async () => {
      await expect(
        recoveryService.decryptMasterPasswordWithRecovery("data", "invalida"),
      ).rejects.toThrow("Invalid recovery phrase");
    });

    it("rejects an empty encrypted payload before recovery validation", async () => {
      await expect(
        recoveryService.decryptMasterPasswordWithRecovery("", "invalid"),
      ).rejects.toThrow("Invalid encrypted password");
    });
  });

  describe("recoveryService exportado", () => {
    it("exists and has methods", () => {
      expect(recoveryService).toBeDefined();
      expect(typeof recoveryService.generateRecoveryPhrase).toBe("function");
      expect(typeof recoveryService.validateRecoveryPhrase).toBe("function");
      expect(typeof recoveryService.encryptMasterPasswordWithRecovery).toBe(
        "function",
      );
      expect(typeof recoveryService.decryptMasterPasswordWithRecovery).toBe(
        "function",
      );
    });
  });

  // ============================================================
  // BRANCH TESTS — Rate limiting, lockout, format edge cases
  // ============================================================

  describe("validateRecoveryPhrase — lockout rate-limiting", () => {
    const VALID_PHRASE =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

    beforeEach(() => {
      (recoveryService as any).attemptCount = 0;
      (recoveryService as any).lastAttempt = 0;
    });

    it("should block when attemptCount >= 10 and lockout period has NOT expired", () => {
      // Arrange: simulate 10 failed attempts just now
      (recoveryService as any).attemptCount = 10;
      (recoveryService as any).lastAttempt = Date.now();

      // Act & Assert: lockout active → return false
      expect(recoveryService.validateRecoveryPhrase(VALID_PHRASE)).toBe(false);
    });

    it("should reset attemptCount when lockout period has expired (>= 5 min)", () => {
      // Arrange: 10 attempts from 6 minutes ago → lockout expired
      (recoveryService as any).attemptCount = 10;
      (recoveryService as any).lastAttempt = Date.now() - 6 * 60 * 1000; // 6 min

      // Act
      const result = recoveryService.validateRecoveryPhrase(VALID_PHRASE);

      // Assert: lockout expired → attemptCount reset → proceeds to validate
      expect(result).toBe(true);
      expect((recoveryService as any).attemptCount).toBe(1); // was reset to 0, then +1
    });

    it("should rate-limit when called within MIN_INTERVAL_MS (2s) of last attempt", () => {
      // Arrange: make a successful call first → sets lastAttempt
      recoveryService.validateRecoveryPhrase(VALID_PHRASE);

      // Act: immediate second call (within 2s window)
      const result = recoveryService.validateRecoveryPhrase(VALID_PHRASE);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("validateRecoveryPhrase — format edge cases", () => {
    it("should reject phrases longer than 300 characters", () => {
      // 24 words of 13 chars each + 23 spaces = 335 chars > 300
      const longWords = Array(24).fill("abcdefghijklm").join(" ");

      expect(recoveryService.validateRecoveryPhrase(longWords)).toBe(false);
    });
  });

  describe("syncToStorage — catch when safeSet throws", () => {
    afterEach(() => {
      (recoveryService as any).attemptCount = 0;
      (recoveryService as any).lastAttempt = 0;
    });

    it("should silently no-op when safeSet throws", async () => {
      // Re-import safeStorage mock from the hoisted mock
      const { safeSet } = await import("../../store/safeStorage");
      // mockImplementationOnce: only the first safeSet call throws;
      // once consumed, safeSet reverts to vi.fn() (no-op).
      // syncToStorage calls safeSet twice, but the first exception
      // lands in the catch(_err) and the second never runs.
      (safeSet as any).mockImplementationOnce(() => {
        throw new Error("storage unavailable");
      });

      const VALID_PHRASE =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

      // Act & Assert: safeSet throws → syncToStorage lo atrapa
      // Note: calling it twice in a row activates the rate limiter
      // (MIN_INTERVAL_MS = 2000ms). A single call verifies
      // that it does not throw AND returns the correct value.
      const result = recoveryService.validateRecoveryPhrase(VALID_PHRASE);
      expect(result).toBe(true);
    });
  });

  describe("constructor — stored values via safeGet mock", () => {
    it("should initialize with stored attempt count and last attempt from safeGet", async () => {
      const { safeGet } = await import("../../store/safeStorage");
      const { STORAGE_KEYS } = await import("../../constants/storage-keys");

      // Configure safeGet to return stored values before module load
      const storedLast = Date.now() - 60000;
      (safeGet as any).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT) return "5";
        if (key === STORAGE_KEYS.RECOVERY_LAST_ATTEMPT) return String(storedLast);
        return null;
      });

      vi.resetModules();
      const { recoveryService: freshService } = await import(
        "../../services/RecoveryService",
      );

      // Constructor should have read the mocked safeGet values
      expect((freshService as any).attemptCount).toBe(5);
      expect((freshService as any).lastAttempt).toBe(storedLast);

      // Now validate: attemptCount=5 (<10), lastAttempt 60s ago (>2s) → proceeds
      const VALID_PHRASE =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
      expect(freshService.validateRecoveryPhrase(VALID_PHRASE)).toBe(true);
    });
  });

  describe("constructor — stored values from localStorage", () => {
    it("should initialize with stored attempt count and last attempt from localStorage", async () => {
      vi.resetModules();

      const { STORAGE_KEYS } = await import("../../constants/storage-keys");
      localStorage.setItem(
        STORAGE_KEYS.RECOVERY_LAST_ATTEMPT,
        String(Date.now() - 60000),
      );
      localStorage.setItem(STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT, "5");

      const { recoveryService: freshService } = await import(
        "../../services/RecoveryService"
      );

      const VALID_PHRASE =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

      expect(freshService.validateRecoveryPhrase(VALID_PHRASE)).toBe(true);

      localStorage.removeItem(STORAGE_KEYS.RECOVERY_LAST_ATTEMPT);
      localStorage.removeItem(STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT);
    });
  });

  describe("constructor — no stored values (safeGet returns null)", () => {
    it("should initialize with zeros when safeGet returns null", async () => {
      // Reset safeGet implementation because vi.resetModules() does NOT
      // re-evaluate vi.mock() factories — the previous test's
      // mockImplementation("5") persists across resetModules().
      const { safeGet } = await import("../../store/safeStorage");
      (safeGet as any).mockImplementation((_key: string) => null);

      vi.resetModules();

      const { recoveryService: freshService } = await import(
        "../../services/RecoveryService",
      );

      expect((freshService as any).attemptCount).toBe(0);
      expect((freshService as any).lastAttempt).toBe(0);
    });
  });

  describe("constructor — non-numeric stored values (parseInt NaN edge case)", () => {
    it("should default to 0 when stored values are non-numeric strings", async () => {
      const { safeGet } = await import("../../store/safeStorage");
      const { STORAGE_KEYS } = await import("../../constants/storage-keys");

      // Configure safeGet to return non-numeric strings
      (safeGet as any).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT) return "abc";
        if (key === STORAGE_KEYS.RECOVERY_LAST_ATTEMPT) return "def";
        return null;
      });

      vi.resetModules();
      const { recoveryService: freshService } = await import(
        "../../services/RecoveryService",
      );

      // parseInt("abc", 10) → NaN → NaN || 0 → 0
      expect((freshService as any).attemptCount).toBe(0);
      expect((freshService as any).lastAttempt).toBe(0);
    });

    it("clamps malicious future timestamps and negative attempt counts", async () => {
      const { safeGet } = await import("../../store/safeStorage");
      const { STORAGE_KEYS } = await import("../../constants/storage-keys");
      const future = Date.now() + 24 * 60 * 60 * 1000;
      (safeGet as any).mockImplementation((key: string) => {
        if (key === STORAGE_KEYS.RECOVERY_ATTEMPT_COUNT) return "-4";
        if (key === STORAGE_KEYS.RECOVERY_LAST_ATTEMPT) return String(future);
        return null;
      });

      vi.resetModules();
      const { recoveryService: freshService } = await import(
        "../../services/RecoveryService",
      );

      expect((freshService as any).attemptCount).toBe(0);
      expect((freshService as any).lastAttempt).toBeLessThanOrEqual(Date.now());
    });
  });
});
