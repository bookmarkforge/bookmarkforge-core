/**
 * tests/e2e/ai-first-boot.nightly.spec.ts
 *
 * F1-D "reduce local-AI friction" — the < 30 s `firstSummaryLatencyMs`
 * budget gate on a REAL reference device (see docs/ROADMAP.md §F1-D and
 * docs/PERFORMANCE-BUDGETS.md "WebLLM: device-side budgets").
 *
 * This is the device-side half of the F1-D validation:
 *
 *   - `tests/e2e/ai-first-boot.spec.ts` (every-CI) proves the first-boot
 *     flow with the WebLLM device boundary stubbed: real warmup → real
 *     Chat → `ProviderManager.streamGenerateText` → real
 *     `WebLLMService.generateText`, asserting the progress card and that
 *     `firstSummaryLatencyMs` is recorded (no drop-off).
 *   - THIS spec (nightly-only, opt-in `testMatch`) runs the SAME flow with
 *     the engine fully REAL: real `WebLLMService.init` (WebGPU + real
 *     quantized model download, digest-pinned), real first generation, and
 *     asserts `firstSummaryLatencyMs < 30 000 ms` — the F1-D success
 *     criterion on the reference device.
 *
 * Hardware gating (honest by design): a software WebGPU fallback
 * (SwiftShader/llvmpipe) is NOT a reference device — CPU-based WebLLM
 * would blow the budget even on capable machines, so GPU-less and
 * software-adapter hosts SKIP with a reason instead of failing
 * spuriously. Only a hardware WebGPU adapter (≥ 8 GB device memory)
 * engages the < 30 s gate. Run it with:
 *
 *     npm run calibrate:first-summary          # default: 3 repeats
 *     BMF_CALIB_RUNS=5 npm run calibrate:first-summary
 *
 * The calibrator aggregates the per-run `first-summary-metrics.json`
 * attachments (mirroring `scripts/summarize-webrtc-e2e.mjs`) into
 * `playwright-report-nightly/first-summary-calibration.json` with
 * p50/p95/max, and fails if any run exceeds the budget.
 *
 * Orthogonal boundaries (RAG embeddings, semantic cache, memory engine)
 * are pinned to no-ops exactly like the every-CI sibling spec so the
 * measured path is purely WebLLM — RAG/embeddings have their own budget
 * spec (`ai-startup.nightly.spec.ts`).
 */
import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { setupVault } from "./vault-helpers";

// F1-D budget: "time-to-first-summary < 30 s from install model to the
// first summary on the reference device" (ROADMAP §F1-D success criterion).
const BUDGET_FIRST_SUMMARY_MS = 30_000;

// Reference-device floor: a laptop-grade host with a hardware WebGPU
// adapter and ≥ 8 GB device memory. Below this the measurement is
// meaningless, not just slow.
const MIN_DEVICE_MEMORY_GB = 8;

test.describe("first boot with local AI active — real device budget (F1-D)", () => {
  test(
    "first summary stays under the 30 s device budget on the reference device",
    async ({ page }) => {
      // Real model download (≤ 10 min budget) + first generation (≤ 45 s)
      // + vault setup; the 12 min ceiling keeps the nightly job bounded.
      test.setTimeout(720_000);

      // ── Device gate ────────────────────────────────────────────────────
      // A hardware WebGPU adapter is the reference-device contract. Software
      // fallbacks (SwiftShader/llvmpipe) and GPU-less hosts SKIP: they could
      // not pass the budget even with a healthy app, and failing them would
      // just noise the nightlies.
      const device = await page.evaluate(async () => {
        const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
        let adapter: GPUAdapter | null = null;
        let info: {
          vendor: string;
          architecture: string;
          description: string;
        } | null = null;
        if (gpu) {
          adapter = await gpu.requestAdapter();
          if (adapter) {
            try {
              const ai = await adapter.requestAdapterInfo();
              info = {
                vendor: ai.vendor ?? "",
                architecture: ai.architecture ?? "",
                description: ai.description ?? "",
              };
            } catch {
              info = null;
            }
          }
        }
        return {
          webgpu: adapter !== null,
          info,
          software:
            !!info &&
            /swiftshader|llvmpipe|software|lavapipe/i.test(
              [info.vendor, info.architecture, info.description].join(" "),
            ),
          deviceMemory:
            (navigator as unknown as { deviceMemory?: number }).deviceMemory ??
            0,
          cores: navigator.hardwareConcurrency ?? 0,
          userAgent: navigator.userAgent,
        };
      });

      const isReferenceDevice =
        device.webgpu &&
        !device.software &&
        device.deviceMemory >= MIN_DEVICE_MEMORY_GB;

      // reason: only a hardware-WebGPU reference device (>= 8 GB device
      // memory) can earn the < 30 s first-summary budget; software
      // fallbacks and GPU-less hosts would fail for allocation reasons,
      // not app health.
      test.skip(
        !isReferenceDevice,
        `reference device required (hardware WebGPU + >= ${MIN_DEVICE_MEMORY_GB} GB): ` +
          `webgpu=${device.webgpu} software=${device.software} ` +
          `deviceMemory=${device.deviceMemory} cores=${device.cores} — ` +
          `run 'npm run calibrate:first-summary' on the reference machine`,
      );

      // ── First boot with the REAL warmup path ───────────────────────────
      await page.addInitScript(() => {
        try {
          // Same deterministic provider routing as the every-CI spec.
          localStorage.setItem("selected_ai_provider", "webllm");
          localStorage.setItem("forge_welcome_tour_complete", "true");
        } catch {
          /* ignore: non-fatal localStorage denial */
        }
      });

      // Capture app-side errors for root-cause diagnostics on failure.
      const appEvents: string[] = [];
      const onConsole = (msg: ConsoleMessage): void => {
        if (msg.type() === "error" || msg.type() === "warning") {
          appEvents.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`);
        }
      };
      const onPageError = (err: Error): void => {
        appEvents.push(`[pageerror] ${err.message.slice(0, 300)}`);
      };
      page.on("console", onConsole);
      page.on("pageerror", onPageError);

      await setupVault(page);

      // Pin the orthogonal boundaries to no-ops (same as the day-neighbor
      // spec): RAG/embeddings have their own nightly budget (ai-startup),
      // and the memory engine is not exercised in e2e.
      await page.evaluate(async () => {
        const { globalRAGService } = await import(
          "/src/services/ai/GlobalRAGService"
        );
        globalRAGService.searchContext = async () => [];

        const { semanticCache } = await import(
          "/src/services/ai/SemanticCacheService.ts"
        );
        semanticCache.findSimilar = async () => null;

        const { memoryEngine } = await import("/src/memory/MemoryEngine.ts");
        const mem = memoryEngine as unknown as {
          isInitialized: () => boolean;
          initialize: () => Promise<void>;
          getOrCreateSession: () => Promise<string>;
          getContextForQuery: () => Promise<string>;
          addMessage: () => Promise<string>;
        };
        mem.isInitialized = () => true;
        mem.initialize = async () => {};
        mem.getOrCreateSession = async () => "e2e-memory-session";
        mem.getContextForQuery = async () => "";
        mem.addMessage = async () => "e2e-memory-message";
      });

      // After unlock the app's securityVault.onUnlock listener runs the
      // REAL warmup: real WebGPU init, real
      // digest-pinned model download (≤ 10 min per budget) and engine
      // load. The LIVE system, no stubs.
      await page.waitForTimeout(500);

      // The progressive download indicator is the "no drop-off" UI proof:
      // it may be short-lived when the model is already in the browser
      // cache (repeat calibration runs), so record it — do not gate on it.
      let downloadCardObserved = false;
      try {
        await page
          .getByText(/Downloading quantized weights/i)
          .first()
          .waitFor({ state: "visible", timeout: 30_000 });
        downloadCardObserved = true;
      } catch {
        downloadCardObserved = false;
      }

      // Wait for the model to finish installing (real engine set).
      await expect
        .poll(
          () =>
            page.evaluate(async () => {
              const { webLLMService } = await import(
                "/src/services/ai/WebLLMService"
              );
              const status = await webLLMService.getHealthStatus();
              return {
                ready: status.engineReady,
                isInitializing: status.isInitializing,
                lastError: status.lastError,
                modelLoaded: status.modelLoaded,
              };
            }),
          { timeout: 600_000, intervals: [1_000, 5_000] },
        )
        .toEqual(
          expect.objectContaining({ ready: true, isInitializing: false }),
        );

      // ── First summary through the REAL WebLLM engine ──────────────────
      await openCopilotTab(page);
      await page
        .getByPlaceholder(/Ask about your bookmarks/i)
        .fill("Summarize my knowledge base");
      await page.getByLabel("Send").click();

      // Poll until the REAL first generation completes. `firstSummaryLatencyMs`
      // (install → first successful generation) is the measured signal.
      let firstSummaryLatencyMs: number | null = null;
      await expect
        .poll(
          async () => {
            const metrics = await page.evaluate(async () => {
              const { webLLMService } = await import(
                "/src/services/ai/WebLLMService"
              );
              const metricsOut = webLLMService.getMetrics();
              const status = await webLLMService.getHealthStatus();
              return {
                latency: metricsOut.firstSummaryLatencyMs,
                error: status.lastError,
              };
            });
            if (metrics.latency !== null) {
              firstSummaryLatencyMs = metrics.latency;
              return "done";
            }
            if (metrics.error) {
              throw new Error(
                `WebLLM reported: ${metrics.error}. App events:\n${appEvents.slice(-20).join("\n")}`,
              );
            }
            return "pending";
          },
          { timeout: 120_000, intervals: [500, 2_000] },
        )
        .toBe("done");

      // THE F1-D assertion on the reference device.
      expect(firstSummaryLatencyMs).not.toBeNull();
      expect(
        firstSummaryLatencyMs,
        `firstSummaryLatencyMs must stay under ${BUDGET_FIRST_SUMMARY_MS} ms on the reference device`,
      ).toBeLessThan(BUDGET_FIRST_SUMMARY_MS);

      // ── Metrics attachment (consumed by the calibration runner) ────────
      const metrics = {
        budgetMs: BUDGET_FIRST_SUMMARY_MS,
        firstSummaryLatencyMs,
        downloadCardObserved,
        device: {
          webgpu: device.webgpu,
          adapter: device.info ?? null,
          deviceMemoryGB: device.deviceMemory,
          hardwareConcurrency: device.cores,
          userAgent: device.userAgent,
        },
        appErrors: appEvents.slice(-5),
      };
      await test.info().attach("first-summary-metrics.json", {
        body: JSON.stringify(metrics, null, 2),
        contentType: "application/json",
      });
      test.info().annotations.push({
        type: "perf",
        description:
          `firstSummary=${firstSummaryLatencyMs}ms ` +
          `(budget ${BUDGET_FIRST_SUMMARY_MS}ms) card=${downloadCardObserved} ` +
          `webgpu=${device.info?.vendor ?? "?"}/` +
          `${device.info?.architecture ?? "?"} ` +
          `cores=${device.cores} mem=${device.deviceMemory}GB`,
      });
    },
  );
});

/** Switch to the Local RAG Chat tab through the bottom navigation. */
async function openCopilotTab(page: Page): Promise<void> {
  const tab = page.getByRole("button", {
    name: "Local RAG Chat",
    exact: true,
  });
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByLabel("Send")).toBeVisible({ timeout: 30_000 });
}