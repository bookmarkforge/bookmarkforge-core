/**
 * useWatchedFolderScan.ts — opportunistic watched-folder sync.
 *
 * No passive file-watching exists without an extension, so the service
 * scans when the shell mounts and whenever the window regains focus
 * (debounced). Runs silently unless files were actually imported.
 */
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { watchedFolderService } from "./watchedFolder";

const FOCUS_DEBOUNCE_MS = 30_000;

export function useWatchedFolderScan(enabled = true): void {
  const { t } = useTranslation();
  const lastScanRef = useRef(0);
  const scanningRef = useRef(false);

  useEffect(() => {
    if (!enabled || !watchedFolderService.isSupported()) {
      return;
    }

    const scan = async () => {
      if (scanningRef.current) {
        return;
      }
      scanningRef.current = true;
      try {
        const info = await watchedFolderService.getInfo();
        if (!info.configured) {
          return;
        }
        const result = await watchedFolderService.scan();
        if (result.imported > 0) {
          toast.success(
            t("app_watchedFolderImported", "Imported {{count}} file(s)", {
              count: result.imported,
            }),
          );
        }
      } catch {
        // Silent by design: background sync must never spam the user.
      } finally {
        scanningRef.current = false;
        lastScanRef.current = Date.now();
      }
    };

    void scan();

    const onFocus = () => {
      if (Date.now() - lastScanRef.current < FOCUS_DEBOUNCE_MS) {
        return;
      }
      void scan();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // Mount-once by design: the scan loop owns its own debounce/refs.
  }, [enabled]);
}
