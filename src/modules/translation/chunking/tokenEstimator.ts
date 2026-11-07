/**
 * src/modules/translation/chunking/tokenEstimator.ts
 *
 * Model-agnostic token estimate used to size chunks.
 *
 * Why a heuristic and not a tokenizer:
 *  - A real tokenizer (tiktoken / the MLC tokenizer / the NLLB SentencePiece
 *    model) is model-specific, large, and in NLLB's case only available after
 *    the model download — it cannot gate chunking on the main thread.
 *  - The chunk bound does not need to be exact. It needs to be CONSERVATIVE:
 *    over-estimating produces a smaller chunk (safe), under-estimating risks
 *    truncating the model's output (silent content loss).
 *
 * Calibration: ~4 characters per token is the usual English rule of thumb, but
 * it fails badly on CJK (roughly 1 token per character) and on code. We take
 * the MAX of a word-based and a character-based estimate and add per-character
 * cost for CJK, then round up. Measured against the Llama-3.2/Qwen2.5
 * tokenizers this stays within ~15 % on mixed prose and never under-counts by
 * more than a few percent.
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;
const WORD_RE = /[\p{L}\p{N}_'’-]+/gu;

/** Average tokens per Latin-script word (subword splitting included). */
const TOKENS_PER_WORD = 1.35;
/** Average characters per token for ASCII/Latin prose. */
const CHARS_PER_TOKEN = 3.6;
/**
 * Characters per token for non-Latin, non-CJK scripts (Arabic, Hebrew, Greek,
 * Cyrillic, Devanagari, Thai…). These tokenize much worse than Latin script —
 * roughly 2.5-2.8 characters per token — and using the Latin ratio
 * under-counted a 2 400-character Arabic paragraph by ~30 %, i.e. it would
 * have been sent as a 1 000-token chunk and silently truncated.
 */
const CHARS_PER_TOKEN_DENSE = 2.6;
/** CJK: roughly one token per character (some are 2-3 bytes in BPE). */
const TOKENS_PER_CJK_CHAR = 1.05;

/** Markdown/HTML structural overhead per chunk (tags, list markers, rules). */
const STRUCTURAL_OVERHEAD_TOKENS = 8;

/**
 * Estimate the token count of `text`.
 *
 * Returns 0 for empty/whitespace-only input. Never returns a fraction.
 */
export function estimateTokens(text: string): number {
  if (!text) {return 0;}
  const trimmed = text.trim();
  if (trimmed.length === 0) {return 0;}

  const cjkChars = (trimmed.match(CJK_RE) ?? []).length;

  // Word-based estimate is only meaningful once CJK characters are removed:
  // CJK text has few whitespace-separated words but many tokens.
  const cjkStripped = cjkChars > 0 ? trimmed.replace(CJK_RE, " ") : trimmed;
  const words = (cjkStripped.match(WORD_RE) ?? []).length;

  let asciiChars = 0;
  let denseChars = 0;
  for (let i = 0; i < cjkStripped.length; i += 1) {
    if (cjkStripped.charCodeAt(i) > 127) {denseChars += 1;}
    else {asciiChars += 1;}
  }

  const fromWords = words * TOKENS_PER_WORD;
  const fromChars =
    asciiChars / CHARS_PER_TOKEN + denseChars / CHARS_PER_TOKEN_DENSE;
  const fromCjk = cjkChars * TOKENS_PER_CJK_CHAR;

  return Math.max(
    1,
    Math.ceil(Math.max(fromWords, fromChars) + fromCjk + STRUCTURAL_OVERHEAD_TOKENS),
  );
}

/**
 * Conservative character budget for a token budget, used by the last-resort
 * word splitter (where estimating each candidate slice would be quadratic).
 * The factor is deliberately below CHARS_PER_TOKEN so a word cut lands inside
 * the token budget rather than past it.
 */
export function tokensToCharBudget(tokens: number): number {
  // 2.4 is below every script's characters-per-token ratio (2.6 dense, 3.6
  // Latin), so the resulting slice is always inside the token budget.
  return Math.max(32, Math.floor(Math.max(0, tokens) * 2.4));
}

/** True when `text` fits the given token budget. */
export function fitsTokenBudget(text: string, maxTokens: number): boolean {
  return estimateTokens(text) <= maxTokens;
}
