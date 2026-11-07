import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { hardwareDetector } =
  await import("../../services/HardwareDetectorService");
// We need the class to instantiate and clear the cache
// Since the class is not exported, we use a dynamic-import strategy
let HardwareDetectorServiceClass: any;
let service: any;

describe("HardwareDetectorService", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    // Create a fresh instance for each test
    vi.resetModules();
    // Reimport to get an instance without a cache
    const mod = await import("../../services/HardwareDetectorService");
    HardwareDetectorServiceClass =
      (mod as any).hardwareDetector?.constructor ||
      Object.getPrototypeOf(mod.hardwareDetector).constructor;
    // We cannot easily reset the cache: a new instance must be created
    // We reassign cachedInfo to null via vi.spyOn
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("getDeviceMemory", () => {
    it("returns navigator.deviceMemory when available", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.memory).toBe(16);
    });

    it("returns 4GB as fallback if deviceMemory is not available", async () => {
      // Simulate a browser without deviceMemory (Safari/Firefox)
      const navSinMemory: any = {
        ...navigator,
        hardwareConcurrency: 4,
        gpu: undefined,
      };
      delete navSinMemory.deviceMemory;
      vi.stubGlobal("navigator", navSinMemory);

      // We need an instance with a clean cache
      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.memory).toBe(4);
    });

    it("returns deviceMemory 0 as 4GB (falsy)", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 0,
        hardwareConcurrency: 4,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.memory).toBe(4);
    });
  });

  describe("getHardwareConcurrency", () => {
    it("returns navigator.hardwareConcurrency", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 8,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.concurrency).toBe(8);
    });

    it("returns 4 as fallback if hardwareConcurrency is 0", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 0,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.concurrency).toBe(4);
    });
  });

  describe("determineTier", () => {
    it("memoria < 8GB → low-end", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 4,
        hardwareConcurrency: 4,
        gpu: undefined,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.tier).toBe("low-end");
    });

    it("concurrency < 4 → low-end", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 2,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      // Mock canvas.getContext for webgl
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: class {},
      });
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.tier).toBe("low-end");
    });

    it("sin WebGPU → low-end", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
        gpu: undefined,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.tier).toBe("low-end");
    });

    it("8GB RAM + 8 cores + WebGPU → mid-range", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: class {},
      });
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.tier).toBe("mid-range");
    });

    it(">= 16GB RAM + >= 8 cores + WebGPU → high-end", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: class {},
      });
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.tier).toBe("high-end");
    });

    it("32GB + 16 cores + WebGPU → high-end", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 32,
        hardwareConcurrency: 16,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: class {},
      });
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.tier).toBe("high-end");
    });
  });

  describe("checkWebGLSupport", () => {
    it("returns true when WebGL is available", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: undefined,
      });
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: class {},
      });
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({});

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webglSupported).toBe(true);
    });

    it("returns false when WebGL is not available", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: undefined,
      });
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: undefined,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webglSupported).toBe(false);
    });

    it("returns false when canvas.getContext fails", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: undefined,
      });
      vi.stubGlobal("window", {
        ...window,
        WebGLRenderingContext: class {},
      });
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webglSupported).toBe(false);
    });
  });

  describe("checkWebGPUSupport", () => {
    it("returns true when navigator.gpu exists and requestAdapter succeeds", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webgpuSupported).toBe(true);
    });

    it("returns false when navigator.gpu does not exist", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webgpuSupported).toBe(false);
    });

    it("returns false if requestAdapter fails", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: {
          requestAdapter: vi.fn().mockRejectedValue(new Error("no adapter")),
        },
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webgpuSupported).toBe(false);
    });

    it("returns false if requestAdapter returns null", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
      });

      const mod = await import("../../services/HardwareDetectorService");
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(info.webgpuSupported).toBe(false);
    });
  });

  describe("Caching", () => {
    it("second call returns the same cached info", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: undefined,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const primera = await mod.hardwareDetector.getHardwareInfo();
      const segunda = await mod.hardwareDetector.getHardwareInfo();
      expect(primera).toBe(segunda);
    });

    it("getDeviceTier returns the same tier as getHardwareInfo", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: undefined,
      });

      const mod = await import("../../services/HardwareDetectorService");
      const tier = await mod.hardwareDetector.getDeviceTier();
      const info = await mod.hardwareDetector.getHardwareInfo();
      expect(tier).toBe(info.tier);
    });
  });

  describe("cache reset on environment change", () => {
    it("re-probes and upgrades the tier when navigator.gpu appears after the first probe", async () => {
      // Boot without a GPU surface (e.g. the GPU stack is still initializing
      // after boot in embedded/E2E environments): the first probe caches
      // webgpuSupported=false, which forces the low-end tier even at 16 GB.
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
        gpu: undefined,
      });
      const mod = await import("../../services/HardwareDetectorService");
      const before = await mod.hardwareDetector.getHardwareInfo();
      expect(before.webgpuSupported).toBe(false);
      expect(before.tier).toBe("low-end");

      // The GPU API appears later. Without reset() the cached profile would
      // be served forever; with it, the next probe re-classifies.
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      mod.hardwareDetector.reset();

      const after = await mod.hardwareDetector.getHardwareInfo();
      expect(after.webgpuSupported).toBe(true);
      expect(after.tier).toBe("high-end");
      // Genuinely re-probed: a NEW profile object, not the stale cached one.
      expect(after).not.toBe(before);
    });

    it("keeps serving the stale cached profile when reset() is NOT called", async () => {
      // The negative half of the contract: the cache deliberately wins
      // until reset() is invoked — the reset seam is the ONLY way a later
      // GPU appearance becomes visible to tier classification.
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
        gpu: undefined,
      });
      const mod = await import("../../services/HardwareDetectorService");
      const before = await mod.hardwareDetector.getHardwareInfo();
      expect(before.webgpuSupported).toBe(false);

      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 16,
        hardwareConcurrency: 8,
        gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      });
      const after = await mod.hardwareDetector.getHardwareInfo();
      expect(after.webgpuSupported).toBe(false);
      expect(after).toBe(before);
    });
  });

  describe("hardwareDetector singleton", () => {
    it("exports and works", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        deviceMemory: 8,
        hardwareConcurrency: 4,
        gpu: undefined,
      });

      const mod = await import("../../services/HardwareDetectorService");
      expect(mod.hardwareDetector).toBeDefined();
      expect(typeof mod.hardwareDetector.getHardwareInfo).toBe("function");
    });
  });
});
