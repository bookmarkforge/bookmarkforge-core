import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  withRetry,
  CircuitBreaker,
  withFallback,
  withTimeout,
  withResilience,
  StateManager,
} from "../../utils/resilience";

describe("resilience utilities", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("retries and calls onRetry before succeeding", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockResolvedValue("ok");
    const onRetry = vi.fn();
    const promise = withRetry(fn, { baseDelay: 10, jitter: false, onRetry });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("throws the final error after retries are exhausted", async () => {
    const error = new Error("failed");
    const promise = withRetry(vi.fn().mockRejectedValue(error), {
      maxRetries: 1,
      baseDelay: 5,
      jitter: false,
    });
    const assertion = expect(promise).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it("opens, rejects, and recovers a circuit", async () => {
    const changes: string[] = [];
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      recoveryTimeout: 100,
      onStateChange: (state) => changes.push(state),
    });
    const fail = vi.fn().mockRejectedValue(new Error("down"));
    await expect(breaker.execute(fail)).rejects.toThrow("down");
    await expect(breaker.execute(fail)).rejects.toThrow("down");
    await expect(breaker.execute(fail)).rejects.toThrow("Circuit breaker is open");
    await vi.advanceTimersByTimeAsync(100);
    await expect(breaker.execute(vi.fn().mockResolvedValue("up"))).resolves.toBe("up");
    expect(breaker.getState()).toBe("closed");
    expect(changes).toEqual(["open", "half-open", "closed"]);
    breaker.reset();
    expect(breaker.getState()).toBe("closed");
  });

  it("uses fallback and reports the original error", async () => {
    const error = new Error("primary");
    const onError = vi.fn();
    await expect(withFallback(() => Promise.reject(error), {
      fallback: () => "fallback",
      onError,
    })).resolves.toBe("fallback");
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("resolves before timeout and rejects after timeout", async () => {
    await expect(withTimeout(() => Promise.resolve("ok"), 10)).resolves.toBe("ok");
    const pending = withTimeout(() => new Promise<string>(() => {}), 10);
    const assertion = expect(pending).rejects.toThrow("Operation timed out after 10ms");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });

  it("combines retry, timeout, and circuit breaker", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withResilience(fn, {
      retry: { maxRetries: 1, baseDelay: 1, jitter: false },
      timeoutMs: 10,
      circuitBreaker: breaker,
    })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("loads, saves, and clears persisted state", async () => {
    const manager = new StateManager("resilience-test", { count: 1 });
    localStorage.setItem("resilience-test", JSON.stringify({ count: 3 }));
    await expect(manager.load()).resolves.toEqual({ count: 3 });
    await manager.save({ count: 4 });
    expect(JSON.parse(localStorage.getItem("resilience-test")!)).toEqual({ count: 4 });
    await manager.clear();
    expect(localStorage.getItem("resilience-test")).toBeNull();
  });
});
