import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockGetDiagnostics = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    db: {
      initialized: true,
      bookmarkCount: 42,
      vectorCount: 128,
      vectorIndexStatus: "loaded",
      initDurationMs: 321,
      initAttempts: 1,
      queryLatency: {
        bookmarkCountMs: 4,
        vectorCountMs: 2,
        sampleReadMs: 7,
      },
    },
    ai: {
      provider: "WebLLM",
      cacheStats: { size: 16, maxSize: 64 },
      ollamaAvailable: false,
      webGpuSupported: true,
      webGpuAdapter: "Intel(R) Arc(TM) Graphics",
    },
    environment: {
      onLine: true,
      batteryLevel: 0.85,
      cores: 8,
    },
    performance: {
      upTime: 3600,
    },
    sync: {
      providers: {},
    },
    vaultCrypto: {
      status: "ok",
      inspected: 2,
      legacyV5: 0,
      saltedV6: 2,
    },
  }),
);
vi.mock("../../services/DiagnosticService", () => ({
  diagnosticService: { getDiagnostics: mockGetDiagnostics },
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => <svg data-testid={`icon-${name}`} {...props} />;
    Icon.displayName = name;
    return Icon;
  };
  return {
    X: mock("X"),
    Activity: mock("Activity"),
    Database: mock("Database"),
    Cpu: mock("Cpu"),
    Battery: mock("Battery"),
    Globe: mock("Globe"),
    Clock: mock("Clock"),
    ShieldCheck: mock("ShieldCheck"),
    Zap: mock("Zap"),
    RefreshCw: mock("RefreshCw"),
    Wrench: mock("Wrench"),
    TrendingUp: mock("TrendingUp"),
    BarChart3: mock("BarChart3"),
    Users: mock("Users"),
    Eye: mock("Eye"),
    CheckCircle2: mock("CheckCircle2"),
    Circle: mock("Circle"),
    Loader2: mock("Loader2"),
    Download: mock("Download"),
    Shield: mock("Shield"),
  };
});

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../services/ai/IntelligentMaintenanceService", () => ({
  intelligentMaintenanceService: {
    getStatus: vi.fn().mockReturnValue({
      enabled: false,
      isRunning: false,
      lastResult: null,
    }),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("../../services/AnalyticsService", () => ({
  analyticsService: {
    getSnapshot: vi.fn().mockResolvedValue({
      eventCount: 0,
      events: [],
      consentGranted: false,
    }),
    trackEvent: vi.fn(),
  },
}));

vi.mock("../ConsentBanner", () => ({
  getStoredConsent: vi.fn().mockReturnValue({ analytics: false }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

describe("DiagnosticsModal", () => {
  let DiagnosticsModal: React.FC<any>;

  const t = (k: string, opts?: any) =>
    typeof opts === "string" ? opts : opts?.defaultValue || k;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetDiagnostics.mockResolvedValue({
      db: {
        initialized: true,
        bookmarkCount: 42,
        vectorCount: 128,
        vectorIndexStatus: "loaded",
        vectorIndexLoadDurationMs: 123,
        initDurationMs: 321,
        initAttempts: 1,
        queryLatency: {
          bookmarkCountMs: 4,
          vectorCountMs: 2,
          sampleReadMs: 7,
        },
      },
      ai: {
        provider: "WebLLM",
        cacheStats: { size: 16, maxSize: 64 },
        ollamaAvailable: false,
        webGpuSupported: true,
        webGpuAdapter: "Intel(R) Arc(TM) Graphics",
      },
      environment: { onLine: true, batteryLevel: 0.85, cores: 8 },
      performance: { upTime: 3600 },
      sync: { providers: {} },
    });
    const mod = await import("../../components/bookmarks/DiagnosticsModal");
    DiagnosticsModal = mod.DiagnosticsModal;
  });

  it("returns null when show=false", () => {
    const { container } = render(
      <DiagnosticsModal show={false} onClose={vi.fn()} t={t} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ignores responses from a previous instance after closing and reopening", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const firstRequest = new Promise((resolve) => { resolveFirst = resolve; });
    const secondRequest = new Promise((resolve) => { resolveSecond = resolve; });
    mockGetDiagnostics
      .mockReset()
      .mockImplementationOnce(() => firstRequest)
      .mockImplementationOnce(() => secondRequest);

    const { rerender, container } = render(
      <DiagnosticsModal show={true} onClose={vi.fn()} t={t} />,
    );
    await waitFor(() => expect(mockGetDiagnostics).toHaveBeenCalledTimes(1));
    rerender(<DiagnosticsModal show={false} onClose={vi.fn()} t={t} />);
    rerender(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => expect(mockGetDiagnostics).toHaveBeenCalledTimes(2));

    resolveFirst!({
      db: {
        initialized: true,
        bookmarkCount: 11,
        vectorCount: 1,
        vectorIndexStatus: "loaded",
        vectorIndexLoadDurationMs: 1,
      },
      ai: { provider: "first", cacheStats: { size: 0, maxSize: 1 }, ollamaAvailable: false, webGpuSupported: false, webGpuAdapter: null },
      environment: { onLine: true, batteryLevel: null, cores: 1 },
      performance: { upTime: 1 },
      sync: { providers: {} },
    });
    await waitFor(() => expect(container.querySelector(".animate-spin")).toBeTruthy());

    resolveSecond!({
      db: {
        initialized: true,
        bookmarkCount: 99,
        vectorCount: 2,
        vectorIndexStatus: "rebuilt",
        vectorIndexLoadDurationMs: 2,
      },
      ai: { provider: "second", cacheStats: { size: 0, maxSize: 1 }, ollamaAvailable: false, webGpuSupported: false, webGpuAdapter: null },
      environment: { onLine: true, batteryLevel: null, cores: 1 },
      performance: { upTime: 2 },
      sync: { providers: {} },
    });
    await waitFor(() => expect(screen.getByText("99")).toBeTruthy());
    expect(screen.queryByText("11")).toBeNull();
  });

  it("shows loading spinner initially", () => {
    mockGetDiagnostics.mockImplementationOnce(() => new Promise(() => {}));
    const { container, unmount } = render(
      <DiagnosticsModal show={true} onClose={vi.fn()} t={t} />,
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
    unmount();
  });

  it("shows diagnostic data after loading", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("System Health")).toBeTruthy();
    });
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("321ms")).toBeTruthy();
    expect(screen.getByText("7ms")).toBeTruthy();
    expect(screen.getByText("WebLLM")).toBeTruthy();
    expect(screen.getByText("YES")).toBeTruthy();
  });

  it("shows DB section with metrics", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("Database (RxDB)")).toBeTruthy();
    });
    expect(screen.getByText("128")).toBeTruthy();
    expect(screen.getByText("128").closest("[title]")).toHaveAttribute(
      "title",
      "loaded · 123ms",
    );
  });

  it("shows AI Engine section", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("AI Engine")).toBeTruthy();
    });
    expect(screen.getByText("GPU Adapter")).toBeTruthy();
  });

  it("shows Environment section", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("Environment")).toBeTruthy();
    });
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("closes when clicking X button", async () => {
    const onClose = vi.fn();
    render(<DiagnosticsModal show={true} onClose={onClose} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("System Health")).toBeTruthy();
    });
    const xIcons = screen.getAllByTestId("icon-X");
    await userEvent.click(xIcons[0]!);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when clicking Close Diagnostics", async () => {
    const onClose = vi.fn();
    render(<DiagnosticsModal show={true} onClose={onClose} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("Close Diagnostics")).toBeTruthy();
    });
    await userEvent.click(screen.getByText("Close Diagnostics"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows Connected when online", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeTruthy();
    });
  });

  it("shows the report token in the footer", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText(/Diagnostic Report Token:/)).toBeTruthy();
    });
  });

  it("does not show sync section when there are no providers", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("System Health")).toBeTruthy();
    });
    expect(screen.queryByText("Cloud Sync")).toBeNull();
  });

  // ── Fusionado de src/tests/components/bookmarks/DiagnosticsModal.test.tsx ──

  it("renders in light mode (isDark=false)", async () => {
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} isDark={false} />);
    await waitFor(() => expect(screen.getByText("System Health")).toBeTruthy());
  });

  it("shows Offline when there is no connection", async () => {
    mockGetDiagnostics.mockResolvedValue({
      db: {
        initialized: true,
        bookmarkCount: 42,
        vectorCount: 10,
        vectorIndexStatus: "loaded",
        initDurationMs: null,
        initAttempts: null,
        queryLatency: {
          bookmarkCountMs: null,
          vectorCountMs: null,
          sampleReadMs: null,
        },
      },
      ai: {
        provider: "gemini",
        cacheStats: { size: 100, maxSize: 500 },
        ollamaAvailable: true,
        webGpuSupported: false,
        webGpuAdapter: null,
      },
      environment: { onLine: false, batteryLevel: 0.75, cores: 8 },
      performance: { upTime: 3600 },
    });
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeTruthy());
  });

  it("shows n/a when battery level is not available", async () => {
    mockGetDiagnostics.mockResolvedValue({
      db: {
        initialized: true,
        bookmarkCount: 42,
        vectorCount: 10,
        vectorIndexStatus: "loaded",
        initDurationMs: null,
        initAttempts: null,
        queryLatency: {
          bookmarkCountMs: null,
          vectorCountMs: null,
          sampleReadMs: null,
        },
      },
      ai: {
        provider: "gemini",
        cacheStats: { size: 100, maxSize: 500 },
        ollamaAvailable: true,
        webGpuSupported: false,
        webGpuAdapter: null,
      },
      environment: { onLine: true, batteryLevel: null, cores: 8 },
      performance: { upTime: 3600 },
    });
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => expect(screen.getByText("N/A")).toBeTruthy());
  });

  it("shows Cloud Sync section when there are providers", async () => {
    mockGetDiagnostics.mockResolvedValue({
      db: {
        initialized: true,
        bookmarkCount: 42,
        vectorCount: 10,
        vectorIndexStatus: "loaded",
        initDurationMs: null,
        initAttempts: null,
        queryLatency: {
          bookmarkCountMs: null,
          vectorCountMs: null,
          sampleReadMs: null,
        },
      },
      ai: {
        provider: "gemini",
        cacheStats: { size: 100, maxSize: 500 },
        ollamaAvailable: true,
        webGpuSupported: false,
        webGpuAdapter: null,
      },
      environment: { onLine: true, batteryLevel: 0.75, cores: 8 },
      performance: { upTime: 3600 },
      sync: {
        providers: {
          webdav: {
            successCount: 3,
            attempts: 5,
            retryCount: 1,
            lastDurationMs: 250,
          },
          dropbox: {
            successCount: 0,
            attempts: 2,
            retryCount: 2,
            lastDurationMs: null,
          },
        },
      },
    });
    render(<DiagnosticsModal show={true} onClose={vi.fn()} t={t} />);
    await waitFor(() => {
      expect(screen.getByText("webdav")).toBeTruthy();
      expect(screen.getByText("dropbox")).toBeTruthy();
      // Duration format (webdav lastDurationMs=250) and the "n/a" fallback
      // for the provider without duration (dropbox lastDurationMs=null) — branch
      // preserved from the deleted bookmarks/ copy.
      expect(screen.getByText("250ms")).toBeTruthy();
      expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("generateReportToken (L-01)", () => {
  it("generates a 12-char hex token in uppercase", async () => {
    const mod = await import("../../components/bookmarks/DiagnosticsModal");
    const token = mod.generateReportToken();
    expect(token).toMatch(/^[0-9A-F]{12}$/);
  });

  it("uses crypto.getRandomValues instead of Math.random", async () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    try {
      const mod = await import("../../components/bookmarks/DiagnosticsModal");
      mod.generateReportToken();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
