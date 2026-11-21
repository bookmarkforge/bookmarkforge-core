/**
 * readClipboard.ts — "Paste from clipboard" button flow.
 *
 * navigator.clipboard.read() requires a user gesture + permission; on
 * denial or unsupported browsers we fall back to readText() and finally
 * to a no-op so the button never throws into the UI.
 */
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { logger } from "../../utils/logger";
import {
  classifyPastedText,
  requestQuickCapture,
} from "./clipboard";
import { saveClipboardImage } from "./saveClipboardImage";

export type ClipboardReadResult =
  | "image"
  | "capture"
  | "empty"
  | "unsupported"
  | "denied";

export async function readClipboardAndCapture(
  t: TFunction,
): Promise<ClipboardReadResult> {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    toast.error(
      t("app_clipboardUnsupported", "Clipboard access is not available here"),
    );
    return "unsupported";
  }

  try {
    if (typeof navigator.clipboard.read === "function") {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (!type.startsWith("image/")) {
            continue;
          }
          const blob = await item.getType(type);
          const ext = type.split("/")[1]?.split("+")[0] || "png";
          await saveClipboardImage({
            blob,
            filename: `pasted-image.${ext}`,
          });
          toast.success(
            t("app_imageSavedToVault", "Image saved to your vault"),
          );
          return "image";
        }
      }
      const text = items.some((i) => i.types.includes("text/plain"))
        ? await navigator.clipboard.readText()
        : "";
      return dispatchText(text, t);
    }
    const text = await navigator.clipboard.readText();
    return dispatchText(text, t);
  } catch (error) {
    logger.warn("[quick-capture] clipboard read failed", { error });
    toast.error(
      t("app_clipboardDenied", "Clipboard access was denied by the browser"),
    );
    return "denied";
  }
}

function dispatchText(
  text: string,
  t: TFunction,
): ClipboardReadResult {
  const kind = classifyPastedText(text);
  if (kind === "url" || kind === "note") {
    requestQuickCapture(text.trim());
    return "capture";
  }
  toast(t("app_clipboardNothingToSave", "Nothing to save from clipboard"));
  return "empty";
}

export function useClipboardCaptureAction(): () => void {
  const { t } = useTranslation();
  return () => {
    void readClipboardAndCapture(t);
  };
}
