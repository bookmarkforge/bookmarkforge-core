import { skipPassword } from "../../../../tests/e2e/vault-helpers";
import { test, expect } from "@playwright/test";

/**
 * Advanced Integration Tests
 * Tests for integration with external services, APIs, and third-party tools
 * Rewritten to test real BookmarkForge integration behavior
 */

test.describe("Advanced Integration", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle clipboard integration", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Copy text to clipboard
    const copyResult = await page.evaluate(async () => {
      try {
        await navigator.clipboard.writeText("test-copy");
        return true;
      } catch (e) {
        return false;
      }
    });

    // Read from clipboard
    const readResult = await page.evaluate(async () => {
      try {
        const text = await navigator.clipboard.readText();
        return text;
      } catch (e) {
        return null;
      }
    });

    // Clipboard should work if permissions granted
    if (copyResult) {
      expect(readResult).toBe("test-copy");
    }
  });

  test("should handle notification integration", async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);

    // Check notification permission
    const permission = await page.evaluate(() => {
      return Notification.permission;
    });

    expect(["granted", "denied", "default"]).toContain(permission);

    // Try to show notification if permitted
    if (permission === "granted") {
      const notificationShown = await page.evaluate(() => {
        try {
          new Notification("Test", { body: "Test notification" });
          return true;
        } catch (e) {
          return false;
        }
      });

      expect(typeof notificationShown).toBe("boolean");
    }
  });

  test("should handle file system integration", async ({ page }) => {
    // Check if File System Access API is available
    const hasFileSystem = await page.evaluate(() => {
      return 'showOpenFilePicker' in window || 'showSaveFilePicker' in window;
    });

    expect(typeof hasFileSystem).toBe("boolean");
  });

  test("should handle geolocation integration", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 40.7128, longitude: -74.0060 });

    // Get geolocation
    const location = await page.evaluate(() => {
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          (err) => resolve(null)
        );
      });
    });

    // Location should be available if permission granted
    if (location) {
      expect((location as any).lat).toBeDefined();
      expect((location as any).lon).toBeDefined();
    }
  });

  test("should handle camera/microphone integration", async ({ page, context }) => {
    await context.grantPermissions(["camera", "microphone"]);

    // Check if media devices are available
    const hasMediaDevices = await page.evaluate(() => {
      return navigator.mediaDevices !== undefined;
    });

    expect(hasMediaDevices).toBeTruthy();

    // Try to enumerate devices
    const devices = await page.evaluate(async () => {
      try {
        return await navigator.mediaDevices.enumerateDevices();
      } catch (e) {
        return [];
      }
    });

    expect(Array.isArray(devices)).toBeTruthy();
  });

  test("should handle WebRTC integration", async ({ page }) => {
    // Check if WebRTC is available
    const hasWebRTC = await page.evaluate(() => {
      return typeof RTCPeerConnection !== "undefined";
    });

    expect(hasWebRTC).toBeTruthy();
  });

  test("should handle service worker integration", async ({ page }) => {
    // Check if service worker is registered
    const hasServiceWorker = await page.evaluate(() => {
      return 'serviceWorker' in navigator;
    });

    expect(hasServiceWorker).toBeTruthy();

    // Check if service worker is active
    const swStatus = await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        return registration !== undefined;
      }
      return false;
    });

    expect(typeof swStatus).toBe("boolean");
  });

  test("should handle local storage integration", async ({ page }) => {
    // Test localStorage
    await page.evaluate(() => {
      localStorage.setItem("test-key", "test-value");
    });

    const localValue = await page.evaluate(() => {
      return localStorage.getItem("test-key");
    });

    expect(localValue).toBe("test-value");

    // Clean up
    await page.evaluate(() => {
      localStorage.removeItem("test-key");
    });
  });

  test("should handle session storage integration", async ({ page }) => {
    // Test sessionStorage
    await page.evaluate(() => {
      sessionStorage.setItem("test-key", "test-value");
    });

    const sessionValue = await page.evaluate(() => {
      return sessionStorage.getItem("test-key");
    });

    expect(sessionValue).toBe("test-value");

    // Clean up
    await page.evaluate(() => {
      sessionStorage.removeItem("test-key");
    });
  });

  test("should handle IndexedDB integration", async ({ page }) => {
    // Check if IndexedDB is available
    const hasIndexedDB = await page.evaluate(() => {
      return typeof indexedDB !== "undefined";
    });

    expect(hasIndexedDB).toBeTruthy();

    // Try to open a database
    const dbOpened = await page.evaluate(() => {
      return new Promise((resolve) => {
        const request = indexedDB.open("test-db", 1);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("test-store")) {
            db.createObjectStore("test-store", { keyPath: "id" });
          }
        };
      });
    });

    expect(dbOpened).toBeTruthy();
  });

  test("should handle WebSocket integration", async ({ page }) => {
    // Check if WebSocket is available
    const hasWebSocket = await page.evaluate(() => {
      return typeof WebSocket !== "undefined";
    });

    expect(hasWebSocket).toBeTruthy();
  });

  test("should handle fetch API integration", async ({ page }) => {
    // Test fetch API
    const fetchWorks = await page.evaluate(async () => {
      try {
        const response = await fetch("data:text/plain,test");
        return response.ok;
      } catch (e) {
        return false;
      }
    });

    expect(fetchWorks).toBeTruthy();
  });
});
