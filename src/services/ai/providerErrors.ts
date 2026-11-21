/**
 * Provider error classification — shared by the AI providers.
 *
 * Turns raw HTTP error bodies into actionable Error messages and detects
 * the "model retired upstream" shape so callers can fall back to a
 * different model instead of hard-failing. Self-contained on purpose: it
 * must not import from ./utils (heavily mocked in provider tests).
 */

/** Extract the human-readable detail from common provider error envelopes:
 * OpenAI/Groq `{"error":{"message":...}}`, Anthropic `{"error":{"message":...}}`,
 * Gemini `{"error":{"message":...}}`, Ollama `{"error":"..."}` / `{"message":...}`. */
function extractApiErrorDetail(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed.startsWith("{")) {return trimmed;}
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const err = parsed.error;
    if (typeof err === "string") {return err;}
    if (err && typeof err === "object") {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === "string") {return msg;}
    }
    if (typeof parsed.message === "string") {return parsed.message;}
  } catch {
    // Not JSON — fall through to the raw (bounded) text.
  }
  return trimmed;
}

/** Strip credential-shaped substrings before an upstream error reaches logs/UI. */
function redactDetail(detail: string): string {
  return detail
    .replace(/sk-ant-[a-zA-Z0-9_-]+/gi, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/sk-or-[a-zA-Z0-9_-]+/gi, "[REDACTED_OPENROUTER_KEY]")
    .replace(/gsk_[a-zA-Z0-9_-]+/gi, "[REDACTED_GROQ_KEY]")
    .replace(/AIza[a-zA-Z0-9_-]+/gi, "[REDACTED_GEMINI_KEY]")
    .replace(/AQ\.[a-zA-Z0-9_.-]+/gi, "[REDACTED_GEMINI_KEY]")
    .replace(/sk-[a-zA-Z0-9_-]+/gi, "[REDACTED_API_KEY]")
    .slice(0, 2_000);
}

/**
 * Detect the "model retired/unavailable upstream" response shape across
 * providers. Only meaningful for HTTP 404:
 *  - OpenAI/Groq: `model_not_found`, "The model `x` does not exist"
 *  - Anthropic: `not_found_error`, "model: x"
 *  - Gemini: "is not found for API version", "no longer available"
 *  - Ollama: "model 'x' not found"
 */
export function isModelUnavailableError(
  status: number,
  bodyText: string,
): boolean {
  if (status !== 404) {return false;}
  return /model_not_found|does not exist|not_found_error|no such model|model ['"`][^'"`]+['"`] not found|is not found for API version|no longer available|is not supported for generateContent/i.test(
    bodyText,
  );
}

/**
 * Build an actionable Error for a failed provider request. The
 * `${label} API error ${status}` prefix is preserved verbatim so
 * getUserFriendlyErrorMessage() keeps mapping 401/429/404/400 downstream.
 */
export function buildProviderApiError(
  label: string,
  status: number,
  bodyText: string,
  model?: string,
): Error {
  const detail = redactDetail(extractApiErrorDetail(bodyText));
  const modelSuffix = model ? ` (model ${model})` : "";
  const detailSuffix = detail ? `: ${detail}` : "";

  if (
    status === 401 ||
    status === 403 ||
    /invalid api key|incorrect api key|api key not valid|invalid x-api-key|authentication[_ ]?error/i.test(
      detail,
    )
  ) {
    return new Error(
      `${label} API error ${status}${modelSuffix}: invalid or revoked API key — check Settings > AI (${detail})`,
    );
  }
  if (
    status === 400 &&
    /unknown (name|field|param|argument)|unrecognized|invalid json payload|unexpected field/i.test(
      detail,
    )
  ) {
    return new Error(
      `${label} API error ${status}${modelSuffix}: incompatible request format — the app and the provider API are out of sync, please update BookmarkForge (${detail})`,
    );
  }
  return new Error(
    `${label} API error ${status}${modelSuffix}${detailSuffix}`,
  );
}
