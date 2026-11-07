import { WASMModule, loadWASM } from "./wasm-core";

export interface ZeroMemoryProcessor {
  /** Write 0 to every byte in the given Uint8Array */
  zeroBytes(bytes: Uint8Array): void;
}

export async function createZeroMemoryProcessor(): Promise<ZeroMemoryProcessor> {
  const wasm = await loadWASM("/wasm/zero-memory.wasm");
  return createWASMZeroMemoryProcessor(wasm);
}

/**
 * The zero-memory.wasm module exports ONLY `memory` (its own linear memory)
 * and `zeroMemory(addr, len)` — a store loop with no static data segment. It
 * has NO `malloc`/`free` exports (the previous consumer called
 * `exports.malloc(...)` and threw a TypeError on every invocation, silently
 * falling back to JS `fill` while logging a spurious "WASM zero-memory
 * failed" warning on each vault lock).
 *
 * The function zeroes at least [addr, addr+len) (a byte-stepping i32.store
 * loop may also touch up to 3 bytes past the end). Because the module uses
 * no static data, the whole linear memory is free scratch space: we copy the
 * caller's bytes in, run zeroMemory, and copy the zeroed region back. Any
 * overrun lands in scratch and is never copied back, so callers always get
 * an exact zeroed buffer. Unavailable/empty memory or buffers larger than
 * the scratch capacity fall back to a plain `fill(0)` — the caller's bytes
 * are zeroed either way.
 */
function createWASMZeroMemoryProcessor(wasm: WASMModule): ZeroMemoryProcessor {
  const exports = wasm.exports as unknown as {
    zeroMemory: (addr: number, len: number) => void;
  };

  const memory = wasm.memory;
  let scratch: Uint8Array | null = null;
  try {
    // The module's own memory may be declared with 0 initial pages in some
    // engines; grow once if empty so a buffer exists. `memory.buffer` must
    // be re-read AFTER growing (grow replaces the ArrayBuffer).
    if (memory.buffer.byteLength === 0) {
      memory.grow(1);
    }
    scratch = new Uint8Array(memory.buffer);
  } catch {
    // Grow failed (unexpected max) — every call falls back to fill(0).
    scratch = null;
  }

  const SCRATCH_BASE = 0;

  return {
    zeroBytes(bytes: Uint8Array): void {
      if (bytes.length === 0) {return;}
      if (!scratch || bytes.length > scratch.length - SCRATCH_BASE) {
        bytes.fill(0);
        return;
      }
      try {
        scratch.set(bytes, SCRATCH_BASE);
        exports.zeroMemory(SCRATCH_BASE, bytes.length);
        bytes.set(
          scratch.subarray(SCRATCH_BASE, SCRATCH_BASE + bytes.length),
        );
      } catch {
        // Never leave caller bytes un-zeroed: fall back to JS fill.
        bytes.fill(0);
      }
    },
  };
}
