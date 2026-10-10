/**
 * NotificationService.test.ts
 *
 * Tests the NotificationService singleton which wraps the Notification API:
 *   1. requestPermission() — permission states (default/granted/denied/unavailable)
 *   2. sendNotification() — serviceWorker vs Notification constructor, sound
 *   3. scheduleSRSNotification() — dueCount guard, i18n, tag
 *   4. Edge cases — Notification API unavailable, permission denied after granted
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────

// Mock Notification constructor and static properties
const mockNotificationConstructor = vi.fn();
let mockPermissionValue: NotificationPermission = "default";
const mockRequestPermission = vi.fn().mockResolvedValue("granted");

// Mock serviceWorker
const mockShowNotification = vi.fn().mockResolvedValue(undefined);

/**
 * Apply base global stubs (Notification + navigator.serviceWorker).
 * Called at module scope (before import) AND in beforeEach via resetMocks()
 * to ensure stubs persist across all describe sections.
 */
function stubBaseGlobals(): void {
  // A previous reset defined `permission` as a getter-only accessor on the
  // shared mock constructor (below); Object.assign cannot overwrite it, so
  // clear it first (configurable: true makes the delete legal).
  delete (mockNotificationConstructor as unknown as { permission?: unknown })
    .permission;
  vi.stubGlobal("Notification", Object.assign(mockNotificationConstructor, {
    permission: mockPermissionValue,
    requestPermission: mockRequestPermission,
  }));
  Object.defineProperty(globalThis.Notification, "permission", {
    get: () => mockPermissionValue,
    configurable: true,
  });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({
        showNotification: mockShowNotification,
      }),
    },
  });
}

// Apply base stubs before importing the module under test
stubBaseGlobals();

// Mock soundManager
vi.mock("../../utils/soundManager", () => ({
  soundManager: {
    playNotification: vi.fn(),
  },
}));

// Mock i18n
vi.mock("../../i18n", () => ({
  default: {
    t: vi.fn((key: string, options?: Record<string, unknown>) => {
      if (key === "app_srsNotificationTitle") return "📚 Time to Review!";
      if (key === "app_srsNotificationBody") {
        const count = (options as any)?.count ?? 0;
        return `You have ${count} cards due for review.`;
      }
      return key;
    }),
  },
}));

// ── Import after mocks ───────────────────────────────────────────────

const { notificationService, NotificationService } = await import(
  "../../services/NotificationService"
);
const { soundManager } = await import("../../utils/soundManager");
const i18n = (await import("../../i18n")).default;

// ── Helpers ──────────────────────────────────────────────────────────

function resetMocks(): void {
  vi.clearAllMocks();

  // Reset Notification permission
  mockPermissionValue = "default";
  mockRequestPermission.mockResolvedValue("granted");
  mockNotificationConstructor.mockReset();

  // Reset serviceWorker
  mockShowNotification.mockResolvedValue(undefined);

  // Reset soundManager
  (soundManager.playNotification as any).mockReset();

  // Reset i18n
  (i18n.t as any).mockImplementation(
    (key: string, options?: Record<string, unknown>) => {
      if (key === "app_srsNotificationTitle") return "📚 Time to Review!";
      if (key === "app_srsNotificationBody") {
        const count = (options as any)?.count ?? 0;
        return `You have ${count} cards due for review.`;
      }
      return key;
    },
  );

  // Restore all globals to original first, then re-apply base stubs.
  // This prevents stub layer stacking across many tests.
  vi.unstubAllGlobals();
  stubBaseGlobals();

  // The singleton caches `permission` on the instance. Reset it so state
  // from a previous test cannot skip the requestPermission() branch.
  (notificationService as unknown as { permission: string }).permission =
    "default";
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: requestPermission — all 4 branch paths
// ═════════════════════════════════════════════════════════════════════

describe("NotificationService.requestPermission", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    // No need for vi.unstubAllGlobals() — resetMocks() in beforeEach
    // re-applies the base stubs via stubBaseGlobals().
  });

  test("returns false when Notification API is not available", async () => {
    // Remove Notification from global scope
    const origNotification = (globalThis as any).Notification;
    delete (globalThis as any).Notification;

    const result = await notificationService.requestPermission();

    expect(result).toBe(false);
    expect(mockRequestPermission).not.toHaveBeenCalled();

    // Restore
    (globalThis as any).Notification = origNotification;
  });

  test("returns false when permission is denied (without requesting)", async () => {
    mockPermissionValue = "denied";

    const result = await notificationService.requestPermission();

    expect(result).toBe(false);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  test("returns true when permission is already granted (without requesting)", async () => {
    mockPermissionValue = "granted";

    const result = await notificationService.requestPermission();

    expect(result).toBe(true);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  test("requests permission when status is default and returns true on granted", async () => {
    mockPermissionValue = "default";
    mockRequestPermission.mockResolvedValue("granted");

    const result = await notificationService.requestPermission();

    expect(result).toBe(true);
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  test("requests permission when status is default and returns false on denied", async () => {
    mockPermissionValue = "default";
    mockRequestPermission.mockResolvedValue("denied");

    const result = await notificationService.requestPermission();

    expect(result).toBe(false);
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  test("calls Notification.requestPermission exactly once", async () => {
    mockPermissionValue = "default";
    // The real API updates Notification.permission after requesting.
    mockRequestPermission.mockImplementation(async () => {
      mockPermissionValue = "granted";
      return "granted";
    });

    await notificationService.requestPermission();
    await notificationService.requestPermission();

    // Second call should not re-request because permission is now "granted"
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });

  test("returns false when Notification.requestPermission throws", async () => {
    mockPermissionValue = "default";
    mockRequestPermission.mockRejectedValue(new Error("User denied"));

    await expect(notificationService.requestPermission()).resolves.toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: sendNotification — serviceWorker vs Notification constructor
// ═════════════════════════════════════════════════════════════════════

describe("NotificationService.sendNotification", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    // No need for vi.unstubAllGlobals() — resetMocks() in beforeEach
    // re-applies the base stubs via stubBaseGlobals().
  });

  test("uses serviceWorker.showNotification when available and permission granted", async () => {
    mockPermissionValue = "granted";

    await notificationService.sendNotification("Test Title", {
      body: "Test body",
    });

    expect(mockShowNotification).toHaveBeenCalledWith("Test Title", {
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      body: "Test body",
    });
  });

  test("plays notification sound when sending", async () => {
    mockPermissionValue = "granted";

    await notificationService.sendNotification("Test");

    expect(soundManager.playNotification).toHaveBeenCalledTimes(1);
  });

  test("delivers the notification even when optional sound playback fails", async () => {
    mockPermissionValue = "granted";
    (soundManager.playNotification as ReturnType<typeof vi.fn>).mockImplementation(
      () => {
        throw new Error("AudioContext blocked");
      },
    );

    await expect(notificationService.sendNotification("Audible fallback")).resolves.toBeUndefined();

    expect(mockShowNotification).toHaveBeenCalledWith(
      "Audible fallback",
      expect.objectContaining({ icon: "/icon-192x192.png" }),
    );
  });

  test("uses Notification constructor when serviceWorker is not available", async () => {
    mockPermissionValue = "granted";
    // Remove serviceWorker from navigator (no key at all, so
    // `"serviceWorker" in navigator` is false).
    vi.stubGlobal("navigator", {});

    await notificationService.sendNotification("Direct Notification", {
      body: "Via constructor",
    });

    expect(mockNotificationConstructor).toHaveBeenCalledWith(
      "Direct Notification",
      expect.objectContaining({ body: "Via constructor" }),
    );
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  test("requests permission first when not granted, then sends if granted", async () => {
    mockPermissionValue = "default";
    mockRequestPermission.mockResolvedValue("granted");

    await notificationService.sendNotification("After Request");

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).toHaveBeenCalledWith(
      "After Request",
      expect.objectContaining({
        icon: "/icon-192x192.png",
      }),
    );
  });

  test("silently returns when permission request is denied", async () => {
    mockPermissionValue = "default";
    mockRequestPermission.mockResolvedValue("denied");

    await notificationService.sendNotification("Should Not Show");

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).not.toHaveBeenCalled();
    expect(mockNotificationConstructor).not.toHaveBeenCalled();
  });

  test("passes custom options through to the notification", async () => {
    mockPermissionValue = "granted";

    await notificationService.sendNotification("Custom", {
      tag: "custom-tag",
      data: { customKey: "value" },
      silent: true,
    });

    expect(mockShowNotification).toHaveBeenCalledWith("Custom", {
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
      tag: "custom-tag",
      data: { customKey: "value" },
      silent: true,
    });
  });

  test("overrides only the default icon/badge when custom icon/badge provided", async () => {
    mockPermissionValue = "granted";

    await notificationService.sendNotification("Custom Icon", {
      icon: "/custom-icon.png",
    });

    expect(mockShowNotification).toHaveBeenCalledWith("Custom Icon", {
      icon: "/custom-icon.png",
      badge: "/badge-72x72.png",
    });
  });

  test("falls back to Notification constructor when no SW registration exists", async () => {
    mockPermissionValue = "granted";
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue(undefined),
      },
    });

    // getRegistration() resolves undefined when no SW is registered; the
    // service must take the constructor path instead of hanging on ready.
    await notificationService.sendNotification("No SW registered");

    expect(mockShowNotification).not.toHaveBeenCalled();
    expect(mockNotificationConstructor).toHaveBeenCalledWith("No SW registered", {
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: scheduleSRSNotification — dueCount guard + i18n
// ═════════════════════════════════════════════════════════════════════

describe("NotificationService.scheduleSRSNotification", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    // No need for vi.unstubAllGlobals() — resetMocks() in beforeEach
    // re-applies the base stubs via stubBaseGlobals().
  });

  test("returns early without sending when dueCount is 0", async () => {
    await notificationService.scheduleSRSNotification(0);

    expect(i18n.t).not.toHaveBeenCalled();
    expect(mockShowNotification).not.toHaveBeenCalled();
    expect(soundManager.playNotification).not.toHaveBeenCalled();
  });

  test("returns early without sending when dueCount is negative", async () => {
    await notificationService.scheduleSRSNotification(-5);

    expect(i18n.t).not.toHaveBeenCalled();
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  test("returns early without sending when dueCount is not finite", async () => {
    await notificationService.scheduleSRSNotification(Number.NaN);
    await notificationService.scheduleSRSNotification(Number.POSITIVE_INFINITY);

    expect(i18n.t).not.toHaveBeenCalled();
    expect(mockShowNotification).not.toHaveBeenCalled();
  });

  test("sends notification with correct i18n title when dueCount > 0", async () => {
    mockPermissionValue = "granted";

    await notificationService.scheduleSRSNotification(3);

    expect(i18n.t).toHaveBeenCalledWith("app_srsNotificationTitle");
    expect(i18n.t).toHaveBeenCalledWith("app_srsNotificationBody", {
      count: 3,
    });
    expect(mockShowNotification).toHaveBeenCalledWith(
      "📚 Time to Review!",
      expect.objectContaining({
        body: "You have 3 cards due for review.",
        tag: "srs-review",
      }),
    );
  });

  test("uses tag 'srs-review' for all SRS notifications", async () => {
    mockPermissionValue = "granted";

    await notificationService.scheduleSRSNotification(10);

    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tag: "srs-review" }),
    );
  });

  test("handles single card (dueCount = 1)", async () => {
    mockPermissionValue = "granted";

    await notificationService.scheduleSRSNotification(1);

    expect(i18n.t).toHaveBeenCalledWith("app_srsNotificationBody", {
      count: 1,
    });
    expect(mockShowNotification).toHaveBeenCalled();
  });

  test("handles large dueCount (999+)", async () => {
    mockPermissionValue = "granted";

    await notificationService.scheduleSRSNotification(999);

    expect(mockShowNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: "You have 999 cards due for review.",
      }),
    );
  });

  test("requests permission if not granted before sending SRS notification", async () => {
    mockPermissionValue = "default";
    mockRequestPermission.mockResolvedValue("granted");

    await notificationService.scheduleSRSNotification(5);

    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockShowNotification).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: Edge cases — Notification API unavailable, mixed scenarios
// ═════════════════════════════════════════════════════════════════════

describe("NotificationService — edge cases", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    // No need for vi.unstubAllGlobals() — resetMocks() in beforeEach
    // re-applies the base stubs via stubBaseGlobals().
  });

  test("handles getRegistration rejection gracefully", async () => {
    mockPermissionValue = "granted";
    const swReject = Promise.reject(new Error("SW registration not found"));
    swReject.catch(() => { /* INTENTIONAL SILENCE: the test asserts the rejection separately. */ }); // Suppress vitest unhandled rejection detection
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn().mockReturnValue(swReject),
      },
    });

    await expect(
      notificationService.sendNotification("Test"),
    ).resolves.toBeUndefined();
  });

  test("sendNotification without serviceWorker falls back to Notification constructor with defaults", async () => {
    mockPermissionValue = "granted";
    // No serviceWorker key at all so the service takes the constructor path.
    vi.stubGlobal("navigator", {});

    await notificationService.sendNotification("Fallback");

    expect(mockShowNotification).not.toHaveBeenCalled();
    expect(mockNotificationConstructor).toHaveBeenCalledWith("Fallback", {
      icon: "/icon-192x192.png",
      badge: "/badge-72x72.png",
    });
  });

  test("multiple consecutive sendNotification calls all succeed", async () => {
    mockPermissionValue = "granted";

    await notificationService.sendNotification("First");
    await notificationService.sendNotification("Second");
    await notificationService.sendNotification("Third");

    expect(mockShowNotification).toHaveBeenCalledTimes(3);
    expect(soundManager.playNotification).toHaveBeenCalledTimes(3);
  });

  test("scheduleSRSNotification and sendNotification mix correctly", async () => {
    mockPermissionValue = "granted";

    await notificationService.sendNotification("Manual", { tag: "manual" });
    await notificationService.scheduleSRSNotification(2);
    await notificationService.sendNotification("Another", { tag: "another" });

    expect(mockShowNotification).toHaveBeenCalledTimes(3);

    // Check tags
    const calls = mockShowNotification.mock.calls.map((c: any[]) => c[1].tag);
    expect(calls).toEqual(["manual", "srs-review", "another"]);
  });

  test("swallows Notification constructor failures", async () => {
    mockPermissionValue = "granted";
    // No serviceWorker key so the constructor path is exercised.
    vi.stubGlobal("navigator", {});
    mockNotificationConstructor.mockImplementation(function () {
      throw new Error("Notification constructor blocked");
    });

    // NOTE: The source does NOT have a try/catch around
    // new Notification(title, options), so the error propagates.
    // If a try/catch is added to the source in the future, this test
    // should be updated to expect().resolves.toBeUndefined() instead.
    await expect(
      notificationService.sendNotification("Blocked"),
    ).resolves.toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: Singleton behavior
// ═════════════════════════════════════════════════════════════════════

describe("NotificationService — singleton", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("notificationService is a singleton instance", () => {
    expect(notificationService).toBeDefined();
    expect(notificationService.constructor.name).toBe("NotificationService");
  });

  test("all methods exist on the instance", () => {
    expect(typeof notificationService.requestPermission).toBe("function");
    expect(typeof notificationService.sendNotification).toBe("function");
    expect(typeof notificationService.scheduleSRSNotification).toBe("function");
  });

  test("getInstance returns the same instance", () => {
    const instance1 = NotificationService.getInstance();
    const instance2 = NotificationService.getInstance();
    expect(instance1).toBe(instance2);
  });
});
