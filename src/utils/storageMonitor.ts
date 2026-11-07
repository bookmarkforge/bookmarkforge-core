/**
 * Storage Monitor — production guard for IndexedDB quota & persistence
 *
 * Fail-closed, privacy-first: checks stay local, only logs via logger.
 * Dispatches `storage-pressure` custom event so UI or telemetry can react.
 * Never throws — all errors are contained.
 */

import { logger } from "./logger";

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let started = false;

const PRESSURE_THRESHOLD_PCT = 80;
const CRITICAL_THRESHOLD_PCT = 90;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 min

export interface StoragePressureDetail {
  pct: number;
  usage: number;
  quota: number;
  persisted: boolean | null;
  level: "ok" | "pressure" | "critical";
}

export function getStoragePressureLevel(pct: number): StoragePressureDetail["level"] {
  if (pct >= CRITICAL_THRESHOLD_PCT) return "critical";
  if (pct >= PRESSURE_THRESHOLD_PCT) return "pressure";
  return "ok";
}

export async function checkStoragePressure(): Promise<StoragePressureDetail | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    const pct = quota > 0 ? (usage / quota) * 100 : 0;
    let persisted: boolean | null = null;
    try {
      if (navigator.storage.persisted) persisted = await navigator.storage.persisted();
    } catch { /* INTENTIONAL SILENCE: persistence status is best-effort; it falls back to null (unknown) on failure. */ }
    const level = getStoragePressureLevel(pct);
    const detail: StoragePressureDetail = { pct, usage, quota, persisted, level };

    if (level !== "ok") {
      logger.warn(`[StorageMonitor] ${level.toUpperCase()} — ${pct.toFixed(1)}% used`, {
        usage,
        quota,
        persisted,
      });
      try {
        window.dispatchEvent(new CustomEvent("storage-pressure", { detail }));
      } catch { /* INTENTIONAL SILENCE: a throwing event listener must not break the pressure check itself. */ }
    } else {
      logger.debug("[StorageMonitor] Storage OK", { pct: pct.toFixed(1), persisted });
    }

    // If persistence was denied, warn every check (user can enable in settings)
    if (persisted === false) {
      logger.warn("[StorageMonitor] Persistent storage denied — data may be cleared under pressure");
    }

    return detail;
  } catch (err) {
    logger.warn("[StorageMonitor] check failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function startStorageMonitor(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  // Immediate check (deferred to not block boot)
  setTimeout(() => {
    void checkStoragePressure();
  }, 4000);

  monitorInterval = setInterval(() => {
    void checkStoragePressure();
  }, CHECK_INTERVAL_MS);

  logger.info("[StorageMonitor] Started — interval 5m, thresholds 80%/90%");
}

export function stopStorageMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  started = false;
}

export function isStorageMonitorActive(): boolean {
  return started;
}
