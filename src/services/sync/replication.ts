// Simple-peer (RxDB WebRTC replication) requires `process.nextTick` in the
// runtime. Load the shim here so the direct SyncService import path (used by
// the e2e suite, bypassing main.tsx) is covered too — see src/polyfills.ts.
import "../../polyfills";

// P0 privacy boundary: RxDB WebRTC replication has no server-side selector,
// so it must use an explicit allowlist. Only the two collections whose records
// have a reviewed, non-private sync contract are eligible. Every other current
// or future collection is local-only by default (messages, memory, highlights,
// insights, versions, templates and derived chunks included).
export const SYNC_ALLOWED_COLLECTIONS: ReadonlySet<string> = new Set([
  "bookmarks",
  "documents",
]);
/** Keep each RxDB replication request bounded; the plugin applies this to pull/push. */
export const SYNC_REPLICATION_BATCH_SIZE = 100;
/**
 * RxDB's WebRTC replication plugin invokes modifiers before a document is
 * written to the remote side or persisted from the remote side. Throwing for
 * private records is deliberately fail-closed: the direct replication path has
 * no collection selector, so a privacy guard must reject the record at both
 * modifier boundaries instead of relying only on the asynchronous collection
 * observer (which would be too late).
 */
function rejectPrivateSyncDocument<T>(doc: T): T {
  // Privacy metadata is security-critical. Missing, null, or malformed values
  // are treated as private rather than being allowed across a replication
  // boundary. The preflight and schema validators provide defense in depth,
  // but this modifier is the last synchronous gate before RxDB transfers data.
  if (typeof doc === "object" && doc !== null && (doc as { isPrivate?: unknown }).isPrivate === true) {
    throw new Error("Private document rejected by replication boundary");
  }
  if (
    typeof doc !== "object" ||
    doc === null ||
    (doc as { isPrivate?: unknown }).isPrivate !== false
  ) {
    throw new Error("[SyncService] Sync document missing explicit public privacy metadata");
  }
  return doc;
}

export const syncReplicationModifier = rejectPrivateSyncDocument as never;
