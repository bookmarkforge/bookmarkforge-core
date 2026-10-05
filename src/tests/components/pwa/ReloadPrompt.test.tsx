import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockSetOfflineReady = vi.fn();
const mockSetNeedRefresh = vi.fn();
const mockUpdateSW = vi.fn();

const mockState = vi.hoisted(() => ({
  offlineReady: false,
  needRefresh: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) =>
      typeof opts === "string" ? opts : opts?.defaultValue || s,
  }),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [mockState.offlineReady, mockSetOfflineReady],
    needRefresh: [mockState.needRefresh, mockSetNeedRefresh],
    updateServiceWorker: mockUpdateSW,
  }),
}));

const { ReloadPrompt } = await import("../../../components/pwa/ReloadPrompt");

describe("ReloadPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.offlineReady = false;
    mockState.needRefresh = false;
  });

  it("renders null when offlineReady and needRefresh are false", () => {
    const { container } = render(<ReloadPrompt />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders content when offlineReady is true", () => {
    mockState.offlineReady = true;
    const { getByText } = render(<ReloadPrompt />);
    expect(getByText("App is ready for offline use.")).toBeTruthy();
  });

  it("renders content when needRefresh is true", () => {
    mockState.needRefresh = true;
    const { getByText } = render(<ReloadPrompt />);
    expect(getByText("A new version is available.")).toBeTruthy();
  });

  it("dismiss button calls setOfflineReady(false) and setNeedRefresh(false) when offlineReady", () => {
    mockState.offlineReady = true;
    render(<ReloadPrompt />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(mockSetOfflineReady).toHaveBeenCalledWith(false);
    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
  });

  it("dismiss button calls setOfflineReady(false) and setNeedRefresh(false) when needRefresh", () => {
    mockState.needRefresh = true;
    render(<ReloadPrompt />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(mockSetOfflineReady).toHaveBeenCalledWith(false);
    expect(mockSetNeedRefresh).toHaveBeenCalledWith(false);
  });

  it("reload button calls updateServiceWorker(true)", () => {
    mockState.needRefresh = true;
    render(<ReloadPrompt />);
    fireEvent.click(screen.getByText("Reload"));
    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it("reload button is NOT shown when only offlineReady is true", () => {
    mockState.offlineReady = true;
    mockState.needRefresh = false;
    render(<ReloadPrompt />);
    expect(screen.queryByText("Reload")).toBeNull();
  });

  it("reload button IS shown when needRefresh is true", () => {
    mockState.needRefresh = true;
    render(<ReloadPrompt />);
    expect(screen.getByText("Reload")).toBeDefined();
  });

  it("both states true shows needRefresh message", () => {
    mockState.offlineReady = true;
    mockState.needRefresh = true;
    render(<ReloadPrompt />);
    expect(screen.getByText("A new version is available.")).toBeDefined();
  });

  it("dismiss button hidden when both states false", () => {
    render(<ReloadPrompt />);
    expect(screen.queryByText("Dismiss")).toBeNull();
  });
});
