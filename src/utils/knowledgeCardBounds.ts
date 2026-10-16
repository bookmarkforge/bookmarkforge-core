import type { MangoQuery, RxCollection } from "rxdb";
import type { BookmarkDocType } from "../db/schema";

/**
 * Shared bounds for knowledge cards that load bookmarks into a <select>.
 *
 * These cards only need a pick-list of bookmarks (not a census). Loading
 * the whole collection (`find().exec()` over 100k+ docs) materializes every
 * RxDocument on the main thread AND renders an option per row — both freeze
 * the UI on large vaults. Sorting by updatedAt desc and capping the query
 * bounds both costs: the DB returns at most MAX_SELECT_ITEMS recent rows
 * (index-backed), and the DOM renders at most that many <option>s.
 */
export const MAX_SELECT_ITEMS = 500;

/**
 * Maximum recent bookmarks materialized by knowledge cards that need a
 * bounded vault sample. The query remains index-friendly and deterministic;
 * cards using this cap must treat their result as a representative sample,
 * not a complete vault census.
 */
export const MAX_KNOWLEDGE_SCAN_ITEMS = 2_000;

/**
 * Cap on bookmark titles injected into an AI prompt (AISommelier). The
 * original code joined every loaded title into the prompt — with a large
 * vault that is an unbounded token blast at the provider.
 */
export const MAX_PROMPT_TITLES = 300;

/**
 * Maximum bookmark entries included in generated AI source material. This
 * bounds prompt size even when a tag/topic matches a large vault segment.
 */
export const MAX_AI_SOURCE_ITEMS = 300;

/**
 * Build the canonical bounded bookmark query used by dashboard cards and
 * bookmark selectors elsewhere in the app. `updatedAt` is indexed, and the
 * stable query shape prevents callers from accidentally materializing the
 * whole vault before applying a UI limit.
 */
export function boundedBookmarkQuery(
  collection: RxCollection<BookmarkDocType>,
  limit: number = MAX_SELECT_ITEMS,
  selector?: MangoQuery<BookmarkDocType>["selector"],
) {
  const query =
    selector === undefined
      ? collection.find()
      : collection.find({ selector });
  return query.sort({ updatedAt: "desc" }).limit(limit);
}
