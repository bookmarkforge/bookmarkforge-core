import { useState, useEffect } from "react";
import { Lightbulb, X, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";

interface Tip {
  key: string;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
  condition: () => boolean;
}

const ALL_TIPS: Tip[] = [
  {
    key: "tip_quick_capture",
    titleKey: "app_tipQuickCaptureTitle",
    titleFallback: "Quick Capture",
    descKey: "app_tipQuickCaptureDesc",
    descFallback:
      "Use Ctrl+Shift+B to quickly capture a bookmark from any browser tab.",
    condition: () => true,
  },
  {
    key: "tip_keyboard_shortcuts",
    titleKey: "app_tipShortcutsTitle",
    titleFallback: "Keyboard Shortcuts",
    descKey: "app_tipShortcutsDesc",
    descFallback:
      "Press ? to view all available keyboard shortcuts and boost your workflow.",
    condition: () => true,
  },
  {
    key: "tip_search",
    titleKey: "app_tipSearchTitle",
    titleFallback: "Powerful Search",
    descKey: "app_tipSearchDesc",
    descFallback: "Search across all your bookmarks and documents with Ctrl+K.",
    condition: () => true,
  },
  {
    key: "tip_analytics",
    titleKey: "app_tipAnalyticsTitle",
    titleFallback: "Local Analytics",
    descKey: "app_tipAnalyticsDesc",
    descFallback:
      "View your personal analytics dashboard — all computed locally, zero data leaves your device.",
    condition: () => true,
  },
  {
    key: "tip_backup",
    titleKey: "app_tipBackupTitle",
    titleFallback: "Backup Your Data",
    descKey: "app_tipBackupDesc",
    descFallback:
      "Export your data regularly from Settings to keep a safe copy on your device.",
    condition: () => true,
  },
];

const DISMISSED_KEY = STORAGE_KEYS.DISMISSED_TIPS;

function getDismissed(): string[] {
  try {
    const raw = safeGet(DISMISSED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_err) {
    return [];
  }
}

export function QuickTips() {
  const { t } = useTranslation();
  const [visibleTip, setVisibleTip] = useState<Tip | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>(getDismissed);

  const availableTips = ALL_TIPS.filter(
    (tip) => !dismissed.includes(tip.key) && tip.condition(),
  );

  useEffect(() => {
    if (availableTips.length > 0) {
      const today = new Date().toDateString();
      const shownKey = `forge_tip_shown_${today}`;
      const shown = safeGet(shownKey);
      if (!shown) {
        setVisibleTip(availableTips[0]!);
        safeSet(shownKey, "true");
      }
    }
  }, [availableTips]);

  const dismiss = () => {
    if (visibleTip) {
      const next = [...dismissed, visibleTip.key];
      setDismissed(next);
      safeSet(DISMISSED_KEY, JSON.stringify(next));
      setVisibleTip(null);
    }
  };

  const showNext = () => {
    const nextIndex = (tipIndex + 1) % availableTips.length;
    setTipIndex(nextIndex);
    setVisibleTip(availableTips[nextIndex]!);
  };

  if (!visibleTip || availableTips.length === 0) {return null;}

  return (
    <div
      className="flex items-start gap-3 p-4 ds-card-soft rounded-lg border border-[var(--accent-glow)]"
      role="status"
      aria-live="polite"
    >
      <div className="size-9 flex items-center justify-center rounded-full shrink-0 ds-icon-tint-cyan">
        <Lightbulb className="size-5 ds-text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold ds-text-primary">
          {t(visibleTip.titleKey, visibleTip.titleFallback)}
        </p>
        <p className="text-xs mt-0.5 ds-text-secondary">
          {t(visibleTip.descKey, visibleTip.descFallback)}
        </p>
        {availableTips.length > 1 && (
          <button
            onClick={showNext}
            className="truncate mt-2 text-xs font-semibold flex items-center gap-1 ds-text-accent hover:underline"
          >
            {t("app_nextTip", "Next tip")}
            <ChevronRight className="rtl-flip size-3" />
          </button>
        )}
      </div>
      <button
        onClick={dismiss}
        className="p-1 transition-colors rounded-full hover:bg-[var(--state-hover-bg)] shrink-0"
        aria-label={t("app_dismissTip", "Dismiss tip")}
      >
        <X className="size-4 ds-text-muted" />
      </button>
    </div>
  );
}
