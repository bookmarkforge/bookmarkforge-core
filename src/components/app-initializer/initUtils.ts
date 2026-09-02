import { destroyDB, initDB } from "../../container/database";
import { secureStorage } from "../../services/SecureStorage";
import { safeClear, safeGet, safeSessionClear } from "../../store/safeStorage";
import { logger } from "../../utils/logger";
import { STORAGE_KEYS } from "../../constants/storage-keys";

export async function destroyAllDatabases(
  context: "reset" | "retry" = "reset",
) {
  try {
    await destroyDB();
  } catch (_e: unknown) {
    if (context === "retry") {
      logger.warn("[Demo retry] destroyDB failed", {
        error: _e instanceof Error ? _e.message : String(_e),
      });
    } else {
      logger.error("[AppInitializer] Error destroying DB during reset", {
        error: _e instanceof Error ? (_e as Error).message : String(_e),
      });
    }
  }

  try {
    await secureStorage.clearAll();
    await secureStorage.close();
  } catch (_e2: unknown) {
    if (context === "retry") {
      logger.warn("[Demo retry] secureStorage clear failed", {
        error: _e2 instanceof Error ? _e2.message : String(_e2),
      });
    } else {
      logger.error(
        "[AppInitializer] Error clearing secureStorage during reset",
        { error: _e2 instanceof Error ? (_e2 as Error).message : String(_e2) },
      );
    }
  }

  safeClear();
  safeSessionClear();

  if (indexedDB.databases) {
    try {
      const dbs = await indexedDB.databases();
      const deletePromises = dbs.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (db.name) {
              const req = indexedDB.deleteDatabase(db.name);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            } else {
              resolve();
            }
          }),
      );
      await Promise.all(deletePromises);
    } catch (e) {
      logger.warn(
        "[AppInitializer] Failed to delete IndexedDB dbs during reset",
        { error: e },
      );
    }
  }
}

export async function initDemoDatabase(password: string) {
  try {
    await initDB(password);
  } catch (dbErr: unknown) {
    let errStr = String(dbErr);
    if (dbErr !== null) {
      const errObj = dbErr as Record<string, unknown>;
      if (typeof errObj.message === "string") {errStr = errObj.message;}
      else if (typeof errObj.code === "string") {errStr = errObj.code;}
    }
    if (
      errStr.includes("DB1") ||
      errStr.includes("password") ||
      errStr.includes("adapter")
    ) {
      // DANGER: this branch used to destroy the database on ANY password or
      // adapter failure. A real user landing on ?demo=true (or a transient
      // storage/adapter error) would have their whole encrypted vault wiped
      // without confirmation. Destroy-and-retry is only safe when the
      // existing database is demo-owned — evidenced by the demo vault seed
      // having run in a previous session. In every other case the demo boot
      // fails closed: the app stays on the lock screen and the user can
      // unlock with their real password.
      const demoOwned =
        safeGet(STORAGE_KEYS.DEMO_VAULT_CREATED) === "true";
      if (!demoOwned) {
        logger.warn(
          "[AppInitializer] Demo boot rejected by an existing non-demo vault; refusing to destroy user data.",
        );
        return;
      }
      logger.warn(
        "[AppInitializer] Demo vault password mismatch. Destroying demo-owned database and retrying.",
      );
      await destroyAllDatabases("retry");
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      await initDB(password);
    } else {
      throw dbErr;
    }
  }
}
