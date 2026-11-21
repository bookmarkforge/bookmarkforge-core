import { describe, it, expect, vi, afterEach } from "vitest";
import { getIndexedDB } from "../../utils/indexedDB";

describe("getIndexedDB", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the global indexedDB when defined", () => {
    const result = getIndexedDB();
    expect(result).toBe(indexedDB);
  });

  it("returns null when indexedDB is not defined", () => {
    vi.stubGlobal("indexedDB", undefined);
    const result = getIndexedDB();
    expect(result).toBeNull();
  });
});
