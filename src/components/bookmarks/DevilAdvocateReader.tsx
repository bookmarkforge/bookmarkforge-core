import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Zap, Sparkles, X, Check, MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { logger } from "../../utils/logger";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { generateWithPrivacy } from "../../services/ai/privacy";

interface Props {
  content: string;
  isPrivate?: boolean;
  title: string;
}

export const DevilAdvocateReader: React.FC<Props> = ({
  content,
  // Missing privacy metadata fails closed to the local provider.
  isPrivate = true,
  title: _title,
}) => {
  useTranslation();
  const [isActive, setIsActive] = useState(false);
  const [counterArguments, setCounterArguments] = useState<
    { paragraph: string; counter: string }[]
  >([]);
  const [selectedParagraph, setSelectedParagraph] = useState<string | null>(
    null,
  );
  const [challengeProgress, setChallengeProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  // Per-paragraph challenge; the operation returns {paragraph, text} so
  // onSuccess can append to the conversation for the paragraph that was
  // clicked at call time (not a later render's selection).
  const {
    runWithSignal,
    isRunning: isGenerating,
    cancel,
  } = useGuardedAction<{ paragraph: string; text: string }>({
    onSuccess: ({ paragraph, text }) => {
      setCounterArguments((prev) => [
        ...prev,
        { paragraph, counter: text },
      ]);
      setSelectedParagraph(paragraph);
    },
    onError: (error) => {
      if (error instanceof Error && error.name === "AbortError") {return;}
      logger.error("Failed to generate counter-argument");
    },
  });

  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const isChallenged = (paragraph: string) =>
    counterArguments.some((ca) => ca.paragraph === paragraph);

  const getCounter = (paragraph: string) =>
    counterArguments.find((ca) => ca.paragraph === paragraph)?.counter;

  const challengeParagraph = (paragraph: string) => {
    if (isChallenged(paragraph)) {
      setSelectedParagraph(selectedParagraph === paragraph ? null : paragraph);
      return undefined;
    }
    // Return the promise so challengeAll can await each paragraph
    // sequentially (each completes before the next begins, exactly like the
    // original await-chained calls).
    return runWithSignal(async (signal) => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const counter = await generateWithPrivacy(
        aiManager,
        { isPrivate },
        `Generate a thoughtful counter-argument to this statement. Be respectful and constructive. Provide an alternative perspective with reasoning:\n\n${paragraph}`,
        undefined,
        { signal },
      );
      return { paragraph, text: counter.text };
    });
  };

  const challengeAll = async () => {
    const unchallenged = paragraphs.filter((p) => !isChallenged(p));
    if (unchallenged.length === 0) {return;}
    setChallengeProgress({ current: 0, total: unchallenged.length });
    for (let i = 0; i < unchallenged.length; i++) {
      if (!activeRef.current) {break;}
      setChallengeProgress({ current: i + 1, total: unchallenged.length });
      const p = unchallenged[i];
      if (p) {await challengeParagraph(p);}
    }
    if (activeRef.current) {
      setChallengeProgress(null);
    }
  };

  const dismissCounter = (paragraph: string) => {
    setCounterArguments((prev) =>
      prev.filter((ca) => ca.paragraph !== paragraph),
    );
    if (selectedParagraph === paragraph) {setSelectedParagraph(null);}
  };

  useEffect(() => {
    if (!isActive) {
      // cancel resets the isGenerating flag too (the fixed cancel), so the
      // manual setIsGenerating(false) of the original is covered.
      cancel();
      setCounterArguments([]);
      setSelectedParagraph(null);
      setChallengeProgress(null);
    }
  }, [cancel, isActive]);

  useEffect(() => {
    cancel();
    setCounterArguments([]);
    setSelectedParagraph(null);
    setChallengeProgress(null);
  }, [cancel, content]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsActive((v) => !v)}
        className="fixed bottom-4 right-4 z-50 ds-bg-accent-primary rounded-full p-3 shadow-2xl hover:opacity-90 transition-opacity"
        title={
          isActive ? "Disable Devil's Advocate" : "Enable Devil's Advocate"
        }
        aria-label={
          isActive
            ? "Disable Devil's Advocate"
            : "Enable Devil's Advocate"
        }
      >
        <Zap className="w-5 h-5 text-white" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {isActive && (
          <motion.div
            ref={panelRef}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-sm ds-bg-card shadow-2xl z-40 overflow-y-auto"
          >
            <div className="sticky top-0 ds-bg-card border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="font-semibold text-sm">
                  Devil&apos;s Advocate
                </span>
              </div>
              <div className="flex items-center gap-2">
                {paragraphs.length > 0 && (
                  <button
                    type="button"
                    onClick={challengeAll}
                    disabled={isGenerating}
                    aria-label={
                      challengeProgress
                        ? `Challenging ${challengeProgress.current} of ${challengeProgress.total}`
                        : "Challenge all paragraphs"
                    }
                    className="truncate text-xs ds-bg-accent-primary text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {challengeProgress
                      ? `Challenging ${challengeProgress.current}/${challengeProgress.total}`
                      : "Challenge All"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsActive(false)}
                  className="p-1 hover:ds-bg-card-hover rounded-lg transition-colors"
                  aria-label="Close Devil's Advocate panel"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-6">
              {paragraphs.map((paragraph, idx) => (
                <div key={idx}>
                  <div
                    className={`relative ${
                      isChallenged(paragraph)
                        ? "border-s-4 border-amber-400 ps-4"
                        : ""
                    }`}
                  >
                    <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                      {paragraph}
                    </p>
                    <button
                      type="button"
                      onClick={() => challengeParagraph(paragraph)}
                      disabled={isGenerating}
                      aria-label={`Challenge paragraph ${idx + 1}`}
                      className="mt-2 text-xs flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors disabled:opacity-50"
                    >
                      <Zap className="w-3 h-3" aria-hidden="true" />
                      Challenge
                    </button>
                  </div>

                  <AnimatePresence>
                    {selectedParagraph === paragraph &&
                      getCounter(paragraph) && (
                        <motion.div
                          initial={{
                            opacity: 0,
                            height: 0,
                          }}
                          animate={{
                            opacity: 1,
                            height: "auto",
                          }}
                          exit={{
                            opacity: 0,
                            height: 0,
                          }}
                          transition={{ duration: 0.25 }}
                          className="mt-2 mb-4 overflow-hidden"
                        >
                          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                                Devil&apos;s Advocate
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                              {getCounter(paragraph)}
                            </p>
                            <div className="flex items-center gap-2 mt-3">
                              <button
                                type="button"
                                onClick={() => dismissCounter(paragraph)}
                                aria-label={`Agree with counter-argument for paragraph ${idx + 1}`}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                              >
                                <Check className="w-3 h-3" aria-hidden="true" />
                                Agree
                              </button>
                              <button
                                type="button"
                                aria-label={`Discuss counter-argument for paragraph ${idx + 1}`}
                                className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                              >
                                <MessageCircle className="w-3 h-3" aria-hidden="true" />
                                Discuss
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
