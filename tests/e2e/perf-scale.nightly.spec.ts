/**
 * tests/e2e/perf-scale.nightly.spec.ts
 *
 * Scale/perf regression gate — **nightly** scope (audit H6).
 *
 * Seeds a large synthetic bookmark dataset DIRECTLY into IndexedDB through
 * the app's own RxDB layer (`initDB()` + `bookmarks.bulkInsert`, same access
 * path as text-fit-helpers), then measures the operations a 100k-bookmark
 * user hits every day:
 *
 *   1. bulk insert of the dataset;
 *   2. `count()` over the collection;
 *   3. paginated list load (sort by updatedAt, limit 50);
 *   4. tag-filter query;
 *   5. rendering the bookmarks table (first row visible).
 *
 * Budgets are generous sanity floors (regression guards, not
 * microbenchmarks): a heavy regression — e.g. a query that lost its index,
 * or a render that now blocks the main thread — trips them loudly, while
 * legitimate growth never does. Adjust datasets with `PERF_SEED`.
 *
 * Only runs under the nightly config (`npm run e2e:nightly`); the main
 * `playwright.config.ts` ignores `*.nightly.spec.ts` so every-CI runtime
 * stays bounded. Needs the app unlocked first (`skipPassword`), mirroring
 * the other e2e specs.
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import type { BookmarkDocType } from "../../src/db/schema";

const MAX_SEED_COUNT = 250_000;

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

/**
 * Budgets (ms) — sanity floors with ~3-5x headroom over observed times.
 *
 * The insert (and the first render) scale linearly with SEED_COUNT, so a
 * fixed budget tuned for the 10k default would trip the nightly 100k run
 * (measured on dev hardware: ~3.2 ms/doc bulkInsert → 100k ≈ 5 min, while
 * 60s/120s fixed budgets would fail at the insert). Seed-scaled floors keep
 * the same ~2-3x headroom at every size; the query budgets (count/list/
 * tagFilter) are index-bound and size-independent.
 */
const BUDGET_INSERT_MS = Math.max(60_000, SEED_COUNT * 6);
const BUDGET_COUNT_MS = 2_000;
const BUDGET_LIST_MS = 2_000;
// $elemMatch on tags is an unindexed array scan — O(n), so it scales with
// the dataset (1.5s @10k → 3.2s @20k measured; 100k ≈ 16s).
const BUDGET_TAG_FILTER_MS = Math.max(5_000, SEED_COUNT * 0.25);
const BUDGET_FIRST_ROW_MS = Math.max(10_000, SEED_COUNT * 0.4);
// Client-side (main-thread) filter/sort budgets. BUDGET_SEARCH_MS includes
// the 400ms input debounce; the actual scan is over the FULL collection.
// The sort is O(n·log n) so it scales too.
const BUDGET_SEARCH_MS = 5_000;
const BUDGET_SORT_MS = Math.max(3_000, SEED_COUNT * 0.04);
// Warm-cache search must be far cheaper than the cold one (the cache build
// is the one-time lowered-text scan). Budget is generous because it still
// includes the 400ms debounce.
const BUDGET_SEARCH_WARM_MS = 3_000;

interface SeedResult {
  seeded: number;
  insertMs: number;
  count: number;
  countMs: number;
  listMs: number;
  tagFilterMs: number;
  tagFilterHits: number;
}

function makeBookmarkDocs(count: number): BookmarkDocType[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i): BookmarkDocType => ({
    id: `perf-${i}-${now}`,
    url: `https://example.com/${i}/very/deep/path/with/segments`,
    urlHash: "",
    title: `Perf scale bookmark ${i} — ${i % 7 === 0 ? "special keyword" : "ordinary"}`,
    // Realistic body so the first search's cache build scans actual content
    // (the expensive part of the lowered-text cache), not just title/url/tags.
    summary: `Summary of perf scale bookmark ${i}.`,
    content: `Seeded content body for perf bookmark ${i}. `.repeat(4),
    tags: i % 3 === 0 ? ["scale-test", "a"] : ["scale-test", "b"],
    relatedLinks: [],
    processed: true,
    isPrivate: false,
    isDeleted: false,
    visitCount: i % 100,
    createdAt: new Date(now - i * 60_000).toISOString(),
    updatedAt: new Date(now - i * 60_000).toISOString(),
  }));
}

async function seedAndMeasure(
  page: Page,
  docs: BookmarkDocType[],
): Promise<SeedResult> {
  return page.evaluate(async (payload) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    await db.bookmarks.find().remove();

    const t0 = performance.now();
    await db.bookmarks.bulkInsert(payload.docs);
    const insertMs = performance.now() - t0;

    const t1 = performance.now();
    const count = await db.bookmarks.count().exec();
    const countMs = performance.now() - t1;

    const t2 = performance.now();
    await db.bookmarks
      .find()
      .sort({ updatedAt: "desc" })
      .limit(50)
      .exec();
    const listMs = performance.now() - t2;

    const t3 = performance.now();
    // Mango $elemMatch — any array element equal to "a". NOTE: RxDB has no
    // multiEntry (array-element) index support, so this is an UNINDEXED full
    // scan — O(n) by platform design, not a regression. The app's interactive
    // tag filter (TagFilterBar) is client-side over the loaded array and is
    // covered by the search measurements below; the only production
    // $elemMatch query is FileSystemService.syncFiles on the (small)
    // documents collection. The budget is seed-scaled to match.
    const tagHits = await db.bookmarks
      .find({ selector: { tags: { $elemMatch: { $eq: "a" } } } })
      .exec();
    const tagFilterMs = performance.now() - t3;

    return {
      seeded: payload.docs.length,
      insertMs,
      count,
      countMs,
      listMs,
      tagFilterMs,
      tagFilterHits: tagHits.length,
    };
  }, { docs });
}

test.describe(`scale: ${SEED_COUNT.toLocaleString()} bookmarks`, () => {
  test("query + render stay within budget", async ({ page }) => {
    // Total run scales with SEED_COUNT (the insert dominates): 10k ≈ 40s on
    // the dev hardware these factors were calibrated on, ~2-3x that on a CI
    // runner. The nightly died with the 120s floor killing the seeding
    // evaluate BEFORE any budget could be evaluated (run 35833219915: timeout
    // inside page.evaluate, both the attempt and its retry) — the seed phase
    // alone is budgeted at 60s (BUDGET_INSERT_MS) and costs ~130s at CI
    // speed. The floor must cover the phase, not the budgets: BUDGET_INSERT_MS
    // and friends remain the actual pass/fail gates against regressions.
    // 10k → 240s floor; 100k → 25min, inside the job's 45min budget.
    test.setTimeout(Math.max(240_000, SEED_COUNT * 15));

    await page.goto("/");
    await skipPassword(page);

    const result = await seedAndMeasure(
      page,
      makeBookmarkDocs(SEED_COUNT),
    );

    expect(result.seeded).toBe(SEED_COUNT);
    expect(result.count).toBe(SEED_COUNT);

    expect(result.insertMs, `bulk insert ${SEED_COUNT} docs`).toBeLessThan(
      BUDGET_INSERT_MS,
    );
    expect(result.countMs, "count()").toBeLessThan(BUDGET_COUNT_MS);
    expect(result.listMs, "sorted limit(50) list load").toBeLessThan(
      BUDGET_LIST_MS,
    );
    expect(
      result.tagFilterMs,
      "tag elemMatch filter",
    ).toBeLessThan(BUDGET_TAG_FILTER_MS);
    expect(result.tagFilterHits).toBeGreaterThan(0);

    // Render gate: the bookmarks table must paint quickly even with the full
    // dataset in the collection. Navigate INSIDE the already-unlocked SPA — a
    // hard navigation would reload the app and re-lock the vault (same
    // convention as text-fit.spec.ts).
    const tRender = Date.now();
    await page.locator('[data-tab-id="bookmarks"]').click();
    await page
      .getByTestId("bookmarks-virtual-list")
      .waitFor({ timeout: BUDGET_FIRST_ROW_MS });
    const firstRowMs = Date.now() - tRender;
    expect(firstRowMs, "bookmarks table rendered").toBeLessThan(
      BUDGET_FIRST_ROW_MS,
    );

    // ── Client-side hot path (main-thread filter + sort over the FULL array) ──
    // Search 1 (COLD cache): query only matches the LAST seeded bookmark, so
    // the filter must scan the entire collection before the row can paint —
    // AND this is the first search, so it also builds the lowered-text cache
    // (the one-time toLowerCase() scan over every title/url/summary/content).
    // Includes the 400ms input debounce.
    const tSearchCold = Date.now();
    await page.fill(
      '[data-testid="search-input"]',
      `bookmark ${SEED_COUNT - 1}`,
    );
    await page
      .locator('[data-testid="bookmarks-virtual-list"] [role="listitem"]')
      .filter({ hasText: `bookmark ${SEED_COUNT - 1}` })
      .first()
      .waitFor({ state: "visible", timeout: BUDGET_SEARCH_MS });
    const searchColdMs = Date.now() - tSearchCold;
    expect(
      searchColdMs,
      "client-side search over the full collection (cache cold)",
    ).toBeLessThan(BUDGET_SEARCH_MS);

    // Search 2 (WARM cache): replace the query in place WITHOUT clearing, so
    // the debounced query never passes through empty and the cache is reused.
    // The delta searchCold − searchWarm isolates the one-time cache-build
    // cost of the first keystroke on the main thread.
    const tSearchWarm = Date.now();
    await page.fill(
      '[data-testid="search-input"]',
      `bookmark ${SEED_COUNT - 2}`,
    );
    await page
      .locator('[data-testid="bookmarks-virtual-list"] [role="listitem"]')
      .filter({ hasText: `bookmark ${SEED_COUNT - 2}` })
      .first()
      .waitFor({ state: "visible", timeout: BUDGET_SEARCH_WARM_MS });
    const searchWarmMs = Date.now() - tSearchWarm;
    expect(
      searchWarmMs,
      "client-side search over the full collection (cache warm)",
    ).toBeLessThan(BUDGET_SEARCH_WARM_MS);

    // Restore the full list (debounced clear) before measuring the sort.
    await page.fill('[data-testid="search-input"]', "");
    await page
      .locator('[data-testid="bookmarks-virtual-list"] [role="listitem"]')
      .filter({ hasText: "bookmark 0" })
      .first()
      .waitFor({ state: "visible", timeout: BUDGET_SEARCH_MS });

    // Sort: default is createdAt desc (newest first → "bookmark 0"). One click
    // on the createdAt header toggles to asc, so the OLDEST seeded bookmark
    // (index SEED_COUNT - 1) must become the first row. The sort copies and
    // re-sorts the whole array on the main thread.
    const tSort = Date.now();
    await page.getByTestId("sort-by-createdAt").click();
    await page
      .locator('[data-testid="bookmarks-virtual-list"] [role="listitem"]')
      .filter({ hasText: `bookmark ${SEED_COUNT - 1}` })
      .first()
      .waitFor({ state: "visible", timeout: BUDGET_SORT_MS });
    const sortMs = Date.now() - tSort;
    expect(sortMs, "client-side sort over the full collection").toBeLessThan(
      BUDGET_SORT_MS,
    );

    const metrics = {
      seed: result.seeded,
      insertMs: Math.round(result.insertMs),
      countMs: Math.round(result.countMs),
      listMs: Math.round(result.listMs),
      tagFilterMs: Math.round(result.tagFilterMs),
      tagFilterHits: result.tagFilterHits,
      firstRowMs: Math.round(firstRowMs),
      searchColdMs: Math.round(searchColdMs),
      searchWarmMs: Math.round(searchWarmMs),
      cacheBuildMs: Math.max(0, Math.round(searchColdMs - searchWarmMs)),
      sortMs: Math.round(sortMs),
      budgets: {
        insertMs: BUDGET_INSERT_MS,
        countMs: BUDGET_COUNT_MS,
        listMs: BUDGET_LIST_MS,
        tagFilterMs: BUDGET_TAG_FILTER_MS,
        firstRowMs: BUDGET_FIRST_ROW_MS,
        searchColdMs: BUDGET_SEARCH_MS,
        searchWarmMs: BUDGET_SEARCH_WARM_MS,
        sortMs: BUDGET_SORT_MS,
      },
    };
    await test.info().attach("perf-scale-metrics.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    test.info().annotations.push({
      type: "perf",
      description:
        `seed=${metrics.seed} insert=${metrics.insertMs}ms ` +
        `count=${metrics.countMs}ms list=${metrics.listMs}ms ` +
        `tagFilter=${metrics.tagFilterMs}ms ` +
        `firstRow=${metrics.firstRowMs}ms ` +
        `searchCold=${metrics.searchColdMs}ms ` +
        `searchWarm=${metrics.searchWarmMs}ms ` +
        `cacheBuild=${metrics.cacheBuildMs}ms ` +
        `sort=${metrics.sortMs}ms`,
    });
  });
});
