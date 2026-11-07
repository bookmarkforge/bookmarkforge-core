import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  logRateLimited,
  resetRateLimitedLogging,
} from "../../utils/boundedLog";
import { logger } from "../../utils/logger";

vi.mock("../../utils/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("logRateLimited", () => {
  const NOW = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(() => {
    resetRateLimitedLogging();
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits the first occurrence with full detail", () => {
    logRateLimited("warn", "test:key", "Something failed", { code: 42 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("[test:key] Something failed", {
      code: 42,
    });
  });

  it("suppresses repeats within the window", () => {
    logRateLimited("warn", "test:key", "Something failed");
    logRateLimited("warn", "test:key", "Something failed");
    logRateLimited("warn", "test:key", "Something failed");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("reports suppressed volume on the next emission", () => {
    logRateLimited("warn", "test:key", "Something failed");
    logRateLimited("warn", "test:key", "Something failed");
    logRateLimited("warn", "test:key", "Something failed");
    vi.advanceTimersByTime(60_001);
    logRateLimited("warn", "test:key", "Something failed");
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(
      "[test:key] Something failed (2 occurrence(s) suppressed since last log)",
    );
  });

  it("routes error level to logger.error", () => {
    logRateLimited("error", "test:err", "Hard failure");
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps rate-limit state independent per key", () => {
    logRateLimited("warn", "a", "A failed");
    logRateLimited("warn", "b", "B failed");
    logRateLimited("warn", "a", "A failed again");
    // a + b emitted; the second "a" is suppressed by a's own window.
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, "[a] A failed");
    expect(logger.warn).toHaveBeenNthCalledWith(2, "[b] B failed");
  });

  it("evicts the stalest key when the tracked map is full", () => {
    for (let i = 0; i < 70; i++) {
      logRateLimited("warn", `key-${i}`, `msg ${i}`);
    }
    expect(logger.warn).toHaveBeenCalledTimes(70);
    // key-0 was evicted (64-key cap), so replaying it emits again.
    logRateLimited("warn", "key-0", "msg 0");
    expect(logger.warn).toHaveBeenCalledTimes(71);
  });

  it("resetRateLimitedLogging clears windows", () => {
    logRateLimited("warn", "test:key", "Something failed");
    resetRateLimitedLogging();
    logRateLimited("warn", "test:key", "Something failed");
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
