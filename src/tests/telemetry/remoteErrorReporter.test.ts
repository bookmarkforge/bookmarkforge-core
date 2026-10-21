import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/browser", () => ({ init: vi.fn() }));

import {
  isRemoteErrorReportingConsented,
  sanitizeBeforeSend,
  stripQueryParams,
} from "../../telemetry/remoteErrorReporter";

const CONSENT_KEY = "forge_consent_error_reporting";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("isRemoteErrorReportingConsented", () => {
  it("is disabled by default and honors the consent key", () => {
    expect(isRemoteErrorReportingConsented()).toBe(false);
    localStorage.setItem(CONSENT_KEY, "true");
    expect(isRemoteErrorReportingConsented()).toBe(true);
    localStorage.setItem(CONSENT_KEY, "false");
    expect(isRemoteErrorReportingConsented()).toBe(false);
  });

  it("does not treat local error storage as remote consent", () => {
    localStorage.setItem("bmf_local_error_storage", "true");
    expect(isRemoteErrorReportingConsented()).toBe(false);
  });

  it("never grants remote reporting from the pre-banner broad telemetry key (ADR-044)", () => {
    // Legacy consent never authorizes modern purposes — fail-closed.
    localStorage.setItem("bmf_telemetry_optin", "true");
    expect(isRemoteErrorReportingConsented()).toBe(false);
    // An explicit current-scope decision stays authoritative, in both
    // directions.
    localStorage.setItem(CONSENT_KEY, "true");
    expect(isRemoteErrorReportingConsented()).toBe(true);
    localStorage.setItem(CONSENT_KEY, "false");
    expect(isRemoteErrorReportingConsented()).toBe(false);
  });
});

describe("stripQueryParams", () => {
  it("strips query and fragment from absolute and relative URLs", () => {
    expect(stripQueryParams("https://a.test/p?id=1&token=t#frag")).toBe("https://a.test/p");
    expect(stripQueryParams("/settings?tab=security")).toBe("/settings");
    expect(stripQueryParams(undefined)).toBeUndefined();
  });
});

describe("sanitizeBeforeSend", () => {
  it("drops the event when the user has not consented", () => {
    const event = { message: "boom" } as unknown as Parameters<typeof sanitizeBeforeSend>[0];
    expect(sanitizeBeforeSend(event)).toBeNull();
  });

  it("strips query strings, redacts secrets and removes identity when consented", () => {
    localStorage.setItem(CONSENT_KEY, "true");
    const event = {
      request: { url: "https://app.example.com/bookmarks?id=42&token=abc" },
      transaction: "/bookmarks?id=42",
      exception: { values: [{ value: "password=hunter2 failed" }] },
      breadcrumbs: [{ message: "fetch failed", data: { url: "https://x.test/a?token=t" } }],
      user: { id: "u1", email: "user@example.com" },
      extra: { url: "https://x.test/p?secret=s3cr3t" },
      message: "boom password=zzz",
    } as unknown as Parameters<typeof sanitizeBeforeSend>[0];

    const out = sanitizeBeforeSend(event);
    expect(out).not.toBeNull();
    const serialized = JSON.stringify(out);

    // Query strings stripped from request and transaction.
    expect(out!.request?.url).toBe("https://app.example.com/bookmarks");
    expect(out!.transaction).toBe("/bookmarks");
    expect(serialized).not.toContain("id=42");
    // Secrets redacted everywhere (message, exception, breadcrumbs, extra).
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("zzz");
    expect(serialized).not.toContain("s3cr3t");
    expect(serialized).not.toContain("token=t");
    expect(serialized).toContain("[REDACTED]");
    // User identity removed.
    expect(out!.user).toBeUndefined();
    expect(serialized).not.toContain("user@example.com");
  });
});

describe("initRemoteErrorReporting", () => {
  it("initializes Sentry with the DSN and a sanitizer when configured", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SENTRY_DSN", "https://abc@o1.ingest.sentry.io/123");
    localStorage.setItem(CONSENT_KEY, "true");
    const { init } = await import("@sentry/browser");
    const { initRemoteErrorReporting } = await import("../../telemetry/remoteErrorReporter");
    await initRemoteErrorReporting();
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://abc@o1.ingest.sentry.io/123",
        beforeSend: expect.any(Function),
        tracesSampleRate: 0,
      }),
    );
  });

  it("does nothing without a DSN (disabled by default)", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const { init } = await import("@sentry/browser");
    const { initRemoteErrorReporting } = await import("../../telemetry/remoteErrorReporter");
    await initRemoteErrorReporting();
    expect(init).not.toHaveBeenCalled();
  });
});
