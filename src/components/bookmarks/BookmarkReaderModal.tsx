import React, { useState, useEffect, useRef, useId, useCallback } from "react";
import { TFunction } from "i18next";
import {
  X,
  Download,
  Sparkles,
  Calendar,
  Loader2,
  Type,
  Maximize2,
  Minimize2,
  Moon,
  Sun,
  Coffee,
  AlignLeft,
  AlignJustify,
  Timer,
  Trash2,
  MessageSquare,
} from "lucide-react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { Bookmark } from "../../types";
import { motion, AnimatePresence } from "motion/react";
import i18n from "../../i18n";
import { formatDate } from "../../utils/localization";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  highlightService,
  HighlightData,
} from "../../services/HighlightService";
import { SanitizationService } from "../../services/SanitizationService";
import { MoodAdaptiveReader } from "./MoodAdaptiveReader";
import { AIReadingPartner } from "./AIReadingPartner";
import { DevilAdvocateReader } from "./DevilAdvocateReader";
import { useGuardedActions } from "../../hooks/useGuardedActions";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { generateWithPrivacy } from "../../services/ai/privacy";

interface BookmarkReaderModalProps {
  viewingContent: Bookmark;
  setViewingContent: (content: Bookmark | null) => void;
  handleExportPDF: () => void;
  handleExportMarkdown: () => void;
  handleCleanContent: (bookmark: Bookmark) => void;
  handleFetchContent: (bookmark: Bookmark) => void;
  isCleaningContent: string | null;
  isFetchingContent: string | null;
  t: TFunction;
}

type ReaderTheme = "light" | "dark" | "sepia";

type ReaderMode = "off" | "mood" | "partner" | "devil";

// Hoisted to module scope: constant across renders, avoids per-render
// allocation, and is referenced from the keydown handler closure.
const THEME_ORDER: readonly ReaderTheme[] = ["light", "dark", "sepia"];
const READER_MODE_ORDER: readonly ReaderMode[] = [
  "off",
  "mood",
  "partner",
  "devil",
];
const READER_MODE_LABELS: Record<ReaderMode, string> = {
  off: "app_readerModeOff",
  mood: "app_readerModeMood",
  partner: "app_readerModePartner",
  devil: "app_readerModeDevil",
};
const RADIO_NAV_KEYS: ReadonlySet<KeyboardEvent["key"]> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export const BookmarkReaderModal = ({
    viewingContent,
    setViewingContent,
    handleExportPDF,
    handleExportMarkdown,
    handleCleanContent,
    handleFetchContent,
    isCleaningContent,
    isFetchingContent,
    t,
  }: BookmarkReaderModalProps) => {
    const [fontSize, setFontSize] = useState<number>(18);
    const [theme, setTheme] = useState<ReaderTheme>("dark");
    const [isFocusMode, setIsFocusMode] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [lineHeight, setLineHeight] = useState<number>(1.7);
    const [readerMode, setReaderMode] = useState<ReaderMode>("off");
    // Visit tracking is a fire-and-forget best-effort patch — the guard only
    // drops stale results when the reader switches content or unmounts, so it
    // maps to useGuardedDataLoad (no loading UI is shown for a visit).
    const { load: trackVisit } = useGuardedDataLoad<void>(
      async () => {
        const db = await (await import("../../container/database")).initDB();
        const doc = await db.bookmarks.findOne(viewingContent.id).exec();
        if (doc) {
          await doc.incrementalPatch({
            visitCount: (doc.get("visitCount") || 0) + 1,
            lastVisitedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      },
      {
        autoLoad: false,
        initialLoading: false,
        // Tracking is best-effort: never surface a failure to the reader.
        onError: () => {},
      },
    );
    const [copilotResult, setCopilotResult] = useState<string>("");

    // Key Points / Related share ONE guard on purpose: a newer copilot call
    // supersedes the previous one (only the last result is shown) and the
    // content-switch effect cancels any in-flight generation. Both calls pass
    // the AbortSignal — useGuardedActions' runWithSignal variant. Reentry is
    // allowed so a second click supersedes (begin()-per-call semantics).
    const copilot = useGuardedActions<{
      keyPoints: { text: string };
      related: { text: string };
    }>({
      keyPoints: {
        blockReentry: false,
        onStart: () => setCopilotResult(""),
        onSuccess: (result) =>
          setCopilotResult(result.text || "No summary available."),
        onError: () => setCopilotResult("Failed to generate key points."),
      },
      related: {
        blockReentry: false,
        onStart: () => setCopilotResult(""),
        onSuccess: (result) =>
          setCopilotResult(result.text || "No related content found."),
        onError: () => setCopilotResult("Failed to find related content."),
      },
    });
    const isCopilotLoading =
      copilot.keyPoints.isRunning || copilot.related.isRunning;

    // Highlights: the load lives in useGuardedDataLoad (autoLoad on mount,
    // reload on content switch via the effect below). add/remove run on a
    // separate guard BUT each handler first cancels the load, preserving the
    // original shared-guard property: an add/remove supersedes a still
    // in-flight load, so a stale list never overwrites the fresh one. There
    // is no loading UI to wire.
    const {
      load: loadHighlights,
      cancel: cancelHighlightsLoad,
    } = useGuardedDataLoad<HighlightData[]>(
      async () => highlightService.getHighlights(viewingContent.id),
      {
        onSuccess: (loaded) => {
          setHighlights((previous) =>
            loaded.length === 0 && previous.length === 0 ? previous : loaded,
          );
        },
        // Highlight loading is best-effort (no onError → silent).
      },
    );
    const highlightActions = useGuardedActions<{
      add: HighlightData[];
      remove: HighlightData[];
    }>({
      add: {
        onSuccess: (updated) => {
          setHighlights(updated);
          setShowHighlightToolbar(false);
          window.getSelection()?.removeAllRanges();
        },
      },
      remove: {
        onSuccess: (updated) => {
          setHighlights(updated);
        },
      },
    });

    useEffect(() => {
      void loadHighlights();
    }, [loadHighlights, viewingContent.id]);

    useEffect(() => {
      void trackVisit();
    }, [trackVisit, viewingContent.id]);

    useEffect(() => {
      copilot.cancel();
      setCopilotResult("");
    }, [copilot.cancel, viewingContent.id]);
    const [contentWidth, setContentWidth] = useState<number>(100);
    const [fontFamily, _setFontFamily] = useState<
      "serif" | "sans-serif" | "monospace"
    >("sans-serif");
    const [progress, setProgress] = useState<number>(0);
    const [showAICopilot, setShowAICopilot] = useState(false);
    const [highlights, setHighlights] = useState<HighlightData[]>([]);
    const [showHighlightToolbar, setShowHighlightToolbar] = useState(false);
    const [highlightToolbarPos, setHighlightToolbarPos] = useState({
      x: 0,
      y: 0,
    });
    const [selectedText, setSelectedText] = useState("");
    const [highlightColors] = useState([
      { name: "yellow", value: "#fef08a" },
      { name: "green", value: "#bbf7d0" },
      { name: "blue", value: "#bfdbfe" },
      { name: "pink", value: "#fbcfe8" },
      { name: "orange", value: "#fed7aa" },
    ]);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const focusTrapRef = useFocusTrap(true);
    // Focus restoration on modal close: useFocusTrap installs a
    // document-level keydown listener but does NOT restore focus on
    // unmount. We re-focus the element captured by previousFocusRef
    // (lazy-init above) so keyboard users return to the BookmarkRow
    // that opened the modal — not to <body>.
    useEffect(() => {
      const el = previousFocusRef.current;
      return () => {
        el?.focus();
      };
    }, []);
    const readerTitleId = useId();
    const settingsId = useId();
    // Lazy-init capture of the element that had focus BEFORE this component
    // renders. We must read `document.activeElement` in the initializer
    // callback, NOT in a useEffect, because useEffect runs AFTER useFocusTrap
    // has already moved focus into the modal — by then `activeElement` is
    // already the modal's first focusable (X button), defeating restoration.
    const previousFocusRef = useRef<HTMLElement | null>(
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );

    // WAI-ARIA radiogroup keyboard navigation (ArrowLeft/Right/Up/Down +
    // Home/End): required for axe-core `aria-required-children` and
    // keyboard-only users. Shared by the theme and AI reader-mode groups.
    const handleRadioKeyDown = (
      e: React.KeyboardEvent<HTMLDivElement>,
      order: readonly string[],
      current: string,
      setValue: (value: string) => void,
    ): void => {
      if (!RADIO_NAV_KEYS.has(e.key as KeyboardEvent["key"])) {
        return;
      }
      const idx = order.indexOf(current);
      let nextIdx = idx;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        nextIdx = (idx + 1) % order.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        nextIdx = (idx - 1 + order.length) % order.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = order.length - 1;
      }
      e.preventDefault();
      setValue(order[nextIdx] ?? current);
      // Wait one frame so React commits the new tabIndex/{aria-checked}
      // state before we focus the new radio. Without this, the focus()
      // call would land on the DOM node with the OLD tabIndex={-1}, which
      // is honored by browsers but causes flicker in some screen readers.
      requestAnimationFrame(() => {
        const radios =
          e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
        radios[nextIdx]?.focus();
      });
    }

    const handleThemeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) =>
      handleRadioKeyDown(e, THEME_ORDER, theme, (v) =>
        setTheme(v as ReaderTheme),
      );

    const handleReaderModeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) =>
      handleRadioKeyDown(e, READER_MODE_ORDER, readerMode, (v) =>
        setReaderMode(v as ReaderMode),
      );

    // Save and restore focus on modal open/close — axe-core pattern for
    // dialogs. Without this, focus is dropped to <body> when the modal
    // closes, severing context for keyboard users.
    // NOTE: focus capture is done via lazy `useRef` initializer above;
    // this useEffect only owns the unmount cleanup that calls .focus().

    // Reading time is derived from the current content, so it does not need
    // an effect/state pair (which would schedule an avoidable post-render
    // update for every reader opening).
    const readingTime = Math.ceil(
      (viewingContent.content || "").split(/\s+/).length / 200,
    );

    // Track scroll progress
    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      const handleScroll = () => {
        const scrollTop = container.scrollTop;
        const scrollHeight = container.scrollHeight - container.clientHeight;
        const progress =
          scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        const nextProgress = Math.min(100, Math.max(0, progress));
        setProgress((previous) =>
          previous === nextProgress ? previous : nextProgress,
        );
      };

      container.addEventListener("scroll", handleScroll);
      handleScroll(); // Initial calculation

      return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    // Load highlights on mount

    // Handle text selection for highlighting
    const handleMouseUp = useCallback(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (text && text.length > 0 && text.split(/\s+/).length <= 50) {
        const range = selection?.getRangeAt(0);
        const rect = range?.getBoundingClientRect();
        if (rect) {
          setHighlightToolbarPos({
            x: rect.left + rect.width / 2,
            y: rect.top - 10,
          });
          setShowHighlightToolbar(true);
          setSelectedText(text);
        }
      } else {
        setTimeout(() => setShowHighlightToolbar(false), 200);
      }
    }, []);

    const handleAddHighlight = (color: string) => {
      if (!selectedText) {return;}
      // Supersede any in-flight load so its late list can't overwrite the
      // fresh one this add is about to set (shared-guard property).
      cancelHighlightsLoad();
      void highlightActions.add.run(async () => {
        await highlightService.addHighlight(
          viewingContent.id,
          selectedText,
          color,
        );
        return highlightService.getHighlights(viewingContent.id);
      });
    }

    const handleRemoveHighlight = (id: string) => {
      cancelHighlightsLoad();
      void highlightActions.remove.run(async () => {
        await highlightService.removeHighlight(id);
        return highlightService.getHighlights(viewingContent.id);
      });
    }

    const handleKeyPoints = () => {
      void copilot.keyPoints.runWithSignal(async (signal) => {
        const { aiManager } =
          await import("../../services/ai/ProviderManager");
        return generateWithPrivacy(
          aiManager,
          viewingContent,
          `Summarize the key points (max 5 bullet points) of this article in the same language as the text:\n\n${viewingContent.content.slice(0, 8000)}`,
          undefined,
          { signal },
        );
      });
    }

    const handleRelated = () => {
      void copilot.related.runWithSignal(async (signal) => {
        const { agentService } =
          await import("../../services/ai/AgentService");
        return agentService.globalChat(
          `Find related articles or concepts similar to this text, return only titles and brief relevance:\n\n${viewingContent.content.slice(0, 4000)}`,
          undefined,
          viewingContent.isPrivate !== false,
          undefined,
          undefined,
          undefined,
          undefined,
          signal,
        );
      });
    }

    const escapeHtml = (value: string): string =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const applyHighlights = (content: string): string => {
      if (!highlights.length) {return content;}
      let result = content;
      for (const h of highlights) {
        const text = h.text ?? "";
        if (text.length === 0) {continue;}
        const escapedText = escapeHtml(text);
        result = result.replaceAll(
          text,
          `<mark style="background: ${escapeHtml(h.color)}; padding: 2px 4px; border-radius: 3px; cursor: pointer;" title="${escapeHtml(h.note || "")}">${escapedText}</mark>`,
        );
      }
      return result;
    }

    const themeClasses = {
      light: "bg-white text-[var(--text-primary)] border-[var(--divider)]",
      dark: "bg-[var(--bg-primary)] text-[var(--text-accent)] border-[var(--divider)]",
      sepia: "bg-[#f4ecd8] text-[#5b4636] border-[#e4dcc8]",
    };

    const proseClasses = {
      light: "prose-zinc",
      dark: "prose-invert prose-zinc",
      sepia: "prose-stone",
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6 animate-in fade-in duration-500 ds-bg-black-80">
        <motion.div
          ref={focusTrapRef}
          onKeyDown={(e) => {
            // Escape closes the modal — required by axe-core dialog
            // best-practice; useFocusTrap does not auto-bind Esc unless
            // explicitly told to.
            if (e.key === "Escape") {setViewingContent(null);}
          }}
          layout
          aria-modal="true"
          role="dialog"
          aria-labelledby={readerTitleId}
          className={`${themeClasses[theme]} border w-full h-full md:max-w-5xl md:h-auto md:max-h-[92vh] flex flex-col shadow-2xl md:rounded-[32px] overflow-hidden transition-all duration-500 relative`}
        >
          <h3 id={readerTitleId} className="sr-only">
            {viewingContent.title}
          </h3>
          <AnimatePresence>
            {!isFocusMode && (
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                className={`flex items-center justify-between p-4 md:px-8 border-b ${theme === "sepia" ? "border-[#e4dcc8] bg-[#f4ecd8]/80" : "border-[var(--divider)] dark:border-[var(--divider)] bg-inherit/80"} sticky top-0 z-20`}
              >
                <div className="flex items-center gap-4">
                  {" "}
                  <button
                    onClick={() => setViewingContent(null)}
                    className="p-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ds-radius-toggle"
                    aria-label={t("app_closeReader")}
                  >
                    <X className="size-5" />
                  </button>
                  <div className="flex flex-col min-w-0">
                    <h3 className="text-sm font-semibold uppercase tracking-widest ds-text-secondary truncate max-w-[200px]">
                      {viewingContent.title}
                    </h3>
                    <div className="flex items-center gap-3 text-[10px] font-medium ds-text-muted">
                      <span className="flex items-center gap-1">
                        <Timer className="size-3" /> {readingTime}{" "}
                        {t("app_min", "min")}
                      </span>
                      <span
                        className="size-1 rounded-full bg-current"
                        aria-hidden="true"
                      ></span>
                      <span aria-label={`${Math.round(progress)} percent read`}>
                        {Math.round(progress)}%
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className="flex items-center gap-2"
                  role="group"
                  aria-label={t("app_readerControls", "Reader controls")}
                >
                  {" "}
                  <div
                    className="flex p-1 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)] ds-bg-secondary"
                    role="radiogroup"
                    aria-label={t("app_theme", "Theme")}
                    aria-orientation="horizontal"
                    tabIndex={0}
                    onKeyDown={handleThemeKeyDown}
                  >
                    <button
                      onClick={() => setTheme("light")}
                      role="radio"
                      aria-checked={theme === "light"}
                      aria-label={t("app_lightTheme", "Light theme")}
                      tabIndex={theme === "light" ? 0 : -1}
                      className={`p-2 rounded-lg transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${theme === "light" ? "bg-white text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                    >
                      <Sun className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setTheme("dark")}
                      role="radio"
                      aria-checked={theme === "dark"}
                      aria-label={t("app_darkTheme", "Dark theme")}
                      tabIndex={theme === "dark" ? 0 : -1}
                      className={`p-2 rounded-lg transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${theme === "dark" ? "bg-[var(--bg-primary)] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                    >
                      <Moon className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setTheme("sepia")}
                      role="radio"
                      aria-checked={theme === "sepia"}
                      aria-label={t("app_sepiaTheme", "Sepia theme")}
                      tabIndex={theme === "sepia" ? 0 : -1}
                      className={`p-2 rounded-lg transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${theme === "sepia" ? "bg-[#f4ecd8] text-[#5b4636] shadow-sm" : "text-[#5b4636]/60 hover:text-[#5b4636]"}`}
                    >
                      <Coffee className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div
                    className="h-6 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"
                    aria-hidden="true"
                  ></div>
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className="p-2.5 transition-all ds-radius-button"
                    aria-label={t("app_settings", "Settings")}
                    aria-expanded={showSettings}
                    aria-controls={settingsId}
                    style={{
                      background: showSettings
                        ? "var(--accent-primary)"
                        : "transparent",
                      color: showSettings ? "white" : "var(--text-muted)",
                    }}
                  >
                    <Type className="size-5" />
                  </button>
                  <div
                    className="h-6 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"
                    aria-hidden="true"
                  ></div>
                  <button
                    onClick={() => handleFetchContent(viewingContent)}
                    disabled={!!isFetchingContent}
                    className="truncate flex items-center gap-2 px-4 py-2.5 text-white text-sm font-bold transition-all disabled:opacity-50 shadow-lg ds-radius-button ds-bg-accent-primary ds-shadow-accent"
                    title={t("app_extractArticle")}
                  >
                    {isFetchingContent ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    <span className="hidden sm:inline">
                      {t("app_extractArticle")}
                    </span>
                  </button>
                  <div
                    className="h-6 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"
                    aria-hidden="true"
                  ></div>
                  <button
                    onClick={() => handleCleanContent(viewingContent)}
                    disabled={!!isCleaningContent}
                    className="truncate flex items-center gap-2 px-4 py-2.5 text-white text-sm font-bold transition-all disabled:opacity-50 shadow-lg ds-radius-button ds-bg-accent-primary ds-shadow-accent"
                  >
                    {isCleaningContent ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Sparkles className="size-4" />
                    )}
                    <span className="hidden sm:inline">{t("app_aiClean")}</span>
                  </button>
                  <div
                    className="h-6 w-px bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] mx-1"
                    aria-hidden="true"
                  ></div>
                  <button
                    onClick={() => setShowAICopilot(!showAICopilot)}
                    className={`truncate flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-all shadow-lg ds-radius-button ${showAICopilot ? "ds-bg-accent-primary ds-text-white" : "ds-text-muted"}`}
                    title={t("app_aiCopilot", "AI Copilot")}
                  >
                    <Sparkles className="size-4" />
                    <span className="hidden sm:inline">
                      {t("app_aiCopilot", "Copilot")}
                    </span>
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="p-2.5 transition-all ds-radius-button ds-text-muted"
                    aria-label={t("app_exportPdf")}
                  >
                    <Download className="size-5" />
                  </button>
                  <button
                    onClick={handleExportMarkdown}
                    className="truncate p-2.5 transition-all flex items-center gap-2 ds-radius-button ds-text-muted"
                    aria-label={t("app_exportMarkdown")}
                  >
                    <span
                      className="text-[10px] font-semibold border border-[var(--divider)] rounded px-1"
                      aria-hidden="true"
                    >
                      {t("app_md")}
                    </span>
                  </button>
                  <button
                    onClick={() => setIsFocusMode(true)}
                    className="p-2.5 transition-all ds-radius-button ds-text-muted"
                    aria-label={t("app_focusMode")}
                  >
                    <Maximize2 className="size-5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isFocusMode && (
            <button
              onClick={() => setIsFocusMode(false)}
              className="fixed top-8 end-8 z-30 p-3 bg-[var(--bg-primary)]/50 hover:bg-[var(--state-hover-bg)] text-white rounded-full transition-all border border-white/10"
              aria-label={t("app_exitFocusMode", "Exit focus mode")}
            >
              <Minimize2 className="size-5" />
            </button>
          )}

          <AnimatePresence>
            {showSettings && (
              <motion.div
                id={settingsId}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                role="region"
                aria-label={t("app_appearanceSettings", "Appearance settings")}
                className="border-b border-[var(--divider)] dark:border-[var(--divider)] overflow-hidden ds-bg-secondary"
              >
                <div className="p-6 flex flex-wrap items-center justify-center gap-8">
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-bold uppercase tracking-widest ds-text-muted">
                      {t("app_theme", "Theme")}
                    </span>
                    <div
                      className="flex p-1 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)] ds-bg-secondary"
                      role="radiogroup"
                      aria-label={t("app_theme", "Theme")}
                      aria-orientation="horizontal"
                      tabIndex={0}
                      onKeyDown={handleThemeKeyDown}
                    >
                      <button
                        onClick={() => setTheme("light")}
                        role="radio"
                        aria-checked={theme === "light"}
                        aria-label={t("app_lightTheme", "Light theme")}
                        tabIndex={theme === "light" ? 0 : -1}
                        className={`p-2 rounded-lg transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${theme === "light" ? "bg-white text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                      >
                        <Sun className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => setTheme("dark")}
                        role="radio"
                        aria-checked={theme === "dark"}
                        aria-label={t("app_darkTheme", "Dark theme")}
                        tabIndex={theme === "dark" ? 0 : -1}
                        className={`p-2 rounded-lg transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${theme === "dark" ? "bg-[var(--bg-primary)] text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                      >
                        <Moon className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => setTheme("sepia")}
                        role="radio"
                        aria-checked={theme === "sepia"}
                        aria-label={t("app_sepiaTheme", "Sepia theme")}
                        tabIndex={theme === "sepia" ? 0 : -1}
                        className={`p-2 rounded-lg transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${theme === "sepia" ? "bg-[#f4ecd8] text-[#5b4636] shadow-sm" : "text-[#5b4636]/80 hover:text-[#5b4636]"}`}
                      >
                        <Coffee className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span
                      id="size-label"
                      className="text-xs font-bold uppercase tracking-widest ds-text-muted"
                    >
                      {t("app_size", "Size")}
                    </span>
                    <div
                      className="flex items-center gap-3"
                      role="group"
                      aria-labelledby="size-label"
                    >
                      <button
                        onClick={() => setFontSize(Math.max(14, fontSize - 2))}
                        className="size-8 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"
                        aria-label={t(
                          "app_decreaseFontSize",
                          "Decrease font size",
                        )}
                      >
                        -
                      </button>
                      <span
                        className="text-sm font-mono w-8 text-center"
                        aria-live="polite"
                      >
                        {fontSize}
                      </span>
                      <button
                        onClick={() => setFontSize(Math.min(32, fontSize + 2))}
                        className="size-8 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"
                        aria-label={t(
                          "app_increaseFontSize",
                          "Increase font size",
                        )}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span
                      id="line-label"
                      className="text-xs font-bold uppercase tracking-widest ds-text-muted"
                    >
                      {t("app_line", "Line")}
                    </span>
                    <div
                      className="flex items-center gap-2"
                      role="group"
                      aria-labelledby="line-label"
                    >
                      <button
                        onClick={() =>
                          setLineHeight(Math.max(1.3, lineHeight - 0.1))
                        }
                        className="size-8 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-xs"
                        aria-label={t(
                          "app_decreaseLineHeight",
                          "Decrease line height",
                        )}
                      >
                        -
                      </button>
                      <span
                        className="text-sm font-mono w-10 text-center"
                        aria-live="polite"
                      >
                        {lineHeight.toFixed(1)}
                      </span>
                      <button
                        onClick={() =>
                          setLineHeight(Math.min(2.5, lineHeight + 0.1))
                        }
                        className="size-8 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-xs"
                        aria-label={t(
                          "app_increaseLineHeight",
                          "Increase line height",
                        )}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span
                      id="reader-mode-label"
                      className="text-xs font-bold uppercase tracking-widest ds-text-muted"
                    >
                      {t("app_readerMode", "AI Reader")}
                    </span>
                    <div
                      className="flex p-1 rounded-xl border border-[var(--divider)] dark:border-[var(--divider)] ds-bg-secondary"
                      role="radiogroup"
                      aria-labelledby="reader-mode-label"
                      aria-orientation="horizontal"
                      tabIndex={0}
                      onKeyDown={handleReaderModeKeyDown}
                    >
                      {READER_MODE_ORDER.map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setReaderMode(mode)}
                          role="radio"
                          aria-checked={readerMode === mode}
                          aria-label={t(
                            READER_MODE_LABELS[mode],
                            mode,
                          )}
                          tabIndex={readerMode === mode ? 0 : -1}
                          className={`truncate px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ds-radius-button focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] ${
                            readerMode === mode
                              ? "bg-[var(--accent-primary)] text-white shadow-sm"
                              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                          }`}
                        >
                          {t(
                            READER_MODE_LABELS[mode],
                            mode.charAt(0).toUpperCase() + mode.slice(1),
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span
                      id="width-label"
                      className="text-xs font-bold uppercase tracking-widest ds-text-muted"
                    >
                      {t("app_width", "Width")}
                    </span>
                    <div
                      className="flex items-center gap-2"
                      role="group"
                      aria-labelledby="width-label"
                    >
                      <button
                        onClick={() =>
                          setContentWidth(Math.max(60, contentWidth - 10))
                        }
                        className="size-8 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"
                        aria-label={t(
                          "app_decreaseContentWidth",
                          "Decrease content width",
                        )}
                      >
                        <AlignLeft className="size-4" />
                      </button>
                      <span
                        className="text-sm font-mono w-10 text-center"
                        aria-live="polite"
                      >
                        {contentWidth}%
                      </span>
                      <button
                        onClick={() =>
                          setContentWidth(Math.min(100, contentWidth + 10))
                        }
                        className="size-8 flex items-center justify-center rounded-lg bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)] text-[var(--text-muted)] hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)]"
                        aria-label={t(
                          "app_increaseContentWidth",
                          "Increase content width",
                        )}
                      >
                        <AlignJustify className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div
            ref={scrollContainerRef}
            onMouseUp={handleMouseUp}
            role="region"
            aria-label="Reading content"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Escape") {
                e.preventDefault();
                handleMouseUp();
              }
            }}
            className="flex-1 overflow-y-auto selection:bg-cyan-500/30 scroll-smooth custom-scrollbar relative"
          >
            {/* Progress Bar */}
            <div
              className="absolute top-0 left-0 right-0 h-1 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] z-30"
              aria-hidden="true"
            >
              <div
                className="h-full bg-cyan-500 transition-all duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div
              id="reading-content"
              className="max-w-3xl mx-auto py-16 md:py-24 px-8 md:px-12"
              style={{ maxWidth: `${contentWidth}%` }}
            >
              <header className="mb-16 text-center">
                <motion.h1
                  layout
                  className="text-4xl md:text-6xl font-semibold mb-8 leading-[1.1] tracking-tight"
                >
                  {viewingContent.title}
                </motion.h1>
                <div className="flex flex-wrap items-center justify-center gap-6 text-sm font-bold uppercase tracking-widest ds-text-muted">
                  <span className="flex items-center gap-2">
                    <Calendar className="size-4" />{" "}
                    {formatDate(viewingContent.createdAt, {}, i18n.language)}
                  </span>
                  <span
                    className="size-1.5 rounded-full bg-current opacity-20"
                    aria-hidden="true"
                  ></span>
                  <span className="flex items-center gap-2 ds-text-primary">
                    <Sparkles className="size-4" /> {t("app_aiForged")}
                  </span>
                </div>
              </header>

              {!viewingContent.content ? (
                <div className="text-center py-24 opacity-60">
                  <p className="text-xl font-semibold mb-4">
                    {t("app_noContent")}
                  </p>
                  <p className="text-sm mb-8">{t("app_noContentDesc")}</p>
                  <button
                    onClick={() => handleFetchContent(viewingContent)}
                    disabled={!!isFetchingContent}
                    className="truncate inline-flex items-center gap-2 px-6 py-3 text-white text-sm font-bold transition-all disabled:opacity-50 shadow-lg ds-radius-button ds-bg-accent-primary ds-shadow-accent"
                  >
                    {isFetchingContent ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {t("app_extractArticle")}
                  </button>
                </div>
              ) : (
                <div
                  className={`prose ${proseClasses[theme]} prose-lg md:prose-xl max-w-none leading-relaxed transition-all duration-300`}
                  style={{
                    fontSize: `${fontSize}px`,
                    lineHeight: lineHeight,
                    fontFamily:
                      fontFamily === "serif"
                        ? "Georgia, serif"
                        : fontFamily === "monospace"
                          ? "monospace"
                          : "system-ui, sans-serif",
                  }}
                >
                  <div className="markdown-body">
                    {viewingContent.summary && (
                      <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-16 p-8 md:p-12"
                        style={{
                          borderRadius: "var(--radius-card)",
                          background:
                            theme === "sepia"
                              ? "rgba(91, 70, 54, 0.05)"
                              : "var(--accent-faint)",
                          border:
                            theme === "sepia"
                              ? "1px solid rgba(91, 70, 54, 0.1)"
                              : "1px solid var(--accent-soft)",
                        }}
                      >
                        <h4 className="text-xs font-semibold uppercase tracking-[0.2em] mb-6 flex items-center gap-3 ds-text-primary">
                          <Sparkles className="size-4" />
                          {t("app_summary")}
                        </h4>
                        <p className="text-lg md:text-xl font-medium leading-relaxed italic opacity-90">
                          {viewingContent.summary}
                        </p>
                      </motion.div>
                    )}
                    <Markdown rehypePlugins={[rehypeRaw]}>
                      {SanitizationService.sanitizeHtml(
                        applyHighlights(viewingContent.content || ""),
                        true,
                      )}
                    </Markdown>
                  </div>
                </div>
              )}

              {highlights.length > 0 && viewingContent.content && (
                <div className="mt-16 pt-8 border-t border-[var(--divider)]">
                  <h4 className="text-xs font-semibold uppercase tracking-widest ds-text-muted mb-4 flex items-center gap-2">
                    <Sparkles className="size-3" />
                    {t("app_highlights")}
                  </h4>
                  <div className="space-y-2">
                    {highlights.map((h) => (
                      <div
                        key={h.id}
                        className="flex items-start gap-3 p-3 rounded-lg"
                        style={{ background: h.color + "40" }}
                      >
                        <span className="flex-1 text-sm">{h.text}</span>
                        <button
                          onClick={() => handleRemoveHighlight(h.id)}
                          className="p-1 ds-text-muted hover:ds-text-primary transition-colors"
                          aria-label={t("app_removeHighlight")}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showAICopilot && viewingContent.content && (
                <div className="mt-16 p-6 rounded-xl border border-[var(--divider)] ds-bg-primary">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="size-4 ds-text-accent" />
                    <span className="font-semibold text-sm">
                      {t("app_aiCopilot", "AI Copilot")}
                    </span>
                  </div>
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={handleKeyPoints}
                      className="truncate px-4 py-2 text-sm font-bold transition-all ds-radius-button ds-bg-accent-primary ds-text-white ds-shadow-accent"
                    >
                      {isCopilotLoading && !copilotResult ? (
                        <Loader2 className="size-4 animate-spin inline me-1" />
                      ) : (
                        <Sparkles className="size-4 inline me-1" />
                      )}
                      {t("app_keyPoints", "Key Points")}
                    </button>
                    <button
                      onClick={handleRelated}
                      className="truncate px-4 py-2 text-sm font-bold transition-all ds-radius-button ds-bg-accent-primary ds-text-white ds-shadow-accent"
                    >
                      <MessageSquare className="size-4 inline me-1" />
                      {t("app_related", "Related")}
                    </button>
                  </div>
                  {(isCopilotLoading || copilotResult) && (
                    <div
                      className="p-4 rounded-lg text-sm leading-relaxed"
                      style={{ background: "var(--accent-faint)" }}
                    >
                      {isCopilotLoading ? (
                        <span className="flex items-center gap-2 opacity-60">
                          <Loader2 className="size-4 animate-spin" />
                          {t("app_generating", "Generating...")}
                        </span>
                      ) : (
                        copilotResult.split("\n").map((line, i) => (
                          <p key={i} className="mb-2">
                            {line}
                          </p>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              <footer className="mt-24 pt-12 border-t border-current opacity-10 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em]">
                  {t("app_generatedByForge")} {t("app_bullet", "•")}{" "}
                  {new Date().getFullYear()}
                </p>
              </footer>
            </div>
          </div>

          {showHighlightToolbar && (
            <div
              className="fixed z-50 flex items-center gap-1 p-1.5 rounded-xl shadow-2xl border border-[var(--divider)] ds-bg-primary"
              style={{
                left: highlightToolbarPos.x,
                top: highlightToolbarPos.y,
                transform: "translate(-50%, -100%)",
              }}
              role="toolbar"
              aria-label={t("app_highlightToolbar")}
            >
              {highlightColors.map((c) => (
                <button
                  key={c.name}
                  onClick={() => handleAddHighlight(c.value)}
                  className="size-7 rounded-lg border border-[var(--divider)] hover:scale-110 transition-transform"
                  style={{ background: c.value }}
                  aria-label={`${c.name}`}
                />
              ))}
            </div>
          )}

          {/* AI Reader modes — only when the bookmark has content. Each is
              fully self-contained and tested in src/tests/security/. */}
          {viewingContent.content && readerMode === "mood" && (
            <MoodAdaptiveReader
              content={viewingContent.content}
              isPrivate={viewingContent.isPrivate !== false}
              scrollContainerRef={scrollContainerRef}
            />
          )}
          {viewingContent.content && readerMode === "partner" && (
            <AIReadingPartner
              content={viewingContent.content}
              isPrivate={viewingContent.isPrivate !== false}
              currentBookmarkId={viewingContent.id}
            />
          )}
          {viewingContent.content && readerMode === "devil" && (
            <DevilAdvocateReader
              content={viewingContent.content}
              isPrivate={viewingContent.isPrivate !== false}
              title={viewingContent.title}
            />
          )}
        </motion.div>
      </div>
    );
  };
