import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Wifi, WifiOff, RefreshCw, Loader2, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { initDB } from "../../container/database";
import {
  loadSyncService,
  announceProUnavailable,
  ProUnavailableError,
  type SyncServiceType,
} from "../../services/pro-access";
import { logger } from "../../utils/logger";
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

  // ADR-066: P2P sync is Pro, so the replication manager is resolved through
  // the entitlement-gated seam instead of being linked into this Core widget.
  // A
  // Free user never downloads it: the subscription never happens, the widget
  // reports the honest local-first state (inactive, nothing syncing) and the
  // restart action explains the missing entitlement via the shared Pro panel.
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

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

    loadSyncService()
      .then((service: SyncServiceType) => {
        if (cancelled) {return;}
        service.onSyncStateChange = update;
        unsubscribe = () => {
          if (service.onSyncStateChange === update) {
            service.onSyncStateChange = null;
          }
        };
        update(
          service.isSyncing,
          service.currentRoomId,
          service.connectedPeers,
          service.syncHealth,
          service.lastSyncTime,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) {return;}
        // No-license is the ordinary Free case, not an anomaly: stay quiet
        // there and report a build/runtime failure loudly.
        if (!(error instanceof ProUnavailableError) || error.reason === "load-failed") {
          logger.warn("[SyncStatus] SyncService unavailable:", error);
        }
        update(false, null, 0, "disconnected", null);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearTimeout(restartTimerRef.current);
      unsubscribe?.();
    };
  }, []);

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      // The seam gates this before the first Pro byte is requested: a Free
      // user (or an Open Core build) gets the shared "requires Pro" panel
      // instead of a silent connection failure.
      const syncService = await loadSyncService();
      const db = await initDB();
      if (syncService.currentRoomId) {
        await syncService.restartSync(db);
      } else {
        await syncService.startP2PSync(db, crypto.randomUUID().slice(0, 8));
      }
    } catch (error) {
      if (error instanceof ProUnavailableError) {
        announceProUnavailable(error);
      } else if (mountedRef.current) {
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

  return null;
};
