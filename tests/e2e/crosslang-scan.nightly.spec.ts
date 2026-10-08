/**
 * tests/e2e/crosslang-scan.nightly.spec.ts
 *
 * Cross-language bridge scan perf gate — **nightly** scope.
 *
 * Seeds 10,000 real bookmarks (multilingual titles, shared cross-language
 * tags) DIRECTLY into IndexedDB through the app's own RxDB layer
 * (`initDB()` + `bookmarks.bulkInsert`, same access path as perf-scale),
 * then measures the CrossLanguageBridge scan exactly as the card runs it:
 *
 *   1. collection query + projection (find isDeleted:false → ScanBookmark);
 *   2. WORKER scan — `scanCrossLanguageBridges` through
 *      knowledgeScanService → the knowledge-scan Web Worker (the production
 *      path; on a real browser `Worker` always exists, so the pool is used);
 *   3. main-thread responsiveness DURING the worker scan — a 16 ms ticker
 *      measures the largest frame gap. A scan that silently fell back to the
 *      main thread (or a worker that blocked it) shows up here as a multi-
 *      hundred-ms gap;
 *   4. INLINE fallback — `computeBridges` on the main thread, the worst
 *      case if workers are unavailable: it must still stay sub-second.
 *
 * Budgets are sanity floors with headroom (regression guards, not
 * microbenchmarks — the active methodology in
 * `docs/PERFORMANCE-BUDGETS.md`):
 *   - worker scan wall time          < 1 000 ms  (sub-second in worker)
 *   - max main-thread frame gap      < 150 ms   (no UI blocking)
 *   - inline fallback wall time      < 1 000 ms  (sub-second worst case)
 *   - query + projection of 10k docs < 3 000 ms
 * The scan itself is bounded (MAX_ITEMS_PER_LANG=200 / MAX_SCAN_ITEMS=1200),
 * so these budgets hold regardless of SEED_COUNT: a bigger seed exercises
 * the query/sampling path, not the pairwise loop.
 *
 * Only runs under the nightly config (`npm run e2e:nightly`); the main
 * `playwright.config.ts` ignores `*.nightly.spec.ts`.
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import type { BookmarkDocType } from "../../src/db/schema";

const MAX_SEED_COUNT = 100_000;

function readSeedCount(raw: string | undefined): number {
  const parsed = Number(raw ?? 10_000);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_SEED_COUNT) {
    throw new Error(
      `PERF_SEED must be an integer between 1 and ${MAX_SEED_COUNT}; got ${raw ?? "10_000"}`,
    );
  }
  return parsed;
}

const SEED_COUNT = readSeedCount(process.env.PERF_SEED);

// Budgets (ms) — sanity floors with ~3-5x headroom over observed times.
// The insert scales with SEED_COUNT (same formula as perf-scale); the scan
// budgets are size-independent because computeBridges is bounded.
const BUDGET_INSERT_MS = Math.max(60_000, SEED_COUNT * 6);
const BUDGET_QUERY_MS = 3_000;
const BUDGET_WORKER_SCAN_MS = 1_000;
const BUDGET_INLINE_MS = 1_000;
const BUDGET_MAX_FRAME_GAP_MS = 150;

const TOPIC_TAGS = [
  "ml",
  "web",
  "security",
  "design",
  "data",
  "cloud",
  "testing",
  "perf",
  "ux",
  "devops",
  "crypto",
  "oss",
] as const;

function langFor(i: number): string {
  const mod = i % 10;
  if (mod === 0) {return "ja";}
  if (mod === 1) {return "ko";}
  if (mod === 2) {return "zh";}
  if (mod === 3) {return "ru";}
  if (mod === 4) {return "ar";}
  if (mod === 5) {return "hi";}
  return "en"; // ~40% of the dataset
}

function titleFor(lang: string, i: number, topic: string): string {
  switch (lang) {
    case "ja": {return `日本語の技術記事 ${i}：${topic}の実践ガイド`;}
    case "ko": {return `한국어 개발 문서 ${i} — ${topic} 모범 사례`;}
    case "zh": {return `中文技术文章 ${i}：${topic}实战指南`;}
    case "ru": {return `Русская техническая статья ${i} о ${topic}`;}
    case "ar": {return `مقالة عربية تقنية ${i} عن ${topic}`;}
    case "hi": {return `हिन्दी तकनीकी लेख ${i} — ${topic} ट्यूटोरियल`;}
    default: {return `English technical note ${i} — ${topic} guide`;}
  }
}

function makeBookmarkDocs(count: number): BookmarkDocType[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i): BookmarkDocType => {
    const lang = langFor(i);
    const topic = TOPIC_TAGS[i % TOPIC_TAGS.length]!;
    return {
      id: `crosslang-${i}-${now}`,
      url: `https://example.com/${lang}/${i}/deep/path/with/segments`,
      urlHash: "",
      title: titleFor(lang, i, topic),
      content: `Seeded multilingual content body for bookmark ${i} (${lang}). `.repeat(3),
      summary: `Summary of multilingual bookmark ${i}.`,
      // `topic-N` spans every language group, so bridges always form and the
      // pairwise jaccard loop runs its full bounded workload.
      tags: [topic, `topic-${i % 6}`],
      relatedLinks: [],
      processed: true,
      isPrivate: false,
      isDeleted: false,
      visitCount: i % 100,
      createdAt: new Date(now - i * 60_000).toISOString(),
      updatedAt: new Date(now - i * 60_000).toISOString(),
    };
  });
}

interface ScanMetrics {
  seeded: number;
  count: number;
  insertMs: number;
  queryMs: number;
  workerScanMs: number;
  maxFrameGapMs: number;
  tickCount: number;
  inlineMs: number;
  bridges: number;
  inlineBridges: number;
  phases: Array<[string, number]>;
  progressEndsAtOne: boolean;
}

async function seedAndMeasure(
  page: Page,
  docs: BookmarkDocType[],
): Promise<ScanMetrics> {
  return page.evaluate(async (payload) => {
    const { initDB } = await import("/src/db/database.ts");
    const { scanCrossLanguageBridges } = await import(
      "/src/services/knowledgeScanService.ts"
    );
    const { computeBridges } = await import("/src/utils/knowledgeScan.ts");

    const db = await initDB();
    await db.bookmarks.find().remove();

    const t0 = performance.now();
    await db.bookmarks.bulkInsert(payload.docs);
    const insertMs = performance.now() - t0;

    const count = await db.bookmarks.count().exec();

    // The card's data path: bounded query + projection to ScanBookmark.
    const t1 = performance.now();
    const rows = await db.bookmarks
      .find({ selector: { isDeleted: false } })
      .exec();
    const bookmarks = rows.map((bm) => ({
      id: bm.id,
      title: bm.title,
      url: bm.url,
      urlHash: "",
      tags: Array.isArray(bm.tags) ? bm.tags : [],
      updatedAt: bm.updatedAt,
    }));
    const queryMs = performance.now() - t1;

    // Worker scan with a main-thread jank probe: a 16 ms ticker measures the
    // largest frame gap while the worker does the pairwise work. A blocked
    // main thread (or a silent inline fallback) shows up as a big gap.
    const phases: Array<[string, number]> = [];
    let maxFrameGapMs = 0;
    let last = performance.now();
    let tickCount = 0;
    const ticker = setInterval(() => {
      const now = performance.now();
      const gap = now - last;
      if (gap > maxFrameGapMs) {maxFrameGapMs = gap;}
      last = now;
      tickCount += 1;
    }, 16);

    const tScan = performance.now();
    const bridges = await scanCrossLanguageBridges(bookmarks, {}, {
      onProgress: (phase, fraction) => {
        phases.push([phase, fraction]);
      },
    });
    const workerScanMs = performance.now() - tScan;
    clearInterval(ticker);

    // Inline worst case (workers unavailable): must stay sub-second too.
    const tInline = performance.now();
    const inlineBridges = computeBridges(bookmarks);
    const inlineMs = performance.now() - tInline;

    const lastPhase = phases[phases.length - 1];
    return {
      seeded: payload.docs.length,
      count,
      insertMs,
      queryMs,
      workerScanMs,
      maxFrameGapMs,
      tickCount,
      inlineMs,
      bridges: bridges.length,
      inlineBridges: inlineBridges.length,
      phases,
      progressEndsAtOne: lastPhase?.[0] === "done" && lastPhase[1] === 1,
    };
  }, { docs });
}

test.describe(`cross-language scan: ${SEED_COUNT.toLocaleString()} bookmarks`, () => {
  test("worker scan is sub-second and the main thread stays responsive", async ({
    page,
  }) => {
    // 10k ≈ 40s (insert-dominated) on dev hardware, ~2-3x on CI runners; the
    // floor must cover the seed phase, not the budgets (see
    // perf-scale.nightly.spec.ts, run 35833219915 for the failure shape).
    test.setTimeout(Math.max(240_000, SEED_COUNT * 15));

    await page.goto("/");
    await skipPassword(page);

    const metrics = await seedAndMeasure(page, makeBookmarkDocs(SEED_COUNT));

    expect(metrics.seeded).toBe(SEED_COUNT);
    expect(metrics.count).toBe(SEED_COUNT);
    expect(metrics.insertMs, "bulk insert of the seed").toBeLessThan(
      BUDGET_INSERT_MS,
    );
    expect(metrics.queryMs, "query + projection of the collection").toBeLessThan(
      BUDGET_QUERY_MS,
    );

    // Headline: the worker scan (real knowledge-scan worker round-trip,
    // including pool creation) must be sub-second.
    expect(metrics.workerScanMs, "worker scan wall time").toBeLessThan(
      BUDGET_WORKER_SCAN_MS,
    );
    // No UI blocking: the main-thread ticker must not see a multi-hundred-ms
    // gap while the worker scans.
    expect(metrics.maxFrameGapMs, "max main-thread frame gap during worker scan").toBeLessThan(
      BUDGET_MAX_FRAME_GAP_MS,
    );
    // Worst case if workers are unavailable: the bounded inline fallback
    // stays sub-second too.
    expect(metrics.inlineMs, "inline fallback wall time").toBeLessThan(
      BUDGET_INLINE_MS,
    );

    // The worker actually streamed progress through the status messages:
    // sampling first, done last at fraction 1 (and at least one comparing
    // step in between).
    expect(metrics.phases[0]?.[0]).toBe("sampling");
    expect(metrics.phases.some(([phase]) => phase === "comparing")).toBe(true);
    expect(metrics.progressEndsAtOne).toBe(true);
    // The seeded cross-language tags must produce real bridges on both paths.
    expect(metrics.bridges).toBeGreaterThan(0);
    expect(metrics.inlineBridges).toBe(metrics.bridges);

    const perf = {
      seed: metrics.seeded,
      insertMs: Math.round(metrics.insertMs),
      queryMs: Math.round(metrics.queryMs),
      workerScanMs: Math.round(metrics.workerScanMs),
      maxFrameGapMs: Math.round(metrics.maxFrameGapMs),
      inlineMs: Math.round(metrics.inlineMs),
      bridges: metrics.bridges,
      phases: metrics.phases,
      budgets: {
        insertMs: BUDGET_INSERT_MS,
        queryMs: BUDGET_QUERY_MS,
        workerScanMs: BUDGET_WORKER_SCAN_MS,
        maxFrameGapMs: BUDGET_MAX_FRAME_GAP_MS,
        inlineMs: BUDGET_INLINE_MS,
      },
    };
    await test.info().attach("crosslang-scan-metrics.json", {
      body: JSON.stringify(perf, null, 2),
      contentType: "application/json",
    });
    test.info().annotations.push({
      type: "perf",
      description:
        `seed=${perf.seed} insert=${perf.insertMs}ms query=${perf.queryMs}ms ` +
        `workerScan=${perf.workerScanMs}ms ` +
        `maxFrameGap=${perf.maxFrameGapMs}ms inline=${perf.inlineMs}ms ` +
        `bridges=${perf.bridges}`,
    });
  });
});
