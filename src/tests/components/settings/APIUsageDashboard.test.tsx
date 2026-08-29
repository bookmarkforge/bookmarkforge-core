import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s, i18n: { language: "en" } }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    BarChart3: mock("BarChart3"),
    AlertTriangle: mock("AlertTriangle"),
    DollarSign: mock("DollarSign"),
    RefreshCw: mock("RefreshCw"),
  };
});

const mockGetAllUsage = vi.fn(() => ({}));
const mockGetConfig = vi.fn(() => ({ maxRequests: 1000 }));
const mockIsNearLimit = vi.fn((_provider: string) => false);
const mockCheckLimit = vi.fn(() => ({ exhausted: false }));
vi.mock("../../../services/RateLimitService", () => ({
  rateLimitService: {
    getAllUsage: mockGetAllUsage,
    getConfig: mockGetConfig,
    isNearLimit: mockIsNearLimit,
    checkLimit: mockCheckLimit,
  },
  QuotaUsage: {},
}));

describe("APIUsageDashboard", () => {
  let APIUsageDashboard: React.FC<{ className?: string }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../components/settings/APIUsageDashboard");
    APIUsageDashboard = mod.APIUsageDashboard;
  });

  it("shows empty state when there is no usage", () => {
    mockGetAllUsage.mockReturnValue({});
    render(<APIUsageDashboard />);
    expect(screen.getByText("app_noApiUsage")).toBeTruthy();
  });

  it("shows title", () => {
    mockGetAllUsage.mockReturnValue({});
    render(<APIUsageDashboard />);
    expect(screen.getByText("app_apiUsage")).toBeTruthy();
  });

  it("shows provider data when there is usage", () => {
    mockGetAllUsage.mockReturnValue({
      google: { requestsToday: 50, tokensToday: 1000, costEstimate: 0 },
    });
    render(<APIUsageDashboard />);
    expect(screen.getByText("Google Gemini")).toBeTruthy();
  });

  it("shows near limit warning", () => {
    mockGetAllUsage.mockReturnValue({
      google: { requestsToday: 950, tokensToday: 1000, costEstimate: 0 },
    });
    mockIsNearLimit.mockImplementation((p: string): boolean => p === "google");
    mockCheckLimit.mockReturnValue({ exhausted: false });
    render(<APIUsageDashboard />);
    expect(screen.getByText("app_nearLimit")).toBeTruthy();
  });

  it("flags a provider that has reached its limit", () => {
    mockGetAllUsage.mockReturnValue({
      google: { requestsToday: 10, tokensToday: 2000, costEstimate: 0 },
    });
    mockCheckLimit.mockReturnValue({ exhausted: true });
    render(<APIUsageDashboard />);
    expect(screen.getByText("app_limitReached")).toBeTruthy();
  });

  it("has a refresh button", () => {
    mockGetAllUsage.mockReturnValue({
      google: { requestsToday: 10, tokensToday: 100, costEstimate: 0 },
    });
    render(<APIUsageDashboard />);
    expect(screen.getByLabelText("aria_refresh_usage")).toBeTruthy();
  });

  it("refreshes usage on button click", async () => {
    mockGetAllUsage.mockReturnValue({
      google: { requestsToday: 10, tokensToday: 2000, costEstimate: 0 },
    });
    render(<APIUsageDashboard />);
    const callsBefore = mockGetAllUsage.mock.calls.length;
    await userEvent.click(screen.getByLabelText("aria_refresh_usage"));
    // Click must trigger a re-fetch beyond the initial render effect.
    expect(mockGetAllUsage.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
