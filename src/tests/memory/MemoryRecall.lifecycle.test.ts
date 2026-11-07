// Coverage anchor for `MemoryRecall` abort guards. The leading
// `if (signal?.aborted) throw DOMException(...)` short-circuit in
// `recall()` (MemoryRecall.ts:31) was unreachable through the existing
// 32-test suite, which never hands a pre-aborted AbortSignal into the
// API surface.
//
// The mid-method guards (L35 / L45 / L96 / L108 / L131 / L139) are
// wrapped by an internal `try/catch` that converts the AbortError
// into `[]` (defensive: a recall failure must not crash the chat
// pipeline). They are reachable only on a 2-stage timing race that
// is not stable enough to anchor in a regression test; we leave them
// to manual inspection.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryRecall } from "../../memory/MemoryRecall";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MemoryRecall — abort guards", () => {
  it("propagates AbortError on the leading guard of recall() when the signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      memoryRecall.recall("anything", "any-session", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
