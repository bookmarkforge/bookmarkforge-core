import { test, expect } from "@playwright/test";

/**
 * Advanced Performance Tests
 * Tests for performance optimization, load handling, and resource management
 * These tests simulate human-like interactions with performance scenarios
 */

test.describe("Advanced Performance", () => {
  test("should handle large dataset rendering", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Load large dataset
    const loadButton = page.locator('[data-testid="load-large-dataset"]').first();
    if (await loadButton.count() > 0) {
      const startTime = Date.now();
      await loadButton.click();
      await page.waitForLoadState("networkidle");
      const renderTime = Date.now() - startTime;

      // Verify render time is acceptable
      expect(renderTime).toBeLessThan(5000); // 5 seconds max
    }
  });

  test("should handle memory-efficient rendering", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check memory before
    const memoryBefore = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });

    // Render content
    const renderButton = page.locator('[data-testid="render-content"]').first();
    if (await renderButton.count() > 0) {
      await renderButton.click();
      await page.waitForLoadState("networkidle");

      // Check memory after
      const memoryAfter = await page.evaluate(() => {
        return (performance as any).memory?.usedJSHeapSize || 0;
      });

      // Verify memory usage is reasonable
      const memoryIncrease = memoryAfter - memoryBefore;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB max increase
    }
  });

  test("should handle lazy loading", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Scroll to trigger lazy loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await page.waitForTimeout(500);

    // Verify lazy loaded content
    const lazyContent = page.locator('[data-testid="lazy-content"]').first();
    const isLoaded = await lazyContent.getAttribute("data-loaded");
    expect(isLoaded).toBe("true");
  });

  test("should handle virtual scrolling", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Enable virtual scrolling
    const virtualButton = page.locator('[data-testid="virtual-scroll"]').first();
    if (await virtualButton.count() > 0) {
      await virtualButton.click();

      // Scroll through large list
      await page.evaluate(() => {
        const list = document.querySelector('[data-testid="virtual-list"]');
        if (list) {
          list.scrollTop = 10000;
        }
      });

      // Verify virtual scrolling efficiency
      const visibleItems = page.locator('[data-testid="virtual-item"]').first();
      const itemCount = await visibleItems.count();
      expect(itemCount).toBeLessThan(50); // Should only render visible items
    }
  });

  test("should handle request debouncing for performance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    let requestCount = 0;
    await page.route("**/api/debounce-perf", async (route) => {
      requestCount++;
      route.fulfill({
        status: 200,
        body: JSON.stringify({ count: requestCount }),
      });
    });

    // Trigger rapid requests
    const searchInput = page.locator('[data-testid="search-input"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill("test");
      await searchInput.fill("test ");
      await searchInput.fill("test d");
      await searchInput.fill("test da");
      await searchInput.fill("test dat");

      // Wait for debounce
      await page.waitForTimeout(500);

      // Verify only one request was made
      expect(requestCount).toBe(1);
    }
  });

  test("should handle image optimization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Load optimized images
    const imageLoadTime = await page.evaluate(async () => {
      const startTime = Date.now();
      const images = document.querySelectorAll('img[data-optimized="true"]');
      await Promise.all(Array.from(images).map(img => {
        return new Promise((resolve) => {
          if ((img as HTMLImageElement).complete) resolve(true);
          (img as HTMLImageElement).onload = () => resolve(true);
        });
      }));
      return Date.now() - startTime;
    });

    // Verify images load quickly
    expect(imageLoadTime).toBeLessThan(3000); // 3 seconds max
  });

  test("should handle CSS optimization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check CSS performance
    const cssMetrics = await page.evaluate(() => {
      const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
      return {
        count: stylesheets.length,
        totalSize: Array.from(stylesheets).reduce((sum, sheet) => {
          return sum + ((sheet as HTMLLinkElement).sheet?.cssRules.length ?? 0);
        }, 0),
      };
    });

    // Verify CSS is optimized
    expect(cssMetrics.count).toBeLessThan(5); // Limited stylesheets
  });

  test("should handle JavaScript bundle optimization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check JS bundle performance
    const jsMetrics = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[src]');
      return {
        count: scripts.length,
        totalSize: Array.from(scripts).reduce((sum, script) => {
          return sum + (script as HTMLScriptElement).src.length;
        }, 0),
      };
    });

    // Verify JS bundles are optimized
    expect(jsMetrics.count).toBeLessThan(10); // Limited script files
  });

  test("should handle font loading optimization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check font loading
    const fontLoadTime = await page.evaluate(async () => {
      const startTime = Date.now();
      await document.fonts.ready;
      return Date.now() - startTime;
    });

    // Verify fonts load quickly
    expect(fontLoadTime).toBeLessThan(2000); // 2 seconds max
  });

  test("should handle critical CSS optimization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check critical CSS is inline
    const criticalCss = await page.evaluate(() => {
      const inlineStyles = document.querySelectorAll('style[data-critical="true"]');
      return inlineStyles.length > 0;
    });

    // Verify critical CSS optimization
    expect(criticalCss).toBeTruthy();
  });

  test("should handle resource preloading", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check preloaded resources
    const preloadedResources = await page.evaluate(() => {
      const preloadLinks = document.querySelectorAll('link[rel="preload"]');
      return Array.from(preloadLinks).map(link => ({
        type: (link as HTMLLinkElement).as,
        href: (link as HTMLLinkElement).href,
      }));
    });

    // Verify important resources are preloaded
    expect(preloadedResources.length).toBeGreaterThan(0);
  });

  test("should handle service worker caching", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check service worker status
    const swStatus = await page.evaluate(() => {
      return navigator.serviceWorker.getRegistration()
        .then(registration => registration?.active ? true : false)
        .catch(() => false);
    });

    // Verify service worker is active
    expect(swStatus).toBeTruthy();
  });

  test("should handle background sync", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger background sync
    const syncButton = page.locator('[data-testid="sync-button"]').first();
    if (await syncButton.count() > 0) {
      await syncButton.click();

      // Verify sync status
      const syncStatus = page.locator('[data-testid="sync-status"]').first();
      const isSynced = await syncStatus.getAttribute("data-synced");
      expect(isSynced).toBe("true");
    }
  });

  test("should handle request batching for performance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    let requestCount = 0;
    await page.route("**/api/batch-perf", async (route) => {
      requestCount++;
      route.fulfill({
        status: 200,
        body: JSON.stringify({ batched: true }),
      });
    });

    // Trigger batched requests
    const batchButton = page.locator('[data-testid="batch-perf-button"]').first();
    if (await batchButton.count() > 0) {
      await batchButton.click();

      // Verify requests were batched
      expect(requestCount).toBeLessThan(5); // Should batch multiple requests
    }
  });

  test("should handle connection pooling", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check connection reuse
    const connectionReuse = await page.evaluate(() => {
      return (performance as any).getEntriesByType("resource")
        .filter((entry: any) => entry.connectionReused)
        .length;
    });

    // Verify connections are reused
    expect(connectionReuse).toBeGreaterThan(0);
  });

  test("should handle HTTP/2 multiplexing", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check HTTP/2 usage
    const http2Resources = await page.evaluate(() => {
      return (performance as any).getEntriesByType("resource")
        .filter((entry: any) => entry.nextHopProtocol === "h2")
        .length;
    });

    // Verify HTTP/2 is used
    expect(http2Resources).toBeGreaterThan(0);
  });

  test("should handle compression efficiency", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check compression ratios
    const compressionStats = await page.evaluate(() => {
      const resources = (performance as any).getEntriesByType("resource");
      const compressed = resources.filter((r: any) => r.transferSize < r.encodedBodySize);
      return {
        total: resources.length,
        compressed: compressed.length,
        ratio: compressed.length / resources.length,
      };
    });

    // Verify compression is effective
    expect(compressionStats.ratio).toBeGreaterThan(0.5); // 50% compression rate
  });

  test("should handle CDN caching", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check CDN cache hits
    const cacheHits = await page.evaluate(() => {
      return (performance as any).getEntriesByType("resource")
        .filter((entry: any) => entry.transferSize === 0)
        .length;
    });

    // Verify CDN caching is working
    expect(cacheHits).toBeGreaterThan(0);
  });

  test("should handle browser caching", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Check cache hits
    const cacheHits = await page.evaluate(() => {
      return (performance as any).getEntriesByType("resource")
        .filter((entry: any) => entry.transferSize === 0)
        .length;
    });

    // Verify browser caching is working
    expect(cacheHits).toBeGreaterThan(0);
  });

  test("should handle performance monitoring", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check performance metrics
    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        firstPaint: (performance as any).getEntriesByType("paint")[0]?.startTime || 0,
        firstContentfulPaint: (performance as any).getEntriesByType("paint")[1]?.startTime || 0,
      };
    });

    // Verify performance metrics are acceptable
    expect(metrics.domContentLoaded).toBeLessThan(2000); // 2 seconds
    expect(metrics.loadComplete).toBeLessThan(5000); // 5 seconds
  });

  test("should handle Core Web Vitals", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check Core Web Vitals
    const vitals = await page.evaluate(() => {
      return new Promise((resolve) => {
        if (!(window as any).webVitals) {
          resolve({});
          return;
        }
        (window as any).webVitals.getCLS((metric: any) => {
          resolve({ cls: metric.value });
        });
        (window as any).webVitals.getFID((metric: any) => {
          resolve({ fid: metric.value });
        });
        (window as any).webVitals.getLCP((metric: any) => {
          resolve({ lcp: metric.value });
        });
      });
    });

    const metrics = vitals as { cls?: number; fid?: number; lcp?: number };

    // Verify Core Web Vitals are good
    if (metrics.cls) expect(metrics.cls).toBeLessThan(0.1); // CLS < 0.1
    if (metrics.fid) expect(metrics.fid).toBeLessThan(100); // FID < 100ms
    if (metrics.lcp) expect(metrics.lcp).toBeLessThan(2500); // LCP < 2.5s
  });

  test("should handle memory leak prevention", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check memory over time
    const memoryCheck1 = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });

    // Perform operations
    const operationButton = page.locator('[data-testid="operation-button"]').first();
    if (await operationButton.count() > 0) {
      for (let i = 0; i < 10; i++) {
        await operationButton.click();
        await page.waitForTimeout(100);
      }

      const memoryCheck2 = await page.evaluate(() => {
        return (performance as any).memory?.usedJSHeapSize || 0;
      });

      // Verify no significant memory increase
      const memoryIncrease = memoryCheck2 - memoryCheck1;
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // 10MB max increase
    }
  });

  test("should handle CPU efficiency", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check CPU usage during operation
    const cpuBefore = await page.evaluate(() => {
      return (performance as any).memory?.usedJSHeapSize || 0;
    });

    // Perform CPU-intensive operation
    const cpuButton = page.locator('[data-testid="cpu-button"]').first();
    if (await cpuButton.count() > 0) {
      const startTime = Date.now();
      await cpuButton.click();
      const operationTime = Date.now() - startTime;

      // Verify operation completes quickly
      expect(operationTime).toBeLessThan(1000); // 1 second max
    }
  });

  test("should handle rendering performance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check rendering performance
    const renderMetrics = await page.evaluate(() => {
      const startTime = performance.now();
      document.body.appendChild(document.createElement("div"));
      const endTime = performance.now();
      return endTime - startTime;
    });

    // Verify rendering is fast
    expect(renderMetrics).toBeLessThan(16); // 60fps = 16ms per frame
  });

  test("should handle animation performance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check animation performance
    const animationButton = page.locator('[data-testid="animation-button"]').first();
    if (await animationButton.count() > 0) {
      await animationButton.click();

      // Check animation frame rate
      const frameRate = await page.evaluate(() => {
        let frames = 0;
        const startTime = performance.now();
        return new Promise((resolve) => {
          const checkFrame = () => {
            frames++;
            if (performance.now() - startTime < 1000) {
              requestAnimationFrame(checkFrame);
            } else {
              resolve(frames);
            }
          };
          requestAnimationFrame(checkFrame);
        });
      });

      // Verify animation runs at 60fps
      expect(frameRate).toBeGreaterThan(55); // Allow some variance
    }
  });

  test("should handle scroll performance", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check scroll performance
    const scrollMetrics = await page.evaluate(() => {
      const startTime = performance.now();
      window.scrollTo(0, 1000);
      const endTime = performance.now();
      return endTime - startTime;
    });

    // Verify scrolling is smooth
    expect(scrollMetrics).toBeLessThan(100); // 100ms max
  });

  test("should handle input responsiveness", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check input response time
    const inputField = page.locator('[data-testid="input-field"]').first();
    if (await inputField.count() > 0) {
      const startTime = Date.now();
      await inputField.fill("test");
      const responseTime = Date.now() - startTime;

      // Verify input is responsive
      expect(responseTime).toBeLessThan(100); // 100ms max
    }
  });

  test("should handle click responsiveness", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check click response time
    const clickButton = page.locator('[data-testid="click-button"]').first();
    if (await clickButton.count() > 0) {
      const startTime = Date.now();
      await clickButton.click();
      const responseTime = Date.now() - startTime;

      // Verify click is responsive
      expect(responseTime).toBeLessThan(100); // 100ms max
    }
  });

  test("should handle page load performance", async ({ page }) => {
    const startTime = Date.now();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const loadTime = Date.now() - startTime;

    // Verify page loads quickly
    expect(loadTime).toBeLessThan(3000); // 3 seconds max
  });

  test("should handle resource loading priority", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check resource loading order
    const resourceOrder = await page.evaluate(() => {
      return (performance as any).getEntriesByType("resource")
        .map((entry: any) => ({
          name: entry.name,
          startTime: entry.startTime,
        }))
        .sort((a: any, b: any) => a.startTime - b.startTime);
    });

    // Verify critical resources load first
    const criticalResources = resourceOrder.filter((r: any) => 
      r.name.includes("critical") || r.name.includes("main")
    );
    expect(criticalResources.length).toBeGreaterThan(0);
  });

  test("should handle progressive enhancement", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check progressive enhancement
    const hasBasicFunctionality = await page.evaluate(() => {
      return document.querySelector('[data-enhanced="basic"]') !== null;
    });

    const hasEnhancedFunctionality = await page.evaluate(() => {
      return document.querySelector('[data-enhanced="advanced"]') !== null;
    });

    // Verify both basic and enhanced functionality exist
    expect(hasBasicFunctionality).toBeTruthy();
    expect(hasEnhancedFunctionality).toBeTruthy();
  });

  test("should handle graceful degradation", async ({ browser }) => {
    // Playwright has no setJavaScriptEnabled(): a JS-disabled run needs its
    // own context, so this test builds one instead of toggling the fixture.
    const jsDisabledContext = await browser.newContext({ javaScriptEnabled: false });
    const page = await jsDisabledContext.newPage();
    
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check basic functionality without JS
    const hasBasicContent = await page.evaluate(() => {
      return document.body.textContent?.length || 0;
    });

    // Re-enable JavaScript
    await jsDisabledContext.close();

    // Verify content is available without JS
    expect(hasBasicContent).toBeGreaterThan(0);
  });

  test("should handle performance budget", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check performance budget compliance
    const budgetMetrics = await page.evaluate(() => {
      const resources = (performance as any).getEntriesByType("resource");
      return {
        totalSize: resources.reduce((sum: number, r: any) => sum + r.transferSize, 0),
        scriptSize: resources.filter((r: any) => r.initiatorType === "script")
          .reduce((sum: number, r: any) => sum + r.transferSize, 0),
        cssSize: resources.filter((r: any) => r.initiatorType === "link")
          .reduce((sum: number, r: any) => sum + r.transferSize, 0),
        imageSize: resources.filter((r: any) => r.initiatorType === "img")
          .reduce((sum: number, r: any) => sum + r.transferSize, 0),
      };
    });

    // Verify performance budget
    expect(budgetMetrics.totalSize).toBeLessThan(3 * 1024 * 1024); // 3MB total
    expect(budgetMetrics.scriptSize).toBeLessThan(500 * 1024); // 500KB JS
    expect(budgetMetrics.cssSize).toBeLessThan(100 * 1024); // 100KB CSS
  });
});
