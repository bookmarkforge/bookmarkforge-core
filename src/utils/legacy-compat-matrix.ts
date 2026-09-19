/**
 * src/utils/legacy-compat-matrix.ts
 *
 * Executable compatibility/migration matrix for legacy crypto and storage
 * formats used by BookmarkForge.
 *
 * Goal: let operators and automated tooling understand what legacy artifacts
 * a given checkout can still READ, REWRITE, or MUST PRESERVE, without ever
 * decrypting real vault data.
 *
 * Design principles:
 *  - Pure functions and side-effect-free analysis by default.
 *  - No production storage access: the matrix inspects code contracts, schema
 *    metadata, and well-formed synthetic test payloads only.
 *  - Deterministic row order so automated diffs remain stable.
 *  - Every row is tied to a code path (file + symbol) so findings remain
 *    actionable instead of floating as vague "legacy" warnings.
 */

import type { RxJsonSchema } from "rxdb";

export interface LegacyCompatRow {
  /** Stable machine-readable category. */
  id: string;
  /** Human-readable short name for logs/UIs. */
  label: string;
  /** Highest severity this row can raise during a local diagnosis. */
  severity: "info" | "warning" | "critical" | "legacy-read-only";
  /** What this row is diagnosing. */
  subject: "crypto-format" | "storage-format" | "schema-version" | "key-material" | "migration";
  /** Where the behavior is implemented. */
  source: {
    file: string;
    symbol: string | null;
  };
  /** Which runtime contexts this row applies to. */
  contexts: Array<"browser" | "node-test" | "worker" | "e2e-seeder">;
  /** Whether the matrix currently considers this surface supported. */
  status:
    | "supported"
    | "supported-read-only"
    | "deprecated"
    | "migration-required"
    | "migration-in-progress";
  /** Why this row exists and what operators should do about it. */
  note: string;
  /** Concrete update/migration action, if any. */
  recommendedAction: string | null;
}

interface LegacyCompatMatrix {
  generatedFrom: {
    appVersion: string;
    generatorFile: string;
    generatorSymbol: string;
  };
  rows: LegacyCompatRow[];
}

// ---------------------------------------------------------------------------
// Static declarative surface
// ---------------------------------------------------------------------------

const CRYPTO_FORMATS: LegacyCompatRow[] = [
  {
    id: "crypto-v2-pbkdf2",
    label: "Crypto v2 — PBKDF2(SHA-256, 600k iterations)",
    severity: "legacy-read-only",
    subject: "crypto-format",
    source: { file: "src/utils/crypto-core.ts", symbol: "decrypt" },
    contexts: ["browser", "node-test", "e2e-seeder"],
    status: "supported-read-only",
    note:
      "Legacy ciphertext prefix `v2:` is still accepted by decrypt() for compatibility with older vault seeds. " +
      "New encryptions never produce this format.",
    recommendedAction:
      "Keep decrypt path until no production vault uses v2: payloads. Do not use PBKDF2 for any new key derivation.",
  },
  {
    id: "crypto-v4-argon2id",
    label: "Crypto v4 — Argon2id per-operation AES-GCM",
    severity: "info",
    subject: "crypto-format",
    source: { file: "src/utils/crypto-core.ts", symbol: "encryptBinary" },
    contexts: ["browser", "node-test", "worker"],
    status: "supported",
    note:
      "Argon2id-once + per-operation AES-GCM is the current crypto-core wire format for binary payloads. " +
      "Key derivation is memory-hard and test configs intentionally lower memory cost.",
    recommendedAction: null,
  },
  {
    id: "crypto-v5-hkdf",
    label: "Crypto v5 — Argon2id-once + HKDF per operation",
    severity: "info",
    subject: "crypto-format",
    source: { file: "src/utils/crypto-core.ts", symbol: "encrypt" },
    contexts: ["browser", "node-test", "worker", "e2e-seeder"],
    status: "supported",
    note:
      "Current text encryption path. Master key is derived once per password session and per-operation keys " +
      "come from HKDF-SHA256.",
    recommendedAction: null,
  },
  {
    id: "kdf-argon2id",
    label: "KDF — Argon2id (RFC 9106 parameters)",
    severity: "info",
    subject: "key-material",
    source: { file: "src/utils/argon2-kdf.ts", symbol: "deriveArgon2idKey" },
    contexts: ["browser", "node-test", "worker"],
    status: "supported",
    note:
      "Only supported KDF in this codebase. Memory parameters vary by device class and environment; " +
      "test mode uses a much lighter config.",
    recommendedAction: null,
  },
  {
    id: "keywrap-aes-gcm",
    label: "Key wrapping — AES-256-GCM",
    severity: "info",
    subject: "key-material",
    source: { file: "src/utils/crypto-core.ts", symbol: "encryptWithSessionKey" },
    contexts: ["browser", "node-test", "worker"],
    status: "supported",
    note:
      "Authenticated envelope used by the outer storage encryption layer and vault key material wrapping.",
    recommendedAction: null,
  },
];

// ---------------------------------------------------------------------------
// RxDB schema scanning helpers
// ---------------------------------------------------------------------------

interface EncryptedFieldSummary {
  collection: string;
  encryptedFields: string[];
  legacyCommentFound: boolean;
}

function isLikelyEncryptedFieldField(
  schema: RxJsonSchema<string> | undefined,
): string[] {
  const encrypted = schema?.encrypted;
  if (!Array.isArray(encrypted) || encrypted.length === 0) {
    return [];
  }
  return encrypted.filter((f): f is string => typeof f === "string");
}

function commentsIncludeLegacyMark(
  schema: RxJsonSchema<string> | undefined,
): boolean {
  if (!schema || typeof schema.title !== "string") {
    return false;
  }
  // The schema files use inline `// v2: ...` style comments above schema
  // objects. We do not rely on parsing those comments at runtime; instead
  // the matrix hard-codes known legacy-schema surfaces from the schema module
  // and flags them explicitly. This helper exists only as a future-proof hook.
  return false;
}

export function scanSchemaSet(
  schemas: Array<{ name: string; schema: RxJsonSchema<string> | undefined }>,
): EncryptedFieldSummary[] {
  return schemas
    .map(({ name, schema }) => ({
      collection: name,
      encryptedFields: isLikelyEncryptedFieldField(schema),
      legacyCommentFound: commentsIncludeLegacyMark(schema),
    }))
    .filter((row) => row.encryptedFields.length > 0);
}

// ---------------------------------------------------------------------------
// Schema-related legacy surfaces
// ---------------------------------------------------------------------------

const SCHEMA_FORMATS: LegacyCompatRow[] = [
  {
    id: "schema-version-current",
    label: "Current RxDB schema-version surface (live collections)",
    severity: "info",
    subject: "schema-version",
    source: { file: "src/db/schema.ts", symbol: null },
    contexts: ["browser", "node-test"],
    status: "supported",
    note:
      "The active schema module declares a per-collection schema-version surface through RxDB schema objects. " +
      "Schema version is the operational contract for on-disk compatibility and migration readiness.",
    recommendedAction: null,
  },
  {
    id: "schema-encrypted-fields",
    label: "RxDB encrypted field list (per collection)",
    severity: "info",
    subject: "storage-format",
    source: { file: "src/db/schema.ts", symbol: null },
    contexts: ["browser", "node-test"],
    status: "supported",
    note:
      "Several collections still declare encrypted fields via RxDB schema metadata. " +
      "Those fields are protected by the storage wrapper, not by schema metadata alone.",
    recommendedAction: null,
  },
  {
    id: "storage-auth-envelope",
    label: "Auth envelope over RxDB CryptoJS inner encryption",
    severity: "info",
    subject: "storage-format",
    source: { file: "src/db/authEncryptionStorage.ts", symbol: "authenticatedEncryptionStorage" },
    contexts: ["browser", "node-test"],
    status: "supported",
    note:
      "Outer authenticated AES-GCM envelope is added around the existing RxDB field encryption. " +
      "Legacy rows without the outer envelope are still read.",
    recommendedAction: null,
  },
  {
    id: "storage-legacy-unwrap",
    label: "Legacy unwrap path for pre-envelope rows",
    severity: "warning",
    subject: "migration",
    source: { file: "src/db/authEncryptionStorage.ts", symbol: "decryptDoc" },
    contexts: ["browser", "node-test"],
    status: "migration-in-progress",
    note:
      "decryptDoc accepts values without the outer envelope marker and passes them through to the inner layer. " +
      "That path exists for compatibility with pre-F-06 rows.",
    recommendedAction:
      "Track remaining legacy rows by schema version migration coverage and remove the passthrough path once " +
      "no production database contains pre-envelope records.",
  },
];

// ---------------------------------------------------------------------------
// Vault-specific legacy surfaces
// ---------------------------------------------------------------------------

const VAULT_FORMATS: LegacyCompatRow[] = [
  {
    id: "vault-share-credential",
    label: "Share credential derivation (Argon2id + HKDF)",
    severity: "info",
    subject: "key-material",
    source: { file: "src/services/security-vault/share.ts", symbol: "deriveShareCredential" },
    contexts: ["browser", "node-test"],
    status: "supported",
    note:
      "Ephemeral device credential for authenticated shares is derived through Argon2id + HKDF with a pinned info string.",
    recommendedAction: null,
  },
  {
    id: "vault-verification-token",
    label: "Verification token integrity (HMAC over ciphertext)",
    severity: "info",
    subject: "key-material",
    source: { file: "src/services/security-vault/integrity.ts", symbol: "validateVerificationIntegrity" },
    contexts: ["browser", "node-test"],
    status: "supported",
    note:
      "Password verification uses a verification token and an HMAC integrity record over that token's ciphertext.",
    recommendedAction: null,
  },
  {
    id: "vault-wrong-password-error",
    label: "Wrong-password signal (DB1 tagged error)",
    severity: "info",
    subject: "key-material",
    source: { file: "src/db/authEncryptionStorage.ts", symbol: "decryptDoc" },
    contexts: ["browser", "node-test"],
    status: "supported",
    note:
      "Authenticated-envelope failure is surfaced as a tagged DB1 error so higher-level code can treat it as a wrong-password case.",
    recommendedAction: null,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildLegacyCompatMatrix(
  appVersion = "unknown",
): LegacyCompatMatrix {
  const rows = [
    ...CRYPTO_FORMATS,
    ...SCHEMA_FORMATS,
    ...VAULT_FORMATS,
  ];

  // Deterministic sort so automated consumers get a stable diff surface.
  rows.sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  return {
    generatedFrom: {
      appVersion,
      generatorFile: "src/utils/legacy-compat-matrix.ts",
      generatorSymbol: "buildLegacyCompatMatrix",
    },
    rows,
  };
}

export function findRowsBySubject(
  matrix: LegacyCompatMatrix,
  subject: LegacyCompatRow["subject"],
): LegacyCompatRow[] {
  return matrix.rows.filter((row) => row.subject === subject);
}

export function findRowsByStatus(
  matrix: LegacyCompatMatrix,
  status: LegacyCompatRow["status"],
): LegacyCompatRow[] {
  return matrix.rows.filter((row) => row.status === status);
}

export function summarizeLocalLegacyExposure(
  matrix: LegacyCompatMatrix,
): {
  totalRows: number;
  critical: number;
  warning: number;
  legacyReadOnly: number;
  migrationInProgress: number;
  deprecated: number;
  rowsById: Record<string, LegacyCompatRow>;
} {
  const rowsById: Record<string, LegacyCompatRow> = {};
  let critical = 0;
  let warning = 0;
  let legacyReadOnly = 0;
  let migrationInProgress = 0;
  let deprecated = 0;

  for (const row of matrix.rows) {
    rowsById[row.id] = row;

    if (row.severity === "critical") {
      critical++;
    } else if (row.severity === "warning") {
      warning++;
    } else if (row.severity === "legacy-read-only") {
      legacyReadOnly++;
    }

    if (row.status === "migration-in-progress") {
      migrationInProgress++;
    } else if (row.status === "deprecated") {
      deprecated++;
    }
  }

  return {
    totalRows: matrix.rows.length,
    critical,
    warning,
    legacyReadOnly,
    migrationInProgress,
    deprecated,
    rowsById,
  };
}
