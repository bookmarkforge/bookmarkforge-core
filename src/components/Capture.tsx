import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Bookmark, Globe, X, Check, Loader2 } from "lucide-react";
import { initDB } from "../container/database";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { logger } from "../utils/logger";
import { validateAndSanitizeUrl, sanitizeUserInput } from "../services/SanitizationService";
import { safeGet } from "../store/safeStorage";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { isFreeLimitError } from "../services/LicenseService";
import {
  ProUnavailableError,
  announceProUnavailable,
} from "../services/pro-access";
import { FREE_LIMITS } from "../constants/license";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { safeSet } from "../store/safeStorage";
import { FreeTierSaveHint } from "./FreeTierSaveHint";

/**
 * Capture component for quick web clipping.
 * This is designed to be used in a small popup window.
 */
export const Capture: React.FC<{ masterPassword?: string }> = ({
  masterPassword,
}) => {
  const { t } = useTranslation();

  const params = useMemo(() => {
    if (typeof window === "undefined") {return new URLSearchParams();}

    // Merge query string and fragment hash parameters. Fragment hash is used
    // by the browser extension so the page URL and title never reach the server
    // (no CDN logs / browser history / Referer leakage). Fragment values take
    // precedence over query string values.
    const combined = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    hashParams.forEach((value, key) => {
      combined.set(key, value);
    });
    return combined;
  }, []);
  const urlParam = useMemo(
    () =>
      params.get("url") ||
      (params.get("text") && params.get("text")?.startsWith("http")
        ? params.get("text")
        : null),
    [params],
  );
  const titleParam = useMemo(() => params.get("title"), [params]);
  const textParam = useMemo(() => params.get("text"), [params]);

  const [url, setUrl] = useState(urlParam || "");
  const [title, setTitle] = useState(
    titleParam ? sanitizeUserInput(titleParam, 500) : "",
  );
  const [summary, setSummary] = useState(() => {
    const raw = textParam && textParam !== urlParam ? textParam : "";
    return raw ? sanitizeUserInput(raw, 10000) : "";
  });
  const [isSaved, setIsSaved] = useState(false);
  // Prevents the duplicate bookmark: auto-save fires 500 ms after mount
  // and its callback did not see the state — if the user pressed "Save"
  // before the timer expired, the timer saved a second copy. The first
  // save that completes (manual or automatic) sets the ref and the other
  // becomes a no-op.
  const savedRef = useRef(false);

  // Single save flow (manual click or the auto-save timer) — useGuardedAction:
  // the loading flag becomes isRunning and the success side effects (savedRef,
  // toast, popup close timer) live in onSuccess, gated by the guard so a
  // superseded save is a no-op.
  const save = useGuardedAction<void>({
    onSuccess: () => {
      savedRef.current = true;
      setIsSaved(true);
      toast.success(t("savedSuccessfully"));

      // Close window after a short delay if it's a popup or autoClose is
      // requested.
      setTimeout(() => {
        if (
          window.opener ||
          window.history.length === 1 ||
          params.get("autoClose") === "true"
        ) {
          window.close();
        }
      }, 1500);
    },
    onError: (e) => {
      logger.error("[Capture] Error saving bookmark", { error: e });
      if (
        e instanceof Error &&
        (e.name === "QuotaExceededError" || e.message.includes("Quota"))
      ) {
        toast.error(
          t(
            "quotaExceededError",
            "No space left on this device. Free up storage to save.",
          ),
        );
      } else if (isFreeLimitError(e)) {
        // The wall, made visible (see QuickCapture): explains the pause
        // and offers Pro instead of a generic "save failed".
        toast.error(
          t(
            "app_freeLimitToast",
            "Free holds {{limit}} saves — your vault is safe; new saves pause.",
            { limit: FREE_LIMITS.maxBookmarks },
          ),
          {
            id: "free-limit",
            duration: 4000,
            action: {
              label: t("app_freeLimitToastAction"),
              onClick: () =>
                window.dispatchEvent(
                  new CustomEvent("forge:open-settings"),
                ),
            },
          },
        );
        safeSet(STORAGE_KEYS.FREE_TIER_WALL_HIT_PENDING, "1");
        window.dispatchEvent(new CustomEvent("bmf:free-wall-hit"));
      } else if (e instanceof ProUnavailableError) {
        // A Pro surface was reached without access: open the shared
        // "Available in Pro" panel instead of the generic save-failed toast.
        announceProUnavailable(e);
      } else {
        toast.error(t("saveError"));
      }
    },
  });
  const isLoading = save.isRunning;

  const handleSave = useCallback(
    async (overrideUrl?: string | React.MouseEvent, overrideTitle?: string) => {
      const finalUrl = typeof overrideUrl === "string" ? overrideUrl : url;
      const finalTitle =
        typeof overrideTitle === "string" ? overrideTitle : title;

      if (!finalUrl) {
        return;
      }
      // URL validation is synchronous and pre-guard: reject before any work.
      let sanitized: string;
      try {
        sanitized = validateAndSanitizeUrl(finalUrl);
      } catch (_err) {
        toast.error(t("invalidUrl", "Invalid or disallowed URL"));
        return;
      }
      await save.runWithSignal(async (signal) => {
        const db = await initDB(masterPassword);
        // Unmount (or a newer save) aborts the guard's signal: stop before
        // the insert so a discarded capture never writes its bookmark.
        if (signal.aborted) {
          throw new DOMException("Capture aborted", "AbortError");
        }
        await db.bookmarks.insert({
          id: generateId(),
          url: sanitized,
          urlHash: await hashString(sanitized),
          // The auto-save path passes the fragment title raw; sanitize it
          // here so both paths apply the same boundary as the useState
          // initializer (untrusted input from the URL fragment).
          title: sanitizeUserInput(finalTitle || sanitized, 500),
          summary: summary || "",
          content: `Clipped from: ${sanitized}`,
          tags: ["clipped"],
          relatedLinks: [],
          visitCount: 0,
          processed: false,
          isPrivate: safeGet("default_private") === "true",
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      });
    },
    [url, title, summary, masterPassword, t, params, save.run],
  );

  useEffect(() => {
    if (urlParam && params.get("noAutoSave") !== "true") {
      const autoSaveTimer = setTimeout(() => {
        // A save that already completed (fast manual click) disarms the
        // auto-save repetition.
        if (savedRef.current) {return;}
        handleSave(urlParam, titleParam || urlParam);
      }, 500);
      return () => clearTimeout(autoSaveTimer);
    }
    return;
  }, [params, urlParam, titleParam, handleSave]);

  if (isSaved) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-primary)] text-white p-6 text-center space-y-4">
        <div className="size-16 ds-bg-success/20 rounded-full flex items-center justify-center">
          <Check className="size-8 ds-text-success" />
        </div>
        <h2 className="text-xl font-semibold">{t("savedTitle")}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t("savedDesc")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-white p-6 flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Bookmark className="size-5 text-cyan-500" />
          <h1 className="text-lg font-semibold tracking-tight">
            {t("quickCapture")}
          </h1>
        </div>
        <button
          onClick={() => window.close()}
          className="p-1 ds-ghost-bg rounded-md"
          aria-label={t("app_close")}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 flex-1">
        <div>
          <span className="block text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
            {t("app_url", "URL")}
          </span>
          <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-primary)] rounded-lg border border-[var(--divider)]">
            <Globe className="size-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              aria-label={t("app_url", "URL")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-transparent border-none text-sm w-full focus:ring-0"
              placeholder={t("urlPlaceholder")}
            />
          </div>
        </div>

        <div>
          <span className="block text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
            {t("titleLabel")}
          </span>
          <input
            type="text"
            aria-label={t("titleLabel")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] rounded-lg border border-[var(--divider)] text-sm focus:ring-2 focus:ring-cyan-500 border-none"
            placeholder={t("titlePlaceholder")}
          />
        </div>

        <div>
          <span className="block text-[10px] font-bold text-[var(--text-muted)] uppercase mb-1">
            {t("notesLabel")}
          </span>
          <textarea
            aria-label={t("notesLabel")}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full px-3 py-2 bg-[var(--bg-primary)] rounded-lg border border-[var(--divider)] text-sm focus:ring-2 focus:ring-cyan-500 border-none h-24 resize-none"
            placeholder={t("notesPlaceholder")}
          />
        </div>
      </div>

      <FreeTierSaveHint />
      <button
        onClick={handleSave}
        disabled={!url || isLoading}
        className="truncate w-full py-3 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 mt-6"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Bookmark className="size-4" />
        )}
        {t("saveToForge")}
      </button>
    </div>
  );
};
