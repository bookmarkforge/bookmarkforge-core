/**
 * Database bootstrap gate (component -> db rule).
 *
 * UI components must import `initDB` / `destroyDB` from here instead of
 * from `src/db/*` directly. This is a leaf re-export — it exists purely to
 * give the layer gate (scripts/check-context-boundaries.cjs, rule
 * `components -> db`) a single sanctioned entry point, so the dependency
 * graph of the bundle is unchanged and the db layer stays owned by
 * services / the container.
 *
 * Queries and mutations still go through `src/services/*`; this module only
 * covers lifecycle bootstrap (create/destroy the RxDB instance).
 */
export {
  initDB,
  destroyDB,
  getDB,
  // Classified-error guards used by UI error mapping. They are runtime
  // functions (not types), so they cross the layer boundary through the
  // same sanctioned gate as bootstrap.
  isInvalidDbPasswordError,
  isDbInaccessibleError,
  isVaultLockedError,
} from "../db/database";