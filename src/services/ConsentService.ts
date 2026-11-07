/**
 * ConsentService — persistent, purpose-specific privacy controls.
 *
 * Each optional remote processing purpose has its own durable decision. A
 * later purpose change never derives consent for another purpose, and an
 * explicit current-scope `false` always wins over migration keys.
 *
 * ADR-030: analytics, Sentry error reporting, and operational client events
 * are independent consent purposes with fail-closed defaults.
 */
import { STORAGE_KEYS } from "../constants/storage-keys";
import { safeGet, safeRemove, safeSet } from "../store/safeStorage";

type ConsentPurpose = "analytics" | "sentry" | "clientEvents";

export interface ConsentToggles {
  analytics: boolean;
  /** UI-facing name for the independent Sentry/remote error purpose. */
  errorReporting: boolean;
  clientEvents: boolean;
}

export const CONSENT_CHANGED_EVENT = "forge:consent-changed";

const LEGACY_BROAD_CONSENT_KEY = "bmf_telemetry_optin";
const PURPOSE_KEYS: Record<ConsentPurpose, string> = {
  analytics: STORAGE_KEYS.CONSENT_ANALYTICS,
  sentry: STORAGE_KEYS.CONSENT_SENTRY,
  clientEvents: STORAGE_KEYS.CONSENT_CLIENT_EVENTS,
};
const PURPOSE_STORAGE_KEYS = new Set(Object.values(PURPOSE_KEYS));

function readBoolean(key: string): boolean {
  return safeGet(key) === "true";
}

function readSentryConsent(): boolean {
  const current = safeGet(PURPOSE_KEYS.sentry);
  if (current !== null) return current === "true";

  // Older releases used forge_consent_error_reporting for both local error
  // storage and Sentry. Honor that explicit legacy decision once, until a
  // modern decision writes the dedicated Sentry key.
  const legacy = safeGet(STORAGE_KEYS.CONSENT_ERROR_REPORTING);
  if (legacy !== null) return legacy === "true";
  return false;
}

/**
 * Returns the current complete decision, or null before the first explicit
 * consent choice. Missing modern purpose keys are denied, except for the
 * one-time Sentry migration described above.
 */
export function getConsent(): ConsentToggles | null {
  if (safeGet(STORAGE_KEYS.CONSENT_DECISION_MADE) !== "true") return null;
  return {
    analytics: readBoolean(PURPOSE_KEYS.analytics),
    errorReporting: readSentryConsent(),
    clientEvents: readBoolean(PURPOSE_KEYS.clientEvents),
  };
}

export function hasConsentDecision(): boolean {
  return safeGet(STORAGE_KEYS.CONSENT_DECISION_MADE) === "true";
}

/**
 * Purpose gate used by boot-time services, including legacy migrations. Once
 * a current-purpose key exists it is authoritative, including an explicit
 * `false`; analytics and client events never use the broad legacy flag after
 * a complete modern decision.
 */
export function isPurposeConsented(purpose: ConsentPurpose): boolean {
  const current = safeGet(PURPOSE_KEYS[purpose]);
  if (current !== null) return current === "true";

  if (purpose === "sentry") {
    const legacy = safeGet(STORAGE_KEYS.CONSENT_ERROR_REPORTING);
    if (legacy !== null) return legacy === "true";
  }

  // Once a complete modern decision exists, a missing purpose is denied;
  // never resurrect analytics/events from a stale broad migration flag.
  // ADR-044: Legacy consent never authorizes modern purposes — users must
  // explicitly decide via the consent banner for GDPR Art. 7 compliance.
  if (safeGet(STORAGE_KEYS.CONSENT_DECISION_MADE) === "true") return false;
  return false;
}

function emitConsentChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ConsentToggles | null>(CONSENT_CHANGED_EVENT, {
      detail: getConsent(),
    }),
  );
}

function writeConsent(consent: ConsentToggles): void {
  safeSet(STORAGE_KEYS.CONSENT_DECISION_MADE, "true");
  safeSet(PURPOSE_KEYS.analytics, String(consent.analytics));
  safeSet(PURPOSE_KEYS.sentry, String(consent.errorReporting));
  safeSet(PURPOSE_KEYS.clientEvents, String(consent.clientEvents));

  // The dedicated Sentry key is authoritative for remote reporting. The old
  // error-reporting key is removed so a later legacy fallback cannot override
  // an explicit modern decision; local error storage remains controlled by its
  // separate settings surface.
  safeRemove(STORAGE_KEYS.CONSENT_ERROR_REPORTING);
  safeRemove(STORAGE_KEYS.LOCAL_ERROR_STORAGE);
  safeRemove(LEGACY_BROAD_CONSENT_KEY);
  emitConsentChanged();
}

/** Persist the complete banner decision. */
export function setConsent(consent: ConsentToggles): void {
  writeConsent({
    analytics: consent.analytics === true,
    errorReporting: consent.errorReporting === true,
    clientEvents: consent.clientEvents === true,
  });
}

/** Update exactly one purpose while preserving the other two decisions. */
export function setConsentPurpose(
  purpose: ConsentPurpose,
  enabled: boolean,
): ConsentToggles {
  const current = getConsent();
  const next: ConsentToggles = current ?? {
    // A first purpose-specific decision must not silently grant analytics or
    // operational events from a broad legacy flag. A legacy explicit Sentry
    // decision is preserved only through readSentryConsent().
    analytics: false,
    errorReporting: readSentryConsent(),
    clientEvents: false,
  };
  if (purpose === "sentry") next.errorReporting = enabled;
  else next[purpose] = enabled;
  writeConsent(next);
  return next;
}

/**
 * Subscribe to same-tab consent events and cross-tab storage updates. The
 * callback receives the post-change state, so consumers can stop queues and
 * sinks immediately before accepting more work.
 */
export function subscribeToConsentChanges(
  listener: (consent: ConsentToggles | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const onCustomChange = (event: Event) => {
    const detail = (event as CustomEvent<ConsentToggles | null>).detail;
    listener(detail === undefined ? getConsent() : detail);
  };
  const onStorageChange = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (
      key === STORAGE_KEYS.CONSENT_DECISION_MADE ||
      PURPOSE_STORAGE_KEYS.has(key ?? "") ||
      key === STORAGE_KEYS.CONSENT_ERROR_REPORTING
    ) {
      listener(getConsent());
    }
  };

  window.addEventListener(CONSENT_CHANGED_EVENT, onCustomChange);
  window.addEventListener("storage", onStorageChange);
  return () => {
    window.removeEventListener(CONSENT_CHANGED_EVENT, onCustomChange);
    window.removeEventListener("storage", onStorageChange);
  };
}
