/**
 * src/services/ai/spaced-repetition.ts — the SM-2 scheduling math, extracted.
 *
 * Why this exists: `FlashcardService` is Pro (generation), but reviewing the
 * flashcards a user already has must never depend on a Pro license — a Free
 * user (or an Open Core build where the Pro chunk is absent) keeps a working
 * review experience. The scheduling algorithm is pure math (SM-2, no I/O, no
 * model calls), so it lives in Core and both sides import it from here.
 * `FlashcardService.calculateNextReview` delegates to this function; the
 * behaviour is byte-for-byte the original implementation.
 */

export interface NextReviewState {
  nextReview: string;
  interval: number;
  easeFactor: number;
  repetition: number;
}

/**
 * Advance an SM-2 schedule given the recalled quality (0–5).
 * Pure: no state read — everything comes in as arguments.
 */
export function calculateNextReview(
  quality: number,
  interval: number,
  easeFactor: number,
  repetition: number,
): NextReviewState {
  let nextInterval: number;
  let nextEaseFactor: number;
  let nextRepetition: number;

  if (quality >= 3) {
    if (repetition === 0) {
      nextInterval = 1;
    } else if (repetition === 1) {
      nextInterval = 6;
    } else {
      nextInterval = Math.round(interval * easeFactor);
    }
    nextRepetition = repetition + 1;
    nextEaseFactor =
      easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  } else {
    nextInterval = 1;
    nextRepetition = 0;
    nextEaseFactor = easeFactor;
  }

  if (nextEaseFactor < 1.3) {
    nextEaseFactor = 1.3;
  }

  const nextReviewDate = new Date();
  nextReviewDate.setDate(nextReviewDate.getDate() + nextInterval);

  return {
    nextReview: nextReviewDate.toISOString(),
    interval: nextInterval,
    easeFactor: nextEaseFactor,
    repetition: nextRepetition,
  };
}
