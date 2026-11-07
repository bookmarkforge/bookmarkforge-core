import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import {
  X,
  ChevronRight,
  ChevronLeft,
  Compass,
  Search,
  LayoutDashboard,
  Bookmark,
  Grid3X3,
  MessageSquare,
  Users,
  Settings,
} from "lucide-react";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";

const TOUR_STORAGE_KEY = STORAGE_KEYS.WELCOME_TOUR_COMPLETE;

interface TourStep {
  id: string;
  targetId: string;
  icon: React.ComponentType<{ className?: string }>;
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  position: "bottom" | "top" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "sidebar",
    targetId: "tour-sidebar",
    icon: Compass,
    titleKey: "tour_sidebarTitle",
    titleDefault: "Main Navigation",
    descKey: "tour_sidebarDesc",
    descDefault:
      "The sidebar is your command center. Access all features — bookmarks, documents, AI chat, collaboration, and more — from here. Collapse it anytime for a distraction-free view.",
    position: "right",
  },
  {
    id: "search",
    targetId: "tour-search",
    icon: Search,
    titleKey: "tour_searchTitle",
    titleDefault: "Instant Search",
    descKey: "tour_searchDesc",
    descDefault:
      "Press Ctrl+K (Cmd+K on Mac) to open the omnibar. Search across all your bookmarks, documents, and notes instantly. Create new documents, toggle themes, and more — all from the keyboard.",
    position: "bottom",
  },
  {
    id: "dashboard",
    targetId: "tour-dashboard",
    icon: LayoutDashboard,
    titleKey: "tour_dashboardTitle",
    titleDefault: "Your Dashboard",
    descKey: "tour_dashboardDesc",
    descDefault:
      "The dashboard is your home base. See your analytics, quick-capture new bookmarks, review recent activity, and get an overview of your knowledge vault — all computed locally on your device.",
    position: "bottom",
  },
  {
    id: "bookmarks",
    targetId: "tour-bookmarks",
    icon: Bookmark,
    titleKey: "tour_bookmarksTitle",
    titleDefault: "Bookmarks & Collections",
    descKey: "tour_bookmarksDesc",
    descDefault:
      "Save, organize, and tag your bookmarks. Switch between table, gallery, kanban, calendar, list, and timeline views. Use AI to auto-tag and summarize content automatically.",
    position: "right",
  },
  {
    id: "views",
    targetId: "tour-views",
    icon: Grid3X3,
    titleKey: "tour_viewsTitle",
    titleDefault: "Multiple Views",
    descKey: "tour_viewsDesc",
    descDefault:
      "Organize your content the way you think. Switch between Table, Gallery, Kanban, Calendar, List, and Timeline views. Each view gives you a different perspective on your knowledge vault.",
    position: "right",
  },
  {
    id: "chat",
    targetId: "tour-chat",
    icon: MessageSquare,
    titleKey: "tour_chatTitle",
    titleDefault: "AI-Powered Chat",
    descKey: "tour_chatDesc",
    descDefault:
      "Chat with AI models that run entirely on your device via WebLLM — no internet required. Or connect cloud providers like Gemini, OpenAI, Claude, or Groq. Your conversations stay private and encrypted.",
    position: "right",
  },
  {
    id: "collaboration",
    targetId: "tour-collaboration",
    icon: Users,
    titleKey: "tour_collaborationTitle",
    titleDefault: "P2P Collaboration",
    descKey: "tour_collaborationDesc",
    descDefault:
      "Share collections with other users in real time via peer-to-peer WebRTC. Generate a share link with a QR code, invite collaborators, and work together — all encrypted end-to-end, no central server stores your data.",
    position: "right",
  },
  {
    id: "settings",
    targetId: "tour-settings",
    icon: Settings,
    titleKey: "tour_settingsTitle",
    titleDefault: "Settings & Customization",
    descKey: "tour_settingsDesc",
    descDefault:
      "Customize themes, fonts, and layout. Set up encrypted backups, manage AI providers, configure collaboration, and control every aspect of your experience. Your data, your rules.",
    position: "bottom",
  },
];

/** Check if the device has a narrow screen. On mobile we show a simplified
 *  card-based tour instead of element-targeted tooltips. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {return false;}
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
}

/** Get the bounding rect of a target element, accounting for scroll. */
function getTargetRect(targetId: string): DOMRect | null {
  const el = document.querySelector(`[data-tour-id="${targetId}"]`);
  if (!el) {return null;}
  return el.getBoundingClientRect();
}

interface TooltipPosition {
  top: number;
  left: number;
  arrowDirection: "up" | "down" | "left" | "right";
}

/** Calculate tooltip position relative to the target element.
 *  tooltipH is a conservative estimate — longer translated text may
 *  push past it, but clamping in updatePosition keeps it on-screen. */
function calcTooltipPosition(
  targetId: string,
  preferredPosition: TourStep["position"],
): TooltipPosition | null {
  const rect = getTargetRect(targetId);
  if (!rect) {return null;}

  const gap = 16;
  const tooltipW = 360;
  const tooltipH = 260;

  switch (preferredPosition) {
    case "right":
      return {
        top: rect.top + rect.height / 2 - tooltipH / 2,
        left: rect.right + gap,
        arrowDirection: "left",
      };
    case "left":
      return {
        top: rect.top + rect.height / 2 - tooltipH / 2,
        left: rect.left - tooltipW - gap,
        arrowDirection: "right",
      };
    case "bottom":
      return {
        top: rect.bottom + gap,
        left: rect.left + rect.width / 2 - tooltipW / 2,
        arrowDirection: "up",
      };
    case "top":
    default:
      return {
        top: rect.top - tooltipH - gap,
        left: rect.left + rect.width / 2 - tooltipW / 2,
        arrowDirection: "down",
      };
  }
}

export function WelcomeTour() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<TooltipPosition | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const tourRef = useRef<HTMLDivElement>(null);

  const step = TOUR_STEPS[currentStep]!;
  const Icon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;

  // Check if tour should show (not completed + onboarding already done)
  useEffect(() => {
    const onboardingComplete =
      safeGet(STORAGE_KEYS.ONBOARDING_COMPLETE) === "true";
    const tourComplete = safeGet(TOUR_STORAGE_KEY) === "true";

    // Show tour only after onboarding is done and tour hasn't been completed
    if (onboardingComplete && !tourComplete) {
      // Small delay to let the UI render first
      const timer = setTimeout(() => setIsVisible(true), 800);
      return () => clearTimeout(timer);
    }
    return;
  }, []);

  // Update tooltip position when step changes or on resize/scroll
  const updatePosition = useCallback(() => {
    if (isMobile) {
      setTooltipPos(null);
      setTargetRect(null);
      return;
    }

    const pos = calcTooltipPosition(step.targetId, step.position);
    if (pos) {
      // Clamp to viewport
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      pos.left = Math.max(16, Math.min(pos.left, vw - 376));
      pos.top = Math.max(16, Math.min(pos.top, vh - 300));
      setTooltipPos(pos);
      setTargetRect(getTargetRect(step.targetId));
    } else {
      // Element not found — use fallback center card
      setTooltipPos(null);
      setTargetRect(null);
    }
  }, [step, isMobile]);

  useEffect(() => {
    if (!isVisible) {return;}
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, { passive: true });
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition);
    };
  }, [isVisible, updatePosition]);

  const completeTour = useCallback(() => {
    safeSet(TOUR_STORAGE_KEY, "true");
    setIsVisible(false);
  }, []);

  const goNext = useCallback(() => {
    if (isLast) {
      completeTour();
    } else {
      setCurrentStep((s) => s + 1);
    }
  }, [isLast, completeTour]);

  const goPrev = useCallback(() => {
    setCurrentStep((s) => Math.max(0, s - 1));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isVisible) {return;}
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        completeTour();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isVisible, goNext, goPrev, completeTour]);

  if (!isVisible) {return null;}

  // Dimmed overlay with clip-path cutout — the highlighted element stays fully
  // interactive because pointer-events pass through the transparent cutout area.
  // Uses SVG path with evenodd fill-rule: outer rect dims the viewport, inner
  // rect creates the transparent cutout hole slightly larger than the target.
  const dimOverlayStyle: React.CSSProperties =
    targetRect
      ? (() => {
          const pad = 6;
          const x = targetRect.left - pad;
          const y = targetRect.top - pad;
          const w = targetRect.width + pad * 2;
          const h = targetRect.height + pad * 2;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          return {
            position: "fixed" as const,
            inset: 0,
            background: "rgba(0, 0, 0, 0.55)",
            zIndex: 9998,
            pointerEvents: "none" as const,
            clipPath: `path(evenodd, 'M 0,0 h ${vw} v ${vh} h ${-vw} Z M ${x},${y} h ${w} v ${h} h ${-w} Z')`,
          };
        })()
      : {};

  // Shared progress dots component
  const ProgressDots = ({ compact = false }: { compact?: boolean }) => (
    <div className="flex items-center gap-1.5">
      {TOUR_STEPS.map((_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i === currentStep
              ? compact
                ? "w-5 ds-bg-accent"
                : "w-6 ds-bg-accent"
              : i < currentStep
                ? compact
                  ? "w-2.5 bg-[var(--accent-primary)]/40"
                  : "w-3 bg-[var(--accent-primary)]/40"
                : compact
                  ? "w-2.5 bg-[var(--state-inactive-border)]"
                  : "w-3 bg-[var(--state-inactive-border)]"
          }`}
        />
      ))}
    </div>
  );

  // Shared footer navigation buttons
  const FooterNav = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center justify-between ${compact ? "px-5 py-3" : "p-4"} ds-divider-t`}>
      <button
        onClick={goPrev}
        disabled={isFirst}
        className={`truncate flex items-center gap-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ds-text-muted ${
          compact
            ? "px-3 py-1.5 text-xs rounded-md hover:bg-[var(--state-hover-bg)]"
            : "px-3 py-2 text-sm"
        }`}
      >
        <ChevronLeft className="rtl-flip size-3.5" />
        {t("tour_back", "Back")}
      </button>
      <button
        onClick={goNext}
        className={`truncate flex items-center gap-1.5 font-semibold text-white transition-colors shadow-lg rounded-lg ds-accent-filled ds-shadow-accent hover:opacity-90 ${
          compact ? "px-4 py-2 text-xs shadow-md" : "px-5 py-2.5 text-sm"
        }`}
      >
        {isLast ? t("tour_done", "Got it!") : t("tour_next", "Next")}
        <ChevronRight className="rtl-flip size-3.5" />
      </button>
    </div>
  );

  // Mobile: simplified card-based tour
  const renderMobileTour = () => (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 ds-bg-black-70">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="w-full max-w-sm ds-card shadow-2xl overflow-hidden"
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <ProgressDots />
            <button
              onClick={completeTour}
              className="p-1.5 rounded-full transition-colors hover:bg-[var(--state-hover-bg)]"
              aria-label={t("tour_skip", "Skip tour")}
            >
              <X className="size-4 ds-text-muted" />
            </button>
          </div>

          <div className="flex flex-col items-center text-center">
            <div className="size-14 flex items-center justify-center mb-4 rounded-xl ds-bg-secondary ds-icon-tint-cyan">
              <Icon className="size-7 ds-text-accent" />
            </div>
            <h3 className="text-lg font-bold mb-2 ds-text-primary line-clamp-2">
              {t(step.titleKey, step.titleDefault)}
            </h3>
            <p className="text-sm leading-relaxed mb-6 ds-text-secondary">
              {t(step.descKey, step.descDefault)}
            </p>
            <p className="text-xs ds-text-muted">
              {currentStep + 1} / {TOUR_STEPS.length}
            </p>
          </div>
        </div>
        <FooterNav />
      </motion.div>
    </div>
  );

  // Desktop: element-targeted tooltip with spotlight
  const renderDesktopTour = () => (
    <>
      {/* Dimmed overlay with clip-path — cuts out the highlighted element's area.
          pointer-events: none allows clicks to pass through to the real element. */}
      {dimOverlayStyle.clipPath && <div style={dimOverlayStyle} aria-hidden="true" />}

      {/* Tooltip card */}
      {tooltipPos && (
        <motion.div
          ref={tourRef}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed z-[9999] w-[360px] ds-card shadow-2xl overflow-hidden"
          style={{
            top: tooltipPos.top,
            left: tooltipPos.left,
          }}
          role="dialog"
          aria-label={t("tour_stepLabel", "Guided tour")}
        >
          {/* Arrow */}
          <div
            className={`absolute size-3 ds-bg-card rotate-45 ${
              tooltipPos.arrowDirection === "up"
                ? "-top-1.5 left-1/2 -translate-x-1/2"
                : tooltipPos.arrowDirection === "down"
                  ? "-bottom-1.5 left-1/2 -translate-x-1/2"
                  : tooltipPos.arrowDirection === "left"
                    ? "-left-1.5 top-1/2 -translate-y-1/2"
                    : "-right-1.5 top-1/2 -translate-y-1/2"
            }`}
            aria-hidden="true"
          />

          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <ProgressDots compact />
              <button
                onClick={completeTour}
                className="p-1 rounded-full transition-colors hover:bg-[var(--state-hover-bg)]"
                aria-label={t("tour_skip", "Skip tour")}
              >
                <X className="size-3.5 ds-text-muted" />
              </button>
            </div>

            <div className="flex gap-3 mb-4">
              <div className="size-10 flex items-center justify-center rounded-lg shrink-0 ds-bg-secondary ds-icon-tint-cyan">
                <Icon className="size-5 ds-text-accent" />
              </div>
              <div>
                <h3 className="text-sm font-bold mb-1 ds-text-primary line-clamp-2">
                  {t(step.titleKey, step.titleDefault)}
                </h3>
                <p className="text-xs leading-relaxed ds-text-secondary">
                  {t(step.descKey, step.descDefault)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] ds-text-muted">
              <span>
                {currentStep + 1} / {TOUR_STEPS.length}
              </span>
              <span>
                {t("tour_escToSkip", "Esc to skip")} ·{" "}
                {t("tour_arrowsToNavigate", "← → to navigate")}
              </span>
            </div>
          </div>

          <FooterNav compact />
        </motion.div>
      )}

      {/* Fallback: center card when target element not found */}
      {!tooltipPos && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center ds-bg-black-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm mx-4 ds-card shadow-2xl overflow-hidden"
          >
            <div className="p-6 text-center">
              <div className="size-14 flex items-center justify-center mx-auto mb-4 rounded-xl ds-bg-secondary ds-icon-tint-cyan">
                <Icon className="size-7 ds-text-accent" />
              </div>
              <h3 className="text-lg font-bold mb-2 ds-text-primary line-clamp-2">
                {t(step.titleKey, step.titleDefault)}
              </h3>
              <p className="text-sm leading-relaxed mb-6 ds-text-secondary">
                {t(step.descKey, step.descDefault)}
              </p>
              <p className="text-xs ds-text-muted mb-4">
                {currentStep + 1} / {TOUR_STEPS.length}
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={goPrev}
                  disabled={isFirst}
                  className="truncate flex items-center gap-1 px-3 py-1.5 text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed rounded-md ds-text-muted"
                >
                  <ChevronLeft className="rtl-flip size-4" />
                  {t("tour_back", "Back")}
                </button>
                <button
                  onClick={goNext}
                  className="truncate flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white transition-colors shadow-lg rounded-lg ds-accent-filled ds-shadow-accent"
                >
                  {isLast
                    ? t("tour_done", "Got it!")
                    : t("tour_next", "Next")}
                  <ChevronRight className="rtl-flip size-4" />
                </button>
              </div>
            </div>
            <div className="p-3 ds-divider-t flex justify-center">
              <button
                onClick={completeTour}
                className="truncate text-xs ds-text-muted hover:underline"
              >
                {t("tour_skip", "Skip tour")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );

  return (
    <AnimatePresence>
      {isVisible && (isMobile ? renderMobileTour() : renderDesktopTour())}
    </AnimatePresence>
  );
}
