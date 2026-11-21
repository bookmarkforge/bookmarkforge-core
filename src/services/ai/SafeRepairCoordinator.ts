import { initDB } from "../../db/database";
import { BehaviorSubject } from "rxjs";
import { securityVault } from "../SecurityVault";
import { ragEngine } from "./RAGEngine";
import { vectorIndexService } from "./VectorIndexService";
import { autoProcessorService } from "./AutoProcessorService";
import {
  scanVaultHealth,
  type VaultHealthReport,
} from "./VaultHealthScanner";
import { logger } from "../../utils/logger";
import { safeErrorForLog } from "../../utils/safeErrorForLog";

const MAX_ITEMS_PER_CYCLE = 5;
const MAX_ORPHAN_REMOVALS_PER_CYCLE = 25;
const MAX_REPAIR_FAILURES_BEFORE_PAUSE = 3;

type SafeRepairKind =
  | "pending-processing"
  | "missing-embedding"
  | "index-rebuild";

type SafeRepairResultStatus = "completed" | "partial" | "failed" | "skipped";

export interface SafeRepairResult {
  status: SafeRepairResultStatus;
  repaired: number;
  skipped: number;
  failed: number;
  operations: SafeRepairKind[];
  report: VaultHealthReport | null;
}

interface SafeRepairOptions {
  signal?: AbortSignal;
  maxItems?: number;
}

export interface SafeRepairStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  lastResult: SafeRepairResult | null;
  consecutiveFailures: number;
  pausedUntil: number | null;
}

function abortError(): Error {
  const error = new Error("Vault repair aborted");
  error.name = "AbortError";
  return error;
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
  if (securityVault.isLocked()) {
    const error = new Error("Vault repair requires an unlocked vault");
    error.name = "VAULT_LOCKED";
    throw error;
  }
}

function countIssue(report: VaultHealthReport, kind: string): number {
  return report.issues.find((issue) => issue.kind === kind)?.count ?? 0;
}

/**
 * Runs only safe, regenerable repairs. The coordinator is process-wide and
 * serializes calls so automatic maintenance cannot overlap with itself.
 */
class SafeRepairCoordinator {
  private active: Promise<SafeRepairResult> | null = null;
  private lastRunAt: string | null = null;
  private lastResult: SafeRepairResult | null = null;
  private consecutiveFailures = 0;
  private pausedUntil: number | null = null;
  private statusSubject = new BehaviorSubject<SafeRepairStatus>(this.getStatus());

  get isRunning(): boolean {
    return this.active !== null;
  }

  getStatus(): SafeRepairStatus {
    return {
      isRunning: this.isRunning,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      consecutiveFailures: this.consecutiveFailures,
      pausedUntil: this.pausedUntil,
    };
  }

  get status$() {
    return this.statusSubject.asObservable();
  }

  private publishStatus(): void {
    this.statusSubject.next(this.getStatus());
  }

  async run(options: SafeRepairOptions = {}): Promise<SafeRepairResult> {
    if (this.active) return this.active;
    if (this.pausedUntil !== null && Date.now() < this.pausedUntil) {
      return {
        status: "skipped",
        repaired: 0,
        skipped: 0,
        failed: 0,
        operations: [],
        report: null,
      };
    }
    const operation = this.runExclusive(options);
    this.active = operation;
    this.publishStatus();
    try {
      const result = await operation;
      this.lastRunAt = new Date().toISOString();
      this.lastResult = result;
      if (result.status === "failed") {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= MAX_REPAIR_FAILURES_BEFORE_PAUSE) {
          this.pausedUntil = Date.now() + 5 * 60 * 1000;
        }
      } else if (result.status === "completed") {
        this.consecutiveFailures = 0;
        this.pausedUntil = null;
      }
      this.publishStatus();
      return result;
    } finally {
      if (this.active === operation) {
        this.active = null;
        this.publishStatus();
      }
    }
  }

  private async runExclusive({ signal, maxItems = MAX_ITEMS_PER_CYCLE }: SafeRepairOptions): Promise<SafeRepairResult> {
    const limit = Math.max(1, Math.min(MAX_ITEMS_PER_CYCLE, Math.floor(maxItems)));
    assertActive(signal);
    let report = await scanVaultHealth(signal);
    if (!report.complete) {
      return {
        status: "skipped",
        repaired: 0,
        skipped: report.issues.reduce((total, issue) => total + issue.count, 0),
        failed: 0,
        operations: [],
        report,
      };
    }
    let repaired = 0;
    let skipped = 0;
    let failed = 0;
    const operations: SafeRepairKind[] = [];

    const pendingCount = countIssue(report, "pending-processing");
    if (pendingCount > 0) {
      operations.push("pending-processing");
      try {
        // The existing processor owns the complete transactional workflow,
        // retries and privacy routing. Its bounded entry point avoids starting
        // and immediately stopping the subscription (which would only wait
        // for its debounce timer and repair nothing).
        const outcome = await autoProcessorService.processPendingItems(limit, signal);
        repaired += outcome.processed;
        failed += outcome.failed;
        skipped += outcome.skipped;
      } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.name === "VAULT_LOCKED")) {
          throw error;
        }
        failed += Math.min(pendingCount, limit);
        logger.warn("[SafeRepairCoordinator] Pending processing failed", {
          error: safeErrorForLog(error),
        });
      }
    }

    assertActive(signal);
    const missingEmbeddings = countIssue(report, "missing-embedding");
    if (missingEmbeddings > 0 && repaired < limit) {
      operations.push("missing-embedding");
      try {
        const db = await initDB();
        const [bookmarks, documents] = await Promise.all([
          db.bookmarks.find({ selector: { isDeleted: false }, limit }).exec(),
          db.documents.find({ selector: { isDeleted: false }, limit }).exec(),
        ]);
        let processed = 0;
        for (const item of [...bookmarks, ...documents]) {
          if (processed >= limit || repaired >= limit) break;
          assertActive(signal);
          if (item.embedding && item.embedding.length > 0) continue;
          const text = "title" in item
            ? `${item.title} ${(item as { summary?: string }).summary ?? ""} ${(item as { content?: string }).content ?? ""}`.trim()
            : "";
          const embedding = await ragEngine.generateEmbedding(text, signal);
          assertActive(signal);
          await item.incrementalPatch({ embedding, updatedAt: new Date().toISOString() });
          processed += 1;
          repaired += 1;
        }
      } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.name === "VAULT_LOCKED")) {
          throw error;
        }
        failed += 1;
        logger.warn("[SafeRepairCoordinator] Embedding repair failed", {
          error: safeErrorForLog(error),
        });
      }
    }

    assertActive(signal);
    const needsIndexRebuild = countIssue(report, "index-rebuild-recommended") > 0;
    if (needsIndexRebuild && repaired < limit) {
      operations.push("index-rebuild");
      try {
        await vectorIndexService.rebuild();
        repaired += 1;
      } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.name === "VAULT_LOCKED")) {
          throw error;
        }
        failed += 1;
        logger.warn("[SafeRepairCoordinator] Index rebuild failed", {
          error: safeErrorForLog(error),
        });
      }
    }

    assertActive(signal);
    // Orphan chunks are not removed in this phase. Their ownership can be
    // ambiguous during sync, so they remain a review-only finding.
    if (countIssue(report, "orphan-chunk") > MAX_ORPHAN_REMOVALS_PER_CYCLE) {
      skipped += countIssue(report, "orphan-chunk");
    }
    report = await scanVaultHealth(signal);
    const remaining = report.issues.reduce((total, issue) => total + issue.count, 0);
    if (operations.length === 0) skipped = remaining;
    else if (failed > 0) skipped = remaining;

    return {
      status: failed > 0 ? (repaired > 0 ? "partial" : "failed") : "completed",
      repaired,
      skipped,
      failed,
      operations,
      report,
    };
  }
}

export const safeRepairCoordinator = new SafeRepairCoordinator();
