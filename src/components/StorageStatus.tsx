import { useEffect, useState } from "react";
import { Database, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRxCollection, useRxQuery } from "../hooks/useRxDB";
import type { RxQuery as AnyRxQuery } from "rxdb";
import { loadBackupService } from "../services/pro-access";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { logger } from "../utils/logger";
import { useFreeTierUsage } from "../hooks/useFreeTierUsage";
import { StorageCleanupDialog } from "./dashboard/components/StorageCleanupDialog";

// F0-3: gradual storage-health thresholds. Crossing a threshold escalates
// the indicator's color/icon and adds a targeted warning to the tooltip.
const QUOTA_THRESHOLD_CAUTION = 70;
const QUOTA_THRESHOLD_WARNING = 85;
const QUOTA_THRESHOLD_CRITICAL = 95;
/** A backup older than this (48 h) counts as stale. */
export const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
/** How often the backup-age and storage quota are re-polled (1 min). */
export const BACKUP_REFRESH_INTERVAL_MS = 60_000;

type StorageHealthLevel =
  | "normal"
  | "caution"
  | "warning"
  | "critical";

export function getStorageHealthLevel(
  percent: number | null,
): StorageHealthLevel {
  if (percent === null || percent < QUOTA_THRESHOLD_CAUTION) {
    return "normal";
  }
  if (percent >= QUOTA_THRESHOLD_CRITICAL) {
    return "critical";
  }
  if (percent >= QUOTA_THRESHOLD_WARNING) {
    return "warning";
  }
  return "caution";
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {return "0 B";}
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(k)),
  );
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** Compact relative age: "45m" / "3h" / "2d" (unit symbols — not words). */
export function compactAge(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {return `${Math.floor(hours / 24)}d`;}
  if (hours >= 1) {return `${hours}h`;}
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/**
 * F0-3: age (ms) of the most recent external copy — the latest of the daily
 * auto-backup and the last manual export. Returns `null` when neither has
 * ever run. Shared by StorageStatus and the dashboard's stale-backup
 * reminder so both surfaces agree on what "current" means.
 */
export async function getLatestBackupAgeMs(): Promise<number | null> {
  try {
    const BackupService = await loadBackupService();
    const autoInfo = await BackupService.getAutoBackupInfo();
    const manualRaw = safeGet(STORAGE_KEYS.LAST_MANUAL_BACKUP_DATE);
    const manualTs = manualRaw ? parseInt(manualRaw, 10) : NaN;
    const timestamps: number[] = [];
    if (autoInfo.age !== undefined) {
      timestamps.push(Date.now() - autoInfo.age);
    }
    if (Number.isFinite(manualTs)) {
      timestamps.push(manualTs);
    }
    return timestamps.length > 0
      ? Date.now() - Math.max(...timestamps)
      : null;
  } catch {
    return null;
  }
}

export function StorageStatus() {
  const { t } = useTranslation();
  const docsCollection = useRxCollection("documents");
  const bookmarksCollection = useRxCollection("bookmarks");
  // Free-tier nudge meter (design doc surface 1): passive status, not
  // marketing — appears only while a Free user is within 10% of the wall.
  // The hook subscribes to the same { isDeleted: false } count the
  // enforcement preInsert hook counts, so meter and wall never disagree.
  const { count: freeCount, limit: freeLimit, nearWall, isFree } =
    useFreeTierUsage();
  const showFreeMeter = isFree && nearWall && freeCount !== undefined;

  const { result: docsCount = 0 } = useRxQuery(
    docsCollection?.count() as unknown as AnyRxQuery<unknown>,
  );
  const { result: bookmarksCount = 0 } = useRxQuery(
    bookmarksCollection?.count() as unknown as AnyRxQuery<unknown>,
  );

  const total =
    (typeof docsCount === "number" ? docsCount : 0) +
    (typeof bookmarksCount === "number" ? bookmarksCount : 0);

  const [quota, setQuota] = useState<{
    usage: number;
    total: number;
  } | null>(null);
  // Milliseconds since the most recent auto/manual backup; null = never.
  const [backupAgeMs, setBackupAgeMs] = useState<number | null>(null);
  // Disk backup result: method, timestamp, error.
  const [diskBackupInfo, setDiskBackupInfo] = useState<{
    method: "folder" | "download" | "download-blocked" | null;
    timestamp: number | null;
    error: string | null;
  }>({ method: null, timestamp: null, error: null });
  // F0-3 follow-up: the 95 % quota warning's direct action opens this dialog.
  const [showCleanup, setShowCleanup] = useState(false);

  // F0-3: quota usage + backup age are read on mount and refreshed every
  // minute. All failures degrade gracefully to "unknown" (no warning).
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        if (
          navigator.storage &&
          typeof navigator.storage.estimate === "function"
        ) {
          const estimate = await navigator.storage.estimate();
          if (
            !cancelled &&
            estimate &&
            typeof estimate.usage === "number" &&
            typeof estimate.quota === "number" &&
            estimate.quota > 0
          ) {
            setQuota({ usage: estimate.usage, total: estimate.quota });
          }
        }
      } catch (error) {
        logger.warn("[StorageStatus] Storage estimate failed", { error });
      }
      try {
        const age = await getLatestBackupAgeMs();
        if (!cancelled) {setBackupAgeMs(age);}
      } catch (error) {
        logger.warn("[StorageStatus] Backup age check failed", { error });
        if (!cancelled) {setBackupAgeMs(null);}
      }
      // Disk backup result (method + error) for the tooltip.
      try {
        const BackupService = await loadBackupService();
        const diskInfo = BackupService.getDiskBackupInfo();
        if (!cancelled) {setDiskBackupInfo(diskInfo);}
      } catch {
        /* ignore */
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), BACKUP_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const usagePercent =
    quota && quota.total > 0 ? (quota.usage / quota.total) * 100 : null;
  const level = getStorageHealthLevel(usagePercent);
  // Compute the age of the disk (external) copy from the persisted timestamp.
  const diskBackupAgeMs =
    diskBackupInfo.method && diskBackupInfo.timestamp
      ? Date.now() - diskBackupInfo.timestamp
      : null;
  // A vault with content and no recent backup (or none at all) is stale.
  const backupStale =
    total > 0 && (backupAgeMs === null || backupAgeMs > BACKUP_STALE_MS);
  // External copy is stale when it exists but is older than the internal
  // backup threshold, or when it failed/blocked and the internal backup
  // is also stale (meaning no healthy external copy exists).
  const diskStale =
    total > 0 &&
    (diskBackupInfo.error !== null ||
      diskBackupInfo.method === "download-blocked" ||
      (diskBackupAgeMs !== null && diskBackupAgeMs > BACKUP_STALE_MS));
  const warn = level !== "normal" || backupStale || diskStale;

  // Detailed tooltip: items, quota, then internal + external copy status.
  const titleParts = [t("app_storageStatus", { count: total })];
  if (showFreeMeter) {
    titleParts.push(
      t("app_freeMeterTooltip", { limit: freeLimit }),
    );
  }
  if (quota) {
    titleParts.push(
      t(
        "app_storageQuotaDetail",
        "Storage: {{used}} used of {{total}} ({{percent}}%)",
        {
          used: formatBytes(quota.usage),
          total: formatBytes(quota.total),
          percent:
            usagePercent === null
              ? "–"
              : String(Math.round(usagePercent)),
        },
      ),
    );
  }
  // Internal copy (in-browser auto-backup)
  titleParts.push(
    backupAgeMs === null
      ? t("app_internalCopyNever", "Internal copy: none")
      : backupStale
        ? t("app_internalCopyStale", "Internal copy: {{when}} (stale)", {
            when: compactAge(backupAgeMs),
          })
        : t("app_internalCopyOk", "Internal copy: {{when}}", {
            when: compactAge(backupAgeMs),
          }),
  );
  // External copy (disk backup)
  if (diskBackupInfo.method === "download-blocked") {
    titleParts.push(
      t(
        "app_diskCopyBlocked",
        "External copy: blocked (browser requires user gesture)",
      ),
    );
  } else if (diskBackupInfo.error) {
    titleParts.push(
      t(
        "app_diskCopyError",
        "External copy failed: {{reason}}",
        { reason: diskBackupInfo.error },
      ),
    );
  } else if (diskBackupInfo.method && diskBackupAgeMs !== null) {
    const methodLabel =
      diskBackupInfo.method === "folder" ? "folder" : "download";
    titleParts.push(
      diskStale
        ? t(
            "app_diskCopyStale",
            "External copy ({{method}}): {{when}} (stale)",
            { method: methodLabel, when: compactAge(diskBackupAgeMs) },
          )
        : t(
            "app_diskCopyOk",
            "External copy ({{method}}): {{when}}",
            { method: methodLabel, when: compactAge(diskBackupAgeMs) },
          ),
    );
  } else {
    titleParts.push(t("app_diskCopyNone", "External copy: none"));
  }
  if (level === "caution" && usagePercent !== null) {
    titleParts.push(
      t(
        "app_storageWarning70",
        "Storage is {{percent}}% full — consider exporting a backup.",
        { percent: String(Math.round(usagePercent)) },
      ),
    );
  }
  if (level === "warning" && usagePercent !== null) {
    titleParts.push(
      t(
        "app_storageWarning85",
        "Storage is {{percent}}% full — export a backup soon.",
        { percent: String(Math.round(usagePercent)) },
      ),
    );
  }
  if (level === "critical" && usagePercent !== null) {
    titleParts.push(
      t(
        "app_storageWarning95",
        "Storage is {{percent}}% full — free space or export now.",
        { percent: String(Math.round(usagePercent)) },
      ),
    );
  }
  if (backupStale) {
    titleParts.push(
      backupAgeMs === null
        ? t(
            "app_backupNeverWarning",
            "No backup yet — export one to protect your vault.",
          )
        : t(
            "app_backupStaleWarning",
            "No backup in over 48 hours — export one now.",
          ),
    );
  }

  const levelTextClass =
    level === "critical"
      ? "ds-text-danger"
      : level === "warning"
        ? "text-orange-500 dark:text-orange-400"
        : level === "caution"
          ? "text-amber-500 dark:text-amber-400"
          : "ds-text-success dark:ds-text-success";

  return (
    <>
    <div
      className="flex items-center gap-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] px-3 py-1.5 rounded-full border border-[var(--divider)] dark:border-[var(--divider)]"
      title={titleParts.join(" · ")}
    >
      {warn ? (
        <AlertTriangle className={`size-3.5 ${levelTextClass}`} />
      ) : (
        <Database className="size-3.5" />
      )}
      <span className={levelTextClass}>
        {total} {t("app_rxdbReady")}
      </span>
      {quota && (
        <span className={levelTextClass}>
          ·{" "}
          {t("app_storageQuotaShort", "{{used}}/{{total}}", {
            used: formatBytes(quota.usage),
            total: formatBytes(quota.total),
          })}
        </span>
      )}
      {showFreeMeter && (
        <span
          className="text-amber-500 dark:text-amber-400"
          title={t("app_freeMeterTooltip", { limit: freeLimit })}
        >
          · {t("app_freeMeterLine", {
            used: freeCount,
            limit: freeLimit,
          })}
        </span>
      )}
      {usagePercent !== null && level !== "normal" && (
        <span className={levelTextClass}>
          · {Math.round(usagePercent)}%
        </span>
      )}
      {backupStale && backupAgeMs !== null && (
        <span className={levelTextClass}>
          · Backup {compactAge(backupAgeMs)}
        </span>
      )}
      {diskStale && (
        <span className="text-orange-500 dark:text-orange-400">
          · ⚠ {t(
            "app_diskCopyShort",
            diskBackupInfo.method === "download-blocked"
              ? "disk blocked"
              : diskBackupInfo.error
                ? "disk failed"
                : "disk stale",
          )}
        </span>
      )}
      {(level === "warning" || level === "critical") && (
        <button
          onClick={() => setShowCleanup(true)}
          className={`ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold transition-colors cursor-pointer truncate ${
            level === "critical"
              ? "text-white bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800"
              : "text-amber-900 dark:text-amber-100 bg-amber-400/80 hover:bg-amber-500/80 dark:bg-amber-600/60 dark:hover:bg-amber-500/60 border border-amber-500/30"
          }`}
        >
          {t("app_freeUpSpace", "Free up space")}
        </button>
      )}
    </div>
    <StorageCleanupDialog
      open={showCleanup}
      onClose={() => setShowCleanup(false)}
      percent={usagePercent}
      usageLabel={quota ? formatBytes(quota.usage) : undefined}
      quotaLabel={quota ? formatBytes(quota.total) : undefined}
    />
    </>
  );
}
