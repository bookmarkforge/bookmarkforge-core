import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { RxDatabase } from "rxdb";
import { useTranslation } from "react-i18next";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { useSecurityStore } from "../../hooks/useSecurityStore";
import { useDatabaseInit } from "../../hooks/useDatabaseInit";
import { useMigrationProgress } from "../../hooks/useMigrationProgress";
import type { DbErrorClass } from "../../db/database";
import { safeGet } from "../../store/safeStorage";
import { loadBackupService } from "../../services/pro-access";

/**
 * Pure mapping from a classified DB error to the production message.
 * Exported for unit tests: a vault that is LOCKED (device key wrapped but
 * not materialized) must show the unlock message — never the
 * invalid-password copy, even though the password may be correct.
 */
export function getDbErrorMessage(
  dbErrorClass: DbErrorClass | null,
  invalidPasswordMsg: string,
  vaultLockedMsg: string,
  storageUnavailableMsg: string,
): string {
  if (dbErrorClass === "WRONG_PASSWORD") {
    return invalidPasswordMsg;
  }
  if (dbErrorClass === "VAULT_LOCKED") {
    return vaultLockedMsg;
  }
  return storageUnavailableMsg;
}
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { logger } from "../../utils/logger";
import { DatabaseContextProvider } from "../../hooks/useRxDB";

// The gate components below are intentionally lazy even though the vault
// lock screen (SecurityManager) is the FIRST screen a returning user sees.
// Since P60, SecurityManager / SecurityConfirmation render their icons via
// hand-rolled inline SVGs (InlineSecurityIcons) and CSS animations instead
// of lucide-react / motion/react, so the pre-unlock screens are free of
// the 910 kB ui-runtime vendor chunk (a P60 build guard + CI smoke check
// fail the build if ui-runtime ever regresses into those chunks).
//
// The gate components remain lazy for two reasons:
//   1. MainApp + RxDBProvider (RxDB, the full authenticated shell) are
//      deferred until after the vault is actually unlocked.
//   2. SecurityConfirmation / Onboarding / WelcomeTour still import
//      lucide-react (+ motion for Onboarding/WelcomeTour); those are only
//      safe to fetch once ui-runtime is legitimately needed, so keeping
//      them behind lazy boundaries prevents the P48 modulepreload filter
//      from being the only thing standing between the entry chunk and a
//      static ui-runtime edge (the filter hides the hint but not the
//      import).
const RxDBProvider = lazy(
  () => import("rxdb/plugins/react").then((m) => ({
    default: m.RxDatabaseProvider as unknown as ComponentType<{
      database: RxDatabase;
      children?: ReactNode;
    }>,
  })),
);
const SecurityManager = lazy(() =>
  import("../SecurityManager").then((m) => ({ default: m.SecurityManager })),
);
const MainApp = lazy(() =>
  import("./MainApp").then((m) => ({ default: m.MainApp })),
);
const SecurityConfirmation = lazy(() =>
  import("../SecurityConfirmation").then((m) => ({
    default: m.SecurityConfirmation,
  })),
);
const Onboarding = lazy(() =>
  import("../Onboarding").then((m) => ({ default: m.Onboarding })),
);
const WelcomeTour = lazy(() =>
  import("../WelcomeTour").then((m) => ({ default: m.WelcomeTour })),
);

function LoadingState({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center ds-bg-primary ds-text-primary">
      {label}
    </div>
  );
}

/**
 * Vault-overlay exit timings: after the store flips inactive the overlay
 * stays mounted, frozen at its last state, for HOLD_MS, then fades out
 * over FADE_MS. Total ≈ 650ms — long enough that even a sub-second
 * migration or a fast reopen is perceived instead of flickering.
 */
const VAULT_OVERLAY_EXIT_HOLD_MS = 350;
const VAULT_OVERLAY_EXIT_FADE_MS = 300;

interface MigrationProgressScreenProps {
  percent: number;
  handled: number;
  total: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Exit phase: fade the overlay out (and stop it intercepting input). */
  closing?: boolean;
}

/**
 * Full-screen "Migrating vault…" overlay shown while initDB() awaits a
 * schema migration (e.g. the F-06 authenticated v6→v7 rewrite). Fixed
 * positioning lets it render on top of the locked screen (the migration
 * runs inside the unlock flow, before isLocked flips) without unmounting
 * SecurityManager — so a failed migration still surfaces
 * SecurityManager's error underneath.
 *
 * `closing` drives the exit transition: the parent keeps the overlay
 * mounted for a short hold at the final state plus this fade (see
 * VAULT_OVERLAY_EXIT_HOLD_MS / VAULT_OVERLAY_EXIT_FADE_MS) so a fast
 * migration doesn't flicker away — the overlay fades over the
 * freshly-revealed shell instead of unmounting instantly. The fade uses
 * the --ease-out token (index.css), consistent with the rest of the
 * motion system.
 */
function MigrationProgressScreen({
  percent,
  handled,
  total,
  t,
  closing = false,
}: MigrationProgressScreenProps) {
  return (
    <div
      className={`fixed inset-0 z-[110] flex flex-col items-center justify-center gap-4 ds-bg-primary ds-text-primary transition-opacity duration-300 ${
        closing ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
      role="status"
      aria-live="polite"
      data-testid="vault-migrating-screen"
    >
      <div className="size-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      <p className="text-lg font-medium">
        {t("app_migratingVault", {
          percent,
        })}
      </p>
      <p className="text-sm ds-text-secondary">
        {t("app_migratingVaultDetail", {
          handled,
          total,
        })}
      </p>
      <div
        className="w-56 h-1.5 rounded-full ds-bg-secondary overflow-hidden"
        aria-hidden
      >
        <div
          className="h-full rounded-full ds-bg-accent-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

interface VaultLoadingScreenProps {
  /** Estimated rows already in the vault (from estimate-rows.ts). */
  rows: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
  /** Exit phase: fade the overlay out (and stop it intercepting input). */
  closing?: boolean;
}

/**
 * Full-screen "Loading vault…" overlay shown while initDB() opens the
 * vault's stores on a NORMAL reopen (no schema migration pending): a
 * spinner plus the estimated row count, so a multi-second addCollections
 * on a large vault isn't a silent "Loading…". Shares the fixed overlay
 * mechanics (and the hold + fade exit) with MigrationProgressScreen;
 * only one of the two renders at a time.
 */
function VaultLoadingScreen({ rows, t, closing = false }: VaultLoadingScreenProps) {
  return (
    <div
      className={`fixed inset-0 z-[110] flex flex-col items-center justify-center gap-4 ds-bg-primary ds-text-primary transition-opacity duration-300 ${
        closing ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
      role="status"
      aria-live="polite"
      data-testid="vault-loading-screen"
    >
      <div className="size-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      <p className="text-lg font-medium">{t("app_loadingVault")}</p>
      <p className="text-sm ds-text-secondary">
        {t("app_loadingVaultDetail", {
          rows: rows.toLocaleString(),
        })}
      </p>
    </div>
  );
}

export function AppContent() {
  const { t } = useTranslation();
  const { isLocked, unlock, forceSetup, setForceSetup } = useSecurityStore();
  const { db, dbError, dbErrorClass, hasPwd, retry: retryDatabase } =
    useDatabaseInit();

  useEffect(() => {
    logger.info("[AppContent] Boot state", {
      dbReady: Boolean(db),
      dbError: dbError ?? null,
      dbErrorClass: dbErrorClass ?? null,
      hasPassword: hasPwd,
      path: typeof window !== "undefined" ? window.location.pathname : null,
    });
  }, [db, dbError, dbErrorClass, hasPwd]);
  const migration = useMigrationProgress();
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return (
      typeof window !== "undefined" &&
      safeGet(STORAGE_KEYS.ONBOARDING_COMPLETE) !== "true"
    );
  });

  // Vault overlay exit: when the store flips inactive the overlay must not
  // unmount instantly (a <1s migration or a fast reopen would flicker).
  // Hold it mounted at the frozen last state for
  // VAULT_OVERLAY_EXIT_HOLD_MS, then fade out over
  // VAULT_OVERLAY_EXIT_FADE_MS — the shell underneath is already
  // interactive (pointer-events-none during the fade).
  const [overlayPhase, setOverlayPhase] = useState<
    "hidden" | "visible" | "closing"
  >("hidden");
  const overlayPhaseRef = useRef(overlayPhase);
  overlayPhaseRef.current = overlayPhase;
  const [frozenOverlay, setFrozenOverlay] = useState<{
    kind: "migrating" | "loading";
    percent: number;
    handled: number;
    total: number;
    rows: number;
  }>({ kind: "migrating", percent: 0, handled: 0, total: 0, rows: 0 });
  const migrationRef = useRef(migration);
  migrationRef.current = migration;
  // Which overlay should be up right now? A running schema migration wins;
  // otherwise a normal reopen with rows to open shows the loading screen.
  // The loading screen is suppressed for empty vaults (rows === 0) so a
  // first-time setup or an empty reopen doesn't flash an overlay.
  const showMigrationScreen = migration.active && migration.total > 0;
  const showLoadingScreen =
    !showMigrationScreen &&
    migration.loadingRows !== null &&
    migration.loadingRows > 0;
  const overlayVisible = showMigrationScreen || showLoadingScreen;
  const lastVisibleKindRef = useRef<"migrating" | "loading">("migrating");
  // The loading rows must be captured while the overlay is VISIBLE: unlike
  // migration totals (whose DONE state lingers in the store until the init
  // cleanup), the loading state is cleared wholesale by the reset, so the
  // freeze inside the effect can't read it back from the store.
  const lastVisibleRowsRef = useRef(0);
  if (overlayVisible) {
    lastVisibleKindRef.current = showMigrationScreen
      ? "migrating"
      : "loading";
    if (showLoadingScreen) {
      lastVisibleRowsRef.current = migration.loadingRows ?? 0;
    }
  }

  useEffect(() => {
    if (overlayVisible) {
      overlayPhaseRef.current = "visible";
      setOverlayPhase("visible");
      return;
    }
    if (overlayPhaseRef.current === "visible") {
      // Freeze the last state (DONE ⇒ 100%, or the loading rows) so the
      // hold shows the finished screen even though the store resets right
      // after addCollections settles. Percent/handled/total come from the
      // store (a migration's DONE state lingers until the cleanup reset);
      // the loading rows come from the visibility-time capture above.
      const last = migrationRef.current;
      setFrozenOverlay({
        kind: lastVisibleKindRef.current,
        percent: last.percent,
        handled: last.handled,
        total: last.total,
        rows: lastVisibleRowsRef.current,
      });
      overlayPhaseRef.current = "closing";
      setOverlayPhase("closing");
      const timer = setTimeout(() => {
        overlayPhaseRef.current = "hidden";
        setOverlayPhase("hidden");
      }, VAULT_OVERLAY_EXIT_HOLD_MS + VAULT_OVERLAY_EXIT_FADE_MS);
      return () => clearTimeout(timer);
    }
  }, [overlayVisible]);

  const overlay =
    overlayPhase !== "hidden" ? (
      overlayPhase === "closing" ? (
        frozenOverlay.kind === "migrating" ? (
          <MigrationProgressScreen
            percent={frozenOverlay.percent}
            handled={frozenOverlay.handled}
            total={frozenOverlay.total}
            t={t}
            closing
          />
        ) : (
          <VaultLoadingScreen rows={frozenOverlay.rows} t={t} closing />
        )
      ) : showMigrationScreen ? (
        <MigrationProgressScreen
          percent={migration.percent}
          handled={migration.handled}
          total={migration.total}
          t={t}
        />
      ) : (
        <VaultLoadingScreen rows={migration.loadingRows ?? 0} t={t} />
      )
    ) : null;

  // F0-2: detect an EMPTY vault once per boot (fresh install or a browser
  // site-data clear). When empty, the first-run wizard opens on a
  // restore-first screen so a returning user can recover their data before
  // anything new is created. Computed once per db instance; a restore or a
  // later addition of data does not need to flip it back.
  const [vaultIsEmpty, setVaultIsEmpty] = useState(false);
  const emptinessCheckedRef = useRef(false);

  // F0-2 (corrupted DB): when the database fails to initialize with a
  // storage/corruption-class error, offer a restore-from-backup path
  // instead of leaving the user in an endless Retry loop. The flow wipes
  // the corrupt state (destroyDB), imports the backup into a fresh vault
  // (importBackup opens its own DB with the backup's password) and then
  // reloads so the init chain re-runs cleanly.
  const [restoringBackup, setRestoringBackup] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  const handleRestoreFromFile = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || restoringBackup) {return;}

    let password: string | undefined;
    if (file.name.endsWith(".bmf")) {
      password =
        prompt(
          t(
            "app_enterDecryptPassword",
            "This backup is encrypted. Please enter the password to decrypt it:",
          ),
        ) ?? undefined;
      if (!password) {
        toast.error(
          t(
            "app_decryptPasswordRequired",
            "Password is required to restore an encrypted backup.",
          ),
        );
        return;
      }
    }

    setRestoringBackup(true);
    try {
      // Wipe the corrupt database state first: importBackup opens its own
      // fresh instance via initDB, which would otherwise collide with the
      // stale/corrupt storage on the same adapter.
      const { destroyDB } = await import("../../container/database");
      await destroyDB();
      // BackupService is Pro: resolved behind the hasProAccess gate.
      const backup = await loadBackupService();
      await backup.importBackup(file, password);
      toast.success(
        t("onboarding_restoreSuccess", "Vault restored successfully."),
      );
      // Reboot the app so the fresh vault is picked up by the init chain
      // (the user unlocks with their master password as usual).
      window.location.reload();
    } catch (error) {
      logger.warn("[AppContent] Restore over corrupted DB failed", { error });
      toast.error(
        t(
          "onboarding_restoreError",
          "Could not restore the backup. Check the file and password.",
        ),
      );
      setRestoringBackup(false);
    }
  };
  useEffect(() => {
    if (!db || emptinessCheckedRef.current) {return;}
    emptinessCheckedRef.current = true;
    let cancelled = false;
    const checkEmptiness = async () => {
      try {
        const [bookmarkCount, documentCount] = await Promise.all([
          // The collections are always registered at DB init; the `!` only
          // narrows the index-signature access, never skips a runtime check.
          db.bookmarks!.count().exec(),
          db.documents!.count().exec(),
        ]);
        if (!cancelled) {
          setVaultIsEmpty(
            Number(bookmarkCount) === 0 && Number(documentCount) === 0,
          );
        }
      } catch (error) {
        logger.warn("[AppContent] Failed to check vault emptiness", { error });
      }
    };
    void checkEmptiness();
    return () => {
      cancelled = true;
    };
  }, [db]);

  const showSecurityConfirmation = isLocked && !hasPwd && !forceSetup;

  const handleSkipPassword = () => {
    unlock();
  };

  const handleSetupPassword = () => {
    setForceSetup(true);
  };

  useEffect(() => {
    const globalFont = safeGet("global_font") as
      "sans-serif" | "serif" | "monospace" | null;
    const globalFontSize = safeGet("global_font_size");

    if (globalFont) {
      const fontFamily =
        globalFont === "serif"
          ? "Georgia, serif"
          : globalFont === "monospace"
            ? "monospace"
            : "system-ui, sans-serif";
      document.documentElement.style.setProperty(
        "--font-family-global",
        fontFamily,
      );
    }

    if (globalFontSize) {
      document.documentElement.style.setProperty(
        "--font-size-global",
        `${globalFontSize}px`,
      );
    }
  }, []);

  if (showSecurityConfirmation) {
    return (
      <>
        {overlay}
        <Suspense fallback={<LoadingState label={t("app.loading")} />}>
          <SecurityConfirmation
            onConfirm={handleSkipPassword}
            onSetupPassword={handleSetupPassword}
          />
        </Suspense>
      </>
    );
  }

  // The v6→v7 schema migration runs inside initDB() — which the unlock
  // flow awaits BEFORE isLocked flips (SecurityManager.handleUnlock), so
  // during the migration the app is still in the locked branch. Render
  // the progress screen as a fixed overlay ON TOP of the lock screen
  // instead of swapping branches: SecurityManager stays mounted, so if
  // initDB() fails its error message is still shown when the overlay
  // unmounts (a branch swap would remount the lock screen and lose the
  // error state). `overlay` (hoisted above) handles the exit hold + fade.
  if ((isLocked && hasPwd) || forceSetup) {
    return (
      <Suspense fallback={<LoadingState label={t("app.loading")} />}>
        <SecurityManager>
          <div>{t("app.unlocking")}</div>
        </SecurityManager>
        {overlay}
      </Suspense>
    );
  }

  if (dbError) {
    const productionDbMessage = getDbErrorMessage(
      dbErrorClass,
      t("app.invalidPassword"),
      t("app.vaultLocked", "Vault is locked. Unlock the vault to continue."),
      t("app.dbStorageUnavailable"),
    );
    const visibleDbMessage = import.meta.env.PROD ? productionDbMessage : dbError;
    // WRONG_PASSWORD and VAULT_LOCKED are authentication problems, not
    // corruption — offering a restore there would just distract from the
    // actual fix (entering the right password / unlocking). Every other
    // class (INACCESSIBLE, UNKNOWN, legacy unclassified) is a storage
    // problem where a restore path is the right offer (roadmap F0-2).
    const canOfferRestore =
      dbErrorClass !== "WRONG_PASSWORD" && dbErrorClass !== "VAULT_LOCKED";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 ds-bg-primary ds-text-primary">
        <h1 className="text-xl mb-4 ds-text-danger">{t("app.dbInitFailed")}</h1>
        <p className="p-4 rounded text-sm max-w-2xl ds-bg-secondary ds-radius-button" role="alert">
          {visibleDbMessage}
        </p>
        <button
          onClick={retryDatabase}
          disabled={restoringBackup}
          className="truncate mt-4 px-4 py-2 transition-colors ds-bg-card ds-radius-button ds-text-primary disabled:opacity-50"
          type="button"
        >
          {t("app.retry")}
        </button>
        {canOfferRestore && (
          <>
            <p className="mt-6 text-sm max-w-2xl ds-text-secondary">
              {t(
                "app_dbCorruptRecoveryHint",
                "Your database appears damaged. Restore from a backup file to recover your data.",
              )}
            </p>
            <button
              onClick={() => restoreFileInputRef.current?.click()}
              disabled={restoringBackup}
              className="truncate mt-4 flex items-center gap-2 px-4 py-2 text-white text-sm font-semibold transition-colors ds-accent-filled ds-shadow-accent disabled:opacity-50"
              type="button"
            >
              {restoringBackup
                ? t("onboarding_restoring", "Restoring...")
                : t("app_restoreFromBackup", "Restore from backup file")}
            </button>
            <input
              type="file"
              ref={restoreFileInputRef}
              accept=".json,.bmf"
              className="hidden"
              data-testid="restore-backup-input"
              onChange={(e) => void handleRestoreFromFile(e)}
              aria-label={t("app_restoreFromBackup", "Restore from backup file")}
            />
          </>
        )}
      </div>
    );
  }

  if (!db) {
    // A schema migration (e.g. the F-06 authenticated v6→v7 rewrite) can
    // take minutes on large vaults while initDB() awaits addCollections.
    // Show real progress instead of a static spinner; `overlay` (hoisted
    // above) covers the exit hold + fade over the loading state.
    return (
      <>
        {overlay}
        <div className="min-h-screen flex items-center justify-center ds-bg-primary ds-text-primary">
          {t("app.loading")}
        </div>
      </>
    );
  }

  return (
    <>
      {overlay}
      <ThemeProvider>
      <Suspense fallback={<LoadingState label={t("app.loading")} />}>
        <DatabaseContextProvider database={db}>
          <RxDBProvider database={db}>
          <BrowserRouter>
          {/* MainApp owns the single page-content landmark and the
              `main-content` skip-link target. Onboarding and WelcomeTour
              remain outside that landmark as modal-style overlays. */}
          <MainApp />
          {showOnboarding && (
            <Onboarding
              onComplete={() => setShowOnboarding(false)}
              vaultIsEmpty={vaultIsEmpty}
            />
          )}
          <WelcomeTour />
          </BrowserRouter>
          </RxDBProvider>
        </DatabaseContextProvider>
      </Suspense>
    </ThemeProvider>
    </>
  );
}
