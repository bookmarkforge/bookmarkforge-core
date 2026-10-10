/**
 * SupportDiagnostics — real browser capability probes for the Help Center
 * Diagnostics tab. Each check performs an actual probe (IndexedDB write/read
 * round-trip, Storage Quota API, WebRTC ICE gathering, WebGPU adapter lookup,
 * network status, Ollama reachability, WebLLM readiness) instead of returning
 * hardcoded results.
 *
 * All functions are defensive: they resolve (never reject) and fall back to
 * a "not available / failed" result when the underlying API is missing or
 * blocked (private browsing, quota limits, browser support).
 */

import { getNavigatorExtensions } from "../utils/browser-types";
import type { WebLLMCapabilityBlocker } from "./ai-types";
import { loadWebLLMService } from "./pro-access";

export interface StorageEstimate {
  usageBytes: number;
  quotaBytes: number;
}

type WebRtcStatus = "ok" | "unavailable" | "failed";

interface WebRtcResult {
  status: WebRtcStatus;
  /** Time it took ICE gathering to complete, when the check succeeded. */
  elapsedMs: number | null;
}

/** Result of the live network probe. */
interface NetworkStatus {
  online: boolean;
  /** Network Information API effective type ("4g", "3g", ...), if exposed. */
  effectiveType?: string;
  /** `true` when the browser is in data-saver mode. */
  saveData?: boolean;
}

/** Result of the Ollama reachability probe. */
interface OllamaStatus {
  available: boolean;
  url?: string;
  model?: string;
}

/** Result of the WebLLM readiness probe. */
interface WebLLMStatus {
  /** Whether WebGPU + RAM allow running WebLLM on this device. */
  canRun: boolean;
  /** Whether a model is currently loaded in memory. */
  modelLoaded: boolean;
  currentModel?: string;
  /**
   * The precise capability blocker when `canRun` is false, from the SAME
   * ladder the generation gates throw (webgpu-unavailable /
   * shader-f16-unsupported / insufficient-memory). Absent when the device
   * is capable — and also absent on probe failure, where no verdict of any
   * kind exists. Lets the support view tell users WHY local AI is
   * unavailable instead of a generic "WebGPU or RAM required".
   */
  blocker?: WebLLMCapabilityBlocker;
}

interface StorageApi {
  storage?: {
    estimate?: () => Promise<{ usage?: number; quota?: number }>;
  };
}

interface NavigatorWithGPU {
  gpu?: {
    requestAdapter?: () => Promise<{ [key: string]: unknown } | null>;
  };
}

const DIAG_DB_NAME = "bmf-support-diag";
const DIAG_STORE = "probe";
const PROBE_KEY = "probe";

/**
 * Real IndexedDB write/read round-trip. Resolves `true` only when the value
 * written to a temporary store can be read back unchanged. The tiny probe
 * store is intentionally reused across runs (no cleanup race with a second
 * run of the diagnostics).
 */
export function checkIndexedDB(timeoutMs = 8000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    // eslint-disable-next-line prefer-const -- declared separately so finish() can close over it
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      if (settled) {return;}
      settled = true;
      if (timer !== undefined) {clearTimeout(timer);}
      resolve(ok);
    };

    if (typeof indexedDB === "undefined") {
      finish(false);
      return;
    }

    timer = setTimeout(() => finish(false), timeoutMs);

    try {
      const openReq = indexedDB.open(DIAG_DB_NAME, 1);

      openReq.onupgradeneeded = () => {
        const db = openReq.result;
        if (!db.objectStoreNames.contains(DIAG_STORE)) {
          db.createObjectStore(DIAG_STORE);
        }
      };

      openReq.onerror = () => finish(false);
      openReq.onblocked = () => finish(false);

      openReq.onsuccess = () => {
        const db = openReq.result;
        try {
          const tx = db.transaction(DIAG_STORE, "readwrite");
          const store = tx.objectStore(DIAG_STORE);
          const value = `ok-${Date.now()}`;

          tx.onabort = () => {
            try {db.close();} catch { /* INTENTIONAL SILENCE: diagnostic cleanup must not change the probe result. */ }
            finish(false);
          };

          const putReq = store.put(value, PROBE_KEY);
          putReq.onerror = () => {
            try {db.close();} catch { /* INTENTIONAL SILENCE: diagnostic cleanup must not change the probe result. */ }
            finish(false);
          };

          const getReq = store.get(PROBE_KEY);
          getReq.onsuccess = () => {
            const ok = getReq.result === value;
            try {db.close();} catch { /* INTENTIONAL SILENCE: diagnostic cleanup must not change the probe result. */ }
            finish(ok);
          };
          getReq.onerror = () => {
            try {db.close();} catch { /* INTENTIONAL SILENCE: diagnostic cleanup must not change the probe result. */ }
            finish(false);
          };
        } catch (_err) {
          try {db.close();} catch { /* INTENTIONAL SILENCE: diagnostic cleanup must not change the probe result. */ }
          finish(false);
        }
      };
    } catch (_err) {
      finish(false);
    }
  });
}

/**
 * Reads the browser's storage quota via `navigator.storage.estimate()`.
 * Resolves `null` when the API is not exposed (older/restricted browsers).
 */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  const storage = (navigator as StorageApi).storage;
  if (!storage?.estimate) {return null;}
  try {
    const est = await storage.estimate();
    return {
      usageBytes: typeof est.usage === "number" ? est.usage : 0,
      quotaBytes: typeof est.quota === "number" ? est.quota : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Probes the WebRTC API by creating a peer connection and waiting for ICE
 * gathering to complete. No ICE servers are configured so the check never
 * makes external STUN/TURN calls — it only proves the API is functional.
 */
export function checkWebRTC(timeoutMs = 8000): Promise<WebRtcResult> {
  return new Promise<WebRtcResult>((resolve) => {
    let settled = false;
    let pc: RTCPeerConnection | null = null;
    // eslint-disable-next-line prefer-const -- declared separately so finish() can close over it
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (status: WebRtcStatus, elapsedMs: number | null = null) => {
      if (settled) {return;}
      settled = true;
      if (timer !== undefined) {clearTimeout(timer);}
      try {pc?.close();} catch { /* INTENTIONAL SILENCE: diagnostic cleanup must not change the probe result. */ }
      resolve({ status, elapsedMs });
    };

    if (typeof RTCPeerConnection === "undefined") {
      finish("unavailable");
      return;
    }

    timer = setTimeout(() => finish("failed"), timeoutMs);

    try {
      pc = new RTCPeerConnection();
      const started = performance.now();
      const markComplete = () =>
        finish("ok", Math.round(performance.now() - started));

      pc.onicecandidate = (event) => {
        if (!event.candidate) {markComplete();}
      };
      pc.onicegatheringstatechange = () => {
        if (pc?.iceGatheringState === "complete") {markComplete();}
      };
      pc.oniceconnectionstatechange = () => {
        if (pc?.iceConnectionState === "failed") {finish("failed");}
      };

      pc.createDataChannel("bmf-diag");
      pc.createOffer()
        .then((offer) => pc!.setLocalDescription(offer))
        .catch(() => finish("failed"));
    } catch {
      finish("failed");
    }
  });
}

/**
 * Checks WebGPU support by requesting an adapter. Resolves `true` only when
 * the browser exposes `navigator.gpu` AND an adapter is actually available.
 */
export async function checkWebGPU(): Promise<boolean> {
  const gpu = (navigator as NavigatorWithGPU).gpu;
  if (!gpu?.requestAdapter) {return false;}
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Reads the live network state: `navigator.onLine` plus the Network
 * Information API (effective type / data-saver), when exposed. Synchronous
 * and never throws.
 */
export function checkNetwork(): NetworkStatus {
  const connection = getNavigatorExtensions().connection;
  return {
    online:
      typeof navigator !== "undefined" ? (navigator.onLine ?? true) : false,
    effectiveType: connection?.effectiveType,
    saveData: connection?.saveData,
  };
}

/**
 * Probes local Ollama reachability by reusing `aiManager.isOllamaAvailable()`
 * (which performs a real fetch to the configured Ollama `/api/tags` endpoint
 * with a 60s cache — so re-running diagnostics may report a result up to a
 * minute stale, which avoids hammering the local endpoint) and reports the
 * configured URL/model.
 */
export async function checkOllama(): Promise<OllamaStatus> {
  try {
    const { aiManager } = await import("./ai/ProviderManager");
    const available = await aiManager.isOllamaAvailable();
    const settings = aiManager.getOllamaSettings();
    return {
      available,
      url: settings?.url,
      model: settings?.model,
    };
  } catch {
    return { available: false };
  }
}

/**
 * Probes WebLLM readiness using the existing `webLLMService`.
 *
 * The returned fields carry two DIFFERENT verdicts that must not be
 * conflated: `canRun` is the device-capability check (webLLMService
 * .canRunLocalLLM(): WebGPU surface + shader-f16 + >= 4 GB RAM — says
 * nothing about engine/model state), while `modelLoaded`/`currentModel`
 * are the ENGINE state. A device can be runable with no model loaded
 * (canRun=true, modelLoaded=false) or blocked with nothing loaded
 * (canRun=false, modelLoaded=false); the support view's WebLLM line
 * renders from exactly this pair.
 */
export async function checkWebLLM(): Promise<WebLLMStatus> {
  try {
    // Gated resolution: without Pro (or in an Open Core export) this rejects
    // and the catch below reports the honest "not capable / not loaded" pair.
    const webLLMService = await loadWebLLMService();
    const blocker = await webLLMService.getCapabilityBlocker();
    const canRun = blocker === null;
    const modelLoaded = webLLMService.isModelLoaded();
    const currentModel = webLLMService.getCurrentModel();
    return {
      canRun,
      modelLoaded,
      currentModel: currentModel || undefined,
      // Present exactly when canRun is false — the enum is the user-facing
      // "why". Dropped (not null) when capable so the shape stays lean and
      // `blocker in status` is a valid truthiness test for callers.
      ...(blocker ? { blocker } : {}),
    };
  } catch {
    return { canRun: false, modelLoaded: false };
  }
}

/** Formats a byte count into a human-readable size (B/KB/MB/GB/TB). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {return "0 B";}
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    unit === 0 || value >= 100 || value % 1 === 0
      ? Math.round(value).toString()
      : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}
