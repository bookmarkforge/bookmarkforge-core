import { useState } from "react";
import { motion, type Variants } from "motion/react";
import { Lightbulb, Sparkles, Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet, safeSet } from "../../store/safeStorage";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { StreamPreview } from "./StreamPreview";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface Blindspot {
  topic: string;
  reason: string;
  suggestion: string;
}

interface Props {
  bookmarkTitles: string[];
  cardVariants: Variants;
}

export const BlindspotDetection: React.FC<Props> = ({
  bookmarkTitles,
  cardVariants,
}) => {
  const { t } = useTranslation();
  const [blindspots, setBlindspots] = useState<Blindspot[]>(() => {
    try {
      const saved = safeGet("bookmarkforge_blindspots");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [streamText, setStreamText] = useState("");
  const {
    runWithSignal,
    isRunning: scanning,
  } = useGuardedAction<Blindspot[]>({
    onStart: () => {
      setStreamText("");
    },
    onSuccess: (parsed) => {
      setStreamText("");
      setBlindspots(parsed);
      safeSet("bookmarkforge_blindspots", JSON.stringify(parsed));
    },
    onError: () => {
      setStreamText("");
      setBlindspots([]);
    },
  });

  const handleScan = () => {
    void runWithSignal(async (signal) => {
      const { agentService } = await import("../../services/ai/AgentService");
      const prompt = `Analyze these bookmark titles and identify 3-5 knowledge blindspots — important topics that are missing or underrepresented. Return a JSON array of objects with keys: topic, reason, suggestion.\n\nTitles:\n${bookmarkTitles.join("\n")}`;
      // Stream raw tokens live while the structured JSON is generated.
      const res = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => {
          if (!signal.aborted) {
            setStreamText((prev) => prev + chunk);
          }
        },
        undefined,
        undefined,
        signal,
      );
      const parsed = parseFencedJson<Blindspot[]>(res.text);
      return parsed;
    });
  };

  return (
    <motion.div
      variants={cardVariants}
      className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
    >
      <div className="flex items-center gap-5 mb-8">
        <div className="p-4 rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero text-white">
          <Lightbulb className="size-7" />
        </div>
        <div>
          <h2 className="ds-h2 truncate">
            {t("app_blindspotDetection", "Blindspot Detection")}
          </h2>
          <p className="ds-label-section mt-1 ds-text-muted">
            {t("app_blindspotSubtitle", "AI-detected knowledge gaps")}
          </p>
        </div>
      </div>

      <button
        onClick={handleScan}
        disabled={scanning}
        className="truncate flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 mb-6"
      >
        {scanning ? (
          <Sparkles className="size-4 animate-pulse" />
        ) : (
          <Compass className="size-4" />
        )}
        {scanning
          ? t("app_scanning", "Scanning...")
          : t("app_scanForBlindspots", "Scan for Blindspots")}
      </button>

      {scanning && <StreamPreview text={streamText} />}

      <div className="space-y-4">
        {blindspots.map((b, i) => (
          <div
            key={i}
            className="p-5 rounded-2xl ds-bg-card ds-border hover:shadow-lg transition-all"
          >
            <h3 className="font-bold text-sm ds-text-primary mb-2 truncate">
              {b.topic}
            </h3>
            <p className="text-xs ds-text-secondary mb-2 leading-relaxed">
              {b.reason}
            </p>
            <div className="flex items-start gap-2 text-xs font-semibold ds-text-accent">
              <Compass className="size-3.5 mt-0.5 shrink-0" />
              <span>{b.suggestion}</span>
            </div>
          </div>
        ))}
        {blindspots.length === 0 && !scanning && (
          <p className="text-xs ds-text-muted text-center py-6">
            {t(
              "app_noBlindspots",
              "Press scan to discover knowledge blindspots",
            )}
          </p>
        )}
      </div>
    </motion.div>
  );
};
