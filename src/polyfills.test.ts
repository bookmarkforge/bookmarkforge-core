import { describe, it, expect, beforeEach, vi } from "vitest";

describe("polyfills", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("sets globalThis.Buffer when undefined", async () => {
    delete (globalThis as any).Buffer;
    const mod = await import("./polyfills");
    await mod.bufferReady;
    expect(globalThis.Buffer).toBeDefined();
  });

  it("does not overwrite existing Buffer", async () => {
    const OriginalBuffer = class MockBuffer {};
    (globalThis as any).Buffer = OriginalBuffer;
    const mod = await import("./polyfills");
    await mod.bufferReady;
    expect(globalThis.Buffer).toBe(OriginalBuffer);
  });
});
