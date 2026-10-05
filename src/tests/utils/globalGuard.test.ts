import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  safeFetch,
  guardAsync,
  isQuotaError,
  isResizeObserverNoise,
} from "../../utils/globalGuard";
import { errorReporter } from "../../telemetry/errorReporter";

vi.mock("../../telemetry/errorReporter", () => ({
  errorReporter: { reportError: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const reportError = vi.mocked(errorReporter.reportError);

describe("globalGuard.safeFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the response when fetch succeeds", async () => {
    const res = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    await expect(safeFetch("https://example.com")).resolves.toBe(res);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("throws and reports on non-2xx responses", async () => {
    const res = new Response("nope", { status: 500, statusText: "Server Error" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));

    await expect(safeFetch("https://example.com/api")).rejects.toThrow(
      "HTTP 500 Server Error",
    );
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![1]).toMatchObject({
      source: "safeFetch",
      url: "https://example.com/api",
    });
  });

  it("reports and rethrows network failures (never swallows the rejection)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network down")),
    );

    await expect(safeFetch("https://example.com")).rejects.toThrow(
      "network down",
    );
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "network down" }),
      expect.objectContaining({ source: "safeFetch" }),
    );
  });

  it("still rethrows when the reporter itself throws (containment is best-effort)", async () => {
    reportError.mockImplementation(() => {
      throw new Error("reporter exploded");
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await expect(safeFetch("https://example.com")).rejects.toThrow("boom");
  });

  it("accepts URL inputs and truncates long URLs in the error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
    const longPath = "a".repeat(300);
    const url = new URL(`https://example.com/${longPath}`);

    await expect(safeFetch(url)).rejects.toThrow();
    const reportedUrl = reportError.mock.calls[0]![1]!.url as string;
    expect(reportedUrl.length).toBeLessThanOrEqual(200);
  });

  it("wraps non-Error rejections into Error objects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("plain string failure"));

    await expect(safeFetch("https://example.com")).rejects.toThrow(
      "plain string failure",
    );
  });
});

describe("globalGuard.guardAsync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through the resolved value when the wrapped fn succeeds", async () => {
    // guardAsync's contract is (...args: unknown[]) => Promise<unknown>;
    // spell the mock that way so inference matches the constraint.
    const fn = vi.fn(
      async (...args: unknown[]) =>
        (args[0] as number) + (args[1] as number),
    );
    const guarded = guardAsync(fn, "add");

    await expect(guarded(2, 3)).resolves.toBe(5);
    expect(fn).toHaveBeenCalledWith(2, 3);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports and rethrows when the wrapped fn rejects", async () => {
    const guarded = guardAsync(async () => {
      throw new Error("inner failure");
    }, "op");

    await expect(guarded()).rejects.toThrow("inner failure");
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "inner failure" }),
      expect.objectContaining({ source: "op" }),
    );
  });

  it("forwards all arguments to the wrapped function", async () => {
    const fn = vi.fn(async (...args: unknown[]) => args.length);
    const guarded = guardAsync(fn, "varargs");

    await expect(guarded(1, "x", true)).resolves.toBe(3);
    expect(fn).toHaveBeenCalledWith(1, "x", true);
  });

  it("keeps rethrowing when reporting throws (best-effort containment)", async () => {
    reportError.mockImplementation(() => {
      throw new Error("reporter exploded");
    });
    const guarded = guardAsync(async () => {
      throw new Error("original");
    }, "op");

    await expect(guarded()).rejects.toThrow("original");
  });
});

describe("globalGuard predicates", () => {
  it("isQuotaError detects DOMException QuotaExceededError", () => {
    const err = new DOMException("full", "QuotaExceededError");
    expect(isQuotaError(err)).toBe(true);
  });

  it("isQuotaError detects quota errors from cross-realm objects (name only)", () => {
    expect(isQuotaError({ name: "QuotaExceededError" })).toBe(true);
  });

  it("isQuotaError rejects unrelated errors and non-objects", () => {
    expect(isQuotaError(new Error("nope"))).toBe(false);
    expect(isQuotaError({ name: "TypeError" })).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError("QuotaExceededError")).toBe(false);
  });

  it("isResizeObserverNoise detects the ResizeObserver loop warning", () => {
    expect(isResizeObserverNoise(new Error("ResizeObserver loop limit exceeded"))).toBe(true);
    expect(isResizeObserverNoise(new Error("ResizeObserver loop completed with undelivered notifications"))).toBe(true);
  });

  it("isResizeObserverNoise handles non-Error inputs and unrelated messages", () => {
    expect(isResizeObserverNoise("loop limit exceeded")).toBe(true);
    expect(isResizeObserverNoise(new Error("unrelated"))).toBe(false);
    expect(isResizeObserverNoise(undefined)).toBe(false);
  });
});
