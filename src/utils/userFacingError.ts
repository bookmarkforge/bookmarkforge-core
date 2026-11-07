/**
 * P1 (audit 2026-11-06): single boundary for text rendered to the user.
 *
 * AGENTS §4 forbids leaking raw `SyntaxError.message`, stack frames, internal
 * paths or secret material into user-facing errors. The UI still needs the
 * actionable part of a failure ("wrong password", "quota exceeded", "network
 * error"), so this helper keeps the message, redacts secrets through the
 * shared telemetry sanitizer, strips stack/path detail and bounds the result.
 *
 * Use it at the UI boundary (toast / inline error), NOT for logs — logging
 * keeps `safeErrorForLog`.
 */
import { sanitizeMessage } from "../telemetry/sanitize";

const MAX_USER_MESSAGE_LENGTH = 200;

/**
 * Turns an arbitrary thrown value into a bounded, sanitized message safe to
 * render. Returns `fallback` when the error carries no usable text.
 */
export function toUserErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const cleaned = sanitizeMessage(raw)
    // A query string can carry tokens even after the secret redactor.
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, "$1?[redacted]")
    // Stack frames: "at fn (…)" and "at /path/file.ts:1:2".
    .replace(/\s+at\s+[^\s(]+\s*\([^)]*\)/g, "")
    .replace(/\s+at\s+\S+:\d+:\d+/g, "")
    // Absolute Windows and POSIX paths (URLs are excluded by the preceding
    // character class, so `https://host/path` survives intact).
    .replace(/\b[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+/g, "[path]")
    .replace(/(^|[\s("'=])\/(?:[^\s/]+\/)+[^\s)"'`,]+/g, "$1[path]")
    .replace(/\s+/g, " ")
    .trim();
  const bounded =
    cleaned.length > MAX_USER_MESSAGE_LENGTH
      ? `${cleaned.slice(0, MAX_USER_MESSAGE_LENGTH - 1)}…`
      : cleaned;
  return bounded.length > 0 ? bounded : fallback;
}
