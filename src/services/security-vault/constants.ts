/**
 * src/services/security-vault/constants.ts
 *
 * Centralised storage keys and verification constants for the master-password
 * vault. Extracted from SecurityVault.ts (refactor, no behavior change).
 */

/**
 * Centralised storage keys for SecureStorage.
 * Single source of truth — import these instead of hardcoding strings.
 */
export const SECURE_STORAGE_KEYS = {
  RECOVERY_DATA: "recovery_data",
  API_KEY: "encrypted_api_key",
  DB_KEY: "encrypted_db_key",
  MASTER_PASSWORD_SETUP: "master_password_setup",
  VERIFICATION: "vault_verification",
  /**
   * A-1: random 16-byte per-vault Argon2id salt (32 hex chars). Not a secret —
   * it is stored next to the ciphertexts and embedded in every `v6:` payload —
   * only unique per vault, which is what defeats cross-user precomputed
   * dictionaries. Provisioned by security-vault/kdf-salt.ts.
   */
  KDF_SALT: "kdf_salt",
} as const;

/** Plaintext marker the verification token must decrypt to. */
export const VERIFICATION_PLAINTEXT = "bookmarkforge-verify-ok";

/**
 * Storage key for the S1 HMAC integrity record over the verification token.
 * Format: "<32-hex-nonce>:<64-hex-hmac>" — HMAC-SHA256 over the ciphertext,
 * keyed by HKDF-SHA256(password, salt=nonce, info="bmf-vault-verify-integrity").
 */
export const VERIFICATION_INTEGRITY_KEY = "vault_verification_integrity";
