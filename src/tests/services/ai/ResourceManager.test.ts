
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../../db/database", () => ({
  getDB: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (ResourceManager unloads through the gate).
// The double is hoisted so the loader and the assertions observe the SAME
// object — returning a fresh `{ unload: vi.fn() }` per call would leave every
// `expect(...).toHaveBeenCalled()` looking at a spy nothing ever touched.
const mockWebLLMService = vi.hoisted(() => ({
  unload: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../services/pro-access", () => ({
  loadWebLLMService: async () => mockWebLLMService,
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

vi.mock("../../../services/ai/RAGEngine", () => ({
  ragEngine: {
    unload: vi.fn().mockResolvedValue(undefined),
  },
}));

import { getDB } from "../../../db/database";
import { logger } from "../../../utils/logger";
import { ragEngine } from "../../../services/ai/RAGEngine";

const mockNavigator = (overrides: Record<string, unknown> = {}) => {
  const base = {
    onLine: true,
    hardwareConcurrency: 4,
    deviceMemory: 4,
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { ...base, ...overrides },
    writable: true,
    configurable: true,
  });
};

const mockPerformance = (memory?: {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}) => {
  Object.defineProperty(globalThis, "performance", {
    value: {
      memory: memory || undefined,
    },
    writable: true,
    configurable: true,
  });
};

const createResourceManager = async () => {
  vi.resetModules();
  const mod = await import("../../../services/ai/ResourceManager");
  return mod.resourceManager;
};

describe("ResourceManager", () => {
  let resourceManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockNavigator({ deviceMemory: 8, hardwareConcurrency: 8 });
    mockPerformance();
    resourceManager = await createResourceManager();
    (resourceManager as any).activeComponent = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("isHighEndDevice", () => {
    it("returns true if the device has >= 8GB RAM and >= 4 cores", () => {
      mockNavigator({ deviceMemory: 8, hardwareConcurrency: 8 });
      expect(resourceManager.isHighEndDevice()).toBe(true);
    });

    it("returns true on a device WITHOUT WebGPU — it is deliberately a RAM/CPU-only check", () => {
      // Contract pin: isHighEndDevice() knows nothing about GPU availability.
      // A high-end RAM/CPU tier on a GPU-less machine still qualifies as
      // "high-end"; the WebGPU/f16 gate is canRunLocalLLM()'s job, and every
      // production caller pairs this check with it before running WebLLM.
      mockNavigator({
        deviceMemory: 16,
        hardwareConcurrency: 16,
        gpu: undefined,
      });
      expect(resourceManager.isHighEndDevice()).toBe(true);
    });

    it("returns false if RAM < 8GB", () => {
      mockNavigator({ deviceMemory: 4, hardwareConcurrency: 8 });
      expect(resourceManager.isHighEndDevice()).toBe(false);
    });

    it("returns false if cores < 4", () => {
      mockNavigator({ deviceMemory: 16, hardwareConcurrency: 2 });
      expect(resourceManager.isHighEndDevice()).toBe(false);
    });

    it("uses 4GB/4cores default when navigator does not report", () => {
      mockNavigator({});
      expect(resourceManager.isHighEndDevice()).toBe(false);
    });
  });

  describe("getHFModelStatus", () => {
    it("returns empty array if caches are not available", async () => {
      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([]);
    });

    it("P88: uses Content-Length without materializing the body (no blob())", async () => {
      const originalCaches = (globalThis as any).caches;
      const blobSpy = vi.fn();
      (globalThis as any).caches = {
        keys: vi.fn().mockResolvedValue(["transformers-cache-test"]),
        open: vi.fn().mockResolvedValue({
          keys: vi.fn().mockResolvedValue([
            { url: "model.onnx" },
            { url: "config.json" },
          ]),
          match: vi.fn().mockResolvedValue({
            headers: {
              get: vi.fn((name: string) =>
                name === "content-length" ? "1048576" : null,
              ),
            },
            blob: blobSpy,
          }),
        }),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([
        { name: "transformers-cache-test", size: 1048576 * 2, count: 2 },
      ]);
      expect(blobSpy).not.toHaveBeenCalled();

      (globalThis as any).caches = originalCaches;
    });

    it("P88: sums bytes via stream when there is no Content-Length", async () => {
      const originalCaches = (globalThis as any).caches;
      const blobSpy = vi.fn();
      const readMock = vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new Uint8Array([1, 2, 3, 4]),
        })
        .mockResolvedValueOnce({
          done: false,
          value: new Uint8Array([5, 6]),
        })
        .mockResolvedValueOnce({ done: true });
      (globalThis as any).caches = {
        keys: vi.fn().mockResolvedValue(["transformers-cache-test"]),
        open: vi.fn().mockResolvedValue({
          keys: vi.fn().mockResolvedValue([{ url: "model.bin" }]),
          match: vi.fn().mockResolvedValue({
            headers: {
              get: vi.fn(() => null),
            },
            body: {
              getReader: vi.fn(() => ({
                read: readMock,
                releaseLock: vi.fn(),
              })),
            },
            blob: blobSpy,
          }),
        }),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([
        { name: "transformers-cache-test", size: 6, count: 1 },
      ]);
      expect(blobSpy).not.toHaveBeenCalled();

      (globalThis as any).caches = originalCaches;
    });

    it("P88: falls back to blob() as a last resort when the body is not readable", async () => {
      const originalCaches = (globalThis as any).caches;
      const blobSpy = vi.fn().mockResolvedValue({ size: 42 });
      (globalThis as any).caches = {
        keys: vi.fn().mockResolvedValue(["transformers-cache-test"]),
        open: vi.fn().mockResolvedValue({
          keys: vi.fn().mockResolvedValue([{ url: "unknown.bin" }]),
          match: vi.fn().mockResolvedValue({
            headers: {
              get: vi.fn(() => null),
            },
            body: null,
            blob: blobSpy,
          }),
        }),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([
        { name: "transformers-cache-test", size: 42, count: 1 },
      ]);
      expect(blobSpy).toHaveBeenCalledTimes(1);

      (globalThis as any).caches = originalCaches;
    });

    it("P88: an unreadable entry does not empty the report (try/catch per file)", async () => {
      const originalCaches = (globalThis as any).caches;
      const goodBlob = vi.fn().mockResolvedValue({ size: 10 });
      const matchMock = vi
        .fn()
        .mockResolvedValueOnce({
          // Input with a getReader() that throws (blocked/consumed body)
          headers: { get: vi.fn(() => null) },
          body: {
            getReader: vi.fn(() => {
              throw new Error("body already locked");
            }),
          },
          blob: vi.fn(),
        })
        .mockResolvedValueOnce({
          headers: { get: vi.fn(() => null) },
          body: null,
          blob: goodBlob,
        });
      (globalThis as any).caches = {
        keys: vi.fn().mockResolvedValue(["transformers-cache-test"]),
        open: vi.fn().mockResolvedValue({
          keys: vi.fn().mockResolvedValue([
            { url: "locked.bin" },
            { url: "good.bin" },
          ]),
          match: matchMock,
        }),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([
        { name: "transformers-cache-test", size: 10, count: 2 },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        "[ResourceManager] Failed to measure cached model entry",
        expect.objectContaining({ cache: "transformers-cache-test" }),
      );

      (globalThis as any).caches = originalCaches;
    });

    it("returns empty array if window is not defined", async () => {
      const originalWindow = globalThis.window;
      (globalThis as Record<string, unknown>).window = undefined;
      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([]);
      (globalThis as Record<string, unknown>).window = originalWindow;
    });
  });

  describe("deleteHFModel", () => {
    it("returns false if caches are not available", async () => {
      const result = await resourceManager.deleteHFModel("test-cache");
      expect(result).toBe(false);
    });
  });

  describe("startMemoryMonitoring", () => {
    it("releases election resources when monitoring stops", () => {
      const close = vi.fn();
      const pageLeaveHandler = vi.fn();
      const removeEventListener = vi.spyOn(window, "removeEventListener");
      (resourceManager as any).leaderChannel = { close };
      (resourceManager as any).pageLeaveHandler = pageLeaveHandler;
      (resourceManager as any).electionTimer = setTimeout(() => {}, 1000);

      resourceManager.stop();

      expect(close).toHaveBeenCalledTimes(1);
      expect(removeEventListener).toHaveBeenCalledWith(
        "pagehide",
        pageLeaveHandler,
      );
      expect(removeEventListener).toHaveBeenCalledWith(
        "beforeunload",
        pageLeaveHandler,
      );
      expect((resourceManager as any).leaderChannel).toBeNull();
      expect((resourceManager as any).pageLeaveHandler).toBeNull();
      removeEventListener.mockRestore();
    });

    it("sets up setInterval at 30000ms", () => {
      const spy = vi.spyOn(globalThis, "setInterval");
      (resourceManager as any).startMemoryMonitoring();
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 30000);
      spy.mockRestore();
    });

    it("returns early when window is undefined", () => {
      const originalWindow = globalThis.window;
      (globalThis as any).window = undefined;
      const spy = vi.spyOn(globalThis, "setInterval");
      (resourceManager as any).startMemoryMonitoring();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      (globalThis as any).window = originalWindow;
    });

    it("keeps the election channel alive for a losing tab", () => {
      const instances: Array<{
        onmessage: ((event: MessageEvent) => void) | null;
        close: ReturnType<typeof vi.fn>;
        postMessage: ReturnType<typeof vi.fn>;
      }> = [];
      class FakeBroadcastChannel {
        onmessage: ((event: MessageEvent) => void) | null = null;
        close = vi.fn();
        postMessage = vi.fn();
        addEventListener = vi.fn((type: string, listener: EventListener) => {
          if (type === "message") {
            this.onmessage = listener as unknown as (event: MessageEvent) => void;
          }
        });
        removeEventListener = vi.fn();
        constructor() {
          instances.push(this);
        }
      }
      vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
      resourceManager.stop();
      (resourceManager as any).startMonitoringIfWindow();
      expect(instances).toHaveLength(1);

      // A higher id wins the election. The losing tab must retain its channel
      // so it can observe the winner leaving and trigger a new election.
      instances[0]!.onmessage!({
        data: { type: "leader-claim", id: "zzzz" },
      } as MessageEvent);
      vi.advanceTimersByTime(200);
      expect(instances[0]!.close).not.toHaveBeenCalled();

      instances[0]!.onmessage!({
        data: { type: "leader-leaving" },
      } as MessageEvent);
      expect(instances).toHaveLength(2);
      resourceManager.stop();
      vi.unstubAllGlobals();
    });
  });

  describe("checkJSHeap", () => {
    it("returns early when performance.memory is not available", async () => {
      mockPerformance();
      await (resourceManager as any).checkJSHeap();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("logs warning and triggers critical pressure when usage > 85%", async () => {
      mockPerformance({ usedJSHeapSize: 860000, jsHeapSizeLimit: 1000000 });
      const handleSpy = vi
        .spyOn(resourceManager as any, "handleMemoryPressure")
        .mockResolvedValue(undefined);
      await (resourceManager as any).checkJSHeap();
      expect(logger.warn).toHaveBeenCalledWith(
        "[ResourceManager] Critical memory usage detected",
        expect.objectContaining({ usage: "86.0%" }),
      );
      expect(handleSpy).toHaveBeenCalledWith("critical");
      handleSpy.mockRestore();
    });

    it("logs warning and triggers moderate pressure when usage > 70%", async () => {
      mockPerformance({ usedJSHeapSize: 800000, jsHeapSizeLimit: 1000000 });
      const handleSpy = vi
        .spyOn(resourceManager as any, "handleMemoryPressure")
        .mockResolvedValue(undefined);
      await (resourceManager as any).checkJSHeap();
      expect(logger.warn).toHaveBeenCalledWith(
        "[ResourceManager] Moderate memory usage detected",
        expect.objectContaining({ usage: "80.0%" }),
      );
      expect(handleSpy).toHaveBeenCalledWith("moderate");
      handleSpy.mockRestore();
    });

    it("does nothing when usage <= 70%", async () => {
      mockPerformance({ usedJSHeapSize: 600000, jsHeapSizeLimit: 1000000 });
      const handleSpy = vi
        .spyOn(resourceManager as any, "handleMemoryPressure")
        .mockResolvedValue(undefined);
      await (resourceManager as any).checkJSHeap();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(handleSpy).not.toHaveBeenCalled();
      handleSpy.mockRestore();
    });
  });

  describe("handleMemoryPressure", () => {
    it("critical level unloads all engines and cleans up RxDB collections", async () => {
      const mockCleanup = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDB).mockResolvedValue({
        collections: {
          bookmarks: { name: "bookmarks", cleanup: mockCleanup },
          documents: { name: "documents", cleanup: mockCleanup },
        },
      } as any);
      await (resourceManager as any).handleMemoryPressure("critical");
      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect(ragEngine.unload).toHaveBeenCalled();
      expect(mockCleanup).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        "[ResourceManager] Critical pressure: Unloading all AI engines and clearing RxDB cache",
      );
      expect((resourceManager as any).activeComponent).toBeNull();
    });

    it("P87 canary: cleans up a FUTURE collection automatically (dynamic derivation, no hardcoded list)", async () => {
      const mockCleanup = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDB).mockResolvedValue({
        collections: {
          // A collection added to COLLECTIONS after this test was written:
          futureCollection: { name: "futureCollection", cleanup: mockCleanup },
        },
      } as any);
      await (resourceManager as any).handleMemoryPressure("critical");
      expect(mockCleanup).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("P87: skips collections without cleanup() with a warning instead of crashing", async () => {
      const mockCleanup = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDB).mockResolvedValue({
        collections: {
          withCleanup: { name: "withCleanup", cleanup: mockCleanup },
          withoutCleanup: { name: "withoutCleanup" },
        },
      } as any);
      await (resourceManager as any).handleMemoryPressure("critical");
      expect(mockCleanup).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        "[ResourceManager] Skipped collection without cleanup()",
        expect.objectContaining({ collection: "withoutCleanup" }),
      );
    });

    it("critical level skips RxDB cleanup when getDB returns undefined", async () => {
      vi.mocked(getDB).mockResolvedValue(undefined as any);
      await (resourceManager as any).handleMemoryPressure("critical");
      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect(ragEngine.unload).toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBeNull();
    });

    it("coalesces concurrent critical pressure recoveries", async () => {
      let releaseRecovery!: () => void;
      const recoveryGate = new Promise<void>((resolve) => {
        releaseRecovery = resolve;
      });
      const internalSpy = vi
        .spyOn(resourceManager as any, "handleMemoryPressureInternal")
        .mockReturnValue(recoveryGate);

      const first = (resourceManager as any).handleMemoryPressure("critical");
      const second = (resourceManager as any).handleMemoryPressure("critical");

      expect(first).toBe(second);
      expect(internalSpy).toHaveBeenCalledTimes(1);

      releaseRecovery();
      await Promise.all([first, second]);
      internalSpy.mockRestore();
    });

    it("critical level continues cleanup when a collection throws", async () => {
      const bookmarksCleanup = vi
        .fn()
        .mockRejectedValue(new Error("cleanup failed"));
      const documentsCleanup = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDB).mockResolvedValue({
        collections: {
          bookmarks: {
            name: "bookmarks",
            cleanup: bookmarksCleanup,
          },
          documents: { name: "documents", cleanup: documentsCleanup },
        },
      } as any);
      await (resourceManager as any).handleMemoryPressure("critical");
      expect(bookmarksCleanup).toHaveBeenCalled();
      expect(documentsCleanup).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[ResourceManager] Failed to cleanup collection",
        expect.objectContaining({ collection: "bookmarks" }),
      );
    });

    it("moderate level with active webllm unloads RAG engine", async () => {
      (resourceManager as any).activeComponent = "webllm";
      await (resourceManager as any).handleMemoryPressure("moderate");
      expect(ragEngine.unload).toHaveBeenCalled();
      expect(mockWebLLMService.unload).not.toHaveBeenCalled();
    });

    it("moderate level with active rag unloads WebLLM", async () => {
      (resourceManager as any).activeComponent = "rag";
      await (resourceManager as any).handleMemoryPressure("moderate");
      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect(ragEngine.unload).not.toHaveBeenCalled();
    });

    it("moderate level with no active component does nothing", async () => {
      (resourceManager as any).activeComponent = null;
      await (resourceManager as any).handleMemoryPressure("moderate");
      expect(mockWebLLMService.unload).not.toHaveBeenCalled();
      expect(ragEngine.unload).not.toHaveBeenCalled();
    });
  });

  describe("switchToWebLLM", () => {
    beforeEach(() => {
      vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => {
        fn();
        return 0 as any;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns early when already webllm active", async () => {
      (resourceManager as any).activeComponent = "webllm";
      await resourceManager.switchToWebLLM();
      expect(logger.info).not.toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("webllm");
    });

    it("unloads RAG engine and waits cooldown on <=8GB RAM", async () => {
      (resourceManager as any).activeComponent = "rag";
      mockNavigator({ deviceMemory: 8, gpu: { requestAdapter: vi.fn() } });
      await resourceManager.switchToWebLLM();
      expect(ragEngine.unload).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "[ResourceManager] Enforcing strict mutual exclusion. Unloading RAG engine...",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "[ResourceManager] Waiting for GC cooldown (2000ms)...",
      );
      expect((resourceManager as any).activeComponent).toBe("webllm");
    });

    it("skips RAG unload on >8GB RAM", async () => {
      (resourceManager as any).activeComponent = "rag";
      mockNavigator({ deviceMemory: 12, gpu: { requestAdapter: vi.fn() } });
      await resourceManager.switchToWebLLM();
      expect(ragEngine.unload).not.toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("webllm");
    });

    it("switches from null active component", async () => {
      (resourceManager as any).activeComponent = null;
      mockNavigator({ deviceMemory: 8, gpu: { requestAdapter: vi.fn() } });
      await resourceManager.switchToWebLLM();
      expect(ragEngine.unload).toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("webllm");
    });

    it("refuses GPU-less devices BEFORE any resource work (defensive capability gate)", async () => {
      // Mirrors WebLLMService's surface check: without a WebGPU surface the
      // switch must throw BEFORE the RAG unload, the GC cooldown, and the
      // exclusive-component flag flip — none of that work is useful on a
      // device that can never run a WebLLM engine.
      (resourceManager as any).activeComponent = "rag";
      mockNavigator({ deviceMemory: 8, gpu: undefined });

      await expect(resourceManager.switchToWebLLM()).rejects.toThrow(
        "WebGPU is not supported in this browser",
      );

      // Nothing was acquired or released: no RAG unload, no flag flip.
      expect(ragEngine.unload).not.toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("rag");
      // The refusal is logged so operators see why the switch failed.
      expect(logger.warn).toHaveBeenCalledWith(
        "[ResourceManager] WebLLM switch refused: no WebGPU surface in this browser",
      );
    });

    it("switchToRAG is NOT gated on WebGPU (embeddings work without a GPU)", async () => {
      // The gate is deliberately one-sided: RAG embeddings do not require
      // WebGPU, so switchToRAG must keep working on a GPU-less device.
      (resourceManager as any).activeComponent = "webllm";
      mockNavigator({ deviceMemory: 8, gpu: undefined });

      await resourceManager.switchToRAG();

      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("rag");
    });
  });

  describe("switchToRAG", () => {
    beforeEach(() => {
      vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: any) => {
        fn();
        return 0 as any;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns early when already rag active", async () => {
      (resourceManager as any).activeComponent = "rag";
      await resourceManager.switchToRAG();
      expect(logger.info).not.toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("rag");
    });

    it("unloads WebLLM and waits cooldown on <=8GB RAM", async () => {
      (resourceManager as any).activeComponent = "webllm";
      mockNavigator({ deviceMemory: 8 });
      await resourceManager.switchToRAG();
      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "[ResourceManager] Enforcing strict mutual exclusion. Unloading WebLLM engine...",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "[ResourceManager] Waiting for GC cooldown (2000ms)...",
      );
      expect((resourceManager as any).activeComponent).toBe("rag");
    });

    it("skips WebLLM unload on >8GB RAM", async () => {
      (resourceManager as any).activeComponent = "webllm";
      mockNavigator({ deviceMemory: 12 });
      await resourceManager.switchToRAG();
      expect(mockWebLLMService.unload).not.toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("rag");
    });

    it("switches from null active component", async () => {
      (resourceManager as any).activeComponent = null;
      mockNavigator({ deviceMemory: 8 });
      await resourceManager.switchToRAG();
      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect((resourceManager as any).activeComponent).toBe("rag");
    });
  });

  describe("MemoryPressureObserver fallback and errors", () => {
    it("disconnects MemoryPressureObserver when stopping monitoring", async () => {
      const mockObserver = {
        observe: vi.fn(),
        disconnect: vi.fn(),
      };
      (window as any).MemoryPressureObserver = vi
        .fn()
        .mockReturnValue(mockObserver);
      (resourceManager as any).memoryPressureObserver = mockObserver;
      (resourceManager as any).startMemoryMonitoring();
      resourceManager.stop();
      expect(mockObserver.disconnect).toHaveBeenCalled();
      (globalThis as any).MemoryPressureObserver = undefined;
      delete (window as any).MemoryPressureObserver;
    });

    it("falls back to periodic check when MemoryPressureObserver throws", async () => {
      const mockObserver = {
        observe: vi.fn().mockImplementation(() => {
          throw new Error("Not supported");
        }),
        disconnect: vi.fn(),
      };
      // Mocking experimental API (typed as any to avoid TS2339)
      (globalThis as any).MemoryPressureObserver = vi.fn().mockReturnValue(mockObserver);

      vi.resetModules();

      const spy = vi.spyOn(globalThis, "setInterval");
      await import("../../../services/ai/ResourceManager");
      expect(spy).toHaveBeenCalled();

      (globalThis as any).MemoryPressureObserver = undefined;
    });

    it("handles error in getHFModelStatus cache access", async () => {
      const originalCaches = (globalThis as any).caches;
      (globalThis as any).caches = {
        keys: vi.fn().mockRejectedValue(new Error("Storage error")),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([]);
      expect(logger.error).toHaveBeenCalled();

      (globalThis as any).caches = originalCaches;
    });

    it("handles error in deleteHFModel cache access", async () => {
      const originalCaches = (globalThis as any).caches;
      (globalThis as any).caches = {
        delete: vi.fn().mockRejectedValue(new Error("Storage error")),
      };

      const result = await resourceManager.deleteHFModel("test-cache");
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalled();

      (globalThis as any).caches = originalCaches;
    });

    it("handles error in getHFModelStatus cache open/keys", async () => {
      const originalCaches = (globalThis as any).caches;
      (globalThis as any).caches = {
        keys: vi.fn().mockResolvedValue(["transformers-cache-test"]),
        open: vi.fn().mockRejectedValue(new Error("Cache error")),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([]);
      expect(logger.error).toHaveBeenCalled();

      (globalThis as any).caches = originalCaches;
    });

    it("handles error in getHFModelStatus cache match/blob", async () => {
      const originalCaches = (globalThis as any).caches;
      (globalThis as any).caches = {
        keys: vi.fn().mockResolvedValue(["transformers-cache-test"]),
        open: vi.fn().mockRejectedValue(new Error("Match error")),
      };

      const status = await resourceManager.getHFModelStatus();
      expect(status).toEqual([]);
      expect(logger.error).toHaveBeenCalled();

      (globalThis as any).caches = originalCaches;
    });
  });

  describe("getDB error handling", () => {
    it("handles getDB rejection in handleMemoryPressure critical", async () => {
      vi.mocked(getDB).mockRejectedValueOnce(new Error("DB error"));

      try {
        await resourceManager.handleMemoryPressure("critical");
      } catch {
        // Expected - handleMemoryPressure propagates the error
      }

      expect(mockWebLLMService.unload).toHaveBeenCalled();
      expect(ragEngine.unload).toHaveBeenCalled();
    });
  });

  describe("isHighEndDevice edge cases", () => {
    it("uses defaults when deviceMemory and hardwareConcurrency are undefined", () => {
      mockNavigator({
        deviceMemory: undefined,
        hardwareConcurrency: undefined,
      });
      expect(resourceManager.isHighEndDevice()).toBe(false);
    });

    it("correctly identifies low end with exact thresholds", () => {
      mockNavigator({ deviceMemory: 8, hardwareConcurrency: 4 });
      expect(resourceManager.isHighEndDevice()).toBe(true);

      mockNavigator({ deviceMemory: 7.9, hardwareConcurrency: 4 });
      expect(resourceManager.isHighEndDevice()).toBe(false);

      mockNavigator({ deviceMemory: 8, hardwareConcurrency: 3.9 });
      expect(resourceManager.isHighEndDevice()).toBe(false);
    });
  });
});
