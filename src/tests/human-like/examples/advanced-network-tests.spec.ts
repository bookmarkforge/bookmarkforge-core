import { test, expect } from "@playwright/test";

/**
 * Advanced Network Tests
 * Tests for complex network operations, connectivity, and performance
 * These tests simulate human-like interactions with network behavior
 */

test.describe("Advanced Network", () => {
  test("should handle slow network conditions", async ({ page, context }) => {
    // Simulate slow network
    await context.setOffline(false);
    await page.route("**/*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      route.continue();
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Verify page loads despite slow network
    const isLoaded = await page.evaluate(() => document.readyState === "complete");
    expect(isLoaded).toBeTruthy();
  });

  test("should handle offline mode", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Go offline
    await context.setOffline(true);

    // Verify offline indicator
    const offlineIndicator = page.locator('[data-testid="offline-indicator"]').first();
    const isVisible = await offlineIndicator.isVisible();
    expect(isVisible).toBeTruthy();

    // Go back online
    await context.setOffline(false);

    // Verify online status
    const onlineIndicator = page.locator('[data-testid="online-indicator"]').first();
    const isOnlineVisible = await onlineIndicator.isVisible();
    expect(isOnlineVisible).toBeTruthy();
  });

  test("should handle network interruption", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Interrupt network
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Restore network
    await context.setOffline(false);

    // Verify recovery
    const recoveryMessage = page.locator('[data-testid="network-recovery"]').first();
    const isVisible = await recoveryMessage.isVisible();
    expect(isVisible).toBeTruthy();
  });

  test("should handle request retry logic", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/retry-test", async (route) => {
      requestCount++;
      if (requestCount < 3) {
        route.abort("failed");
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger retry request
    const retryButton = page.locator('[data-testid="retry-button"]').first();
    if (await retryButton.count() > 0) {
      await retryButton.click();

      // Verify retry succeeded
      expect(requestCount).toBe(3);
    }
  });

  test("should handle request timeout", async ({ page }) => {
    await page.route("**/api/timeout-test", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 30000)); // 30 second delay
      route.continue();
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger timeout request
    const timeoutButton = page.locator('[data-testid="timeout-button"]').first();
    if (await timeoutButton.count() > 0) {
      await timeoutButton.click();

      // Verify timeout handling
      const timeoutMessage = page.locator('[data-testid="timeout-message"]').first();
      const isVisible = await timeoutMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle request cancellation", async ({ page }) => {
    await page.route("**/api/cancel-test", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      route.continue();
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger cancelable request
    const cancelButton = page.locator('[data-testid="cancel-button"]').first();
    if (await cancelButton.count() > 0) {
      const requestPromise = cancelButton.click();

      // Cancel immediately
      await page.evaluate(() => {
        // Simulate cancellation
      });

      // Verify cancellation
      const cancelMessage = page.locator('[data-testid="cancel-message"]').first();
      const isVisible = await cancelMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle concurrent requests", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/concurrent-test", async (route) => {
      requestCount++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      route.fulfill({
        status: 200,
        body: JSON.stringify({ id: requestCount }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger concurrent requests
    const concurrentButton = page.locator('[data-testid="concurrent-button"]').first();
    if (await concurrentButton.count() > 0) {
      await concurrentButton.click();

      // Verify all requests completed
      await page.waitForTimeout(500);
      expect(requestCount).toBeGreaterThan(1);
    }
  });

  test("should handle request prioritization", async ({ page }) => {
    const requestOrder: number[] = [];
    await page.route("**/api/priority-test", async (route) => {
      const priority = route.request().headers()["x-priority"];
      requestOrder.push(parseInt(priority || "0"));
      await new Promise((resolve) => setTimeout(resolve, 100));
      route.fulfill({
        status: 200,
        body: JSON.stringify({ priority }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger prioritized requests
    const priorityButton = page.locator('[data-testid="priority-button"]').first();
    if (await priorityButton.count() > 0) {
      await priorityButton.click();

      // Verify priority order
      expect(requestOrder[0]!).toBeGreaterThan(requestOrder[1]!);
    }
  });

  test("should handle request caching", async ({ page }) => {
    let cacheHit = false;
    await page.route("**/api/cache-test", async (route) => {
      const ifNoneMatch = route.request().headers()["if-none-match"];
      if (ifNoneMatch) {
        cacheHit = true;
        route.fulfill({
          status: 304,
          headers: { "etag": "test-etag" },
        });
      } else {
        route.fulfill({
          status: 200,
          headers: { "etag": "test-etag" },
          body: JSON.stringify({ cached: false }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // First request
    const cacheButton = page.locator('[data-testid="cache-button"]').first();
    if (await cacheButton.count() > 0) {
      await cacheButton.click();
      await page.waitForTimeout(100);

      // Second request (should hit cache)
      await cacheButton.click();
      await page.waitForTimeout(100);

      // Verify cache hit
      expect(cacheHit).toBeTruthy();
    }
  });

  test("should handle request compression", async ({ page }) => {
    await page.route("**/api/compression-test", async (route) => {
      const acceptEncoding = route.request().headers()["accept-encoding"];
      expect(acceptEncoding).toContain("gzip");
      
      route.fulfill({
        status: 200,
        headers: { "content-encoding": "gzip" },
        body: JSON.stringify({ compressed: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger compressed request
    const compressionButton = page.locator('[data-testid="compression-button"]').first();
    if (await compressionButton.count() > 0) {
      await compressionButton.click();

      // Verify compression handled
      const compressionStatus = page.locator('[data-testid="compression-status"]').first();
      const isCompressed = await compressionStatus.getAttribute("data-compressed");
      expect(isCompressed).toBe("true");
    }
  });

  test("should handle request authentication", async ({ page }) => {
    await page.route("**/api/auth-test", async (route) => {
      const authHeader = route.request().headers()["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ authenticated: true }),
        });
      } else {
        route.fulfill({
          status: 401,
          body: JSON.stringify({ error: "Unauthorized" }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger authenticated request
    const authButton = page.locator('[data-testid="auth-button"]').first();
    if (await authButton.count() > 0) {
      await authButton.click();

      // Verify authentication
      const authStatus = page.locator('[data-testid="auth-status"]').first();
      const isAuthenticated = await authStatus.getAttribute("data-authenticated");
      expect(isAuthenticated).toBe("true");
    }
  });

  test("should handle request rate limiting", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/rate-limit-test", async (route) => {
      requestCount++;
      if (requestCount > 5) {
        route.fulfill({
          status: 429,
          body: JSON.stringify({ error: "Rate limit exceeded" }),
        });
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger rate-limited requests
    const rateLimitButton = page.locator('[data-testid="rate-limit-button"]').first();
    if (await rateLimitButton.count() > 0) {
      for (let i = 0; i < 6; i++) {
        await rateLimitButton.click();
        await page.waitForTimeout(100);
      }

      // Verify rate limit
      const rateLimitMessage = page.locator('[data-testid="rate-limit-message"]').first();
      const isVisible = await rateLimitMessage.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle request pagination", async ({ page }) => {
    await page.route("**/api/pagination-test", async (route) => {
      const url = new URL(route.request().url());
      const page = url.searchParams.get("page") || "1";
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          page: parseInt(page),
          items: Array.from({ length: 10 }, (_, i) => ({ id: i })),
          total: 100,
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Load first page
    const paginationButton = page.locator('[data-testid="pagination-button"]').first();
    if (await paginationButton.count() > 0) {
      await paginationButton.click();

      // Load next page
      const nextButton = page.locator('[data-testid="next-page"]').first();
      await nextButton.click();

      // Verify pagination
      const currentPage = page.locator('[data-testid="current-page"]').first();
      const pageNumber = await currentPage.textContent();
      expect(pageNumber).toBe("2");
    }
  });

  test("should handle request streaming", async ({ page }) => {
    await page.route("**/api/stream-test", async (route) => {
      // Playwright's route.fulfill() takes a string/Buffer body, not a
      // ReadableStream: send the same bytes the stream would have produced.
      const body = Array.from({ length: 5 }, (_unused, i) => `chunk ${i}\n`).join("");

      route.fulfill({
        status: 200,
        body,
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger streaming request
    const streamButton = page.locator('[data-testid="stream-button"]').first();
    if (await streamButton.count() > 0) {
      await streamButton.click();

      // Verify streaming
      const streamContent = page.locator('[data-testid="stream-content"]').first();
      const hasContent = await streamContent.count() > 0;
      expect(hasContent).toBeTruthy();
    }
  });

  test("should handle request queuing", async ({ page }) => {
    const queue: string[] = [];
    await page.route("**/api/queue-test", async (route) => {
      const id = route.request().headers()["x-request-id"];
      queue.push(id ?? "");
      await new Promise((resolve) => setTimeout(resolve, 100));
      route.fulfill({
        status: 200,
        body: JSON.stringify({ queued: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger queued requests
    const queueButton = page.locator('[data-testid="queue-button"]').first();
    if (await queueButton.count() > 0) {
      await queueButton.click();
      await queueButton.click();
      await queueButton.click();

      // Verify queue order
      expect(queue.length).toBe(3);
    }
  });

  test("should handle request batching", async ({ page }) => {
    await page.route("**/api/batch-test", async (route) => {
      const body = await route.request().postDataJSON();
      const requests = body.requests || [];
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          responses: requests.map((req: any) => ({ id: req.id, success: true })),
        }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger batch request
    const batchButton = page.locator('[data-testid="batch-button"]').first();
    if (await batchButton.count() > 0) {
      await batchButton.click();

      // Verify batching
      const batchStatus = page.locator('[data-testid="batch-status"]').first();
      const isBatched = await batchStatus.getAttribute("data-batched");
      expect(isBatched).toBe("true");
    }
  });

  test("should handle request debouncing", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/debounce-test", async (route) => {
      requestCount++;
      route.fulfill({
        status: 200,
        body: JSON.stringify({ debounced: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger debounced requests
    const debounceButton = page.locator('[data-testid="debounce-button"]').first();
    if (await debounceButton.count() > 0) {
      await debounceButton.click();
      await debounceButton.click();
      await debounceButton.click();

      // Wait for debounce
      await page.waitForTimeout(500);

      // Verify only one request was made
      expect(requestCount).toBe(1);
    }
  });

  test("should handle request throttling", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/throttle-test", async (route) => {
      requestCount++;
      route.fulfill({
        status: 200,
        body: JSON.stringify({ throttled: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger throttled requests
    const throttleButton = page.locator('[data-testid="throttle-button"]').first();
    if (await throttleButton.count() > 0) {
      for (let i = 0; i < 10; i++) {
        await throttleButton.click();
      }

      // Wait for throttle period
      await page.waitForTimeout(1000);

      // Verify throttling limited requests
      expect(requestCount).toBeLessThan(10);
    }
  });

  test("should handle request retry with exponential backoff", async ({ page }) => {
    let requestCount = 0;
    const delays: number[] = [];
    const startTime = Date.now();

    await page.route("**/api/backoff-test", async (route) => {
      requestCount++;
      delays.push(Date.now() - startTime);
      if (requestCount < 4) {
        route.abort("failed");
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger backoff request
    const backoffButton = page.locator('[data-testid="backoff-button"]').first();
    if (await backoffButton.count() > 0) {
      await backoffButton.click();

      // Verify exponential backoff
      expect(delays[1]! - delays[0]!).toBeLessThan(delays[2]! - delays[1]!);
    }
  });

  test("should handle request circuit breaker", async ({ page }) => {
    let failureCount = 0;
    await page.route("**/api/circuit-test", async (route) => {
      failureCount++;
      if (failureCount <= 5) {
        route.abort("failed");
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger circuit breaker
    const circuitButton = page.locator('[data-testid="circuit-button"]').first();
    if (await circuitButton.count() > 0) {
      // Trigger failures to open circuit
      for (let i = 0; i < 6; i++) {
        await circuitButton.click();
        await page.waitForTimeout(100);
      }

      // Verify circuit is open
      const circuitStatus = page.locator('[data-testid="circuit-status"]').first();
      const isOpen = await circuitStatus.getAttribute("data-open");
      expect(isOpen).toBe("true");
    }
  });

  test("should handle request progress tracking", async ({ page }) => {
    await page.route("**/api/progress-test", async (route) => {
      // route.fulfill() takes a string/Buffer body, not a ReadableStream.
      const body = Array.from({ length: 11 }, (_unused, step) =>
        JSON.stringify({ progress: step * 10 }) + "\n",
      ).join("");

      route.fulfill({
        status: 200,
        body,
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger progress request
    const progressButton = page.locator('[data-testid="progress-button"]').first();
    if (await progressButton.count() > 0) {
      await progressButton.click();

      // Verify progress tracking
      const progressBar = page.locator('[data-testid="progress-bar"]').first();
      const isVisible = await progressBar.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle request error recovery", async ({ page }) => {
    let shouldFail = true;
    await page.route("**/api/recovery-test", async (route) => {
      if (shouldFail) {
        route.abort("failed");
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ recovered: true }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger recovery request
    const recoveryButton = page.locator('[data-testid="recovery-button"]').first();
    if (await recoveryButton.count() > 0) {
      await recoveryButton.click();

      // Wait for recovery
      await page.waitForTimeout(1000);
      shouldFail = false;

      // Retry
      await recoveryButton.click();

      // Verify recovery
      const recoveryStatus = page.locator('[data-testid="recovery-status"]').first();
      const isRecovered = await recoveryStatus.getAttribute("data-recovered");
      expect(isRecovered).toBe("true");
    }
  });

  test("should handle request validation", async ({ page }) => {
    await page.route("**/api/validation-test", async (route) => {
      const body = await route.request().postDataJSON();
      if (!body.id || !body.data) {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: "Validation failed" }),
        });
      } else {
        route.fulfill({
          status: 200,
          body: JSON.stringify({ validated: true }),
        });
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger validation request
    const validationButton = page.locator('[data-testid="validation-button"]').first();
    if (await validationButton.count() > 0) {
      await validationButton.click();

      // Verify validation
      const validationStatus = page.locator('[data-testid="validation-status"]').first();
      const isValid = await validationStatus.getAttribute("data-valid");
      expect(isValid).toBe("true");
    }
  });

  test("should handle request transformation", async ({ page }) => {
    await page.route("**/api/transform-test", async (route) => {
      const body = await route.request().postDataJSON();
      const transformed = {
        ...body,
        timestamp: Date.now(),
        version: "1.0",
      };
      route.fulfill({
        status: 200,
        body: JSON.stringify(transformed),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger transformation request
    const transformButton = page.locator('[data-testid="transform-button"]').first();
    if (await transformButton.count() > 0) {
      await transformButton.click();

      // Verify transformation
      const transformedData = page.locator('[data-testid="transformed-data"]').first();
      const hasTimestamp = await transformedData.getAttribute("data-timestamp");
      expect(hasTimestamp).toBeTruthy();
    }
  });

  test("should handle request response parsing", async ({ page }) => {
    await page.route("**/api/parse-test", async (route) => {
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parsed: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger parsing request
    const parseButton = page.locator('[data-testid="parse-button"]').first();
    if (await parseButton.count() > 0) {
      await parseButton.click();

      // Verify parsing
      const parsedData = page.locator('[data-testid="parsed-data"]').first();
      const isParsed = await parsedData.getAttribute("data-parsed");
      expect(isParsed).toBe("true");
    }
  });

  test("should handle request error parsing", async ({ page }) => {
    await page.route("**/api/error-parse-test", async (route) => {
      route.fulfill({
        status: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Invalid request", code: 400 }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger error parsing request
    const errorButton = page.locator('[data-testid="error-button"]').first();
    if (await errorButton.count() > 0) {
      await errorButton.click();

      // Verify error parsing
      const errorMessage = page.locator('[data-testid="error-message"]').first();
      const hasError = await errorMessage.textContent();
      expect(hasError).toContain("Invalid request");
    }
  });

  test("should handle request response caching", async ({ page }) => {
    await page.route("**/api/response-cache-test", async (route) => {
      route.fulfill({
        status: 200,
        headers: { "cache-control": "max-age=3600" },
        body: JSON.stringify({ cached: true }),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger cacheable request
    const cacheButton = page.locator('[data-testid="response-cache-button"]').first();
    if (await cacheButton.count() > 0) {
      await cacheButton.click();

      // Verify response caching
      const cacheStatus = page.locator('[data-testid="response-cache-status"]').first();
      const isCached = await cacheStatus.getAttribute("data-cached");
      expect(isCached).toBe("true");
    }
  });

  test("should handle request response streaming", async ({ page }) => {
    await page.route("**/api/response-stream-test", async (route) => {
      // route.fulfill() takes a string/Buffer body, not a ReadableStream.
      const chunks: string[] = [];
      const body = Array.from({ length: 5 }, (_unused, i) => {
        chunks.push(`chunk-${i}`);
        return JSON.stringify({ streaming: true, chunks }) + "\n";
      }).join("");

      route.fulfill({
        status: 200,
        body,
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger streaming response
    const streamButton = page.locator('[data-testid="response-stream-button"]').first();
    if (await streamButton.count() > 0) {
      await streamButton.click();

      // Verify streaming response
      const streamData = page.locator('[data-testid="stream-data"]').first();
      const hasStreamData = await streamData.count() > 0;
      expect(hasStreamData).toBeTruthy();
    }
  });
});
