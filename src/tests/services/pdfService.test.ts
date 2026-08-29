import { describe, it, expect, vi, beforeEach } from "vitest";

describe("extractTextFromPdf", () => {
  let extractTextFromPdf: (file: File, signal?: AbortSignal) => Promise<string>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../../services/pdfService");
    extractTextFromPdf = mod.extractTextFromPdf;
  });

  it("rejects if pdfjs-dist fails to load", async () => {
    vi.doMock("pdfjs-dist", () => {
      throw new Error("Failed to load pdfjs-dist");
    });
    const mod = await import("../../services/pdfService");
    await expect(
      mod.extractTextFromPdf(new File([""], "test.pdf")),
    ).rejects.toThrow();
  });

  it("rejects if the file is not a valid PDF", async () => {
    const badFile = new File(["not a pdf"], "test.pdf", {
      type: "application/pdf",
    });
    await expect(extractTextFromPdf(badFile)).rejects.toThrow();
  });

  it("rejects with an empty file", async () => {
    const emptyFile = new File([], "empty.pdf", { type: "application/pdf" });
    await expect(extractTextFromPdf(emptyFile)).rejects.toThrow();
  });

  it("rejects PDFs that exceed the size limit before loading them", async () => {
    const oversizedFile = new File(["pdf"], "large.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(oversizedFile, "size", {
      value: 50 * 1024 * 1024 + 1,
    });

    await expect(extractTextFromPdf(oversizedFile)).rejects.toThrow(
      /maximum supported size is 50 MB/i,
    );
  });

  it("works without relying on an external CDN (local worker)", async () => {
    const file = new File(["%PDF-1.4 fake"], "test.pdf", {
      type: "application/pdf",
    });
    const promise = extractTextFromPdf(file);
    await expect(promise).rejects.toThrow();
  });

  it("extracts text from a valid PDF with a configured local worker", async () => {
    const workerSrcSetter = vi.fn();
    const getTextContent = vi.fn().mockResolvedValue({
      items: [{ str: "Hola" }, { str: "mundo" }, { str: undefined }],
    });
    const getPage = vi.fn().mockResolvedValue({ getTextContent });
    const getDocument = vi.fn().mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    });
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { set workerSrc(v: string) { workerSrcSetter(v); } },
      getDocument,
    }));

    const mod = await import("../../services/pdfService");
    const file = new File(["%PDF-1.4 valid"], "test.pdf", {
      type: "application/pdf",
    });

    const text = await mod.extractTextFromPdf(file);

    expect(workerSrcSetter).toHaveBeenCalled();
    expect(workerSrcSetter.mock.calls[0]![0]).toContain("pdf.worker");
    expect(getDocument).toHaveBeenCalledWith({
      data: expect.any(ArrayBuffer),
    });
    expect(getPage).toHaveBeenCalledTimes(2);
    expect(getPage).toHaveBeenCalledWith(1);
    expect(getPage).toHaveBeenCalledWith(2);
    expect(getTextContent).toHaveBeenCalledTimes(2);
    expect(text).toBe("Hola mundo \nHola mundo \n");
  });

  it("rejects immediately with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File(["%PDF-1.4 aborted"], "aborted.pdf", {
      type: "application/pdf",
    });
    await expect(extractTextFromPdf(file, controller.signal)).rejects.toThrow(
      /aborted/i,
    );
  });

  it("destroys the loading task if the signal aborts during load", async () => {
    const destroy = vi.fn();
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: vi.fn().mockReturnValue({
        promise: new Promise(() => {}),
        destroy,
      }),
    }));
    const mod = await import("../../services/pdfService");
    const controller = new AbortController();
    const file = new File(["%PDF-1.4 mid-load"], "mid.pdf", {
      type: "application/pdf",
    });
    const extraction = mod.extractTextFromPdf(file, controller.signal);
    // Let the microtasks run until getDocument is invoked.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(destroy).toHaveBeenCalled();
    // Without a signal no listener is registered and nothing is destroyed.
  });

  it("does not register an abort listener when no signal is passed", async () => {
    const destroy = vi.fn();
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: vi.fn().mockReturnValue({
        promise: new Promise(() => {}),
        destroy,
      }),
    }));
    const mod = await import("../../services/pdfService");
    const file = new File(["%PDF-1.4 no-signal"], "nosig.pdf", {
      type: "application/pdf",
    });
    const extraction = mod.extractTextFromPdf(file);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(destroy).not.toHaveBeenCalled();
  });

  it("ignores items without text and handles a page without content", async () => {
    const getTextContent = vi.fn().mockResolvedValue({ items: [] });
    const getPage = vi.fn().mockResolvedValue({ getTextContent });
    const getDocument = vi.fn().mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
    });
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument,
    }));

    const mod = await import("../../services/pdfService");
    const file = new File(["%PDF-1.4 empty"], "empty.pdf", {
      type: "application/pdf",
    });

    const text = await mod.extractTextFromPdf(file);

    expect(text).toBe("\n");
    expect(getPage).toHaveBeenCalledTimes(1);
  });
});
