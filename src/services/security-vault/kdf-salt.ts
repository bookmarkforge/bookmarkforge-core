/**
 * src/services/security-vault/kdf-salt.ts
 *
 * A-1: per-vault Argon2id salt provisioning and transparent migration.
 * Decision record: `docs/ADR-046-vault-kdf-salt-rotation.md` (rotation with the
 * master password and its rollback contract).
 *
 * Problem this file solves: the v5/session master-key derivations used to run
 * Argon2id against a CONSTANT, bundle-wide salt (`bookmarkforge-v5-master-key`
 * / `bookmarkforge-session-master-key-v6`). A shared salt means one Argon2id
 * pass over a candidate password can be reused against every vault on the
 * planet: an attacker who harvests password-encrypted blobs (verification
 * token, encrypted_db_key, encrypted_api_key, recovery records) can build one
 * dictionary and test it against the whole corpus (RFC 9106 requires a unique
 * salt per password).
 *
 * Fix: every vault mints a random 16-byte salt, stores it here, and installs it
 * in the crypto layer (`EncryptionService.configureVaultKdfSalt`). New payloads
 * are `v6:` and EMBED the salt, so:
 *   - decryption never depends on local storage state (shares, backups and
 *     pre-migration blobs all keep working, even if the stored salt is lost);
 *   - `v5:` payloads written before the upgrade keep decrypting with the legacy
 *     fixed salt (read-compat, no data loss), and are re-wrapped opportunistically
 *     (see `migrateVaultSecretsToVaultSalt` + `createVerificationToken`).
 *
 * The salt is public metadata, not key material: it is never required to be
 * secret, only unique per vault.
 *
 * Rotation: a master-password rotation also re-mints the salt
 * (`rotateVaultKdfSalt`), and `restoreVaultKdfSalt` puts the previous salt
 * back when that rotation rolls back. A password change is the one moment the
 * salt MUST change with it — see the function docs, and
 * `docs/ADR-046-vault-kdf-salt-rotation.md` for the full decision record.
 *
 * Cross-tab: a tab that is already open keeps the salt in MODULE state, so it
 * would otherwise keep writing under a salt the vault has just retired.
 * `adoptVaultKdfSaltFromStorage` is the storage-authoritative half of the fix
 * (the notification itself lives in `kdf-salt-sync.ts`): it re-reads the salt
 * the rotating tab persisted instead of trusting anything that arrived over
 * the wire.
 */

import { encryptionService } from "../EncryptionService";
import { secureStorage } from "../SecureStorage";
import { logger } from "../../utils/logger";
import { SECURE_STORAGE_KEYS } from "./constants";
import {
  KDF_SALT_DESCRIPTOR,
  VAULT_SALT_REGISTRY,
  type VaultSaltPurpose,
} from "./salt-registry";
import { zeroPasswordBytes } from "../../utils/crypto-core";

/** 16 random bytes, lowercase hex (crypto-core's VAULT_KDF_SALT_BYTES). */
const VAULT_KDF_SALT_HEX_RE = /^[0-9a-f]{32}$/;

/**
 * Whether `value` is a well-formed per-vault KDF salt: 32 lowercase hex chars
 * (16 bytes, `VAULT_KDF_SALT_BYTES` in crypto-core).
 *
 * Exported because the cross-tab sync has to ask the same question about a
 * value it just read from storage, and a second copy of this regex is exactly
 * how the two answers would drift apart.
 */
export function isVaultKdfSaltHex(value: string | null | undefined): boolean {
  return (
    typeof value === "string" && VAULT_KDF_SALT_HEX_RE.test(value.trim().toLowerCase())
  );
}

function generateVaultKdfSaltHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Ensures the vault has a per-vault Argon2id salt installed in the crypto
 * layer, minting and persisting one when absent (legacy vaults, first run).
 *
 * Failure policy — this runs on the unlock path, so it must never make an
 * unlock fail:
 *   - storage UNREADABLE (locked device key / IDB hiccup): return null and
 *     leave the crypto layer in legacy mode. We cannot mint here, because we
 *     cannot tell "no salt yet" from "salt exists but is unreadable", and
 *     guessing would rotate the vault onto a divergent salt.
 *   - persistence fails after minting: keep the in-memory salt. Every payload
 *     written with it carries the salt itself, so the only cost is an extra
 *     Argon2id derivation next session, never data access.
 *
 * @returns the installed salt as 32-hex, or null when unavailable.
 */
export async function ensureVaultKdfSalt(): Promise<string | null> {
  let stored: string | null;
  try {
    stored = await secureStorage.getSecret(KDF_SALT_DESCRIPTOR.storageKey);
  } catch (error) {
    logger.warn(
      "[SecurityVault] Vault KDF salt unreadable — staying in legacy (fixed-salt) mode",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return null;
  }

  const normalized = stored?.trim().toLowerCase() ?? null;
  if (normalized && isVaultKdfSaltHex(normalized)) {
    await encryptionService.configureVaultKdfSalt(normalized);
    return normalized;
  }
  if (normalized) {
    logger.warn(
      "[SecurityVault] Stored vault KDF salt is malformed — minting a replacement",
    );
  }

  const fresh = generateVaultKdfSaltHex();
  try {
    await secureStorage.setSecret(KDF_SALT_DESCRIPTOR.storageKey, fresh);
  } catch (error) {
    logger.warn(
      "[SecurityVault] Failed to persist the vault KDF salt — using it for this session only",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  await encryptionService.configureVaultKdfSalt(fresh);
  logger.info(
    "[SecurityVault] Per-vault KDF salt provisioned (A-1: per-vault Argon2id salt)",
  );
  return fresh;
}

/**
 * Secrets encrypted directly with the master password whose legacy `v5:`
 * payloads are re-wrapped under the vault salt.
 *
 * Not exhaustive by design: any other password-encrypted secret
 * (`encryptSecret`, cloud-sync config, TTS keys, …) is migrated by its next
 * write, which is when the app can rewrite it without a second read path.
 * These two are listed explicitly because they are read on the boot path and
 * may otherwise never be rewritten for years.
 */
const MIGRATED_SECRET_KEYS = [
  SECURE_STORAGE_KEYS.DB_KEY,
  SECURE_STORAGE_KEYS.API_KEY,
] as const;

export interface VaultSaltMigrationResult {
  /** Keys re-wrapped to the vault salt. */
  migrated: string[];
  /** Keys whose legacy payload could not be re-wrapped (left untouched). */
  failed: string[];
}

/**
 * Re-wraps legacy (`v5:`) master-password secrets under the per-vault salt.
 *
 * Per-key and non-fatal: a key that cannot be decrypted/rewritten is left
 * exactly as it was, so the vault keeps working with the legacy derivation and
 * the key simply migrates on its next write. That is what makes the migration
 * "transparent" — it never trades data access for the stronger derivation.
 *
 * Ownership contract: `password` is a string, so EncryptionService encodes and
 * zeroizes its own transient buffers; copies are passed per operation because
 * EncryptionService consumes (zeroizes) byte buffers it receives.
 */
export async function migrateVaultSecretsToVaultSalt(
  password: string,
): Promise<VaultSaltMigrationResult> {
  const result: VaultSaltMigrationResult = { migrated: [], failed: [] };
  if (!password) {return result;}

  const passwordBytes = new TextEncoder().encode(password);
  try {
    for (const key of MIGRATED_SECRET_KEYS) {
      let stored: string | null = null;
      try {
        stored = await secureStorage.getSecret(key);
      } catch (error) {
        // Unreadable (locked device key) — nothing to migrate this session.
        logger.warn("[SecurityVault] Vault salt migration skipped a secret", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      // Only legacy password-encrypted payloads need re-wrapping: `v6:` is
      // already salted, and v4/v2 are self-salted per operation.
      if (!stored || !stored.startsWith("v5:")) {continue;}
      try {
        const plaintext = await encryptionService.decryptWithBytes(
          stored,
          passwordBytes.slice(),
        );
        const rewrapped = await encryptionService.encryptWithBytes(
          plaintext,
          passwordBytes.slice(),
        );
        await secureStorage.setSecret(key, rewrapped);
        result.migrated.push(key);
      } catch (error) {
        result.failed.push(key);
        logger.warn(
          "[SecurityVault] Vault salt migration left a legacy secret in place",
          {
            key,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
} finally {
    zeroPasswordBytes(passwordBytes);
  }

  if (result.migrated.length > 0) {
    logger.info("[SecurityVault] Legacy secrets re-wrapped under the vault salt", {
      migrated: result.migrated,
    });
  }
  return result;
}

/**
 * The vault's KDF-salt state at a point in time, so a rotation can be undone.
 */
export interface VaultKdfSaltSnapshot {
  /**
   * Salt as read from storage. `undefined` means the read FAILED (locked
   * device key), which is deliberately distinct from `null` ("nothing
   * stored"): a failed read must never be "restored" by deleting a value we
   * were unable to see in the first place.
   */
  stored: string | null | undefined;
  /** Salt installed in the crypto layer, or null in legacy (fixed-salt) mode. */
  installed: string | null;
}

/**
 * ADR-053 Phase B — unified per-salt inventory entry (one per registry
 * descriptor). `master-kdf` carries the ADR-052 v5/v6 corpus classification:
 * those password-encrypted secrets are re-wrapped under the same
 * password-derived master key that `kdf_salt` feeds, so their format state
 * is the format state of the master-kdf lane. `db-key-kdf` reports its
 * provisioning (random per-vault CSPRNG salt; its value is KDF *input*,
 * never format-tagged, so it has no v5/v6 classification).
 */
export interface VaultSaltInventoryEntry {
  purpose: VaultSaltPurpose;
  governance: string;
  rotatesWithPassword: boolean;
  /** Whether the salt value is present in storage right now. */
  provisioned: boolean;
  /** v5/v6 corpus classification — populated only for master-kdf. */
  corpus?: {
    legacyV5: number;
    saltedV6: number;
    legacyKeys: string[];
  };
}

/**
 * ADR-053 Phase B: one inventory per registry entry, from a single storage
 * pass. Never throws: any storage failure collapses into one honest
 * "unknown" inventory (zero would falsely signal a fully salted vault).
 */
export async function reportVaultSaltInventory(): Promise<
  VaultSaltInventoryEntry[]
> {
  const exposure = await reportVaultSecretFormatExposure();
  const inventory: VaultSaltInventoryEntry[] = [];
  for (const descriptor of VAULT_SALT_REGISTRY) {
    const entry: VaultSaltInventoryEntry = {
      purpose: descriptor.purpose,
      governance: descriptor.governance,
      rotatesWithPassword: descriptor.rotatesWithPassword,
      provisioned: false,
    };
    try {
      const stored = await secureStorage.getSecret(descriptor.storageKey);
      entry.provisioned = typeof stored === "string" && stored.length > 0;
    } catch (_error) {
      // The whole inventory already carries the exposure status; an
      // unreadable salt slot degrades that entry's provisioned to false.
      entry.provisioned = false;
    }
    if (
      descriptor.purpose === "master-kdf" &&
      exposure.status === "ok"
    ) {
      entry.corpus = {
        legacyV5: exposure.legacyV5,
        saltedV6: exposure.saltedV6,
        legacyKeys: [...exposure.legacyKeys],
        };
    }
    inventory.push(entry);
  }
  return inventory;
}

/**
 * ADR-052 Phase 1 — local exposure counter for the v5 sunset.
 *
 * Reports how many of the vault's password-encrypted secrets persist in the
 * LEGACY `v5:` format (derived under the retired bundle-wide static salt —
 * the only remaining RFC 9106 violation in the tree). This is a diagnostic
 * read: local-only, no telemetry, no writes, and it never mutates storage or
 * the crypto layer. Phase 3 of ADR-052 (legacy read-path removal) is gated
 * on this report reaching zero.
 *
 * Failure policy mirrors `snapshotVaultKdfSalt`: a storage that cannot be
 * read (locked device key, IndexedDB hiccup) is reported as "unknown", never
 * as a count, because "zero" would wrongly signal a fully migrated vault.
 */
export interface VaultSecretFormatExposure {
  /** "ok" when every secret was read and classified. */
  status: "ok" | "unknown";
  /** Total password-encrypted secrets inspected. */
  inspected: number;
  /** Secrets still stored under the legacy `v5:` (static-salt) format. */
  legacyV5: number;
  /** Secrets already on the per-vault-salt `v6:` format. */
  saltedV6: number;
  /** Which storage keys are the residual v5 corpus (diagnostic only). */
  legacyKeys: string[];
}

/** Keys inspected by the exposure report: the boot-path secret corpus
 * (`MIGRATED_SECRET_KEYS`) plus the H5 verification token, which is the
 * official unlock oracle and is re-minted as `v6:` on unlock. */
const EXPOSURE_SECRET_KEYS = [...MIGRATED_SECRET_KEYS, SECURE_STORAGE_KEYS.VERIFICATION] as const;

export async function reportVaultSecretFormatExposure(): Promise<VaultSecretFormatExposure> {
  const report: VaultSecretFormatExposure = {
    status: "ok",
    inspected: 0,
    legacyV5: 0,
    saltedV6: 0,
    legacyKeys: [],
  };
  try {
    for (const key of EXPOSURE_SECRET_KEYS) {
      let stored: string | null;
      try {
        stored = await secureStorage.getSecret(key);
      } catch (error) {
        // One unreadable secret makes the whole corpus unknown: the keys
        // share the device-key protection, so "the others are readable" does
        // not establish a zero count.
        logger.warn("[SecurityVault] Exposure report could not read a secret", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        return { ...report, status: "unknown" };
      }
      if (!stored) {continue;}
      report.inspected += 1;
      if (stored.startsWith("v5:")) {
        report.legacyV5 += 1;
        report.legacyKeys.push(key);
      } else if (stored.startsWith("v6:")) {
        report.saltedV6 += 1;
      }
    }
  } catch (error) {
    logger.warn("[SecurityVault] Exposure report failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...report, status: "unknown" };
  }
  return report;
}

/**
 * Reads the current KDF-salt state without mutating anything. Never throws:
 * it is the first step of a rotation, and a snapshot that cannot be taken is
 * better represented as "storage unknown" than as a failed rotation.
 */
export async function snapshotVaultKdfSalt(): Promise<VaultKdfSaltSnapshot> {
  const installed = encryptionService.getVaultKdfSaltHex();
  try {
    const stored = await secureStorage.getSecret(KDF_SALT_DESCRIPTOR.storageKey);
    return { stored: stored?.trim().toLowerCase() ?? null, installed };
  } catch (error) {
    logger.warn("[SecurityVault] Vault KDF salt unreadable while snapshotting", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { stored: undefined, installed };
  }
}

/**
 * Mints, persists and installs a NEW per-vault Argon2id salt.
 *
 * Why the salt rotates with the password: the hostile artifact is the corpus
 * of password-encrypted blobs (verification token, `encrypted_db_key`,
 * `encrypted_api_key`, the wrapped device key), and one harvested corpus is
 * worth attacking only while the salt that produced it stays in use. Leaving
 * the salt in place after a rotation hands an attacker who already built a
 * dictionary against the OLD password a dictionary that still applies to the
 * blobs written under the new one. Rotating on the same operation that
 * invalidates the old password is what makes "changed my password" mean
 * something for offline attacks too.
 *
 * Ordering is deliberate — persist FIRST, install second:
 *   - persisting first means a crash can never leave the vault encrypting
 *     under a salt storage has not seen (the next unlock would adopt the old
 *     stored salt and split the vault across two derivations);
 *   - installing second means nothing is written with the new salt until the
 *     vault is committed to it, which is what keeps `restoreVaultKdfSalt` a
 *     complete undo — hence the previous state is passed IN rather than
 *     re-read here (the caller already holds it, and re-reading could pick up
 *     its own half-finished write).
 *
 * Fails LOUDLY, unlike `ensureVaultKdfSalt`: rotation is an explicit,
 * authenticated operation, and a salt that could not be rotated must abort it
 * (the caller rolls back and reports failure) instead of reporting success.
 *
 * @param previous - state from `snapshotVaultKdfSalt()`, used to guarantee the
 *   new salt actually differs from the one it replaces.
 * @returns the new salt as 32-hex.
 */
export async function rotateVaultKdfSalt(
  previous: VaultKdfSaltSnapshot,
): Promise<string> {
  let fresh = generateVaultKdfSaltHex();
  if (fresh === previous.installed || fresh === previous.stored) {
    // A collision is 2^-128 by chance: reaching here means the RNG is broken,
    // and reusing the salt would silently defeat the rotation it claims to do.
    fresh = generateVaultKdfSaltHex();
  }
  if (fresh === previous.installed || fresh === previous.stored) {
    throw new Error("Vault KDF salt rotation produced a repeated salt");
  }

  await secureStorage.setSecret(KDF_SALT_DESCRIPTOR.storageKey, fresh);
  await encryptionService.configureVaultKdfSalt(fresh);
  logger.info("[SecurityVault] Vault KDF salt rotated with the master password", {
    previousFingerprint: previous.installed?.slice(0, 8) ?? null,
    currentFingerprint: fresh.slice(0, 8),
  });
  return fresh;
}

/**
 * Puts the vault back on a snapshot taken by `snapshotVaultKdfSalt()`.
 *
 * Best-effort and never throws: it is called from the rollback path, where the
 * rotation has already failed, and a storage error here must not mask that
 * original failure. Two independent undos, both attempted:
 *   - the STORED value, so the next session installs the salt the rolled-back
 *     payloads were written with;
 *   - the IN-MEMORY install, which is restored even when the storage write
 *     fails, so the rest of this session keeps writing under the same
 *     derivation as the payloads that were just restored.
 */
export async function restoreVaultKdfSalt(
  snapshot: VaultKdfSaltSnapshot,
): Promise<void> {
  try {
    if (snapshot.stored === undefined) {
      // Storage was unreadable when the snapshot was taken: undo only the
      // in-memory install rather than deleting a salt we never saw.
    } else if (snapshot.stored === null || !isVaultKdfSaltHex(snapshot.stored)) {
      // There was no usable salt stored (or it was malformed, in which case
      // `ensureVaultKdfSalt` would re-mint on the next unlock anyway).
      await secureStorage.deleteSecret(KDF_SALT_DESCRIPTOR.storageKey);
    } else {
      await secureStorage.setSecret(KDF_SALT_DESCRIPTOR.storageKey, snapshot.stored);
    }
  } catch (error) {
    logger.error("[SecurityVault] Failed to restore the stored vault KDF salt", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try {
      await encryptionService.configureVaultKdfSalt(snapshot.installed);
    } catch (error) {
      logger.error(
        "[SecurityVault] Failed to restore the in-memory vault KDF salt",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}

/**
 * Outcome of `adoptVaultKdfSaltFromStorage()`. A diagnostic value, never an
 * exception: it is produced on the cross-tab notification path, where throwing
 * would only turn a missed sync into an unhandled rejection.
 */
export type VaultKdfSaltAdoptionStatus =
  | "adopted"
  | "unchanged"
  | "absent"
  | "malformed"
  | "unreadable";

export interface VaultKdfSaltAdoption {
  status: VaultKdfSaltAdoptionStatus;
  /** Salt in use after the call, when one is known. */
  salt?: string;
}

/**
 * Adopts the salt STORAGE currently holds, and re-keys the crypto layer onto
 * it. This is how an already-open tab stops writing under a salt the vault has
 * retired: the salt lives in module state, so a rotation performed in a sibling
 * tab would otherwise not reach this one until it reloaded.
 *
 * Storage is the authority, never the message. The cross-tab notification
 * (`kdf-salt-sync.ts`) is therefore a trigger with no payload: a same-origin
 * iframe or extension can post on the channel, but it cannot invent a salt —
 * whatever it sends, this function installs what `rotateVaultKdfSalt` already
 * persisted, which is also why the ordering rule (persist BEFORE install) is
 * what makes cross-tab sync safe rather than merely convenient.
 *
 * Deliberately conservative in the states it refuses:
 *   - nothing stored: the vault is still on the legacy fixed salt. Minting one
 *     here would race the tab that owns the change, so this does nothing.
 *   - malformed: a replacement is `ensureVaultKdfSalt`'s job (at unlock), not
 *     this path's, and installing it would throw in the crypto layer.
 *   - unreadable (locked device key / IndexedDB hiccup): nothing to do; a tab
 *     that cannot read the salt cannot write with it either, and the next
 *     unlock provisions the current one anyway.
 *
 * A successful adoption also means this session's in-memory master password
 * is stale — the rotation that changed the salt changed the password with it
 * (ADR-046). That is logged as a warning rather than acted upon: the password
 * is not transmitted between tabs, by design.
 */
export async function adoptVaultKdfSaltFromStorage(): Promise<VaultKdfSaltAdoption> {
  let stored: string | null;
  try {
    stored = await secureStorage.getSecret(KDF_SALT_DESCRIPTOR.storageKey);
  } catch (error) {
    logger.warn(
      "[SecurityVault] Cross-tab KDF salt adoption could not read storage",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return { status: "unreadable" };
  }

  const normalized = stored?.trim().toLowerCase() ?? null;
  if (!normalized) {
    return { status: "absent" };
  }
  if (!isVaultKdfSaltHex(normalized)) {
    logger.warn(
      "[SecurityVault] Cross-tab KDF salt adoption refused a malformed stored salt",
    );
    return { status: "malformed" };
  }
  if (encryptionService.getVaultKdfSaltHex() === normalized) {
    return { status: "unchanged", salt: normalized };
  }

  await encryptionService.configureVaultKdfSalt(normalized);
  logger.warn(
    "[SecurityVault] Adopted the vault KDF salt rotated in another tab — this session's master password is now stale",
    { saltFingerprint: normalized.slice(0, 8) },
  );
  return { status: "adopted", salt: normalized };
}
