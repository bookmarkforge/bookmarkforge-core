import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RequestDeduper,
  globalRequestDeduper,
} from "../../utils/requestDeduper";

describe("RequestDeduper", () => {
  let deduper: RequestDeduper;

  beforeEach(() => {
    vi.useFakeTimers();
    deduper = new RequestDeduper(5000, 100);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should execute factory for new key", async () => {
    const factory = vi.fn().mockResolvedValue("result");
    const result = await deduper.dedupe("key1", factory);
    expect(result).toBe("result");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("should deduplicate concurrent calls with same key", async () => {
    let resolveFactory: (v: string) => void;
    const factory = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveFactory = resolve;
      }),
    );

    const promise1 = deduper.dedupe("key", factory);
    const promise2 = deduper.dedupe("key", factory);

    resolveFactory!("shared");
    const [r1, r2] = await Promise.all([promise1, promise2]);

    expect(r1).toBe("shared");
    expect(r2).toBe("shared");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("should return cached result within cacheWindow", async () => {
    const factory = vi.fn().mockResolvedValue("cached-value");
    await deduper.dedupe("key", factory);
    expect(factory).toHaveBeenCalledTimes(1);

    const factory2 = vi.fn().mockResolvedValue("new-value");
    const result = await deduper.dedupe("key", factory2);
    expect(result).toBe("cached-value");
    expect(factory2).not.toHaveBeenCalled();
  });

  it("should execute factory after cacheWindow expires", async () => {
    const factory = vi.fn().mockResolvedValue("v1");
    await deduper.dedupe("key", factory);

    vi.advanceTimersByTime(200);

    const factory2 = vi.fn().mockResolvedValue("v2");
    const result = await deduper.dedupe("key", factory2);
    expect(result).toBe("v2");
  });

  it("should not deduplicate after dedupeWindow expires", async () => {
    let resolve1: (v: string) => void;
    const factory1 = vi.fn().mockReturnValue(
      new Promise<string>((r) => {
        resolve1 = r;
      }),
    );
    const promise1 = deduper.dedupe("key", factory1);
    resolve1!("first");
    await promise1;

    vi.advanceTimersByTime(6000);

    const factory2 = vi.fn().mockResolvedValue("second");
    const result = await deduper.dedupe("key", factory2);
    expect(result).toBe("second");
    expect(factory2).toHaveBeenCalledTimes(1);
  });

  it("does not let an expired request overwrite a newer generation", async () => {
    let resolveFirst: (value: string) => void;
    let resolveSecond: (value: string) => void;
    const first = deduper.dedupe(
      "key",
      () => new Promise<string>((resolve) => { resolveFirst = resolve; }),
    );

    // The first request is still running, but its dedupe window has elapsed.
    vi.advanceTimersByTime(5001);
    const second = deduper.dedupe(
      "key",
      () => new Promise<string>((resolve) => { resolveSecond = resolve; }),
    );

    resolveFirst!("stale");
    await expect(first).resolves.toBe("stale");

    // The late first response must not remove the second request or populate
    // the short result cache with stale data.
    const duringFactory = vi.fn().mockResolvedValue("unexpected");
    const duringSecond = deduper.dedupe("key", duringFactory);
    expect(duringFactory).not.toHaveBeenCalled();

    resolveSecond!("fresh");
    await expect(second).resolves.toBe("fresh");
    await expect(duringSecond).resolves.toBe("fresh");
  });

  it("releases in-flight state when result caching is disabled", async () => {
    const noResultCache = new RequestDeduper(5000, 100, 0);
    const first = vi.fn().mockResolvedValue("first");
    const second = vi.fn().mockResolvedValue("second");

    await noResultCache.dedupe("key", first);
    await noResultCache.dedupe("key", second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("should propagate errors and allow new request after failure", async () => {
    const factory = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(deduper.dedupe("key", factory)).rejects.toThrow("fail");
    // after failure, a new request with the same key must work
    const ok = vi.fn().mockResolvedValue("ok");
    const result = await deduper.dedupe("key", ok);
    expect(result).toBe("ok");
  });

  it("prunes expired completed results without waiting for capacity eviction", async () => {
    const factory = vi.fn().mockResolvedValue("expired");
    await deduper.dedupe("expired-key", factory);
    vi.advanceTimersByTime(101);

    const next = vi.fn().mockResolvedValue("fresh");
    await deduper.dedupe("another-key", next);

    // The expired result is no longer returned even though the cache is far
    // below its maximum size.
    const replacement = vi.fn().mockResolvedValue("replacement");
    await expect(deduper.dedupe("expired-key", replacement)).resolves.toBe(
      "replacement",
    );
    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it("should clear all pending and cached requests", async () => {
    const factory = vi.fn().mockResolvedValue("x");
    await deduper.dedupe("k1", factory);
    deduper.clear();
    // after clear, a fresh request executes the factory again
    const factory2 = vi.fn().mockResolvedValue("y");
    const result = await deduper.dedupe("k1", factory2);
    expect(result).toBe("y");
    expect(factory2).toHaveBeenCalledTimes(1);
  });
});

describe("singleton", () => {
  it("should export a global request deduper", () => {
    expect(globalRequestDeduper).toBeInstanceOf(RequestDeduper);
  });
});
