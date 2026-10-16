/**
 * Environment Detection for Security
 * Detects hostile or suspicious environments that may indicate piracy,
 * unauthorized use, or debugging/tampering attempts.
 *
 * Hardened per secure-code-review-checklist:
 * - Detects tampered console, prototypes, and headless/automation UAs.
 * - Debugger / DevTools / multi-tab signals are INFORMATIONAL only (no
 *   functional gate) to align with the local-first, user-owns-device
 *   philosophy.
 */

import { logger } from "./logger";
import { getWindowChrome } from "./browser-types";

interface EnvironmentDetectionResult {
  isInIframe: boolean;
  isInDevMode: boolean;
  isHeadless: boolean;
  isSuspicious: boolean;
  reasons: string[];
  details: EnvironmentDetectionDetails;
}

interface EnvironmentDetectionDetails {
  devToolsOpen: boolean;
  consoleTampered: boolean;
  debuggerDetected: boolean;
  prototypeTampered: boolean;
  proxyLikely: boolean;
  timeSkewed: boolean;
  webDriverPresent: boolean;
  headlessUA: boolean;
  canvasFingerprintBlocked: boolean;
}

let activeTabCount = 1;

export function detectHostileEnvironment(): EnvironmentDetectionResult {
  const reasons: string[] = [];
  let suspicious = false;

  // 1. Check if running in iframe
  const isInIframe = window.self !== window.top;
  if (isInIframe) {
    reasons.push("Running in iframe");
    suspicious = true;
  }

  // 2. Check dev mode - ONLY explicit VITE_DEV_MODE flag
  const isInDevMode = import.meta.env.VITE_DEV_MODE === "true";
  if (isInDevMode) {
    reasons.push("Running in DEV MODE");
    // Dev mode is allowed with explicit flag, not suspicious
  }

  // 3. Check for headless browser (automation tools)
  // `navigator.webdriver` is a standard signal present in legitimate E2E
  // tests, CI pipelines, accessibility extensions, and monitoring agents.
  // Record it as an informational signal only — never flip isSuspicious.
  const isHeadless = navigator.webdriver === true;
  if (isHeadless) {
    reasons.push("Automated browser detected (WebDriver flag)");
  }

  // 4. Check for suspicious user agent patterns
  //
  // The bare "headless" keyword is informational only (kiosks, SSR,
  // headless Chrome). Only unambiguous automation-tool UA strings
  // (Phantom, Selenium, Puppeteer — never present in a real browser)
  // are terminal.
  const userAgent = navigator.userAgent.toLowerCase();
  const hasHeadlessUA = userAgent.includes("headless");
  const isAutomationToolUA =
    userAgent.includes("phantom") ||
    userAgent.includes("selenium") ||
    userAgent.includes("puppeteer");
  if (hasHeadlessUA) {
    reasons.push("Headless user agent detected (informational)");
  }
  if (isAutomationToolUA) {
    reasons.push("Suspicious user agent");
    suspicious = true;
  }

  // 5. DevTools-like dimensions — INFORMATIONAL ONLY.
  // DevTools open does not indicate piracy or tampering; the user owns
  // the device and may legitimately debug the app. Record the signal
  // for telemetry but never mark the environment as suspicious.
  const widthThreshold = 160;
  const heightThreshold = 160;
  const isDevToolsOpen =
    window.outerWidth - window.innerWidth > widthThreshold ||
    window.outerHeight - window.innerHeight > heightThreshold;

  if (isDevToolsOpen && !isInDevMode) {
    reasons.push("DevTools detected (informational)");
  }

  // 6. Check for suspicious window properties (Chrome extension runtime)
  if (getWindowChrome().chrome?.runtime?.id) {
    reasons.push("Extension context detected");
  }

  // 7. Multi-tab count — INFORMATIONAL ONLY.
  // BookmarkForge explicitly supports multi-tab use (BroadcastChannel,
  // RxDB leader election, cross-tab sync). >3 tabs is normal usage,
  // not hostile.
  if (activeTabCount > 3) {
    reasons.push("Multiple instances detected (informational)");
  }

  // 8. Detect tampered console (common in automated scraping)
  const consoleTampered = detectConsoleTampering();
  if (consoleTampered) {
    reasons.push("Console API tampered");
    suspicious = true;
  }

  // 9. Debugger detection is deferred entirely to the async path
  // (detectDebuggerAsync) called from AppInitializer via
  // requestIdleCallback. The synchronous 500K-iteration loop has been
  // removed to eliminate ~50 ms of main-thread jank on every boot.
  // `debuggerDetected` stays false in the sync snapshot; the async
  // probe logs independently.
  const debuggerDetected = false;

  // 10. Detect tampered prototypes (prototype pollution / monkey-patching)
  const prototypeTampered = detectPrototypeTampering();
  if (prototypeTampered) {
    reasons.push("Prototype tampering detected");
    suspicious = true;
  }

  // 11. Proxy/MITM detection removed — the former probe created a
  // WebRTC connection to a public STUN server without producing a
  // usable signal, which leaked network metadata in a privacy-first app.
  const proxyLikely = false;

  // 12. Detect time skew — high threshold (5 min) to absorb legitimate
  // clock divergence from bfcache restores, sleep/resume, and browser
  // background throttling without false positives.
  const timeSkewed = detectTimeSkew();
  if (timeSkewed) {
    reasons.push("System clock skew detected");
    suspicious = true;
  }

  // 13. Detect if canvas fingerprinting is being blocked
  // (legitimate privacy tool, but also used by scraping bots)
  const canvasFingerprintBlocked = detectCanvasBlocking();
  if (canvasFingerprintBlocked && isHeadless) {
    // Only flag if also headless — legitimate users use privacy tools
    reasons.push("Canvas blocked in headless mode");
    suspicious = true;
  }

  const details: EnvironmentDetectionDetails = {
    devToolsOpen: isDevToolsOpen,
    consoleTampered,
    debuggerDetected,
    prototypeTampered,
    proxyLikely,
    timeSkewed,
    webDriverPresent: isHeadless,
    headlessUA: hasHeadlessUA,
    canvasFingerprintBlocked,
  };

  const result: EnvironmentDetectionResult = {
    isInIframe,
    isInDevMode,
    isHeadless,
    isSuspicious: suspicious,
    reasons,
    details,
  };

  if (suspicious && !isInDevMode) {
    logger.warn("[EnvironmentDetection] Hostile environment detected");
    logger.info("[EnvironmentDetection] result", { result });
  }

  return result;
}

// === HARDENED DETECTION HELPERS ===

/**
 * Detects if the console API has been tampered with.
 * Attackers/puppeteer scripts often override console methods.
 */
function detectConsoleTampering(): boolean {
  const nativeConsole = Object.getOwnPropertyDescriptor(
    window.console || {},
    "log",
  );
  if (!nativeConsole) {return false;}

  // Check if console.log is native or overridden
  const logStr = console.log.toString();
  if (
    logStr.includes("[native code]") === false &&
    logStr !== "function log() { [native code] }"
  ) {
    return true;
  }

  // Check for deleted console methods (common in scraping)
  if (
    typeof console.log === "undefined" ||
    typeof console.warn === "undefined" ||
    typeof console.error === "undefined"
  ) {
    return true;
  }
  return false;
}

/**
 * Async debugger detection via requestIdleCallback. Uses a 5M-iteration
 * timing side-channel during idle periods so it never blocks first paint.
 * The synchronous detectDebugger() (500K loop) has been removed from
 * detectHostileEnvironment to eliminate boot-time main-thread jank.
 */
export function detectDebuggerAsync(): Promise<boolean> {
  if (!import.meta.env.PROD) {return Promise.resolve(false);}

  if (typeof requestIdleCallback !== "undefined") {
    return new Promise<boolean>((resolve) => {
      requestIdleCallback(
        (deadline) => {
          if (deadline.timeRemaining() > 50 || deadline.didTimeout) {
            const start = performance.now();
            let acc = 0;
            for (let i = 0; i < 5_000_000; i++) {
              acc += Math.sqrt(i) * 1.000001;
            }
            void acc;
            const elapsed = performance.now() - start;
            resolve(elapsed > 500);
          } else {
            resolve(false);
          }
        },
        { timeout: 2000 },
      );
    });
  }

  // Fallback: synchronous probe (e.g. Node/test environments without rIC)
  if (!import.meta.env.PROD) {return Promise.resolve(false);}
  const start = performance.now();
  let acc = 0;
  for (let i = 0; i < 5_000_000; i++) {
    acc += Math.sqrt(i) * 1.000001;
  }
  void acc;
  return Promise.resolve(performance.now() - start > 500);
}

/**
 * Detects prototype tampering (prototype pollution attacks).
 * Checks if core prototypes have unexpected properties.
 */
function detectPrototypeTampering(): boolean {
  // Check Array.prototype for pollution
  const arrayProto = Array.prototype as unknown as Record<string, unknown>;
  const expectedArrayProps = new Set([
    "constructor",
    "at",
    "concat",
    "copyWithin",
    "entries",
    "every",
    "fill",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "flat",
    "flatMap",
    "forEach",
    "includes",
    "indexOf",
    "join",
    "keys",
    "lastIndexOf",
    "length",
    "map",
    "pop",
    "push",
    "reduce",
    "reduceRight",
    "reverse",
    "shift",
    "slice",
    "some",
    "sort",
    "splice",
    "toLocaleString",
    "toReversed",
    "toSorted",
    "toSpliced",
    "toString",
    "unshift",
    "values",
    "with",
    // Symbols
    Symbol.iterator,
    Symbol.unscopables,
    // SharedArrayBuffer symbol
  ]);

  let unexpectedCount = 0;
  for (const key of Object.getOwnPropertyNames(arrayProto)) {
    if (!expectedArrayProps.has(key)) {
      unexpectedCount++;
    }
  }

  if (unexpectedCount > 2) {return true;}

  // Check Object.prototype for pollution
  const objectProto = Object.prototype as unknown as Record<string, unknown>;
  const expectedObjectProps = new Set([
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
    "__proto__",
  ]);

  unexpectedCount = 0;
  for (const key of Object.getOwnPropertyNames(objectProto)) {
    if (!expectedObjectProps.has(key)) {
      unexpectedCount++;
    }
  }

  if (unexpectedCount > 2) {return true;}

  return false;
}

/**
 * Detects system clock skew (potential license bypass via time manipulation).
 * Compares Date.now() against a reference timestamp from a trusted source.
 * NOTE: Without an external time server, this is a heuristic.
 */
function detectTimeSkew(): boolean {
  // Check if performance.now() and Date.now() are in sync
  // If the system clock was rolled back, these will diverge
  const perfNow = performance.now();
  const dateNow = Date.now();

  // performance.timeOrigin is not available in Safari < 15
  // Fallback: use a stored reference from first load
  const actualOrigin =
    typeof performance.timeOrigin !== "undefined"
      ? performance.timeOrigin
      : _firstLoadTimeOrigin || dateNow - perfNow;

  if (!_firstLoadTimeOrigin) {
    _firstLoadTimeOrigin = actualOrigin;
  }

  const estimatedOrigin = dateNow - perfNow;

  // 5-minute tolerance absorbs clock divergence from bfcache restores,
  // sleep/resume, background throttling, and Safari <15 fallback paths.
  // A real license-bypass attempt (roll-back months) still exceeds this.
  if (Math.abs(estimatedOrigin - actualOrigin) > 5 * 60 * 1000) {
    return true;
  }

  return false;
}

// Module-level cache for time origin fallback (Safari < 15)
let _firstLoadTimeOrigin = 0;

/**
 * Detects if canvas is blocked (used by privacy tools and scraping bots).
 * Tries to render a 1x1 pixel and read it back.
 */
function detectCanvasBlocking(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) {return true;} // No 2d context — blocked

    ctx.fillStyle = "rgb(255,0,0)";
    ctx.fillRect(0, 0, 1, 1);

    const imageData = ctx.getImageData(0, 0, 1, 1);
    if (!imageData || imageData.data.length === 0) {
      return true; // Blocked
    }

    // Check that pixel data is accessible and correct
    if (
      imageData.data[0] === 0 &&
      imageData.data[1] === 0 &&
      imageData.data[2] === 0 &&
      imageData.data[3] === 0
    ) {
      return true; // All zeros — canvas blocked/randomized
    }

    return false;
  } catch (_err) {
    return true;
  }
}



let tabChannel: BroadcastChannel | null = null;
let probeChannel: BroadcastChannel | null = null;
let queryGeneration = 0;
let tabCountingInitialized = false;
let tabInterval: ReturnType<typeof setInterval> | null = null;
let tabPagehideHandler: (() => void) | null = null;
const pendingTabTimers = new Set<ReturnType<typeof setTimeout>>();

function cleanupTabCounting(): void {
  if (tabInterval !== null) {
    clearInterval(tabInterval);
    tabInterval = null;
  }
  for (const timer of pendingTabTimers) {
    clearTimeout(timer);
  }
  pendingTabTimers.clear();

  if (tabPagehideHandler && typeof window !== "undefined") {
    window.removeEventListener("pagehide", tabPagehideHandler);
    tabPagehideHandler = null;
  }
  try {
    tabChannel?.close();
  } catch {
    // A browser may already have closed the channel during page teardown.
  }
  tabChannel = null;
  try {
    probeChannel?.close();
  } catch {
    // Best effort.
  }
  probeChannel = null;
  queryGeneration = 0;
  tabCountingInitialized = false;
}

/**
 * Initializes tab counting for multi-instance detection.
 * Idempotent: repeated calls (e.g. HMR / StrictMode remounts) do not
 * accumulate intervals or BroadcastChannels.
 */
export function initTabCounting(): void {
  if (tabCountingInitialized) {return;}
  if (typeof BroadcastChannel === "undefined") {return;}

  try {
    tabCountingInitialized = true;
    tabChannel = new BroadcastChannel("bkmf_tab_channel");

    tabChannel.onmessage = (event) => {
      if (event.data === "ping") {
        try {
          tabChannel?.postMessage("pong");
        } catch {
          // The channel can close between dispatch and response.
        }
      }
    };

    // Reusable probe channel + generation counter: instead of creating and
    // closing a temporary BroadcastChannel every 5 seconds (GC churn),
    // keep a single probe channel alive across queries. The generation
    // counter lets us ignore stale pong responses from a previous query.
    const queryActiveTabs = () => {
      if (!tabChannel) {return;}

      try {
        if (!probeChannel) {
          probeChannel = new BroadcastChannel("bkmf_tab_channel");
        }
      } catch {
        logger.warn("BroadcastChannel probe channel failed");
        return;
      }

      let pongsReceived = 0;
      const gen = ++queryGeneration;

      const handler = (event: MessageEvent): void => {
        if (event.data === "pong" && gen === queryGeneration) {
          pongsReceived++;
          activeTabCount = pongsReceived + 1;
        }
      };

      probeChannel.addEventListener("message", handler);
      probeChannel.postMessage("ping");

      const timer = setTimeout(() => {
        pendingTabTimers.delete(timer);
        probeChannel?.removeEventListener("message", handler);
        if (gen === queryGeneration && pongsReceived === 0) {
          activeTabCount = 1;
        }
      }, 150);
      pendingTabTimers.add(timer);
    };

    tabPagehideHandler = cleanupTabCounting;
    window.addEventListener("pagehide", tabPagehideHandler);
    queryActiveTabs();
    tabInterval = setInterval(queryActiveTabs, 5000);
  } catch (error) {
    cleanupTabCounting();
    logger.warn("BroadcastChannel failed to initialize", { error });
  }
}

/**
 * Test-only helper: resets tab-counting singleton state so tests can re-run
 * initTabCounting() in isolation. Not used in production code paths.
 */
export function __resetTabCountingForTests(): void {
  cleanupTabCounting();
}
