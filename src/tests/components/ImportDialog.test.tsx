import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const universalImporterMock = vi.hoisted(() => ({
  importData: vi.fn(),
  previewPocketFile: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../services/UniversalImporter", () => ({
  universalImporter: universalImporterMock,
}));

const initDBMock = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("../../db/database", () => ({ initDB: initDBMock }));

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

import ImportDialog from "../../components/ImportDialog";

function createFile(name: string, type: string): File {
  return new File(["test"], name, { type });
}

describe("ImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    universalImporterMock.previewPocketFile.mockResolvedValue(null);
    universalImporterMock.importData.mockResolvedValue({
      success: true,
      importedCount: 0,
      skippedCount: 0,
    });
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ImportDialog isOpen={false} onClose={vi.fn()} />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("shows drop area when ready to import", () => {
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Click to upload file/i)).toBeTruthy();
    expect(screen.getByText(/JSON · CSV · HTML/i)).toBeTruthy();
  });

  it("clicking the area opens the file picker", async () => {
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const fileInput = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    const clickMock = vi.fn();
    fileInput.click = clickMock;
    const dropZone = screen.getByRole("button", {
      name: /Click to upload file/i,
    });
    await userEvent.click(dropZone);
    expect(clickMock).toHaveBeenCalled();
  });

  it("calls universalImporter when selecting a file", async () => {
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => {
      expect(initDBMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(universalImporterMock.importData).toHaveBeenCalled();
    });
    const callArgs = universalImporterMock.importData.mock.calls[0];
    expect(callArgs![1]).toBeInstanceOf(File);
    expect(callArgs![1].name).toBe("test.json");
  });

  it("shows loader during import", async () => {
    let resolvePromise!: (value: any) => void;
    const pendingPromise = new Promise<any>((resolve) => {
      resolvePromise = resolve;
    });
    universalImporterMock.importData.mockReturnValue(pendingPromise);
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    expect(screen.getByText(/Importing data.../i)).toBeTruthy();
    resolvePromise({
      success: true,
      importedCount: 5,
      skippedCount: 0,
      error: undefined,
    });
    await waitFor(() =>
      expect(screen.getByText(/Import Complete/i)).toBeTruthy(),
    );
  });

  it("shows successful result with counts", async () => {
    universalImporterMock.importData.mockResolvedValue({
      success: true,
      importedCount: 10,
      skippedCount: 2,
      error: undefined,
    });
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText(/Import Complete/i)).toBeTruthy();
      expect(screen.getByText("10")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
    });
  });

  it("shows error message when import fails", async () => {
    universalImporterMock.importData.mockResolvedValue({
      success: false,
      importedCount: 0,
      skippedCount: 0,
      error: "Error de prueba",
    });
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByText(/Import Error/i)).toBeTruthy();
      expect(screen.getByText(/Error de prueba/i)).toBeTruthy();
    });
  });

  it('clears the result when clicking "Import another file"', async () => {
    universalImporterMock.importData.mockResolvedValue({
      success: true,
      importedCount: 5,
      skippedCount: 0,
      error: undefined,
    });
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/Import Complete/i)).toBeTruthy(),
    );
    const importAgainBtn = screen.getByText(/Import another file/i);
    await userEvent.click(importAgainBtn);
    expect(screen.queryByText(/Import Complete/i)).toBeNull();
    expect(screen.getByText(/Click to upload file/i)).toBeTruthy();
  });

  it("Enter on the drop area opens the file picker", async () => {
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const fileInput = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    const clickMock = vi.fn();
    fileInput.click = clickMock;
    const dropZone = screen.getByRole("button", {
      name: /Click to upload file/i,
    });
    dropZone.focus();
    await userEvent.keyboard("{Enter}");
    expect(clickMock).toHaveBeenCalled();
  });

  it("Enter on the result button clears the state", async () => {
    universalImporterMock.importData.mockResolvedValue({
      success: true,
      importedCount: 3,
      skippedCount: 1,
      error: undefined,
    });
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => expect(initDBMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/Import Complete/i)).toBeTruthy(),
    );
    const btn = screen.getByText(/Import another file/i) as HTMLElement;
    btn.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(btn);
    expect(screen.queryByText(/Import Complete/i)).toBeNull();
    expect(screen.getByText(/Click to upload file/i)).toBeTruthy();
  });

  it("previews a Pocket export before committing it", async () => {
    universalImporterMock.previewPocketFile.mockResolvedValue({
      source: "pocket",
      filename: "ril_export.html",
      linkCount: 42,
      datedCount: 40,
      uniqueTagCount: 7,
      unreadCount: 12,
      archivedCount: 5,
      sampleTitles: ["A saved idea", "Another link"],
    });
    universalImporterMock.importData.mockResolvedValue({
      success: true,
      importedCount: 42,
      skippedCount: 0,
    });
    const mockFile = new File(["pocket export"], "ril_export.html", {
      type: "text/html",
    });
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);

    await waitFor(() =>
      expect(screen.getByTestId("pocket-import-preview")).toBeTruthy(),
    );
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Here’s what will transfer")).toBeTruthy();
    expect(universalImporterMock.importData).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Import these links/i }));
    await waitFor(() =>
      expect(universalImporterMock.importData).toHaveBeenCalledWith(
        expect.anything(),
        mockFile,
        expect.anything(),
      ),
    );
  });

  it("falls through to direct import for non-Pocket files", async () => {
    universalImporterMock.previewPocketFile.mockResolvedValue(null);
    universalImporterMock.importData.mockResolvedValue({
      success: true,
      importedCount: 1,
      skippedCount: 0,
    });
    const mockFile = createFile("test.json", "application/json");
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [mockFile] });
    fireEvent.change(input);
    await waitFor(() => expect(universalImporterMock.importData).toHaveBeenCalled());
  });

  it("closes the dialog when clicking the overlay", () => {
    const onClose = vi.fn();
    render(<ImportDialog isOpen={true} onClose={onClose} />);

    const overlay = document.querySelector(".ds-modal-overlay")!;
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalled();
  });

  it("closes the dialog when clicking the × button in the header", async () => {
    const onClose = vi.fn();
    render(<ImportDialog isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByText("×");
    await userEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  it("shows the privacy notice in the footer", () => {
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Total Privacy/i)).toBeTruthy();
    expect(screen.getByText(/Processing is 100% local/i)).toBeTruthy();
  });

  it("does not call the importer when no file is selected", () => {
    render(<ImportDialog isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByLabelText(
      /Click to upload file/i,
    ) as HTMLInputElement;

    // Simulate file input change with empty files
    Object.defineProperty(input, "files", { value: [] });
    fireEvent.change(input);

    expect(universalImporterMock.importData).not.toHaveBeenCalled();
    expect(initDBMock).not.toHaveBeenCalled();
  });
});
