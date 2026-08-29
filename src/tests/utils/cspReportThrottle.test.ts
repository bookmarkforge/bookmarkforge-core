import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn(),
  safeSet: vi.fn(),
}));

import { applyUserCspProfile } from "../../utils/cspReportThrottle";
import { safeGet } from "../../store/safeStorage";

describe("cspReportThrottle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document
      .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
      .forEach((el) => el.remove());
  });

  it("applies MODERATE profile from safeStorage preference", () => {
    (safeGet as ReturnType<typeof vi.fn>).mockReturnValue("MODERATE");
    applyUserCspProfile();
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta).toBeTruthy();
    // MODERATE mirrors the production nginx policy: no microlink (zero-knowledge privacy,
    // see src/services/MetadataService.ts). Assert an AI provider instead.
    expect(meta?.getAttribute("content")).toContain("https://api.openai.com");
    expect(meta?.getAttribute("content")).not.toContain("api.microlink.io");
  });

  it("does nothing when no profile is stored", () => {
    (safeGet as ReturnType<typeof vi.fn>).mockReturnValue(null);
    applyUserCspProfile();
    expect(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
    ).toBeNull();
  });

  it("ignores an invalid stored value", () => {
    (safeGet as ReturnType<typeof vi.fn>).mockReturnValue("BOGUS");
    applyUserCspProfile();
    expect(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
    ).toBeNull();
  });

  it("reuses an existing meta tag", () => {
    const existing = document.createElement("meta");
    existing.httpEquiv = "Content-Security-Policy";
    existing.setAttribute("http-equiv", "Content-Security-Policy");
    document.head?.appendChild(existing);
    (safeGet as ReturnType<typeof vi.fn>).mockReturnValue("MODERATE");
    applyUserCspProfile();
    const metas = document.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    expect(metas.length).toBe(1);
    expect(metas[0]!.getAttribute("content")).toContain("api.openai.com");
  });

  it("preserves OPEN in development (test env)", () => {
    // In vitest, import.meta.env.PROD is false → OPEN is preserved.
    (safeGet as ReturnType<typeof vi.fn>).mockReturnValue("OPEN");
    applyUserCspProfile();
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta).toBeTruthy();
  });
});
