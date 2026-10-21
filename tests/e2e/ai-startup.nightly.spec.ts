/**
 * tests/e2e/ai-startup.nightly.spec.ts
 *
 * AI startup perf gate — **nightly** scope (audit §4.3 item 5). Implements
 * the CI-runnable half of the audit's proposed budgets table: the local
 * embeddings flow. WebLLM stays device-only (needs real WebGPU).
 *
 * Measures against the embeddings budgets in
 * `docs/PERFORMANCE-BUDGETS.md` (sanity floors with headroom — regression
 * guards, not
 * microbenchmarks; the real benchmark calibrates them):
 *
 *   1. Heap delta unlock → idle 5 s (no AI)              ≤ 15 MB
 *   2. WebGPU probe (`requestAdapter`)                   ≤ 1 000 ms
 *   3. COLD embedding init — model download (~23 MB,
 *      digest-pinned via `modelIntegrity`) + worker init
 *      + first inference                                 ≤ 90 s
 *   4. WARM first inference (initialized worker)         ≤ 5 s
 *   5. Batch of 100 distinct texts (2-worker queue)      ≤ 30 s
 *   6. WARM-CACHE re-init — second page load, same
 *      context, model served from the browser Cache API  ≤ 15 s
 *
 * `RAGEngine` creates its 2-worker pool on first real demand and the worker
 * lazily downloads + initializes Transformers.js, so the cold call below is
 * the real first-use path. The warm-cache second pass navigates the SAME
 * context again (skipPassword handles the re-lock) so the model files come
 * from the pinned verifying cache instead of the network.
 *
 * Only runs under the nightly config (`npm run e2e:nightly`); the main
 * `playwright.config.ts` ignores `*.nightly.spec.ts`. Needs the network for
 * the first download; a digest mismatch fails closed by design (validated
 * by the `check:model-digests` job).
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";

// Budgets (ms / MB) — from the audit's proposed table, with headroom.
const BUDGET_HEAP_DELTA_MB = 15;
const BUDGET_WEBGPU_PROBE_MS = 1_000;
// ≤ 90 s per the table; the worker's own MODEL_INIT_TIMEOUT_MS (120 s)
// stays the hard runtime ceiling.
const BUDGET_COLD_INIT_MS = 90_000;
const BUDGET_WARM_FIRST_MS = 5_000;
const BUDGET_BATCH_100_MS = 30_000;
const BUDGET_WARM_CACHE_REINIT_MS = 15_000;
// all-MiniLM-L6-v2 outputs 384-dim vectors.
const EXPECTED_DIM = 384;
const BATCH_SIZE = 100;

interface EmbeddingsResult {
  coldInitMs: number;
  coldFirstDim: number;
  warmFirstMs: number;
  warmFirstDim: number;
  batch100Ms: number;
  batchAvgMs: number;
  batchDimOk: boolean;
  cacheSize: number;
  workerStats: {
    workers: number;
    busy: number;
    queue: number;
  } | null;
}

interface AiStartupResult {
  heapDeltaMb: number | null;
  webgpuProbeMs: number;
  webgpuAdapter: boolean;
  pass1: EmbeddingsResult;
  pass2: {
    warmCacheReinitMs: number;
    dim: number;
  } | null;
}

/** Chromium-only `performance.memory` (MB, rounded to 1 decimal), or null. */
async function heapMb(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const mem = (
      performance as unknown as {
        memory?: { usedJSHeapSize: number };
      }
    ).memory;
    return mem ? Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10 : null;
  });
}

/** Time `navigator.gpu.requestAdapter()`; headless resolves/throws fast. */
async function probeWebGPU(page: Page): Promise<{
  ms: number;
  adapter: boolean;
}> {
  return page.evaluate(async () => {
    const t0 = performance.now();
    let adapter = false;
    try {
      const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
      adapter = gpu ? (await gpu.requestAdapter()) !== null : false;
    } catch {
      adapter = false;
    }
    return { ms: performance.now() - t0, adapter };
  });
}

async function measureEmbeddings(page: Page): Promise<EmbeddingsResult> {
  return page.evaluate(async ({ batchSize }) => {
    // Same access path as production: RAGEngine is a singleton that creates
    // its worker pool on first demand, so the cold call below measures the
    // real first-use path (worker creation + model download + init).
    const { ragEngine } = await import("/src/services/ai/RAGEngine.ts");

    // Distinct texts per measurement so the in-memory embedding cache never
    // short-circuits the worker path.
    const coldText = "ai-startup-nightly cold first embedding probe";
    const warmText = "ai-startup-nightly warm second embedding probe";

    const t0 = performance.now();
    const cold = await ragEngine.generateEmbedding(coldText);
    const coldInitMs = performance.now() - t0;

    const t1 = performance.now();
    const warm = await ragEngine.generateEmbedding(warmText);
    const warmFirstMs = performance.now() - t1;

    // Batch through the 2-worker queue. All texts distinct → no cache hits;
    // concurrent submission exercises the queue/backpressure path.
    const texts = Array.from(
      { length: batchSize },
      (_, i) => `ai-startup-nightly batch probe ${i}`,
    );
    const t2 = performance.now();
    const batch = await Promise.all(
      texts.map((text) => ragEngine.generateEmbedding(text)),
    );
    const batch100Ms = performance.now() - t2;

    const stats = ragEngine.getStats();

    return {
      coldInitMs,
      coldFirstDim: cold.length,
      warmFirstMs,
      warmFirstDim: warm.length,
      batch100Ms,
      batchAvgMs: batch100Ms / batchSize,
      batchDimOk: batch.every((vector) => vector.length === 384),
      cacheSize: stats.cacheSize,
      workerStats: stats.workerStats,
    };
  }, { batchSize: BATCH_SIZE });
}

test.describe("ai startup: local embeddings", () => {
  test("cold init, warm inference, batch and warm-cache re-init stay within budget", async ({
    page,
  }) => {
    // Pass 1 (download + init) + 5 s idle + pass 2 (cache re-init) dominate.
    // 6 min keeps the job well under the nightly timeout-minutes (150).
    test.setTimeout(360_000);

    // ── Pass 1: heap delta, WebGPU probe, cold/warm/batch embeddings ──
    await page.goto("/");
    await skipPassword(page);

    const heapBefore = await heapMb(page);
    await page.waitForTimeout(5_000);
    const heapAfter = await heapMb(page);
    const heapDeltaMb =
      heapBefore !== null && heapAfter !== null
        ? Math.round((heapAfter - heapBefore) * 10) / 10
        : null;
    if (heapDeltaMb !== null) {
      expect(
        heapDeltaMb,
        "heap delta unlock → idle 5 s (no AI)",
      ).toBeLessThan(BUDGET_HEAP_DELTA_MB);
    }

    const { ms: webgpuProbeMs, adapter: webgpuAdapter } = await probeWebGPU(
      page,
    );
    expect(webgpuProbeMs, "WebGPU requestAdapter probe").toBeLessThan(
      BUDGET_WEBGPU_PROBE_MS,
    );

    const pass1 = await measureEmbeddings(page);
    expect(pass1.coldFirstDim, "cold embedding dimension").toBe(EXPECTED_DIM);
    expect(pass1.warmFirstDim, "warm embedding dimension").toBe(EXPECTED_DIM);
    expect(
      pass1.batchDimOk,
      `all ${BATCH_SIZE} batch embeddings have 384 dims`,
    ).toBe(true);

    expect(
      pass1.coldInitMs,
      "cold embedding init (download + worker init + first inference)",
    ).toBeLessThan(BUDGET_COLD_INIT_MS);
    expect(
      pass1.warmFirstMs,
      "warm first inference (initialized worker)",
    ).toBeLessThan(BUDGET_WARM_FIRST_MS);
    expect(
      pass1.batch100Ms,
      `batch of ${BATCH_SIZE} embeddings through the 2-worker queue`,
    ).toBeLessThan(BUDGET_BATCH_100_MS);

    // ── Pass 2: warm-cache re-init in the SAME context ──
    // Fresh page → fresh module graph → fresh worker, but the model files
    // now come from the pinned verifying Cache API instead of the network.
    let pass2: AiStartupResult["pass2"] = null;
    {
      const tReinit = Date.now();
      await page.goto("/");
      await skipPassword(page);
      const reinit = await page.evaluate(async () => {
        const { ragEngine } = await import("/src/services/ai/RAGEngine.ts");
        const vector = await ragEngine.generateEmbedding(
          "ai-startup-nightly warm-cache re-init probe",
        );
        return { dim: vector.length };
      });
      const warmCacheReinitMs = Date.now() - tReinit;
      expect(
        warmCacheReinitMs,
        "warm-cache re-init (second page load, model from Cache API)",
      ).toBeLessThan(BUDGET_WARM_CACHE_REINIT_MS);
      expect(reinit.dim, "warm-cache re-init dimension").toBe(EXPECTED_DIM);
      pass2 = { warmCacheReinitMs, dim: reinit.dim };
    }

    const metrics: AiStartupResult = {
      heapDeltaMb,
      webgpuProbeMs: Math.round(webgpuProbeMs),
      webgpuAdapter,
      pass1: {
        coldInitMs: Math.round(pass1.coldInitMs),
        coldFirstDim: pass1.coldFirstDim,
        warmFirstMs: Math.round(pass1.warmFirstMs),
        warmFirstDim: pass1.warmFirstDim,
        batch100Ms: Math.round(pass1.batch100Ms),
        batchAvgMs: Math.round(pass1.batchAvgMs * 10) / 10,
        batchDimOk: pass1.batchDimOk,
        cacheSize: pass1.cacheSize,
        workerStats: pass1.workerStats,
      },
      pass2: pass2
        ? { warmCacheReinitMs: Math.round(pass2.warmCacheReinitMs), dim: pass2.dim }
        : null,
    };
    await test.info().attach("ai-startup-metrics.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    test.info().annotations.push({
      type: "perf",
      description:
        `heapDelta=${metrics.heapDeltaMb ?? "n/a"}MB ` +
        `webgpu=${metrics.webgpuProbeMs}ms(${metrics.webgpuAdapter}) ` +
        `cold=${metrics.pass1.coldInitMs}ms warm=${metrics.pass1.warmFirstMs}ms ` +
        `batch100=${metrics.pass1.batch100Ms}ms ` +
        `(avg ${metrics.pass1.batchAvgMs}ms/embed) ` +
        `cacheReinit=${metrics.pass2?.warmCacheReinitMs ?? "n/a"}ms ` +
        `cache=${metrics.pass1.cacheSize} ` +
        `workers=${JSON.stringify(metrics.pass1.workerStats)}`,
    });
  });
});
