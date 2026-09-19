import {
  MAX_BLOCKS_BYTES,
  MAX_SDP_CHARS,
  MAX_SYNC_AUTH_LENGTH,
  MAX_SYNC_CURSOR_LENGTH,
  MAX_TOTAL_PAYLOAD,
  SHA256_HEX_PATTERN,
} from "./protocol";

export interface SyncStartMessage {
  type: "sync_start";
  totalChunks: number;
  checksum: string;
  /** Ephemeral per-sync HMAC key, delivered over the already-DTLS-encrypted
   * data channel. Used to authenticate the payload (checksum alone only
   * proves integrity, not authenticity). */
  auth?: string;
  /** HMAC-SHA256(auth, payload) of the full payload. */
  hmac?: string;
  /** Optional pagination metadata. Omitted means the legacy final batch. */
  batchId?: string;
  batchIndex?: number;
  hasMore?: boolean;
  /** Identifies the complete paginated transfer, not just one batch. */
  syncSessionId?: string;
}

export interface SyncAckMessage {
  type: "sync_ack";
  batchId: string;
}

export interface SyncChunkMessage {
  type: "sync_chunk";
  index: number;
  data: string;
}

export function isBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLength
  );
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

// Upper bound on how far ahead of the local clock a received updatedAt may
// lie. Sync LWW (compareSyncVersions) keys on updatedAt: an unbounded future
// timestamp from a malicious peer would win every conflict forever and
// permanently poison the vault. The bounded tolerance absorbs legitimate
// clock skew between devices without admitting that attack.
const MAX_SYNC_TIMESTAMP_FUTURE_MS = 5 * 60 * 1000;

/** A sync timestamp that is parseable and not more than the bounded clock
 * tolerance ahead of the local clock. Empty strings are deliberately excluded
 * here; the permissive legacy path treats them as absent (LWW already falls
 * through to revision comparison for falsy updatedAt values). */
export function isBoundedSyncTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) {
    return false;
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return time - Date.now() <= MAX_SYNC_TIMESTAMP_FUTURE_MS;
}

/** The optional incremental-sync cursor in the capability handshake: an
 * ISO-8601 timestamp string, or null/absent to signal a full snapshot. */
export function isOptionalSyncCursor(value: unknown): value is string | null {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_SYNC_CURSOR_LENGTH)
  );
}

export function isSyncStartMessage(value: unknown): value is SyncStartMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<SyncStartMessage>;
  if (
    !Number.isInteger(message.totalChunks) ||
    message.totalChunks! < 1 ||
    message.totalChunks! > 2000
  ) {
    return false;
  }
  if (message.checksum !== undefined && !isSha256Hex(message.checksum)) return false;
  if (message.auth !== undefined && !isBoundedString(message.auth, MAX_SYNC_AUTH_LENGTH)) return false;
  if (message.hmac !== undefined && !isSha256Hex(message.hmac)) return false;
  if ((message.auth === undefined) !== (message.hmac === undefined)) return false;
  if (message.batchId !== undefined && !isBoundedString(message.batchId, 100)) return false;
  if (message.batchIndex !== undefined && (!Number.isInteger(message.batchIndex) || message.batchIndex < 0)) return false;
  if (message.hasMore !== undefined && typeof message.hasMore !== "boolean") return false;
  if (message.syncSessionId !== undefined && !isBoundedString(message.syncSessionId, 100)) return false;

  const hasPaginationMetadata =
    message.batchId !== undefined ||
    message.batchIndex !== undefined ||
    message.hasMore !== undefined ||
    message.syncSessionId !== undefined;
  if (
    hasPaginationMetadata &&
    (message.batchId === undefined ||
      message.batchIndex === undefined ||
      message.hasMore === undefined ||
      message.syncSessionId === undefined)
  ) {
    return false;
  }

  // Current senders authenticate every payload. A no-checksum/no-auth start
  // remains accepted solely for the pre-pagination legacy protocol.
  const hasAuth = message.auth !== undefined;
  // hasMore is guaranteed defined when hasPaginationMetadata holds.
  if (hasPaginationMetadata && (!hasAuth || message.checksum === undefined)) return false;
  if (hasAuth && (message.checksum === undefined || message.batchId === undefined)) return false;
  // A checksum-only start is accepted as the explicitly legacy protocol:
  // it gets integrity validation but not authenticated strict-schema mode.
  if (message.checksum !== undefined && !hasAuth && message.batchId !== undefined) return false;
  return true;
}

export function isString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

export function isStringArray(
  value: unknown,
  maxItems = 10_000,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isString(item, 2_000))
  );
}

export function isValidSessionDescription(
  value: unknown,
): value is RTCSessionDescriptionInit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const description = value as Record<string, unknown>;
  if (description.type !== "offer" && description.type !== "answer") {
    return false;
  }
  if (
    typeof description.sdp !== "string" ||
    description.sdp.length === 0 ||
    description.sdp.length > MAX_SDP_CHARS ||
    description.sdp.includes(String.fromCharCode(0))
  ) {
    return false;
  }
  return true;
}

export function isValidSyncDoc(
  doc: unknown,
  collection: "documents" | "bookmarks",
  strictSchema: boolean,
): doc is Record<string, unknown> {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return false;
  const record = doc as Record<string, unknown>;
  if (!isBoundedString(record.id, 100)) return false;
  // Private records are a hard local-only boundary. Reject them even on the
  // legacy permissive path; an authenticated peer must never use sync as a
  // way to transfer or overwrite private content.
  if (record.isPrivate === true) return false;

  if (collection === "documents") {
    if (
      strictSchema &&
      (!isBoundedString(record.folderId, 100) ||
        !isString(record.title, 500) ||
        !Array.isArray(record.blocks) ||
        !isStringArray(record.tags) ||
        !isStringArray(record.links) ||
        typeof record.processed !== "boolean" ||
        typeof record.isPrivate !== "boolean" ||
        typeof record.isDeleted !== "boolean" ||
        !isBoundedString(record.createdAt, 100) ||
        !isBoundedSyncTimestamp(record.updatedAt))
    ) {
      return false;
    }
  }

  if (collection === "bookmarks") {
    if (
      strictSchema &&
      (!isString(record.url, 2_000) ||
        !isString(record.title, 500) ||
        !isStringArray(record.tags) ||
        !isStringArray(record.relatedLinks) ||
        typeof record.processed !== "boolean" ||
        typeof record.isPrivate !== "boolean" ||
        typeof record.isDeleted !== "boolean" ||
        !Number.isInteger(record.visitCount) ||
        (record.visitCount as number) < 0 ||
        (record.visitCount as number) > 1_000_000 ||
        !isBoundedString(record.createdAt, 100) ||
        !isBoundedSyncTimestamp(record.updatedAt))
    ) {
      return false;
    }
  }

  if (record.title !== undefined && !isString(record.title, 500)) return false;
  if (record.url !== undefined && !isString(record.url, 2_000)) return false;
  if (record.folderId !== undefined && !isString(record.folderId, 100)) return false;
  if (record.createdAt !== undefined && !isString(record.createdAt, 100)) return false;
  // Permissive path: an empty updatedAt is treated as absent (LWW falls
  // through to revision comparison); any non-empty value must be a bounded
  // parseable timestamp to block far-future LWW poisoning.
  if (
    record.updatedAt !== undefined &&
    record.updatedAt !== "" &&
    !isBoundedSyncTimestamp(record.updatedAt)
  ) {
    return false;
  }
  if (record.content !== undefined && !isString(record.content, MAX_TOTAL_PAYLOAD)) return false;
  if (record.summary !== undefined && !isString(record.summary, MAX_TOTAL_PAYLOAD)) return false;
  if (record.textContent !== undefined && !isString(record.textContent, MAX_TOTAL_PAYLOAD)) return false;
  if (record.tags !== undefined && !isStringArray(record.tags)) return false;
  if (record.links !== undefined && !isStringArray(record.links)) return false;
  if (record.relatedLinks !== undefined && !isStringArray(record.relatedLinks)) return false;
  if (record.processed !== undefined && typeof record.processed !== "boolean") return false;
  if (record.isPrivate !== undefined && typeof record.isPrivate !== "boolean") return false;
  if (record.isDeleted !== undefined && typeof record.isDeleted !== "boolean") return false;
  if (record.visitCount !== undefined && (!Number.isInteger(record.visitCount) || (record.visitCount as number) < 0 || (record.visitCount as number) > 1_000_000)) return false;
  if (record.blocks !== undefined) {
    if (!Array.isArray(record.blocks) || record.blocks.length > 50_000) return false;
    try {
      if (JSON.stringify(record.blocks).length > MAX_BLOCKS_BYTES) return false;
    } catch {
      return false;
    }
  }
  if (record.embedding !== undefined && (!Array.isArray(record.embedding) || record.embedding.length > 4_096 || !record.embedding.every((value) => typeof value === "number" && Number.isFinite(value)))) return false;
  return true;
}
