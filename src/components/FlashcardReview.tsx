import { useState, useEffect, useRef } from "react";
import {
  Brain,
  X,
  Check,
  ArrowRight,
  Sparkles,
  Loader2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { initDB } from "../container/database";
import { calculateNextReview } from "../services/ai/spaced-repetition";
import { useTranslation } from "react-i18next";
import type { FlashcardDocument } from "../db/types";
import { logger } from "../utils/logger";
import { toast } from "sonner";
import { useRequestGuard } from "../hooks/useRequestGuard";

interface FlashcardReviewProps {
  onClose: () => void;
}

const reviewInFlightByCard = new Map<string, Promise<void>>();

const FlashcardReview = ({ onClose }: FlashcardReviewProps) => {
  const { t } = useTranslation();
  const [cards, setCards] = useState<FlashcardDocument[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const reviewInFlightRef = useRef(false);
  const isMountedRef = useRef(true);
  const reviewTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Deliberate manual guard: the review flow is built on per-card promise
  // locks (reviewInFlightByCard), a 15s persistence race, and a shared
  // load/review generation — the useGuardedAction contract (single boolean
  // isRunning + terminal onSuccess/onError) cannot express per-card
  // synchronization, and the error path must advance the deck like success.
  const { begin, isCurrent, cancel } = useRequestGuard();

  useEffect(() => {
    isMountedRef.current = true;
    const request = begin();
    const fetchCards = async () => {
      if (!isMountedRef.current || !isCurrent(request.generation)) {return;}
      setIsLoading(true);
      try {
        const db = await initDB();
        const now = new Date().toISOString();
        const dueCards = await db.flashcards
          .find({
            selector: {
              nextReview: { $lte: now },
            },
            sort: [{ nextReview: "asc" }],
          })
          .exec();
        if (isMountedRef.current && isCurrent(request.generation)) {
          setCards(dueCards);
        }
      } catch (error) {
        if (isMountedRef.current && isCurrent(request.generation)) {
          logger.error("Failed to fetch flashcards:", error);
        }
      } finally {
        if (isMountedRef.current && isCurrent(request.generation)) {
          setIsLoading(false);
        }
      }
    };
    void fetchCards();
    return () => {
      isMountedRef.current = false;
      cancel();
      reviewTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      reviewTimersRef.current.clear();
    };
  }, [begin, cancel, isCurrent]);

  const handleReview = async (quality: number) => {
    // Ignore duplicate ratings while the current card is being persisted.
    // Without this guard, two rapid clicks can advance the functional state
    // updater twice and skip the next card.
    if (reviewInFlightRef.current) {return;}
    reviewInFlightRef.current = true;
    const request = begin();

    const card = cards[currentIndex]!;
    const previousReview = reviewInFlightByCard.get(card.id);
    let releaseReviewLock!: () => void;
    const reviewLock = new Promise<void>((resolve) => {
      releaseReviewLock = resolve;
    });
    reviewInFlightByCard.set(card.id, reviewLock);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const reviewOperation = (async () => {
      let persistenceStarted = false;
      try {
        // A second review surface may have loaded the same card. Wait for the
        // first write, then re-read it so the second rating builds on fresh data.
        await previousReview?.catch(() => undefined);
        if (!isCurrent(request.generation)) {return;}
        const db = await initDB();
        if (!isCurrent(request.generation)) {return;}
        const findOne = (
          db.flashcards as unknown as {
            findOne?: (id: string) => {
              exec: () => Promise<FlashcardDocument | null>;
            };
          }
        ).findOne;
        const persistedCard = findOne ? await findOne(card.id).exec() : null;
        if (!isCurrent(request.generation)) {return;}
        const cardToReview = persistedCard ?? card;
        const { nextReview, interval, easeFactor, repetition } =
          calculateNextReview(
            quality,
            cardToReview.interval,
            cardToReview.easeFactor,
            cardToReview.repetition,
          );
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Flashcard update timeout")),
            15000,
          );
          reviewTimersRef.current.add(timeoutId);
        });
        if (!isCurrent(request.generation)) {return;}
        const persistence = db.flashcards.upsert({
          ...cardToReview.toJSON(),
          nextReview,
          interval,
          easeFactor,
          repetition,
        });
        persistenceStarted = true;
        persistence.then(releaseReviewLock, releaseReviewLock);
        await Promise.race([persistence, timeoutPromise]);
      } finally {
        // Keep the per-card lock until the underlying write settles, even if
        // the UI timeout fires first. This prevents a late write from racing
        // with the next review of the same card.
        if (!persistenceStarted) {
          releaseReviewLock();
        }
      }
    })();
    reviewLock.then(() => {
      if (reviewInFlightByCard.get(card.id) === reviewLock) {
        reviewInFlightByCard.delete(card.id);
      }
    });

    try {
      await reviewOperation;
      if (!isMountedRef.current || !isCurrent(request.generation)) {return;}
      if (currentIndex < cards.length - 1) {
        setCurrentIndex((prev) => prev + 1);
        setShowAnswer(false);
      } else {
        setIsFinishing(true);
      }
    } catch (error) {
      if (!isMountedRef.current || !isCurrent(request.generation)) {return;}
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === "Flashcard update timeout") {
        logger.error("Flashcard update timeout:", error);
      } else {
        logger.error("Failed to update flashcard:", error);
      }
      toast.error(
        t("flashcardUpdateError", "Could not save the card. Continue."),
      );
      if (currentIndex < cards.length - 1) {
        setCurrentIndex((prev) => prev + 1);
        setShowAnswer(false);
      } else {
        setIsFinishing(true);
      }
    } finally {
      // P89: clear the race timer so it does not fire after the upsert
      // already settled (one leaked 15s timer per review otherwise).
      if (timeoutId) {
        clearTimeout(timeoutId);
        reviewTimersRef.current.delete(timeoutId);
        timeoutId = null;
      }
      reviewInFlightRef.current = false;
    }
  };

  const handleClose = () => {
    cancel();
    reviewTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    reviewTimersRef.current.clear();
    onClose();
  };

  if (isLoading) {
    return (
      <div className="ds-modal-overlay z-[100]">
        <div className="flex flex-col items-center gap-4 ds-text-primary">
          <Loader2 className="size-12 animate-spin ds-text-accent" />
          <p className="text-lg font-medium animate-pulse">
            {t("loadingFlashcards")}
          </p>
        </div>
      </div>
    );
  }

  if (isFinishing || (cards.length === 0 && !isLoading)) {
    // Distinguish "all done" (isFinishing) from "no cards at all" (cards.length === 0).
    const isFinished = isFinishing || cards.length > 0;
    return (
      <div className="ds-modal-overlay z-[100] animate-in fade-in duration-300">
        <div className="w-full max-w-md p-8 shadow-2xl text-center space-y-6 ds-card">
          <div className={`size-20 rounded-full flex items-center justify-center mx-auto ${isFinished ? "ds-bg-success-soft" : "ds-bg-secondary"}`}>
            {isFinished ? (
              <Check className="size-10 ds-text-success" />
            ) : (
              <Sparkles className="size-10 ds-text-accent" />
            )}
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold line-clamp-2">
              {isFinished
                ? t("sessionCompleted")
                : t("app_noFlashcardsYet", "No flashcards yet")}
            </h2>
            <p className="text-sm ds-text-secondary">
              {isFinished
                ? t("sessionCompletedDesc")
                : t(
                    "app_noFlashcardsHint",
                    "Generate flashcards from any document using the AI Copilot. Open a document and click 'Generate Flashcards' to get started.",
                  )}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="truncate w-full text-white font-bold py-3 transition-all shadow-lg ds-radius-button ds-bg-success"
          >
            {isFinished ? t("backToDashboard") : t("app_goToEditor", "Open Editor")}
          </button>
        </div>
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  return (
    <div className="ds-modal-overlay z-[100] animate-in fade-in duration-300">
      <div className="w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col min-h-[500px] ds-card">
        <div className="flex items-center justify-between px-6 py-4 ds-topbar">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md ds-bg-accent-soft">
              <Brain className="size-5 ds-text-accent" />
            </div>
            <div>
              <h2 className="text-sm font-semibold ds-text-primary line-clamp-2">
                {t("spacedRepetition")}
              </h2>
              <p className="text-[10px] uppercase tracking-wider font-bold ds-text-muted">
                {t("card")} {currentIndex + 1} {t("of")} {cards.length}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 transition-colors rounded-full ds-ghost-btn-icon"
            aria-label={t("aria_close", "Close")}
          >
            <X className="size-5 ds-text-muted" />
          </button>
        </div>

        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center space-y-8">
          <div className="w-full space-y-4">
            <p className="text-xs uppercase font-bold tracking-widest ds-text-muted">
              {t("question")}
            </p>
            <h3 className="text-2xl font-medium leading-tight ds-text-primary line-clamp-3">
              {currentCard!.question}
            </h3>
          </div>

          {showAnswer ? (
            <div className="w-full space-y-4 animate-in slide-in-from-bottom-4 duration-300">
              <div className="h-px w-1/2 mx-auto ds-bg-divider" />
              <p className="text-xs uppercase font-bold tracking-widest ds-text-muted">
                {t("answer")}
              </p>
              <p className="text-xl leading-relaxed ds-text-secondary">
                {currentCard!.answer}
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowAnswer(true)}
              className="truncate px-8 py-3 font-bold transition-all shadow-lg group ds-bg-secondary ds-text-primary border border-[var(--state-inactive-border)]"
            >
              {t("showAnswer")}
              <ArrowRight className="rtl-flip size-4 inline-block ms-2 group-hover:translate-x-1 transition-transform" />
            </button>
          )}
        </div>

        {showAnswer && (
          <div className="px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-3 animate-in fade-in duration-300 ds-topbar">
            <button
              onClick={() => handleReview(0)}
              className="truncate flex flex-col items-center gap-1 p-3 transition-all group ds-icon-tint-danger"
            >
              <RotateCcw className="size-5 ds-text-danger group-hover:rotate-180 transition-transform duration-500" />
              <span className="text-[10px] font-bold ds-text-danger uppercase">
                {t("forgotten")}
              </span>
            </button>
            <button
              onClick={() => handleReview(3)}
              className="truncate flex flex-col items-center gap-1 p-3 transition-all ds-radius-item ds-bg-orange-soft ds-border-orange-soft"
            >
              <AlertCircle className="size-5 ds-text-orange" />
              <span className="text-[10px] font-bold uppercase ds-text-orange">
                {t("hard")}
              </span>
            </button>
            <button
              onClick={() => handleReview(4)}
              className="truncate flex flex-col items-center gap-1 p-3 transition-all ds-radius-item ds-bg-blue-soft ds-border-blue-soft"
            >
              <Check className="size-5 ds-text-blue" />
              <span className="text-[10px] font-bold uppercase ds-text-blue">
                {t("good")}
              </span>
            </button>
            <button
              onClick={() => handleReview(5)}
              className="truncate flex flex-col items-center gap-1 p-3 transition-all ds-icon-tint-success"
            >
              <Sparkles className="size-5 ds-text-success" />
              <span className="text-[10px] font-bold uppercase ds-text-success">
                {t("easy")}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlashcardReview;
