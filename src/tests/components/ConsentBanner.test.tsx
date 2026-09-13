import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsentBanner, getStoredConsent, hasConsentDecision } from "../../components/ConsentBanner";
import { STORAGE_KEYS } from "../../constants/storage-keys";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../hooks/useFocusTrap", () => ({
  useFocusTrap: vi.fn(),
}));

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
      // Strip motion-specific props that don't work in test
      const { initial, animate, exit, transition, ...validProps } = props as Record<string, unknown>;
      return <div {...validProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// In-memory safeStorage mock
const store = new Map<string, string>();
vi.mock("../../store/safeStorage", () => ({
  safeGet: (key: string) => store.get(key) ?? null,
  safeSet: (key: string, value: string) => { store.set(key, value); },
  safeRemove: (key: string) => { store.delete(key); },
}));

// ── Test suite ─────────────────────────────────────────────────────

describe("ConsentBanner", () => {
  const mockOnConsentDecided = vi.fn();

  beforeEach(() => {
    store.clear();
    mockOnConsentDecided.mockClear();
  });

  it("renders the consent banner with title and description", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    expect(screen.getByText("Your Privacy Matters")).toBeTruthy();
    expect(screen.getByText(/BookmarkForge is privacy-first/)).toBeTruthy();
  });

  it("renders Accept All and Reject All buttons", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    expect(screen.getByRole("button", { name: /Accept All/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject All/i })).toBeTruthy();
  });

  it("renders Manage preferences toggle", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    expect(screen.getByRole("button", { name: /Manage preferences/i })).toBeTruthy();
  });

  it("renders privacy policy link", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    const link = screen.getByText("Privacy Policy");
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/privacy");
  });

  it("Accept All calls onConsentDecided with all true", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    fireEvent.click(screen.getByRole("button", { name: /Accept All/i }));
    expect(mockOnConsentDecided).toHaveBeenCalledWith({
      analytics: true,
      errorReporting: true,
      clientEvents: true,
    });
  });

  it("Reject All calls onConsentDecided with all false", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    fireEvent.click(screen.getByRole("button", { name: /Reject All/i }));
    expect(mockOnConsentDecided).toHaveBeenCalledWith({
      analytics: false,
      errorReporting: false,
      clientEvents: false,
    });
  });

  it("persists consent to storage on Accept All", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    fireEvent.click(screen.getByRole("button", { name: /Accept All/i }));
    expect(store.get(STORAGE_KEYS.CONSENT_DECISION_MADE)).toBe("true");
    expect(store.get(STORAGE_KEYS.CONSENT_ANALYTICS)).toBe("true");
    expect(store.get(STORAGE_KEYS.CONSENT_SENTRY)).toBe("true");
    expect(store.get(STORAGE_KEYS.CONSENT_CLIENT_EVENTS)).toBe("true");
    // ADR-030: a complete modern decision removes the legacy keys so they
    // can never resurrect an old decision.
    expect(store.has(STORAGE_KEYS.CONSENT_ERROR_REPORTING)).toBe(false);
    expect(store.has(STORAGE_KEYS.LOCAL_ERROR_STORAGE)).toBe(false);
  });

  it("persists consent to storage on Reject All", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    fireEvent.click(screen.getByRole("button", { name: /Reject All/i }));
    expect(store.get(STORAGE_KEYS.CONSENT_DECISION_MADE)).toBe("true");
    expect(store.get(STORAGE_KEYS.CONSENT_ANALYTICS)).toBe("false");
    expect(store.get(STORAGE_KEYS.CONSENT_SENTRY)).toBe("false");
    expect(store.get(STORAGE_KEYS.CONSENT_CLIENT_EVENTS)).toBe("false");
    expect(store.has(STORAGE_KEYS.CONSENT_ERROR_REPORTING)).toBe(false);
    expect(store.has(STORAGE_KEYS.LOCAL_ERROR_STORAGE)).toBe(false);
  });

  it("expands preferences when Manage preferences is clicked", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    fireEvent.click(screen.getByRole("button", { name: /Manage preferences/i }));
    expect(screen.getByText("Product Analytics")).toBeTruthy();
    expect(screen.getByText("Error Reporting")).toBeTruthy();
    expect(screen.getByText("Operational Events")).toBeTruthy();
  });

  it("can toggle individual preferences", () => {
    render(<ConsentBanner onConsentDecided={mockOnConsentDecided} />);
    fireEvent.click(screen.getByRole("button", { name: /Manage preferences/i }));
    
    // Uncheck analytics
    const analyticsCheckbox = screen.getByRole("checkbox", { name: "Product Analytics" });
    fireEvent.click(analyticsCheckbox);
    
    // Save preferences
    fireEvent.click(screen.getByRole("button", { name: /Save Preferences/i }));
    
    expect(mockOnConsentDecided).toHaveBeenCalledWith({
      analytics: true,
      errorReporting: false,
      clientEvents: false,
    });
  });

  it("getStoredConsent returns null when no decision has been made", () => {
    expect(getStoredConsent()).toBeNull();
  });

  it("getStoredConsent returns toggles when decision exists", () => {
    store.set(STORAGE_KEYS.CONSENT_DECISION_MADE, "true");
    store.set(STORAGE_KEYS.CONSENT_ANALYTICS, "true");
    store.set(STORAGE_KEYS.CONSENT_ERROR_REPORTING, "false");
    store.set(STORAGE_KEYS.CONSENT_CLIENT_EVENTS, "true");
    
    const consent = getStoredConsent();
    expect(consent).toEqual({
      analytics: true,
      errorReporting: false,
      clientEvents: true,
    });
  });

  it("hasConsentDecision returns false when no decision has been made", () => {
    expect(hasConsentDecision()).toBe(false);
  });

  it("hasConsentDecision returns true when decision exists", () => {
    store.set(STORAGE_KEYS.CONSENT_DECISION_MADE, "true");
    expect(hasConsentDecision()).toBe(true);
  });
});
