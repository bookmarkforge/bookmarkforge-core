import React, { useRef, useEffect } from "react";
import { loadPdfExtractor } from "../services/pro-access";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { logger } from "../utils/logger";
import { useGuardedAction } from "../hooks/useGuardedAction";

export const PdfUploader = ({
  onTextExtracted,
}: {
  onTextExtracted: (text: string) => void;
}) => {
  const { t } = useTranslation();
  const toastIdRef = useRef<string | number | undefined>(undefined);
  // onStart creates the toast.loading and returns its id; the helper passes it to
  // onSuccess/onError to replace it with { id }, and the component ref
  // keeps it for the dismiss on unmount.
  const { runWithSignal: runExtract, isRunning: loading } =
    useGuardedAction<string>({
      blockReentry: false,
      onStart: () => {
        const id = toast.loading(
          t("app_extractingPdf") || "Extracting text from PDF...",
        );
        toastIdRef.current = id;
        return id;
      },
      onSuccess: (text, toastId) => {
        onTextExtracted(text);
        toast.success(
          t("app_pdfExtracted") || "PDF text extracted successfully",
          { id: toastId },
        );
        toastIdRef.current = undefined;
      },
      onError: (error, toastId) => {
        logger.error(error);
        toast.error(t("app_pdfError") || "Error extracting text from PDF", {
          id: toastId,
        });
        toastIdRef.current = undefined;
      },
    });

  // If the uploader unmounts mid-extraction, dismiss the progress toast so it
  // does not stay pinned in the toast stack for a component that is gone.
  useEffect(() => {
    return () => {
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
      }
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    // pdfService is Pro: resolved behind the hasProAccess gate. The guard's
    // signal still reaches the extraction: an unmount aborts the pdf.js
    // worker work between pages instead of continuing in the background.
    void runExtract(async (signal) => (await loadPdfExtractor())(file, signal));
  };

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="pdf-upload-input"
        className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg cursor-pointer hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors"
      >
        <FileUp className="size-4" />
        <span className="text-sm font-medium">
          {loading
            ? t("app_processing", "Processing...")
            : t("app_uploadPdf", "Upload PDF")}
        </span>
        <input
          id="pdf-upload-input"
          type="file"
          accept=".pdf"
          className="hidden"
          aria-label={t("app_uploadPdf") || "Upload PDF"}
          onChange={handleFileChange}
          disabled={loading}
        />
      </label>
      {loading && <Loader2 className="size-4 animate-spin text-blue-500" />}
    </div>
  );
};
