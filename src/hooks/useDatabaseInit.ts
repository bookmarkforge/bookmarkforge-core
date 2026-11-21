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

  useEffect(() => {
    // StrictMode's simulated unmount runs the cleanup once without a real
    // unmount — restore the flag on every effect run or `mounted` stays
    // false forever in dev and the init-rerun guard never fires.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
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
        // The persisted password-skip must be honored even when this effect
        // run was cancelled (React StrictMode remount): the cancelled init
        // returns below before reaching the skip branch, the rerun guard
        // refuses to init while the vault is still locked, and the shell
        // strands on "Loading…" forever after a reload. unlock() is a
        // global-store write — safe to run for a cancelled effect, and the
        // conditions below are identical to the skip branch further down
        // (SecureStorage-authoritative `false`, never a guess).
        if (
          !dbInitializedRef.current &&
          secureHas === false &&
          isLockedRef.current &&
          !forceSetupRef.current &&
          safeGet(STORAGE_KEYS.PASSWORD_SKIPPED) === "true"
        ) {
          useSecurityStore.getState().unlock();
        }
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
          // Passwordless vault with the password prompt skipped — the state
          // after a reload (isLocked starts true) and after an auto-lock.
          // There is no secret to re-enter and NO screen renders an unlock
          // affordance for it: SecurityConfirmation only appears BEFORE the
          // skip (PASSWORD_SKIPPED unset), and the unlock screen requires
          // hasPwd. Without reopening it here the init returns below with no
          // db and the shell strands on the "Loading…" screen forever.
          // secureHasResult is SecureStorage's authoritative answer
          // (null = secure store unavailable → never guess), and
          // PASSWORD_SKIPPED is the user's persisted choice, so reopen the
          // same way "Continue without encryption" does.
          if (
            isLockedRef.current &&
            secureHasResult === false &&
            !forceSetupRef.current &&
            safeGet(STORAGE_KEYS.PASSWORD_SKIPPED) === "true"
          ) {
            useSecurityStore.getState().unlock();
            return;
          }
          // Do not initialize RxDB while the vault is still locked without
          // a password. The confirmation screen only needs the security
          // state; loading the database here would undo the lazy boundary.
          if (isLockedRef.current && !hasPwdRef.current) {
            return;
          }

          if (!isLockedRef.current && !forceSetupRef.current) {
            // H1: a vault with no master password never runs
            // SecurityVault.unlock(), so it never reached the only place that
            // provisioned the per-vault Argon2id salt. Passwordless vaults
            // have no legacy verification token to keep readable, so
            // provisioning here is safe (master-password vaults still install
            // it during unlock, after the password is verified).
            //
            // A-02: this is no longer "nice to have", and it runs BEFORE the
            // database opens. `encrypt()` refuses to write without the salt,
            // so provisioning late meant every secret write — including any
            // row rewritten by an RxDB migration during initDB — failed closed
            // instead of silently persisting an unreadable `v5:` blob.
            if (!hasPwdRef.current) {
              try {
                const { ensureVaultKdfSalt } = await import(
                  "../services/security-vault/kdf-salt"
                );
                const salt = await ensureVaultKdfSalt();
                if (!salt) {
                  logger.error(
                    "[DB] Vault KDF salt unavailable — secret writes will fail closed (A-02)",
                  );
                }
              } catch (error) {
                logger.error(
                  "[DB] Could not provision the per-vault KDF salt — secret writes will fail closed (A-02)",
                  { error },
                );
              }
            }

            // RxDB is loaded only when the unlocked app actually needs it.
            const { initDB, getDB } = await import("../container/database");
            // No credential is passed: initDB() takes a zeroizing copy from
            // the unlocked vault (bytes end-to-end — AGENTS.md §2), so this
            // hook never holds the master password in React state.
            const dbInstance = await initDB();
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
              isDataCorruptedError,
              isStorageBlockedError,
              detectDbBusyError,
            } = await import("../container/database");
            if (isVaultLockedError(err)) {
              cls = "VAULT_LOCKED";
            } else if (isInvalidDbPasswordError(err)) {
              cls = "WRONG_PASSWORD";
            } else if (isDataCorruptedError(err)) {
              cls = "DATA_CORRUPTED";
            } else if (isDbInaccessibleError(err)) {
              cls = "INACCESSIBLE";
            }
            // Another tab holding the vault open (version-upgrade block,
            // closed shared instance, lost leader-election) is transient
            // contention, not corruption — check BEFORE the storage probe
            // because the probe opens its own throwaway DB and would report
            // a healthy environment even while the vault DB is held.
            if (
              (cls === "INACCESSIBLE" || cls === "UNKNOWN") &&
              detectDbBusyError(err)
            ) {
              cls = "DB_BUSY";
            }
            // Storage-denied failures (IndexedDB blocked/missing, quota,
            // site data off) are NOT vault corruption — reclassify so the
            // UI shows "enable site storage" instead of "restore backup".
            if (
              cls !== "DB_BUSY" &&
              (cls === "INACCESSIBLE" || cls === "UNKNOWN") &&
              isStorageBlockedError(err)
            ) {
              cls = "STORAGE_BLOCKED";
            }
            // Error-shape classification misses real-world failures whose
            // cause never reaches the error chain: SecureStorage exhausting
            // its retries before createDBInstance, a hung indexedDB.open
            // surfacing as DB_INIT_TIMEOUT, or WebCrypto missing on an
            // insecure context. When the shape says nothing definitive,
            // probe the environment directly — a broken IndexedDB or
            // missing crypto.subtle is decisive regardless of error shape.
            if (cls === "INACCESSIBLE" || cls === "UNKNOWN") {
              try {
                const { probeStorageCapabilities, isStorageEnvironmentBroken } =
                  await import("../utils/storageProbe");
                const probe = await probeStorageCapabilities();
                if (isStorageEnvironmentBroken(probe)) {
                  cls = "STORAGE_BLOCKED";
                }
              } catch (probeError) {
                logger.warn("[DB] Storage probe failed — keeping error class", {
                  error: probeError,
                });
              }
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
  }, [isLocked, retryToken]);

  return {
    db,
    dbError,
    dbErrorClass,
    hasPwd,
    retry,
  };
}
