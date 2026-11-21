
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const mockWebLLM = vi.hoisted(() => ({
  onProgress: vi.fn(() => vi.fn()),
  init: vi.fn(),
  canRunLocalLLM: vi.fn(),
  isWebGPUSupported: vi.fn(),
}));

// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (the card subscribes to progress via the gate).
vi.mock("../../services/pro-access", () => ({
  loadWebLLMService: () => Promise.resolve(mockWebLLM),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
    i18n: { language: "en" },
  }),
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
    Brain: mock("Brain"),
    CheckCircle: mock("CheckCircle"),
    AlertCircle: mock("AlertCircle"),
    Info: mock("Info"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

let mockStore = {
  isDownloading: false,
  isWarmingUp: false,
  progressValue: 0,
  progressText: "",
  error: null,
};
vi.mock("../../store/webllmStore", () => ({ useWebLLMStore: () => mockStore }));

describe("AIModelHydration", () => {
  let AIModelHydration: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore = {
      isDownloading: false,
      isWarmingUp: false,
      progressValue: 0,
      progressText: "",
      error: null,
    };
    const mod = await import("../../components/ai/AIModelHydration");
    AIModelHydration = mod.AIModelHydration;
  });

  it("returns null when idle", () => {
    const { container } = render(<AIModelHydration />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("shows progress when isDownloading", () => {
    mockStore = {
      isDownloading: true,
      isWarmingUp: false,
      progressValue: 0.5,
      progressText: "Downloading...",
      error: null,
    };
    render(<AIModelHydration />);
    expect(screen.getByText("app_localFirstAi")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("does not subscribe if the import finishes after unmount", async () => {
    const { unmount } = render(<AIModelHydration />);
    unmount();

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockWebLLM.onProgress).not.toHaveBeenCalled();
  });

  it("unsubscribes from progress on unmount", async () => {
    const { unmount } = render(<AIModelHydration />);
    await waitFor(() => expect(mockWebLLM.onProgress).toHaveBeenCalled());

    const unsubscribe = mockWebLLM.onProgress.mock.results[0]?.value;
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("shows warming up", () => {
    mockStore = {
      isDownloading: false,
      isWarmingUp: true,
      progressValue: 0,
      progressText: "",
      error: null,
    };
    render(<AIModelHydration />);
    expect(screen.getByText("AI Warming Up")).toBeTruthy();
    expect(screen.getByText("PREDICTIVE")).toBeTruthy();
  });

  it("shows error", () => {
    mockStore = {
      isDownloading: false,
      isWarmingUp: false,
      progressValue: 0,
      progressText: "",
      error: "Failed" as any,
    };
    render(<AIModelHydration />);
    expect(screen.getByText("app_somethingWentWrong")).toBeTruthy();
  });

  it("shows check when completed", () => {
    mockStore = {
      isDownloading: true,
      isWarmingUp: false,
      progressValue: 1,
      progressText: "Done",
      error: null,
    };
    render(<AIModelHydration />);
    expect(screen.getByText("app_localFirstAi")).toBeTruthy();
  });

  it("is purely passive: never starts the engine or probes capability", async () => {
    // The hydration card must only subscribe to progress events — it must
    // never itself call init(), canRunLocalLLM() or isWebGPUSupported()
    // (those are ProviderManager.warmup()/UI-gate concerns, both gated on
    // the strict capability check). A regression that adds an engine call
    // here would fail loudly instead of downloading a model in the UI.
    mockStore = {
      isDownloading: true,
      isWarmingUp: false,
      progressValue: 0.5,
      progressText: "Downloading...",
      error: null,
    };
    render(<AIModelHydration />);
    await waitFor(() => expect(mockWebLLM.onProgress).toHaveBeenCalled());
    expect(mockWebLLM.init).not.toHaveBeenCalled();
    expect(mockWebLLM.canRunLocalLLM).not.toHaveBeenCalled();
    expect(mockWebLLM.isWebGPUSupported).not.toHaveBeenCalled();
  });
});
