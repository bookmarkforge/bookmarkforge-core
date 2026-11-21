import { logger } from "./logger";
import { firewalledFetch } from "./networkFirewall";
import { verifyResourceIntegrity } from "./bundleIntegrity";

export interface WASMModule {
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
  exports: Record<string, (...args: number[]) => number>;
}

interface WASMCache {
  module: WASMModule;
  timestamp: number;
}

const wasmCache = new Map<string, WASMCache>();
const MAX_WASM_BYTES = 32 * 1024 * 1024;

async function cancelWasmResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup must not replace the original size or network error.
  }
}

async function readBoundedWasmResponse(response: Response): Promise<ArrayBuffer> {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WASM_BYTES) {
    await cancelWasmResponseBody(response);
    throw new Error("WASM response exceeds the 32 MB limit");
  }

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    } catch (error) {
      await cancelWasmResponseBody(response);
      throw error;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {break;}
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;
        if (total > MAX_WASM_BYTES) {
          try {await reader.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary limit error. */ }
          throw new Error("WASM response exceeds the 32 MB limit");
        }
        chunks.push(chunk);
      }
    } finally {
      try {reader.releaseLock();} catch { /* INTENTIONAL SILENCE: the runtime already released the lock. */ }
    }

    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_WASM_BYTES) {
    throw new Error("WASM response exceeds the 32 MB limit");
  }
  return buffer;
}

export async function loadWASM(
  url: string,
  importObject?: WebAssembly.Imports,
): Promise<WASMModule> {
  const cached = wasmCache.get(url);
  if (cached) {
    return cached.module;
  }

  try {
    // SECURITY (C2): route through the network firewall so non-whitelisted
    // origins are blocked instead of fetched in cleartext.
    const response = await firewalledFetch(url, undefined, "wasm-load");
    if (!response.ok) {
      await cancelWasmResponseBody(response);
      throw new Error(`WASM request failed with HTTP ${response.status}`);
    }
    const buffer = await readBoundedWasmResponse(response);
    if (!(await verifyResourceIntegrity(url, buffer))) {
      throw new Error(`WASM integrity verification failed for ${url}`);
    }

    const safeConsole = {
      log: (...args: unknown[]) => logger.debug("[WASM]", ...args),
      warn: (...args: unknown[]) => logger.warn("[WASM]", ...args),
      error: (...args: unknown[]) => logger.error("[WASM]", ...args),
    };
    const defaultImports: WebAssembly.Imports = {
      env: {
        memory: new WebAssembly.Memory({ initial: 1, maximum: 512 }),
        abort: () => {
          throw new Error("WASM abort");
        },
        ...safeConsole,
      },
      ...importObject,
    };

    const result = await WebAssembly.instantiate(buffer, defaultImports);
    const instance = result.instance;
    const exports = instance.exports as Record<
      string,
      (...args: number[]) => number
    >;

    // A module may declare its OWN exported memory (zero-memory.wasm does;
    // it imports nothing). Prefer that over the env import: writing to the
    // imported memory would touch a buffer the module never reads and
    // silently zero the wrong bytes. Fall back to the imported memory only
    // for modules that actually rely on it.
    const exportedMemory = instance.exports.memory as
      | WebAssembly.Memory
      | undefined;
    const module: WASMModule = {
      instance,
      memory:
        exportedMemory ?? (defaultImports.env!.memory as WebAssembly.Memory),
      exports,
    };

    wasmCache.set(url, { module, timestamp: Date.now() });

    logger.info(`[WASM] Loaded module from ${url}`);

    return module;
  } catch (error) {
    logger.error(`[WASM] Failed to load module from ${url}`, { error });
    throw error;
  }
}

export function clearWASMCache(): void {
  wasmCache.clear();
}
