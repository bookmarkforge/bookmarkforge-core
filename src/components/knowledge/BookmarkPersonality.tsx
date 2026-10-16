import { useEffect, useRef, useState } from "react";
import { motion, type Variants } from "motion/react";
import { Brain, UserCheck, Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { safeGet, safeSet } from "../../store/safeStorage";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { StreamPreview } from "./StreamPreview";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { logRateLimited } from "../../utils/boundedLog";

interface Personality {
  type: string;
  description: string;
  topInterests: string[];
  bias: string;
  gap: string;
}

interface Props {
  bookmarkTitles: string[];
  cardVariants: Variants;
}

export const BookmarkPersonality: React.FC<Props> = ({
  bookmarkTitles,
  cardVariants,
}) => {
  const { t } = useTranslation();
  const [personality, setPersonality] = useState<Personality | null>(() => {
    try {
      const saved = safeGet("bookmarkforge_personality");
      return saved ? JSON.parse(saved) : null;
    } catch {
      logRateLimited(
        "warn",
        "personality-cache-parse",
        "Stored bookmark personality is corrupted; starting empty",
      );
      return null;
    }
  });
  const [streamText, setStreamText] = useState("");
  const {
    runWithSignal,
    cancel,
    isRunning: analyzing,
  } = useGuardedAction<Personality | null>({
    onStart: () => {
      setStreamText("");
    },
    onSuccess: (parsed) => {
      setStreamText("");
      setPersonality(parsed);
      safeSet("bookmarkforge_personality", JSON.stringify(parsed));
    },
    onError: () => {
      setStreamText("");
      setPersonality(null);
    },
  });
  const bookmarkTitlesKey = bookmarkTitles.join("\u0000");
  const previousTitlesKey = useRef(bookmarkTitlesKey);

  useEffect(() => {
    if (previousTitlesKey.current === bookmarkTitlesKey) {return;}
    previousTitlesKey.current = bookmarkTitlesKey;
    cancel();
    setStreamText("");
    setPersonality(null);
  }, [bookmarkTitlesKey, cancel]);

  const handleAnalyze = () => {
    void runWithSignal(async (signal) => {
      const { agentService } = await import("../../services/ai/AgentService");
      const prompt = `Analyze these bookmark titles and generate an intellectual personality profile. Return a JSON object with keys: type (a creative label like 'The Explorer', 'The Specialist', 'The Polymath', etc.), description (2-3 sentences), topInterests (array of 3-5 interest areas), bias (one-sided intellectual tendency), gap (missing perspective or area to explore).\n\nTitles:\n${bookmarkTitles.join("\n")}`;
      // Stream raw tokens live while the personality JSON is generated.
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
      const parsed = parseFencedJson<Personality>(res.text);
      return parsed;
    });
  };

  return (
    <motion.div
      variants={cardVariants}
      className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card col-span-1"
    >
      <div className="flex items-center gap-5 mb-8">
        <div className="p-4 rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero text-white">
          <Brain className="size-7" />
        </div>
        <div>
          <h2 className="ds-h2 truncate">
            {t("app_bookmarkPersonality", "Bookmark Personality")}
          </h2>
          <p className="ds-label-section mt-1 ds-text-muted">
            {t("app_personalitySubtitle", "Your intellectual fingerprint")}
          </p>
        </div>
      </div>

      {analyzing && <StreamPreview text={streamText} />}

      {!personality && (
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="p-3 rounded-full ds-bg-muted mb-4">
            <UserCheck className="size-6 ds-text-muted" />
          </div>
          <p className="text-xs ds-text-muted mb-4 max-w-[220px]">
            {t(
              "app_noPersonalityYet",
              "Analyze your library to discover your intellectual personality",
            )}
          </p>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="truncate flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
          >
            {analyzing ? (
              <Brain className="size-4 animate-pulse" />
            ) : (
              <Compass className="size-4" />
            )}
            {analyzing
              ? t("app_analyzing", "Analyzing...")
              : t("app_analyzeMyLibrary", "Analyze My Library")}
          </button>
        </div>
      )}

      {personality && (
        <div className="space-y-5">
          <div className="p-5 rounded-2xl ds-bg-accent-soft ds-border-accent">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl">
                {personality.type.includes("Explorer")
                  ? "\uD83D\uDED4"
                  : personality.type.includes("Specialist")
                    ? "\uD83D\uDD0D"
                    : personality.type.includes("Polymath")
                      ? "\uD83E\uDDE0"
                      : "\uD83C\uDF93"}
              </span>
              <h3 className="font-extrabold text-base ds-text-primary truncate">
                {personality.type}
              </h3>
            </div>
            <p className="text-xs ds-text-secondary leading-relaxed">
              {personality.description}
            </p>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest ds-text-muted mb-3">
              {t("app_topInterests", "Top Interests")}
            </p>
            <div className="flex flex-wrap gap-2">
              {personality.topInterests.map((interest, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 rounded-full text-[11px] font-semibold ds-bg-accent-soft ds-text-accent ds-border-accent-glow"
                >
                  {interest}
                </span>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-2xl ds-bg-warning-soft ds-border-warning">
            <p className="text-[10px] font-bold uppercase tracking-widest ds-text-warning mb-1">
              {t("app_biasNote", "Bias Note")}
            </p>
            <p className="text-xs ds-text-secondary">{personality.bias}</p>
          </div>

          <div className="p-4 rounded-2xl ds-bg-success-soft ds-border-success">
            <p className="text-[10px] font-bold uppercase tracking-widest ds-text-success mb-1">
              {t("app_gapSuggestion", "Gap to Explore")}
            </p>
            <p className="text-xs ds-text-secondary">{personality.gap}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
};
