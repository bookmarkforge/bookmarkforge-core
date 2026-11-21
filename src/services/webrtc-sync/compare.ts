import { compareRxRevision } from "../../utils/syncVersion";

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Compare protocol digests without returning on the first mismatching byte.
 * Inputs are protocol metadata already bounded by the message validators, but
 * the loop also consumes the complete longer value for malformed direct calls.
 */
export function constantTimeStringEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index++) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    difference |= leftCode ^ rightCode;
  }
  return difference === 0;
}

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

/**
 * Deterministic sync LWW order shared by every WebRTC receiver:
 * updatedAt -> numeric RxDB revision height/hash -> document id -> canonical
 * payload.
 * The final component only handles malformed/equal-clock inputs; it prevents
 * arrival order from becoming an implicit tie-break for hostile peers.
 */
export function compareSyncVersions(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const leftUpdatedAt = typeof left.updatedAt === "string" ? left.updatedAt : "";
  const rightUpdatedAt = typeof right.updatedAt === "string" ? right.updatedAt : "";
  if (leftUpdatedAt && rightUpdatedAt) {
    const leftTime = Date.parse(leftUpdatedAt);
    const rightTime = Date.parse(rightUpdatedAt);
    const timestampComparison =
      Number.isFinite(leftTime) && Number.isFinite(rightTime)
        ? leftTime - rightTime
        : compareCodeUnits(leftUpdatedAt, rightUpdatedAt);
    if (timestampComparison !== 0) {
      return timestampComparison > 0 ? 1 : -1;
    }
  }

  const revisionComparison = compareRxRevision(
    typeof left._rev === "string" ? left._rev : "",
    typeof right._rev === "string" ? right._rev : "",
  );
  if (revisionComparison !== 0) {
    return revisionComparison;
  }

  const idComparison = compareCodeUnits(
    typeof left.id === "string" ? left.id : "",
    typeof right.id === "string" ? right.id : "",
  );
  if (idComparison !== 0) {
    return idComparison;
  }

  return compareCodeUnits(stableSerialize(left), stableSerialize(right));
}


/**
 * LWW admission decision shared by every sync receiver batch path.
 *
 * `incoming` is the validated remote document; `local` is the flattened local
 * state for the same id (already merged with the RxDB document's toJSON(), or
 * `null` when no local copy exists).
 *
 * Rules (must stay in lockstep with the documented contract in
 * WebRTCSyncService.upsertBatch):
 *  1. No local copy -> the incoming document applies.
 *  2. Local `isPrivate === true` -> NEVER overwritten, not even by a newer
 *     remote tombstone or live copy.
 *  3. Otherwise the incoming document applies only when
 *     `compareSyncVersions(incoming, local) > 0` — a stale peer snapshot can
 *     never regress a newer local edit, and an equal version is a no-op.
 */
export function shouldApplyIncomingSyncDoc(
  incoming: Record<string, unknown>,
  local: Record<string, unknown> | null,
): boolean {
  if (!local) {
    return true;
  }
  if (local.isPrivate === true) {
    return false;
  }
  return compareSyncVersions(incoming, local) > 0;
}
