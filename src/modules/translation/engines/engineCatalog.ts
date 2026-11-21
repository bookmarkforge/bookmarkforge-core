/**
 * src/modules/translation/engines/engineCatalog.ts
 *
 * Static description of every translation engine the module can drive.
 * Core (MIT): metadata only — importing this file never loads a runtime.
 */

import {
  LOCAL_MODEL_CATALOG,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_MODELS,
  PRO_ENGINES,
  PYTHON_DEFAULT_MODEL,
  PYTHON_MODELS,
  WEBLLM_MODELS,
} from "../constants";
import type {
  TranslationEngineDescriptor,
  TranslationEngineId,
} from "../types";

const CLOUD_DESCRIPTOR_BASE: TranslationEngineDescriptor = {
  id: "cloud",
  runtime: "cloud",
  modelId: "provider-default",
  label: "Cloud provider (your API key)",
  requiresPro: false,
  requiresWebGPU: false,
  minDeviceMemoryGB: 0,
  downloadBytes: 0,
  isLocal: false,
};

function describeLocal(
  engine: Exclude<TranslationEngineId, "cloud">,
  modelId: string,
): TranslationEngineDescriptor {
  const option =
    LOCAL_MODEL_CATALOG.find((model) => model.engine === engine && model.id === modelId) ??
    (engine === "webllm" ? WEBLLM_MODELS[0]! : undefined) ??
    (engine === "ollama" ? OLLAMA_MODELS[0]! : undefined) ??
    PYTHON_MODELS[0]!;

  return {
    id: engine,
    runtime:
      engine === "webllm" ? "webgpu" : engine === "python" ? "python-api" : "http",
    modelId: option.id,
    label: option.label,
    requiresPro: PRO_ENGINES.has(engine),
    requiresWebGPU: option.requiresWebGPU,
    minDeviceMemoryGB: option.minDeviceMemoryGB,
    downloadBytes: option.downloadBytes,
    isLocal: true,
  };
}

/**
 * Descriptor for one engine. `modelId` is optional: omitting it returns the
 * engine's currently recommended model, never an arbitrary catalog entry.
 */
export function describeEngine(
  engine: TranslationEngineId,
  modelId?: string,
): TranslationEngineDescriptor {
  if (engine === "cloud") {
    return { ...CLOUD_DESCRIPTOR_BASE, ...(modelId ? { modelId } : {}) };
  }
  return describeLocal(engine, modelId ?? defaultModelFor(engine));
}

function defaultModelFor(
  engine: Exclude<TranslationEngineId, "cloud">,
): string {
  switch (engine) {
    case "webllm":
      return WEBLLM_MODELS.find((model) => model.recommended)?.id ?? WEBLLM_MODELS[0]!.id;
    case "ollama":
      return OLLAMA_DEFAULT_MODEL;
    case "python":
      return PYTHON_DEFAULT_MODEL;
  }
}

/**
 * WebLLM model for a device. Mirrors WebLLMService's ladder, but the 1.5B
 * tier is the translation default: smaller models lose terminology on long
 * documents and the 8B tier does not fit the 4 GB floor. Only Apache-2.0
 * checkpoints are eligible here — Qwen2.5-3B is qwen-research
 * (non-commercial) and must not ship in this paid module.
 */
export function recommendedWebLLMModel(deviceMemoryGB: number): string {
  if (deviceMemoryGB >= 12) {return "Qwen2.5-7B-Instruct-q4f16_1-MLC";}
  if (deviceMemoryGB >= 4) {return "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";}
  return "Llama-3.2-1B-Instruct-q4f16_1-MLC";
}

/** All selectable descriptors, for the engine picker. */
export function listEngineDescriptors(): TranslationEngineDescriptor[] {
  return [
    describeEngine("cloud"),
    describeEngine("webllm"),
    describeEngine("ollama"),
    describeEngine("python"),
  ];
}

/**
 * Cache namespace. Changing the engine family invalidates cached pairs of a
 * DIFFERENT family only — a Qwen translation is never served to an Ollama
 * run, but switching model inside the same family keeps the cache warm.
 */
export function engineFamily(engine: TranslationEngineId): string {
  switch (engine) {
    case "webllm":
      return "webllm";
    case "ollama":
      return "ollama";
    case "python":
      return "python";
    case "cloud":
      return "cloud";
  }
}
