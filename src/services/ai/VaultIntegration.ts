import { securityVault, SECURE_STORAGE_KEYS } from "../SecurityVault";
import { logger } from "../../utils/logger";

type ApiKeyListener = (key: string | null) => void;

/**
 * VaultIntegration - Handles security vault integration for API keys
 * Manages encryption, decryption, and storage of sensitive credentials
 */
export class VaultIntegration {
  private externalApiKey: string | null = null;
  private apiKeyListeners = new Set<ApiKeyListener>();

  constructor() {
    // SECURITY (S9): keep the in-memory API key in sync with the vault state.
    // Every lock path (auto-lock, manual lock, nuclear forget, failed unlock)
    // must purge the decrypted key from memory immediately; unlocking reloads
    // it so cloud AI keeps working regardless of which flow unlocked the vault
    // (SecurityManager, useMainAppState, etc.).
    securityVault.onLock(() => this.clearApiKey());
    securityVault.onUnlock(() => {
      this.reloadApiKeyFromVault()
        .then(() => this.notifyApiKeyListeners(this.externalApiKey))
        .catch((err) =>
          logger.warn("[VaultIntegration] Failed to reload API key on unlock", {
            error: err,
          }),
        );
    });
  }

  /**
   * Subscribe to API key state changes so owners of OTHER in-memory key copies
   * (e.g. the OpenAICompatibleProvider held by ProviderConfiguration) can purge
   * on lock and rehydrate on unlock. Returns an unsubscribe function.
   */
  onApiKeyChange(cb: ApiKeyListener): () => void {
    this.apiKeyListeners.add(cb);
    return () => {
      this.apiKeyListeners.delete(cb);
    };
  }

  private notifyApiKeyListeners(key: string | null): void {
    for (const cb of this.apiKeyListeners) {
      try {
        cb(key);
      } catch (_err) {
        // Listener errors are non-fatal — a buggy subscriber must not break
        // the vault lock/unlock purge contract.
      }
    }
  }

  /**
   * Best-effort reload of the decrypted API key after the vault unlocks.
   * No-op when the vault is locked again or no key is stored.
   */
  private async reloadApiKeyFromVault(): Promise<void> {
    if (securityVault.isLocked()) {return;}
    const hasKey = await securityVault.hasSecret(SECURE_STORAGE_KEYS.API_KEY);
    if (!hasKey) {return;}
    try {
      const decrypted = await securityVault.decryptSecret(
        SECURE_STORAGE_KEYS.API_KEY,
      );
      // SECURITY (S9): the vault may have locked again while the async
      // decrypt was in flight. Never assign the key after a lock — the
      // onLock listener already purged it. The check is synchronous with
      // the assignment, so there is no TOCTOU window here.
      if (securityVault.isLocked()) {return;}
      if (decrypted) {this.externalApiKey = decrypted;}
    } catch (e) {
      logger.warn("[VaultIntegration] API key decrypt failed on unlock", {
        error: e,
      });
    }
  }

  /**
   * Returns true if there is a stored API key AND the vault is locked.
   * If no API key is stored, returns false (nothing to protect → effectively unlocked).
   */
  async isVaultLocked(): Promise<boolean> {
    const hasKey = await securityVault.hasSecret(SECURE_STORAGE_KEYS.API_KEY);
    if (!hasKey) {return false;}
    return securityVault.isLocked();
  }

  /**
   * Returns whether an API key exists in secure storage (regardless of vault lock state).
   */
  async hasStoredApiKey(): Promise<boolean> {
    return await securityVault.hasSecret(SECURE_STORAGE_KEYS.API_KEY);
  }

  /**
   * Unlock the vault with master password
   */
  async unlockVault(password: string): Promise<boolean> {
    try {
      const unlocked = await securityVault.unlock(password);
      if (!unlocked) {
        throw new Error(
          "Failed to unlock vault: invalid password or rate limited",
        );
      }
      // Try to decrypt existing API key — may not exist (e.g. fresh vault, tests)
      const hasApiKey = await securityVault.hasSecret(SECURE_STORAGE_KEYS.API_KEY);
      if (hasApiKey) {
        try {
          const decrypted =
            await securityVault.decryptSecret(SECURE_STORAGE_KEYS.API_KEY);
          if (decrypted) {
            this.externalApiKey = decrypted;
          }
        } catch (e) {
          logger.warn("[VaultIntegration] API key decryption failed", {
            error: e,
          });
        }
      }
      return true;
    } catch (e) {
      logger.error("[VaultIntegration] Failed to unlock vault", { error: e });
      securityVault.lock();
      return false;
    }
  }

  /**
   * Update master password and re-encrypt API key
   */
  async updateMasterPassword(newPassword: string): Promise<void> {
    const success = await securityVault.rotateMasterPassword(newPassword);
    if (!success) {
      throw new Error("Failed to rotate master password");
    }
    if (this.externalApiKey) {
      await this.setApiKey(this.externalApiKey);
    }
  }

  /**
   * Set and encrypt API key
   * @param key - The API key to store (must be a valid format)
   * @returns Promise<void>
   */
  async setApiKey(key: string): Promise<void> {
    if (!key || typeof key !== "string" || !key.trim()) {
      throw new Error("API key cannot be empty");
    }

    const trimmedKey = key.trim();

    // Validate API key format based on provider type
    if (!this.validateApiKeyFormat(trimmedKey)) {
      throw new Error(
        "Invalid API key format. Please check the key and try again.",
      );
    }

    if (securityVault.isLocked()) {
      throw new Error(
        "Please set a master password in Security settings before saving API keys",
      );
    }

    // Only keep the key in memory AFTER confirming the vault is unlocked, so
    // a rejected save (locked vault) never leaves the key resident in RAM.
    this.externalApiKey = trimmedKey;
    this.notifyApiKeyListeners(trimmedKey);

    await securityVault.encryptSecret(trimmedKey, SECURE_STORAGE_KEYS.API_KEY);
  }

  /**
   * Validate API key format
   */
  private validateApiKeyFormat(key: string): boolean {
    if (key.length < 10) {return false;}

    // Check for OpenAI format (sk-)
    if (key.startsWith("sk-")) {return true;}

    // Check for Gemini format (AIza)
    if (key.startsWith("AIza")) {return true;}

    // Check for Anthropic format (sk-ant-)
    if (key.startsWith("sk-ant-")) {return true;}

    // Check for Groq format (gsk_)
    if (key.startsWith("gsk_")) {return true;}

    // Custom key format - allow alphanumeric and common special chars
    return /^[a-zA-Z0-9_-]+$/.test(key);
  }

  /**
   * Get the decrypted API key
   */
  getApiKey(): string | null {
    return this.externalApiKey;
  }

  /**
   * Clear the API key from memory (also notifies subscribers so dependent
   * key copies — e.g. OpenAICompatibleProvider — are purged too).
   */
  clearApiKey(): void {
    this.externalApiKey = null;
    this.notifyApiKeyListeners(null);
  }
}
