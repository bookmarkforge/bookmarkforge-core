import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const universalExporterMock = vi.hoisted(() => ({ exportData: vi.fn() }));
vi.mock("../../services/UniversalExporter", () => ({
  universalExporter: universalExporterMock,
}));

const initDBMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("../../db/database", () => ({ initDB: initDBMock }));

const downloadBlobMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/download", () => ({ downloadBlob: downloadBlobMock }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => {
      if (opts && typeof opts === "object" && opts.defaultValue !== undefined)
        return opts.defaultValue;
      if (typeof opts === "string") return opts;
      return key;
    },
  }),
}));

import ExportDialog from "../../components/ExportDialog";

describe("ExportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ExportDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
    // Trasplantado de la copia src/tests/security/ExportDialog.test.tsx:
    // no button must render in the closed state.
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("shows the dialog with export options when isOpen is true", () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("JSON")).toBeTruthy();
    expect(screen.getByText("CSV")).toBeTruthy();
    expect(screen.getByText("Markdown")).toBeTruthy();
    expect(screen.getByText("HTML")).toBeTruthy();
    expect(screen.getByText("Notion")).toBeTruthy();
    expect(screen.getByText("Obsidian")).toBeTruthy();
  });

  it("export button calls initDB and exportData", async () => {
    const blob = new Blob(["test"], { type: "application/json" });
    universalExporterMock.exportData.mockResolvedValue({
      success: true,
      blob,
      filename: "export.json",
    });

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const exportBtn = screen.getByText("app_export");
    await userEvent.click(exportBtn);

    await waitFor(() => {
      expect(initDBMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(universalExporterMock.exportData).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  it("does not download the result of a cancelled export on close", async () => {
    let resolveExport!: (value: any) => void;
    const pendingExport = new Promise<any>((resolve) => {
      resolveExport = resolve;
    });
    universalExporterMock.exportData.mockReturnValue(pendingExport);

    const onClose = vi.fn();
    const { unmount } = render(
      <ExportDialog isOpen={true} onClose={onClose} />,
    );
    await userEvent.click(screen.getByText("app_export"));
    await waitFor(() => expect(universalExporterMock.exportData).toHaveBeenCalled());

    unmount();
    await act(async () => {
      resolveExport({ success: true, blob: new Blob(), filename: "stale.json" });
    });

    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it("shows progress during export", async () => {
    let resolveExport!: (value: any) => void;
    const pendingExport = new Promise<any>((resolve) => {
      resolveExport = resolve;
    });
    universalExporterMock.exportData.mockReturnValue(pendingExport);

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const exportBtn = screen.getByText("app_export");
    await userEvent.click(exportBtn);

    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();

    await act(async () => {
      resolveExport({ success: true, blob: new Blob(), filename: "export.json" });
    });
  });

  it("propagates an abortable signal to the export", async () => {
    universalExporterMock.exportData.mockResolvedValue({
      success: true,
      blob: new Blob(),
      filename: "export.json",
    });

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("app_export"));

    await waitFor(() => {
      expect(universalExporterMock.exportData).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("shows successful result after exporting", async () => {
    const blob = new Blob(["test"], { type: "application/json" });
    universalExporterMock.exportData.mockResolvedValue({
      success: true,
      blob,
      filename: "export.json",
    });

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const exportBtn = screen.getByText("app_export");
    await userEvent.click(exportBtn);

    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText("app_exportSuccess")).toBeTruthy();
    });
  });

  it("shows error message when export fails", async () => {
    universalExporterMock.exportData.mockResolvedValue({
      success: false,
      blob: null,
      filename: "",
      error: "Export error",
    });

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const exportBtn = screen.getByText("app_export");
    await userEvent.click(exportBtn);

    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText("app_exportError")).toBeTruthy();
    });
  });

  it("changes format when clicking an option", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const csvBtn = screen.getByText("CSV");
    await userEvent.click(csvBtn);

    const parentBtn = csvBtn.closest("button");
    expect(parentBtn?.className).toContain("border-blue-500");
  });

  it("export button is disabled during export", async () => {
    let resolveExport!: (value: any) => void;
    const pendingExport = new Promise<any>((resolve) => {
      resolveExport = resolve;
    });
    universalExporterMock.exportData.mockReturnValue(pendingExport);

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const exportBtn = screen.getByText("app_export");
    await userEvent.click(exportBtn);

    await waitFor(() => {
      expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
    });

    await act(async () => {
      resolveExport({ success: true, blob: new Blob(), filename: "export.json" });
    });
  });

  it("closes the dialog when clicking the × button in the header", async () => {
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByText("×");
    await userEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("export button shows exporting text during export", async () => {
    let resolveExport!: (value: any) => void;
    const pendingExport = new Promise<any>((resolve) => {
      resolveExport = resolve;
    });
    universalExporterMock.exportData.mockReturnValue(pendingExport);

    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);
    const exportBtn = screen.getByText("app_export");
    await userEvent.click(exportBtn);

    await waitFor(() => {
      expect(screen.getAllByText("app_exporting").length).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      resolveExport({ success: true, blob: new Blob(), filename: "export.json" });
    });
  });

  it("closes the dialog when clicking the overlay", async () => {
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);

    const overlay = document.querySelector(".ds-modal-overlay")!;
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes the dialog when clicking the Cancel button", async () => {
    const onClose = vi.fn();
    render(<ExportDialog isOpen={true} onClose={onClose} />);

    const cancelBtn = screen.getByText("app_cancel");
    await userEvent.click(cancelBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("updates dateRange when selecting the start date", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const startInput = screen.getByLabelText("Start date") as HTMLInputElement;
    fireEvent.change(startInput, { target: { value: "2025-01-15" } });

    expect(startInput.value).toBe("2025-01-15");
  });

  it("updates dateRange when selecting the end date", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const endInput = screen.getByLabelText("End date") as HTMLInputElement;
    fireEvent.change(endInput, { target: { value: "2025-06-30" } });

    expect(endInput.value).toBe("2025-06-30");
  });

  it("updates tags when typing in the filter", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const tagsInput = screen.getByLabelText("Filter by tags") as HTMLInputElement;
    expect(tagsInput).toBeTruthy();
    await userEvent.type(tagsInput, "dev");

    expect(tagsInput.value).toBe("dev");
  });

  it("updates searchQuery when typing in the search filter", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const searchInput = screen.getByLabelText("Search query") as HTMLInputElement;
    await userEvent.type(searchInput, "typescript");

    expect(searchInput.value).toBe("typescript");
  });

  it("toggles includeEmbeddings when checking the checkbox", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const checkbox = screen.getByLabelText("app_exportIncludeEmbeddings") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("toggles includeFolders when checking the checkbox", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    const checkbox = screen.getByLabelText("app_exportIncludeFolders") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("renders the advanced options with the Settings icon", async () => {
    render(<ExportDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText("app_exportAdvanced")).toBeTruthy();
    expect(screen.getByText("app_exportDateRange")).toBeTruthy();
    expect(screen.getByText("app_exportTags")).toBeTruthy();
    expect(screen.getByText("app_exportSearch")).toBeTruthy();
  });
});
