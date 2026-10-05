/**
 * Shared sanitizers for error reporting (local IndexedDB + optional remote
 * sink). Single source of truth so every sink applies the same redaction:
 * secrets, credentials and URL userinfo are stripped before anything is
 * persisted or transmitted.
 */
import { redactSecrets } from "../utils/logger";

export const MAX_MESSAGE_LENGTH = 4096;
export const MAX_STACK_LENGTH = 12_000;

export function sanitizeMessage(msg: string): string {
  return redactSecrets(
    msg.slice(0, MAX_MESSAGE_LENGTH * 2)
      .replace(
        /(["']?password["']?\s*[:=]\s*["']?)[^"'\s,;]+/gi,
        "$1[REDACTED]",
      )
      .replace(
        /(["']?api[_-]?key["']?\s*[:=]\s*["']?)[^"'\s,;]+/gi,
        "$1[REDACTED]",
      )
      .replace(/(["']?token["']?\s*[:=]\s*["']?)[^"'\s,;]+/gi, "$1[REDACTED]")
      .replace(/(["']?secret["']?\s*[:=]\s*["']?)[^"'\s,;]+/gi, "$1[REDACTED]")
      .replace(/(https?:\/\/)[^:/\s]+:[^@/\s]+@/g, "$1[REDACTED]:[REDACTED]@")
      .slice(0, MAX_MESSAGE_LENGTH),
  );
}

export function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) {return undefined;}
  return redactSecrets(
    stack
      .slice(0, MAX_STACK_LENGTH)
      .replace(/password[=:]\s*\S+/gi, "password=[REDACTED]")
      .replace(/api[_-]?key[=:]\s*\S+/gi, "api_key=[REDACTED]")
      .replace(/token[=:]\s*\S+/gi, "token=[REDACTED]"),
  ).slice(0, MAX_STACK_LENGTH);
}
