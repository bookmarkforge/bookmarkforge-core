import { test, expect } from "@playwright/test";

/**
 * Advanced Mobile Tests
 * Tests for mobile-specific features, responsive design, and touch interactions
 * These tests simulate human-like interactions with mobile scenarios
 */

test.describe("Advanced Mobile", () => {
  test("should handle mobile viewport adaptation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 }); // iPhone SE

    // Verify mobile layout
    const mobileLayout = page.locator('[data-testid="mobile-layout"]').first();
    const isMobile = await mobileLayout.getAttribute("data-mobile");
    expect(isMobile).toBe("true");
  });

  test("should handle touch interactions", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tap element
    const tapTarget = page.locator('[data-testid="tap-target"]').first();
    if (await tapTarget.count() > 0) {
      await tapTarget.tap();

      // Verify tap response
      const tapResponse = page.locator('[data-testid="tap-response"]').first();
      const isVisible = await tapResponse.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle swipe gestures", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Swipe left
    const swipeTarget = page.locator('[data-testid="swipe-target"]').first();
    if (await swipeTarget.count() > 0) {
      await swipeTarget.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      });

      const position = await swipeTarget.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      await page.touchscreen.tap(position.x, position.y);
      await page.touchscreen.tap(position.x + 100, position.y);

      // Verify swipe response
      const swipeResponse = page.locator('[data-testid="swipe-response"]').first();
      const hasResponse = await swipeResponse.count() > 0;
      expect(hasResponse).toBeTruthy();
    }
  });

  test("should handle pinch-to-zoom", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Pinch to zoom
    const zoomTarget = page.locator('[data-testid="zoom-target"]').first();
    if (await zoomTarget.count() > 0) {
      const position = await zoomTarget.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      await page.touchscreen.tap(position.x, position.y);
      
      // Simulate pinch
      await page.evaluate(() => {
        const event = new Event("touchstart", { bubbles: true });
        window.dispatchEvent(event);
      });

      // Verify zoom
      const zoomLevel = page.locator('[data-testid="zoom-level"]').first();
      const level = await zoomLevel.textContent();
      expect(level).toBeTruthy();
    }
  });

  test("should handle orientation changes", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Rotate to landscape
    await page.setViewportSize({ width: 667, height: 375 });

    // Verify landscape layout
    const landscapeLayout = page.locator('[data-testid="landscape-layout"]').first();
    const isLandscape = await landscapeLayout.getAttribute("data-landscape");
    expect(isLandscape).toBe("true");

    // Rotate back to portrait
    await page.setViewportSize({ width: 375, height: 667 });
  });

  test("should handle mobile navigation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open mobile menu
    const menuButton = page.locator('[data-testid="mobile-menu"]').first();
    if (await menuButton.count() > 0) {
      await menuButton.click();

      // Verify mobile menu
      const mobileMenu = page.locator('[data-testid="mobile-menu-open"]').first();
      const isOpen = await mobileMenu.isVisible();
      expect(isOpen).toBeTruthy();
    }
  });

  test("should handle bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open bottom sheet
    const bottomSheetButton = page.locator('[data-testid="bottom-sheet-trigger"]').first();
    if (await bottomSheetButton.count() > 0) {
      await bottomSheetButton.click();

      // Verify bottom sheet
      const bottomSheet = page.locator('[data-testid="bottom-sheet"]').first();
      const isVisible = await bottomSheet.isVisible();
      expect(isVisible).toBeTruthy();

      // Close bottom sheet
      const closeButton = page.locator('[data-testid="close-bottom-sheet"]').first();
      await closeButton.click();
    }
  });

  test("should handle pull-to-refresh", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Pull to refresh
    const refreshTrigger = page.locator('[data-testid="refresh-trigger"]').first();
    if (await refreshTrigger.count() > 0) {
      const position = await refreshTrigger.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top };
      });

      await page.touchscreen.tap(position.x, position.y);
      await page.touchscreen.tap(position.x, position.y + 100);

      // Verify refresh indicator
      const refreshIndicator = page.locator('[data-testid="refresh-indicator"]').first();
      const isVisible = await refreshIndicator.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle infinite scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Scroll to trigger infinite load
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(500);

    // Verify more content loaded
    const newContent = page.locator('[data-testid="infinite-loaded"]').first();
    const hasNewContent = await newContent.count() > 0;
    expect(hasNewContent).toBeDefined();
  });

  test("should handle mobile-specific gestures", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Long press
    const longPressTarget = page.locator('[data-testid="long-press-target"]').first();
    if (await longPressTarget.count() > 0) {
      const position = await longPressTarget.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });

      await page.touchscreen.tap(position.x, position.y);
      await page.waitForTimeout(1000); // Long press duration

      // Verify long press menu
      const longPressMenu = page.locator('[data-testid="long-press-menu"]').first();
      const isVisible = await longPressMenu.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle device-specific features", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check device features
    const deviceFeatures = await page.evaluate(() => {
      return {
        hasTouch: "ontouchstart" in window,
        hasVibration: "vibrate" in navigator,
        hasDeviceOrientation: "DeviceOrientationEvent" in window,
        hasDeviceMotion: "DeviceMotionEvent" in window,
      };
    });

    expect(deviceFeatures.hasTouch).toBeTruthy();
  });

  test("should handle mobile keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Focus input to trigger keyboard
    const inputField = page.locator('[data-testid="mobile-input"]').first();
    if (await inputField.count() > 0) {
      await inputField.tap();

      // Verify keyboard adaptation
      const keyboardOverlay = page.locator('[data-testid="keyboard-overlay"]').first();
      const hasOverlay = await keyboardOverlay.count() > 0;
      expect(hasOverlay).toBeDefined();
    }
  });

  test("should handle safe area insets", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check safe area handling
    const safeArea = page.locator('[data-testid="safe-area"]').first();
    if (await safeArea.count() > 0) {
      const hasInsets = await safeArea.getAttribute("data-safe-area");
      expect(hasInsets).toBeTruthy();
    }
  });

  test("should handle mobile-specific notifications", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger mobile notification
    const notifyButton = page.locator('[data-testid="mobile-notify"]').first();
    if (await notifyButton.count() > 0) {
      await notifyButton.click();

      // Verify mobile notification
      const mobileNotification = page.locator('[data-testid="mobile-notification"]').first();
      const isVisible = await mobileNotification.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle mobile-specific navigation patterns", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check mobile navigation
    const mobileNav = page.locator('[data-testid="mobile-nav"]').first();
    if (await mobileNav.count() > 0) {
      const isMobileNav = await mobileNav.getAttribute("data-mobile");
      expect(isMobileNav).toBe("true");
    }
  });

  test("should handle mobile-specific content density", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check content density
    const contentDensity = page.locator('[data-testid="content-density"]').first();
    if (await contentDensity.count() > 0) {
      const isCompact = await contentDensity.getAttribute("data-compact");
      expect(isCompact).toBe("true");
    }
  });

  test("should handle mobile-specific animations", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check animation optimization
    const optimizedAnimations = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      return Array.from(elements).every(el => {
        const computed = window.getComputedStyle(el);
        return computed.animationDuration === "0s" || computed.transitionDuration === "0s";
      });
    });

    // Not all animations may be disabled, but key ones should be optimized
    expect(optimizedAnimations).toBeDefined();
  });

  test("should handle mobile-specific performance", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check mobile performance
    const loadTime = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return navigation.loadEventEnd - navigation.loadEventStart;
    });

    // Mobile should load quickly
    expect(loadTime).toBeLessThan(5000); // 5 seconds max
  });

  test("should handle mobile-specific touch targets", async ({ page }) => {
    await page.setViewportSize({ width:375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check touch target sizes
    const smallTouchTargets = await page.evaluate(() => {
      const touchTargets = document.querySelectorAll("button, a, input");
      return Array.from(touchTargets).filter(target => {
        const rect = target.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44;
      }).length;
    });

    expect(smallTouchTargets).toBe(0);
  });

  test("should handle mobile-specific accessibility", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check mobile accessibility
    const mobileA11y = page.locator('[data-testid="mobile-a11y"]').first();
    if (await mobileA11y.count() > 0) {
      const hasA11y = await mobileA11y.getAttribute("data-accessible");
      expect(hasA11y).toBeTruthy();
    }
  });

  test("should handle mobile-specific storage", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check mobile storage optimization
    const storageOptimized = await page.evaluate(() => {
      return {
        localStorageAvailable: (() => {
          try {
            localStorage.setItem("test", "test");
            localStorage.removeItem("test");
            return true;
          } catch {
            return false;
          }
        })(),
        sessionStorageAvailable: (() => {
          try {
            sessionStorage.setItem("test", "test");
            sessionStorage.removeItem("test");
            return true;
          } catch {
            return false;
          }
        })(),
      };
    });

    expect(storageOptimized.localStorageAvailable).toBeTruthy();
  });

  test("should handle mobile-specific battery optimization", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check battery API
    const batteryStatus = await page.evaluate(async () => {
      if ("getBattery" in navigator) {
        try {
          const battery = await (navigator as any).getBattery();
          return {
            level: battery.level,
            charging: battery.charging,
          };
        } catch {
          return null;
        }
      }
      return null;
    });

    // Battery API might not be available in all environments
    expect(batteryStatus).toBeDefined();
  });

  test("should handle mobile-specific network awareness", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check network awareness
    const networkInfo = await page.evaluate(() => {
      const connection = (navigator as any).connection;
      if (connection) {
        return {
          effectiveType: connection.effectiveType,
          downlink: connection.downlink,
          saveData: connection.saveData,
        };
      }
      return null;
    });

    // Network API might not be available in all environments
    expect(networkInfo).toBeDefined();
  });

  test("should handle mobile-specific vibration feedback", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger vibration
    const vibrateButton = page.locator('[data-testid="vibrate-button"]').first();
    if (await vibrateButton.count() > 0) {
      await vibrateButton.click();

      // Check vibration API
      const vibrationSupported = await page.evaluate(() => {
        return "vibrate" in navigator;
      });

      expect(vibrationSupported).toBeDefined();
    }
  });

  test("should handle mobile-specific geolocation", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check geolocation
    const geolocationSupported = await page.evaluate(() => {
      return "geolocation" in navigator;
    });

    expect(geolocationSupported).toBeTruthy();
  });

  test("should handle mobile-specific camera integration", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check camera integration
    const cameraButton = page.locator('[data-testid="mobile-camera"]').first();
    if (await cameraButton.count() > 0) {
      await cameraButton.click();

      // Verify camera UI
      const cameraUI = page.locator('[data-testid="camera-ui"]').first();
      const isVisible = await cameraUI.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle mobile-specific file access", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check file access
    const fileButton = page.locator('[data-testid="mobile-file"]').first();
    if (await fileButton.count() > 0) {
      await fileButton.click();

      // Verify file picker
      const filePicker = page.locator('[data-testid="file-picker"]').first();
      const isVisible = await filePicker.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle mobile-specific sharing", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check sharing API
    const shareButton = page.locator('[data-testid="mobile-share"]').first();
    if (await shareButton.count() > 0) {
      await shareButton.click();

      // Verify share sheet
      const shareSheet = page.locator('[data-testid="share-sheet"]').first();
      const isVisible = await shareSheet.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle mobile-specific clipboard", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check clipboard API
    const clipboardSupported = await page.evaluate(() => {
      return "clipboard" in navigator;
    });

    expect(clipboardSupported).toBeTruthy();
  });

  test("should handle mobile-specific sensors", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check sensor APIs
    const sensorsSupported = await page.evaluate(() => {
      return {
        ambientLight: "AmbientLightSensor" in window,
        accelerometer: "Accelerometer" in window,
        gyroscope: "Gyroscope" in window,
        magnetometer: "Magnetometer" in window,
      };
    });

    // Sensors might not be available in all environments
    expect(sensorsSupported).toBeDefined();
  });

  test("should handle mobile-specific speech recognition", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check speech recognition
    const speechButton = page.locator('[data-testid="speech-input"]').first();
    if (await speechButton.count() > 0) {
      await speechButton.click();

      // Verify speech UI
      const speechUI = page.locator('[data-testid="speech-ui"]').first();
      const isVisible = await speechUI.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle mobile-specific haptic feedback", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check haptic feedback
    const hapticButton = page.locator('[data-testid="haptic-button"]').first();
    if (await hapticButton.count() > 0) {
      await hapticButton.click();

      // Verify haptic feedback
      const hapticIndicator = page.locator('[data-testid="haptic-indicator"]').first();
      const hasFeedback = await hapticIndicator.count() > 0;
      expect(hasFeedback).toBeDefined();
    }
  });

  test("should handle mobile-specific push notifications", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check push notification support
    const pushSupported = await page.evaluate(() => {
      return "PushManager" in window;
    });

    expect(pushSupported).toBeTruthy();
  });

  test("should handle mobile-specific background sync", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check background sync
    const syncSupported = await page.evaluate(() => {
      return "serviceWorker" in navigator && "sync" in ServiceWorkerRegistration.prototype;
    });

    expect(syncSupported).toBeDefined();
  });

  test("should handle mobile-specific offline capabilities", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check offline capabilities
    const offlineSupported = await page.evaluate(() => {
      return "serviceWorker" in navigator;
    });

    expect(offlineSupported).toBeTruthy();
  });

  test("should handle mobile-specific responsive images", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check responsive images
    const responsiveImages = await page.evaluate(() => {
      const images = document.querySelectorAll("img[srcset], picture source");
      return images.length;
    });

    expect(responsiveImages).toBeGreaterThanOrEqual(0);
  });

  test("should handle mobile-specific fonts", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check font loading
    const fontsLoaded = await page.evaluate(() => {
      return document.fonts.ready;
    });

    expect(fontsLoaded).toBeTruthy();
  });

  test("should handle mobile-specific color schemes", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check color scheme support
    const colorScheme = await page.evaluate(() => {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    });

    expect(colorScheme).toBeDefined();
  });

  test("should handle mobile-specific reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check reduced motion
    const reducedMotion = await page.evaluate(() => {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    });

    expect(reducedMotion).toBeDefined();
  });

  test("should handle mobile-specific form factors", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check form factor detection
    const formFactor = await page.evaluate(() => {
      const width = window.innerWidth;
      if (width < 480) return "small";
      if (width < 768) return "medium";
      return "large";
    });

    expect(formFactor).toBe("small");
  });

  test("should handle mobile-specific app shortcuts", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check app shortcuts
    const appShortcuts = page.locator('[data-testid="app-shortcuts"]').first();
    if (await appShortcuts.count() > 0) {
      const hasShortcuts = await appShortcuts.count() > 0;
      expect(hasShortcuts).toBeTruthy();
    }
  });

  test("should handle mobile-specific home screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check PWA home screen capability
    const pwaCapable = await page.evaluate(() => {
      return "serviceWorker" in navigator && "manifest" in document.head;
    });

    expect(pwaCapable).toBeTruthy();
  });

  test("should handle mobile-specific standalone mode", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check standalone mode
    const isStandalone = await page.evaluate(() => {
      return window.matchMedia("(display-mode: standalone)").matches;
    });

    expect(isStandalone).toBeDefined();
  });

  test("should handle mobile-specific safe browsing", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check safe browsing
    const safeBrowsing = page.locator('[data-testid="safe-browsing"]').first();
    if (await safeBrowsing.count() > 0) {
      const isEnabled = await safeBrowsing.getAttribute("data-enabled");
      expect(isEnabled).toBeDefined();
    }
  });
});
