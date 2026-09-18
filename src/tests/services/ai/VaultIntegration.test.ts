import { describe, it, expect, vi, beforeEach } from "vitest";

// Emitter harness for the onLock/onUnlock subscription API so tests can
// simulate vault transitions against the REAL VaultIntegration.
const lockListeners = new Set<() => void>();
const unlockListeners = new Set<() => void>();

const mockSecurityVault = {
  hasSecret: vi.fn(),
  isLocked: vi.fn(),
  unlock: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  lock: vi.fn(() => {
    lockListeners.forEach((l) => l());
  }),
  rotateMasterPassword: vi.fn(),
  onLock: vi.fn((cb: () => void) => {
    lockListeners.add(cb);
    return () => lockListeners.delete(cb);
  }),
  onUnlock: vi.fn((cb: () => void) => {
    unlockListeners.add(cb);
    return () => unlockListeners.delete(cb);
  }),
  // Test helper: simulates a successful unlock WITHOUT going through the
  // real unlock() flow (keeps existing unlockVault tests unaffected).
  __emitUnlock: () => unlockListeners.forEach((l) => l()),
};

vi.mock("../../../services/SecurityVault", () => ({
  securityVault: mockSecurityVault,
  SECURE_STORAGE_KEYS: {
    RECOVERY_DATA: "recovery_data",
    API_KEY: "encrypted_api_key",
    DB_KEY: "encrypted_db_key",
    MASTER_PASSWORD_SETUP: "master_password_setup",
    VERIFICATION: "vault_verification",
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { VaultIntegration } =
  await import("../../../services/ai/VaultIntegration");

describe("VaultIntegration", () => {
  let vault: InstanceType<typeof VaultIntegration>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Keep vault-transition emissions deterministic: only the current test's
    // VaultIntegration (created below) should receive lock/unlock events.
    lockListeners.clear();
    unlockListeners.clear();
    vault = new VaultIntegration();
  });

  describe("isVaultLocked", () => {
    it("returns false when there is no encrypted_api_key", async () => {
      mockSecurityVault.hasSecret.mockResolvedValue(false);
      const result = await vault.isVaultLocked();
      expect(result).toBe(false);
      expect(mockSecurityVault.isLocked).not.toHaveBeenCalled();
    });

    it("returns isLocked when there is an encrypted_api_key", async () => {
      mockSecurityVault.hasSecret.mockResolvedValue(true);
      mockSecurityVault.isLocked.mockReturnValue(true);
      const result = await vault.isVaultLocked();
      expect(result).toBe(true);
    });

    it("returns false if vault is not locked", async () => {
      mockSecurityVault.hasSecret.mockResolvedValue(true);
      mockSecurityVault.isLocked.mockReturnValue(false);
      const result = await vault.isVaultLocked();
      expect(result).toBe(false);
    });
  });

  describe("unlockVault", () => {
    it("returns true if decrypt succeeds", async () => {
      mockSecurityVault.unlock.mockReturnValue(true);
      mockSecurityVault.decryptSecret.mockResolvedValue("my-api-key");
      const result = await vault.unlockVault("password");
      expect(result).toBe(true);
      expect(mockSecurityVault.unlock).toHaveBeenCalledWith("password");
    });

    it("returns false if decrypt returns null", async () => {
      mockSecurityVault.unlock.mockReturnValue(undefined);
      mockSecurityVault.decryptSecret.mockResolvedValue(null);
      const result = await vault.unlockVault("password");
      expect(result).toBe(false);
    });

    it("returns false and relocks if decrypt fails", async () => {
      mockSecurityVault.unlock.mockReturnValue(undefined);
      mockSecurityVault.decryptSecret.mockRejectedValue(
        new Error("decrypt fail"),
      );
      const result = await vault.unlockVault("bad-password");
      expect(result).toBe(false);
      expect(mockSecurityVault.lock).toHaveBeenCalled();
    });
  });

  describe("setApiKey", () => {
    const VALID_KEY = "sk-key-1234567";

    it("throws error if vault is locked", async () => {
      mockSecurityVault.isLocked.mockReturnValue(true);
      await expect(vault.setApiKey(VALID_KEY)).rejects.toThrow(
        "master password",
      );
      expect(mockSecurityVault.encryptSecret).not.toHaveBeenCalled();
    });

    it("encrypts the key if vault is not locked", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      await vault.setApiKey(VALID_KEY);
      expect(mockSecurityVault.encryptSecret).toHaveBeenCalledWith(
        VALID_KEY,
        "encrypted_api_key",
      );
    });
  });

  describe("getApiKey / clearApiKey", () => {
    const VALID_KEY = "sk-my-key-12345";

    it("returns null initially", () => {
      expect(vault.getApiKey()).toBeNull();
    });

    it("returns key after setApiKey", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      await vault.setApiKey(VALID_KEY);
      expect(vault.getApiKey()).toBe(VALID_KEY);
    });

    it("clears the key with clearApiKey", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      await vault.setApiKey(VALID_KEY);
      vault.clearApiKey();
      expect(vault.getApiKey()).toBeNull();
    });
  });

  describe("lock/unlock listeners (S9 - clave en memoria sincronizada)", () => {
    const VALID_KEY = "sk-my-key-12345";

    it("purges the API key from memory when the vault locks", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      await vault.setApiKey(VALID_KEY);
      expect(vault.getApiKey()).toBe(VALID_KEY);

      mockSecurityVault.isLocked.mockReturnValue(true);
      mockSecurityVault.lock();

      expect(vault.getApiKey()).toBeNull();
    });

    it("reloads the API key from the vault on unlock", async () => {
      mockSecurityVault.isLocked.mockReturnValue(true);
      mockSecurityVault.hasSecret.mockResolvedValue(true);
      mockSecurityVault.decryptSecret.mockResolvedValue("reloaded-key");

      // Simulate a vault transition to unlocked.
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.__emitUnlock();

      // reloadApiKeyFromVault runs fire-and-forget (async listener).
      await new Promise((r) => setTimeout(r, 0));
      expect(vault.getApiKey()).toBe("reloaded-key");
    });

    it("does not reload the key if the vault locks again", async () => {
      mockSecurityVault.isLocked.mockReturnValue(true);
      mockSecurityVault.hasSecret.mockResolvedValue(true);
      mockSecurityVault.decryptSecret.mockResolvedValue("stale-key");

      mockSecurityVault.__emitUnlock();
      await new Promise((r) => setTimeout(r, 0));

      // isLocked() was true when it ran → must not load the key
      expect(vault.getApiKey()).toBeNull();
      expect(mockSecurityVault.decryptSecret).not.toHaveBeenCalled();
    });

    it("does not reload the key when no key is stored", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.hasSecret.mockResolvedValue(false);
      mockSecurityVault.decryptSecret.mockResolvedValue("should-not-load");

      mockSecurityVault.__emitUnlock();
      await new Promise((r) => setTimeout(r, 0));

      expect(vault.getApiKey()).toBeNull();
      expect(mockSecurityVault.decryptSecret).not.toHaveBeenCalled();
    });

    it("does not re-populate the key if the vault locks during reload", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      // The vault locks while the async reload is in flight
      // (hasSecret pending) — the decrypt result must be discarded.
      mockSecurityVault.hasSecret.mockImplementation(async () => {
        mockSecurityVault.isLocked.mockReturnValue(true);
        lockListeners.forEach((l) => l()); // simula securityVault.lock()
        return true;
      });
      mockSecurityVault.decryptSecret.mockResolvedValue("leaked-key");

      mockSecurityVault.__emitUnlock();
      await new Promise((r) => setTimeout(r, 0));

      expect(vault.getApiKey()).toBeNull();
      expect(mockSecurityVault.decryptSecret).toHaveBeenCalled();
    });

    it("unlockVault after a lock reloads the key and unlocks", async () => {
      mockSecurityVault.isLocked.mockReturnValue(true);
      await vault.setApiKey(VALID_KEY).catch(() => {
        /* INTENTIONAL SILENCE: vault locked → setApiKey throws; expected test path. */
      });
      expect(vault.getApiKey()).toBeNull();

      mockSecurityVault.unlock.mockReturnValue(true);
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.hasSecret.mockResolvedValue(true);
      mockSecurityVault.decryptSecret.mockResolvedValue(VALID_KEY);

      const result = await vault.unlockVault("password");
      expect(result).toBe(true);
      expect(vault.getApiKey()).toBe(VALID_KEY);
    });
  });

  describe("onApiKeyChange (S9 - notification to dependent copies)", () => {
    const VALID_KEY = "sk-my-key-12345";

    it("notifies the key when calling setApiKey", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      const listener = vi.fn();
      vault.onApiKeyChange(listener);

      await vault.setApiKey(VALID_KEY);

      expect(listener).toHaveBeenCalledWith(VALID_KEY);
    });

    it("notifies null when the vault locks (key cleanup)", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      await vault.setApiKey(VALID_KEY);
      const listener = vi.fn();
      vault.onApiKeyChange(listener);

      mockSecurityVault.isLocked.mockReturnValue(true);
      mockSecurityVault.lock(); // dispara lockListeners → clearApiKey → notify(null)

      expect(listener).toHaveBeenCalledWith(null);
      expect(vault.getApiKey()).toBeNull();
    });

    it("notifies the reloaded key after an unlock", async () => {
      mockSecurityVault.isLocked.mockReturnValue(true);
      mockSecurityVault.hasSecret.mockResolvedValue(true);
      mockSecurityVault.decryptSecret.mockResolvedValue("reloaded-key");
      const listener = vi.fn();
      vault.onApiKeyChange(listener);

      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.__emitUnlock();
      await new Promise((r) => setTimeout(r, 0));

      expect(listener).toHaveBeenCalledWith("reloaded-key");
    });

    it("notifies null if the unlock does not reload any key", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.hasSecret.mockResolvedValue(false);
      mockSecurityVault.decryptSecret.mockResolvedValue("should-not-load");
      const listener = vi.fn();
      vault.onApiKeyChange(listener);

      mockSecurityVault.__emitUnlock();
      await new Promise((r) => setTimeout(r, 0));

      expect(listener).toHaveBeenCalledWith(null);
    });

    it("unsubscribe stops notifications", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      const listener = vi.fn();
      const unsubscribe = vault.onApiKeyChange(listener);
      unsubscribe();

      await vault.setApiKey(VALID_KEY);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("updateMasterPassword", () => {
    const VALID_KEY = "sk-my-key-12345";

    it("throws if rotate fails", async () => {
      mockSecurityVault.rotateMasterPassword.mockResolvedValue(false);
      await expect(vault.updateMasterPassword("new-pass")).rejects.toThrow(
        "rotate",
      );
    });

    it("re-encripta API key si existe", async () => {
      mockSecurityVault.isLocked.mockReturnValue(false);
      mockSecurityVault.encryptSecret.mockResolvedValue(undefined);
      await vault.setApiKey(VALID_KEY);
      mockSecurityVault.rotateMasterPassword.mockResolvedValue(true);
      await vault.updateMasterPassword("new-pass");
      expect(mockSecurityVault.encryptSecret).toHaveBeenCalledWith(
        VALID_KEY,
        "encrypted_api_key",
      );
    });
  });
});
