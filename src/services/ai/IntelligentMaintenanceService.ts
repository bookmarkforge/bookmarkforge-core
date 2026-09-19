import { securityVault } from "../SecurityVault";
import {
  safeRepairCoordinator,
  type SafeRepairResult,
  type SafeRepairStatus,
} from "./SafeRepairCoordinator";
import { logger } from "../../utils/logger";
import { safeErrorForLog } from "../../utils/safeErrorForLog";
import { safeGet, safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { maintenanceHistoryService } from "./MaintenanceHistoryService";

const START_DELAY_MS = 15_000;
const CYCLE_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_REQUIRED_MS = 10_000;
const BATTERY_THRESHOLD = 0.15;
const MEMORY_PRESSURE_THRESHOLD = 0.85;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "input", "scroll"] as const;

type MaintenanceSkipReason =
  | "vault-locked"
  | "disabled"
  | "page-hidden"
  | "battery-low"
  | "memory-pressure";

interface IntelligentMaintenanceStatus extends SafeRepairStatus {
  enabled: boolean;
  waitingForIdle: boolean;
  lastSkippedReason: MaintenanceSkipReason | null;
}

interface BatteryLike {
  level: number;
  charging: boolean;
}

interface PerformanceWithMemory {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

class IntelligentMaintenanceService {
  private enabled = (() => {
    const stored = safeGet(STORAGE_KEYS.INTELLIGENT_MAINTENANCE_ENABLED);
    return stored === null ? true : stored === "true";
  })();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private started = false;
  private lastSkippedReason: MaintenanceSkipReason | null = null;
  private lastActivityAt = Date.now();
  private listeners = new Set<() => void>();
  private activityHandler: (() => void) | null = null;

  start(): void {
    if (this.started || typeof window === "undefined" || !this.enabled) return;
    this.started = true;
    this.lastActivityAt = Date.now();
    this.activityHandler = () => {
      this.lastActivityAt = Date.now();
      this.notify();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, this.activityHandler, { passive: true });
    }
    this.schedule(START_DELAY_MS);
    this.notify();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.timer = null;
    this.idleTimer = null;
    this.controller?.abort();
    this.controller = null;
    if (this.activityHandler && typeof window !== "undefined") {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, this.activityHandler);
      }
    }
    this.activityHandler = null;
    this.notify();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    safeSet(STORAGE_KEYS.INTELLIGENT_MAINTENANCE_ENABLED, String(enabled));
    if (enabled) {
      this.start();
      this.schedule(START_DELAY_MS);
    } else {
      this.stop();
    }
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory() {
    return maintenanceHistoryService.list();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Observers must never affect maintenance execution.
      }
    }
  }

  clearHistory(): void {
    maintenanceHistoryService.clear();
    this.notify();
  }

  getStatus(): IntelligentMaintenanceStatus {
    return {
      ...safeRepairCoordinator.getStatus(),
      enabled: this.enabled,
      waitingForIdle: this.idleTimer !== null,
      lastSkippedReason: this.lastSkippedReason,
    };
  }

  async runNow(): Promise<SafeRepairResult> {
    try {
      const result = await safeRepairCoordinator.run({ maxItems: 5 });
      maintenanceHistoryService.add({
        completedAt: new Date().toISOString(),
        status: result.status,
        repaired: result.repaired,
        failed: result.failed,
        skipped: result.skipped,
        operations: result.operations,
      });
      this.notify();
      return result;
    } catch (error) {
      logger.warn("[IntelligentMaintenance] Manual cycle failed", {
        error: safeErrorForLog(error),
      });
      throw error;
    }
  }

  private schedule(delay: number): void {
    if (!this.started || !this.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.waitForIdle();
    }, delay);
  }

  private waitForIdle(): void {
    if (!this.started || !this.enabled) return;
    const elapsed = Date.now() - this.lastActivityAt;
    if (elapsed < IDLE_REQUIRED_MS) {
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.waitForIdle();
      }, IDLE_REQUIRED_MS - elapsed);
      this.notify();
      return;
    }
    void this.runCycle();
  }

  private async runCycle(): Promise<void> {
    if (!this.started || !this.enabled || securityVault.isLocked()) {
      this.lastSkippedReason = securityVault.isLocked() ? "vault-locked" : "disabled";
      this.schedule(CYCLE_INTERVAL_MS);
      this.notify();
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.lastSkippedReason = "page-hidden";
      this.schedule(CYCLE_INTERVAL_MS);
      this.notify();
      return;
    }
    if (this.isMemoryPressureHigh()) {
      this.lastSkippedReason = "memory-pressure";
      this.schedule(CYCLE_INTERVAL_MS);
      this.notify();
      return;
    }
    if (await this.isBatteryTooLow()) {
      this.lastSkippedReason = "battery-low";
      this.schedule(CYCLE_INTERVAL_MS);
      this.notify();
      return;
    }

    this.lastSkippedReason = null;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    try {
      const result = await safeRepairCoordinator.run({
        signal: controller.signal,
        maxItems: 5,
      });
      maintenanceHistoryService.add({
        completedAt: new Date().toISOString(),
        status: result.status,
        repaired: result.repaired,
        failed: result.failed,
        skipped: result.skipped,
        operations: result.operations,
      });
      this.notify();
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        logger.warn("[IntelligentMaintenance] Cycle failed", {
          error: safeErrorForLog(error),
        });
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      this.notify();
      this.schedule(CYCLE_INTERVAL_MS);
    }
  }

  private isMemoryPressureHigh(): boolean {
    if (typeof performance === "undefined") return false;
    const memory = (performance as PerformanceWithMemory).memory;
    if (!memory || memory.jsHeapSizeLimit <= 0) return false;
    return memory.usedJSHeapSize / memory.jsHeapSizeLimit >= MEMORY_PRESSURE_THRESHOLD;
  }

  private async isBatteryTooLow(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("getBattery" in navigator)) return false;
    try {
      const battery = await (
        navigator as Navigator & { getBattery: () => Promise<BatteryLike> }
      ).getBattery();
      return !battery.charging && battery.level < BATTERY_THRESHOLD;
    } catch {
      return false;
    }
  }
}

export const intelligentMaintenanceService = new IntelligentMaintenanceService();

securityVault.onLock(() => intelligentMaintenanceService.stop());
securityVault.onUnlock(() => intelligentMaintenanceService.start());
