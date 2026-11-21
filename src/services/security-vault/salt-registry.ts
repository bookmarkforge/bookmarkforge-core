/**
 * src/services/security-vault/salt-registry.ts
 *
 * ADR-053 — single code-level registry of the per-vault salt keys.
 *
 * Consolidates the *registry* (storage keys, lifecycle governance, sync
 * semantics) of every per-vault salt. It deliberately does NOT consolidate
 * the values: the two salts are independent CSPRNG outputs with different
 * lifecycles, and merging their inputs would silently re-key existing
 * vaults (ADR-053 A-1).
 *
 * The on-disk key names are persisted format (ADR-053 A-2): `vault_salt` and
 * `kdf_salt` must never be renamed without a valued migration.
 *
 * Lifecycle asymmetry is contractual (ADR-053 decision 3):
 *   - `KDF_SALT` (kdf_salt) rotates with the master password (ADR-046).
 *   - `DB_SALT` (db_salt, on disk "vault_salt") is minted once and never
 *     rotates; password rotation re-wraps `encrypted_db_key` instead.
 * The ADR-046 rollback table must never be "completed" with `db_salt`.
 *
 * Consumers import their storage key from here; scattering the literal
 * `"vault_salt"` (or any descriptor storageKey) outside this file's
 * descriptor is a registry violation (ADR-053 decision 1).
 */

import { SECURE_STORAGE_KEYS } from "./constants";

/** Purpose tags keep diagnostics readable without leaking secret material. */
export type VaultSaltPurpose = "master-kdf" | "db-key-kdf";

export interface VaultSaltDescriptor {
  /** Shared storage-key constant (single source of truth for readers/writers). */
  storageKey: string;
  /** Human-readable purpose for diagnostics and logs (no secrets). */
  purpose: VaultSaltPurpose;
  /** ADR governing this salt's lifecycle. */
  governance: string;
  /** Does the salt rotate when the master password rotates? */
  rotatesWithPassword: boolean;
  /** Does the salt require cross-tab propagation (kdf-salt-sync)? */
  syncCrossTab: boolean;
}

/** Master-corpus KDF salt. Full lifecycle (provision/rotate/snapshot/rollback/sync) in security-vault/kdf-salt.ts, governed by ADR-046. */
export const KDF_SALT_DESCRIPTOR: VaultSaltDescriptor = {
  storageKey: SECURE_STORAGE_KEYS.KDF_SALT,
  purpose: "master-kdf",
  governance: "ADR-046",
  rotatesWithPassword: true,
  syncCrossTab: true,
};

/**
 * RxDB storage-key KDF salt (on-disk key "vault_salt"). Input of
 * deriveDbKey (crypto-core). Minted once per vault with CSPRNG by
 * database.ts; never rotates — password rotation re-wraps encrypted_db_key
 * under the v6 master layer and derives a fresh DB key from the SAME salt
 * (ADR-053 decision 3). Excluded from the ADR-046 snapshot/rollback table
 * by contract.
 */
export const DB_SALT_DESCRIPTOR: VaultSaltDescriptor = {
  storageKey: "vault_salt",
  purpose: "db-key-kdf",
  governance: "ADR-053",
  rotatesWithPassword: false,
  syncCrossTab: false,
};

/** Registry iteration order is diagnostic-only; it carries no semantics. */
export const VAULT_SALT_REGISTRY = [
  KDF_SALT_DESCRIPTOR,
  DB_SALT_DESCRIPTOR,
] as const;

/**
 * The on-disk key names are persisted format (ADR-053 A-2): renaming one
 * without a valued migration bricks existing vaults. Do not edit these
 * values; see ADR-053 A-2/A-4 before even considering it.
 */
export const FORBIDDEN_DISK_RENAMES: ReadonlySet<string> = new Set(
  VAULT_SALT_REGISTRY.map((descriptor) => descriptor.storageKey),
);

/**
 * Registry invariant guard (ADR-053 decision 1): throws if a second entry
 * ever claims the same on-disk key or a duplicate purpose — the two failure
 * modes that would silently merge independent salt lifecycles.
 */
function assertRegistryInvariants(): void {
  const diskKeys = new Set<string>();
  const purposes = new Set<VaultSaltPurpose>();
  for (const descriptor of VAULT_SALT_REGISTRY) {
    if (diskKeys.has(descriptor.storageKey)) {
      throw new Error(
        `[salt-registry] invariant violated: duplicate storageKey "${descriptor.storageKey}" — per-vault salts must never share a disk key (ADR-053 A-1/A-4)`,
      );
    }
    diskKeys.add(descriptor.storageKey);
    if (purposes.has(descriptor.purpose)) {
      throw new Error(
        `[salt-registry] invariant violated: duplicate purpose "${descriptor.purpose}" — one salt per lifecycle (ADR-053 decision 6)`,
      );
    }
    purposes.add(descriptor.purpose);
  }
}

assertRegistryInvariants();
