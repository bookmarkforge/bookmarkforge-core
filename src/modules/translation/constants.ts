/**
 * src/modules/translation/constants.ts
 *
 * Single source of truth for the translation module's tunables and model
 * catalog. Core (MIT): pure data, no runtime engine imports.
 *
 * Every number here is a deliberate contract:
 *  - Chunk bounds are in ESTIMATED tokens (see `chunking/tokenEstimator.ts`);
 *    a real tokenizer is model-specific and would force the model vocabulary
 *    into the main bundle.
 *  - `THERMAL_PACING_MS` is the 1.5 s GPU cooldown applied between heavy
 *    chunks. It only applies when a chunk exceeds `THERMAL_CHUNK_MIN_TOKENS`
 *    (small chunks are cheap; pacing them would just double the wall clock).
 *  - `MAX_TEMPERATURE` is 0.2 BY POLICY: translation is a fidelity task, and
 *    a small model at temperature 1 invents content. The pipeline sends 0.
 */

import type { TranslationEngineId, LocalEngineId } from "./types";

/** Chunking bounds (estimated tokens). */
export const CHUNK_TARGET_TOKENS = 700;
export const CHUNK_MAX_TOKENS = 1000;
export const CHUNK_MIN_TOKENS = 400;
/** Deterministic decoding. */
export const TRANSLATION_TEMPERATURE = 0;
export const REVIEW_TEMPERATURE = 0;
export const TRANSLATION_MAX_OUTPUT_TOKENS = 2048;

/** Thermal / GPU protection. */
export const THERMAL_PACING_MS = 1500;
export const THERMAL_CHUNK_MIN_TOKENS = 450;

/** Context budget for the injected glossary (system-prompt rules). */
export const MAX_GLOSSARY_ENTRIES = 60;
export const MAX_GLOSSARY_CHARS = 4_000;

/** Cache bounds (encrypted IndexedDB via SecureStorage). */
export const TRANSLATION_CACHE_VERSION = 1;
export const TRANSLATION_CACHE_MAX_DOCUMENTS = 24;
export const TRANSLATION_CACHE_FLUSH_DEBOUNCE_MS = 400;
export const TRANSLATION_CACHE_MAX_PAIRS_PER_DOCUMENT = 800;

/** Ollama loopback defaults. Already allowed by the app CSP. */
export const OLLAMA_DEFAULT_ENDPOINT = "http://localhost:11434";
export const OLLAMA_DEFAULT_MODEL = "qwen2.5:7b";
export const OLLAMA_PROBE_TIMEOUT_MS = 2_500;

/** WebGPU capability ladder mirrored from WebLLMService (kept in Core so the
 * selector can probe WITHOUT loading the Pro runtime). */
export const LOCAL_AI_MIN_DEVICE_MEMORY_GB = 4;

/**
 * Pinned model catalog.
 *
 * `webllm` ids must exist in the MLC prebuilt registry shipped with the
 * installed @mlc-ai/web-llm version; the worker re-checks that list before
 * creating an engine (a compromised remote registry must never be able to
 * inject a model).
 */
export interface TranslationModelOption {
  id: string;
  label: string;
  engine: LocalEngineId;
  /** Approximate 4-bit download. Used only to ask for consent before fetching. */
  downloadBytes: number;
  requiresWebGPU: boolean;
  minDeviceMemoryGB: number;
  /** All 30 shipped locales are covered; low-density pairs prefer NLLB. */
  multilingual: boolean;
  recommended?: boolean;
}

export const WEBLLM_MODELS: TranslationModelOption[] = [
  {
    id: "Qwen2.5-3B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 3B Instruct (q4f16)",
    engine: "webllm",
    downloadBytes: 2_100_000_000,
    requiresWebGPU: true,
    minDeviceMemoryGB: 4,
    multilingual: true,
    recommended: true,
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B Instruct (q4f16)",
    engine: "webllm",
    downloadBytes: 2_000_000_000,
    requiresWebGPU: true,
    minDeviceMemoryGB: 4,
    multilingual: true,
  },
  {
    id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 7B Instruct (q4f16)",
    engine: "webllm",
    downloadBytes: 4_500_000_000,
    requiresWebGPU: true,
    minDeviceMemoryGB: 12,
    multilingual: true,
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B Instruct (q4f16)",
    engine: "webllm",
    downloadBytes: 800_000_000,
    requiresWebGPU: true,
    minDeviceMemoryGB: 4,
    multilingual: false,
  },
];

export const OLLAMA_MODELS: TranslationModelOption[] = [
  {
    id: "qwen2.5:7b",
    label: "Qwen 2.5 7B (Ollama)",
    engine: "ollama",
    downloadBytes: 0,
    requiresWebGPU: false,
    minDeviceMemoryGB: 0,
    multilingual: true,
    recommended: true,
  },
  {
    id: "gemma2:9b",
    label: "Gemma 2 9B (Ollama)",
    engine: "ollama",
    downloadBytes: 0,
    requiresWebGPU: false,
    minDeviceMemoryGB: 0,
    multilingual: true,
  },
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B (Ollama)",
    engine: "ollama",
    downloadBytes: 0,
    requiresWebGPU: false,
    minDeviceMemoryGB: 0,
    multilingual: false,
  },
];

export const NLLB_MODEL: TranslationModelOption = {
  id: "Xenova/nllb-200-distilled-600M",
  label: "NLLB-200 Distilled 600M (WASM)",
  engine: "nllb",
  downloadBytes: 650_000_000,
  requiresWebGPU: false,
  minDeviceMemoryGB: 0,
  multilingual: true,
  recommended: false,
};

export const LOCAL_MODEL_CATALOG: TranslationModelOption[] = [
  ...WEBLLM_MODELS,
  ...OLLAMA_MODELS,
  NLLB_MODEL,
];

/** Engines that are paid capabilities in the translation product. */
export const PRO_ENGINES: ReadonlySet<TranslationEngineId> = new Set([
  "webllm",
  "ollama",
  "nllb",
]);

/**
 * FLORES-200 language codes for the 30 shipped UI locales — the NLLB fallback
 * needs them, and an unsupported pair must fail with `unsupported-language-pair`
 * instead of being silently transliterated.
 */
const FLORES_CODES: Readonly<Record<string, string>> = {
  ar: "arb_Arab",
  bg: "bul_Cyrl",
  cs: "ces_Latn",
  da: "dan_Latn",
  de: "deu_Latn",
  el: "ell_Grek",
  en: "eng_Latn",
  es: "spa_Latn",
  fi: "fin_Latn",
  fr: "fra_Latn",
  he: "heb_Hebr",
  hi: "hin_Deva",
  hr: "hrv_Latn",
  hu: "hun_Latn",
  id: "ind_Latn",
  it: "ita_Latn",
  ja: "jpn_Jpan",
  ko: "kor_Hang",
  nl: "nld_Latn",
  no: "nob_Latn",
  pl: "pol_Latn",
  pt: "por_Latn",
  ro: "ron_Latn",
  ru: "rus_Cyrl",
  sv: "swe_Latn",
  th: "tha_Thai",
  tr: "tur_Latn",
  uk: "ukr_Cyrl",
  vi: "vie_Latn",
  zh: "zho_Hans",
};

/** Display names used inside the prompts (English exonyms, stable for tests). */
export const LOCALE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  ar: "Arabic",
  bg: "Bulgarian",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  fi: "Finnish",
  fr: "French",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  sv: "Swedish",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese (Simplified)",
};

export function localeDisplayName(code: string): string {
  const base = String(code || "en").split("-")[0]!.toLowerCase();
  return LOCALE_DISPLAY_NAMES[base] ?? base;
}

export function floresCode(code: string): string | null {
  const base = String(code || "").split("-")[0]!.toLowerCase();
  return FLORES_CODES[base] ?? null;
}
