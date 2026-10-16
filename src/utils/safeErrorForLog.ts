/**
 * Project an Error / unknown value into an object safe to pass to
 * `logger.error` / `logger.warn` without risking content from the user
 * vault leaking into diagnostics.
 *
 * Two guarantees this helper provides:
 *
 *   1. The shape is bounded: `{ name, message }` with `message` capped to
 *      {@link MAX_LOG_MESSAGE_LEN} characters. Long messages from upstream
 *      providers (which sometimes embed the request URL or response
 *      excerpt) cannot bloat log files.
 *
 *   2. The stack is NOT included. A production log captures enough to
 *      diagnose without the noise / size of a full V8 stack trace, and
 *      stacks can embed file paths and argument snippets that are not
 *      appropriate for ops logs.
 *
 * The body of an LLM response can NEVER end up in the result because:
 *   - `parseFencedJson` already throws content-free `Error`s, and
 *   - network errors from `fetch` do not carry response bodies in JS, and
 *   - this helper does not read any payload fields.
 *
 * @example
 *   logger.error("batch summarize failed", {
 *     bookmarkId: id,
 *     error: safeErrorForLog(err),
 *   });
 */

interface LoggableError {
  name: string;
  message: string;
}

const MAX_LOG_MESSAGE_LEN = 200;

export function safeErrorForLog(err: unknown): LoggableError {
  if (err instanceof Error) {
    const raw = err.message ?? "";
    const message =
      raw.length > MAX_LOG_MESSAGE_LEN
        ? `${raw.slice(0, MAX_LOG_MESSAGE_LEN)}\u2026[+${raw.length - MAX_LOG_MESSAGE_LEN}]`
        : raw;
    return { name: err.name, message };
  }
  const raw = String(err);
  return {
    name: "NonErrorThrown",
    message:
      raw.length > MAX_LOG_MESSAGE_LEN
        ? `${raw.slice(0, MAX_LOG_MESSAGE_LEN)}\u2026[+${raw.length - MAX_LOG_MESSAGE_LEN}]`
        : raw,
  };
}
