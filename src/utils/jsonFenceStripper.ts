/**
 * Strip markdown JSON code fences from LLM responses before JSON.parse.
 *
 * Many models wrap structured output in ```json ... ``` or ``` ... ```
 * fences. This utility normalizes all variants so callers always receive
 * clean JSON text.
 *
 * Handles:
 *   ```json\n{...}\n```
 *   ```\n{...}\n```
 *   ```JSON\n{...}\n```         (case-insensitive)
 *   ``` json\n{...}\n```         (whitespace after backticks)
 *   Already-cleaned JSON           (pass-through)
 */
export function stripJsonFence(text: string): string {
  const cleaned = text.trim();
  // Fence with optional language tag: ```json ... ``` or ``` ... ```
  const m = cleaned.match(/^```(?:\s*json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  return m ? m[1]!.trim() : cleaned;
}

/**
 * Parse LLM structured output after stripping markdown code fences.
 *
 * Unlike a bare `JSON.parse(stripJsonFence(...))`, this never lets a raw
 * SyntaxError escape. V8's SyntaxError message embeds the first characters
 * of the input, which would leak model/user content into logs or UI — the
 * same reason `readBoundedResponseJson` throws a body-free error.
 */
/**
 * Structured AI responses are small (a quiz, a summary, a tag list). Reject
 * oversized input before trimming/parsing so a model emitting unbounded text
 * cannot force a large string copy or a pathological JSON.parse.
 */
const MAX_FENCED_JSON_CHARS = 256 * 1024;

export function parseFencedJson<T>(
  text: string,
  maxChars = MAX_FENCED_JSON_CHARS,
): T {
  if (typeof text !== "string" || text.length > maxChars) {
    throw new Error("AI response exceeds the configured size limit");
  }
  const cleaned = stripJsonFence(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (_err) {
    throw new Error("AI response was not valid JSON");
  }
}
