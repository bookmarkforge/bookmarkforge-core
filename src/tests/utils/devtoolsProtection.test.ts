import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initDevToolsDetection,
  stopDevToolsDetection,
  initDevToolsProtection,
  isDevToolsOpen,
} from "../../utils/devtoolsProtection";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

const setWindowSize = (outer: number, inner: number) => {
  Object.defineProperty(window, "outerWidth", {
    value: outer,
    configurable: true,
  });
  Object.defineProperty(window, "innerWidth", {
    value: inner,
    configurable: true,
  });
};

describe("devtoolsProtection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopDevToolsDetection();
    setWindowSize(1024, 1024);
  });

  afterEach(() => {
    stopDevToolsDetection();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe("isDevToolsOpen", () => {
    it("returns false by default", () => {
      expect(isDevToolsOpen()).toBe(false);
    });
  });

  describe("initDevToolsDetection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("starts the detection interval without errors", () => {
      initDevToolsDetection();
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(false);
    });

    it("starts and stops without errors", () => {
      initDevToolsDetection();
      vi.advanceTimersByTime(500);
      stopDevToolsDetection();
      expect(isDevToolsOpen()).toBe(false);
    });

    it("is a no-op if already started", () => {
      initDevToolsDetection();
      initDevToolsDetection();
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(false);
    });

    it("detects open devtools by width difference and logs warn", () => {
      initDevToolsDetection();
      setWindowSize(1400, 1024);
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith("DevTools detected", {
        isOpen: true,
      });
    });

    it("detects devtools by height difference (w false, h true)", () => {
      initDevToolsDetection();
      setWindowSize(1024, 700);
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(true);
    });

    it("closes the state when devtools are no longer detected", () => {
      initDevToolsDetection();
      setWindowSize(1400, 1024);
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(true);
      setWindowSize(1024, 1024);
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(false);
    });

    it("stopDevToolsDetection is a no-op if there is no interval", () => {
      stopDevToolsDetection();
      expect(isDevToolsOpen()).toBe(false);
    });
  });

  describe("initDevToolsProtection", () => {
    it("skips doing anything in dev mode", () => {
      initDevToolsProtection();
      expect(isDevToolsOpen()).toBe(false);
    });

    it("starts detection in prod mode", () => {
      vi.useFakeTimers();
      vi.stubEnv("PROD", "true" as any);
      initDevToolsProtection();
      setWindowSize(1400, 1024);
      vi.advanceTimersByTime(500);
      expect(isDevToolsOpen()).toBe(true);
    });
  });
});
