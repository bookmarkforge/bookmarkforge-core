import { describe, it, expect, vi, beforeEach } from "vitest";

// Contract of the REAL zero-memory.wasm module (verified by parsing the
// binary): it exports ONLY `memory` (its own linear memory) and
// `zeroMemory(addr, len)`. There is NO `malloc`/`free` — an earlier mock
// invented them, which is exactly why the consumer's `exports.malloc(...)`
// call went unnoticed while the production module always threw a TypeError
// (silently caught by the JS fill(0) fallback in SecurityVault).
const mockWASMModule = () => {
  const mem = new ArrayBuffer(65536);
  return {
    memory: { buffer: mem },
    exports: {
      zeroMemory: vi.fn((addr: number, len: number) => {
        new Uint8Array(mem, addr, len).fill(0);
      }),
    },
  };
};

// Memory that cannot provide a scratch buffer (empty + grow failure): the
// processor must still zero caller bytes via the plain fill(0) fallback.
const mockWASMModuleUnavailableMemory = () => {
  const mem = new ArrayBuffer(0);
  return {
    memory: {
      buffer: mem,
      grow: vi.fn(() => {
        throw new RangeError("memory max exceeded");
      }),
    },
    exports: {
      zeroMemory: vi.fn(),
    },
  };
};

vi.mock("../../utils/wasm-core", () => ({
  loadWASM: vi.fn(),
}));

let mod: typeof import("../../utils/wasm-zero-memory");
let wasmCore: { loadWASM: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.clearAllMocks();
  wasmCore = (await import("../../utils/wasm-core")) as any;
});

describe("createZeroMemoryProcessor", () => {
  it("returns WASM processor when WASM loads successfully", async () => {
    wasmCore.loadWASM.mockResolvedValue(mockWASMModule());
    mod = await import("../../utils/wasm-zero-memory");
    const processor = await mod.createZeroMemoryProcessor();
    expect(processor.zeroBytes).toBeDefined();
  });

  it("WASM processor zeroes bytes in place", async () => {
    wasmCore.loadWASM.mockResolvedValue(mockWASMModule());
    mod = await import("../../utils/wasm-zero-memory");
    const processor = await mod.createZeroMemoryProcessor();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    processor.zeroBytes(bytes);
    for (const b of bytes) {
      expect(b).toBe(0);
    }
  });

  it("WASM processor zeroes larger buffers (1000 bytes)", async () => {
    wasmCore.loadWASM.mockResolvedValue(mockWASMModule());
    mod = await import("../../utils/wasm-zero-memory");
    const processor = await mod.createZeroMemoryProcessor();
    const bytes = new Uint8Array(1000).fill(0x5a);
    processor.zeroBytes(bytes);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it("WASM processor handles empty array", async () => {
    wasmCore.loadWASM.mockResolvedValue(mockWASMModule());
    mod = await import("../../utils/wasm-zero-memory");
    const processor = await mod.createZeroMemoryProcessor();
    const bytes = new Uint8Array(0);
    expect(() => processor.zeroBytes(bytes)).not.toThrow();
  });

  it("falls back to fill(0) when the scratch buffer is unavailable", async () => {
    const mockModule = mockWASMModuleUnavailableMemory();
    wasmCore.loadWASM.mockResolvedValue(mockModule);
    mod = await import("../../utils/wasm-zero-memory");
    const processor = await mod.createZeroMemoryProcessor();
    const bytes = new Uint8Array(64).fill(0xab);
    processor.zeroBytes(bytes);
    expect(bytes.every((b) => b === 0)).toBe(true);
    // The WASM zeroMemory export must never be called on this path.
    expect(mockModule.exports.zeroMemory).not.toHaveBeenCalled();
  });

  it("falls back to fill(0) when the buffer exceeds scratch capacity", async () => {
    wasmCore.loadWASM.mockResolvedValue(mockWASMModule());
    mod = await import("../../utils/wasm-zero-memory");
    const processor = await mod.createZeroMemoryProcessor();
    const bytes = new Uint8Array(65536 + 8).fill(0xaa);
    processor.zeroBytes(bytes);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it("throws when WASM fails to load", async () => {
    wasmCore.loadWASM.mockRejectedValue(new Error("WASM unavailable"));
    mod = await import("../../utils/wasm-zero-memory");
    await expect(mod.createZeroMemoryProcessor()).rejects.toThrow(
      "WASM unavailable",
    );
  });
});
