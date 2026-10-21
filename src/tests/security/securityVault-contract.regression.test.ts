// Regression: pins the PUBLIC contract of the securityVault singleton after
// the security-vault/ module split (refactor, no behavior change). A rename or
// removal of a public method, a dropped SECURE_STORAGE_KEYS re-export, or a
// change to the canonical storage-key set breaks here instead of silently
// altering the vault API for its ~30 importers.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  SECURE_STORAGE_KEYS,
  securityVault,
} from "../../services/SecurityVault";

const ROOT = path.resolve(__dirname, "../../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const vaultSource = readRepoFile("src/services/SecurityVault.ts");
const constantsSource = readRepoFile(
  "src/services/security-vault/constants.ts",
);

/** Public methods declared on the SecurityVault class (non-private). */
const PUBLIC_METHODS = [
  "unlock",
  "verifyPasswordRateLimited",
  "decryptShareWithRateLimit",
  "unlockFromShare",
  "getSessionToken",
  "lock",
  "isLocked",
  "onLock",
  "onUnlock",
  "deriveBridgeKey",
  "registerCaller",
  "encryptSecret",
  "decryptSecret",
  "setRecoveryData",
  "getRecoveryData",
  "hasRecoveryData",
  "clearRecoveryData",
  "migrateFromLocalStorage",
  "hasSecret",
  "rotateMasterPassword",
  "deleteSecret",
  "hasMasterPassword",
  "setMasterPasswordFlag",
] as const;

/** Canonical storage keys re-exported from the cohesive constants module. */
const STORAGE_KEYS = {
  RECOVERY_DATA: "recovery_data",
  API_KEY: "encrypted_api_key",
  DB_KEY: "encrypted_db_key",
  MASTER_PASSWORD_SETUP: "master_password_setup",
  VERIFICATION: "vault_verification",
  // A-1: per-vault Argon2id salt (public metadata, embedded in v6 payloads).
  KDF_SALT: "kdf_salt",
} as const;

describe("securityVault public contract (post-split regression)", () => {
  it("re-exports SECURE_STORAGE_KEYS from the cohesive constants module", () => {
    expect(vaultSource).toMatch(
      /export \{ SECURE_STORAGE_KEYS \} from "\.\/security-vault\/constants";/,
    );
    // The canonical key→value pairs live in constants.ts (single source of
    // truth); the re-export must not drift from them.
    for (const key of Object.keys(STORAGE_KEYS) as (keyof typeof STORAGE_KEYS)[]) {
      expect(constantsSource).toContain(`${key}: "${STORAGE_KEYS[key]}"`);
    }
  });

  it("exports the securityVault singleton", () => {
    expect(vaultSource).toMatch(
      /export const securityVault = new SecurityVault\(\);/,
    );
  });

  it("declares every public method as non-private in the class source", () => {
    for (const method of PUBLIC_METHODS) {
      expect(vaultSource, `public method ${method}`).toMatch(
        new RegExp(`^  (?:async )?${method}\\(`, "m"),
      );
      expect(vaultSource, `public method ${method} must not be private`).not.toMatch(
        new RegExp(`^  private (?:async )?${method}\\(`, "m"),
      );
    }
  });

  it("exposes every public method and the storage-key set at runtime", () => {
    for (const method of PUBLIC_METHODS) {
      expect(
        typeof (securityVault as unknown as Record<string, unknown>)[method],
        `securityVault.${method}`,
      ).toBe("function");
    }
    expect(SECURE_STORAGE_KEYS).toEqual(STORAGE_KEYS);
  });
});
