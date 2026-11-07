/**
 * tests/e2e/webllm-no-gpu-guard.spec.ts
 *
 * Device-capability guard for devices that cannot run local AI. Four device
 * profiles share one test body, each blocked by a DIFFERENT hard gate of the
 * WebGPU capability check (`webLLMService.canRunLocalLLM()` = WebGPU +
 * shader-f16 + >= 4 GB RAM):
 *
 *   Profile A — no WebGPU surface:      navigator.gpu is undefined.
 *   Profile B — GPU without shader-f16: navigator.gpu exists and returns an
 *                                       adapter, but its feature set lacks
 *                                       'shader-f16' (the half-precision
 *                                       support MLC's q4f16 models require).
 *   Profile C — GPU + f16 but 3 GB RAM: navigator.gpu returns a fully
 *                                       capable adapter, but deviceMemory is
 *                                       below the 4 GB floor (while RAM/CPU
 *                                       tier and cores stay high).
 *   Profile D — adapter request FAILS:  navigator.gpu exists but
 *                                       requestAdapter() REJECTS (driver
 *                                       crash / device lost) — the
 *                                       detection ERROR path: WebGPU can
 *                                       only be reported as unsupported,
 *                                       never as available.
 *
 * The behavioral OUTCOME must be identical in all three profiles (the same
 * test body runs for each):
 *
 *   1. UI: the WebLLM provider option stays disabled in Settings, with the
 *      "not available on this device" hint (the app never offers a capability
 *      the device lacks).
 *   2. Privacy: a private document's AI request FAILS CLOSED with "no Local
 *      AI is available" — private data must never fall through to a cloud
 *      provider when no local AI exists (no WebLLM + no Ollama).
 *   3. Engine: WebLLM engine initialization is NEVER attempted — init() is
 *      not even invoked, no model bytes are fetched from HuggingFace, no MLC
 *      runtime is fetched from the CDN, and no engine object is created.
 *   4. Diagnostics/support views mirror the unit-level health status: the
 *      diagnostics modal's "WebGPU Support" card shows YES exactly when
 *      webGPUSupported is true, and the support diagnostics panel reports
 *      "WebLLM cannot run" (canRunLocalLLM=false) on every blocked profile.
 *      The forced-provider scenarios re-assert the same card AFTER the
 *      capability error has surfaced at generation time: the verdict must be
 *      stable and surface-accurate — YES on the f16-less device even though
 *      generation failed, NO on the GPU-less one.
 *   5. Stability: the page records ZERO uncaught errors. Every requestAdapter
 *      caller in the app (WebLLMService, DiagnosticService,
 *      SupportDiagnostics, HardwareDetectorService) must catch the rejection
 *      and fail closed, so a GPU detection failure degrades to "WebLLM
 *      unavailable" instead of crashing boot, Settings or the diagnostics
 *      views.
 *
 * The intended differences between profiles are the capability probes
 * themselves: webGPUSupported (false on A/D, true on B/C/E), f16Supported
 * (false on A/B/D, true on C/E) and highEndDevice (true on A/B/D with 8 GB,
 * false on C/E — isHighEndDevice() is a RAM/CPU-only tier check that knows
 * nothing about GPU availability). canRunLocalLLM() is false on A–D, pinning
 * that the f16 gate and the RAM floor are as hard a blocker as a missing
 * WebGPU surface — and profile E (capable GPU, exactly 4 GB) is the boundary
 * control where it flips to TRUE: the Settings WebLLM option becomes enabled
 * (no "Unsupported Device" suffix, no hint), the support view reports
 * "WebLLM is ready", yet the engine stays null — capability ≠ engine state.
 * E also pins the dual-gate subtlety: the private-doc route still fails
 * closed there because resolveProvider requires the 8 GB TIER
 * (isHighEndDevice) on top of the 4 GB capability floor.
 *
 * The FORCED-provider scenarios set localStorage selected_ai_provider=webllm
 * (the same key the app persists on provider change) on THREE blocked profiles —
 * the GPU-less device, the f16-less device AND the low-RAM device (capable GPU,
 * only 3 GB). The user's explicit selection is authoritative in resolveProvider
 * — it is NOT filtered by capability — so BOTH generateText and
 * streamGenerateText route to WebLLM and must fail CLOSED with THAT profile's
 * own capability error ("WebGPU is not supported in this browser" without a
 * GPU surface, the shader-f16 message when only f16 is missing, the
 * "Insufficient device memory … 4 GB required" message when only RAM is
 * short) instead of the misleading developer-facing "WebLLM engine not
 * initialized" state error, and must not attempt the engine (no init, no
 * model download, no cloud leak). The onProvider callback must stay silent —
 * the UI must never announce a provider whose request then fails closed.
 * Explicit warmup() calls on the same blocked device must also skip init()
 * every time — the capability guard is the single choke point for both
 * generation and the opportunistic preload.
 *
 * The 4 GB BOUNDARY CONTROL is the positive counterpart: the Profile C device
 * (capable GPU, only 3 GB) re-emulated at exactly 4 GB deviceMemory — the RAM
 * floor itself. canRunLocalLLM flips to true, the support view's "Local AI
 * (WebLLM)" line turns to "WebLLM is ready on this device." (with "Model not
 * loaded yet." since no engine exists), and boot + probing + test-mode warmup
 * still never attempt an engine init or model download — readiness is a
 * capability verdict, not an engine state.
 *
 * The CHAT-UI scenario closes the user-facing loop on the GPU-less profile:
 * with webllm selected, sending a message through the REAL Chat tab (Chat →
 * AgentService.globalChat → aiManager.streamGenerateText) must surface the
 * failure IN THE CONVERSATION (error bubble + retry affordance) — never as a
 * toast — while the engine stays untouched and nothing reaches the network.
 *
 * The FOURTH scenario exercises the REAL editor-focus wiring on the GPU-less
 * device: a document is created through the actual UI, focusing the editor
 * fires the production handleEditorFocus → aiManager.warmup() chain
 * (instrumented: exactly one warmup call — proving the chain fired), and the
 * canRunLocalLLM() guard skips the WebLLM init. The opportunistic preload
 * can never start an engine attempt, a download, or a crash on a device
 * that cannot run local AI.
 *
 * The FIFTH scenario is the capable-device counterpart on the SAME real
 * wiring: a stubbed-capable device (GPU + shader-f16 + 8 GB) gets the
 * WebLLM init boundary stubbed to a deterministic fake engine (the same
 * ai-first-boot contract: progress events, real metrics bump), then the
 * editor-focus warmup PRELOADS the model exactly once. Repeated editor
 * focuses (and their extra focusin events) must add ZERO further inits:
 * the one-shot focus handler fires one warmup, and warmup's model-scoped
 * init idempotency means the opportunistic preload is a once-per-session
 * cost — not once per focus. No download may reach the network and no crash
 * may escape the preload path. The scenario then closes the RENDER-level
 * wiring gap end to end: the editor is a route, so navigating away UNMOUNTS
 * it (destroying the spent one-shot flag) and a new document REMOUNTS it —
 * the second instance must RE-ARM the focus handler (warmup fires again —
 * the render-level onFocus wiring is alive on every mount), while the
 * resource-level invariant still holds across both instances: the model
 * INSTALL executes exactly once, warmup #2's init being the model-scoped
 * idempotent no-op.
 *
 * Determinism follows the ai-guard convention: Math.random pinned
 * (RoutingOptimizer never explores), connection=4g + full battery (the
 * "low battery / slow network -> gemini" branch never fires), and all model /
 * cloud endpoints are aborted-and-counted so a regression surfaces as a
 * failed counter instead of a hanging download.
 *
 * The S9-INTERPLAY scenario is the capable-device counterpart to every
 * blocked profile: webllm forced on a CAPABLE device (capable GPU, 8 GB)
 * with a real configured vault, across the lock/unlock boundary. While the
 * vault is LOCKED, local WebLLM generation must keep working (S9 protects
 * cloud-usable secrets, not local inference) and cloud streaming must be
 * refused with the "Vault is locked" guard error — while NOTHING reaches a
 * cloud endpoint and the decrypted key stays wiped from memory. The
 * selection-authority contract also makes cloud resolution impossible while
 * webllm is selected, so the refusal is verified both directly (a stubbed
 * cloud resolution driving the S9 throw) and structurally (the real
 * resolver cannot produce a cloud provider here).
 */
import { test, expect, type Page } from "@playwright/test";
import { seedProEntitlement } from "./pro-entitlement-helpers";
import {
  skipPassword,
  setupVault,
  lockVault,
  unlockVault,
} from "./vault-helpers";

const PRIVATE_DOC_TEXT =
  "Confidential notes that must never leave this device: the quarterly " +
  "financial planning strategy with unannounced headcount numbers.";

/**
 * Registers network observers BEFORE app boot so nothing can slip through.
 * Requests are aborted so a regression never hangs the run on a real multi-GB
 * model download; the counters make it fail loudly instead.
 */
async function installNetworkObservers(page: Page) {
  const counters = {
    hf: 0, // WebLLM model weights / metadata (HuggingFace)
    cdn: 0, // MLC wasm runtime / wasi shims (jsDelivr)
    cloud: 0, // any cloud AI endpoint (privacy leak detector)
  };
  await page.route("**/huggingface.co/**", (route) => {
    counters.hf += 1;
    void route.abort();
  });
  await page.route("**/cdn.jsdelivr.net/**", (route) => {
    counters.cdn += 1;
    void route.abort();
  });
  await page.route("**api.openai.com/**", (route) => {
    counters.cloud += 1;
    void route.abort();
  });
  return counters;
}

/**
 * Emulates a GPU-blocked, otherwise high-end device BEFORE any app code
 * executes. hardwareConcurrency is always set HIGH so the blocker is the
 * gpuKind/deviceMemory under test. gpuKind selects the profile; extraStorage
 * lets scenarios persist app state (e.g. a forced provider) before boot;
 * deviceMemory lets a profile drop below the 4 GB local-LLM floor (Profile C).
 */
async function emulateDevice(
  page: Page,
  gpuKind:
    | "no-webgpu"
    | "no-f16"
    | "low-ram"
    | "adapter-rejects"
    | "adapter-rejects-then-recovers",
  extraStorage: Record<string, string> = {},
  deviceMemory = 8,
): Promise<void> {
  await page.addInitScript(
    ({ gpuKind: kind, extraStorage: extra, deviceMemory: mem }) => {
      Math.random = () => 0.5;
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: {
          effectiveType: "4g",
          saveData: false,
          downlink: 10,
          rtt: 50,
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      });
      Object.defineProperty(navigator, "getBattery", {
        configurable: true,
        value: async () => ({
          level: 1,
          charging: true,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      });
      Object.defineProperty(navigator, "deviceMemory", {
        configurable: true,
        value: mem,
      });
      Object.defineProperty(navigator, "hardwareConcurrency", {
        configurable: true,
        value: 8,
      });
      // Every profile records how many times the (possibly fake) adapter
      // is REQUESTED. The capability verdict must be computed once per boot
      // and then served from cache — a per-unlock re-probe would show up as
      // adapter-request deltas in the warmup-savings measurement.
      const w = window as unknown as { __adapterRequests: number };
      w.__adapterRequests = 0;
      const countRequests = (gpu: {
        requestAdapter: (...args: unknown[]) => Promise<unknown>;
      }) => {
        const orig = gpu.requestAdapter.bind(gpu);
        gpu.requestAdapter = async (...args: unknown[]) => {
          w.__adapterRequests += 1;
          return orig(...args);
        };
        return gpu;
      };

      let gpuValue: unknown;
      if (kind === "no-f16") {
        // Profile B: WebGPU API present, an adapter is returned, but its
        // feature set lacks 'shader-f16' — MLC q4f16 models cannot run.
        gpuValue = countRequests({
          requestAdapter: async () => ({ features: new Set<string>() }),
        });
      } else if (kind === "low-ram") {
        // Profile C: a FULLY capable adapter (shader-f16 present) — the
        // deviceMemory floor (>= 4 GB) is the only blocker.
        gpuValue = countRequests({
          requestAdapter: async () => ({
            features: new Set(["shader-f16"]),
          }),
        });
      } else if (kind === "adapter-rejects") {
        // Profile D: WebGPU API present but adapter acquisition REJECTS —
        // the detection ERROR path (driver crash / device lost), not a
        // well-formed "no adapter" null answer. Every caller must catch this.
        gpuValue = countRequests({
          requestAdapter: async () => {
            throw new DOMException(
              "GPU adapter acquisition failed (device lost)",
              "OperationError",
            );
          },
        });
      } else if (kind === "adapter-rejects-then-recovers") {
        // FLAKY-DEVICE scenario (transient detection failure): the FIRST
        // requestAdapter rejects, every later one returns a FULLY capable
        // adapter. Used by the reject-then-succeed test to document that the
        // service never reaches the second (successful) call — its cached
        // false verdict is session-permanent by design.
        gpuValue = countRequests({
          requestAdapter: (() => {
            let calls = 0;
            return async () => {
              calls += 1;
              if (calls === 1) {
                throw new DOMException(
                  "GPU adapter acquisition failed (device lost)",
                  "OperationError",
                );
              }
              return { features: new Set(["shader-f16"]) };
            };
          })(),
        });
      } else {
        // Profile A: no WebGPU surface at all (worst-case GPU-less device).
        gpuValue = undefined;
      }
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: gpuValue,
      });
      try {
        localStorage.setItem("forge_welcome_tour_complete", "true");
        for (const [k, v] of Object.entries(extra)) {
          localStorage.setItem(k, v);
        }
      } catch {
        /* ignore: non-fatal localStorage denial */
      }
    },
    { gpuKind, extraStorage, deviceMemory },
  );
}

/**
 * Instruments init() after boot (module imports need the app served by Vite).
 * The pre-boot window is still covered by the final assertions: any init()
 * call — boot-time or later — bumps getMetrics().initializationCount, and any
 * model fetch bumps the HuggingFace/CDN counters, so a missed init attempt
 * cannot slip through.
 */
async function instrumentWebLLMInit(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { webLLMService } = await import(
      "/src/services/ai/WebLLMService"
    );
    const svc = webLLMService as unknown as {
      init: (...args: unknown[]) => Promise<unknown>;
    };
    const w = window as unknown as { __webllmInitCalls: number };
    w.__webllmInitCalls = 0;
    const origInit = svc.init.bind(svc);
    svc.init = async (...args) => {
      w.__webllmInitCalls += 1;
      return origInit(...args);
    };
  });
}

/**
 * Reads the instrumented WebLLM state: init() call counter (wrapper), warmup()
 * call counter (wrapper) and the service metrics relevant to the measurement.
 */
async function readWebLLMState(page: Page) {
  return page.evaluate(async () => {
    const { webLLMService } = await import(
      "/src/services/ai/WebLLMService"
    );
    const w = window as unknown as {
      __webllmInitCalls: number;
      __warmupCalls: number;
      __switchCalls: number;
      __switchRefusals: number;
      __adapterRequests: number;
    };
    const metrics = webLLMService.getMetrics();
    const status = await webLLMService.getHealthStatus();
    return {
      initCalls: w.__webllmInitCalls ?? 0,
      warmupCalls: w.__warmupCalls ?? 0,
      switchCalls: w.__switchCalls ?? 0,
      switchRefusals: w.__switchRefusals ?? 0,
      adapterRequests: w.__adapterRequests ?? 0,
      initializationCount: metrics.initializationCount,
      errorCount: metrics.errorCount,
      generationCount: metrics.generationCount,
      engineReady: status.engineReady,
      canRunLocalLLM: status.canRunLocalLLM,
    };
  });
}

/**
 * Collects uncaught page errors (including unhandled promise rejections) so a
 * test can assert the app stayed healthy. On the adapter-rejects profile a
 * single requestAdapter rejection escaping its try/catch surfaces here — and
 * fails the run — instead of silently crashing the page mid-test.
 */
function installCrashDetector(page: Page): { pageErrors: string[] } {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err instanceof Error ? err.message : String(err));
  });
  return { pageErrors };
}

/** The GPU-blocked device profiles; the shared test body runs for each. */
const DEVICE_PROFILES = [
  {
    name: "device without WebGPU (navigator.gpu undefined)",
    gpuKind: "no-webgpu",
    webGPUSupported: false,
    f16Supported: false,
    // RAM/CPU-only tier: 8 GB / 8 cores qualifies regardless of GPU.
    highEndDevice: true,
    deviceMemory: 8,
    canRunLocalLLM: false,
    // The support view names THIS cause, from the same ladder the
    // generation gates throw (webgpu-unavailable / shader-f16-unsupported
    // / insufficient-memory).
    expectedBlocker: "webgpu-unavailable",
    extraStorage: {},
  },
  {
    name: "device with a GPU adapter lacking shader-f16",
    gpuKind: "no-f16",
    webGPUSupported: true,
    f16Supported: false,
    highEndDevice: true,
    deviceMemory: 8,
    canRunLocalLLM: false,
    expectedBlocker: "shader-f16-unsupported",
    extraStorage: {},
  },
  {
    name: "device with a capable GPU but only 3 GB RAM",
    gpuKind: "low-ram",
    webGPUSupported: true,
    f16Supported: true,
    // 3 GB is below the 8 GB RAM/CPU tier, so not high-end by that check.
    highEndDevice: false,
    deviceMemory: 3,
    canRunLocalLLM: false,
    expectedBlocker: "insufficient-memory",
    extraStorage: {},
  },
  {
    name: "device whose GPU adapter request REJECTS (detection error path)",
    gpuKind: "adapter-rejects",
    // A rejecting probe can only be reported as "not supported": the catch
    // path caches webGpuSupported=false and never learns the f16 feature set.
    webGPUSupported: false,
    f16Supported: false,
    // RAM/CPU-only tier: 8 GB / 8 cores qualifies; the GPU probe is a
    // separate concern this check deliberately never consults.
    highEndDevice: true,
    deviceMemory: 8,
    canRunLocalLLM: false,
    expectedBlocker: "webgpu-unavailable",
    extraStorage: {},
  },
  {
    name: "device with a capable GPU at exactly 4 GB RAM (capability boundary)",
    gpuKind: "low-ram",
    // Fully capable surface (shader-f16 present) — same as Profile C.
    webGPUSupported: true,
    f16Supported: true,
    // 4 GB is still BELOW the 8 GB RAM/CPU tier floor: isHighEndDevice
    // stays false at the capability boundary — different thresholds.
    highEndDevice: false,
    deviceMemory: 4,
    // EXACTLY at the >= 4 GB floor the RAM gate opens: the flip point.
    canRunLocalLLM: true,
    expectedBlocker: null,
    // A now-CAPABLE device must not opportunistically start a real engine
    // init during this test (forge_test_mode is the documented E2E escape
    // hatch; ai-first-boot uses it for the same reason). Capability verdicts
    // and UI state are unaffected by the flag.
    extraStorage: { forge_test_mode: "true" },
  },
] as const;

for (const profile of DEVICE_PROFILES) {
  test.describe(profile.name, () => {
    test(
      "capability verdict drives the UI, private docs fail closed, and no engine init is attempted",
      async ({ page }) => {
        const net = await installNetworkObservers(page);
        const crashes = installCrashDetector(page);
        await emulateDevice(
          page,
          profile.gpuKind,
          profile.extraStorage,
          profile.deviceMemory,
        );

        // --- 1. Boot into the unlocked shell (fast path, no KDF). ---
        await skipPassword(page);
        await instrumentWebLLMInit(page);

        // --- 2. Capability probe (runs right after boot, before any AI
        // interaction): none of the profiles can run local LLM, each blocked
        // by a DIFFERENT gate. This pins the rename semantics —
        // isHighEndDevice() (RAM/CPU-only tier check) is true on A/B (8 GB /
        // 8 cores) and false on C (3 GB), while canRunLocalLLM() (WebGPU +
        // f16 + RAM) is false on all three. The probes differ per profile
        // (webGPUSupported, f16Supported, highEndDevice); every runnability
        // outcome is identical. ---
        const health = await page.evaluate(async () => {
          const { webLLMService } = await import(
            "/src/services/ai/WebLLMService"
          );
          const { resourceManager } = await import(
            "/src/services/ai/ResourceManager.ts"
          );
          const status = await webLLMService.getHealthStatus();
          return {
            webGPUSupported: status.webGPUSupported,
            f16Supported: status.f16Supported,
            canRunLocalLLM: status.canRunLocalLLM,
            engineReady: status.engineReady,
            highEndDevice: resourceManager.isHighEndDevice(),
          };
        });
        expect(
          health.webGPUSupported,
          `webGPUSupported for ${profile.name}`,
        ).toBe(profile.webGPUSupported);
        expect(
          health.f16Supported,
          `f16Supported for ${profile.name}`,
        ).toBe(profile.f16Supported);
        expect(
          health.highEndDevice,
          `RAM/CPU tier (isHighEndDevice) for ${profile.name}`,
        ).toBe(profile.highEndDevice);
        expect(
          health.canRunLocalLLM,
          `canRunLocalLLM must match the profile's gate configuration for ${profile.name}`,
        ).toBe(profile.canRunLocalLLM);
        expect(
          health.engineReady,
          "no engine may exist on a GPU-blocked device",
        ).toBe(false);

        // --- 3. Settings UI: the WebLLM option mirrors the capability
        // verdict. Blocked profiles: disabled with the "Unsupported Device"
        // suffix and the availability hint — the app never offers a
        // capability the device lacks. Profile E (the flip point) pins the
        // INVERSE: the option becomes enabled and the suffix/hint
        // disappear — the UI must flip WITH canRunLocalLLM (useSettings
        // probes it on mount), never stay gated by a stale verdict. ---
        await page.getByTestId("settings-button").click();
        const aiSection = page.getByTestId("settings-ai-config");
        await expect(aiSection).toBeVisible();
        const webllmOption = aiSection.locator(
          'select option[value="webllm"]',
        );
        if (profile.canRunLocalLLM) {
          await expect(webllmOption).toBeEnabled();
          await expect(webllmOption).not.toContainText("Unsupported Device");
          await expect(
            aiSection.getByText(/WebLLM is not available on this device/i),
          ).toHaveCount(0);
        } else {
          await expect(webllmOption).toBeDisabled();
          await expect(webllmOption).toContainText("Unsupported Device");
          await expect(
            aiSection.getByText(/WebLLM is not available on this device/i),
          ).toBeVisible();
        }

        // --- 3b. Diagnostics view mirrors the unit-level health status. On
        // blocked profiles: the modal's "WebGPU Support" card must show YES
        // exactly when webGPUSupported is true (it is on the f16 and low-RAM
        // profiles) — the rendered UI, not just the service probe. On the
        // capable boundary profile the warning block (and with it the ONLY
        // modal entry point) structurally does not render, so the same
        // contract is asserted through the diagnostics PAYLOAD that feeds
        // the card: webGpuSupported must be true, and the webLlmStatus
        // ladder must honestly report "Not initialized" (no engine, no
        // model, no error — never a hardcoded "Ready"). ---
        if (profile.canRunLocalLLM) {
          const diag = await page.evaluate(async () => {
            const { diagnosticService } = await import(
              "/src/services/DiagnosticService.ts"
            );
            return diagnosticService.getDiagnostics();
          });
          expect(
            diag.ai.webGpuSupported,
            "diagnostics payload must report WebGPU support on the capable boundary device",
          ).toBe(true);
          expect(
            diag.ai.webLlmStatus,
            "diagnostics payload must honestly report the engine state on a capable device with no engine",
          ).toBe("Not initialized");
          // The blocked path exits Settings via the same Escape that follows
          // the diagnostics modal; keep both paths symmetric so step 3c can
          // reach the sidebar (the full-screen Settings overlay covers it).
          await page.keyboard.press("Escape");
        } else {
          await aiSection
            .getByRole("button", { name: "Run Diagnostics" })
            .click();
          const webGpuCard = page.locator("div.ds-radius-button").filter({
            has: page.locator("span", { hasText: "WebGPU Support" }),
          });
          await expect(
            webGpuCard.getByText(profile.webGPUSupported ? "YES" : "NO"),
            `diagnostics view must report WebGPU support for ${profile.name}`,
          ).toBeVisible();
          // The modal's animated overlay can intercept pointer events on its
          // own close button (same Mantine-style race handled in
          // vault-helpers.lockVault); invoke the accessible button directly.
          await page
            .getByRole("button", { name: "Close Diagnostics" })
            .evaluate((button) => (button as HTMLButtonElement).click());
          await page.keyboard.press("Escape");
        }

        // --- 3c. Support view mirrors canRunLocalLLM: the diagnostics
        // panel's "Local AI (WebLLM)" line reports the device verdict —
        // the cannot-run error on blocked profiles, the ready wording on
        // the boundary profile (with "Model not loaded yet." since no
        // engine exists — capability ≠ engine state). ---
        await page
          .getByRole("button", { name: "Support", exact: true })
          .click();
        await page.getByRole("tab", { name: "Diagnostics" }).click();
        if (profile.canRunLocalLLM) {
          await expect(
            page.getByText(/WebLLM is ready on this device/i),
            `support view must report the runable device for ${profile.name}`,
          ).toBeVisible({ timeout: 15_000 });
          await expect(
            page.getByText(/Model not loaded yet/i),
            "ready capability with no engine must still report the model as not loaded",
          ).toBeVisible();
          await expect(
            page.getByText(/WebLLM cannot run/i),
            "the cannot-run error must disappear on a runable device",
          ).toHaveCount(0);
        } else {
          // The support line names the PRECISE cause: the blocker enum from
          // WebLLMService.getCapabilityBlocker() reaches the user as a
          // cause-specific message, and the old generic wording must be
          // GONE — a real verdict exists, so "WebGPU or RAM required" would
          // be a downgrade back into vagueness.
          const blockerMessage: Record<string, RegExp> = {
            "webgpu-unavailable":
              /WebLLM cannot run: this browser does not support WebGPU/i,
            "shader-f16-unsupported":
              /WebLLM cannot run: the GPU lacks shader-f16/i,
            "insufficient-memory":
              /WebLLM cannot run: at least 4 GB of device memory is required/i,
          };
          await expect(
            page.getByText(blockerMessage[profile.expectedBlocker]!),
            `support view must name the precise blocker for ${profile.name}`,
          ).toBeVisible({ timeout: 15_000 });
          await expect(
            page.getByText(
              /WebLLM cannot run: WebGPU or sufficient RAM is required/i,
            ),
            "the generic fallback must never show when a real verdict exists",
          ).toHaveCount(0);
        }

        // --- 4. Private document through the app's real persistence + AI
        // chain. Insert with isPrivate:true (the same RxDB write path
        // privacy-ai-guard proves reads back correctly), verify the flag,
        // then run the production agentService.rewrite path with the
        // document's real flag. EVERY profile must fail closed here — but
        // the dual gate means profile E fails for a DIFFERENT reason: it
        // HAS a runable WebLLM (canRunLocalLLM=true) yet resolveProvider's
        // local route additionally requires the 8 GB tier
        // (isHighEndDevice=false at 4 GB), so the private route still finds
        // "no Local AI". Capability alone does not unlock private routing. ---
        const { docId, verified } = await page.evaluate(async ({ text }) => {
          const { initDB } = await import("/src/db/database.ts");
          const db = await initDB();
          const doc = await db.documents.insert({
            id:
              "webllm-guard-private-" + Date.now() + "-" +
              Math.floor(Math.random() * 1e6),
            folderId: "root",
            title: "Private Doc (GPU-blocked)",
            blocks: [],
            textContent: text,
            tags: [],
            links: [],
            processed: true,
            isDeleted: false,
            isPrivate: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          const after = await db.documents.findOne(doc.id).exec(true);
          return { docId: doc.id, verified: after?.isPrivate === true };
        }, { text: PRIVATE_DOC_TEXT });
        expect(docId).toBeTruthy();
        expect(
          verified,
          "the document must be persisted as private",
        ).toBe(true);

        const result = await page.evaluate(async ({ id, text }) => {
          const { initDB } = await import("/src/db/database.ts");
          const db = await initDB();
          const doc = await db.documents.findOne(id).exec();
          const { agentService } = await import(
            "/src/services/ai/AgentService.ts"
          );
          try {
            const rewritten = await agentService.rewrite(
              text,
              "professional",
              "en",
              doc?.isPrivate === true,
            );
            return { ok: true as const, rewritten };
          } catch (e) {
            return {
              ok: false as const,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }, { id: docId, text: PRIVATE_DOC_TEXT });

        expect(
          result.ok,
          `private AI must fail closed on every profile — the reason differs (no local AI vs 8 GB tier), the closed door does not: ${JSON.stringify(result)}`,
        ).toBe(false);
        if (!result.ok) {
          expect(result.error).toMatch(/no Local AI is available/i);
        }

        // --- 5. Post-conditions: no engine init, no downloads, no cloud
        // leak — on blocked profiles because nothing CAN run, on the
        // boundary profile because every tested path (probing, UI, support
        // view, failed private routing) is read-only with respect to the
        // engine. ---
        const post = await page.evaluate(async () => {
          const { webLLMService } = await import(
            "/src/services/ai/WebLLMService"
          );
          const w = window as unknown as { __webllmInitCalls: number };
          const metrics = webLLMService.getMetrics();
          const status = await webLLMService.getHealthStatus();
          return {
            initCalls: w.__webllmInitCalls,
            initializationCount: metrics.initializationCount,
            generationCount: metrics.generationCount,
            engineReady: status.engineReady,
            canRunLocalLLM: status.canRunLocalLLM,
          };
        });
        expect(
          post.initCalls,
          "WebLLM init() must never be invoked by probing, the UI, or the private-doc failure path",
        ).toBe(0);
        expect(
          post.initializationCount,
          "no WebLLM engine initialization may be recorded",
        ).toBe(0);
        expect(
          post.generationCount,
          "no WebLLM generation may run on a GPU-blocked device",
        ).toBe(0);
        expect(
          post.engineReady,
          "no test path may start the engine — capability is never engine state",
        ).toBe(false);
        expect(
          post.canRunLocalLLM,
          "the capability verdict must match the profile's gate configuration",
        ).toBe(profile.canRunLocalLLM);
        expect(
          net.hf,
          "no WebLLM model download may be attempted (HuggingFace)",
        ).toBe(0);
        expect(
          net.cdn,
          "no MLC wasm/runtime fetch may be attempted (jsDelivr)",
        ).toBe(0);
        expect(
          net.cloud,
          "private data must never reach a cloud AI endpoint",
        ).toBe(0);
        expect(
          crashes.pageErrors,
          `no uncaught page error may escape the blocked-GPU path on ${profile.name} ` +
            "(every requestAdapter caller must catch and fail closed)",
        ).toEqual([]);
      },
    );
  });
}

/**
 * TRANSIENT detection failure (reject-then-succeed): the FIRST requestAdapter
 * rejects, every later one returns a fully capable shader-f16 adapter.
 *
 * DOCUMENTS CURRENT BEHAVIOR — the capability verdict is cached per session
 * and FAILS CLOSED: the catch path in isWebGPUSupported converts the very
 * first rejection into webGpuSupported=false, caches it for the service
 * instance's lifetime, and every later verdict (canRunLocalLLM,
 * getHealthStatus, UI option state, routing) serves that cached false for
 * the rest of the session — even though a retry would now find a fully
 * capable GPU. The low-power fallback never runs either: the high-
 * performance rejection aborts the A || B expression before it.
 *
 * WHAT A RECOVERY PATH WOULD NEED (all four, together):
 *   1. A reset() (or invalidate-on-reject) seam on WebLLMService's cached
 *      webGpuSupported verdict — HardwareDetectorService already has the
 *      reset() seam; WebLLMService deliberately does not.
 *   2. A RETRY POLICY that knows which failures are transient: distinguish
 *      OperationError/device-lost (retryable) from a stable absence of a
 *      GPU surface (permanent). A blind retry on Profile A would waste a
 *      probe per attempt forever.
 *   3. A STATE-CACHE COHERENCE plan: a re-probe that flips webGpuSupported
 *      false→true must also invalidate every derived verdict (health
 *      status, the Settings option's enabled state in useSettings, routing
 *      table entries) — otherwise the UI shows disabled while routing
 *      succeeds, a worse lie than the current one.
 *   4. A SAFETY-NET for the opposite direction (true→false mid-session,
 *      real device-lost): generation must keep failing closed via
 *      assertCanRunLocalLLM's per-request re-check of the adapter state.
 *
 * This test pins the fail-closed side of that contract. If the cache ever
 * becomes self-healing WITHOUT the state-coherence work in (3), the first
 * assertion pair fails — deliberately.
 */
test.describe("transient adapter failure — reject-then-succeed (session-cached fail-closed)", () => {
  test(
    "a GPU that recovers after the first probe is never re-discovered until a new session",
    async ({ page }) => {
      const net = await installNetworkObservers(page);
      const crashes = installCrashDetector(page);
      await emulateDevice(page, "adapter-rejects-then-recovers");

      // --- 1. Boot into the unlocked shell (fast path, no KDF). ---
      await skipPassword(page);
      await instrumentWebLLMInit(page);

      // --- 2. The boot-time probe caught the transient rejection: the
      // cached verdict must be false, and the one request that DID happen
      // must be the failing one. ---
      const health = await page.evaluate(async () => {
        const { webLLMService } = await import(
          "/src/services/ai/WebLLMService"
        );
        const status = await webLLMService.getHealthStatus();
        return {
          webGPUSupported: status.webGPUSupported,
          f16Supported: status.f16Supported,
          canRunLocalLLM: status.canRunLocalLLM,
          engineReady: status.engineReady,
        };
      });
      expect(
        health.webGPUSupported,
        "the transient boot-time rejection must be cached as not-supported",
      ).toBe(false);
      expect(health.canRunLocalLLM, "the cached verdict must block runnability").
        toBe(false);
      expect(
        health.engineReady,
        "no engine may exist while the cached verdict says no-GPU",
      ).toBe(false);

      // --- 3. The device has RECOVERED (every later requestAdapter succeeds
      // with a fully capable adapter) — but the cached verdict must not
      // change. Repeated health probes must keep serving the cached false,
      // and the adapter-request count must stay at ONE: no later caller may
      // re-probe, so the successful adapter is never discovered. ---
      for (let i = 0; i < 3; i++) {
        const again = await page.evaluate(async () => {
          const { webLLMService } = await import(
            "/src/services/ai/WebLLMService"
          );
          return webLLMService.getHealthStatus();
        });
        expect(
          again.webGPUSupported,
          "later probes must serve the cached false even after recovery",
        ).toBe(false);
        expect(again.canRunLocalLLM).toBe(false);
      }

      const adapterState = await page.evaluate(() => {
        const w = window as unknown as { __adapterRequests: number };
        return { requests: w.__adapterRequests };
      });
      expect(
        adapterState.requests,
        "exactly ONE adapter request (the failing one) — the recovered GPU " +
          "must never be re-discovered by any session probe",
      ).toBe(1);

      // --- 4. The UI must mirror the cached verdict: the Settings WebLLM
      // option stays disabled with the unsupported hint — the app must not
      // offer a capability its (cached) verdict says the device lacks. ---
      await page.getByTestId("settings-button").click();
      const aiSection = page.getByTestId("settings-ai-config");
      await expect(aiSection).toBeVisible();
      const webllmOption = aiSection.locator('select option[value="webllm"]');
      await expect(webllmOption).toBeDisabled();
      await expect(webllmOption).toContainText("Unsupported Device");

      // --- 5. Post-conditions: no init attempt (the guard consumed the
      // cached false), no downloads, no cloud leak, zero crashes. The
      // recovery must not have opened any door. ---
      const post = await page.evaluate(async () => {
        const { webLLMService } = await import(
          "/src/services/ai/WebLLMService"
        );
        const w = window as unknown as { __webllmInitCalls: number };
        const metrics = webLLMService.getMetrics();
        return {
          initCalls: w.__webllmInitCalls,
          initializationCount: metrics.initializationCount,
          generationCount: metrics.generationCount,
        };
      });
      expect(
        post.initCalls,
        "no init may be attempted against the cached not-supported verdict",
      ).toBe(0);
      expect(post.initializationCount).toBe(0);
      expect(post.generationCount).toBe(0);
      expect(
        net.hf,
        "no model download may be attempted while cached as blocked",
      ).toBe(0);
      expect(
        net.cdn,
        "no runtime fetch may be attempted while cached as blocked",
      ).toBe(0);
      expect(net.cloud, "no cloud AI endpoint may be contacted").toBe(0);
      expect(
        crashes.pageErrors,
        "the transient boot-time rejection must be caught, not crash the page",
      ).toEqual([]);
    },
  );
});

/**
 * The forced-provider contract is pinned on THREE blocked profiles: the
 * persisted selection is honored by resolveProvider on ANY device (it is
 * NOT filtered by capability), so generation routes to WebLLM and must fail
 * CLOSED with THAT profile's own capability error. The three messages must
 * never cross (the f16-less device HAS a GPU; the low-RAM device HAS f16;
 * the GPU-less one never reaches the f16 or RAM check — the ladder is
 * ordered surface → f16 → RAM) and none may degrade to the developer-facing
 * "engine not initialized" state error. The low-RAM entry is the third gate
 * of assertCanRunLocalLLM(): a fully capable GPU whose ONLY blocker is the
 * 4 GB memory floor.
 */
const FORCED_PROFILES = [
  {
    name: "without WebGPU (navigator.gpu undefined)",
    gpuKind: "no-webgpu",
    deviceMemory: 8,
    // No surface → the modal's WebGPU Support card must read NO.
    webGPUSupported: false,
    expectedError: /WebGPU is not supported/i,
    // The surface blocker fires first: the f16 message must not leak in.
    unexpectedError: /shader-f16/i,
  },
  {
    name: "with a GPU adapter lacking shader-f16",
    gpuKind: "no-f16",
    deviceMemory: 8,
    // Surface support EXISTS: the modal's card must still read YES even
    // though generation failed — support and runnability are different
    // verdicts, and the card reports the surface one.
    webGPUSupported: true,
    expectedError: /shader-f16 \(half-precision\)/i,
    // The device HAS a GPU: the blanket "not supported" message must not
    // replace the precise f16 one.
    unexpectedError: /WebGPU is not supported/i,
  },
  {
    name: "with a fully capable GPU but only 3 GB of RAM",
    gpuKind: "low-ram",
    deviceMemory: 3,
    // Capable surface: the modal's card reads YES while the RAM gate blocks
    // generation — same support-vs-runnability split as the f16 profile.
    webGPUSupported: true,
    expectedError:
      /Insufficient device memory for local AI models: 3 GB available, 4 GB required/i,
    // The GPU gates all PASS here (surface + f16): neither earlier-ladder
    // message may leak in ahead of the RAM error.
    unexpectedError: /WebGPU is not supported|shader-f16/i,
  },
] as const;

for (const fp of FORCED_PROFILES) {
  test.describe(
    `forced WebLLM provider on a device that cannot run it — ${fp.name}`,
    () => {
      test(
        "generateText and streamGenerateText fail with the capability error instead of attempting the engine",
        async ({ page }) => {
          const net = await installNetworkObservers(page);
          // Force the persisted provider selection BEFORE boot — the same key
          // the app writes on provider change (ProviderConfiguration reads it
          // from localStorage in its constructor).
          await emulateDevice(page, fp.gpuKind, {
            selected_ai_provider: "webllm",
          }, fp.deviceMemory);

          // --- 1. Boot into the unlocked shell (fast path, no KDF). ---
          await skipPassword(page);
          await instrumentWebLLMInit(page);

          // --- 2. The forced selection must survive boot: nothing may
          // silently reset an explicit user choice, even when the device
          // cannot run it. ---
          const selected = await page.evaluate(async () => {
            const { aiManager } = await import(
              "/src/services/ai/ProviderManager.ts"
            );
            return aiManager.getProviderInfo().provider;
          });
          expect(
            selected,
            "selected_ai_provider=webllm must remain the active provider after boot",
          ).toBe("webllm");

          // --- 3. generateText AND streamGenerateText with the forced
          // WebLLM provider on this blocked device: the explicit selection is
          // authoritative in resolveProvider (it is NOT filtered by
          // capability), so both entry points route to WebLLM — and each must
          // fail CLOSED with THIS profile's capability error, not the
          // misleading developer-facing "engine not initialized" state error;
          // the two capability messages must never cross. Streaming must
          // additionally emit ZERO chunks before failing — the capability
          // guard fires before any engine touch or byte reaches the caller. ---
          const results = await page.evaluate(async () => {
            const { aiManager } = await import(
              "/src/services/ai/ProviderManager.ts"
            );
            const asError = (e: unknown) =>
              e instanceof Error ? e.message : String(e);

            let gen: { ok: true } | { ok: false; error: string };
            try {
              await aiManager.generateText(
                "Summarize this document for me.",
                undefined,
                { isPrivate: false },
              );
              gen = { ok: true };
            } catch (e) {
              gen = { ok: false, error: asError(e) };
            }

            const chunks: string[] = [];
            const providerAnnouncements: string[] = [];
            let stream: { ok: true } | { ok: false; error: string };
            try {
              await aiManager.streamGenerateText(
                "Summarize this document for me.",
                undefined,
                { isPrivate: false },
                (chunk) => chunks.push(chunk),
                (p) => providerAnnouncements.push(p),
              );
              stream = { ok: true };
            } catch (e) {
              stream = { ok: false, error: asError(e) };
            }

            return {
              gen,
              stream,
              streamedChunks: chunks.length,
              providerAnnouncements,
            };
          });

          expect(
            results.gen.ok,
            `forced WebLLM generateText on a blocked device must fail closed: ${JSON.stringify(results.gen)}`,
          ).toBe(false);
          if (!results.gen.ok) {
            expect(results.gen.error).toMatch(fp.expectedError);
            expect(results.gen.error).not.toMatch(fp.unexpectedError);
            expect(results.gen.error).not.toMatch(/engine not initialized/i);
          }

          expect(
            results.stream.ok,
            `forced WebLLM streamGenerateText on a blocked device must fail closed: ${JSON.stringify(results.stream)}`,
          ).toBe(false);
          if (!results.stream.ok) {
            expect(results.stream.error).toMatch(fp.expectedError);
            expect(results.stream.error).not.toMatch(fp.unexpectedError);
            expect(results.stream.error).not.toMatch(/engine not initialized/i);
          }
          expect(
            results.streamedChunks,
            "streaming must emit zero chunks before the capability failure",
          ).toBe(0);
          expect(
            results.providerAnnouncements,
            "onProvider must never announce a provider whose request fails " +
              "closed — the capability guard fires BEFORE the announcement",
          ).toEqual([]);

          // --- 3b. Explicit warmup on this blocked device: the opportunistic
          // preload flows through the same canRunLocalLLM() guard, so repeated
          // warmup() calls must skip init() every time — even with webllm as
          // the authoritative selection. The counter wrapper proves the chain
          // actually ran: an unguarded warmup would call init() right here.
          await page.evaluate(async () => {
            const { aiManager } = await import(
              "/src/services/ai/ProviderManager.ts"
            );
            const w = window as unknown as { __warmupCalls: number };
            w.__warmupCalls = 0;
            const orig = aiManager.warmup.bind(aiManager);
            aiManager.warmup = async () => {
              w.__warmupCalls += 1;
              return orig();
            };
          });
          const WARMUP_CALLS = 3;
          for (let i = 0; i < WARMUP_CALLS; i++) {
            await page.evaluate(async () => {
              const { aiManager } = await import(
                "/src/services/ai/ProviderManager.ts"
              );
              await aiManager.warmup();
            });
          }
          const warmupInvocations = await page.evaluate(() => {
            const w = window as unknown as { __warmupCalls: number };
            return w.__warmupCalls ?? 0;
          });
          expect(
            warmupInvocations,
            "every explicit warmup invocation must have executed",
          ).toBe(WARMUP_CALLS);

          // --- 3c. Diagnostics modal mirrors the unit-level health status
          // AFTER the capability error surfaced at generation time: the
          // "WebGPU Support" card must show YES exactly when webGPUSupported
          // is true — including on the f16-less and low-RAM devices, where the
          // card truthfully says YES while generateText above failed with the
          // precise shader-f16 error (surface support and runnability are
          // different verdicts, and the card reports the surface one). If the
          // card ever degrades to blanket "NO" on a GPU-owning device — or
          // flips YES after failures it must not change — this fails. ---
          await page.getByTestId("settings-button").click();
          const aiSection = page.getByTestId("settings-ai-config");
          await expect(aiSection).toBeVisible();
          await aiSection
            .getByRole("button", { name: "Run Diagnostics" })
            .click();
          const webGpuCard = page.locator("div.ds-radius-button").filter({
            has: page.locator("span", { hasText: "WebGPU Support" }),
          });
          await expect(
            webGpuCard.getByText(fp.webGPUSupported ? "YES" : "NO"),
            `diagnostics modal must report WebGPU support for the forced-provider device ${fp.name}`,
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Close Diagnostics" })
            .evaluate((button) => (button as HTMLButtonElement).click());
          await page.keyboard.press("Escape");

          // --- 4. Post-conditions: no engine init — via generateText, the
          // streaming path, or the explicit warmups above — no generation, no
          // downloads, no cloud leak. ---
          const post = await page.evaluate(async () => {
            const { webLLMService } = await import(
              "/src/services/ai/WebLLMService"
            );
            const w = window as unknown as { __webllmInitCalls: number };
            const metrics = webLLMService.getMetrics();
            const status = await webLLMService.getHealthStatus();
            return {
              initCalls: w.__webllmInitCalls,
              initializationCount: metrics.initializationCount,
              generationCount: metrics.generationCount,
              engineReady: status.engineReady,
              canRunLocalLLM: status.canRunLocalLLM,
            };
          });
          expect(
            post.initCalls,
            "WebLLM init() must never be invoked on a blocked device",
          ).toBe(0);
          expect(
            post.initializationCount,
            "no WebLLM engine initialization may be recorded",
          ).toBe(0);
          expect(
            post.generationCount,
            "no WebLLM generation may run on a blocked device",
          ).toBe(0);
          expect(post.engineReady, "engine must remain null").toBe(false);
          expect(post.canRunLocalLLM).toBe(false);
          expect(
            net.hf,
            "no WebLLM model download may be attempted (HuggingFace)",
          ).toBe(0);
          expect(
            net.cdn,
            "no MLC wasm/runtime fetch may be attempted (jsDelivr)",
          ).toBe(0);
          expect(
            net.cloud,
            "the failed request must never reach a cloud AI endpoint",
          ).toBe(0);
        },
      );
    },
  );
}

test.describe("Chat UI with forced webllm on a GPU-less device", () => {
  test(
    "sending a message surfaces the capability failure in the conversation — never as a toast — without any engine attempt",
    async ({ page }) => {
      const net = await installNetworkObservers(page);
      const crashes = installCrashDetector(page);
      await emulateDevice(page, "no-webgpu", {
        selected_ai_provider: "webllm",
      });

      // --- 1. Boot into the unlocked shell and instrument init() and the
      // streaming entry point. The stream wrapper records the rejection the
      // Chat chain actually received, so the generic in-conversation error
      // text can be traced to the CAPABILITY guard — not to some RAG/memory
      // pre-step failure. ---
      await skipPassword(page);
      await instrumentWebLLMInit(page);
      await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        const w = window as unknown as {
          __streamRejections: { ok: boolean; error?: string }[];
        };
        w.__streamRejections = [];
        const orig = aiManager.streamGenerateText.bind(aiManager);
        aiManager.streamGenerateText = async (
          ...args: Parameters<typeof orig>
        ) => {
          try {
            return await orig(...args);
          } catch (e) {
            w.__streamRejections.push({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            });
            throw e;
          }
        };
      });

      // --- 2. Open the Local RAG Chat tab through the real navigation. ---
      await page.locator('[data-tab-id="chatLocal"]').click();
      await expect(page.getByTestId("chat-input")).toBeVisible({
        timeout: 15_000,
      });

      // --- 3. Send a message like a user. The production chain is
      // Chat → AgentService.globalChat → aiManager.streamGenerateText
      // (isPrivate defaults to true) → the webllm capability pre-assert
      // fails closed before any engine touch. ---
      await page.getByTestId("chat-input").fill("What do my documents say?");
      await page.keyboard.press("Enter");

      // --- 4. The capability error must surface IN THE CONVERSATION. Chat
      // renders the failed request as an error bubble inside the chat
      // history (persisted message or transient fallback — both carry the
      // generic failure text) with a Retry affordance, keeping the user in
      // control. The failure must NEVER degrade into a toast (sonner
      // [data-sonner-toast]) — errors belong in the dialogue, where they
      // persist and offer the retry path. ---
      const history = page.getByRole("log", { name: /chat history/i });
      await expect(history).toContainText(
        /encountered an error processing your request/i,
        { timeout: 15_000 },
      );
      await expect(history.getByRole("button", { name: /retry/i })).toBeVisible();

      // No toast may appear for this failure: the settle window covers any
      // late toast mount, and the Toaster itself is rendered by MainApp, so
      // an absent [data-sonner-toast] is a real negative, not a missing
      // container.
      await page.waitForTimeout(1_500);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

      // The rejection the UI chain received must be the WebGPU capability
      // error itself — proving the generic conversation error was the
      // capability guard failing closed, not a RAG/memory pre-step.
      const rejections = await page.evaluate(() => {
        const w = window as unknown as {
          __streamRejections: { ok: boolean; error?: string }[];
        };
        return w.__streamRejections;
      });
      expect(rejections.length, "exactly one streaming attempt").toBe(1);
      expect(rejections[0]?.error).toMatch(/WebGPU is not supported/i);

      // --- 5. The failure was the capability guard, end to end: the real
      // UI chain must never have touched the engine or leaked a request. ---
      const post = await readWebLLMState(page);
      expect(
        post.initCalls,
        "WebLLM init() must never be invoked from the Chat UI path",
      ).toBe(0);
      expect(post.initializationCount).toBe(0);
      expect(post.generationCount).toBe(0);
      expect(post.engineReady, "engine must remain null").toBe(false);
      expect(
        net.hf,
        "no WebLLM model download may be attempted (HuggingFace)",
      ).toBe(0);
      expect(
        net.cdn,
        "no MLC wasm/runtime fetch may be attempted (jsDelivr)",
      ).toBe(0);
      expect(
        net.cloud,
        "the failed chat request must never reach a cloud AI endpoint",
      ).toBe(0);
      expect(
        crashes.pageErrors,
        "the capability failure must be handled, not crash the page",
      ).toEqual([]);
    },
  );
});

test.describe("editor-focus warmup on a GPU-less device (real UI wiring)", () => {
  test(
    "focusing the editor triggers guarded warmup and the capability guard skips init",
    async ({ page }) => {
      const net = await installNetworkObservers(page);
      const crashes = installCrashDetector(page);
      await emulateDevice(page, "no-webgpu");

      // --- 1. Boot into the unlocked shell. ---
      await skipPassword(page);
      await instrumentWebLLMInit(page);
      const baseline = await readWebLLMState(page);

      // --- 2. Instrument aiManager.warmup — the REAL handler's callee — so
      // the test can prove the focus→warmup chain actually fired. Without
      // this, "init never called" would also pass on a wiring regression
      // where the focus handler never runs at all (a vacuous pass). ---
      await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        const w = window as unknown as { __warmupCalls: number };
        w.__warmupCalls = 0;
        const orig = aiManager.warmup.bind(aiManager);
        aiManager.warmup = async () => {
          w.__warmupCalls += 1;
          return orig();
        };
      });

      // --- 3. Create a document through the real UI: the Documents tab's
      // new-document flow switches to the editor with a fresh document. ---
      await page.locator('[data-tab-id="documents"]').click();
      await page.getByTestId("new-document-button").click();
      // Production BlockNote exposes no custom testid: the editable surface
      // is its standard .bn-editor contenteditable (inside the wrapper div
      // that carries the production onFocus).
      const editorArea = page.locator(".bn-editor");
      await expect(editorArea).toBeVisible({ timeout: 15_000 });

      // --- 4. Focus the editor like a user (click into the editable area —
      // the resulting native focus propagates to the wrapper carrying the
      // production onFocus), then fire extra bubbling focusin events (React
      // maps onFocus to focusin): the one-shot handler must still produce
      // exactly ONE warmup. ---
      await editorArea.click();
      for (let i = 0; i < 2; i++) {
        await editorArea.evaluate((el) => {
          el.dispatchEvent(
            new FocusEvent("focusin", { bubbles: true }),
          );
        });
      }

      // --- 5. The focus→warmup chain fired exactly once (one-shot per
      // editor instance), and the capability guard skipped the engine: no
      // init attempt, no metrics, no downloads, no crash. ---
      await expect
        .poll(() =>
          page.evaluate(() => {
            const w = window as unknown as { __warmupCalls: number };
            return w.__warmupCalls ?? 0;
          }),
        )
        .toBe(1);

      const post = await readWebLLMState(page);
      expect(
        post.warmupCalls,
        "the real editor-focus wiring must call aiManager.warmup exactly once",
      ).toBe(1);
      expect(
        post.initCalls,
        "the capability guard must skip WebLLM init on a GPU-less device",
      ).toBe(0);
      expect(
        post.initializationCount - baseline.initializationCount,
        "no engine initialization may be recorded",
      ).toBe(0);
      expect(
        post.errorCount - baseline.errorCount,
        "no init error may be produced",
      ).toBe(0);
      expect(post.generationCount).toBe(0);
      expect(post.engineReady, "engine must remain null").toBe(false);
      expect(post.canRunLocalLLM).toBe(false);
      expect(
        net.hf,
        "no WebLLM model download may be attempted (HuggingFace)",
      ).toBe(0);
      expect(
        net.cdn,
        "no MLC wasm/runtime fetch may be attempted (jsDelivr)",
      ).toBe(0);
      expect(net.cloud, "no cloud AI endpoint may be reached").toBe(0);
      expect(
        crashes.pageErrors,
        "no uncaught page error may escape the guarded warmup path",
      ).toEqual([]);

      // The editor itself stays healthy: the guarded skip must be silent.
      await expect(editorArea).toBeVisible();
    },
  );
});

test.describe("editor-focus preload on a capable device (real UI wiring)", () => {
  test(
    "editor focus preloads the WebLLM model exactly once — repeat focuses cause no extra init",
    async ({ page }) => {
      const net = await installNetworkObservers(page);
      const crashes = installCrashDetector(page);
      // Capable device: fully capable GPU adapter (shader-f16 present) +
      // 8 GB RAM + 8 cores — canRunLocalLLM() is TRUE through the REAL probe
      // chain (the same emulated shape profile E pins), so NO capability
      // stubbing is needed: the guard's PASS side runs for real. Setting
      // forge_test_mode BEFORE boot suppresses any boot-time opportunistic
      // warmup until the stub boundary below is installed.
      await emulateDevice(page, "low-ram", { forge_test_mode: "true" }, 8);

      // --- 1. Boot into the unlocked shell. ---
      await skipPassword(page);

      // --- 2. Install the local-AI stub boundary (ai-first-boot's contract:
      // the fake engine installer REPLACES init — the real init would fetch
      // multi-GB weights from the network this spec aborts — and clearing
      // forge_test_mode lets the FOCUS-triggered warmup below pass the
      // test-mode gate). The installer mirrors the real init's model-scoped
      // idempotency: a re-invocation while the fake model is installed
      // returns without reinstalling. ---
      await page.evaluate(async () => {
        localStorage.removeItem("forge_test_mode");
        const { webLLMService } = await import(
          "/src/services/ai/WebLLMService"
        );
        const svc = webLLMService as unknown as {
          init: (modelId?: string) => Promise<void>;
          progressListeners?: Set<(
            p: { text: string; progress: number },
          ) => void>;
          engine: unknown;
          currentModel: string;
          modelInstalledAt: number | null;
          __fakeInstalled?: boolean;
        };
        const emit = (p: { text: string; progress: number }): void => {
          for (const listener of svc.progressListeners ?? []) {
            try {
              listener(p);
            } catch {
              /* a broken listener must not stall the install */
            }
          }
        };
        const installFakeEngine = async (modelId?: string): Promise<void> => {
          if (svc.__fakeInstalled) {
            return;
          }
          for (const step of [
            { text: "Fetching model metadata…", progress: 0.1 },
            { text: "Downloading quantized weights…", progress: 0.5 },
            { text: "Loading model into GPU…", progress: 0.9 },
          ]) {
            emit(step);
            await new Promise((r) => setTimeout(r, 60));
          }
          svc.engine = {
            chat: {
              completions: {
                create: async () => ({
                  choices: [{
                    message: { content: "Preloaded model reply." },
                  }],
                  usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                  },
                }),
              },
            },
            unload: async () => {},
          };
          svc.currentModel =
            modelId || "Llama-3.2-3B-Instruct-q4f16_1-MLC";
          svc.modelInstalledAt = Date.now();
          svc.__fakeInstalled = true;
          emit({ text: "Model ready", progress: 1 });
        };
        svc.init = installFakeEngine;
        // Counts REAL engine builds (an idempotent skip never reaches the
        // installer): the resource-level "exactly once" across editor
        // remounts. Installed ON TOP of the plain installer BEFORE the
        // test's init-call counter wraps it, so the counters measure
        // different layers: invocations vs. actual installs.
        const w2 = window as unknown as { __fakeModelInstalls: number };
        w2.__fakeModelInstalls = 0;
        svc.init = async (modelId?: string) => {
          if (!svc.__fakeInstalled) {
            w2.__fakeModelInstalls += 1;
          }
          return installFakeEngine(modelId);
        };
      });
      // Instrument AFTER the stub replaces init, so the counter wraps the
      // STUB and counts every INVOCATION — an idempotent-but-invoked init
      // must still fail the exactly-once assertion below.
      await instrumentWebLLMInit(page);
      // Instrument aiManager.warmup — the REAL focus handler's callee — so
      // the chain focus→warmup→init is observable link by link (mirrors the
      // GPU-less counterpart; without this, a wiring regression that never
      // calls warmup would pass vacuously).
      await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        const w = window as unknown as { __warmupCalls: number };
        w.__warmupCalls = 0;
        const orig = aiManager.warmup.bind(aiManager);
        aiManager.warmup = async () => {
          w.__warmupCalls += 1;
          return orig();
        };
      });
      const baseline = await readWebLLMState(page);
      expect(
        baseline.canRunLocalLLM,
        "the stubbed-capable device must be runable through the REAL probe chain",
      ).toBe(true);
      expect(
        baseline.initCalls,
        "no init may run before the editor focus",
      ).toBe(0);
      expect(
        baseline.engineReady,
        "no engine may exist before the preload",
      ).toBe(false);

      // --- 3. Create a document through the real UI (same flow as the
      // GPU-less counterpart: Documents tab → new document → editor). ---
      await page.locator('[data-tab-id="documents"]').click();
      await page.getByTestId("new-document-button").click();
      const editorArea = page.locator(".bn-editor");
      await expect(editorArea).toBeVisible({ timeout: 15_000 });

      // --- 4. Focus the editor like a user, then fire REPEAT focus events:
      // two extra bubbling focusin in the same session (React maps onFocus
      // to focusin) AND a second genuine focus session (blur → refocus).
      // The one-shot focus handler must absorb all of them: exactly ONE
      // warmup, whose guarded init runs exactly once. ---
      await editorArea.click();
      for (let i = 0; i < 2; i++) {
        await editorArea.evaluate((el) => {
          el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        });
      }
      await editorArea.evaluate((el) => {
        (el as HTMLElement).blur();
      });
      await editorArea.click();

      // --- 5. The preload ran: exactly one warmup fired the guarded init
      // exactly once, and the engine is actually installed (positive
      // control — the preload WORKED, not merely didn't crash). ---
      await expect
        .poll(() =>
          page.evaluate(() => {
            const w = window as unknown as { __warmupCalls: number };
            return w.__warmupCalls ?? 0;
          }),
        )
        .toBe(1);
      await expect
        .poll(async () => (await readWebLLMState(page)).engineReady)
        .toBe(true);

      const post = await readWebLLMState(page);
      expect(
        post.initCalls,
        "the opportunistic preload must init the model exactly once — repeat focuses add no further init",
      ).toBe(1);
      expect(
        post.warmupCalls,
        "the one-shot editor-focus handler must fire warmup exactly once",
      ).toBe(1);
      expect(
        post.engineReady,
        "the preload must have installed the model",
      ).toBe(true);
      expect(
        post.errorCount - baseline.errorCount,
        "no init error may be produced",
      ).toBe(0);
      expect(
        post.generationCount - baseline.generationCount,
        "a preload is not a generation",
      ).toBe(0);
      expect(
        net.hf,
        "no real model download may be attempted (HuggingFace)",
      ).toBe(0);
      expect(
        net.cdn,
        "no MLC wasm/runtime fetch may be attempted (jsDelivr)",
      ).toBe(0);
      expect(net.cloud, "no cloud AI endpoint may be reached").toBe(0);
      expect(
        crashes.pageErrors,
        "no uncaught page error may escape the preload path",
      ).toEqual([]);

      // The editor itself stays healthy: the preload is invisible to typing.
      await expect(editorArea).toBeVisible();

      // --- 6. REMOUNT — the render-level wiring gap: the editor is a ROUTE
      // (/editor), so navigating to the Documents tab UNMOUNTS BlockEditor
      // and destroys hook instance #1 with its spent one-shot flag; creating
      // a second document REMOUNTS the editor with a FRESH instance. The
      // per-instance one-shot must RE-ARM (the render-level onFocus wiring
      // is alive on every mount, not a dead global installed once), while
      // the resource-level invariant holds across BOTH instances: the model
      // INSTALL still happened exactly once — warmup #2's init is the
      // model-scoped idempotent no-op (the engine already holds the
      // requested model), so no re-install, no second real initialization,
      // no second GPU acquisition. ---
      await page.locator('[data-tab-id="documents"]').click();
      await page.getByTestId("new-document-button").click();
      const remountedEditor = page.locator(".bn-editor");
      await expect(remountedEditor).toBeVisible({ timeout: 15_000 });

      await remountedEditor.click();

      await expect
        .poll(() =>
          page.evaluate(() => {
            const w = window as unknown as { __warmupCalls: number };
            return w.__warmupCalls ?? 0;
          }),
        )
        .toBe(2);

      const final = await readWebLLMState(page);
      expect(
        final.warmupCalls,
        "the SECOND editor instance must re-arm the focus handler — the render-level wiring is per-mount, not global",
      ).toBe(2);
      expect(
        final.initCalls,
        "warmup #2 invokes init again (one call per warmup is correct)",
      ).toBe(2);
      expect(
        final.initializationCount - post.initializationCount,
        "but NO second real initialization: model-scoped idempotency skips the already-loaded model (the metric counts real initializations, not invocations)",
      ).toBe(0);
      expect(
        final.engineReady,
        "the preloaded engine must be the one still serving",
      ).toBe(true);
      const fakeInstalls = await page.evaluate(() => {
        const w2 = window as unknown as { __fakeModelInstalls: number };
        return w2.__fakeModelInstalls ?? 0;
      });
      expect(
        fakeInstalls,
        "the model install must execute exactly once across editor remounts",
      ).toBe(1);
      expect(
        crashes.pageErrors,
        "no uncaught page error may escape the remount + preload path",
      ).toEqual([]);

      // The remounted editor is healthy too.
      await expect(remountedEditor).toBeVisible();
    },
  );
});

/**
 * The hard capability blockers get their own N-cycle measurement — one per
 * gate layer of assertCanRunLocalLLM(): the surface (no WebGPU), the
 * adapter precision (no shader-f16), and the RAM floor (3 GB < 4 GB). Each
 * profile fails a DIFFERENT gate layer, and the per-profile probe
 * assertions pin that layer so the savings cannot silently pass for the
 * wrong reason (the f16-less device must NOT be blocked at the surface
 * layer; the RAM-floor device must NOT be blocked at surface or f16 — its
 * GPU is FULLY capable, isolating the memory floor as the only blocker).
 * The counterfactual's per-init rejection is likewise pinned to each
 * layer's own message, so a future gate reordering that silently reroutes
 * the failure shows up as a mismatch, not as unchanged-looking savings.
 */
const MEASUREMENT_PROFILES = [
  {
    name: "GPU-less device (no WebGPU surface)",
    gpuKind: "no-webgpu" as const,
    // No surface → no adapter → f16 never probed. The SURFACE layer blocks.
    expectWebGPUSupported: false,
    expectF16Supported: false,
    deviceMemory: 8,
    expectedError: /WebGPU is not supported/i,
    // ResourceManager's defensive switch gate refuses BEFORE any resource
    // work on a surface-less device, so even the UNGUARDED counterfactual
    // no longer pays the RAG-unload/cooldown/flag-flip cost. The switch
    // layer itself is now part of the savings on this profile.
    counterfactualSwitchesPerCycle: 0,
    // No surface → isWebGPUSupported() returns false at the API check,
    // BEFORE requestAdapter is ever touched. Boot cost: zero requests.
    bootAdapterRequests: 0,
  },
  {
    name: "f16-less device (adapter without shader-f16)",
    gpuKind: "no-f16" as const,
    // The adapter EXISTS (surface layer passes); only the precision
    // feature is missing. The F16 layer must be the blocker.
    expectWebGPUSupported: true,
    expectF16Supported: false,
    deviceMemory: 8,
    expectedError: /shader-f16 \(half-precision\)/i,
    // The surface check passes, so the switch runs (RAG unload + cooldown
    // + flag flip) before initializeInternal's full capability gate throws
    // at the f16 layer — the counterfactual still pays the full cost.
    counterfactualSwitchesPerCycle: 1,
    // The one-time surface probe (high-performance, then low-power fallback
    // only if the first returns null — here the first succeeds) happens at
    // boot and is then cached for the session.
    bootAdapterRequests: 1,
  },
  {
    name: "RAM-floor device (fully capable GPU, only 3 GB)",
    gpuKind: "low-ram" as const,
    // Surface AND precision layers pass (shader-f16 present) — the GPU is
    // fully capable; ONLY the >= 4 GB memory floor blocks. This isolates
    // the RAM gate as the savings source and extends the measurement to
    // the third capability layer. The 8 GB tier check (isHighEndDevice)
    // plays no role anywhere in the warmup chain, so the 3 GB value cannot
    // confound the attribution.
    expectWebGPUSupported: true,
    expectF16Supported: true,
    deviceMemory: 3,
    expectedError:
      /Insufficient device memory for local AI models: 3 GB available, 4 GB required/i,
    // Surface present → ResourceManager's switch gate passes → the switch
    // completes (RAG unload + 2 s GC cooldown on this ≤8 GB device) before
    // the full capability gate throws at the RAM layer.
    counterfactualSwitchesPerCycle: 1,
    // Same single boot probe as the f16-less profile: the capable adapter
    // answers the high-performance request once and the verdict is cached.
    bootAdapterRequests: 1,
  },
];

for (const mp of MEASUREMENT_PROFILES) {
  test.describe(
    `warmup guard savings — ${mp.name} (N real unlock cycles)`,
    () => {
    test(
      "every real vault unlock fires the guarded warmup and avoids an init attempt; the unguarded path would cost one failed init per unlock",
      async ({ page }) => {
        // Instrumented lock→unlock cycles AFTER the initial setup unlock.
        const N_CYCLES = 2;

        // Network observers: belt-and-suspenders. Even without the guard, init()
        // would fail at the capability gate BEFORE any model fetch — the counters
        // below make the comparison airtight.
        const net = await installNetworkObservers(page);
        await emulateDevice(page, mp.gpuKind, {}, mp.deviceMemory);

        // First REAL unlock: setupVault drives the production flow
        // (SecurityManager → aiManager.unlockVault() → securityVault.unlock()
        // → the onUnlock listeners → warmup()). The wiring under test is the
        // same listener this unlock fires — no harness self-calls anywhere in
        // this test.
        await setupVault(page);

        // Instrument AFTER boot (the service singletons survive lock/unlock —
        // no page reload happens in between): count warmup() invocations of
        // ANY origin plus init() calls. The listener resolves this.warmup()
        // dynamically, so the wrapper intercepts listener-originated calls.
        await instrumentWebLLMInit(page);
        await page.evaluate(async () => {
          const { aiManager } = await import(
            "/src/services/ai/ProviderManager.ts"
          );
          const w = window as unknown as { __warmupCalls: number };
          w.__warmupCalls = 0;
          const orig = aiManager.warmup.bind(aiManager);
          aiManager.warmup = async () => {
            w.__warmupCalls += 1;
            return orig();
          };
        });
        // Also count GPU-resource acquisition: initializeInternal calls
        // resourceManager.switchToWebLLM() BEFORE the capability gate. On a
        // surface-less device ResourceManager's own defensive gate now
        // refuses the switch outright (zero cost); on a surface-present
        // device the switch still runs (RAG unload + 2 s GC cooldown on
        // ≤8 GB) before the full gate discovers the f16 gap. The wrapper
        // intercepts the shared singleton, so both the guarded path and the
        // counterfactual loop are measured.
        await page.evaluate(async () => {
          const { resourceManager } = await import(
            "/src/services/ai/ResourceManager.ts"
          );
          const mgr = resourceManager as unknown as {
            switchToWebLLM: () => Promise<void>;
          };
          const w = window as unknown as {
            __switchCalls: number;
            __switchRefusals: number;
          };
          w.__switchCalls = 0;
          w.__switchRefusals = 0;
          const origSwitch = mgr.switchToWebLLM.bind(mgr);
          mgr.switchToWebLLM = async () => {
            try {
              await origSwitch();
            } catch (e) {
              w.__switchRefusals += 1;
              throw e;
            }
            // Count only COMPLETED switches: a refused switch acquires and
            // destroys nothing (no RAG unload, no cooldown, no flag flip) —
            // that zero-cost outcome is precisely what the defensive gate
            // adds on surface-less devices.
            w.__switchCalls += 1;
          };
        });

        // Baseline: on a blocked device the boot-time probes leave zero
        // init/error metrics — the guard has already saved every opportunity
        // so far. Delta-based baselines keep the assertions robust.
        const baseline = await readWebLLMState(page);

        // The capability verdict must be a one-time boot cost: whatever
        // adapter requests the probe needed happened BEFORE this point, and
        // the cached answer serves everything afterwards.
        expect(
          baseline.adapterRequests,
          `${mp.name}: boot-time adapter requests must match the profile's one-time probe cost`,
        ).toBe(mp.bootAdapterRequests);

        // Pin WHICH capability layer blocks this profile before measuring:
        // the savings only mean something if the device is blocked at its
        // own hard gate (surface vs adapter precision), not by accident.
        const probed = await page.evaluate(async () => {
          const { webLLMService } = await import(
            "/src/services/ai/WebLLMService"
          );
          const s = await webLLMService.getHealthStatus();
          return {
            webGPUSupported: s.webGPUSupported,
            f16Supported: s.f16Supported,
          };
        });
        expect(
          probed.webGPUSupported,
          `${mp.name}: the WebGPU-surface layer must report exactly as expected`,
        ).toBe(mp.expectWebGPUSupported);
        expect(
          probed.f16Supported,
          `${mp.name}: the f16 layer must report exactly as expected`,
        ).toBe(mp.expectF16Supported);

        // N real lock→unlock cycles through the production UI. Each unlock
        // fires the onUnlock listener → guarded warmup. The guard must skip
        // init() on every one of them.
        for (let i = 0; i < N_CYCLES; i++) {
          await lockVault(page);
          await unlockVault(page);
        }

        const guarded = await readWebLLMState(page);
        expect(
          guarded.warmupCalls - baseline.warmupCalls,
          "each real unlock must fire the guarded warmup exactly once",
        ).toBe(N_CYCLES);
        expect(
          guarded.initCalls,
          "the guard must prevent EVERY init attempt across N unlocks",
        ).toBe(0);
        expect(
          guarded.initializationCount - baseline.initializationCount,
          "no engine initialization may be recorded across N unlocks",
        ).toBe(0);
        expect(
          guarded.errorCount - baseline.errorCount,
          "no init error may be produced across N unlocks",
        ).toBe(0);
        expect(guarded.engineReady, "engine must remain null").toBe(false);
        expect(guarded.generationCount).toBe(0);
        expect(
          guarded.switchCalls - baseline.switchCalls,
          "the guarded path must never complete a switch (no GPU resources acquired)",
        ).toBe(0);
        expect(
          guarded.switchRefusals - baseline.switchRefusals,
          "the guarded path must not even ATTEMPT a switch (init is never reached)",
        ).toBe(0);
        expect(
          guarded.adapterRequests - baseline.adapterRequests,
          "N real unlocks must cost ZERO adapter requests: the cached " +
            "canRunLocalLLM verdict is the only per-cycle work the warmup " +
            "chain performs on a blocked device",
        ).toBe(0);
        expect(
          net.hf,
          "no WebLLM model download may be attempted (HuggingFace)",
        ).toBe(0);
        expect(
          net.cdn,
          "no MLC wasm/runtime fetch may be attempted (jsDelivr)",
        ).toBe(0);
        expect(
          net.cloud,
          "no cloud AI endpoint may be reached during the measurement",
        ).toBe(0);

        // ── Counterfactual: what each unlock warmup WOULD have cost without
        // the guard. The pre-guard warmup called init() unconditionally; on
        // this blocked device init() fails fast at the capability gate but
        // still bumps initializationCount + errorCount AND pays the
        // GPU-resource switch (RAG unload + 2 s GC cooldown on ≤8 GB
        // profiles) before the gate throws. Measure that cost empirically.
        const counterfactualStart = guarded.initializationCount;
        const counterfactualSwitchStart = guarded.switchCalls;
        const counterfactualErrors: string[] = await page.evaluate(
          async (n) => {
            const { webLLMService } = await import(
              "/src/services/ai/WebLLMService"
            );
            const asError = (e: unknown) =>
              e instanceof Error ? e.message : String(e);
            const errors: string[] = [];
            for (let i = 0; i < n; i++) {
              await webLLMService.init().catch((e: unknown) => {
                // The expected fast-fail on this blocked device — collected
                // so each rejection can be pinned to THIS profile's own
                // capability layer.
                errors.push(asError(e));
              });
            }
            return errors;
          },
          N_CYCLES,
        );
        expect(
          counterfactualErrors.length,
          "every unguarded init must fail fast (no engine attempt anywhere)",
        ).toBe(N_CYCLES);
        for (const msg of counterfactualErrors) {
          expect(
            msg,
            `${mp.name}: the unguarded rejection must be THIS profile's own capability error`,
          ).toMatch(mp.expectedError);
        }

        const counterfactual = await readWebLLMState(page);
        expect(
          counterfactual.initializationCount - counterfactualStart,
          "each unguarded unlock warmup would have recorded an initialization attempt",
        ).toBe(N_CYCLES);
        expect(
          counterfactual.errorCount - guarded.errorCount,
          "each unguarded unlock warmup would have produced a WebGPU error to log/clean up",
        ).toBe(N_CYCLES);
        expect(
          counterfactual.initCalls - guarded.initCalls,
          "the pre-guard warmup would have called init() once per unlock",
        ).toBe(N_CYCLES);
        expect(
          counterfactual.switchCalls - counterfactualSwitchStart,
          mp.counterfactualSwitchesPerCycle === 0
            ? "on a surface-less device even the UNGUARDED init completes " +
              "zero switches: ResourceManager's defensive gate refuses " +
              "before any RAG unload, cooldown, or flag flip — a second " +
              "savings layer beyond the warmup capability gate"
            : "each unguarded init completes the GPU-resource switch (the " +
              "surface check passes on this profile, so switchToWebLLM runs " +
              "its RAG unload + 2 s GC cooldown + exclusive flag flip " +
              "before the f16 capability gate throws)",
        ).toBe(N_CYCLES * mp.counterfactualSwitchesPerCycle);
        if (mp.counterfactualSwitchesPerCycle === 0) {
          expect(
            counterfactual.switchRefusals - guarded.switchRefusals,
            "every unguarded switch attempt must be REFUSED by the " +
              "defensive gate on a surface-less device",
          ).toBe(N_CYCLES);
        }
        expect(
          counterfactual.canRunLocalLLM,
          "even after N forced init attempts the device still cannot run local LLM",
        ).toBe(false);
      },
    );
  },
);
}

test.describe("forced webllm across the S9 vault-lock boundary (capable device)", () => {
  const LOCAL_REPLY = "Local model summary while vault is locked.";

  test(
    "local generation works while the vault is LOCKED and cloud streaming is refused — with zero cloud contact",
    async ({ page }) => {
      // Capable device: capable GPU (shader-f16) + 8 GB — the OPPOSITE of
      // every blocked profile above, isolating vault state (not capability)
      // as the variable this scenario exercises.
      await emulateDevice(page, "low-ram", { selected_ai_provider: "webllm" }, 8);

      // Network observers: the cloud counter is the S9 privacy detector —
      // nothing may reach api.openai.com while locked (or unlocked here).
      const net = await installNetworkObservers(page);

      // --- 1. Boot + real vault setup through the production UI (the same
      // unlock fires the guarded warmup; test mode is NOT set, but the
      // capable device's init is stubbed below only AFTER unlock — the
      // boot-time warmup fires against a cached-false-free capable probe and
      // the empty-engine init is the same stubbed boundary ai-first-boot
      // pins; abort-routes keep any real fetch from escaping). ---
      await setupVault(page);
      await seedProEntitlement(page);

      // --- 2. Install the local-AI stub in the live session (same boundary
      // as ai-first-boot): init() simulates the progressive install and
      // seeds a fake engine whose non-stream create() and stream:true
      // create() both answer locally — while the REAL
      // generateWithWebLLM/streamGenerateText run around it. Also pin the
      // RAG/memory pre-steps so the local call under test is the only
      // thing that can fail. ---
      await page.evaluate(async (reply) => {
        localStorage.removeItem("forge_test_mode");
        const { webLLMService } = await import(
          "/src/services/ai/WebLLMService"
        );
        const svc = webLLMService as unknown as {
          init: (modelId?: string) => Promise<void>;
          canRunLocalLLM: () => Promise<boolean>;
          isWebGPUSupported: () => Promise<boolean>;
          f16Supported: boolean;
          progressListeners?: Set<(p: { text: string; progress: number }) => void>;
          engine: unknown;
          currentModel: string;
          modelInstalledAt: number | null;
        };
        svc.isWebGPUSupported = async () => true;
        svc.canRunLocalLLM = async () => true;
        svc.f16Supported = true;
        svc.init = async (modelId?: string) => {
          const steps = [
            { text: "Fetching model metadata…", progress: 0.1 },
            { text: "Downloading quantized weights…", progress: 0.5 },
            { text: "Loading model into GPU…", progress: 0.9 },
          ];
          const emit = (p: { text: string; progress: number }): void => {
            for (const listener of svc.progressListeners ?? []) {
              try {
                listener(p);
              } catch {
                /* a broken listener must not stall the install */
              }
            }
          };
          for (const step of steps) {
            emit(step);
            await new Promise((r) => setTimeout(r, 60));
          }
          svc.engine = {
            chat: {
              completions: {
                create: async ({ stream }: { stream?: boolean }) =>
                  stream
                    ? (async function* () {
                        for (const piece of ["Local ", "model ", "reply."]) {
                          yield {
                            choices: [{ delta: { content: piece } }],
                          };
                        }
                      })()
                    : {
                        choices: [
                          { message: { content: reply } },
                        ],
                        usage: {
                          prompt_tokens: 1,
                          completion_tokens: 1,
                          total_tokens: 2,
                        },
                      },
              },
            },
            unload: async () => {},
          };
          svc.currentModel = modelId || "Llama-3.2-1B-Instruct-q4f16_1-MLC";
          svc.modelInstalledAt = Date.now();
          emit({ text: "Model ready", progress: 1 });
        };
        // Seed the fake engine immediately (same as ai-first-boot's explicit
        // init call): the stub REPLACES init, so without invoking it the
        // engine stays null and generation dies with the engine-state error.
        await svc.init();
        // RAG/memory pre-steps are orthogonal: pin to no-ops so the local
        // generation under test is the only thing that can fail.
        const { globalRAGService } = await import(
          "/src/services/ai/GlobalRAGService"
        );
        globalRAGService.searchContext = async () => [];
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
        mem.getOrCreateSession = async () => "e2e-s9-memory-session";
        mem.getContextForQuery = async () => "";
        mem.addMessage = async () => "e2e-s9-memory-message";
      }, LOCAL_REPLY);

      // Sanity while UNLOCKED: the forced webllm + stubbed engine answers.
      const unlocked = await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        try {
          const res = await aiManager.generateText("Unlocked prompt", undefined, {
            isPrivate: false,
          });
          return { ok: true as const, provider: res.provider };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      });
      expect(unlocked.ok, `local generation must work while unlocked: ${JSON.stringify(unlocked)}`).toBe(true);
      if (unlocked.ok) {
        expect(unlocked.provider).toBe("webllm");
      }

      // --- 3. Lock the vault through the REAL UI. ---
      await lockVault(page);

      // --- 4. THE CORE ASSERTION: local generation still works while
      // LOCKED. webllm is the selected provider (selection authority), the
      // lock clears caches but not the loaded local model, and S9 excludes
      // local providers from its guard — so the same call that failed on
      // every blocked profile must SUCCEED here. ---
      const lockedLocal = await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        const { securityVault } = await import(
          "/src/services/SecurityVault.ts"
        );
        try {
          const res = await aiManager.generateText("Locked prompt", undefined, {
            isPrivate: false,
          });
          return {
            ok: true as const,
            provider: res.provider,
            vaultLocked: securityVault.isLocked(),
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            vaultLocked: securityVault.isLocked(),
          };
        }
      });
      expect(
        lockedLocal.vaultLocked,
        "the vault must actually be locked during the local call",
      ).toBe(true);
      expect(
        lockedLocal.ok,
        `local WebLLM generation must work while the vault is LOCKED: ${JSON.stringify(lockedLocal)}`,
      ).toBe(true);
      if (lockedLocal.ok) {
        expect(lockedLocal.provider).toBe("webllm");
      }

      // --- 5. "Cloud streaming is refused while locked" — verified at the
      // layer where the refusal actually lives for this configuration.
      // With webllm SELECTED, the selection-authority contract makes a cloud
      // resolution structurally impossible, and S9's guard exempts local
      // providers by design — so a stream request while locked must resolve
      // to WEBLLM and run locally (single-chunk delivery, the explicit
      // webllm stream case), never reaching a cloud endpoint. The S9 THROW
      // itself for a RESOLVED cloud provider ("Cloud AI is unavailable while
      // the Security Vault is locked") is pinned in vault-lock-ai-guard and
      // vault-auto-lock-s9-guard, which configure cloud selections; this
      // scenario pins the stronger guarantee that makes the throw
      // unreachable here: the resolver refuses to resolve cloud at all. ---
      const resolvedWhileLocked = await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        // resolveProvider is private — the same deliberate white-box access
        // the unit suite uses for routing contracts.
        const info = await (aiManager as any).resolveProvider({
          isPrivate: false,
          complexity: "complex",
        });
        return { provider: info.provider as string };
      });
      expect(
        resolvedWhileLocked.provider,
        "while locked AND webllm-selected, the resolver must still resolve to " +
          "webllm — a cloud resolution is structurally impossible, which is " +
          "what refuses cloud streaming in this configuration",
      ).toBe("webllm");

      const lockedStream = await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        const chunks: string[] = [];
        try {
          const res = await aiManager.streamGenerateText(
            "Locked stream prompt",
            undefined,
            { complexity: "complex", isPrivate: false },
            (chunk: string) => chunks.push(chunk),
          );
          return {
            ok: true as const,
            provider: res.provider,
            text: res.text ?? chunks.join(""),
            chunks: chunks.length,
          };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            provider: "",
            text: "",
            chunks: chunks.length,
          };
        }
      });
      expect(
        lockedStream.ok,
        `LOCAL streaming must work while locked (S9 exempts local providers): ${JSON.stringify(lockedStream)}`,
      ).toBe(true);
      if (lockedStream.ok) {
        expect(lockedStream.provider).toBe("webllm");
        expect(lockedStream.text).toContain(LOCAL_REPLY);
        expect(
          lockedStream.chunks,
          "webllm streams deliver the full text as exactly ONE chunk",
        ).toBe(1);
      }

      // --- 6. S9 privacy invariants while locked: no cloud endpoint was
      // contacted, and the decrypted key is gone from memory. ---
      const s9 = await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        const { securityVault } = await import(
          "/src/services/SecurityVault.ts"
        );
        return {
          apiKey: aiManager.getApiKey(),
          vaultLocked: securityVault.isLocked(),
        };
      });
      expect(s9.apiKey, "the decrypted key must not survive the lock").toBeNull();
      expect(s9.vaultLocked).toBe(true);
      expect(
        net.cloud,
        "no cloud AI endpoint may be contacted across the whole scenario",
      ).toBe(0);

      // --- 7. Unlock again: the same local call keeps working — the lock
      // never degraded local state. ---
      await unlockVault(page);
      const reUnlocked = await page.evaluate(async () => {
        const { aiManager } = await import(
          "/src/services/ai/ProviderManager.ts"
        );
        try {
          const res = await aiManager.generateText("Re-unlocked prompt", undefined, {
            isPrivate: false,
          });
          return { ok: true as const, provider: res.provider };
        } catch (e) {
          return {
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      });
      expect(reUnlocked.ok).toBe(true);
      if (reUnlocked.ok) {
        expect(reUnlocked.provider).toBe("webllm");
      }
    },
  );
});