/**
 * src/modules/translation/errors.ts
 *
 * Typed failures for the translation module. Core (MIT).
 *
 * These messages are diagnostics, not UI copy: the presentation layer maps
 * `reason` to a translated string (the module adds no hardcoded UI text, so it
 * cannot drift from the 30-locale i18n gate).
 */

import type {
  TranslationEngineId,
  TranslationEngineUnavailableReason,
} from "./types";

export type TranslationErrorCode =
  | TranslationEngineUnavailableReason
  | "empty-source"
  | "generation-failed"
  | "invalid-response"
  | "cancelled";

export class TranslationError extends Error {
  readonly code: TranslationErrorCode;

  constructor(code: TranslationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    if (cause !== undefined) {(this as { cause?: unknown }).cause = cause;}
  }
}

/**
 * Raised when the selected engine cannot run. `reason === "pro-required"` is
 * the entitlement case: the caller must surface the Pro panel, never fall back
 * to a cloud provider on the user's behalf (that would spend their money for a
 * feature they were told is local-only).
 */
export class TranslationEngineUnavailableError extends TranslationError {
  readonly engine: TranslationEngineId;

  constructor(
    engine: TranslationEngineId,
    reason: TranslationEngineUnavailableReason,
    message?: string,
  ) {
    super(
      reason,
      message ?? `Translation engine "${engine}" is unavailable: ${reason}`,
    );
    this.name = "TranslationEngineUnavailableError";
    this.engine = engine;
  }
}

/** A provider returned something that is not a usable translation block. */
export class TranslationResponseError extends TranslationError {
  constructor(message: string) {
    super("invalid-response", message);
    this.name = "TranslationResponseError";
  }
}
