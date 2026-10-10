/**
 * Audit-scan Web Worker — runs the knowledge-audit aggregation off the
 * main thread so a vault with 100k+ bookmarks cannot freeze the UI.
 *
 * Speaks the WorkerPool protocol (src/utils/WorkerPool.ts): the pool posts
 * `{ taskId, type, payload }` and this worker replies with
 * `{ taskId, result }` on success, `{ taskId, status, progress }` at
 * coarse checkpoints, or `{ taskId, error, fatal? }` on failure.
 * Created indirectly via getWorkerPool(), so the consumer must import this
 * file with the `?worker&url` suffix for Vite's static worker detection.
 *
 * The computation itself lives in src/utils/auditScan.ts (pure, no
 * worker-specific APIs), which keeps the worker thin and unit-testable.
 */
import {
  computeAuditScan,
  type AuditBookmark,
  type AuditScanResult,
} from "../utils/auditScan";

/** Upper bound for a single scan payload (defense against memory abuse). */
const MAX_BOOKMARKS_PER_SCAN = 100_000;
const MAX_QUEUED_MESSAGES = 16;

function postError(taskId: string, error: string, fatal = false): void {
  self.postMessage({
    taskId,
    error,
    ...(fatal ? { fatal: true } : {}),
  });
}

function validateAuditPayload(payload: unknown): AuditBookmark[] | null {
  if (typeof payload !== "object" || payload === null) {return null;}
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.bookmarks)) {return null;}
  if (record.bookmarks.length > MAX_BOOKMARKS_PER_SCAN) {return null;}
  const bookmarks: AuditBookmark[] = [];
  for (const raw of record.bookmarks) {
    if (typeof raw !== "object" || raw === null) {return null;}
    const bm = raw as Record<string, unknown>;
    if (
      typeof bm.id !== "string" ||
      typeof bm.title !== "string" ||
      !Array.isArray(bm.tags) ||
      !bm.tags.every((tag) => typeof tag === "string")
    ) {
      return null;
    }
    bookmarks.push({
      id: bm.id,
      title: bm.title,
      tags: bm.tags,
      createdAt: typeof bm.createdAt === "string" ? bm.createdAt : "",
      lastVisitedAt:
        typeof bm.lastVisitedAt === "string" ? bm.lastVisitedAt : "",
      updatedAt: typeof bm.updatedAt === "string" ? bm.updatedAt : "",
    });
  }
  return bookmarks;
}

let queuedMessages = 0;
let messageQueue: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent) => {
  if (e.origin && e.origin !== self.location.origin) return Promise.resolve();
  const { taskId, type, payload } = (e.data ?? {}) as Record<string, unknown>;

  // The pool always sends taskId/type; guard anyway so malformed messages
  // get a deterministic error instead of a hang.
  if (typeof taskId !== "string" || taskId.length === 0) {
    self.postMessage({
      taskId: "unknown",
      error: "Missing required field: taskId",
    });
    return Promise.resolve();
  }
  if (type !== "auditScan") {
    postError(taskId, `Unknown worker message type: ${String(type)}`);
    return Promise.resolve();
  }

  if (queuedMessages >= MAX_QUEUED_MESSAGES) {
    postError(taskId, "Worker message queue capacity exceeded; retry later");
    return Promise.resolve();
  }

  queuedMessages += 1;
  messageQueue = messageQueue
    .then(() => {
      const bookmarks = validateAuditPayload(payload);
      if (!bookmarks) {
        postError(
          taskId,
          "Audit payload must be an object with a bookmarks array (id/title strings, tags string array)",
        );
        return;
      }
      const result: AuditScanResult = computeAuditScan(
        bookmarks,
        Date.now(),
        (status, progress) => {
          self.postMessage({ taskId, status, progress });
        },
      );
      self.postMessage({ taskId, result });
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : String(error);
      // Sanitize: never leak stack traces or paths to the main thread.
      postError(
        taskId,
        message.length > 200
          ? "Internal worker error"
          : message.replace(/\/(?:[^/]*\/)+/g, "[path]").substring(0, 200),
      );
    })
    .finally(() => {
      queuedMessages -= 1;
    });
  return messageQueue;
};
