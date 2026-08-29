import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectHostileEnvironment,
  initTabCounting,
  __resetTabCountingForTests,
} from "../../utils/environmentDetection";
import { getWindowChrome } from "../../utils/browser-types";

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("environmentDetection", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("detectHostileEnvironment", () => {
    it("returns all result fields", () => {
      const result = detectHostileEnvironment();
      expect(result).toHaveProperty("isInIframe");
      expect(result).toHaveProperty("isInDevMode");
      expect(result).toHaveProperty("isHeadless");
      expect(result).toHaveProperty("isSuspicious");
      expect(result).toHaveProperty("reasons");
      expect(Array.isArray(result.reasons)).toBe(true);
    });

    it("detects iframe when window.self !== window.top", () => {
      Object.defineProperty(window, "self", { value: {} });
      Object.defineProperty(window, "top", {
        value: { location: "different" },
      });
      const result = detectHostileEnvironment();
      expect(result.isInIframe).toBe(true);
      expect(result.isSuspicious).toBe(true);
      expect(result.reasons).toContain("Running in iframe");
    });

    it("detects no iframe when self === top", () => {
      Object.defineProperty(window, "self", { value: window });
      Object.defineProperty(window, "top", { value: window });
      const result = detectHostileEnvironment();
      expect(result.isInIframe).toBe(false);
    });

    it("detects headless but does NOT flag suspicious for WebDriver alone", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: true, configurable: true },
        userAgent: { value: "Mozilla/5.0 Chrome/120", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      Object.defineProperty(window, "outerWidth", {
        value: 1920,
        writable: true,
      });
      Object.defineProperty(window, "innerWidth", {
        value: 1920,
        writable: true,
      });
      const origCreateElement = document.createElement.bind(document);
      const canvasStub = vi
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

      const result = detectHostileEnvironment();
      expect(result.isHeadless).toBe(true);
      expect(result.details.webDriverPresent).toBe(true);
      expect(result.isSuspicious).toBe(false);
      expect(result.reasons).toContain(
        "Automated browser detected (WebDriver flag)",
      );

      canvasStub.mockRestore();
      vi.unstubAllGlobals();
    });

    it("detects not headless when webdriver is false", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "Mozilla/5.0 Chrome/120", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const result = detectHostileEnvironment();
      expect(result.isHeadless).toBe(false);
      vi.unstubAllGlobals();
    });

    it("does NOT flag suspicious for 'headless' user agent alone (informational)", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "HeadlessChrome", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const origCreateElement = document.createElement.bind(document);
      const canvasStub = vi
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
      const result = detectHostileEnvironment();
      expect(result.details.headlessUA).toBe(true);
      expect(result.reasons).toContain(
        "Headless user agent detected (informational)",
      );
      expect(result.reasons).not.toContain("Suspicious user agent");
      expect(result.isSuspicious).toBe(false);
      canvasStub.mockRestore();
      vi.unstubAllGlobals();
    });

    it("does NOT flag suspicious for headless UA even when webdriver is true (P27 align)", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: true, configurable: true },
        userAgent: { value: "HeadlessChrome", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const origCreateElement = document.createElement.bind(document);
      const canvasStub = vi
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
      const result = detectHostileEnvironment();
      expect(result.details.headlessUA).toBe(true);
      expect(result.details.webDriverPresent).toBe(true);
      expect(result.isSuspicious).toBe(false);
      canvasStub.mockRestore();
      vi.unstubAllGlobals();
    });

    it.each([
      {
        label: "webdriver=true + clean UA (realistic Chromium UA)",
        webdriver: true,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        headlessUA: false,
        webDriverPresent: true,
        terminal: false,
      },
      {
        label: "HeadlessChrome UA still flagged as a signal (webdriver=false)",
        webdriver: false,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
        headlessUA: true,
        webDriverPresent: false,
        terminal: false,
      },
      {
        label: "HeadlessChrome UA + webdriver=true (exact Playwright default)",
        webdriver: true,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
        headlessUA: true,
        webDriverPresent: true,
        terminal: false,
      },
      {
        label: "Selenium UA (unambiguous automation tool) is terminal",
        webdriver: false,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          + "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Selenium/4.0.0",
        headlessUA: false,
        webDriverPresent: false,
        terminal: true,
      },
    ])(
      "P27 contract — $label: headlessUA=$headlessUA, "
        + "webDriverPresent=$webDriverPresent, terminal=$terminal",
      ({ webdriver, ua, headlessUA, webDriverPresent, terminal }) => {
        Object.defineProperty(window, "self", { value: window });
        Object.defineProperty(window, "top", { value: window });
        const mockNav = Object.create(Navigator.prototype);
        Object.defineProperties(mockNav, {
          webdriver: { value: webdriver, configurable: true },
          userAgent: { value: ua, configurable: true },
          platform: { value: "Win32", configurable: true },
          language: { value: "en-US", configurable: true },
          onLine: { value: true, configurable: true },
          hardwareConcurrency: { value: 4, configurable: true },
        });
        vi.stubGlobal("navigator", mockNav);
        Object.defineProperty(window, "outerWidth", {
          value: 1920,
          writable: true,
        });
        Object.defineProperty(window, "innerWidth", {
          value: 1920,
          writable: true,
        });
        const origCreateElement = document.createElement.bind(document);
        const canvasStub = vi
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

        const result = detectHostileEnvironment();

        expect(result.details.headlessUA).toBe(headlessUA);
        expect(result.details.webDriverPresent).toBe(webDriverPresent);
        if (headlessUA) {
          expect(result.reasons).toContain(
            "Headless user agent detected (informational)",
          );
        }
        if (terminal) {
          expect(result.reasons).toContain("Suspicious user agent");
          expect(result.isSuspicious).toBe(true);
        } else {
          expect(result.reasons).not.toContain("Suspicious user agent");
          expect(result.isSuspicious).toBe(false);
        }

        canvasStub.mockRestore();
        vi.unstubAllGlobals();
      },
    );

    it("flags suspicious for phantom user agent (explicit tool)", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "PhantomJS", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const result = detectHostileEnvironment();
      expect(result.reasons).toContain("Suspicious user agent");
      expect(result.isSuspicious).toBe(true);
      vi.unstubAllGlobals();
    });

    it("detects phantom user agent", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "PhantomJS", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const result = detectHostileEnvironment();
      expect(result.reasons).toContain("Suspicious user agent");
      vi.unstubAllGlobals();
    });

    it("detects selenium user agent", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "Selenium", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const result = detectHostileEnvironment();
      expect(result.reasons).toContain("Suspicious user agent");
      vi.unstubAllGlobals();
    });

    it("detects puppeteer user agent", () => {
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "Puppeteer", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      const result = detectHostileEnvironment();
      expect(result.reasons).toContain("Suspicious user agent");
      vi.unstubAllGlobals();
    });

    it("detects open DevTools by dimensions (informational, not suspicious)", () => {
      Object.defineProperty(window, "outerWidth", {
        value: 1920,
        writable: true,
      });
      Object.defineProperty(window, "innerWidth", {
        value: 1700,
        writable: true,
      });
      Object.defineProperty(window, "outerHeight", {
        value: 1080,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 900,
        writable: true,
      });
      const result = detectHostileEnvironment();
      expect(result.reasons).toContain("DevTools detected (informational)");
      // DevTools is informational — does NOT flip isSuspicious
      expect(result.isSuspicious).toBe(false);
    });

    it("has no suspicious reasons in a normal environment", () => {
      Object.defineProperty(window, "self", { value: window });
      Object.defineProperty(window, "top", { value: window });
      const mockNav = Object.create(Navigator.prototype);
      Object.defineProperties(mockNav, {
        webdriver: { value: false, configurable: true },
        userAgent: { value: "Mozilla/5.0 Chrome/120", configurable: true },
        platform: { value: "Win32", configurable: true },
        language: { value: "en-US", configurable: true },
        onLine: { value: true, configurable: true },
        hardwareConcurrency: { value: 4, configurable: true },
      });
      vi.stubGlobal("navigator", mockNav);
      Object.defineProperty(window, "outerWidth", {
        value: 1920,
        writable: true,
      });
      Object.defineProperty(window, "innerWidth", {
        value: 1920,
        writable: true,
      });
      Object.defineProperty(window, "outerHeight", {
        value: 1080,
        writable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 1080,
        writable: true,
      });
      const result = detectHostileEnvironment();
      expect(result.isSuspicious).toBe(false);
      expect(result.reasons).toHaveLength(0);
      vi.unstubAllGlobals();
    });

    it("handles chrome.runtime.id without errors", () => {
      const mockChrome = { runtime: { id: "ext-id" } };
      const w = getWindowChrome();
      w.chrome = mockChrome;
      const result = detectHostileEnvironment();
      expect(result.reasons).toContain("Extension context detected");
      delete w.chrome;
    });
  });

  describe("initTabCounting", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    function createBCMock() {
      const instances: Array<{
        postMessage: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
        addEventListener: ReturnType<typeof vi.fn>;
        removeEventListener: ReturnType<typeof vi.fn>;
        onmessage: ((event: MessageEvent) => void) | null;
      }> = [];
      const mockBC = vi.fn(function () {
        const bcInstance = {
          postMessage: vi.fn(),
          close: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          onmessage: null as ((event: MessageEvent) => void) | null,
        };
        instances.push(bcInstance);
        return bcInstance;
      });
      vi.stubGlobal("BroadcastChannel", mockBC);
      return { mockBC, instances };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      __resetTabCountingForTests();
    });

    it("BroadcastChannel mock works correctly", () => {
      const { instances } = createBCMock();
      expect(typeof BroadcastChannel).toBe("function");
      const inst = new BroadcastChannel("test");
      expect(inst.postMessage).toBeDefined();
      expect(instances).toHaveLength(1);
    });

    it("creates a BroadcastChannel for tab counting", () => {
      const { mockBC } = createBCMock();
      initTabCounting();
      // First call = main channel, second = probe channel (reused across queries)
      expect(mockBC).toHaveBeenCalledWith("bkmf_tab_channel");
    });

    it("does nothing if BroadcastChannel is not available", () => {
      vi.stubGlobal("BroadcastChannel", undefined);
      expect(() => initTabCounting()).not.toThrow();
    });

    it("assigns an onmessage handler to the first channel", () => {
      const { instances } = createBCMock();
      initTabCounting();
      expect(typeof instances[0]?.onmessage).toBe("function");
    });

    it("onmessage handler responds to ping with pong", () => {
      const { instances } = createBCMock();
      initTabCounting();
      const handler = instances[0]!.onmessage as (event: MessageEvent) => void;
      handler({ data: "ping" } as MessageEvent);
      expect(instances[0]!.postMessage).toHaveBeenCalledWith("pong");
    });

    it("the onmessage handler ignores events that are not ping", () => {
      const { instances } = createBCMock();
      initTabCounting();
      instances[0]!.postMessage.mockClear();
      const handler = instances[0]!.onmessage as (event: MessageEvent) => void;
      handler({ data: "other" } as MessageEvent);
      expect(instances[0]!.postMessage).not.toHaveBeenCalled();
    });

    it("closes the BroadcastChannel on pagehide", () => {
      const { instances } = createBCMock();
      initTabCounting();
      const closeSpy = instances[0]!.close;
      window.dispatchEvent(new Event("pagehide"));
      expect(closeSpy).toHaveBeenCalled();
    });

    it("does not fail if pagehide fires without an active channel", () => {
      window.dispatchEvent(new Event("pagehide"));
    });

    it("probe channel is created and reused for tab queries", () => {
      const { instances } = createBCMock();
      initTabCounting();
      // Main channel = index 0, probe channel = index 1
      expect(instances.length).toBeGreaterThanOrEqual(2);
      // Probe channel has addEventListener (reused, not recreated per query)
      expect(instances[1]?.addEventListener).toBeDefined();
    });

    it("programa setInterval para queryActiveTabs", () => {
      createBCMock();
      const setIntervalSpy = vi.spyOn(window, "setInterval");
      initTabCounting();
      expect(setIntervalSpy).toHaveBeenCalled();
      expect(setIntervalSpy.mock.calls[0]![1]!).toBe(5000);
    });

    it("handles BroadcastChannel errors silently", () => {
      vi.stubGlobal(
        "BroadcastChannel",
        vi.fn().mockImplementation(() => {
          throw new Error("BC failed");
        }),
      );
      expect(() => initTabCounting()).not.toThrow();
    });
  });
});
