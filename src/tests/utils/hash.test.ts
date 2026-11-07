import { describe, it, expect } from "vitest";
import { fnv1aHash, hashCacheKey } from "../../utils/hash";

describe("fnv1aHash", () => {
  it("matches the standard FNV-1a 32-bit test vectors", () => {
    // These are the canonical FNV-1a vectors. The exact output is part of the
    // on-disk contract: cache keys and persisted flashcard ids (`fc_…`) are
    // derived from it, so changing the algorithm here would invalidate them.
    expect(fnv1aHash("")).toBe("811c9dc5");
    expect(fnv1aHash("a")).toBe("e40c292c");
    expect(fnv1aHash("foobar")).toBe("bf9cf968");
  });

  it("is deterministic and 8 hex characters", () => {
    const input = "deterministic-key";
    const a = fnv1aHash(input);
    const b = fnv1aHash(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("distinguishes inputs that differ only at the end", () => {
    const prefix = "x".repeat(250);
    expect(fnv1aHash(prefix + "A")).not.toBe(fnv1aHash(prefix + "B"));
  });
});

describe("hashCacheKey", () => {
  it("includes the input length and both accumulators for the empty string", () => {
    expect(hashCacheKey("")).toBe("0:811c9dc5:9e3779b9");
  });

  it("is deterministic and never returns the input", () => {
    const input = "sensitive prompt content";
    const a = hashCacheKey(input);
    const b = hashCacheKey(input);
    expect(a).toBe(b);
    expect(a).not.toContain(input);
    expect(a).toMatch(/^\d+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it("differs from fnv1aHash so the two contracts stay distinct", () => {
    const input = "overlap";
    expect(hashCacheKey(input)).not.toBe(fnv1aHash(input));
  });
});
