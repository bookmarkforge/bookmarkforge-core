import { describe, it, expect, vi, afterEach } from "vitest";
import {
  checkIndexedDB,
  checkNetwork,
  checkOllama,
  checkWebGPU,
  checkWebLLM,
  checkWebRTC,
  formatBytes,
  getStorageEstimate,
} from "../../services/SupportDiagnostics";

const mockAiManager = {
  isOllamaAvailable: vi.fn(),
  getOllamaSettings: vi.fn(),
};
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: mockAiManager,
}));

const mockWebLLMService = {
  getCapabilityBlocker: vi.fn(),
  canRunLocalLLM: vi.fn(),
  isModelLoaded: vi.fn(),
  getCurrentModel: vi.fn(),
  init: vi.fn(),
};
vi.mock("../../services/pro-access", () => ({
  // WebLLMService is Pro: the double is installed at the pro-access loader
  // instead of at the Pro module (checkWebLLM probes through the gate).
  loadWebLLMService: () => Promise.resolve(mockWebLLMService),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

describe("SupportDiagnostics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    // Remove own properties we may have defined on navigator.
    delete (navigator as unknown as Record<string, unknown>).storage;
    delete (navigator as unknown as Record<string, unknown>).gpu;
    delete (navigator as unknown as Record<string, unknown>).connection;
  });

  describe("formatBytes", () => {
    it("formats bytes, KB, MB and GB", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(1073741824)).toBe("1 GB");
    });

    it("handles invalid input defensively", () => {
      expect(formatBytes(-5)).toBe("0 B");
      expect(formatBytes(Number.NaN)).toBe("0 B");
    });
  });

  describe("checkIndexedDB", () => {
    it("resolves true after a real write/read round-trip", async () => {
      await expect(checkIndexedDB()).resolves.toBe(true);
    });

    it("resolves false when IndexedDB is not available", async () => {
      vi.stubGlobal("indexedDB", undefined);
      await expect(checkIndexedDB()).resolves.toBe(false);
    });
  });

  describe("getStorageEstimate", () => {
    it("returns null when navigator.storage is not exposed", async () => {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: undefined,
      });
      await expect(getStorageEstimate()).resolves.toBeNull();
    });

    it("returns usage and quota from the Storage API", async () => {
      const estimate = vi
        .fn()
        .mockResolvedValue({ usage: 2048, quota: 1048576 });
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: { estimate },
      });
      await expect(getStorageEstimate()).resolves.toEqual({
        usageBytes: 2048,
        quotaBytes: 1048576,
      });
      expect(estimate).toHaveBeenCalled();
    });

    it("returns null when estimate rejects", async () => {
      const estimate = vi.fn().mockRejectedValue(new Error("storage denied"));
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: { estimate },
      });
      await expect(getStorageEstimate()).resolves.toBeNull();
    });
  });

  describe("checkWebRTC", () => {
    it("reports unavailable when RTCPeerConnection is missing", async () => {
      vi.stubGlobal("RTCPeerConnection", undefined);
      await expect(checkWebRTC()).resolves.toEqual({
        status: "unavailable",
        elapsedMs: null,
      });
    });

    it("reports ok with elapsed time when ICE gathering completes", async () => {
      class MockRTCPeerConnection {
        iceGatheringState = "gathering";
        iceConnectionState = "new";
        onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
        onicegatheringstatechange: (() => void) | null = null;
        oniceconnectionstatechange: (() => void) | null = null;
        createDataChannel() {}
        close() {}
        createOffer() {
          return Promise.resolve({ type: "offer", sdp: "" });
        }
        setLocalDescription() {
          queueMicrotask(() => {
            this.iceGatheringState = "complete";
            this.onicegatheringstatechange?.();
          });
          return Promise.resolve();
        }
      }
      vi.stubGlobal("RTCPeerConnection", MockRTCPeerConnection);

      const result = await checkWebRTC();
      expect(result.status).toBe("ok");
      expect(typeof result.elapsedMs).toBe("number");
    });

    it("reports failed when gathering times out", async () => {
      class MockRTCPeerConnection {
        iceGatheringState = "gathering";
        iceConnectionState = "new";
        onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
        onicegatheringstatechange: (() => void) | null = null;
        oniceconnectionstatechange: (() => void) | null = null;
        createDataChannel() {}
        close() {}
        createOffer() {
          return Promise.resolve({ type: "offer", sdp: "" });
        }
        setLocalDescription() {
          return Promise.resolve();
        }
      }
      vi.stubGlobal("RTCPeerConnection", MockRTCPeerConnection);
      vi.useFakeTimers();
      try {
        const promise = checkWebRTC(1000);
        await vi.advanceTimersByTimeAsync(1500);
        await expect(promise).resolves.toEqual({
          status: "failed",
          elapsedMs: null,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("checkWebGPU", () => {
    it("returns false when navigator.gpu is missing", async () => {
      await expect(checkWebGPU()).resolves.toBe(false);
    });

    it("returns true when an adapter is available", async () => {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      await expect(checkWebGPU()).resolves.toBe(true);
    });

    it("returns false when no adapter is available", async () => {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: { requestAdapter: vi.fn().mockResolvedValue(null) },
      });
      await expect(checkWebGPU()).resolves.toBe(false);
    });
  });

  describe("checkNetwork", () => {
    it("reports online with effectiveType and saveData from the Network API", () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        connection: { effectiveType: "4g", saveData: false },
      });
      expect(checkNetwork()).toEqual({
        online: true,
        effectiveType: "4g",
        saveData: false,
      });
    });

    it("reports offline when navigator.onLine is false", () => {
      vi.stubGlobal("navigator", { onLine: false });
      expect(checkNetwork()).toEqual({ online: false });
    });

    it("omits connection fields when the Network API is absent", () => {
      vi.stubGlobal("navigator", { onLine: true });
      expect(checkNetwork()).toEqual({ online: true });
    });
  });

  describe("checkOllama", () => {
    it("returns available status with url and model", async () => {
      mockAiManager.isOllamaAvailable.mockResolvedValue(true);
      mockAiManager.getOllamaSettings.mockReturnValue({
        url: "http://localhost:11434/api/generate",
        model: "llama3.2",
      });
      await expect(checkOllama()).resolves.toEqual({
        available: true,
        url: "http://localhost:11434/api/generate",
        model: "llama3.2",
      });
    });

    it("returns unavailable when the probe rejects", async () => {
      mockAiManager.isOllamaAvailable.mockRejectedValue(
        new Error("connection refused"),
      );
      await expect(checkOllama()).resolves.toEqual({ available: false });
    });
  });

  describe("checkWebLLM", () => {
    it("returns canRun=true and no blocker key on a capable device", async () => {
      mockWebLLMService.getCapabilityBlocker.mockResolvedValue(null);
      mockWebLLMService.isModelLoaded.mockReturnValue(true);
      mockWebLLMService.getCurrentModel.mockReturnValue("llama3.2");
      await expect(checkWebLLM()).resolves.toEqual({
        canRun: true,
        modelLoaded: true,
        currentModel: "llama3.2",
      });
      // `canRun` is DERIVED from the blocker (null = capable): the enum from
      // getCapabilityBlocker() is the single capability verdict, so the
      // support view's "why" and the boolean can never disagree. A capable
      // status must not carry a blocker key at all (absent, not null).
      const status = await checkWebLLM();
      expect(status).not.toHaveProperty("blocker");
    });

    it("reports not-loaded when no model is in memory", async () => {
      mockWebLLMService.getCapabilityBlocker.mockResolvedValue(null);
      mockWebLLMService.isModelLoaded.mockReturnValue(false);
      mockWebLLMService.getCurrentModel.mockReturnValue("");
      await expect(checkWebLLM()).resolves.toEqual({
        canRun: true,
        modelLoaded: false,
        currentModel: undefined,
      });
    });

    it("surfaces the precise blocker enum when the device is blocked", async () => {
      // One representative of the ladder at this layer — the enum's own
      // ordering/values are pinned in the WebLLMService suites, and the
      // enum -> user message mapping is pinned in the SupportChat tests.
      mockWebLLMService.getCapabilityBlocker.mockResolvedValue(
        "insufficient-memory",
      );
      mockWebLLMService.isModelLoaded.mockReturnValue(false);
      mockWebLLMService.getCurrentModel.mockReturnValue("");
      await expect(checkWebLLM()).resolves.toEqual({
        canRun: false,
        modelLoaded: false,
        blocker: "insufficient-memory",
      });
    });

    it("returns canRun=false WITHOUT a blocker when the probe itself rejects", async () => {
      // A rejected probe produces no verdict of any kind, so no blocker may
      // be reported — the UI falls back to the generic message instead of
      // naming a cause it does not know.
      mockWebLLMService.getCapabilityBlocker.mockRejectedValue(
        new Error("webgpu context lost"),
      );
      const status = await checkWebLLM();
      expect(status).toEqual({ canRun: false, modelLoaded: false });
      expect(status).not.toHaveProperty("blocker");
    });

    it("gates on getCapabilityBlocker() and never inits the engine", async () => {
      // The diagnostics hint path (StartupAIHint) must read readiness through
      // the strict capability ladder and must NEVER start the engine itself —
      // init() belongs exclusively to ProviderManager.warmup() (guarded) and
      // to WebLLMService's own user-confirmed retry. canRunLocalLLM() is
      // deliberately NOT consulted anymore: the blocker enum replaced it as
      // the verdict source (same cache underneath, strictly more info).
      mockWebLLMService.getCapabilityBlocker.mockResolvedValue(null);
      mockWebLLMService.isModelLoaded.mockReturnValue(false);
      mockWebLLMService.getCurrentModel.mockReturnValue("");
      await checkWebLLM();

      expect(mockWebLLMService.getCapabilityBlocker).toHaveBeenCalledTimes(1);
      expect(mockWebLLMService.canRunLocalLLM).not.toHaveBeenCalled();
      expect(mockWebLLMService.init).not.toHaveBeenCalled();
    });
  });
});
