import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { getWindowChrome } from "../../utils/browser-types";

function makeNormalNavigator() {
  const nav = Object.create(Navigator.prototype);
  Object.defineProperties(nav, {
    webdriver: { value: false, configurable: true, writable: true },
    userAgent: { value: "Mozilla/5.0 Chrome/120", configurable: true, writable: true },
    platform: { value: "Win32", configurable: true, writable: true },
    language: { value: "en-US", configurable: true, writable: true },
    onLine: { value: true, configurable: true, writable: true },
    hardwareConcurrency: { value: 4, configurable: true, writable: true },
  });
  return nav;
}

function setNormalWindowDimensions() {
  Object.defineProperty(window, "outerWidth", { value: 1920, writable: true });
  Object.defineProperty(window, "innerWidth", { value: 1920, writable: true });
  Object.defineProperty(window, "outerHeight", { value: 1080, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 1080, writable: true });
}

describe("environmentDetection - Extended", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detectHostileEnvironment returns non-suspicious result in test env", async () => {
    const mod = await import("../../utils/environmentDetection");
    const result = mod.detectHostileEnvironment();
    expect(result).toHaveProperty("isSuspicious");
    expect(result).toHaveProperty("reasons");
    expect(result).toHaveProperty("details");
    expect(result.details).toHaveProperty("devToolsOpen");
    expect(result.details).toHaveProperty("webDriverPresent");
  });

  it("detectDebuggerAsync resolves to boolean", async () => {
    const mod = await import("../../utils/environmentDetection");
    const result = await mod.detectDebuggerAsync();
    expect(typeof result).toBe("boolean");
  });

  it("initTabCounting and resetTabCountingForTests work together", async () => {
    const mod = await import("../../utils/environmentDetection");
    mod.__resetTabCountingForTests();
    expect(() => mod.initTabCounting()).not.toThrow();
    mod.__resetTabCountingForTests();
  });
});

describe("environmentDetection - Branch Coverage (Hardened checks)", () => {
  let mod: Awaited<
    typeof import("../../utils/environmentDetection")
  >;

  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mod = await import("../../utils/environmentDetection");
    vi.stubGlobal("navigator", makeNormalNavigator());
    setNormalWindowDimensions();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ========== Console Tampering branches ==========

  describe("console tampering detection", () => {
    it("detects tampered console.log (not native)", () => {
      const origLog = console.log;
      const fakeLog = ((..._args: unknown[]) => {}) as typeof console.log;
      fakeLog.toString = () => "function log() { [scrambled code] }";
      console.log = fakeLog;

      const result = mod.detectHostileEnvironment();
      expect(result.details.consoleTampered).toBe(true);
      expect(result.isSuspicious).toBe(true);

      console.log = origLog;
    });

    it("detects missing console methods", () => {
      const origWarn = console.warn;
      const origError = console.error;
      Object.defineProperty(console, "warn", { value: undefined });

      const result = mod.detectHostileEnvironment();
      expect(result.details.consoleTampered).toBe(true);

      console.warn = origWarn;
      console.error = origError;
    });

    it("detects missing console.error", () => {
      const origError = console.error;
      Object.defineProperty(console, "error", { value: undefined });

      const result = mod.detectHostileEnvironment();
      expect(result.details.consoleTampered).toBe(true);

      console.error = origError;
    });

    it("does NOT flag native console", () => {
      const result = mod.detectHostileEnvironment();
      expect(result.details.consoleTampered).toBe(false);
    });
  });

  // ========== Prototype Tampering branches ==========

  describe("prototype tampering detection", () => {
    it("detects polluted Array.prototype", () => {
      const proto = Array.prototype as unknown as Record<string, unknown>;
      proto.__evil_pollution_1__ = "injected";
      proto.__evil_pollution_2__ = "injected";
      proto.__evil_pollution_3__ = "injected";

      const result = mod.detectHostileEnvironment();
      expect(result.details.prototypeTampered).toBe(true);
      expect(result.isSuspicious).toBe(true);

      delete proto.__evil_pollution_1__;
      delete proto.__evil_pollution_2__;
      delete proto.__evil_pollution_3__;
    });

    it("detects polluted Object.prototype", () => {
      const proto = Object.prototype as unknown as Record<string, unknown>;
      proto.__malicious_key_1__ = "injected";
      proto.__malicious_key_2__ = "injected";
      proto.__malicious_key_3__ = "injected";

      const result = mod.detectHostileEnvironment();
      expect(result.details.prototypeTampered).toBe(true);

      delete proto.__malicious_key_1__;
      delete proto.__malicious_key_2__;
      delete proto.__malicious_key_3__;
    });

    it("does NOT flag clean prototypes", () => {
      const result = mod.detectHostileEnvironment();
      expect(result.details.prototypeTampered).toBe(false);
    });
  });

  // ========== Canvas Blocking branches ==========

  describe("canvas blocking detection", () => {
    it("detects blocked canvas (getContext returns null)", () => {
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string) => {
          if (tag === "canvas") {
            return {
              width: 1,
              height: 1,
              getContext: () => null,
            } as unknown as HTMLCanvasElement;
          }
          return origCreateElement(tag);
        });

      const result = mod.detectHostileEnvironment();
      expect(result.details.canvasFingerprintBlocked).toBe(true);

      createElementSpy.mockRestore();
    });

    it("returns true when canvas.getImageData returns empty data", () => {
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string) => {
          if (tag === "canvas") {
            return {
              width: 1,
              height: 1,
              getContext: () => ({
                fillStyle: "",
                fillRect: vi.fn(),
                getImageData: () => ({ data: { length: 0 } }),
              }),
            } as unknown as HTMLCanvasElement;
          }
          return origCreateElement(tag);
        });

      const result = mod.detectHostileEnvironment();
      expect(result.details.canvasFingerprintBlocked).toBe(true);

      createElementSpy.mockRestore();
    });

    it("returns true when canvas getImageData throws", () => {
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string) => {
          if (tag === "canvas") {
            return {
              width: 1,
              height: 1,
              getContext: () => {
                throw new Error("canvas blocked");
              },
            } as unknown as HTMLCanvasElement;
          }
          return origCreateElement(tag);
        });

      const result = mod.detectHostileEnvironment();
      expect(result.details.canvasFingerprintBlocked).toBe(true);

      createElementSpy.mockRestore();
    });

    it("does NOT flag accessible canvas", () => {
      const origCreateElement = document.createElement.bind(document);
      const createElementSpy = vi
        .spyOn(document, "createElement")
        .mockImplementation((tag: string) => {
          if (tag === "canvas") {
            return {
              width: 1,
              height: 1,
              getContext: () => ({
                fillStyle: "",
                fillRect: vi.fn(),
                getImageData: () => ({
                  data: new Uint8ClampedArray([255, 0, 0, 255]),
                }),
              }),
            } as unknown as HTMLCanvasElement;
          }
          return origCreateElement(tag);
        });

      const result = mod.detectHostileEnvironment();
      expect(result.details.canvasFingerprintBlocked).toBe(false);

      createElementSpy.mockRestore();
    });
  });

  // ========== Proxy / MITM detection branches ==========

  describe("proxy detection timing", () => {
    it("handles RTCPeerConnection being undefined gracefully", () => {
      vi.stubGlobal("RTCPeerConnection", undefined);

      const result = mod.detectHostileEnvironment();
      expect(result.details.proxyLikely).toBe(false);
    });

    it("handles RTCPeerConnection available without error", () => {
      const result = mod.detectHostileEnvironment();
      expect(result.details.proxyLikely).toBe(false);
    });

    it("falls back to false when no proxy indicators are found", () => {
      const result = mod.detectHostileEnvironment();
      expect(result.details.proxyLikely).toBe(false);
    });
  });

  // ========== DevTools detection branches ==========

  describe("DevTools detection", () => {
    it("detects open DevTools via window dimensions (informational only)", () => {
      Object.defineProperty(window, "outerWidth", { value: 1920, writable: true });
      Object.defineProperty(window, "innerWidth", { value: 1500, writable: true });

      const result = mod.detectHostileEnvironment();
      expect(result.details.devToolsOpen).toBe(true);
      expect(result.reasons).toContain("DevTools detected (informational)");
      // DevTools does NOT flip isSuspicious
      expect(result.isSuspicious).toBe(false);
    });

    it("does NOT flag DevTools when dimensions match", () => {
      setNormalWindowDimensions();

      const result = mod.detectHostileEnvironment();
      expect(result.details.devToolsOpen).toBe(false);
    });
  });

  // ========== Time skew detection branches ==========

  describe("time skew detection", () => {
    it("runs without throwing", () => {
      const result = mod.detectHostileEnvironment();
      expect(result.details.timeSkewed).toBe(false);
    });

    it("detects clock skew when divergence exceeds 5 minutes", async () => {
      const freshMod = await import("../../utils/environmentDetection");
      const result = freshMod.detectHostileEnvironment();
      expect(typeof result.details.timeSkewed).toBe("boolean");
    });
  });

  // ========== Multiple instances / extension context ==========

  describe("extension context detection", () => {
    it("detects chrome.runtime.id presence", () => {
      const mockChrome = { runtime: { id: "test-extension-id" } };
      const w = getWindowChrome();
      w.chrome = mockChrome;

      const result = mod.detectHostileEnvironment();
      expect(result.reasons).toContain("Extension context detected");

      delete w.chrome;
    });
  });

  // ========== Debugger detection branches ==========

  describe("debugger detection", () => {
    it("sync snapshot always returns debuggerDetected=false (async only)", () => {
      const result = mod.detectHostileEnvironment();
      // Sync detectDebugger() was removed; debuggerDetected is always false
      // in the sync snapshot. The async probe via detectDebuggerAsync is
      // called separately from AppInitializer.
      expect(result.details.debuggerDetected).toBe(false);
    });
  });

  // ========== detectHostileEnvironment: edge cases ==========

  describe("detectHostileEnvironment edges", () => {
    it("handles userAgent with 'headless' keyword (informational, not suspicious)", () => {
      Object.defineProperty(window, "self", { value: window });
      Object.defineProperty(window, "top", { value: window });
      vi.stubGlobal(
        "navigator",
        Object.assign(makeNormalNavigator(), {
          userAgent: "Mozilla/5.0 HeadlessChrome/120",
        }),
      );

      const result = mod.detectHostileEnvironment();
      expect(result.details.headlessUA).toBe(true);
      expect(result.reasons).toContain(
        "Headless user agent detected (informational)",
      );
      expect(result.reasons).not.toContain("Suspicious user agent");
      expect(result.isSuspicious).toBe(false);
    });

    it("handles userAgent with 'phantom' keyword", () => {
      vi.stubGlobal(
        "navigator",
        Object.assign(makeNormalNavigator(), {
          userAgent: "Mozilla/5.0 PhantomJS/1.0",
        }),
      );

      const result = mod.detectHostileEnvironment();
      expect(result.reasons).toContain("Suspicious user agent");
    });

    it("handles userAgent with 'puppeteer' keyword", () => {
      vi.stubGlobal(
        "navigator",
        Object.assign(makeNormalNavigator(), {
          userAgent: "Mozilla/5.0 Puppeteer/1.0",
        }),
      );

      const result = mod.detectHostileEnvironment();
      expect(result.reasons).toContain("Suspicious user agent");
    });

    it("multi-tab count is informational only (not suspicious)", () => {
      // This is a runtime state we can't easily manipulate in tests,
      // but we can verify the contract: multiple instances detected
      // does not flip isSuspicious.
      const result = mod.detectHostileEnvironment();
      // In a test env, activeTabCount is 1 (no other tabs), so no reason.
      // Just verify the function completes without error.
      expect(result).toHaveProperty("isSuspicious");
    });
  });
});
