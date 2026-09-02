import type { BookmarkDocType } from "../../db/schema";
import type { BookmarkForgeDB } from "../../db/types";
import type { RxDocument } from "rxdb";
import { useState } from "react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { motion, AnimatePresence, type Variants } from "motion/react";
import {
  Brain,
  CheckCircle,
  XCircle,
  Sparkles,
  RefreshCw,
  Star,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  boundedBookmarkQuery,
  MAX_SELECT_ITEMS,
} from "../../utils/knowledgeCardBounds";
import { generateWithPrivacy } from "../../services/ai/privacy";
import { parseFencedJson } from "../../utils/jsonFenceStripper";

interface Props {
  cardVariants: Variants;
}

export const QuizGenerator: React.FC<Props> = ({ cardVariants }) => {
  const { t: translate } = useTranslation();

  const [bookmarks, setBookmarks] = useState<BookmarkDocType[]>([]);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(
    null,
  );
  const [quiz, setQuiz] = useState<{
    questions: { question: string; options: string[]; correctIndex: number }[];
  } | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const {
    loading: _bookmarksLoading,
  } = useGuardedDataLoad<BookmarkDocType[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const docs = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_SELECT_ITEMS,
        { isDeleted: false, isPrivate: false },
      ).exec();
      if (signal.aborted) {return [];}
      return docs.map(
        (d: RxDocument<BookmarkDocType>) =>
          d.toJSON() as unknown as BookmarkDocType,
      );
    },
    {
      onSuccess: (bookmarks) => setBookmarks(bookmarks),
      onError: () => setBookmarks([]),
    },
  );
  const {
    runWithSignal: runGenerate,
    isRunning: generating,
    cancel: cancelGenerate,
  } = useGuardedAction<{
    questions: { question: string; options: string[]; correctIndex: number }[];
  }>({
    blockReentry: false,
    onSuccess: (quiz) => {
      setQuiz(quiz);
      setAnswers(new Array(quiz.questions.length).fill(-1));
    },
    onError: (error) => {
      // AbortError is dropped by the guard; plain failures clear the quiz.
      if (!(error instanceof Error && error.name === "AbortError")) {
        setQuiz(null);
      }
    },
  });

  const resetQuiz = () => {
    setQuiz(null);
    setAnswers([]);
    setSubmitted(false);
    setScore(0);
  };

  const handleBookmarkChange = (bookmarkId: string | null) => {
    cancelGenerate();
    setSelectedBookmarkId(bookmarkId);
    resetQuiz();
  };

  const handleGenerate = () => {
    if (!selectedBookmarkId) {return;}
    const bookmark = bookmarks.find((b) => b.id === selectedBookmarkId);
    if (!bookmark) {return;}
    resetQuiz();
    void runGenerate(async (signal) => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      if (signal.aborted) {throw new DOMException("Quiz request aborted", "AbortError");}
      const prompt = `Generate a 5-question multiple choice quiz based on this content. Each question must have 4 options with exactly one correct. Return JSON: {questions: [{question: string, options: string[], correctIndex: number}]}. Content: ${bookmark.title}\n\n${(bookmark.content || "").slice(0, 3000)}`;
      const res = await generateWithPrivacy(
        aiManager,
        bookmark,
        prompt,
        undefined,
        { signal },
      );
      if (signal.aborted) {throw new DOMException("Quiz request aborted", "AbortError");}
      return parseFencedJson<{ questions: { question: string; options: string[]; correctIndex: number }[] }>(res.text);
    });
  };

  const handleAnswer = (qIndex: number, optIndex: number) => {
    if (submitted) {return;}
    setAnswers((prev) => {
      const next = [...prev];
      next[qIndex] = optIndex;
      return next;
    });
  };

  const handleSubmit = () => {
    if (!quiz) {return;}
    let correct = 0;
    quiz.questions.forEach((q, i) => {
      if (answers[i] === q.correctIndex) {correct++;}
    });
    setScore(correct);
    setSubmitted(true);
  };

  const handleRetry = () => {
    cancelGenerate();
    resetQuiz();
  };

  const percentage = quiz
    ? Math.round((score / quiz.questions.length) * 100)
    : 0;

  const renderScoreIcon = () => {
    if (percentage > 90) {return <Star className="size-12 text-yellow-500" />;}
    if (percentage > 70)
      {return <CheckCircle className="size-12 text-green-500" />;}
    if (percentage < 40) {return <XCircle className="size-12 text-red-500" />;}
    return <CheckCircle className="size-12 text-blue-500" />;
  };

  return (
    <motion.div variants={cardVariants} className="bento-item p-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl ds-bg-accent-soft ds-text-accent">
          <Brain className="size-5" />
        </div>
        <h3 className="font-semibold text-sm ds-text-primary">
          {translate("app_quizGenerator", "Quiz Generator")}
        </h3>
      </div>

      <div className="flex items-end gap-3 mb-6">
        <select
          value={selectedBookmarkId || ""}
          onChange={(e) => handleBookmarkChange(e.target.value || null)}
          aria-label={translate("app_selectBookmark", "Select a bookmark")}
          className="flex-1 p-3 rounded-xl text-xs font-medium ds-bg-card ds-border ds-text-primary"
        >
          <option value="">
            {translate("app_selectBookmark", "Select a bookmark...")}
          </option>
          {bookmarks.map((bm) => (
            <option key={bm.id} value={bm.id}>
              {bm.title}
            </option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={!selectedBookmarkId || generating}
          className="truncate flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
        >
          {generating ? (
            <Sparkles className="size-4 animate-spin" />
          ) : (
            <Brain className="size-4" />
          )}
          {generating
            ? translate("app_generating", "Generating...")
            : translate("app_generateQuiz", "Generate Quiz")}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {quiz && (
          <motion.div
            key="quiz"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {quiz.questions.map((q, qIdx) => (
              <div
                key={qIdx}
                className="p-5 rounded-2xl mb-4 ds-bg-card ds-border"
              >
                <p className="text-sm font-semibold ds-text-primary mb-4">
                  {qIdx + 1}. {q.question}
                </p>
                <div className="space-y-2">
                  {q.options.map((opt, oIdx) => {
                    const isSelected = answers[qIdx] === oIdx;
                    const isCorrect = submitted && oIdx === q.correctIndex;
                    const isWrong =
                      submitted && isSelected && oIdx !== q.correctIndex;
                    return (
                      <div
                        key={oIdx}
                        onClick={() => handleAnswer(qIdx, oIdx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            {handleAnswer(qIdx, oIdx);}
                        }}
                        role="radio"
                        aria-checked={answers[qIdx] === oIdx}
                        tabIndex={0}
                        className={`flex items-center gap-3 p-3 rounded-xl mb-2 cursor-pointer transition-all ${
                          isSelected && !submitted
                            ? "ds-bg-accent-primary ds-text-on-accent"
                            : "hover:bg-accent-soft ds-bg-card"
                        } ${
                          isCorrect
                            ? "ring-2 ring-green-500 bg-green-50 dark:bg-green-900/20"
                            : ""
                        } ${
                          isWrong
                            ? "ring-2 ring-red-500 bg-red-50 dark:bg-red-900/20"
                            : ""
                        }`}
                      >
                        <span className="size-4 rounded-full border-2 flex items-center justify-center shrink-0 ds-border-muted">
                          {isSelected && !submitted && (
                            <span className="size-2 rounded-full ds-bg-accent-primary" />
                          )}
                          {submitted && isCorrect && (
                            <CheckCircle className="size-4 text-green-500" />
                          )}
                          {submitted && isWrong && (
                            <XCircle className="size-4 text-red-500" />
                          )}
                        </span>
                        <span className="text-xs ds-text-primary">{opt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {!submitted ? (
              <button
                onClick={handleSubmit}
                disabled={answers.includes(-1)}
                className="truncate flex items-center gap-2 px-6 py-3 bg-green-500 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 mx-auto"
              >
                <CheckCircle className="size-4" />
                {translate("app_submitAnswers", "Submit Answers")}
              </button>
            ) : (
              <div className="text-center py-6">
                <div className="flex items-center justify-center gap-4 mb-4">
                  {renderScoreIcon()}
                  <div>
                    <span className="text-4xl font-bold ds-text-primary">
                      {score}/{quiz.questions.length}
                    </span>
                    <span className="text-lg ds-text-muted ms-2">
                      ({percentage}%)
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleRetry}
                  className="truncate flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all mx-auto"
                >
                  <RefreshCw className="size-4" />
                  {translate("app_retry", "Retry")}
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!quiz && !generating && (
        <p className="text-xs ds-text-muted text-center py-6">
          {translate(
            "app_selectToGenerate",
            "Select a bookmark and generate a quiz",
          )}
        </p>
      )}
    </motion.div>
  );
};
