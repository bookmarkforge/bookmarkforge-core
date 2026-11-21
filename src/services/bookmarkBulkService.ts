/**
 * Data-access seam for bulk bookmark mutations (AF-07, 2026-11-02 audit).
 *
 * Hooks must not import the db layer directly (AGENTS §5: data access goes
 * through `src/services/*`). This thin delegate lets `useBookmarkCRUD`
 * run chunked patch batches through the service seam while the
 * implementation stays owned by the db layer (src/db/rxdb-optimized.ts) —
 * the same single-sanctioned-entry-point pattern as
 * src/container/database.ts, for a mutation instead of bootstrap.
 */

export { bulkUpdate } from "../db/rxdb-optimized";
