import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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
    Database: mock("Database"),
    Trash2: mock("Trash2"),
    RefreshCw: mock("RefreshCw"),
    Loader2: mock("Loader2"),
    HardDrive: mock("HardDrive"),
  };
});

const mockGetHFModelStatus = vi.fn().mockResolvedValue([]);
const mockDeleteHFModel = vi.fn().mockResolvedValue(true);
vi.mock("../../../services/ai/ResourceManager", () => ({
  resourceManager: {
    getHFModelStatus: mockGetHFModelStatus,
    deleteHFModel: mockDeleteHFModel,
  },
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

const mockConfirm = vi.fn(() => true);
vi.stubGlobal("confirm", mockConfirm);

describe("ModelManagerSection", () => {
  let ModelManagerSection: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetHFModelStatus.mockResolvedValue([]);
    mockDeleteHFModel.mockResolvedValue(true);
    // clearAllMocks no resetea implementaciones: restaurar el confirm por
    // default so the cancel test does not leak its mockReturnValue(false)
    // to later tests (fragile order dependency found in review).
    mockConfirm.mockReturnValue(true);
    const mod =
      await import("../../../components/settings/ModelManagerSection");
    ModelManagerSection = mod.ModelManagerSection;
  });

  it("renders title", async () => {
    mockGetHFModelStatus.mockResolvedValue([]);
    render(<ModelManagerSection />);
    expect(await screen.findByText("app_localAiModels")).toBeTruthy();
  });

  it("shows empty state when there are no models", async () => {
    mockGetHFModelStatus.mockResolvedValue([]);
    render(<ModelManagerSection />);
    expect(await screen.findByText("app_noLocalModels")).toBeTruthy();
  });

  it("shows models when there are any", async () => {
    mockGetHFModelStatus.mockResolvedValue([
      { name: "llama-3.2", size: 1073741824, count: 5 },
    ]);
    render(<ModelManagerSection />);
    expect(await screen.findByText("llama-3.2")).toBeTruthy();
  });

  it("calls deleteHFModel when clicking trash", async () => {
    mockGetHFModelStatus.mockResolvedValue([
      { name: "test-model", size: 1024, count: 2 },
    ]);
    render(<ModelManagerSection />);
    const trash = await screen.findByTestId("icon-Trash2");
    await userEvent.click(trash);
    expect(mockDeleteHFModel).toHaveBeenCalledWith("test-model");
  });

  // ── Fusionado de src/tests/security/ModelManagerSection.test.tsx ──

  it("shows success toast when deleting a model", async () => {
    mockGetHFModelStatus
      .mockResolvedValueOnce([{ name: "llama", size: 1024, count: 3 }])
      .mockResolvedValueOnce([]);
    mockDeleteHFModel.mockResolvedValue(true);
    render(<ModelManagerSection />);
    await screen.findByText("llama");
    const trash = await screen.findByTestId("icon-Trash2");
    await userEvent.click(trash);
    await waitFor(() => expect(mockDeleteHFModel).toHaveBeenCalledWith("llama"));
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("shows error toast when deletion fails", async () => {
    mockGetHFModelStatus.mockResolvedValue([
      { name: "llama", size: 1024, count: 3 },
    ]);
    mockDeleteHFModel.mockResolvedValue(false);
    render(<ModelManagerSection />);
    await screen.findByText("llama");
    const trash = await screen.findByTestId("icon-Trash2");
    await userEvent.click(trash);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it("does not delete when the confirmation is cancelled", async () => {
    mockConfirm.mockReturnValue(false);
    mockGetHFModelStatus.mockResolvedValue([
      { name: "llama", size: 1024, count: 3 },
    ]);
    render(<ModelManagerSection />);
    await screen.findByText("llama");
    const trash = await screen.findByTestId("icon-Trash2");
    await userEvent.click(trash);
    expect(mockDeleteHFModel).not.toHaveBeenCalled();
  });

  it("ignores a deletion that resolves after unmount (no toasts)", async () => {
    mockGetHFModelStatus.mockResolvedValue([
      { name: "llama", size: 1024, count: 3 },
    ]);
    let resolveDelete: (v: boolean) => void = () => {};
    mockDeleteHFModel.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const { unmount } = render(<ModelManagerSection />);
    await screen.findByText("llama");
    const trash = await screen.findByTestId("icon-Trash2");
    await userEvent.click(trash);
    await waitFor(() => expect(mockDeleteHFModel).toHaveBeenCalled());
    unmount();
    resolveDelete(true);
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("ignores a loadStatus that resolves after unmount", async () => {
    let resolveStatus: (v: unknown) => void = () => {};
    mockGetHFModelStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<ModelManagerSection />);
    // Let the mount effect start loadStatus and leave it pending.
    // wrapped in act: the action's start updates the isRunning state.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    unmount();
    resolveStatus([{ name: "late", size: 1, count: 1 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
