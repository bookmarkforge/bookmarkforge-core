import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Wifi, WifiOff, RefreshCw, Loader2, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { initDB } from "../../container/database";
import { syncService } from "../../services/SyncService";
import { logger } from "../../utils/logger";
import { licenseService } from "../../services/LicenseService";
import { useReducedMotion } from "../../hooks/useReducedMotion";

type SyncHealth =
  "healthy" | "warning" | "error" | "connecting" | "disconnected";

export const SyncStatus: React.FC = () => {
  const { t } = useTranslation();
  const [syncState, setSyncState] = useState({
    isSyncing: false,
    health: "disconnected" as SyncHealth,
    lastSync: undefined as Date | undefined,
    roomId: null as string | null,
  });
  const [isRestarting, setIsRestarting] = useState(false);
  // Deliberate leave: the mountedRef guards a live sync-service subscription
  // (event callback, not a terminal op) and the restart's 1s min-spinner
  // timer — neither maps to the guard family's operation contract.
  const mountedRef = useRef(true);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    mountedRef.current = true;

    const loadSyncState = () => {
      try {
        if (!mountedRef.current) {return;}

        const update = (
          syncing: boolean,
          _roomId: string | null,
          _peers: number,
          health: string,
          lastSync: number | null,
        ) => {
          if (!mountedRef.current) {return;}
          // A transient service bootstrap must not look like an active
          // network connection when the user has not configured a sync room.
          // Local-first use is healthy and should read as inactive, not
          // "connecting forever".
          const normalizedHealth =
            !_roomId && health === "connecting"
              ? "disconnected"
              : (health as SyncHealth);
          setSyncState({
            isSyncing: syncing,
            health: normalizedHealth,
            lastSync: lastSync ? new Date(lastSync) : undefined,
            roomId: _roomId,
          });
        };

        syncService.onSyncStateChange = update;
        update(
          syncService.isSyncing,
          syncService.currentRoomId,
          syncService.connectedPeers,
          syncService.syncHealth,
          syncService.lastSyncTime,
        );

        return () => {
          if (syncService.onSyncStateChange === update) {
            syncService.onSyncStateChange = null;
          }
        };
      } catch (e) {
        logger.warn("[SyncStatus] SyncService unavailable:", e);
      }
      return undefined;
    };

    const cleanup = loadSyncState();

    return () => {
      mountedRef.current = false;
      clearTimeout(restartTimerRef.current);
      cleanup?.();
    };
  }, []);

  const handleRestart = async () => {
    // P2P sync is a Pro feature (free tier: 1 device, no sync). Gate before
    // touching the sync service so Free users get a clear upsell instead of
    // a silent connection failure.
    if (!licenseService.hasProAccess()) {
      toast.error(
        t(
          "app_p2pSyncRequiresPro",
          "P2P sync is a Pro feature. Activate your license in Settings.",
        ),
      );
      return;
    }
    setIsRestarting(true);
    try {
      const db = await initDB();
      if (syncService.currentRoomId) {
        await syncService.restartSync(db);
      } else {
        await syncService.startP2PSync(db, crypto.randomUUID().slice(0, 8));
      }
    } catch (error) {
      if (mountedRef.current) {
        logger.warn("[SyncStatus] Unable to restart sync:", error);
      }
    } finally {
      // Keep the spinner up for at least a second, but never set state on
      // a component that unmounted while the restart was pending.
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {setIsRestarting(false);}
      }, 1000);
    }
  };

  const getHealthColor = () => {
    switch (syncState.health) {
      case "healthy":
        return "ds-text-success";
      case "warning":
        return "ds-text-warning";
      case "error":
        return "ds-text-danger";
      default:
        return "text-[var(--text-muted)]";
    }
  };

  const formatLastSync = () => {
    if (!syncState.lastSync) {return null;}
    const diff = Date.now() - syncState.lastSync.getTime();
    if (diff < 60000) {return t("app_syncJustNow");}
    return t("app_syncMinutesAgo", { count: Math.floor(diff / 60000) });
  };

  return (
    <section
      aria-label={t("app_syncStatusRegion", "Sync status")}
      className="fixed bottom-6 start-6 z-50"
    >
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : undefined}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-full shadow-lg group">
        <div
          className="flex items-center gap-2"
          // Announce sync-state transitions (connecting/active/error) to
          // assistive tech. `polite` avoids interrupting mid-sentence; the
          // state label is the only content that changes here.
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {syncState.health === "healthy" && syncState.isSyncing ? (
            <div className="relative">
              <Wifi className={`size-4 ${getHealthColor()}`} />
              <motion.div
                className="absolute -top-1 -right-1 size-2 rounded-full ds-bg-success"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
          ) : syncState.health === "connecting" ? (
            <div className="relative">
              <Cloud className="size-4 text-blue-400" />
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <Loader2 className="size-2 text-blue-500" />
              </motion.div>
            </div>
          ) : (
            <WifiOff className="size-4 text-[var(--text-muted)]" />
          )}
          <span className="text-[10px] font-bold ds-text-muted uppercase tracking-wider">
            {syncState.health === "healthy" && syncState.isSyncing
              ? t("app_syncActive", "E2EE Sync Active")
              : syncState.health === "error"
                ? t("app_syncErrorStatus")
                : syncState.health === "connecting"
                  ? t("app_syncConnecting")
                  : t("app_syncInactive")}
          </span>
        </div>

        <div className="w-px h-3 bg-[var(--bg-secondary)] dark:border-[var(--divider)]" />

        <button
          onClick={handleRestart}
          disabled={isRestarting}
          className="truncate p-1.5 hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] rounded-full transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] dark:hover:text-white disabled:opacity-50"
          title={t("app_syncNow")}
          aria-label={t("app_syncNow")}
        >
          {isRestarting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </button>
      </div>

      {syncState.lastSync && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="ps-4"
        >
          <span className="text-[9px] font-medium text-[var(--text-muted)] dark:text-[var(--text-muted)] bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]/50 px-2 py-0.5 rounded-full border border-[var(--divider)] dark:border-[var(--divider)]">
            {formatLastSync()}
          </span>
        </motion.div>
      )}
    </motion.div>
    </section>
  );
};
