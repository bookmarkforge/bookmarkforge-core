import { useSyncExternalStore } from "react";
import {
  getMigrationProgress,
  subscribeMigrationProgress,
  type VaultMigrationProgress,
} from "../db/migration-progress";

/**
 * React binding for the vault migration progress store
 * (src/db/migration-progress.ts). Re-renders whenever the RxDB migration
 * status updates (roughly once per migration batch, ~hundreds of ms).
 */
export function useMigrationProgress(): VaultMigrationProgress {
  return useSyncExternalStore(
    subscribeMigrationProgress,
    getMigrationProgress,
  );
}
