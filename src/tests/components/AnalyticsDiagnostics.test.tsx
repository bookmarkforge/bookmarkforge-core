import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ── Mocks ──────────────────────────────────────────────────────────

const mockGetSnapshot = vi.hoisted(() => vi.fn());

vi.mock("../../services/AnalyticsService", () => ({
  analyticsService: { getSnapshot: mockGetSnapshot },
}));

vi.mock("../../components/ConsentBanner", () => ({
  getStoredConsent: vi.fn(() => ({ analytics: true })),
  hasConsentDecision: vi.fn(() => true),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockIcon = (name: string) => {
  const Icon = (props: Record<string, unknown>) => (
    <svg data-testid={`icon-${name}`} {...props} />
  );
  Icon.displayName = name;
  return Icon;
};

vi.mock("lucide-react", () => ({
  TrendingUp: mockIcon("TrendingUp"),
  Users: mockIcon("Users"),
  BarChart3: mockIcon("BarChart3"),
  Clock: mockIcon("Clock"),
  CheckCircle2: mockIcon("CheckCircle2"),
  Circle: mockIcon("Circle"),
  Zap: mockIcon("Zap"),
  Loader2: mockIcon("Loader2"),
  RefreshCw: mockIcon("RefreshCw"),
  Download: mockIcon("Download"),
  Shield: mockIcon("Shield"),
}));

// ── Helpers ────────────────────────────────────────────────────────

const t = (k: string, opts?: unknown): string => {
  if (typeof opts === "string") return opts;
  const o = (opts ?? {}) as Record<string, unknown>;
  let val = String(o.defaultValue || k);
  // Simple i18next interpolation for {{count}}, {{time}}, {{progress}}
  if (o.count !== undefined) val = val.replace(/\{\{count\}\}/g, String(o.count));
  if (o.time !== undefined) val = val.replace(/\{\{time\}\}/g, String(o.time));
  if (o.progress !== undefined) val = val.replace(/\{\{progress\}\}/g, String(o.progress));
  return val;
};

const fullSnapshot = {
  retention: {
    activeDays: 12,
    accountAge: 30,
    activeD1: true,
    activeD7: true,
    activeD30: true,
    currentStreak: 5,
    longestStreak: 8,
  },
  engagement: {
    totalSessions: 24,
    totalBookmarks: 42,
    totalDocuments: 15,
    totalSearches: 8,
    totalImports: 3,
    totalExports: 2,
    totalAICalls: 10,
    totalP2PSyncs: 4,
    totalCaptures: 7,
    avgSessionDurationSec: 300,
    medianSessionDurationSec: 240,
    featuresUsed: ["bookmark_created", "search_used", "ai_chat_used"],
    funnel: {
      vaultCreated: true,
      firstCapture: true,
      firstDocument: true,
      setupCompleted: true,
    },
  },
  generatedAt: "2026-08-28T12:00:00.000Z",
  eventCount: 150,
};

const emptySnapshot = {
  retention: {
    activeDays: 0,
    accountAge: 0,
    activeD1: false,
    activeD7: false,
    activeD30: false,
    currentStreak: 0,
    longestStreak: 0,
  },
  engagement: {
    totalSessions: 0,
    totalBookmarks: 0,
    totalDocuments: 0,
    totalSearches: 0,
    totalImports: 0,
    totalExports: 0,
    totalAICalls: 0,
    totalP2PSyncs: 0,
    totalCaptures: 0,
    avgSessionDurationSec: 0,
    medianSessionDurationSec: 0,
    featuresUsed: [],
    funnel: {
      vaultCreated: false,
      firstCapture: false,
      firstDocument: false,
      setupCompleted: false,
    },
  },
  generatedAt: "2026-08-28T12:00:00.000Z",
  eventCount: 0,
};

// ── Tests ──────────────────────────────────────────────────────────

// describe.sequential: each test renders the same component into the shared
// document.body. Parallel RTL runs can overlap across tests -> duplicate
// getByText matches / act warnings under load. Sequential keeps it deterministic.
describe.sequential("AnalyticsDiagnostics", () => {
  let AnalyticsDiagnostics: React.FC<{ t: typeof t }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetSnapshot.mockResolvedValue(fullSnapshot);
    // Re-apply mock implementations after clearAllMocks
    const { getStoredConsent } = await import("../../components/ConsentBanner");
    (getStoredConsent as ReturnType<typeof vi.fn>).mockReturnValue({ analytics: true });
    const mod = await import("../../components/settings/AnalyticsDiagnostics");
    AnalyticsDiagnostics = mod.AnalyticsDiagnostics;
  });

  it("renders the Product Analytics heading", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(screen.getByText("Product Analytics")).toBeTruthy();
  });

  it("shows consent required message when analytics not granted", async () => {
    const { getStoredConsent } = await import("../../components/ConsentBanner");
    (getStoredConsent as ReturnType<typeof vi.fn>).mockReturnValue({ analytics: false });
    render(<AnalyticsDiagnostics t={t} />);
    expect(
      screen.getByText(/Enable analytics in Privacy settings/),
    ).toBeTruthy();
  });

  it("loads and displays snapshot data", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    // findBy*: tolerant of render timing under load (act races),
    // unlike getByText inside waitFor.
    expect(await screen.findByText("12")).toBeTruthy(); // activeDays
    expect(screen.getByText("30d")).toBeTruthy(); // accountAge
    expect(screen.getByText("5d")).toBeTruthy(); // currentStreak
    expect(screen.getByText("8d")).toBeTruthy(); // longestStreak
  });

  it("shows retention D1/D7/D30 indicators", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText("D1: ✓")).toBeTruthy();
    expect(screen.getByText("D7: ✓")).toBeTruthy();
    expect(screen.getByText("D30: ✓")).toBeTruthy();
  });

  it("shows engagement metrics", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText("24")).toBeTruthy(); // sessions
    expect(screen.getByText("42")).toBeTruthy(); // bookmarks
    expect(screen.getByText("15")).toBeTruthy(); // documents
    expect(screen.getByText("8")).toBeTruthy(); // searches
  });

  it("formats session duration correctly", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText("5m")).toBeTruthy(); // 300s
    expect(screen.getByText("4m")).toBeTruthy(); // 240s
  });

  it("shows features used tags", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText("bookmark_created")).toBeTruthy();
    expect(screen.getByText("search_used")).toBeTruthy();
    expect(screen.getByText("ai_chat_used")).toBeTruthy();
  });

  it("shows setup funnel steps", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText("Vault Created")).toBeTruthy();
    expect(screen.getByText("First Capture")).toBeTruthy();
    expect(screen.getByText("First Document")).toBeTruthy();
    expect(screen.getByText("Setup Complete")).toBeTruthy();
  });

  it("shows empty state when no snapshot is available", async () => {
    mockGetSnapshot.mockResolvedValue(null);
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText(/No analytics data yet/)).toBeTruthy();
  });

  it("shows event count and generation time in footer", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    expect(await screen.findByText(/150.*events/)).toBeTruthy(); // eventCount shown via translate
  });

  it("refresh button triggers reload", async () => {
    render(<AnalyticsDiagnostics t={t} />);
    const refreshBtn = await screen.findByLabelText("Refresh analytics");
    await userEvent.click(refreshBtn);
    // The click may be processed asynchronously under load — wait for the
    // second call instead of asserting instantly (the exact race source).
    await waitFor(() => {
      expect(mockGetSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});
