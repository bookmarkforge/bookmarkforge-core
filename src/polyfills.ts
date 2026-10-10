// Global Buffer polyfill using the `buffer` package (already in dependencies)
import { Buffer as BufferPolyfill } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = BufferPolyfill;
}

// Simple-peer (bundled into RxDB's WebRTC replication) requires
// `process.nextTick` to exist in the runtime: RxDB throws RC7 otherwise, and
// the readable-stream bundled into simple-peer calls `nextTick` extensively.
// Browsers have no `process` global, so provide a minimal shim. queueMicrotask
// preserves FIFO ordering better than setTimeout and is available in every
// supported browser. This must load before `replicateWebRTC` runs, so it is
// also imported from src/services/sync/replication.ts (the direct SyncService
// import path used by the e2e suite, which bypasses main.tsx).
const processShim = (globalThis as { process?: { nextTick?: unknown } })
  .process ?? {};
if (typeof processShim.nextTick !== "function") {
  const schedule: (fn: () => void) => void =
    typeof queueMicrotask === "function"
      ? (fn) => queueMicrotask(fn)
      : (fn) => setTimeout(fn, 0);
  processShim.nextTick = (
    fn: (...args: unknown[]) => void,
    ...args: unknown[]
  ) => {
    schedule(() => fn(...args));
  };
}
(globalThis as { process?: unknown }).process = processShim;

export const bufferReady = Promise.resolve();
