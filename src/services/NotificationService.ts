import i18n from "../i18n";
import { soundManager } from "../utils/soundManager";
import { logger } from "../utils/logger";

export class NotificationService {
  private static instance: NotificationService;
  private permission: NotificationPermission = "default";
  private permissionRequest: Promise<boolean> | null = null;

  private constructor() {
    if (this.hasNotificationApi()) {
      this.permission = Notification.permission;
    }
  }

  private hasNotificationApi(): boolean {
    return typeof window !== "undefined" && "Notification" in window;
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  async requestPermission(): Promise<boolean> {
    if (!this.hasNotificationApi()) {
      return false;
    }
    this.permission = Notification.permission;
    if (this.permission === "denied") {
      return false;
    }
    if (this.permission === "granted") {
      return true;
    }
    // Multiple startup callers can request permission at once. Reuse the
    // same promise so the browser receives one permission prompt, not one
    // prompt per component/effect.
    if (this.permissionRequest) {
      return this.permissionRequest;
    }
    this.permissionRequest = (async () => {
      try {
        this.permission = await Notification.requestPermission();
        return this.permission === "granted";
      } catch (error) {
        this.permission = Notification.permission;
        logger.warn("[NotificationService] Permission request failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        this.permissionRequest = null;
      }
    })();
    return this.permissionRequest;
  }

  async sendNotification(title: string, options?: NotificationOptions) {
    if (!this.hasNotificationApi()) {
      return;
    }

    // Permission can be revoked in browser settings after this singleton was
    // created; always reconcile the cached value before attempting delivery.
    this.permission = Notification.permission;
    if (this.permission !== "granted") {
      const granted = await this.requestPermission();
      if (!granted) {
        return;
      }
    }

    try {
      soundManager.playNotification();
    } catch (error) {
      // Audio is optional; a blocked AudioContext must not prevent the
      // notification itself from being delivered.
      logger.warn("[NotificationService] Notification sound failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // navigator.serviceWorker.ready never resolves when no service
      // worker is registered (this app does not register one), which would
      // hang delivery forever. Use getRegistration() instead and fall back
      // to the Notification constructor when no SW registration exists.
      const registration =
        typeof navigator !== "undefined" && "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined;
      if (registration) {
        await registration.showNotification(title, {
          icon: "/icon-192x192.png",
          badge: "/badge-72x72.png",
          ...options,
        });
      } else {
        new Notification(title, {
          icon: "/icon-192x192.png",
          badge: "/badge-72x72.png",
          ...options,
        });
      }
    } catch (error) {
      // Notifications are best-effort: an unregistered/blocked service
      // worker must not turn a background SRS check into an unhandled error.
      logger.warn("[NotificationService] Notification delivery failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async scheduleSRSNotification(dueCount: number) {
    if (!Number.isFinite(dueCount) || dueCount <= 0) {
      return;
    }

    const title = i18n.t("app_srsNotificationTitle");
    const body = i18n.t("app_srsNotificationBody", { count: dueCount });

    await this.sendNotification(title, {
      body,
      tag: "srs-review",
    });
  }
}

export const notificationService = NotificationService.getInstance();
