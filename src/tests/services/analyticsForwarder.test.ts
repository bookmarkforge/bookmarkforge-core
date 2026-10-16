/**
 * src/tests/services/analyticsForwarder.test.ts
 *
 * Consent-gated, aggregated, non-PII forwarding of local analytics events to
 * the companion server:
 *   - consent OFF (default) → nothing is built or sent
 *   - only the allow-listed event types leave the device
 *   - the install id is stable per device and only its SHA-256 hash is sent
 *   - payloads are aggregated counts, never raw events
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import {
  buildAnalyticsPayload,
  buildDailyCounts,
  forwardAnalytics,
  forwardAnalyticsBeacon,
  getOrCreateInstallId,
  isAnalyticsForwardingEnabled,
  __resetAnalyticsForwarderForTests,
} from "../../services/analyticsForwarder";

const CONSENT_KEY = STORAGE_KEYS.CONSENT_ANALYTICS;
const IID_KEY = "bmf_analytics_install_id";

beforeEach(() => {
  localStorage.clear();
  __resetAnalyticsForwarderForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("analyticsForwarder consent gating", () => {
  it("is disabled by default (no consent stored)", () => {
    expect(isAnalyticsForwardingEnabled()).toBe(false);
  });

  it("is enabled when the consent banner stored forge_consent_analytics=true", () => {
    localStorage.setItem(CONSENT_KEY, "true");
    expect(isAnalyticsForwardingEnabled()).toBe(true);
  });

  it("returns no payload when consent is off", async () => {
    const payload = await buildAnalyticsPayload([{ type: "session_start" }]);
    expect(payload).toBeNull();
  });

  it("sends nothing when consent is off", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sent = await forwardAnalytics([{ type: "session_start" }]);
    expect(sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("analyticsForwarder payload", () => {
  it("aggregates counts and forwards only allow-listed types", async () => {
    localStorage.setItem(CONSENT_KEY, "true");
    const counts = buildDailyCounts([
      { type: "session_start" },
      { type: "session_start" },
      { type: "bookmark_created" },
      // Not in the forwarded allow-list → must be dropped.
      { type: "theme_changed" },
      { type: "language_changed" },
    ]);
    expect(counts).toEqual({ session_start: 2, bookmark_created: 1 });

    const payload = await buildAnalyticsPayload([{ type: "session_start" }]);
    expect(payload).not.toBeNull();
    expect(payload!.iid).toMatch(/^[0-9a-f]{64}$/);
    expect(payload!.counts).toEqual({ session_start: 1 });
  });

  it("keeps the install id stable across calls and hashes it (never the raw id)", async () => {
    localStorage.setItem(CONSENT_KEY, "true");
    const firstId = getOrCreateInstallId();
    const secondId = getOrCreateInstallId();
    expect(firstId).toBe(secondId);
    // The stored value is the raw UUID; the payload carries its SHA-256 hash.
    expect(firstId).not.toMatch(/^[0-9a-f]{64}$/);
    const payload = await buildAnalyticsPayload([{ type: "session_start" }]);
    expect(payload!.iid).not.toBe(firstId);
  });

  it("POSTs the aggregated bucket to the same-origin endpoint with keepalive", async () => {
    localStorage.setItem(CONSENT_KEY, "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const sent = await forwardAnalytics([{ type: "vault_created" }]);
    expect(sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/analytics/events");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(String(init.body)) as { iid: string; counts: Record<string, number> };
    expect(body.counts).toEqual({ vault_created: 1 });
  });

  it("contains failures: a dead server never throws", async () => {
    localStorage.setItem(CONSENT_KEY, "true");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(forwardAnalytics([{ type: "session_start" }])).resolves.toBe(false);
  });

  it("opens a bounded circuit after repeated companion failures", async () => {
    localStorage.setItem(CONSENT_KEY, "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await forwardAnalytics([{ type: "session_start" }]);
    await forwardAnalytics([{ type: "session_start" }]);
    await forwardAnalytics([{ type: "session_start" }]);
    await forwardAnalytics([{ type: "session_start" }]);

    // The fourth call is suppressed locally instead of creating another
    // request while the companion is known to be unavailable.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("analyticsForwarder beacon", () => {
  beforeEach(() => {
    // jsdom does not implement navigator.sendBeacon — provide a stub hook.
    Object.defineProperty(navigator, "sendBeacon", {
      value: () => true,
      configurable: true,
      writable: true,
    });
  });

  it("uses sendBeacon on unload when consent is on", () => {
    localStorage.setItem(CONSENT_KEY, "true");
    const beaconSpy = vi.spyOn(navigator, "sendBeacon").mockImplementation(() => true);
    forwardAnalyticsBeacon([{ type: "session_start" }, { type: "bookmark_created" }]);
    // The hash is async; give the microtask a tick.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(beaconSpy).toHaveBeenCalledTimes(1);
        const url = beaconSpy.mock.calls[0]?.[0];
        expect(url).toBe("/api/analytics/events");
        resolve();
      }, 10);
    });
  });

  it("does nothing on unload when consent is off", () => {
    const beaconSpy = vi.spyOn(navigator, "sendBeacon").mockImplementation(() => true);
    forwardAnalyticsBeacon([{ type: "session_start" }]);
    expect(beaconSpy).not.toHaveBeenCalled();
  });
});
