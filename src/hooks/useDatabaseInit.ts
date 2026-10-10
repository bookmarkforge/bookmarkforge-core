import { useState, useEffect, useRef, useCallback } from "react";
import type { RxDatabase } from "rxdb";
import type { DbErrorClass } from "../db/database";
import { logger } from "../utils/logger";
import { securityVault } from "../services/SecurityVault";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { useSecurityStore } from "./useSecurityStore";

function getHasPwd(): boolean {
  return (
    typeof window !== "undefined" &&
    safeGet(STORAGE_KEYS.HAS_MASTER_PASSWORD) === "true"
  );
}

export function useDatabaseInit() {
  const { isLocked, forceSetup } = useSecurityStore();
  const [db, setDb] = useState<RxDatabase | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  // `dbErrorClass` lets UI consumers pick a localized message without
  // substring-matching on `dbError`. `null` means "no error yet" —
  // distinct from `UNKNOWN` (caught an error but couldn't classify).
  const [dbErrorClass, setDbErrorClass] = useState<DbErrorClass | null>(
    null,
  );
  const [masterPassword, setMasterPassword] = useState("");
  const [hasPwd, setHasPwd] = useState(getHasPwd);
  const [retryToken, setRetryToken] = useState(0);
  const initAttemptedRef = useRef(false);
  const dbInitializedRef = useRef(false);
  const initInFlightRef = useRef<Promise<void> | null>(null);
  const rerunAfterInitRef = useRef(false);
  const mountedRef = useRef(true);

  const retry = useCallback(() => {
    if (dbInitializedRef.current) {return;}
    initAttemptedRef.current = false;
    setDbError(null);
    setDbErrorClass(null);
    setRetryToken((token) => token + 1);
  }, []);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const forceSetupRef = useRef(forceSetup);
  forceSetupRef.current = forceSetup;
  const hasPwdRef = useRef(hasPwd);
  hasPwdRef.current = hasPwd;

  useEffect(() => {
    let cancelled = false;

    // Lock transition: drop the React-side DB reference so the
    // authenticated shell unmounts and the lock screen can render without
    // a stale provider. The underlying RxDB singleton in db/database.ts
    // stays alive (deliberately — BackupService/SyncService hold it and
    // initDB() reuses it on the next unlock, so no second connection is
    // created). Full teardown only happens on vault reset/setup via
    // SecurityManager's destroyDB().
    if (isLocked) {
      dbInitializedRef.current = false;
      initAttemptedRef.current = false;
      setDb(null);
      setDbError(null);
      setDbErrorClass(null);
    }

    const init = async () => {
      if (initAttemptedRef.current && dbInitializedRef.current) {return;}

      let secureHasResult: boolean | null = null;
      try {
        const secureHas = await securityVault.hasMasterPassword();
        secureHasResult = secureHas;
        if (cancelled) {return;}
        setHasPwd(secureHas);
      } catch (err) {
        if (cancelled) {return;}
        logger.warn("[DB] Vault not available", { error: err });
      }

      // SecureStorage is authoritative; consult the legacy flag only if the
      // secure store was unavailable. Re-reading it unconditionally used to
      // overwrite a true secure result with false after localStorage cleanup.
      if (secureHasResult === null) {setHasPwd(getHasPwd());}

      const isDemoParam =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("demo") === "true";
      const isDemoActive =
        safeGet(STORAGE_KEYS.DEMO_ACTIVE) === "true" || isDemoParam;

      if (isLockedRef.current && isDemoActive) {return;}
      if (cancelled) {return;}

      if (!dbInitializedRef.current) {
        initAttemptedRef.current = true;
        try {
          // Do not initialize RxDB while the vault is still locked without
          // a password. The confirmation screen only needs the security
          // state; loading the database here would undo the lazy boundary.
          if (isLockedRef.current && !hasPwdRef.current) {
            return;
          }

          if (!isLockedRef.current && !forceSetupRef.current) {
            // RxDB is loaded only when the unlocked app actually needs it.
            const { initDB, getDB } = await import("../container/database");
            const dbInstance = await initDB(masterPassword || undefined);
            if (cancelled) {return;}
            dbInitializedRef.current = true;
            setDb(dbInstance as RxDatabase);
            setDbError(null);
            setDbErrorClass(null);

            const currentDb = await getDB();
            if (cancelled) {return;}
            if (currentDb && currentDb !== dbInstance) {
              setDb(currentDb as RxDatabase);
            }
          }
        } catch (err) {
          if (cancelled) {return;}
          // Classify using the type guards exported from database.ts.
          // We keep the message string backward-compatible (existing
          // AppContent.tsx consumers read `dbError`) but also expose
          // `dbErrorClass` so new UI surfaces (SecurityManager, retry
          // banner) can pick a localized message without substring
          // matching on the message.
          let cls: DbErrorClass = "UNKNOWN";
          // Classification is best-effort. If the database chunk itself is
          // unavailable, preserve the original initialization error instead
          // of replacing it with an unhandled dynamic-import rejection.
          try {
            const {
              isInvalidDbPasswordError,
              isDbInaccessibleError,
              isVaultLockedError,
            } = await import("../db/database");
            if (isVaultLockedError(err)) {
              cls = "VAULT_LOCKED";
            } else if (isInvalidDbPasswordError(err)) {
              cls = "WRONG_PASSWORD";
            } else if (isDbInaccessibleError(err)) {
              cls = "INACCESSIBLE";
            }
          } catch (classificationError) {
            logger.warn("[DB] Error classification module unavailable", {
              error: classificationError,
            });
          }
          setDbErrorClass(cls);
          initAttemptedRef.current = false;
          const msg =
            err instanceof Error
              ? err.message
              : typeof err === "object" && err !== null
                ? `${(err as Error).name || "Error"}: ${(err as Error).message || JSON.stringify(err)}`
                : String(err);
          const params = (err as Record<string, unknown>)?.parameters;
          setDbError(params ? `${msg} Params: ${JSON.stringify(params)}` : msg);
        }
      }
    };

    if (!dbInitializedRef.current) {
      if (initInFlightRef.current) {
        // A lock/unlock transition can rerun this effect while the previous
        // initDB call is still touching IndexedDB. Never start a second
        // initialization against the same singleton; ask the settled call
        // to rerun once the current vault state is unlocked.
        rerunAfterInitRef.current = true;
      } else {
        const pending = init();
        initInFlightRef.current = pending;
        void pending.then(
          () => {
            if (initInFlightRef.current === pending) {
              initInFlightRef.current = null;
            }
            if (
              rerunAfterInitRef.current &&
              mountedRef.current &&
              !isLockedRef.current &&
              !dbInitializedRef.current
            ) {
              rerunAfterInitRef.current = false;
              setRetryToken((token) => token + 1);
            }
          },
          () => {
            if (initInFlightRef.current === pending) {
              initInFlightRef.current = null;
            }
            if (
              rerunAfterInitRef.current &&
              mountedRef.current &&
              !isLockedRef.current &&
              !dbInitializedRef.current
            ) {
              rerunAfterInitRef.current = false;
              setRetryToken((token) => token + 1);
            }
          },
        );
      }
    }

    return () => {
      cancelled = true;
    };
  }, [masterPassword, isLocked, retryToken]);

  return {
    db,
    dbError,
    dbErrorClass,
    masterPassword,
    setMasterPassword,
    hasPwd,
    retry,
  };
}
