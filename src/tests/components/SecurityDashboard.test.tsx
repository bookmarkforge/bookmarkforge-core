import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

// t() mock that interpolates {{params}} into the default string so assertions
// can read real rendered text instead of raw keys.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOptions?: unknown,
      options?: Record<string, string | number>,
    ) => {
      let def: string | null = null;
      let opts: Record<string, string | number> | undefined = options;
      if (typeof defaultOrOptions === "string") {
        def = defaultOrOptions;
      } else if (defaultOrOptions && typeof defaultOrOptions === "object") {
        opts = defaultOrOptions as Record<string, string | number>;
      }
      let out = def ?? key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`), String(v));
        }
      }
      return out;
    },
  }),
}));

vi.mock("lucide-react", () => ({
  X: () => <span data-testid="icon-X" />,
  Shield: () => <span data-testid="icon-Shield" />,
  ShieldCheck: () => <span data-testid="icon-ShieldCheck" />,
}));

// A count() query resolves to a NUMBER, not a document array. The doubles
// mirror that shape on EVERY render (not just the first) so the assertion
// fails if the component ever treats the result as an array again (NaN).
const mockUseRxCollection = vi.fn((name: string) => ({
  count: () => ({ name }),
}));
const mockUseRxQuery = vi.fn((query: { name?: string } | undefined) => ({
  result: query?.name === "documents" ? 3 : query?.name === "bookmarks" ? 4 : 0,
  loading: false,
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: (name: string) => mockUseRxCollection(name),
  useRxQuery: (query: unknown) => mockUseRxQuery(query as { name?: string }),
}));

vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => ({ isLocked: false }),
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    hasMasterPassword: vi.fn().mockResolvedValue(true),
    isLocked: vi.fn().mockReturnValue(false),
    getSessionToken: vi.fn().mockReturnValue("session-token"),
    // Required by bmf/no-securityvault-mock-without-lock: peer modules call
    // securityVault.onLock()/onUnlock() from module scope at import time.
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    getVaultKdfSaltHex: vi.fn().mockReturnValue("a".repeat(64)),
  },
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: { isDeviceKeyWrapped: vi.fn().mockResolvedValue(true) },
}));

vi.mock("../../store/rateLimitStore", () => ({
  useRateLimitStore: { getState: () => ({ unlockAttempts: 0, lockoutUntil: 0 }) },
}));

vi.mock("../../components/StorageStatus", () => ({
  getLatestBackupAgeMs: vi.fn().mockResolvedValue(1_000),
}));

import { SecurityDashboard } from "../../components/SecurityDashboard";

describe("SecurityDashboard", () => {
  beforeEach(() => {
    mockUseRxCollection.mockClear();
    mockUseRxQuery.mockClear();
  });

  it("renders the vault health overview", async () => {
    render(<SecurityDashboard />);
    expect(screen.getByTestId("security-dashboard")).toBeTruthy();
    expect(screen.getByText("Security Dashboard")).toBeTruthy();
    // Every check passes with the doubles above (7/7).
    await waitFor(() =>
      expect(screen.getByText("All systems secure")).toBeTruthy(),
    );
  });

  it("sums the vault item counts (count() is a number, never an array)", async () => {
    render(<SecurityDashboard />);
    const label = await screen.findByText("Indexed Items");
    // Regression guard: `result.length` on a numeric count produced NaN.
    await waitFor(() => expect(label.nextElementSibling?.textContent).toBe("7"));
  });

  it("scrolls to the vault controls when the settings action is used", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const target = document.createElement("div");
    target.setAttribute("data-testid", "settings-security");
    document.body.appendChild(target);
    try {
      render(<SecurityDashboard />);
      fireEvent.click(await screen.findByText("Security Settings"));
      expect(scrollSpy).toHaveBeenCalled();
    } finally {
      target.remove();
      if (original) {
        Element.prototype.scrollIntoView = original;
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });

  it("prefers the settings callback over scrolling when one is provided", async () => {
    const original = Element.prototype.scrollIntoView;
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onOpenSettings = vi.fn();
    try {
      // Standalone /security route: navigates to Settings instead of scrolling.
      render(<SecurityDashboard onOpenSettings={onOpenSettings} />);
      fireEvent.click(await screen.findByText("Security Settings"));
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      if (original) {
        Element.prototype.scrollIntoView = original;
      } else {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });
});
