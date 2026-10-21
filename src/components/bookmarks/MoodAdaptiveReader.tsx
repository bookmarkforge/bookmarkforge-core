import { useState, useEffect } from "react";
import { Sun, Moon, Coffee, Zap, Clock } from "lucide-react";
import { safeGet } from "../../store/safeStorage";
import { logger } from "../../utils/logger";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { generateWithPrivacy } from "../../services/ai/privacy";

interface Props {
  content: string;
  isPrivate?: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

type Mood = "night_owl" | "morning" | "afternoon" | "evening";

const moodConfig: Record<Mood, { icon: React.ReactNode; label: string }> = {
  night_owl: { icon: <Moon size={14} />, label: "Night Owl" },
  morning: { icon: <Sun size={14} />, label: "Morning" },
  afternoon: { icon: <Zap size={14} />, label: "Afternoon" },
  evening: { icon: <Coffee size={14} />, label: "Evening" },
};

function getMoodFromHour(hour: number): Mood {
  if (hour < 7) {return "night_owl";}
  if (hour < 12) {return "morning";}
  if (hour < 17) {return "afternoon";}
  if (hour < 21) {return "evening";}
  return "night_owl";
}

function getStoredMood(): Mood | null {
  try {
    const stored = safeGet("bookmarkforge_reader_mood");
    if (stored && stored in moodConfig) {return stored as Mood;}
  } catch (_err) {
    // safeGet may throw if localStorage is unavailable (private browsing, quota exceeded)
    logger.debug("[MoodAdaptiveReader] Failed to read stored mood", { error: _err });
  }
  return null;
}

export const MoodAdaptiveReader: React.FC<Props> = ({
  content,
  // Missing privacy metadata fails closed to the local provider.
  isPrivate = true,
  scrollContainerRef,
}) => {
  const [mood] = useState<Mood>(
    () => getStoredMood() ?? getMoodFromHour(new Date().getHours()),
  );
  const [scrollSpeed, setScrollSpeed] = useState(0);
  const [showSkim, setShowSkim] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const {
    runWithSignal,
    isRunning: loadingSummary,
    cancel,
  } = useGuardedAction<string>({
    onSuccess: (text) => setSummary(text),
    onError: () => setSummary("Unable to generate summary at this time."),
  });

  useEffect(() => {
    // cancel resets the loading flag too (the fixed cancel), so the manual
    // setLoadingSummary(false) of the original is covered.
    cancel();
    setSummary(null);
  }, [content, cancel]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) {return;}

    let lastScrollTop = el.scrollTop;
    let lastTime = Date.now();
    let raf: number;

    const tick = () => {
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      if (dt > 0) {
        const speed = Math.abs(el.scrollTop - lastScrollTop) / dt;
        setScrollSpeed(speed);
        setShowSkim(speed > 200);
      }
      lastScrollTop = el.scrollTop;
      lastTime = now;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scrollContainerRef]);

  const handleSkim = () => {
    void runWithSignal(async (signal) => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const result = await generateWithPrivacy(
        aiManager,
        { isPrivate },
        "Summarize this briefly in 3 bullet points:\n\n" +
          content.slice(0, 5000),
        undefined,
        { signal },
      );
      return result.text;
    });
  };

  const cfg = moodConfig[mood];

  return (
    <>
      <div
        style={{
          position: "absolute",
          bottom: 12,
          right: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          borderRadius: 999,
          background: "rgba(0,0,0,0.5)",
          color: "#fff",
          fontSize: 12,
          zIndex: 20,
          backdropFilter: "blur(4px)",
          pointerEvents: "auto",
        }}
      >
        {cfg.icon}
        <span>{cfg.label}</span>
        <Clock size={12} style={{ opacity: 0.6 }} />
        <span style={{ opacity: 0.6 }}>{Math.round(scrollSpeed)}px/s</span>
      </div>

      {showSkim && !summary && (
        <div
          style={{
            position: "absolute",
            bottom: 48,
            right: 12,
            zIndex: 20,
          }}
        >
          <button
            onClick={handleSkim}
            disabled={loadingSummary}
            style={{
              padding: "6px 16px",
              borderRadius: 999,
              border: "none",
              background: loadingSummary ? "#888" : "#3b82f6",
              color: "#fff",
              fontSize: 13,
              cursor: loadingSummary ? "default" : "pointer",
              boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            }}
 className="truncate">
            {loadingSummary ? "Summarizing…" : "Skim this article"}
          </button>
        </div>
      )}

      {summary && (
        <div
          style={{
            position: "absolute",
            bottom: 48,
            right: 12,
            width: 280,
            padding: 12,
            borderRadius: 12,
            background: "#1e293b",
            color: "#e2e8f0",
            fontSize: 13,
            zIndex: 30,
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
            Summary
          </div>
          <div style={{ whiteSpace: "pre-line", lineHeight: 1.6 }}>
            {summary}
          </div>
          <button
            onClick={() => setSummary(null)}
            style={{
              marginTop: 8,
              background: "none",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: 12,
              textDecoration: "underline",
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
};

