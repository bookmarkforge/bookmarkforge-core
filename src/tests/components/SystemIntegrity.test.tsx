import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
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
    Shield: mock("Shield"),
    Activity: mock("Activity"),
    AlertTriangle: mock("AlertTriangle"),
    CheckCircle: mock("CheckCircle"),
    Info: mock("Info"),
    Cpu: mock("Cpu"),
    Zap: mock("Zap"),
  };
});

// No esparcir props de motion (whileHover/variants/...) al DOM: no son
// valid attributes and React emits warnings that mask the real ones.
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const mockDiagnostics = {
  ai: { webGpuSupported: true },
  environment: { memoryLimit: 8, cores: 8, isARM64: false },
  performance: { upTime: 3600 },
  storage: {},
};
const mockGetDiagnostics = vi.fn().mockResolvedValue(mockDiagnostics);
vi.mock("../../services/DiagnosticService", () => ({
  diagnosticService: { getDiagnostics: mockGetDiagnostics },
}));

describe("SystemIntegrity", () => {
  let SystemIntegrity: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetDiagnostics.mockResolvedValue(mockDiagnostics);
    const mod = await import("../../components/analytics/SystemIntegrity");
    SystemIntegrity = mod.SystemIntegrity;
  });

  it("returns null while loading", () => {
    mockGetDiagnostics.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SystemIntegrity />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("ignores diagnostics that resolve after unmount", async () => {
    let resolveDiagnostics!: (value: typeof mockDiagnostics) => void;
    mockGetDiagnostics.mockReturnValue(
      new Promise((resolve) => {
        resolveDiagnostics = resolve;
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<SystemIntegrity />);
    await waitFor(() => expect(mockGetDiagnostics).toHaveBeenCalled());
    unmount();
    resolveDiagnostics(mockDiagnostics);
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("shows health score", async () => {
    render(<SystemIntegrity />);
    expect(await screen.findByText("98%")).toBeTruthy();
    expect(screen.getByText("syst_healthScore")).toBeTruthy();
  });

  it("shows title", async () => {
    render(<SystemIntegrity />);
    expect(await screen.findByText("syst_integrity")).toBeTruthy();
  });

  it("shows WebGPU status", async () => {
    render(<SystemIntegrity />);
    expect(await screen.findByText("app_webGPU")).toBeTruthy();
  });

  it("shows memory info", async () => {
    render(<SystemIntegrity />);
    expect(await screen.findByText(/syst_gbRam/)).toBeTruthy();
  });

  it("shows proactive insights", async () => {
    mockGetDiagnostics.mockResolvedValue({
      ai: { webGpuSupported: false },
      environment: { memoryLimit: 8, cores: 8, isARM64: true },
      performance: { upTime: 3600 },
      storage: {},
    });
    render(<SystemIntegrity />);
    expect(await screen.findByText("syst_arm64Optim")).toBeTruthy();
  });
});
