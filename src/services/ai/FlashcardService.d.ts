/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/ai/FlashcardService.ts`. No implementation is present in this repository. */
export interface FlashcardDeduplicationReport {
    scanned: number;
    duplicateGroups: number;
    preserved: number;
    plannedRemovals: number;
    removed: number;
    failed: number;
}
export interface FlashcardDeduplicationOptions {
    dryRun?: boolean;
}
export declare class FlashcardService {
    private insertCards;
    private insertCardsExclusive;
    generateFlashcards(documentId: string, text: string, lang?: "en" | "es", isPrivate?: boolean, signal?: AbortSignal): Promise<number>;
    calculateNextReview(quality: number, interval: number, easeFactor: number, repetition: number): import("./spaced-repetition").NextReviewState;
    generateFromBookmark(bookmarkId: string, title: string, content: string, lang?: "en" | "es", isPrivate?: boolean, signal?: AbortSignal): Promise<number>;
    deduplicateHistoricalCards(options?: FlashcardDeduplicationOptions): Promise<FlashcardDeduplicationReport>;
    getStats(): Promise<{
        total: number;
        due: number;
        bySource: {
            documents: number;
            bookmarks: number;
        };
    }>;
}
export declare const flashcardService: FlashcardService;
