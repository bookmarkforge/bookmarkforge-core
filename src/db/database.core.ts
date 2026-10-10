// ADR-019: Argon2id migration / Security hardening (encrypted database)
import { RxDatabase, RxJsonSchema, type RxConflictHandler } from "rxdb";
import {
  bookmarkSchema,
  documentSchema,
  documentAttachmentSchema,
  templateSchema,
  folderSchema,
  versionSchema,
  flashcardSchema,
  messageSchema,
  chunkSchema,
  highlightSchema,
  insightSchema,
} from "./schema";
import {
  memoryRecordSchema,
} from "../memory/memoryRecordSchema";
import { compareRxRevision } from "../utils/syncVersion";
import { sha256 } from "@noble/hashes/sha2.js";

export interface ConflictHandlerInput {
  newDocumentState: {
    id?: string;
    _rev?: string;
    updatedAt?: string;
    isDeleted?: boolean;
    blocks?: unknown[];
    [key: string]: unknown;
  };
  realMasterState: {
    id?: string;
    _rev?: string;
    updatedAt?: string;
    isDeleted?: boolean;
    blocks?: unknown[];
    [key: string]: unknown;
  };
}

export interface ConflictHandlerOutput {
  isEqual: boolean;
  documentData: Record<string, unknown>;
}

export type RxDatabaseWithMethods = RxDatabase & {
  addCollections(collections: Record<string, unknown>): Promise<unknown>;
  destroy(): Promise<void>;
};

type ConflictState = ConflictHandlerInput["newDocumentState"];
type ConflictBlock = Record<string, unknown>;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Stable JSON used only as a defensive final tie-break. RxDB normally gives
 * every divergent write a different `_rev`; this still makes the handler
 * total if malformed/test states share id, timestamp and revision.
 */
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareCodeUnits)
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

/** Compare timestamps without allowing missing values to outrank real ones. */
function compareUpdatedAt(left: ConflictState, right: ConflictState): number {
  const leftUpdatedAt = typeof left.updatedAt === "string" ? left.updatedAt : "";
  const rightUpdatedAt = typeof right.updatedAt === "string" ? right.updatedAt : "";
  if (!leftUpdatedAt || !rightUpdatedAt) {return 0;}

  const leftTime = Date.parse(leftUpdatedAt);
  const rightTime = Date.parse(rightUpdatedAt);
  const timeComparison =
    Number.isFinite(leftTime) && Number.isFinite(rightTime)
      ? leftTime - rightTime
      : compareCodeUnits(leftUpdatedAt, rightUpdatedAt);
  return timeComparison === 0 ? 0 : timeComparison > 0 ? 1 : -1;
}

/**
 * Compare the logical conflict clocks in a globally reproducible order:
 * updatedAt first (when both sides have one), then the complete RxDB revision,
 * then document id. For valid RxDB revisions (`<rev-height>-<hash>`), the
 * revision height is compared numerically and the hash is a deterministic
 * same-height tie-break. The caller's "master" position is
 * deliberately absent.
 */
function compareConflictStates(left: ConflictState, right: ConflictState): number {
  const timestampComparison = compareUpdatedAt(left, right);
  if (timestampComparison !== 0) {return timestampComparison;}

  const leftRev = typeof left._rev === "string" ? left._rev : "";
  const rightRev = typeof right._rev === "string" ? right._rev : "";
  const revComparison = compareRxRevision(leftRev, rightRev);
  if (revComparison !== 0) {return revComparison;}

  const leftId = typeof left.id === "string" ? left.id : "";
  const rightId = typeof right.id === "string" ? right.id : "";
  const idComparison = compareCodeUnits(leftId, rightId);
  if (idComparison !== 0) {return idComparison;}

  return compareCodeUnits(stableSerialize(left), stableSerialize(right));
}

function asBlocks(value: unknown): ConflictBlock[] | null {
  if (!Array.isArray(value)) {return null;}
  return value.every(
    (block): block is ConflictBlock =>
      typeof block === "object" && block !== null && !Array.isArray(block),
  )
    ? value
    : null;
}

function blockIdentity(block: ConflictBlock): string {
  return typeof block.id === "string" && block.id.length > 0
    ? `id:${block.id}`
    : `value:${stableSerialize(block)}`;
}

function isBlockKeySubset(left: ConflictBlock[], right: ConflictBlock[]): boolean {
  const rightKeys = new Set(right.map(blockIdentity));
  return left.every((block) => rightKeys.has(blockIdentity(block)));
}

/**
 * Merge only genuinely additive block sets. If either side is a subset of the
 * other, do not union: that shape is also exactly what a delete-vs-edit looks
 * like, and unioning it would resurrect deleted blocks. The result is sorted by
 * a stable identity, removing arrival-order differences for additive 3+ peer
 * histories. This is not a general sequence CRDT: arbitrary mixed
 * delete/edit histories remain outside the handler's convergence guarantee.
 */
function mergeAdditiveBlocks(
  left: ConflictState,
  right: ConflictState,
): ConflictBlock[] | null {
  const leftBlocks = asBlocks(left.blocks);
  const rightBlocks = asBlocks(right.blocks);
  if (!leftBlocks || !rightBlocks || leftBlocks.length === 0 || rightBlocks.length === 0) {
    return null;
  }
  if (isBlockKeySubset(leftBlocks, rightBlocks) || isBlockKeySubset(rightBlocks, leftBlocks)) {
    return null;
  }

  const winner = compareConflictStates(left, right) >= 0 ? leftBlocks : rightBlocks;
  const loser = winner === leftBlocks ? rightBlocks : leftBlocks;
  const byIdentity = new Map<string, ConflictBlock>();
  for (const block of winner) {
    byIdentity.set(blockIdentity(block), block);
  }
  for (const block of loser) {
    const identity = blockIdentity(block);
    if (!byIdentity.has(identity)) {
      byIdentity.set(identity, block);
    }
  }

  return [...byIdentity.entries()]
    .sort(([leftKey], [rightKey]) => compareCodeUnits(leftKey, rightKey))
    .map(([, block]) => block);
}

/**
 * Resolve one RxDB conflict using the repository's explicit conflict model.
 *
 * Resolution order:
 * 1. LWW by `updatedAt` when both states provide comparable timestamps.
 * 2. Numeric RxDB revision height, then the revision hash. Malformed
 *    revisions use a deterministic code-unit fallback.
 * 3. `id`, followed by a canonical serialization only for malformed states
 *    that still tie on all documented fields.
 *
 * Tombstones (`isDeleted: true`) are always LWW records and never candidates
 * for block merging. A block merge is considered only for live states with
 * equal timestamps, and only when neither block set is a subset of the other;
 * this prevents a deletion-shaped subset from being resurrected. Merged blocks
 * are canonically ordered, so additive N-peer histories converge regardless of
 * pairwise arrival order. The handler is not a full CRDT: arbitrary mixed
 * delete/edit histories with 3+ peers require a higher-level causal model.
 */
export const defaultConflictHandler = (
  i: ConflictHandlerInput,
): ConflictHandlerOutput => {
  const newState = i.newDocumentState;
  const masterState = i.realMasterState;
  const stateComparison = compareConflictStates(newState, masterState);
  const winner = stateComparison >= 0 ? newState : masterState;

  if (stableSerialize(newState) === stableSerialize(masterState)) {
    return { isEqual: true, documentData: masterState };
  }

  const newIsDeleted = newState.isDeleted === true;
  const masterIsDeleted = masterState.isDeleted === true;

  // Tombstones are LWW records, never merge candidates. This is what prevents
  // a live branch's blocks/fields from resurrecting a newer deletion.
  if (newIsDeleted !== masterIsDeleted) {
    return { isEqual: false, documentData: winner };
  }

  // A newer timestamp wins outright. Equal/unknown timestamps are the only
  // situation where additive block merging is considered.
  const newHasTimestamp = typeof newState.updatedAt === "string" && newState.updatedAt.length > 0;
  const masterHasTimestamp = typeof masterState.updatedAt === "string" && masterState.updatedAt.length > 0;
  if (newHasTimestamp && masterHasTimestamp && compareUpdatedAt(newState, masterState) !== 0) {
    return { isEqual: false, documentData: winner };
  }

  // Without two comparable timestamps there is no proof that the branches are
  // concurrent; use the LWW/revision winner instead of inventing a union.
  if (
    !newIsDeleted &&
    !masterIsDeleted &&
    newHasTimestamp &&
    masterHasTimestamp &&
    compareUpdatedAt(newState, masterState) === 0
  ) {
    const mergedBlocks = mergeAdditiveBlocks(newState, masterState);
    if (mergedBlocks) {
      return {
        isEqual: false,
        documentData: { ...winner, blocks: mergedBlocks },
      };
    }
  }

  return { isEqual: false, documentData: winner };
};

/**
 * RxDB 17 object-style conflict handler (replication-protocol). RxDB 17
 * requires `{ isEqual(a, b, ctx): boolean; resolve(input, ctx): Promise<doc> }`
 * — the legacy function-style `defaultConflictHandler` above predates that
 * API and would throw `state.input.conflictHandler.resolve is not a function`
 * on any replication conflict (the multiuser e2e caught this). This wrapper
 * keeps the exact repository conflict model while satisfying the RxDB 17
 * contract; `defaultConflictHandler` is retained for the unit tests.
 */
// RxDB's own default conflict handler is typed RxConflictHandler<any>; the
// document shape here is a union of all collection schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rxdb17ConflictHandler: RxConflictHandler<any> = {
  isEqual(a, b) {
    return stableSerialize(a) === stableSerialize(b);
  },
  async resolve(i) {
    const output = defaultConflictHandler({
      newDocumentState: i.newDocumentState,
      realMasterState: i.realMasterState,
    });
    return output.documentData;
  },
};

const migrateToV1 = (doc: Record<string, unknown>) => {
  const migrated = { ...doc };
  if (migrated.processed === undefined) {migrated.processed = false;}
  if (migrated.isDeleted === undefined) {migrated.isDeleted = false;}
  if (migrated.isPrivate === undefined) {migrated.isPrivate = false;}
  if (migrated.createdAt && typeof migrated.createdAt === "number") {
    migrated.createdAt = new Date(migrated.createdAt as number).toISOString();
  }
  if (migrated.updatedAt && typeof migrated.updatedAt === "number") {
    migrated.updatedAt = new Date(migrated.updatedAt as number).toISOString();
  }
  return migrated;
};

const migrateToV2 = (doc: Record<string, unknown>) => {
  const migrated = { ...doc };
  if (migrated.tags === undefined || migrated.tags === null) {
    migrated.tags = [];
  } else if (!Array.isArray(migrated.tags)) {
    migrated.tags = [String(migrated.tags)];
  }
  if (migrated.embedding !== undefined && !Array.isArray(migrated.embedding)) {
    migrated.embedding = undefined;
  }
  if (migrated.summary === undefined) {
    migrated.summary = "";
  }
  if (migrated.url && typeof migrated.url === "string") {
    try {
      migrated.url = new URL(migrated.url).href;
    } catch {
      /* INTENTIONAL SILENCE: invalid legacy URLs retain their original value during migration. */
    }
  }
  return migrated;
};

const migrateToV3 = (doc: Record<string, unknown>) => {
  const migrated = { ...doc };
  if (migrated.broken === undefined) {migrated.broken = false;}
  if (migrated.lastChecked === undefined) {migrated.lastChecked = "";}
  return migrated;
};

// v4: add isPrivate flag to bookmarks (defaults to false for existing data).
const migrateToV4 = (doc: Record<string, unknown>) => {
  const migrated = { ...doc };
  if (migrated.isPrivate === undefined) {migrated.isPrivate = false;}
  return migrated;
};

// v5: url leaves the encrypted array (it is indexed for dedup — encrypted
// fields cannot be indexed). The document shape is unchanged, so the strategy
// is identity. The version bump is what forces RxDB to migrate every row
// through the old storage (which decrypts url) into the new storage (which
// no longer encrypts it), converting existing ciphertext urls to plaintext.
const migrateToV5 = (doc: Record<string, unknown>) => ({ ...doc });

// v6: url moves back to encrypted; dedup uses urlHash (clear-text SHA-256).
// Migration computes urlHash from the plaintext url that v5 left unencrypted.
const migrateToV6 = (doc: Record<string, unknown>) => {
  const migrated = { ...doc };
  if (!migrated.urlHash && typeof migrated.url === "string") {
    migrated.urlHash = syncUrlHash(migrated.url);
  }
  return migrated;
};

function syncUrlHash(url: string): string {
  const bytes = sha256(new TextEncoder().encode(url));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Legacy bookmarks had no read-state field. Treat them as read/unknown rather
// than silently making the entire existing vault appear unread after upgrade.
const migrateToV8Bookmark = (doc: Record<string, unknown>) => ({
  ...doc,
  isRead: typeof doc.isRead === "boolean" ? doc.isRead : true,
});

const migrateToV2Folder = (doc: Record<string, unknown>) => {
  const migrated = { ...doc };
  if (migrated.parentId === undefined || migrated.parentId === null) {
    migrated.parentId = "";
  }
  return migrated;
};

export const migrationStrategies = Object.freeze({
  1: migrateToV1,
  2: migrateToV2,
  3: migrateToV3,
  4: migrateToV4,
  5: migrateToV5,
  6: migrateToV6,
} as const);

const baseCollection = {
  conflictHandler: rxdb17ConflictHandler,
} as const;

// Identity migration for collections that do not have bookmark-specific
// fields (processed, isDeleted, isPrivate). Applying migrateToV1 would add
// invalid fields and break schema validation for these collections.
const migrateNoop = (doc: Record<string, unknown>) => ({ ...doc });

// Chunk privacy cannot be reconstructed safely from a chunk row alone. Any
// legacy row missing the copied decision is therefore quarantined as private;
// the owning item will regenerate it with the correct value on reprocessing.
const migrateChunkToV2 = (doc: Record<string, unknown>) => ({
  ...doc,
  isPrivate: doc.isPrivate === false ? false : true,
});

// F-06 (ADR-019 follow-up): schema version bumps that rewrite every row
// through the authenticatedEncryptionStorage layer. The document shape is
// unchanged, so each bump uses an identity strategy at the new version —
// exactly like the earlier `encrypted`-array bumps (v2 templates, v3
// folders). This keeps the storage layer in charge of re-encrypting the
// fields on the migration write.
const v8BookmarkMigrationStrategies = {
  1: migrateToV1,
  2: migrateToV2,
  3: migrateToV3,
  4: migrateToV4,
  5: migrateToV5,
  6: migrateToV6,
  7: migrateNoop,
  8: migrateToV8Bookmark,
} as const;
const v2AttachmentMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
} as const;
const v2DocumentMigrationStrategies = {
  1: migrateToV1,
  2: migrateNoop,
} as const;
const v3TemplateMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
  3: migrateNoop,
} as const;
const v4FolderMigrationStrategies = {
  1: migrateNoop,
  2: migrateToV2Folder,
  3: migrateNoop,
  4: migrateNoop,
} as const;
const v2VersionMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
} as const;
const v2FlashcardMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
} as const;
const v4MessageMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
  3: migrateNoop,
  4: migrateNoop,
} as const;
const v3ChunkMigrationStrategies = {
  1: migrateChunkToV2,
  2: migrateNoop,
  3: migrateNoop,
} as const;
const v3HighlightMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
  3: migrateNoop,
} as const;
const v3InsightMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
  3: migrateNoop,
} as const;
const v3MemoryMigrationStrategies = {
  1: migrateNoop,
  2: migrateNoop,
  3: migrateNoop,
} as const;
// Unified memory collection. RxDB 17's OSS open-collection cap dropped from
// 16 to 13 (release notes 17.0.0) and the cert branch sits at 15 collections
// — well into COL23 territory. The four legacy memory collections were the
// only self-contained group left to consolidate (the in-repo
// memoryProfileSchema already unified scenarios+personas via a `type`
// discriminator). The unified `memory` collection carries the same data,
// discriminated by top-level `type` ∈ {atom, profile, session, message}.
const MEMORY_COLLECTION = {
  memory: { schema: memoryRecordSchema },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RxDB schema generics are intentionally opaque
type CollectionConfig<T = any> = {
  schema: RxJsonSchema<T>;
  conflictHandler: typeof rxdb17ConflictHandler;  migrationStrategies: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>
;
};

export const COLLECTIONS: Record<string, CollectionConfig> = {
  bookmarks: {
    schema: bookmarkSchema,
    ...baseCollection,
    migrationStrategies: v8BookmarkMigrationStrategies,
  },
  documents: {
    schema: documentSchema,
    ...baseCollection,
    migrationStrategies: v2DocumentMigrationStrategies,
  },
  documentAttachments: {
    schema: documentAttachmentSchema,
    ...baseCollection,
    migrationStrategies: v2AttachmentMigrationStrategies,
  },
  templates: {
    schema: templateSchema,
    ...baseCollection,
    migrationStrategies: v3TemplateMigrationStrategies,
  },
  folders: {
    schema: folderSchema,
    ...baseCollection,
    migrationStrategies: v4FolderMigrationStrategies,
  },
  versions: {
    schema: versionSchema,
    ...baseCollection,
    migrationStrategies: v2VersionMigrationStrategies,
  },
  flashcards: {
    schema: flashcardSchema,
    ...baseCollection,
    migrationStrategies: v2FlashcardMigrationStrategies,
  },
  messages: {
    schema: messageSchema,
    ...baseCollection,
    migrationStrategies: v4MessageMigrationStrategies,
  },
  chunks: {
    schema: chunkSchema,
    ...baseCollection,
    migrationStrategies: v3ChunkMigrationStrategies,
  },
  highlights: {
    schema: highlightSchema,
    ...baseCollection,
    migrationStrategies: v3HighlightMigrationStrategies,
  },
  insights: {
    schema: insightSchema,
    ...baseCollection,
    migrationStrategies: v3InsightMigrationStrategies,
  },
  ...Object.fromEntries(
    Object.entries(MEMORY_COLLECTION).map(([name, config]) => [
      name,
      {
        ...config,
        ...baseCollection,
        migrationStrategies: v3MemoryMigrationStrategies,
      },
    ]),
  ),
};
