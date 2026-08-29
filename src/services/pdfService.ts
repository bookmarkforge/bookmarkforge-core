/**
 * Extracts text content from a PDF file.
 *
 * @param file The PDF file to extract text from.
 * @returns A promise resolving to the extracted text content.
 */
// Bundle the pdf.js worker alongside the app using Vite's ?url import
const pdfjsWorkerUrl = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

const MAX_PDF_BYTES = 50 * 1024 * 1024;
// A tiny file can still contain thousands of pages; bound the extraction so a
// pathological PDF cannot blow up the renderer's memory (the extracted text
// feeds embeddings/summaries on this device).
const MAX_PDF_PAGES = 500;
const MAX_EXTRACTED_CHARS = 2_000_000;

export const extractTextFromPdf = async (
  file: File,
  signal?: AbortSignal,
): Promise<string> => {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      `PDF file too large; maximum supported size is ${MAX_PDF_BYTES / 1024 / 1024} MB`,
    );
  }
  signal?.throwIfAborted();

  const pdfjsLib = await import("pdfjs-dist");

  // Use locally-bundled worker (no CDN dependency, no SRI risk)
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

  const arrayBuffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  // Let the caller interrupt the load itself: destroy() rejects the in-flight
  // loadingTask.promise, so an unmount mid-load stops the pdf.js worker
  // instead of running to completion in the background.
  let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
  const onAbort = () => {
    try {
      loadingTask?.destroy();
    } catch {
      // destroy during extraction is best-effort; the throwIfAborted checks
      // below are the authoritative stop points.
    }
  };
  if (signal) {
    if (signal.aborted) {signal.throwIfAborted();}
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    signal?.throwIfAborted();
    const pagesToRead = Math.min(pdf.numPages, MAX_PDF_PAGES);
    let text = "";
    for (let i = 1; i <= pagesToRead; i++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(i);
      signal?.throwIfAborted();
      const content = await page.getTextContent();
      const pageText =
        (content.items as Array<{ str?: string }>)
          .map((item) => item.str || "")
          .join(" ") + "\n";
      if (text.length + pageText.length > MAX_EXTRACTED_CHARS) {
        // Bound the final string; truncating at a page boundary is safer
        // than mid-token and keeps the memory ceiling predictable.
        return text;
      }
      text += pageText;
    }
    return text;
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    // Release the pdf.js document + worker so repeated PDF imports do not
    // accumulate memory across the session. destroy() lives on the loading
    // task (PDFDocumentProxy exposes cleanup(), which keeps the worker alive).
    try {
      await loadingTask?.destroy();
    } catch {
      // Destruction is best-effort cleanup; never mask the extraction result.
    }
  }
};
