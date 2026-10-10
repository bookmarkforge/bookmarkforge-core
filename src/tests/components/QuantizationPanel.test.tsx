import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

// The component uses t(key) and t(key, fallbackString) for badges ("4x")
// and t(key, { mode }) with options for toasts — the mock must tell
// a string fallback apart from an options object, like real i18next.
vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string | Record<string, unknown>) =>
    typeof fb === "string" ? fb : key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

// Preserves the original navigator.deviceMemory descriptor to restore it
// after each test (defineProperty in one test must not leak to the next).
const originalDeviceMemory = Object.getOwnPropertyDescriptor(
  navigator,
  "deviceMemory",
);
afterEach(() => {
  if (originalDeviceMemory) {
    Object.defineProperty(navigator, "deviceMemory", originalDeviceMemory);
  } else {
    delete (navigator as { deviceMemory?: unknown }).deviceMemory;
  }
});

vi.mock("../../services/ai/VectorIndexService", () => ({
  vectorIndexService: {
    getStats: vi.fn().mockResolvedValue({
      count: 100,
      mode: "polar8",
      memoryUsageBytes: 1024,
    }),
    setQuantizationMode: vi.fn(),
    rebuild: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
    Zap: mock("Zap"),
    Cpu: mock("Cpu"),
    RefreshCw: mock("RefreshCw"),
    HardDrive: mock("HardDrive"),
  };
});

const flushQuantizationStats = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("QuantizationPanel", () => {
  let QuantizationPanel: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/QuantizationPanel");
    QuantizationPanel = mod.QuantizationPanel;
  });

  it("renders without errors", async () => {
    const { container, unmount } = render(<QuantizationPanel />);
    expect(container).toBeTruthy();
    await flushQuantizationStats();
    unmount();
  });

  it("renders CPU icon", async () => {
    const { unmount } = render(<QuantizationPanel />);
    expect(screen.getByTestId("icon-Cpu")).toBeTruthy();
    await flushQuantizationStats();
    unmount();
  });

  it("renders mode buttons", async () => {
    const { unmount } = render(<QuantizationPanel />);
    expect(screen.getByText("app_float32")).toBeTruthy();
    expect(screen.getByText("app_polar8")).toBeTruthy();
    await flushQuantizationStats();
    unmount();
  });

  it("renders Auto Tune button", async () => {
    const { unmount } = render(<QuantizationPanel />);
    expect(screen.getByTestId("icon-Zap")).toBeTruthy();
    await flushQuantizationStats();
    unmount();
  });

  it("renders Save to Disk button", async () => {
    const { unmount } = render(<QuantizationPanel />);
    expect(screen.getByTestId("icon-HardDrive")).toBeTruthy();
    await flushQuantizationStats();
    unmount();
  });

  it("renders stats via async", async () => {
    render(<QuantizationPanel />);
    const count = await screen.findByText(
      (c) => c.startsWith("100"),
      undefined,
      { timeout: 3000 },
    );
    expect(count).toBeTruthy();
  });

  it("changes the mode, rebuilds the index and shows a success toast", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    render(<QuantizationPanel />);
    const polar4Btn = screen.getByText("app_polar4").closest("button")!;
    await userEvent.click(polar4Btn);
    expect(vis.setQuantizationMode).toHaveBeenCalledWith("polar4");
    await waitFor(() => {
      expect(vis.rebuild).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        "app_indexRebuilt",
      );
    });
  });

  it("shows error if the rebuild fails", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    vis.rebuild.mockRejectedValueOnce(new Error("rebuild failed"));
    render(<QuantizationPanel />);
    const qjlBtn = screen.getByText("app_qjl").closest("button")!;
    await userEvent.click(qjlBtn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_failedRebuild");
    });
  });

  it("saves the index when clicking Save to Disk", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    render(<QuantizationPanel />);
    const saveBtn = screen.getByText("app_saveToDisk").closest("button")!;
    await userEvent.click(saveBtn);
    expect(vis.commit).toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("app_indexSaved");
    });
  });

  it("shows error if saving the index fails", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    vis.commit.mockRejectedValueOnce(new Error("disk full"));
    render(<QuantizationPanel />);
    const saveBtn = screen.getByText("app_saveToDisk").closest("button")!;
    await userEvent.click(saveBtn);
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_failedSaveIndex");
    });
  });

  it("auto-tune recommends mode based on deviceMemory and switches", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    Object.defineProperty(navigator, "deviceMemory", {
      value: 2,
      configurable: true,
    });
    render(<QuantizationPanel />);
    const autoTuneBtn = screen.getByText("app_autoTune").closest("button")!;
    await userEvent.click(autoTuneBtn);
    await waitFor(() => {
      expect(vis.setQuantizationMode).toHaveBeenCalledWith("qjl");
    });
    expect(toast.info).toHaveBeenCalledWith("app_autoTuningTo");
  });

  it("auto-tune recomienda polar4 para memoria media (3-4GB)", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    Object.defineProperty(navigator, "deviceMemory", {
      value: 4,
      configurable: true,
    });
    render(<QuantizationPanel />);
    const autoTuneBtn = screen.getByText("app_autoTune").closest("button")!;
    await userEvent.click(autoTuneBtn);
    await waitFor(() => {
      expect(vis.setQuantizationMode).toHaveBeenCalledWith("polar4");
    });
    expect(toast.info).toHaveBeenCalledWith("app_autoTuningTo");
  });

  it("auto-tune does not switch if the mode is already optimal", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    // deviceMemory > 4 → recomienda polar8, que ya es el modo actual
    Object.defineProperty(navigator, "deviceMemory", {
      value: 8,
      configurable: true,
    });
    render(<QuantizationPanel />);
    const autoTuneBtn = screen.getByText("app_autoTune").closest("button")!;
    await userEvent.click(autoTuneBtn);
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith("app_alreadyOptimal");
    });
    expect(vis.setQuantizationMode).not.toHaveBeenCalled();
  });

  it("disables the mode buttons during the rebuild", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    let resolveRebuild: (v: unknown) => void = () => {};
    vis.rebuild.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRebuild = resolve;
        }),
    );
    render(<QuantizationPanel />);
    const floatBtn = screen.getByText("app_float32").closest("button")!;
    await userEvent.click(floatBtn);
    await waitFor(() => {
      expect(floatBtn.disabled).toBe(true);
    });
    expect(screen.getByText("app_rebuildingIndex")).toBeTruthy();
    resolveRebuild(undefined);
    await waitFor(() => {
      expect(floatBtn.disabled).toBe(false);
    });
  });

  it("ignores a rebuild that resolves after unmount (no toasts)", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    let resolveRebuild: (v: unknown) => void = () => {};
    vis.rebuild.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRebuild = resolve;
        }),
    );
    const { unmount } = render(<QuantizationPanel />);
    const qjlBtn = screen.getByText("app_qjl").closest("button")!;
    await userEvent.click(qjlBtn);
    await waitFor(() => expect(vis.rebuild).toHaveBeenCalled());
    unmount();
    resolveRebuild(undefined);
    await act(async () => {
      await Promise.resolve();
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ignores a save that fails after unmount (no toast)", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    const { toast } = await import("sonner");
    let rejectCommit: (e: Error) => void = () => {};
    vis.commit.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectCommit = reject;
        }),
    );
    const { unmount } = render(<QuantizationPanel />);
    const saveBtn = screen.getByText("app_saveToDisk").closest("button")!;
    await userEvent.click(saveBtn);
    expect(vis.commit).toHaveBeenCalled();
    unmount();
    rejectCommit(new Error("disk full"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ignores stats that resolve after unmount", async () => {
    const mod = await import("../../services/ai/VectorIndexService");
    const vis = mod.vectorIndexService as any;
    let resolveStats: (v: unknown) => void = () => {};
    vis.getStats.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStats = resolve;
        }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<QuantizationPanel />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    unmount();
    resolveStats({ count: 999, mode: "qjl", memoryUsageBytes: 42 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
