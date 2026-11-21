/**
 * React-facing seam for the RxDB migration progress store (AF-07, 2026-11-02 audit).
 *
 * `src/db/migration-progress.ts` owns the singleton pub/sub state; the db
 * layer writes it during schema migrations. Hooks must not import the db
 * layer directly (AGENTS §5: data access goes through `src/services/*`),
 * so the reader API is re-exported here through the service seam — the
 * same single-sanctioned-entry-point pattern as src/container/database.ts.
 * Value imports only: the `VaultMigrationProgress` type crosses layers as
 * a type-only import (exempt from the layer gate by construction).
 */

export {
  getMigrationProgress,
  subscribeMigrationProgress,
} from "../db/migration-progress";
