import i18n from "../i18n";
import { encryptionService } from "./EncryptionService";
import { securityVault } from "./SecurityVault";
import { secureStorage } from "./SecureStorage";
import { getCollection } from "../utils/browser-types";
import { logger } from "../utils/logger";
import { settingsService } from "./SettingsService";
import { initDB } from "../db/database";
import { COLLECTIONS } from "../db/database.core";
import { auditLog } from "./AuditLogService";
import { safeGet, safeSet, safeRemove } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { downloadBlob } from "../utils/download";
import { diskBackupService } from "./DiskBackupService";

const AUTO_BACKUP_KEY = "bmf_last_auto_backup";
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
// Refuse imports that cannot be rolled back safely in bounded memory.
const MAX_ROLLBACK_SNAPSHOT_DOCS = 50_000;
const BASE64_CHUNK_SIZE = 1024 * 1024;
const BACKUP_FORMAT_VERSION = 2;
const BACKUP_META_KEY = "_backup_meta";
// Raised from 50 MB to 200 MB now that the base64 form is stored as bounded
// chunks (see AUTO_BACKUP_CHUNK_BYTES). The cap keeps a single in-browser
// auto-backup within the per-origin storage budget while covering large
// vaults with DOM snapshots, AI summaries and embeddings.
const MAX_AUTO_BACKUP_BYTES = 200 * 1024 * 1024;
// Binary bytes per chunk. Kept a multiple of 3 so every intermediate base64
// chunk carries no '=' padding (3 bytes → 4 base64 chars); ~3 MB binary ≈
// 4 MB base64, bounding per-chunk memory during both write and read.
const AUTO_BACKUP_CHUNK_BYTES = 3 * 1024 * 1024;
const AUTO_BACKUP_CHUNKS_KEY = "auto_backup_chunks";
const AUTO_BACKUP_DATA_KEY = "auto_backup_data"; // legacy single-record copy
const AUTO_BACKUP_DATA_PREFIX = "auto_backup_data_"; // chunked records

/** Converts Uint8Array to string for crypto operations. */
function bytesToPw(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Normalizes password param (string | Uint8Array | undefined) to string | undefined. */
function normalizePassword(password?: string | Uint8Array): string | undefined {
  if (typeof password === "string") {return password;}
  if (password instanceof Uint8Array) {return bytesToPw(password);}
  return undefined;
}

/** Returns the stable identifier used by current and legacy backup documents. */
function getBackupDocumentId(doc: unknown): string | undefined {
  if (typeof doc !== "object" || doc === null) {return undefined;}
  const record = doc as Record<string, unknown>;
  const id = record.id ?? record._id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Parses the backup text payload and validates the envelope in a single
 * step. Translates `JSON.parse` `SyntaxError`s into an opaque "not valid
 * JSON" message so a hostile or truncated file cannot leak payload content
 * through the V8 `SyntaxError.message` (which embeds the offending input).
 * The shape validation error from {@link validateBackupEnvelope} still
 * surfaces verbatim for legitimate-but-wrong-schema files.
 */
function parseBackupEnvelope(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Backup file is not valid JSON");
  }
  return validateBackupEnvelope(value);
}

/**
 * Validates the outer backup envelope before opening the database or writing
 * anything. Unversioned flat objects remain readable for backwards
 * compatibility; versioned files must use the current format so an older or
 * future schema cannot be interpreted as if it were lossless.
 */
function validateBackupEnvelope(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error("Invalid or corrupted backup format");
  }

  const metadata = value[BACKUP_META_KEY];
  if (metadata !== undefined) {
    if (
      !isPlainRecord(metadata) ||
      metadata.formatVersion !== BACKUP_FORMAT_VERSION
    ) {
      throw new Error(
        `Unsupported backup format version (expected ${BACKUP_FORMAT_VERSION})`,
      );
    }
  }

  for (const [collectionName, documents] of Object.entries(value)) {
    if (collectionName === BACKUP_META_KEY) {
      continue;
    }
    if (collectionName === "_app_settings") {
      if (!isPlainRecord(documents)) {
        throw new Error("Invalid backup settings payload");
      }
      continue;
    }
    if (!ALLOWED_BACKUP_COLLECTIONS.has(collectionName)) {
      throw new Error(`Unsupported backup collection: ${collectionName}`);
    }
    if (!Array.isArray(documents)) {
      throw new Error(`Invalid backup collection payload: ${collectionName}`);
    }
  }

  return value;
}

// Collections that may legitimately receive documents from a backup file.
// Any other collection name is rejected during preflight to prevent injection
// of arbitrary/unexpected data into the database.
//
// P84: DERIVED from COLLECTIONS (src/db/database.core.ts) instead of a
// hardcoded list. The old list had drifted from the schema in both
// directions: tags/prompts/workflows/agents/memories had no schema at all
// (phantoms), and a NEW collection added to COLLECTIONS would have been
// silently omitted from backups — silent data-loss drift. A real collection
// added to COLLECTIONS is now backed up and restorable automatically.
//
// Three sources are merged:
//   1. Every collection in COLLECTIONS, except:
//   2. EXCLUDED_BACKUP_COLLECTIONS — real collections deliberately NOT
//      backed up (highlights/insights are derived/regenerable data;
//      exporting them produced backups that importBackup rejected, E2E-
//      caught: "Import completed with 2 errors").
//   3. LEGACY_COMPAT_COLLECTIONS — names that have no schema today but were
//      tolerated historically. They must stay accepted on import so legacy
//      backup files still restore: db[col] is undefined, so they are accepted
//      as no-ops (no error), and they can never be exported since db.collections
//      lacks them.
const EXCLUDED_BACKUP_COLLECTIONS = new Set(["highlights", "insights"]);
const LEGACY_COMPAT_COLLECTIONS = new Set([
  "tags",
  "prompts",
  "workflows",
  "agents",
  "memories",
]);
const ALLOWED_BACKUP_COLLECTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(COLLECTIONS).filter(
    (name) => !EXCLUDED_BACKUP_COLLECTIONS.has(name),
  ),
  ...LEGACY_COMPAT_COLLECTIONS,
]);

// L-02: explicit denylist for settings persisted in backups. exportSettings()
// only returns non-secret preferences today, but if it ever grows a sensitive
// field (e.g. an AI provider URL with embedded credentials) this keeps it out
// of backup files. A denylist (not an allowlist) is used so legitimate new
// settings keep being backed up instead of silently dropped.
const SENSITIVE_SETTINGS_KEYS = new Set([
  "ollamaUrl",
  "customAiBaseUrl",
  "selectedProvider",
]);

interface BackupMetadata {
  date: string;
  size: number;
  encrypted: boolean;
  collections: string[];
  docCount: number;
}

/**
 * Handles encrypted backup and restore of the entire RxDB database.
 * Supports manual export/import (with optional password encryption)
 * and automatic daily backups stored in IndexedDB.
 *
 * Encrypted backups use `.bmf` extension; plain backups use `.json`.
 * Auto-backups are encrypted with the vault's master password.
 *
 * @example
 * ```ts
 * // Manual export with encryption
 * await BackupService.exportBackup('my_password');
 *
 * // Restore from file
 * await BackupService.importBackup(file, 'my_password');
 * ```
 */
export class BackupService {
  private static async encryptData(
    data: string,
    password?: string | Uint8Array,
  ): Promise<Blob> {
    const pw = normalizePassword(password);
    if (!pw || !pw.trim()) {
      // Plain JSON backup: keep it valid, parseable JSON (no magic prefix).
      // Empty/whitespace-only password → treat as no password (export plaintext
      // with a warning rather than silently producing an "encrypted" .bmf that
      // cannot be decrypted).
      if (pw && !pw.trim()) {
        logger.warn(
          "[Backup] Empty password provided — exporting as plaintext (.json). Provide a non-empty password for encrypted (.bmf) export.",
        );
      }
      return new Blob([data], { type: "application/json" });
    }

    // Encrypted backups are tagged with a versioned MAGIC_HEADER (BMF1) so
    // importBackup can reject corrupt/tampered files before JSON.parse.
    const enc = new TextEncoder();
    const encodedData = enc.encode(`BMF1:${data}`);
    try {
      const encryptedData = await encryptionService.encryptBinary(
        encodedData,
        pw,
      );

      return new Blob([encryptedData.buffer as BlobPart], {
        type: "application/octet-stream",
      });
    } finally {
      // EncryptionService clones the input for the worker; clear this
      // caller-owned plaintext buffer explicitly instead of retaining it
      // until garbage collection.
      encodedData.fill(0);
    }
  }

  private static async decryptData(
    buffer: ArrayBuffer,
    password?: string | Uint8Array,
  ): Promise<string> {
    const pw = normalizePassword(password);
    let text: string;
    if (!pw) {
      const dec = new TextDecoder();
      text = dec.decode(buffer);
    } else {
      if (!pw.trim()) {
        throw new Error("Backup password cannot be empty");
      }
      let decryptedData: Uint8Array | null = null;
      try {
        const data = new Uint8Array(buffer);
        decryptedData = await encryptionService.decryptBinary(
          data,
          pw.trim(),
        );
        const dec = new TextDecoder();
        text = dec.decode(decryptedData);
      } catch (error) {
        logger.error("[Backup] Failed to decrypt data", {
          error: error instanceof Error ? error.message : String(error),
          bufferSize: buffer.byteLength,
          passwordProvided: !!password,
        });
        throw new Error("Invalid password or corrupted backup file");
      } finally {
        decryptedData?.fill(0);
      }
    }
    // Encrypted backups must carry the authenticated format marker. Without
    // this check a future/incorrect decrypt implementation could accidentally
    // treat arbitrary plaintext JSON as a valid encrypted restore.
    if (!text.startsWith("BMF1:")) {
      throw new Error("Invalid or corrupted encrypted backup format");
    }
    return text.slice("BMF1:".length);
  }

  /**
   * Creates backup data as a Blob without triggering a file download.
   * Exports all RxDB collections and app settings.
   * @param password - Optional encryption password (string or Uint8Array); omit for plain JSON.
   *   NOTE: a Uint8Array is CONSUMED (wiped with zeros) by this call — pass a
   *   fresh buffer you no longer need, as withMasterPasswordBytes does.
   * @returns The backup Blob and metadata (date, size, collections, doc count)
   */
  static async createBackupData(
    password?: string | Uint8Array,
  ): Promise<{ blob: Blob; metadata: BackupMetadata }> {
    // L-03: decode the master password to a JS string exactly once and wipe
    // the ephemeral byte copy right away. withMasterPasswordBytes hands this
    // call a fresh buffer it alone owns, so zeroing it is safe and keeps the
    // zero-memory policy from being silently defeated by the backup flow.
    const pw = normalizePassword(password);
    if (password instanceof Uint8Array) {password.fill(0);}
    // Pass the password through to initDB: the vault DB is encrypted with
    // the master-password-derived key. Opening with no password uses the
    // auto-key, which collides with the encrypted adapter (DB1) and yields
    // a broken instance with zero collections/docs (E2E-caught regression).
    const db = await initDB(pw);
    // Symmetry with importCollectionsData: only export collections that the
    // importer will accept. The DB may contain collections (e.g. highlights,
    // insights) that are not in ALLOWED_BACKUP_COLLECTIONS — exporting them
    // produces a backup that importBackup rejects with N errors, one per
    // unknown collection (E2E-caught: "Import completed with 2 errors").
    const collections = Object.keys(db.collections).filter((col) =>
      ALLOWED_BACKUP_COLLECTIONS.has(col),
    );
    const backupData: Record<string, unknown> = {};
    let totalDocs = 0;

    // Backups are lossless: do not silently cap a collection at a page size.
    for (const colName of collections) {
      const collection = getCollection(db, colName) as
        | {
            find: () => {
              exec: () => Promise<{ toJSON: () => unknown }[]>;
            };
          }
        | undefined;
      if (!collection) {continue;}
      const docs = await collection.find().exec();
      backupData[colName] = docs.map((doc) => doc.toJSON());
      totalDocs += docs.length;
    }

    const rawSettings = settingsService.exportSettings();
    // L-02: the old `const { ...safeSettings } = rawSettings` copied everything
    // — a no-op "strip" that would silently leak a future sensitive setting.
    // Apply the explicit denylist instead (defense in depth).
    const safeSettings = Object.fromEntries(
      Object.entries(rawSettings).filter(
        ([key]) => !SENSITIVE_SETTINGS_KEYS.has(key),
      ),
    );
    backupData["_app_settings"] = safeSettings;
    backupData[BACKUP_META_KEY] = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
    };

    const jsonString = JSON.stringify(backupData);
    const blob = await this.encryptData(jsonString, pw);

    const metadata: BackupMetadata = {
      date: new Date().toISOString(),
      size: blob.size,
      encrypted: !!pw,
      collections,
      docCount: totalDocs,
    };

    return { blob, metadata };
  }

  /**
   * Exports the entire database to a file and prompts the user to save it.
   * Uses the File System Access API when available, falls back to download link.
   * @param password - Optional encryption password (string or Uint8Array)
   * @throws {Error} If backup creation fails
   */
  private static exportInFlight = false;

  static async exportBackup(password?: string | Uint8Array): Promise<void> {
    if (this.exportInFlight) {
      if (password instanceof Uint8Array) {password.fill(0);}
      throw new Error("Backup export already in progress");
    }
    this.exportInFlight = true;
    try {
      await this.exportBackupInternal(password);
    } finally {
      this.exportInFlight = false;
    }
  }

  private static async exportBackupInternal(
    password?: string | Uint8Array,
  ): Promise<void> {
    try {
      if (!password) {
        logger.warn(
          "[Backup] Exporting UNENCRYPTED plaintext backup — sensitive data (API keys, tokens) will be readable.",
        );
        if (
          typeof window !== "undefined" &&
          typeof confirm === "function" &&
          !confirm(
            i18n.t(
              "backup_plaintextConfirm",
              "You are about to export a backup WITHOUT ENCRYPTION.\n" +
                "Sensitive data (API keys, tokens) will be visible in plain text.\n\n" +
                "Continue?",
            ),
          )
        ) {
          logger.info("[Backup] Plaintext export cancelled by user");
          return;
        }
      }

      const { blob } = await this.createBackupData(password);

      const dateStr = new Date().toISOString().split("T")[0];
      const extension = password ? "bmf" : "json";
      const fileName = `bookmarkforge-backup-${dateStr}.${extension}`;

      auditLog
        .record({
          action: "backup_exported",
          result: "success",
          origin: "BackupService",
          context: { encrypted: String(!!password), fileName },
        })
        .catch((err) =>
          logger.warn("[Backup] auditLog failed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );

      if (
        typeof window !== "undefined" &&
        "showSaveFilePicker" in window
      ) {
        let writeStarted = false;
        let writable: {
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
          abort?: () => Promise<void>;
        } | null = null;
        try {
          const handle = await (
            window as Window & {
              showSaveFilePicker: (options?: {
                suggestedName?: string;
                types?: Array<{
                  description: string;
                  accept: Record<string, string[]>;
                }>;
              }) => Promise<{
                createWritable: () => Promise<{
                  write: (data: Blob) => Promise<void>;
                  close: () => Promise<void>;
                  abort?: () => Promise<void>;
                }>;
              }>;
            }
          ).showSaveFilePicker({
            suggestedName: fileName,
            types: [
              {
                description: password
                  ? "BookmarkForge Encrypted Backup"
                  : "JSON File",
                accept: password
                  ? { "application/octet-stream": [".bmf"] }
                  : { "application/json": [".json"] },
              },
            ],
          });
          writable = await handle.createWritable();
          writeStarted = true;
          await writable.write(blob);
          await writable.close();
          // F0-3: a successful manual export refreshes the "last backup" age
          // shown by the storage indicator (getLatestBackupAgeMs).
          safeSet(STORAGE_KEYS.LAST_MANUAL_BACKUP_DATE, Date.now().toString());
          return;
        } catch (err: unknown) {
          if (writeStarted) {
            // Do not silently fall back after a failed write/close: that can
            // leave a partial user-selected file while creating a duplicate
            // download. Abort the writable stream when supported.
            try {
              await writable?.abort?.();
            } catch (abortError) {
              logger.warn("[Backup] Failed to abort partial file", {
                error:
                  abortError instanceof Error
                    ? abortError.message
                    : String(abortError),
              });
            }
            throw err;
          }
          if (err instanceof Error && err.name === "AbortError") {
            return;
          }
          logger.warn(
            "File System Access API failed, falling back to download link",
            {
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }
      }

      downloadBlob(blob, fileName);
      // F0-3: a successful manual export (download fallback) refreshes the
      // "last backup" age shown by the storage indicator.
      safeSet(STORAGE_KEYS.LAST_MANUAL_BACKUP_DATE, Date.now().toString());
    } catch (error) {
      auditLog
        .record({
          action: "backup_exported",
          result: "failure",
          origin: "BackupService",
          context: {
            reason: error instanceof Error ? error.message : "Unknown",
          },
        })
        .catch((err) =>
          logger.warn("[Backup] auditLog failed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      logger.error("Failed to export backup", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Shared helper: imports collection data into the DB from a parsed backup object.
   * Tries bulkInsert first, falls back to individual upserts on failure. It
   * returns every validated document ID touched so rollback can remove only
   * import-owned rows instead of scanning a large collection.
   */
  private static async importCollectionsData(
    db: Awaited<ReturnType<typeof initDB>>,
    backupData: Record<string, unknown>,
    opts?: { skipLog?: boolean },
  ): Promise<{
    importedCount: number;
    errorCount: number;
    touchedDocumentIds: Record<string, string[]>;
  }> {
    let importedCount = 0;
    let errorCount = 0;
    const touchedDocumentIds: Record<string, string[]> = {};

    const KNOWN_SETTINGS_KEYS = new Set(["_app_settings"]);

    for (const [colName, docs] of Object.entries(backupData)) {
      if (colName === BACKUP_META_KEY) {continue;}
      if (colName === "_app_settings") {
        if (docs && typeof docs === "object" && !Array.isArray(docs)) {
          try {
            settingsService.importSettings(
              docs as Parameters<typeof settingsService.importSettings>[0],
            );
            if (!opts?.skipLog)
              {logger.info("Application settings restored from backup");}
          } catch (e) {
            logger.error("Failed to restore settings from backup", {
              error: e instanceof Error ? e.message : String(e),
            });
            errorCount++;
          }
        } else {
          logger.warn(
            "[Backup] _app_settings invalid type in backup, skipping",
          );
          errorCount++;
        }
        continue;
      }

      if (KNOWN_SETTINGS_KEYS.has(colName)) {continue;}

      if (!ALLOWED_BACKUP_COLLECTIONS.has(colName)) {
        logger.warn(
          `[Backup] Skipping unknown collection in backup: ${colName}`,
        );
        errorCount++;
        continue;
      }

      const collection = (
        db as unknown as Record<
          string,
          {
            bulkInsert: (d: unknown[]) => Promise<unknown>;
            upsert: (d: unknown) => Promise<void>;
          }
        >
      )[colName];
      if (collection && Array.isArray(docs)) {
        // SECURITY (F15): validate each doc's shape before restore to prevent
        // injection/overwrite from a malicious or manipulated backup file.
        const isValidBackupDoc = (doc: unknown): boolean => {
          if (typeof doc !== "object" || doc === null || Array.isArray(doc))
            {return false;}
          const rec = doc as Record<string, unknown>;
          if (Object.getPrototypeOf(rec) !== Object.prototype) {return false;}
          const id = rec._id ?? rec.id;
          if (typeof id !== "string" || id.length === 0 || id.length > 512)
            {return false;}
          return true;
        };
        const validDocs = docs.filter(isValidBackupDoc);
        const validIds = validDocs
          .map(getBackupDocumentId)
          .filter((id): id is string => !!id);
        if (validIds.length > 0) {
          touchedDocumentIds[colName] = validIds;
        }
        if (validDocs.length !== docs.length) {
          logger.warn(
            `[Backup] Rejected ${docs.length - validDocs.length} invalid doc(s) in ${colName}`,
          );
          errorCount += docs.length - validDocs.length;
        }
        let batchSuccess = false;
        try {
          await collection.bulkInsert(validDocs);
          batchSuccess = true;
          importedCount += validDocs.length;
          logger.info(
            `[Backup] Bulk inserted ${validDocs.length} docs into ${colName}`,
          );
        } catch (bulkErr) {
          logger.warn(
            `[Backup] Bulk insert failed for ${colName}, falling back to individual upserts`,
            {
              error:
                bulkErr instanceof Error ? bulkErr.message : String(bulkErr),
            },
          );
        }
        if (!batchSuccess) {
          for (const doc of validDocs) {
            try {
              await collection.upsert(doc);
              importedCount++;
            } catch (upsertError) {
              logger.error(`Failed to upsert doc in ${colName}`, {
                error:
                  upsertError instanceof Error
                    ? upsertError.message
                    : String(upsertError),
              });
              errorCount++;
            }
          }
        }
      } else if (collection) {
        logger.warn(`[Backup] Invalid collection payload in ${colName}`);
        errorCount++;
      }
    }
    return { importedCount, errorCount, touchedDocumentIds };
  }

  /**
   * Materializes a bounded rollback snapshot. The global cap protects against
   * a large vault spread across several collections, and the query limit keeps
   * the fallback safe when a test/mock or future adapter lacks count().
   */
  private static async createRollbackSnapshot(
    db: Awaited<ReturnType<typeof initDB>>,
    collectionNames: string[],
    errorPrefix: string,
  ): Promise<Record<string, unknown[]>> {
    const snapshot: Record<string, unknown[]> = {};
    let totalDocs = 0;

    for (const colName of collectionNames) {
      if (colName === "_app_settings") {continue;}
      const collection = (
        db as unknown as Record<
          string,
          {
            count?: () => { exec: () => Promise<number> };
            find: (opts?: unknown) => {
              exec: () => Promise<{ toJSON: () => unknown }[]>;
            };
          }
        >
      )[colName];
      if (!collection) {continue;}

      const remaining = MAX_ROLLBACK_SNAPSHOT_DOCS - totalDocs;
      const count = collection.count
        ? await collection.count().exec()
        : undefined;
      if (count !== undefined && count > remaining) {
        throw new Error(
          `${errorPrefix}: ${colName} has ${count} documents; rollback limit is ${MAX_ROLLBACK_SNAPSHOT_DOCS}`,
        );
      }

      const docs = await collection.find({ limit: remaining + 1 }).exec();
      if (docs.length > remaining) {
        throw new Error(
          `${errorPrefix}: ${colName} exceeds the rollback limit of ${MAX_ROLLBACK_SNAPSHOT_DOCS} documents`,
        );
      }
      snapshot[colName] = docs.map((d) => d.toJSON());
      totalDocs += count ?? docs.length;
    }

    return snapshot;
  }

  /**
   * Imports a backup file (encrypted `.bmf` or plain `.json`) into the database.
   * Uses bulk insert with individual upsert fallback for conflict handling.
   * Preflights the versioned envelope and snapshots before writing. If import
   * fails, restores original data/settings within the bounded rollback limit.
   * @param file - The backup file to import
   * @param password - Password required for encrypted `.bmf` files (string or Uint8Array)
   * @throws {Error} If password is missing for encrypted file or format is invalid
   */
  private static importInFlight = false;

  static async importBackup(file: File, password?: string | Uint8Array): Promise<void> {
    if (this.importInFlight) {
      if (password instanceof Uint8Array) {password.fill(0);}
      throw new Error("Backup import already in progress");
    }
    this.importInFlight = true;
    try {
      await this.importBackupInternal(file, password);
    } finally {
      this.importInFlight = false;
    }
  }

  private static async importBackupInternal(
    file: File,
    password?: string | Uint8Array,
  ): Promise<void> {
    let buffer: ArrayBuffer | null = null;
    try {
      const pw = normalizePassword(password);
      if (password instanceof Uint8Array) {
        // This API consumes caller-owned password buffers just like
        // createBackupData/withMasterPasswordBytes.
        password.fill(0);
      }
      const MAX_BACKUP_BYTES = 100 * 1024 * 1024; // 100 MB guardrail
      if (file.size > MAX_BACKUP_BYTES) {
        throw new Error(
          `Backup file too large (${(file.size / 1024 / 1024).toFixed(1)} MB); max ${MAX_BACKUP_BYTES / 1024 / 1024} MB`,
        );
      }

      buffer = await file.arrayBuffer();

      const isEncrypted = file.name.endsWith(".bmf");
      if (isEncrypted && !pw) {
        throw new Error("Password required for encrypted backup.");
      }

      let text: string;
      if (isEncrypted) {
        // decryptData already strips the MAGIC_HEADER and throws if absent.
        text = await this.decryptData(buffer, pw);
      } else {
        const raw = new TextDecoder().decode(buffer);
        // The BMF1: prefix is optional for plain JSON backups: it is added by
        // createBackupData for format identification, but legacy/plain JSON
        // exports (and prior versions) have no prefix and must still import.
        text = raw.startsWith("BMF1:") ? raw.slice("BMF1:".length) : raw;
      }
      const backupData = parseBackupEnvelope(text);
      // Same as createBackupData: open the DB with the backup's password so
      // the import writes into the real (encrypted) vault collections.
      const db = await initDB(pw);
      const settingsSnapshot = settingsService.exportSettings();

      const snapshot = await this.createRollbackSnapshot(
        db,
        Object.keys(backupData),
        "Import aborted",
      );

      let importFailed = false;
      let touchedDocumentIds: Record<string, string[]> = {};
      try {
        const importResult = await this.importCollectionsData(db, backupData);
        const { importedCount, errorCount } = importResult;
        touchedDocumentIds = importResult.touchedDocumentIds;

        if (errorCount > 0) {
          importFailed = true;
        }

        auditLog
          .record({
            action: "backup_imported",
            result: errorCount > 0 ? "failure" : "success",
            origin: "BackupService",
            context: {
              fileName: file.name,
              encrypted: String(isEncrypted),
              importedCount: String(importedCount),
              errorCount: String(errorCount),
            },
          })
          .catch((err) =>
            logger.warn("[Backup] auditLog failed", {
            error: err instanceof Error ? err.message : String(err),
          }),
          );

        if (errorCount > 0) {
          throw new Error(`Import completed with ${errorCount} errors`);
        }

        logger.info(
          `[Backup] Import complete: ${importedCount} docs imported, ${errorCount} errors`,
        );
      } catch (importError) {
        importFailed = true;
        // Rollback: restore settings and the document snapshot before removing
        // any docs inserted during import that were not part of the snapshot.
        if (Object.prototype.hasOwnProperty.call(backupData, "_app_settings")) {
          try {
            settingsService.importSettings(settingsSnapshot);
          } catch (settingsRollbackError) {
            logger.error("[Backup] Rollback failed for application settings", {
              error:
                settingsRollbackError instanceof Error
                  ? settingsRollbackError.message
                  : String(settingsRollbackError),
            });
          }
        }
        for (const [colName, docs] of Object.entries(snapshot)) {
          try {
            const collection = (
              db as unknown as Record<
                string,
                {
                  upsert: (d: unknown) => Promise<void>;
                  bulkRemove: (ids: string[]) => Promise<unknown>;
                }
              >
            )[colName];
            if (!collection) {continue;}
            const snapshotIds = new Set(
              docs.map(getBackupDocumentId).filter(Boolean) as string[],
            );
            if (docs.length > 0) {
              for (const doc of docs) {
                await collection.upsert(doc);
              }
            }
            // Remove only IDs from this import. Avoid scanning/materializing
            // the whole collection during rollback of a large vault.
            const staleIds = (touchedDocumentIds[colName] ?? []).filter(
              (id) => !snapshotIds.has(id),
            );
            if (staleIds.length > 0) {
              await collection.bulkRemove(staleIds);
            }
          } catch (rollbackErr) {
            logger.error(`[Backup] Rollback failed for ${colName}`, {
              error:
                rollbackErr instanceof Error
                  ? rollbackErr.message
                  : String(rollbackErr),
            });
          }
        }
        throw importError;
      } finally {
        if (importFailed) {
          logger.warn("[Backup] Import failed — snapshot restored");
        }
      }
    } catch (error) {
      auditLog
        .record({
          action: "backup_imported",
          result: "failure",
          origin: "BackupService",
          context: {
            fileName: file.name,
            reason: error instanceof Error ? error.message : "Unknown",
          },
        })
        .catch((err) =>
          logger.warn("[Backup] auditLog failed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      logger.error("Failed to import backup", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      // The file buffer may contain plaintext JSON or encrypted vault data.
      // It is no longer needed after parsing/decryption and must not remain
      // readable in the ArrayBuffer backing store while rollback completes.
      if (buffer) {new Uint8Array(buffer).fill(0);}
    }
  }

  /**
   * Creates an automatic encrypted backup stored in IndexedDB.
   * Runs at most once every 24 hours. Uses the vault's master password for encryption.
   * @returns Backup metadata if created, `null` if skipped or failed
   */
  static async runAutoBackup(): Promise<BackupMetadata | null> {
    try {
      const lastBackup = safeGet(AUTO_BACKUP_KEY);
      if (lastBackup) {
        const lastBackupTime = parseInt(lastBackup, 10);
        const elapsed = Number.isFinite(lastBackupTime) ? Date.now() - lastBackupTime : Infinity;
        if (elapsed < AUTO_BACKUP_INTERVAL_MS) {
          logger.info("[AutoBackup] Skipping, last backup was recent");
          return null;
        }
      }

      logger.info("[AutoBackup] Creating automatic backup...");
      const result = await securityVault.withMasterPasswordBytes(
        BackupService,
        async (passwordBytes) => {
          if (!passwordBytes) {return null;}
          return this.createBackupData(passwordBytes);
        },
      );
      if (!result) {
        logger.info("[AutoBackup] Vault locked, skipping auto-backup");
        return null;
      }
      const { blob, metadata } = result;

      // L-05 memory profile: the blob and one base64 chunk coexist briefly.
      // Chunked storage (AUTO_BACKUP_CHUNK_BYTES slices) keeps peak memory
      // bounded instead of building one giant base64 string — which is what
      // allows the cap below to sit at 200 MB without a low-end-device spike.
      if (blob.size > MAX_AUTO_BACKUP_BYTES) {
        logger.warn(
          `[AutoBackup] Backup too large (${blob.size} bytes), skipping auto-backup storage`,
        );
        return null;
      }

      // Store in IndexedDB via secureStorage, chunked so the base64 form is
      // never held as a single multi-hundred-MB string.
      await BackupService.storeAutoBackupChunked(blob);
      await secureStorage.setSecret(
        "auto_backup_metadata",
        JSON.stringify(metadata),
      );

      safeSet(AUTO_BACKUP_KEY, Date.now().toString());
      logger.info("[AutoBackup] Backup saved successfully", {
        size: metadata.size,
        docs: metadata.docCount,
      });

      // F0-1: also persist an encrypted copy on the user's REAL disk (chosen
      // folder on Chrome/Edge; Downloads fallback elsewhere), so clearing
      // site data can never destroy the vault and its backup together.
      // Best-effort: a disk failure must never fail the auto-backup — the
      // in-browser copy above is kept and the next daily run retries.
      try {
        const diskFileName = diskBackupService.buildBackupFileName();
        const diskResult = await diskBackupService.writeBackupToDisk(
          blob,
          diskFileName,
        );
        if (diskResult) {
          logger.info(`[AutoBackup] Disk copy saved via ${diskResult.method}`, {
            name: diskResult.name,
          });
        }
        // Persist the disk result so StorageStatus can surface it in the
        // tooltip — method, timestamp and any failure reason.
        try {
          const diskError =
            !diskResult
              ? "write failed"
              : diskResult.method === "download-blocked"
                ? "browser requires user gesture (export manually)"
                : null;
          safeSet(
            STORAGE_KEYS.LAST_DISK_BACKUP_RESULT,
            JSON.stringify({
              method: diskResult?.method ?? null,
              timestamp: Date.now(),
              error: diskError,
            }),
          );
        } catch {
          /* ignore — localStorage may be full */
        }
        auditLog
          .record({
            action: "auto_backup_disk",
            result: diskResult ? "success" : "failure",
            origin: "BackupService",
            context: { method: diskResult?.method ?? "none" },
          })
          .catch((err) =>
            logger.warn("[AutoBackup] auditLog failed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      } catch (error) {
        logger.warn("[AutoBackup] Disk copy failed (best-effort)", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return metadata;
    } catch (error) {
      logger.error("[AutoBackup] Failed to create auto backup", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Checks whether an auto-backup exists and when it was created.
   * @returns Availability flag, metadata, and age in milliseconds
   */
  static async getAutoBackupInfo(): Promise<{
    available: boolean;
    metadata?: BackupMetadata;
    age?: number;
  }> {
    try {
      const metaStr = await secureStorage.getSecret("auto_backup_metadata");
      if (!metaStr) {
        return { available: false };
      }

      const metadata = JSON.parse(metaStr) as BackupMetadata;
      const lastBackup = safeGet(AUTO_BACKUP_KEY);
      const age = lastBackup
        ? Date.now() - parseInt(lastBackup, 10)
        : undefined;

      return { available: true, metadata, age };
    } catch (_err) {
      return { available: false };
    }
  }

  /**
   * Returns the last disk backup result persisted by the daily auto-backup.
   * Includes method ("folder" | "download" | null), timestamp and error.
   */
  static getDiskBackupInfo(): {
    method: "folder" | "download" | "download-blocked" | null;
    timestamp: number | null;
    error: string | null;
  } {
    try {
      const raw = safeGet(STORAGE_KEYS.LAST_DISK_BACKUP_RESULT);
      if (!raw) {
        return { method: null, timestamp: null, error: null };
      }
      const parsed = JSON.parse(raw) as {
        method?: string;
        timestamp?: number;
        error?: string;
      };
      const method =
        parsed.method === "folder" ||
        parsed.method === "download" ||
        parsed.method === "download-blocked"
          ? parsed.method
          : null;
      return {
        method,
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : null,
        error: typeof parsed.error === "string" ? parsed.error : null,
      };
    } catch {
      return { method: null, timestamp: null, error: null };
    }
  }

  /**
   * Restores the database from the latest auto-backup stored in IndexedDB.
   * Requires the vault to be unlocked if the backup is encrypted.
   * @returns `true` if restore succeeded
   */
  static async restoreFromAutoBackup(): Promise<boolean> {
    let buffer: ArrayBuffer | null = null;
    try {
      const backupData = await BackupService.readAutoBackupBase64();
      if (!backupData) {
        logger.warn("[AutoBackup] No auto-backup available to restore");
        return false;
      }

      buffer = await BackupService.base64ToBuffer(backupData);
      // Capture into a const so the value stays non-null inside the
      // withMasterPasswordBytes() closure below (control-flow analysis
      // resets narrowing of `let` variables captured by closures).
      const backupBuffer = buffer;

      const metaStr = await secureStorage.getSecret("auto_backup_metadata");
      const metadata = metaStr ? (JSON.parse(metaStr) as BackupMetadata) : null;

      let text: string;
      let dbPassword: string | undefined;
      if (metadata?.encrypted) {
        text = await securityVault.withMasterPasswordBytes(
          BackupService,
          async (passwordBytes) => {
            if (!passwordBytes) {
              throw new Error(
                "Vault is locked, password required to decrypt auto-backup",
              );
            }
            try {
              // L-03: decode once and pass the string on (decryptData accepts
              // both), then wipe the ephemeral byte copy. The string form
              // cannot be zeroed, but no second immutable copy is made.
              dbPassword = bytesToPw(passwordBytes);
              return await this.decryptData(backupBuffer, dbPassword);
            } finally {
              passwordBytes.fill(0);
            }
          },
        );
      } else {
        text = new TextDecoder().decode(backupBuffer);
        // Strip the MAGIC_HEADER (M4) — auto-backup stores the full tagged blob.
        if (text.startsWith("BMF1:")) {
          text = text.slice("BMF1:".length);
        }
      }
      const backupDataObj = parseBackupEnvelope(text);
      // Restoring into a password-protected vault must open the DB with the
      // same password (auto-key path would hit DB1 on the encrypted adapter).
      const db = await initDB(dbPassword);
      const settingsSnapshot = settingsService.exportSettings();

      const snapshot = await this.createRollbackSnapshot(
        db,
        Object.keys(backupDataObj),
        "Auto-restore aborted",
      );

      let importFailed = false;
      let touchedDocumentIds: Record<string, string[]> = {};
      try {
        const importResult = await this.importCollectionsData(db, backupDataObj, {
          skipLog: true,
        });
        const { importedCount, errorCount } = importResult;
        touchedDocumentIds = importResult.touchedDocumentIds;

        if (errorCount > 0) {
          importFailed = true;
        }

        logger.info(
          `[AutoBackup] Successfully restored from auto-backup (${importedCount} docs, ${errorCount} errors)`,
        );

        if (errorCount > 0) {
          throw new Error(`Auto-restore completed with ${errorCount} errors`);
        }

        return true;
      } catch (importError) {
        importFailed = true;
        logger.error("[AutoBackup] Import failed — rolling back to snapshot", {
          error:
            importError instanceof Error
              ? importError.message
              : String(importError),
        });

        // Rollback: restore settings and the document snapshot before removing
        // docs inserted during import.
        if (Object.prototype.hasOwnProperty.call(backupDataObj, "_app_settings")) {
          try {
            settingsService.importSettings(settingsSnapshot);
          } catch (settingsRollbackError) {
            logger.error(
              "[AutoBackup] Rollback failed for application settings",
              {
                error:
                  settingsRollbackError instanceof Error
                    ? settingsRollbackError.message
                    : String(settingsRollbackError),
              },
            );
          }
        }
        for (const [colName, docs] of Object.entries(snapshot)) {
          try {
            const collection = (
              db as unknown as Record<
                string,
                {
                  upsert: (d: unknown) => Promise<void>;
                  bulkRemove: (ids: string[]) => Promise<unknown>;
                }
              >
            )[colName];
            if (!collection) {continue;}
            const snapshotIds = new Set(
              docs.map(getBackupDocumentId).filter(Boolean) as string[],
            );
            if (docs.length > 0) {
              for (const doc of docs) {
                await collection.upsert(doc);
              }
            }
            // Remove only IDs from this import, without scanning the whole
            // collection during rollback.
            const staleIds = (touchedDocumentIds[colName] ?? []).filter(
              (id) => !snapshotIds.has(id),
            );
            if (staleIds.length > 0) {
              await collection.bulkRemove(staleIds);
            }
          } catch (rollbackErr) {
            logger.error(
              `[AutoBackup] Rollback failed for ${colName}`,
              {
                error:
                  rollbackErr instanceof Error
                    ? rollbackErr.message
                    : String(rollbackErr),
              },
            );
          }
        }
        throw importError;
      } finally {
        if (importFailed) {
          logger.warn(
            "[AutoBackup] Auto-restore failed — snapshot restored",
          );
        }
      }
    } catch (error) {
      logger.error("[AutoBackup] Failed to restore from auto-backup", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      // The decoded backup can contain plaintext vault data. Clear the
      // backing buffer even when metadata parsing, decryption, DB opening, or
      // rollback fails.
      if (buffer) {new Uint8Array(buffer).fill(0);}
    }
  }

  /** Decode base64 in bounded chunks, yielding between chunks to keep the UI responsive. */
  private static async base64ToBuffer(base64: string): Promise<ArrayBuffer> {
    // Validate before allocation so corrupted or attacker-controlled storage
    // cannot trigger an unbounded decode or make `atob` accept ambiguous data.
    const maxBase64Length = 4 * Math.ceil(MAX_AUTO_BACKUP_BYTES / 3);
    if (
      !base64 ||
      base64.length > maxBase64Length ||
      base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
    ) {
      throw new Error("Auto-backup data is invalid or exceeds the size limit");
    }

    // Decode aligned base64 slices so atob never creates one binary string for
    // the whole backup. The allocation is an upper bound; trailing `=` padding
    // is trimmed by the final slice.
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const maxBytes = (base64.length / 4) * 3 - padding;
    const bytes = new Uint8Array(maxBytes);
    let written = 0;
    const chunkChars = BASE64_CHUNK_SIZE - (BASE64_CHUNK_SIZE % 4);

    for (let offset = 0; offset < base64.length; offset += chunkChars) {
      const end = Math.min(offset + chunkChars, base64.length);
      const binaryChunk = atob(base64.slice(offset, end));
      for (let i = 0; i < binaryChunk.length; i++) {
        bytes[written++] = binaryChunk.charCodeAt(i);
      }
      if (end < base64.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    // In the normal case no second full-size allocation is needed. A short
    // final buffer is copied only for malformed/padded input, then the source
    // is wiped before it becomes unreachable.
    if (written === bytes.length) {
      return bytes.buffer;
    }
    const result = bytes.slice(0, written).buffer;
    bytes.fill(0);
    return result;
  }

  /** Converts a Blob to base64 asynchronously using FileReader (no main thread blocking). */
  private static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false;
      const cleanup = () => {
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
      };
      const fail = (error: unknown) => {
        if (settled) {return;}
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      reader.onload = () => {
        if (settled) {return;}
        const result = reader.result;
        if (typeof result !== "string") {
          fail(new Error("Failed to read blob as data URL"));
          return;
        }
        const base64 = result.split(",", 2)[1];
        if (!base64) {
          fail(new Error("Base64 data URL format unexpected"));
          return;
        }
        settled = true;
        cleanup();
        resolve(base64);
      };
      reader.onerror = () => fail(reader.error ?? new Error("Failed to read blob"));
      reader.onabort = () => fail(new DOMException("Blob read aborted", "AbortError"));
      try {
        reader.readAsDataURL(blob);
      } catch (error) {
        fail(error);
      }
    });
  }

  /**
   * Stores the auto-backup in IndexedDB as bounded base64 chunks. The chunked
   * form avoids ever materializing the whole backup as one base64 string (the
   * previous single-record design peaked at ~2.4× the blob size in memory).
   * Legacy single-record backups are removed so readers prefer the chunked form.
   */
  private static async storeAutoBackupChunked(blob: Blob): Promise<void> {
    const previousCountStr = await secureStorage.getSecret(AUTO_BACKUP_CHUNKS_KEY);
    const previousCount = previousCountStr ? parseInt(previousCountStr, 10) : 0;

    const chunkCount = Math.max(
      1,
      Math.ceil(blob.size / AUTO_BACKUP_CHUNK_BYTES),
    );
    for (let i = 0; i < chunkCount; i++) {
      const slice = blob.slice(
        i * AUTO_BACKUP_CHUNK_BYTES,
        (i + 1) * AUTO_BACKUP_CHUNK_BYTES,
      );
      const base64 = await BackupService.blobToBase64(slice);
      await secureStorage.setSecret(`${AUTO_BACKUP_DATA_PREFIX}${i}`, base64);
    }

    // Prune stale chunks left over from a previous (larger) backup.
    for (let i = chunkCount; i < previousCount; i++) {
      await secureStorage.deleteSecret(`${AUTO_BACKUP_DATA_PREFIX}${i}`);
    }

    await secureStorage.deleteSecret(AUTO_BACKUP_DATA_KEY);
    // Commit point: record the chunk count last so a crash mid-loop is never
    // mistaken for a complete chunked backup.
    await secureStorage.setSecret(AUTO_BACKUP_CHUNKS_KEY, String(chunkCount));
  }

  /**
   * Reads the stored auto-backup base64: the chunked form first, then the
   * legacy single-record form for backups created before chunking existed.
   */
  private static async readAutoBackupBase64(): Promise<string | null> {
    const chunkCountStr = await secureStorage.getSecret(AUTO_BACKUP_CHUNKS_KEY);
    const chunkCount = chunkCountStr ? parseInt(chunkCountStr, 10) : 0;
    if (Number.isInteger(chunkCount) && chunkCount > 0) {
      const maxBase64Length = 4 * Math.ceil(MAX_AUTO_BACKUP_BYTES / 3);
      const parts: string[] = [];
      let total = 0;
      for (let i = 0; i < chunkCount; i++) {
        const part = await secureStorage.getSecret(
          `${AUTO_BACKUP_DATA_PREFIX}${i}`,
        );
        if (!part) {
          throw new Error(`Auto-backup chunk ${i} missing`);
        }
        total += part.length;
        if (total > maxBase64Length) {
          throw new Error(
            "Auto-backup data is invalid or exceeds the size limit",
          );
        }
        parts.push(part);
      }
      return parts.join("");
    }
    return secureStorage.getSecret(AUTO_BACKUP_DATA_KEY);
  }

  /** Deletes the auto-backup data (chunked + legacy) and metadata. */
  static async clearAutoBackup(): Promise<void> {
    try {
      const chunkCountStr = await secureStorage.getSecret(AUTO_BACKUP_CHUNKS_KEY);
      const chunkCount = chunkCountStr ? parseInt(chunkCountStr, 10) : 0;
      if (Number.isInteger(chunkCount) && chunkCount > 0) {
        for (let i = 0; i < chunkCount; i++) {
          await secureStorage.deleteSecret(`${AUTO_BACKUP_DATA_PREFIX}${i}`);
        }
      }
      await secureStorage.deleteSecret(AUTO_BACKUP_CHUNKS_KEY);
      await secureStorage.deleteSecret(AUTO_BACKUP_DATA_KEY);
      await secureStorage.deleteSecret("auto_backup_metadata");
      safeRemove(AUTO_BACKUP_KEY);
      logger.info("[AutoBackup] Auto-backup cleared");
    } catch (error) {
      logger.error("[AutoBackup] Failed to clear auto-backup", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

securityVault.registerCaller(BackupService);
