import { describe, it, expect, beforeEach, vi } from "vitest";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import {
  getConsent,
  hasConsentDecision,
  isPurposeConsented,
  setConsent,
  setConsentPurpose,
  subscribeToConsentChanges,
  CONSENT_CHANGED_EVENT,
  type ConsentToggles,
} from "../../services/ConsentService";

// In-memory safeStorage mock (same lazy-closure pattern as ConsentBanner.test.tsx).
const store = new Map<string, string>();
vi.mock("../../store/safeStorage", () => ({
  safeGet: (key: string) => store.get(key) ?? null,
  safeSet: (key: string, value: string) => {
    store.set(key, value);
  },
  safeRemove: (key: string) => {
    store.delete(key);
  },
}));

const LEGACY_BROAD_CONSENT_KEY = "bmf_telemetry_optin";

const allTrue = (): ConsentToggles => ({
  analytics: true,
  errorReporting: true,
  clientEvents: true,
});

const allFalse = (): ConsentToggles => ({
  analytics: false,
  errorReporting: false,
  clientEvents: false,
});

describe("ConsentService", () => {
  beforeEach(() => {
    store.clear();
  });

  describe("getConsent / hasConsentDecision", () => {
    it("returns null before the first explicit decision", () => {
      expect(hasConsentDecision()).toBe(false);
      expect(getConsent()).toBeNull();
    });

    it("reads the three purposes back after setConsent", () => {
      setConsent(allTrue());
      expect(hasConsentDecision()).toBe(true);
      expect(getConsent()).toEqual(allTrue());
    });

    it("persists per-purpose keys with the storage keys contract", () => {
      setConsent({ analytics: true, errorReporting: false, clientEvents: true });
      expect(store.get(STORAGE_KEYS.CONSENT_DECISION_MADE)).toBe("true");
      expect(store.get(STORAGE_KEYS.CONSENT_ANALYTICS)).toBe("true");
      expect(store.get(STORAGE_KEYS.CONSENT_SENTRY)).toBe("false");
      expect(store.get(STORAGE_KEYS.CONSENT_CLIENT_EVENTS)).toBe("true");
    });

    it("does not resurrect decisions from legacy keys after a modern decision", () => {
      // Legacy broad opt-in present before the explicit decision…
      store.set(LEGACY_BROAD_CONSENT_KEY, "true");
      store.set(STORAGE_KEYS.CONSENT_ERROR_REPORTING, "true");
      // …but the modern decision denies everything.
      setConsent(allFalse());
      store.delete(STORAGE_KEYS.CONSENT_SENTRY);
      expect(getConsent()).toEqual(allFalse());
      expect(store.has(LEGACY_BROAD_CONSENT_KEY)).toBe(false);
      expect(store.has(STORAGE_KEYS.CONSENT_ERROR_REPORTING)).toBe(false);
      // A missing current purpose after a complete decision is denied — the
      // broad legacy flag must never resurrect analytics.
      store.set(LEGACY_BROAD_CONSENT_KEY, "true");
      expect(isPurposeConsented("analytics")).toBe(false);
    });
  });

  describe("isPurposeConsented", () => {
    it("fail-closed with no keys at all", () => {
      expect(isPurposeConsented("analytics")).toBe(false);
      expect(isPurposeConsented("sentry")).toBe(false);
      expect(isPurposeConsented("clientEvents")).toBe(false);
    });

    it("never lets the broad legacy opt-in authorize modern purposes (ADR-044, GDPR Art. 7)", () => {
      store.set(LEGACY_BROAD_CONSENT_KEY, "true");
      // Legacy consent never authorizes modern purposes — fail-closed.
      expect(isPurposeConsented("analytics")).toBe(false);
      expect(isPurposeConsented("clientEvents")).toBe(false);
      expect(isPurposeConsented("sentry")).toBe(false);
    });

    it("honors the legacy error-reporting key for sentry without granting the other purposes", () => {
      store.set(STORAGE_KEYS.CONSENT_ERROR_REPORTING, "true");
      expect(isPurposeConsented("sentry")).toBe(true);
      expect(isPurposeConsented("analytics")).toBe(false);
      expect(isPurposeConsented("clientEvents")).toBe(false);
    });

    it("treats an explicit current-purpose key as authoritative, including false", () => {
      store.set(LEGACY_BROAD_CONSENT_KEY, "true");
      store.set(STORAGE_KEYS.CONSENT_DECISION_MADE, "true");
      store.set(STORAGE_KEYS.CONSENT_ANALYTICS, "false");
      expect(isPurposeConsented("analytics")).toBe(false);
    });
  });

  describe("setConsentPurpose", () => {
    it("updates exactly one purpose and preserves the other two", () => {
      setConsent(allTrue());
      const next = setConsentPurpose("analytics", false);
      expect(next).toEqual({
        analytics: false,
        errorReporting: true,
        clientEvents: true,
      });
      expect(getConsent()).toEqual(next);
    });

    it("defaults denied on first purpose-only decision without resurrecting the broad flag", () => {
      store.set(LEGACY_BROAD_CONSENT_KEY, "true");
      const next = setConsentPurpose("clientEvents", true);
      expect(next).toEqual({
        analytics: false,
        errorReporting: false,
        clientEvents: true,
      });
    });
  });

  describe("subscribeToConsentChanges", () => {
    it("delivers the detail payload of the custom event and stops after unsubscribe", () => {
      const seen: (ConsentToggles | null)[] = [];
      const unsubscribe = subscribeToConsentChanges((consent) => {
        seen.push(consent);
      });
      window.dispatchEvent(
        new CustomEvent(CONSENT_CHANGED_EVENT, { detail: allTrue() }),
      );
      unsubscribe();
      window.dispatchEvent(
        new CustomEvent(CONSENT_CHANGED_EVENT, { detail: allFalse() }),
      );
      expect(seen).toEqual([allTrue()]);
    });

    it("setConsent emits a changed event with the post-change state", () => {
      const listener = vi.fn<(consent: ConsentToggles | null) => void>();
      const unsubscribe = subscribeToConsentChanges(listener);
      setConsent(allFalse());
      unsubscribe();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(allFalse());
    });

    it("reacts to same-tab storage updates for consent keys only", () => {
      const listener = vi.fn<(consent: ConsentToggles | null) => void>();
      const unsubscribe = subscribeToConsentChanges(listener);
      const fireStorage = (key: string) => {
        const event = new Event("storage");
        Object.defineProperty(event, "key", { value: key });
        window.dispatchEvent(event);
      };
      setConsent(allTrue());
      listener.mockClear();
      fireStorage(STORAGE_KEYS.CONSENT_SENTRY);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(allTrue());
      fireStorage("some-unrelated-key");
      expect(listener).toHaveBeenCalledTimes(1);
      unsubscribe();
    });
  });
});
