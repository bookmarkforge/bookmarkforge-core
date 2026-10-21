/**
 * Pure knowledge-audit aggregation (KnowledgeAudit card).
 *
 * Extracted from the component so the scan can run in a Web Worker
 * (src/workers/auditScan.worker.ts) with an inline fallback
 * (src/services/auditScanService.ts). The component bounds the input
 * to the newest MAX_AUDIT_SAMPLE bookmarks (by updatedAt) before
 * calling this — the report is a representative health dashboard on
 * large vaults, not an exact census. `totalBookmarks` is reported
 * separately from a cheap count() query so the headline number stays
 * exact even though the per-tag/per-visit metrics are sample-based.
 *
 * Semantics are byte-for-byte the original component loop: visit
 * windows of 30d, outdated after 365d with no recent visit, tag
 * coverage with last-visit age (-1 = never).
 */
export const MAX_AUDIT_SAMPLE = 2000;

export interface AuditBookmark {
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  lastVisitedAt: string;
  updatedAt: string;
}

interface AuditCoverageEntry {
  tag: string;
  count: number;
  lastVisitDays: number;
}

export interface AuditScanResult {
  totalTags: number;
  visitedIn30d: number;
  coverageByTag: AuditCoverageEntry[];
  outdatedCount: number;
}

/** Coarse phases reported by the audit scan worker and inline fallback. */
export type AuditScanPhase = "scanning" | "aggregating" | "done";

type AuditScanProgressCallback = (
  phase: AuditScanPhase,
  fraction: number,
) => void;

const DAY_MS = 86_400_000;
const VISITED_WINDOW_MS = 30 * DAY_MS;
const OUTDATED_AFTER_MS = 365 * DAY_MS;

function lastVisitMs(raw: AuditBookmark): number {
  if (typeof raw.lastVisitedAt !== "string" || raw.lastVisitedAt.length === 0) {
    return 0;
  }
  return new Date(raw.lastVisitedAt).getTime();
}

/**
 * Computes the audit metrics over a (bounded) bookmark sample.
 * Malformed entries are skipped instead of throwing. When supplied, the
 * progress callback receives coarse checkpoints after the scan and
 * aggregation passes; a throwing callback propagates to support cancellation.
 */
export function computeAuditScan(
  bookmarks: readonly AuditBookmark[],
  now: number = Date.now(),
  onProgress?: AuditScanProgressCallback,
): AuditScanResult {
  const tagMap = new Map<string, { count: number; lastVisit: number }>();
  let visitedIn30d = 0;

  onProgress?.("scanning", 0.05);
  for (const raw of bookmarks) {
    if (!raw || typeof raw !== "object") {continue;}
    const tags = Array.isArray(raw.tags) ? raw.tags : [];
    const lastVisit = lastVisitMs(raw);
    for (const tag of tags) {
      if (typeof tag !== "string") {continue;}
      const existing = tagMap.get(tag);
      if (existing) {
        existing.count += 1;
        if (lastVisit > existing.lastVisit) {existing.lastVisit = lastVisit;}
      } else {
        tagMap.set(tag, { count: 1, lastVisit });
      }
    }
    if (lastVisit > 0 && now - lastVisit <= VISITED_WINDOW_MS) {
      visitedIn30d += 1;
    }
  }

  onProgress?.("aggregating", 0.5);
  const coverageByTag: AuditCoverageEntry[] = Array.from(tagMap.entries())
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      lastVisitDays:
        data.lastVisit > 0
          ? Math.round((now - data.lastVisit) / DAY_MS)
          : -1,
    }))
    .sort((a, b) => b.count - a.count);

  let outdatedCount = 0;
  for (const raw of bookmarks) {
    if (!raw || typeof raw !== "object") {continue;}
    const created =
      typeof raw.createdAt === "string" && raw.createdAt.length > 0
        ? new Date(raw.createdAt).getTime()
        : 0;
    const lastVisit = lastVisitMs(raw);
    const isOld = created > 0 && now - created > OUTDATED_AFTER_MS;
    const noRecentVisit =
      lastVisit === 0 || now - lastVisit > OUTDATED_AFTER_MS;
    if (isOld && noRecentVisit) {outdatedCount += 1;}
  }

  onProgress?.("done", 1);
  return {
    totalTags: tagMap.size,
    visitedIn30d,
    coverageByTag,
    outdatedCount,
  };
}
