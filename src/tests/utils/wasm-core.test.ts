import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadWASM, clearWASMCache, WASMModule } from "../../utils/wasm-core";

// Mock dependencies
vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: vi.fn(),
  setFirewallDisabled: vi.fn(),
}));

vi.mock("../../utils/bundleIntegrity", () => ({
  verifyResourceIntegrity: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock WebAssembly
const mockInstance = {
  exports: {
    memory: new WebAssembly.Memory({ initial: 1 }),
    testExport: () => 42,
  },
};

vi.stubGlobal("WebAssembly", {
  instantiate: vi.fn(() => Promise.resolve({ instance: mockInstance })),
  Memory: class MockMemory {
    buffer = new ArrayBuffer(65536);
  },
});

describe("wasm-core", () => {
  beforeEach(() => {
    clearWASMCache();
    vi.clearAllMocks();
  });

  describe("loadWASM", () => {
    it("should load WASM module and cache it", async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn(() => "1000"),
        },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
            cancel: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(true);

      const module = await loadWASM("test.wasm");

      expect(module).toBeDefined();
      expect(module.instance).toBe(mockInstance);
      expect(module.exports.testExport!()).toBe(42);
    });

    it("should return cached module on second call", async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn(() => "1000"),
        },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
            cancel: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(true);

      const module1 = await loadWASM("test.wasm");
      const module2 = await loadWASM("test.wasm");

      expect(module1).toBe(module2);
      expect(firewalledFetch).toHaveBeenCalledTimes(1);
    });

    it("should throw when response exceeds MAX_WASM_BYTES via content-length", async () => {
      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn(() => String(33 * 1024 * 1024)), // 33 MB
        },
        body: {
          getReader: vi.fn(),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(loadWASM("test.wasm")).rejects.toThrow(
        "WASM response exceeds the 32 MB limit"
      );
    });

    it("should throw when response body exceeds MAX_WASM_BYTES while streaming", async () => {
      const mockReader = {
        read: vi.fn(() =>
          Promise.resolve({
            done: false,
            value: new Uint8Array(20 * 1024 * 1024), // 20 MB chunk
          })
        ),
        releaseLock: vi.fn(),
        cancel: vi.fn(),
      };

      const mockResponse = {
        ok: true,
        headers: {
          get: vi.fn(() => null),
        },
        body: {
          getReader: vi.fn(() => mockReader),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(loadWASM("test.wasm")).rejects.toThrow(
        "WASM response exceeds the 32 MB limit"
      );
    });

    it("should throw when response is not ok", async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        headers: { get: vi.fn(() => null) },
        body: { cancel: vi.fn() },
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(loadWASM("test.wasm")).rejects.toThrow(
        "WASM request failed with HTTP 404"
      );
    });

    it("should throw when integrity verification fails", async () => {
      const mockResponse = {
        ok: true,
        headers: { get: vi.fn(() => "1000") },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(false);

      await expect(loadWASM("test.wasm")).rejects.toThrow(
        "WASM integrity verification failed for test.wasm"
      );
    });

    it("should handle body.getReader throwing", async () => {
      const mockResponse = {
        ok: true,
        headers: { get: vi.fn(() => "1000") },
        body: {
          getReader: vi.fn(() => {
            throw new Error("reader error");
          }),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);

      await expect(loadWASM("test.wasm")).rejects.toThrow("reader error");
    });

    it("should handle WebAssembly instantiate failure", async () => {
      const mockResponse = {
        ok: true,
        headers: { get: vi.fn(() => "1000") },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(true);

      vi.stubGlobal("WebAssembly", {
        instantiate: vi.fn(() => Promise.reject(new Error("WASM compile error"))),
        Memory: class MockMemory {
          buffer = new ArrayBuffer(65536);
        },
      });

      await expect(loadWASM("test.wasm")).rejects.toThrow("WASM compile error");
    });

    it("should prefer exported memory over imported memory", async () => {
      const moduleWithExportedMemory = {
        instance: {
          exports: {
            memory: new WebAssembly.Memory({ initial: 1 }),
            testExport: () => 42,
          },
        },
      };

      const mockResponse = {
        ok: true,
        headers: { get: vi.fn(() => "1000") },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(true);

      vi.stubGlobal("WebAssembly", {
        instantiate: vi.fn(() => Promise.resolve(moduleWithExportedMemory)),
        Memory: class MockMemory {
          buffer = new ArrayBuffer(65536);
        },
      });

      const module = await loadWASM("test.wasm");

      expect(module.memory).toBe(moduleWithExportedMemory.instance.exports.memory);
    });

    it("should fall back to imported memory when no exported memory", async () => {
      const moduleWithoutExportedMemory = {
        instance: {
          exports: {
            testExport: () => 42,
          },
        },
      };

      const importedMemory = new WebAssembly.Memory({ initial: 1 });

      const mockResponse = {
        ok: true,
        headers: { get: vi.fn(() => "1000") },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(true);

      vi.stubGlobal("WebAssembly", {
        instantiate: vi.fn(() => Promise.resolve(moduleWithoutExportedMemory)),
        Memory: class MockMemory {
          buffer = new ArrayBuffer(65536);
        },
      });

      const module = await loadWASM("test.wasm");

      // Should fall back to the imported memory from defaultImports
      expect(module.memory).toBeDefined();
      expect(module.memory.buffer).toBeInstanceOf(ArrayBuffer);
    });
  });

  describe("clearWASMCache", () => {
    it("should clear the WASM cache", async () => {
      const mockResponse = {
        ok: true,
        headers: { get: vi.fn(() => "1000") },
        body: {
          getReader: vi.fn(() => ({
            read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
            releaseLock: vi.fn(),
          })),
          cancel: vi.fn(),
        },
        arrayBuffer: vi.fn(() => Promise.resolve(new ArrayBuffer(100))),
      };

      const { firewalledFetch } = await import("../../utils/networkFirewall");
      const { verifyResourceIntegrity } = await import("../../utils/bundleIntegrity");

      vi.mocked(firewalledFetch).mockResolvedValue(mockResponse as unknown as Response);
      vi.mocked(verifyResourceIntegrity).mockResolvedValue(true);

      await loadWASM("test.wasm");
      clearWASMCache();

      // Load again - should not use cache
      const module2 = await loadWASM("test.wasm");
      expect(module2).toBeDefined();
      expect(firewalledFetch).toHaveBeenCalledTimes(2);
    });
  });
});
