/**
 * KnowledgeAudit scan perf gate — nightly scope.
 *
 * Seeds 10,000 real bookmark documents through the app's RxDB/IndexedDB
 * path, then measures the same bounded query and `runAuditScan` execution used
 * by the KnowledgeAudit card. It performs both a cold worker scan and a warm
 * re-scan over the same in-memory sample, without re-seeding the vault. The
 * benchmark verifies worker wall-time budgets and main-thread responsiveness
 * while both scans are active.
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import type { BookmarkDocType } from "../../src/db/schema";

const MAX_SEED_COUNT = 100_000;
const DEFAULT_SEED_COUNT = 10_000;

function readSeedCount(raw: string | undefined): number {
  const parsed = Number(raw ?? DEFAULT_SEED_COUNT);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SEED_COUNT) {
    throw new Error(
      `PERF_SEED must be an integer between 1 and ${MAX_SEED_COUNT}; got ${raw ?? DEFAULT_SEED_COUNT}`,
    );
  }
  return parsed;
}

const SEED_COUNT = readSeedCount(process.env.PERF_SEED);
const BUDGET_INSERT_MS = Math.max(60_000, SEED_COUNT * 6);
const BUDGET_QUERY_MS = 3_000;
const BUDGET_WORKER_SCAN_MS = 1_000;
const BUDGET_WARM_WORKER_SCAN_MS = 750;
const BUDGET_MAX_FRAME_GAP_MS = 150;
const BUDGET_WARM_MAX_FRAME_GAP_MS = 150;

const AUDIT_TAGS = [
  "ai",
  "security",
  "design",
  "data",
  "cloud",
  "testing",
  "performance",
  "research",
] as const;

function makeBookmarkDocs(count: number): BookmarkDocType[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i): BookmarkDocType => {
    const topic = AUDIT_TAGS[i % AUDIT_TAGS.length]!;
    const createdAt = new Date(now - (i + 400) * 86_400_000).toISOString();
    const lastVisitedAt =
      i % 3 === 0
        ? new Date(now - (i % 30) * 86_400_000).toISOString()
        : "";
    return {
      id: `audit-${i}-${now}`,
      url: `https://example.com/audit/${topic}/${i}`,
      urlHash: "",
      title: `Knowledge audit bookmark ${i} — ${topic}`,
      content: `Persisted audit benchmark content ${i}. `.repeat(3),
      summary: `Audit benchmark summary ${i}`,
      tags: [topic, `topic-${i % 24}`],
      relatedLinks: [],
      processed: true,
      isPrivate: false,
      isDeleted: false,
      visitCount: i % 50,
      ...(lastVisitedAt ? { lastVisitedAt } : {}),
      createdAt,
      updatedAt: new Date(now - i * 60_000).toISOString(),
    };
  });
}

interface ScanPassMetrics {
  workerScanMs: number;
  maxFrameGapMs: number;
  tickCount: number;
  totalTags: number;
  phases: Array<[string, number]>;
}

interface AuditScanMetrics extends ScanPassMetrics {
  seeded: number;
  totalBookmarks: number;
  sampleSize: number;
  insertMs: number;
  queryMs: number;
  warmWorkerScanMs: number;
  warmMaxFrameGapMs: number;
  warmTickCount: number;
  warmTotalTags: number;
  warmPhases: Array<[string, number]>;
}

async function seedAndMeasure(
  page: Page,
  docs: BookmarkDocType[],
): Promise<AuditScanMetrics> {
  return page.evaluate(async (payload) => {
    const { initDB } = await import("/src/db/database.ts");
    const { boundedBookmarkQuery } = await import(
      "/src/utils/knowledgeCardBounds.ts"
    );
    const { MAX_AUDIT_SAMPLE } = await import("/src/utils/auditScan.ts");
    const { runAuditScan } = await import("/src/services/auditScanService.ts");

    const db = await initDB();
    await db.bookmarks.find().remove();

    const insertStart = performance.now();
    await db.bookmarks.bulkInsert(payload.docs);
    const insertMs = performance.now() - insertStart;

    const queryStart = performance.now();
    const [totalBookmarks, docs] = await Promise.all([
      db.bookmarks.count().exec(),
      boundedBookmarkQuery(db.bookmarks, MAX_AUDIT_SAMPLE).exec(),
    ]);
    const bookmarks = docs.map((bm) => ({
      id: bm.id,
      title: bm.title,
      tags: Array.isArray(bm.tags) ? bm.tags : [],
      createdAt: bm.createdAt || "",
      lastVisitedAt: bm.lastVisitedAt || "",
      updatedAt: bm.updatedAt || "",
    }));
    const queryMs = performance.now() - queryStart;

    const measureScan = async (): Promise<ScanPassMetrics> => {
      const phases: Array<[string, number]> = [];
      let maxFrameGapMs = 0;
      let lastFrame = performance.now();
      let tickCount = 0;
      const ticker = setInterval(() => {
        const now = performance.now();
        const gap = now - lastFrame;
        if (gap > maxFrameGapMs) {
          maxFrameGapMs = gap;
        }
        lastFrame = now;
        tickCount += 1;
      }, 16);

      const scanStart = performance.now();
      const result = await runAuditScan(bookmarks, {
        onProgress: (phase, fraction) => {
          phases.push([phase, fraction]);
        },
      });
      const workerScanMs = performance.now() - scanStart;
      clearInterval(ticker);

      return {
        workerScanMs,
        maxFrameGapMs,
        tickCount,
        totalTags: result.totalTags,
        phases,
      };
    };

    // Cold pass: includes worker-pool creation. The warm pass deliberately
    // reuses the same vault sample and pool; it must not re-seed or re-query.
    const cold = await measureScan();
    const warm = await measureScan();

    return {
      seeded: payload.docs.length,
      totalBookmarks,
      sampleSize: bookmarks.length,
      insertMs,
      queryMs,
      workerScanMs: cold.workerScanMs,
      maxFrameGapMs: cold.maxFrameGapMs,
      tickCount: cold.tickCount,
      totalTags: cold.totalTags,
      phases: cold.phases,
      warmWorkerScanMs: warm.workerScanMs,
      warmMaxFrameGapMs: warm.maxFrameGapMs,
      warmTickCount: warm.tickCount,
      warmTotalTags: warm.totalTags,
      warmPhases: warm.phases,
    };
  }, { docs });
}

test.describe(`KnowledgeAudit scan: ${SEED_COUNT.toLocaleString()} bookmarks`, () => {
  test("runAuditScan stays sub-second without blocking frames", async ({ page }) => {
    // Seed-phase floor calibrated for CI runners (see perf-scale.nightly.spec.ts:
    // the 120s floor killed the seeding evaluate before any budget could fire).
    test.setTimeout(Math.max(240_000, SEED_COUNT * 15));

    await page.goto("/");
    await skipPassword(page);

    const metrics = await seedAndMeasure(page, makeBookmarkDocs(SEED_COUNT));

    expect(metrics.seeded).toBe(SEED_COUNT);
    expect(metrics.totalBookmarks).toBe(SEED_COUNT);
    expect(metrics.sampleSize).toBeLessThanOrEqual(2_000);
    expect(metrics.sampleSize).toBeGreaterThan(0);
    expect(metrics.insertMs, "bulk insert of real bookmark documents").toBeLessThan(
      BUDGET_INSERT_MS,
    );
    expect(metrics.queryMs, "bounded audit query and projection").toBeLessThan(
      BUDGET_QUERY_MS,
    );
    expect(metrics.workerScanMs, "KnowledgeAudit worker scan wall time").toBeLessThan(
      BUDGET_WORKER_SCAN_MS,
    );
    expect(
      metrics.maxFrameGapMs,
      "maximum main-thread frame gap during cold runAuditScan",
    ).toBeLessThan(BUDGET_MAX_FRAME_GAP_MS);
    expect(
      metrics.warmWorkerScanMs,
      "warm KnowledgeAudit re-scan wall time",
    ).toBeLessThan(BUDGET_WARM_WORKER_SCAN_MS);
    expect(
      metrics.warmMaxFrameGapMs,
      "maximum main-thread frame gap during warm re-scan",
    ).toBeLessThan(BUDGET_WARM_MAX_FRAME_GAP_MS);

    expect(metrics.totalTags).toBeGreaterThan(0);
    expect(metrics.warmTotalTags).toBe(metrics.totalTags);
    expect(metrics.phases[0]?.[0]).toBe("scanning");
    expect(metrics.phases.some(([phase]) => phase === "aggregating")).toBe(true);
    expect(metrics.phases.at(-1)).toEqual(["done", 1]);
    expect(metrics.warmPhases[0]?.[0]).toBe("scanning");
    expect(metrics.warmPhases.some(([phase]) => phase === "aggregating")).toBe(true);
    expect(metrics.warmPhases.at(-1)).toEqual(["done", 1]);

    const perf = {
      seed: metrics.seeded,
      totalBookmarks: metrics.totalBookmarks,
      sampleSize: metrics.sampleSize,
      insertMs: Math.round(metrics.insertMs),
      queryMs: Math.round(metrics.queryMs),
      workerScanMs: Math.round(metrics.workerScanMs),
      maxFrameGapMs: Math.round(metrics.maxFrameGapMs),
      tickCount: metrics.tickCount,
      warmWorkerScanMs: Math.round(metrics.warmWorkerScanMs),
      warmMaxFrameGapMs: Math.round(metrics.warmMaxFrameGapMs),
      warmTickCount: metrics.warmTickCount,
      totalTags: metrics.totalTags,
      warmTotalTags: metrics.warmTotalTags,
      phases: metrics.phases,
      warmPhases: metrics.warmPhases,
      budgets: {
        insertMs: BUDGET_INSERT_MS,
        queryMs: BUDGET_QUERY_MS,
        workerScanMs: BUDGET_WORKER_SCAN_MS,
        maxFrameGapMs: BUDGET_MAX_FRAME_GAP_MS,
        warmWorkerScanMs: BUDGET_WARM_WORKER_SCAN_MS,
        warmMaxFrameGapMs: BUDGET_WARM_MAX_FRAME_GAP_MS,
      },
    };
    await test.info().attach("audit-scan-metrics.json", {
      body: JSON.stringify(perf, null, 2),
      contentType: "application/json",
    });
    test.info().annotations.push({
      type: "perf",
      description:
        `seed=${perf.seed} sample=${perf.sampleSize} ` +
        `insert=${perf.insertMs}ms query=${perf.queryMs}ms ` +
        `workerScan=${perf.workerScanMs}ms ` +
        `maxFrameGap=${perf.maxFrameGapMs}ms ` +
        `warmWorkerScan=${perf.warmWorkerScanMs}ms ` +
        `warmMaxFrameGap=${perf.warmMaxFrameGapMs}ms ` +
        `tags=${perf.totalTags}`,
    });
  });
});
