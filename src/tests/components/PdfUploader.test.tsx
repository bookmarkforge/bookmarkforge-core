import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { PdfUploader } from "../../components/PdfUploader";

// Mock the Pro loader: the component resolves the extractor through
// pro-access (pdfService is Pro), so the double is installed at the loader.
const mockExtractText = vi.hoisted(() => vi.fn());

vi.mock("../../services/pro-access", () => ({
  loadPdfExtractor: () => Promise.resolve(mockExtractText),
}));

// Mock de sonner
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockToastDismiss = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(() => "toast-id"),
    success: mockToastSuccess,
    error: mockToastError,
    dismiss: mockToastDismiss,
  },
}));

const mockTEmptyKeys = vi.hoisted(() => new Set<string>());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      if (mockTEmptyKeys.has(key)) return "";
      if (key === "app_pdfExtracted") return "";
      return fallback || key;
    },
  }),
}));

function createFile(name: string, size: number, type: string): File {
  const blob = new Blob(["a".repeat(size)], { type });
  return new File([blob], name, { type });
}

describe("PdfUploader", () => {
  const onTextExtracted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders label with text", () => {
    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    expect(screen.getByText("Upload PDF")).toBeDefined();
  });

  it("has a hidden file input", () => {
    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;
    expect(input).toBeDefined();
    expect(input.type).toBe("file");
    expect(input.accept).toBe(".pdf");
    expect(input.className).toContain("hidden");
  });

  it("processes the PDF file correctly", async () => {
    mockExtractText.mockResolvedValue("Text extracted from PDF");

    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;

    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });

    fireEvent.change(input);

    await waitFor(() => {
      // The extraction receives the guard's signal (abort on unmount).
      expect(mockExtractText).toHaveBeenCalledWith(
        file,
        expect.any(AbortSignal),
      );
      expect(onTextExtracted).toHaveBeenCalledWith("Text extracted from PDF");
      expect(mockToastSuccess).toHaveBeenCalled();
    });
  });

  it("handles error in PDF extraction", async () => {
    mockExtractText.mockRejectedValue(new Error("Error al extraer"));

    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;

    const file = createFile("broken.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });

    fireEvent.change(input);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
      expect(onTextExtracted).not.toHaveBeenCalled();
    });
  });

  it("does nothing when there is no file", () => {
    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;

    fireEvent.change(input);

    expect(mockExtractText).not.toHaveBeenCalled();
  });

  it("disables input during upload", async () => {
    mockExtractText.mockImplementation(() => new Promise(() => {})); // never resolves

    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;

    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });

    fireEvent.change(input);

    expect(input.disabled).toBe(true);
  });

  it("shows spinner during upload", async () => {
    mockExtractText.mockImplementation(() => new Promise(() => {}));

    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;

    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });

    fireEvent.change(input);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeDefined();
  });

  it("discards the resolved extraction after unmount", async () => {
    let resolveExtract: (value: string) => void;
    mockExtractText.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveExtract = resolve;
      }),
    );

    const { unmount } = render(
      <PdfUploader onTextExtracted={onTextExtracted} />,
    );
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;
    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    unmount();

    await act(async () => {
      resolveExtract!("Late text");
    });

    expect(onTextExtracted).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("discards the extraction error after unmount", async () => {
    let rejectExtract: (reason: Error) => void;
    mockExtractText.mockReturnValue(
      new Promise<string>((_, reject) => {
        rejectExtract = reject;
      }),
    );

    const { unmount } = render(
      <PdfUploader onTextExtracted={onTextExtracted} />,
    );
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;
    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    unmount();

    await act(async () => {
      rejectExtract!(new Error("late"));
    });

    expect(mockToastError).not.toHaveBeenCalled();
    expect(onTextExtracted).not.toHaveBeenCalled();
  });

  it("closes the progress toast when unmounting during extraction", async () => {
    mockExtractText.mockImplementation(() => new Promise(() => {}));

    const { unmount } = render(
      <PdfUploader onTextExtracted={onTextExtracted} />,
    );
    const input = screen.getByLabelText("app_uploadPdf") as HTMLInputElement;
    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    unmount();

    expect(mockToastDismiss).toHaveBeenCalledWith("toast-id");
  });

  it("uses English fallback texts when translations return empty keys", async () => {
    mockTEmptyKeys.add("app_extractingPdf");
    mockTEmptyKeys.add("app_pdfError");
    mockTEmptyKeys.add("app_uploadPdf");

    mockExtractText.mockRejectedValue(new Error("fail"));
    render(<PdfUploader onTextExtracted={onTextExtracted} />);
    const input = screen.getByLabelText("Upload PDF") as HTMLInputElement;
    const file = createFile("test.pdf", 100, "application/pdf");
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Error extracting text from PDF",
        { id: "toast-id" },
      );
    });

    mockTEmptyKeys.clear();
  });
});
