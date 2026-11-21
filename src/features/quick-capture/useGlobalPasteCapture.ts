/**
 * useGlobalPasteCapture.ts — window-level `paste` listener for quick
 * capture anywhere in the app shell.
 *
 * Rules:
 *  - Ignored while the focus is inside an editable surface (input,
 *    textarea, select, contentEditable) — those pastes belong to the field.
 *  - URL or bare domain        → opens QuickCapture prefilled (bookmark flow).
 *  - Plain text ≥ 100 chars    → opens QuickCapture prefilled (note flow).
 *  - image/* clipboard item    → saved directly as an encrypted document
 *                                attachment (no modal; toast confirms).
 *  - Anything else             → ignored, native paste proceeds untouched.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { logger } from "../../utils/logger";
import {
  classifyPastedText,
  extractClipboardImage,
  isEditableTarget,
  requestQuickCapture,
  type ClipboardImagePayload,
} from "./clipboard";
import { saveClipboardImage } from "./saveClipboardImage";

async function handleImagePaste(
  payload: ClipboardImagePayload,
  t: TFunction,
): Promise<void> {
  try {
    await saveClipboardImage(payload);
    toast.success(t("app_imageSavedToVault", "Image saved to your vault"));
  } catch (error) {
    logger.error("[quick-capture] clipboard image save failed", { error });
    toast.error(
      t("app_imageSaveFailed", "Could not save the pasted image"),
    );
  }
}

export function useGlobalPasteCapture(enabled = true): void {
  const { t } = useTranslation();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const items = event.clipboardData?.items;
      if (items) {
        const image = extractClipboardImage(items);
        if (image) {
          event.preventDefault();
          void handleImagePaste(image, t);
          return;
        }
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const kind = classifyPastedText(text);
      if (kind === "url" || kind === "note") {
        event.preventDefault();
        requestQuickCapture(text.trim());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled, t]);
}
