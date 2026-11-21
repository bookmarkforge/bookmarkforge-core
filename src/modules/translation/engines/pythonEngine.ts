/**
 * src/modules/translation/engines/pythonEngine.ts
 *
 * Python FastAPI translation engine bridge — Core (MIT).
 *
 * This engine bridges to an external Python FastAPI server running on
 * localhost:8000 (see D:\TRADUCTOR\ for the server implementation).
 *
 * The Python server provides:
 * - Automatic GPU/NPU detection (CUDA, MPS, DirectML)
 * - Multiple Hugging Face models (Opus-MT family; permissively licensed only)
 * - Rate limiting, security, and structured logging
 * - Consistent model caching
 *
 * Privacy posture: The Python server runs entirely on localhost,
 * so translated text never leaves the device. However, this is marked
 * as a Pro feature because it requires external setup (Python environment).
 *
 * Cost posture: Local Python translation has zero monetary cost.
 * savedUSD is calculated using the cloud provider's pricing table.
 *
 * FUTURE FEATURE: The Python server must be running separately. This is
 * intentionally not bundled with the app to keep the browser lightweight.
 */

import {
  PYTHON_DEFAULT_ENDPOINT,
  PYTHON_DEFAULT_MODEL,
  PYTHON_PROBE_TIMEOUT_MS,
} from "../constants";
import { TranslationError } from "../errors";

export interface PythonGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  rawSourceText: string;
  temperature: number;
  maxTokens: number;
  model?: string;
  endpoint?: string;
  /** Proxy mode: forward to user's own provider (BYOK) or Ollama via the Python bridge. */
  proxy?: {
    kind: "ollama" | "provider";
    providerEndpoint: string;
    apiKey?: string;
    providerModel: string;
  };
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface PythonGenerateResult {
  text: string;
  model: string;
  translationTime: string;
}

/**
 * Probe the Python translation API to check if it's running.
 * Used by capabilities.ts to determine if the engine is available.
 */
export async function probePythonEndpoint(
  endpoint: string = PYTHON_DEFAULT_ENDPOINT,
  timeoutMs: number = PYTHON_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${endpoint}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

/**
 * Translate text using the Python FastAPI server.
 *
 * The server supports both /translate (text) and /translate/file (file upload).
 * This implementation uses /translate for chunk-based translation.
 */
export async function pythonGenerate(
  options: PythonGenerateOptions,
): Promise<PythonGenerateResult> {
  const endpoint = options.endpoint ?? PYTHON_DEFAULT_ENDPOINT;
  const model = options.model ?? PYTHON_DEFAULT_MODEL;

  if (options.signal?.aborted) {
    throw new DOMException("Translation aborted", "AbortError");
  }

  try {
    // Proxy mode: forward to user's own provider/Ollama through the Python bridge.
    // The Python server normalizes the response; credentials never persist there.
    if (options.proxy) {
      const proxyPath = options.proxy.kind === "ollama" ? "/translate/ollama" : "/translate/provider";
      const messages = [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPrompt },
      ];
      const body = {
        endpoint: options.proxy.providerEndpoint,
        api_key: options.proxy.apiKey ?? "",
        model: options.proxy.providerModel,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        timeout: 120,
      };
      const controller = new AbortController();
      const signal = options.signal;
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      const response = await fetch(`${endpoint}${proxyPath}`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new TranslationError(
          "generation-failed",
          (err as { detail?: string }).detail || `HTTP ${response.status}`,
        );
      }
      const data = (await response.json()) as { translated?: string };
      if (!data.translated) {
        throw new TranslationError("generation-failed", "Empty translation from proxy");
      }
      return { text: data.translated, model: options.proxy.providerModel, translationTime: "proxy" };
    }

    // Direct Hugging Face model on the Python server.
    const url = new URL(`${endpoint}/translate`);
    url.searchParams.append("text", options.rawSourceText);
    url.searchParams.append("model", model);
    url.searchParams.append("clean_code", "false"); // We handle chunking ourselves

    const controller = new AbortController();
    const signal = options.signal;

    // Forward abort signal
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new TranslationError(
        "generation-failed",
        errorData.detail || `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const data = await response.json();

    if (!data.translated) {
      throw new TranslationError(
        "generation-failed",
        "Python API returned empty translation",
      );
    }

    return {
      text: data.translated,
      model: data.model || model,
      translationTime: data.translation_time || "unknown",
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    if (error instanceof TranslationError) {
      throw error;
    }

    throw new TranslationError(
      "generation-failed",
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

/**
 * List available models from the Python server.
 * Used by the UI to populate the model selector.
 */
export async function listPythonModels(
  endpoint: string = PYTHON_DEFAULT_ENDPOINT,
): Promise<{ id: string; name: string }[]> {
  try {
    const response = await fetch(`${endpoint}/models`, {
      method: "GET",
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.models || [];
  } catch {
    return [];
  }
}
