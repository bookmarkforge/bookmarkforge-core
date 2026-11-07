/**
 * src/modules/translation/engines/capabilities.ts
 *
 * Device/plan probing for engine selection — Core (MIT).
 *
 * Deliberately does NOT call `WebLLMService.canRunLocalLLM()`: that would load
 * the Pro runtime (and its multi-hundred-KB chunk) just to answer "is WebGPU
 * usable?", which is exactly the leak the Pro seam exists to prevent. The
 * ladder below mirrors WebLLMService's (surface → shader-f16 → 4 GB), and the
 * worker re-checks capability itself when it actually creates an engine, so a
 * stale probe can never bypass a real hardware gate.
 */

import {
  getNavigatorExtensions,
  getNavigatorGPU,
} from "../../../utils/browser-types";
import {
  cancelResponseBody,
  fetchWithTimeout,
} from "../../../services/ai/utils";
import { aiManager } from "../../../services/ai/ProviderManager";
import {
  LOCAL_AI_MIN_DEVICE_MEMORY_GB,
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_PROBE_TIMEOUT_MS,
} from "../constants";
import type { TranslationCapabilities } from "../types";

/** Ollama may be started AFTER the app: an unreachable verdict expires. */
const OLLAMA_PROBE_CACHE_TTL_MS = 60_000;

interface ProbeCache {
  webgpu: Promise<{ webgpu: boolean; shaderF16: boolean }> | null;
  ollama: Map<string, { promise: Promise<boolean>; at: number }>;
}

const cache: ProbeCache = { webgpu: null, ollama: new Map() };

async function probeWebGpu(): Promise<{ webgpu: boolean; shaderF16: boolean }> {
  if (cache.webgpu) {return cache.webgpu;}
  cache.webgpu = (async () => {
    try {
      const gpu = getNavigatorGPU();
      if (!gpu) {return { webgpu: false, shaderF16: false };}
      const adapter =
        (await gpu.requestAdapter({ powerPreference: "high-performance" })) ||
        (await gpu.requestAdapter({ powerPreference: "low-power" }));
      if (!adapter) {return { webgpu: false, shaderF16: false };}
      const features = (adapter as { features?: Set<string> }).features;
      return {
        webgpu: true,
        shaderF16: features?.has("shader-f16") ?? false,
      };
    } catch {
      // INTENTIONAL SILENCE: a rejected adapter probe IS the "no WebGPU"
      // verdict; there is nothing to log that the caller does not already see
      // as `webgpu: false`.
      return { webgpu: false, shaderF16: false };
    }
  })();
  return cache.webgpu;
}

/** Loopback probe of an Ollama server. Never throws; unreachable is a value. */
export async function probeOllama(
  endpoint: string = OLLAMA_DEFAULT_ENDPOINT,
): Promise<boolean> {
  const cached = cache.ollama.get(endpoint);
  if (cached && Date.now() - cached.at < OLLAMA_PROBE_CACHE_TTL_MS) {
    return cached.promise;
  }
  const probe = (async () => {
    try {
      const res = await fetchWithTimeout(
        `${endpoint.replace(/\/+$/, "")}/api/tags`,
        { method: "GET" },
        OLLAMA_PROBE_TIMEOUT_MS,
      );
      const reachable = res.ok;
      await cancelResponseBody(res);
      return reachable;
    } catch {
      // INTENTIONAL SILENCE: unreachable loopback server is the expected
      // "Ollama not installed" state; the selector turns it into a reason.
      return false;
    }
  })();
  cache.ollama.set(endpoint, { promise: probe, at: Date.now() });
  return probe;
}

/**
 * Full capability snapshot used by the selector.
 *
 * `cloudConfigured` reads the existing provider manager (Core) — it answers
 * "is a BYOK key available", never "is the key valid".
 */
export async function probeTranslationCapabilities(options?: {
  ollamaEndpoint?: string;
}): Promise<TranslationCapabilities> {
  const [gpu, ollamaReachable] = await Promise.all([
    probeWebGpu(),
    probeOllama(options?.ollamaEndpoint),
  ]);
  const deviceMemoryGB =
    getNavigatorExtensions().deviceMemory || LOCAL_AI_MIN_DEVICE_MEMORY_GB;

  let cloudConfigured = false;
  try {
    cloudConfigured = aiManager.getProviderInfo().isConfigured;
  } catch {
    // INTENTIONAL SILENCE: a provider manager that cannot answer yet (vault
    // still locked during boot) means "no cloud engine", which is fail-closed.
    cloudConfigured = false;
  }

  return {
    webgpu: gpu.webgpu,
    shaderF16: gpu.shaderF16,
    deviceMemoryGB,
    hardwareConcurrency: navigator.hardwareConcurrency || 4,
    ollamaReachable,
    cloudConfigured,
  };
}

