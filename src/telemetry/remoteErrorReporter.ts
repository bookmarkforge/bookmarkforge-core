/**
 * Remote Error Reporting (Sentry) — privacy-first, opt-in, disabled by default.
 *
 * BookmarkForge never sends anything remotely unless BOTH hold:
 *   1. The operator configured a Sentry DSN at build time (`VITE_SENTRY_DSN`),
 *      and
 *   2. the user explicitly opted in via the consent banner
 *      (`forge_consent_error_reporting`, with only the pre-banner broad
 *      telemetry key as a migration fallback).
 *
 * The SDK is loaded with a dynamic import so it never ships in the initial
 * bundle — without a configured DSN the module is a no-op and the SDK chunk
 * is never requested.
 *
 * Every event passes through `sanitizeBeforeSend`:
 *   - consent revoked mid-session → event dropped immediately,
 *   - URL query strings / fragments stripped from request, transaction and
 *     breadcrumbs,
 *   - secrets (password/api_key/token/secret, URL userinfo) redacted in
 *     messages, exception values, breadcrumb data and `extra`,
 *   - user identity is never sent (`event.user` removed),
 *   - tracing and session tracking are disabled (errors only, no PII).
 *
 * The policy promise (privacy-and-terms.html §8): only redacted technical
 * stack traces and device information leave the device.
 */
import type { ErrorEvent as SentryErrorEvent, EventHint } from "@sentry/browser";
import { env } from "../env.config";
import { isPurposeConsented } from "../services/ConsentService";
import { logger } from "../utils/logger";
import { sanitizeMessage } from "./sanitize";

// Benign browser noise that carries no diagnostic value; matched as
// substrings against the error message by the SDK.
const IGNORED_ERRORS = [
  "ResizeObserver loop",
  "ResizeObserver loop completed with undelivered notifications",
  "Script error.",
  "Non-Error promise rejection captured with keys:",
  "Load failed",
  "net::ERR_ABORTED",
];

function getSentryDsn(): string {
  return env.sentryDsn ?? "";
}

/**
 * Consent gate for the REMOTE sink. An explicit current-scope decision wins;
 * only the pre-banner broad telemetry opt-in remains as a migration fallback.
 * The legacy local-error-storage flag is intentionally excluded.
 */
export function isRemoteErrorReportingConsented(): boolean {
  try {
    // ConsentService also honors the pre-banner error-reporting key as a
    // read-only migration fallback, while the dedicated Sentry key remains
    // authoritative once written.
    return isPurposeConsented("sentry");
  } catch {
    return false;
  }
}

/** Strip query string and fragment from a URL (absolute or relative). */
export function stripQueryParams(value: string | undefined): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value, "https://bookmarkforge.invalid");
    url.search = "";
    url.hash = "";
    if (value.includes("://")) return url.href;
    return url.pathname;
  } catch {
    return value;
  }
}

function scrubValues(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return record;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string") out[key] = sanitizeMessage(value.slice(0, 512));
    else out[key] = value;
  }
  return out;
}

/**
 * Sentry beforeSend sanitizer. Returns null to drop the event entirely when
 * consent is revoked; otherwise returns a scrubbed copy. Never mutates the
 * original event.
 */
export function sanitizeBeforeSend(
  event: SentryErrorEvent,
  _hint?: EventHint,
): SentryErrorEvent | null {
  if (!isRemoteErrorReportingConsented()) return null;
  const next: SentryErrorEvent = { ...event };

  if (next.request?.url) {
    next.request = { ...next.request, url: stripQueryParams(next.request.url) };
  }
  if (next.transaction) next.transaction = stripQueryParams(next.transaction);

  if (next.exception?.values?.length) {
    next.exception = {
      ...next.exception,
      values: next.exception.values.map((value) => ({
        ...value,
        value: value.value ? sanitizeMessage(value.value) : value.value,
      })),
    };
  }
  if (typeof next.message === "string") next.message = sanitizeMessage(next.message);

  if (next.breadcrumbs?.length) {
    next.breadcrumbs = next.breadcrumbs.map((crumb) => {
      const scrubbed = { ...crumb };
      if (typeof scrubbed.message === "string") {
        scrubbed.message = sanitizeMessage(scrubbed.message);
      }
      if (scrubbed.data) scrubbed.data = scrubValues(scrubbed.data);
      return scrubbed;
    });
  }

  // Never transmit user identity.
  delete next.user;
  if (next.extra) next.extra = scrubValues(next.extra);

  return next;
}

/**
 * Initialize the remote sink. No-op unless a DSN is configured; the SDK is
 * loaded lazily so the default (no DSN) build never pulls it in. Consent is
 * enforced per-event inside `sanitizeBeforeSend`, so toggling consent at any
 * time takes effect immediately without re-initialization.
 */
export async function initRemoteErrorReporting(): Promise<void> {
  const dsn = getSentryDsn();
  // Do not even initialize the SDK before consent: SDK startup can create
  // implicit envelopes/session traffic independently of application errors.
  if (!isRemoteErrorReportingConsented()) {
    logger.debug("[RemoteErrorReporter] disabled — consent not granted");
    return;
  }
  if (!dsn) {
    logger.debug("[RemoteErrorReporter] disabled — VITE_SENTRY_DSN no configurado");
    return;
  }
  try {
    const sentry = await import("@sentry/browser");
    sentry.init({
      dsn,
      environment: env.mode ?? "production",
      release: env.appVersion || undefined,
      // Errors only: no tracing, no session tracking, no PII enrichment.
      tracesSampleRate: 0,
      sendDefaultPii: false,
      maxBreadcrumbs: 30,
      ignoreErrors: IGNORED_ERRORS,
      beforeSend: sanitizeBeforeSend,
      beforeSendTransaction: () => null,
    });
    logger.info("[RemoteErrorReporter] Sentry initialized (opt-in, sanitization active)");
  } catch (error) {
    logger.warn("[RemoteErrorReporter] init failed (non-blocking)", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
