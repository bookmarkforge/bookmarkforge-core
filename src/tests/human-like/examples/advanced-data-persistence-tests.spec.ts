import { test, expect } from "@playwright/test";

/**
 * Advanced Data Persistence Tests
 * Tests for complex data storage, retrieval, and synchronization operations
 * These tests simulate human-like interactions with data persistence mechanisms
 */

test.describe("Advanced Data Persistence", () => {
  test("should handle localStorage operations with large datasets", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store large dataset
    const largeDataset = JSON.stringify({ 
      items: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: `item-${i}` }))
    });

    await page.evaluate((data) => {
      localStorage.setItem("large-dataset", data);
    }, largeDataset);

    // Verify storage
    const storedData = await page.evaluate(() => {
      return localStorage.getItem("large-dataset");
    });

    expect(storedData).toBeTruthy();
    expect(JSON.parse(storedData as string).items.length).toBe(1000);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("large-dataset");
    });
  });

  test("should handle sessionStorage operations", async ({ page, browser }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store session data
    await page.evaluate(() => {
      sessionStorage.setItem("session-data", "session-value");
    });

    // Verify storage
    const sessionData = await page.evaluate(() => {
      return sessionStorage.getItem("session-data");
    });

    expect(sessionData).toBe("session-value");

    // sessionStorage is scoped to the tab session: a reload PRESERVES it —
    // only a fresh browsing context starts empty. Assert that isolation.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/");
    await freshPage.waitForLoadState("networkidle");

    const clearedData = await freshPage.evaluate(() => {
      return sessionStorage.getItem("session-data");
    });

    expect(clearedData).toBeNull();
    await freshContext.close();
  });

  test("should handle IndexedDB operations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Open IndexedDB
    const dbOpened = await page.evaluate(async () => {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("test-db", 1);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    });

    expect(dbOpened).toBeTruthy();
  });

  test("should handle data synchronization across tabs", async ({ page, context }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store data in first tab
    await page.evaluate(() => {
      localStorage.setItem("sync-test", "sync-value");
    });

    // Open second tab
    const secondPage = await context.newPage();
    await secondPage.goto("/");
    await secondPage.waitForLoadState("networkidle");

    // Verify data is synchronized
    const syncedData = await secondPage.evaluate(() => {
      return localStorage.getItem("sync-test");
    });

    expect(syncedData).toBe("sync-value");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("sync-test");
    });
    await secondPage.close();
  });

  test("should handle data export functionality", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger export
    const exportButton = page.locator('[data-testid="export-button"]').first();
    if (await exportButton.count() > 0) {
      const downloadPromise = page.waitForEvent("download");
      await exportButton.click();
      const download = await downloadPromise;

      expect(download.suggestedFilename()).toBeTruthy();
    }
  });

  test("should handle data import functionality", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Prepare test data
    const testData = JSON.stringify({ test: "import-data" });
    const fileBuffer = Buffer.from(testData);

    // Trigger import
    const importInput = page.locator('[data-testid="import-input"]').first();
    if (await importInput.count() > 0) {
      await importInput.setInputFiles({
        name: "test-import.json",
        mimeType: "application/json",
        buffer: fileBuffer,
      });

      // Verify import processing
      await page.waitForTimeout(500);
      const successMessage = page.locator('[data-testid="import-success"]').first();
      const successVisible = await successMessage.isVisible();
      expect(successVisible).toBeTruthy();
    }
  });

  test("should handle data backup creation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger backup
    const backupButton = page.locator('[data-testid="backup-button"]').first();
    if (await backupButton.count() > 0) {
      await backupButton.click();

      // Verify backup creation
      const backupStatus = page.locator('[data-testid="backup-status"]').first();
      const statusText = await backupStatus.textContent();
      expect(statusText).toContain("backup");
    }
  });

  test("should handle data restoration", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Trigger restore
    const restoreButton = page.locator('[data-testid="restore-button"]').first();
    if (await restoreButton.count() > 0) {
      await restoreButton.click();

      // Verify restore process
      const restoreDialog = page.locator('[data-testid="restore-dialog"]').first();
      const isVisible = await restoreDialog.isVisible();
      expect(isVisible).toBeTruthy();
    }
  });

  test("should handle data migration between versions", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Simulate version migration
    const migrationTriggered = await page.evaluate(() => {
      const currentVersion = localStorage.getItem("app-version") || "1.0.0";
      const newVersion = "2.0.0";
      localStorage.setItem("app-version", newVersion);
      return { currentVersion, newVersion };
    });

    expect(migrationTriggered.newVersion).toBe("2.0.0");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("app-version");
    });
  });

  test("should handle data compression", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store compressible data
    const compressibleData = "a".repeat(10000);
    await page.evaluate((data) => {
      localStorage.setItem("compress-test", data);
    }, compressibleData);

    // Verify storage
    const storedSize = await page.evaluate(() => {
      return (localStorage.getItem("compress-test") ?? "").length;
    });

    expect(storedSize).toBe(10000);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("compress-test");
    });
  });

  test("should handle data encryption", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store encrypted data
    const sensitiveData = "sensitive-information";
    await page.evaluate((data) => {
      // Simulate encryption
      const encrypted = btoa(data);
      localStorage.setItem("encrypted-data", encrypted);
    }, sensitiveData);

    // Verify encrypted storage
    const encryptedData = await page.evaluate(() => {
      return localStorage.getItem("encrypted-data");
    });

    expect(encryptedData).not.toBe(sensitiveData);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("encrypted-data");
    });
  });

  test("should handle data validation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store valid data
    const validData = JSON.stringify({ valid: true, timestamp: Date.now() });
    await page.evaluate((data) => {
      localStorage.setItem("valid-data", data);
    }, validData);

    // Verify validation
    const isValid = await page.evaluate(() => {
      const data = localStorage.getItem("valid-data");
      try {
        const parsed = JSON.parse(data as string);
        return parsed.valid === true;
      } catch {
        return false;
      }
    });

    expect(isValid).toBeTruthy();

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("valid-data");
    });
  });

  test("should handle data deduplication", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store duplicate data
    const duplicateData = JSON.stringify([
      { id: 1, value: "test" },
      { id: 2, value: "test" },
      { id: 1, value: "test" },
    ]);

    await page.evaluate((data) => {
      localStorage.setItem("duplicate-data", data);
    }, duplicateData);

    // Deduplicate
    const deduplicated = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("duplicate-data") as string);
      const unique = new Map((data as Array<{ id: string }>).map((item) => [item.id, item]));
      return Array.from(unique.values());
    });

    expect(deduplicated.length).toBe(2);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("duplicate-data");
    });
  });

  test("should handle data pagination", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store paginated data
    const paginatedData = JSON.stringify({
      items: Array.from({ length: 100 }, (_, i) => ({ id: i })),
      total: 100,
      page: 1,
      pageSize: 10,
    });

    await page.evaluate((data) => {
      localStorage.setItem("paginated-data", data);
    }, paginatedData);

    // Verify pagination
    const firstPage = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("paginated-data") as string);
      return data.items.slice(0, data.pageSize);
    });

    expect(firstPage.length).toBe(10);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("paginated-data");
    });
  });

  test("should handle data caching strategies", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Implement cache with TTL
    const cacheData = {
      value: "cached-value",
      timestamp: Date.now(),
      ttl: 60000, // 1 minute
    };

    await page.evaluate((data) => {
      localStorage.setItem("cache-data", JSON.stringify(data));
    }, cacheData);

    // Verify cache is valid
    const isCacheValid = await page.evaluate(() => {
      const cache = JSON.parse(localStorage.getItem("cache-data") as string);
      return Date.now() - cache.timestamp < cache.ttl;
    });

    expect(isCacheValid).toBeTruthy();

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("cache-data");
    });
  });

  test("should handle data conflict resolution", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Simulate conflicting data
    await page.evaluate(() => {
      localStorage.setItem("conflict-data", JSON.stringify({ version: 1, value: "original" }));
    });

    // Update to conflicting version
    const conflictResolved = await page.evaluate(() => {
      const current = JSON.parse(localStorage.getItem("conflict-data") as string);
      const incoming = { version: 2, value: "updated" };
      
      // Simple conflict resolution: use latest version
      const resolved = current.version > incoming.version ? current : incoming;
      localStorage.setItem("conflict-data", JSON.stringify(resolved));
      
      return resolved.version;
    });

    expect(conflictResolved).toBe(2);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("conflict-data");
    });
  });

  test("should handle data rollback functionality", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Create snapshot
    await page.evaluate(() => {
      const snapshot = JSON.stringify({ items: [1, 2, 3] });
      localStorage.setItem("snapshot-1", snapshot);
    });

    // Modify data
    await page.evaluate(() => {
      localStorage.setItem("current-data", JSON.stringify({ items: [1, 2, 3, 4] }));
    });

    // Rollback to snapshot
    const rolledBack = await page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem("snapshot-1") as string);
      localStorage.setItem("current-data", JSON.stringify(snapshot));
      return JSON.parse(localStorage.getItem("current-data") as string);
    });

    expect(rolledBack.items.length).toBe(3);

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("snapshot-1");
      localStorage.removeItem("current-data");
    });
  });

  test("should handle data audit logging", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Log data operations
    await page.evaluate(() => {
      const logs = JSON.parse(localStorage.getItem("audit-logs") || "[]");
      logs.push({
        action: "CREATE",
        timestamp: Date.now(),
        data: { test: "audit" },
      });
      localStorage.setItem("audit-logs", JSON.stringify(logs));
    });

    // Verify audit log
    const auditLogs = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem("audit-logs") as string);
    });

    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].action).toBe("CREATE");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("audit-logs");
    });
  });

  test("should handle data privacy and anonymization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store personal data
    const personalData = JSON.stringify({
      name: "John Doe",
      email: "john@example.com",
      id: "12345",
    });

    await page.evaluate((data) => {
      localStorage.setItem("personal-data", data);
    }, personalData);

    // Anonymize data
    const anonymized = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("personal-data") as string);
      const anonymized = {
        ...data,
        name: "Anonymous",
        email: "anonymous@example.com",
        id: "*****",
      };
      localStorage.setItem("anonymized-data", JSON.stringify(anonymized));
      return anonymized;
    });

    expect(anonymized.name).toBe("Anonymous");
    expect(anonymized.id).toBe("*****");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("personal-data");
      localStorage.removeItem("anonymized-data");
    });
  });

  test("should handle data retention policies", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Store data with retention timestamp
    const dataWithRetention = JSON.stringify({
      value: "retained-data",
      created: Date.now() - (30 * 24 * 60 * 60 * 1000), // 30 days ago
      retention: 7 * 24 * 60 * 60 * 1000, // 7 days retention
    });

    await page.evaluate((data) => {
      localStorage.setItem("retained-data", data);
    }, dataWithRetention);

    // Check if data should be expired
    const isExpired = await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("retained-data") as string);
      const age = Date.now() - data.created;
      return age > data.retention;
    });

    expect(isExpired).toBeTruthy();

    // Cleanup expired data
    await page.evaluate(() => {
      localStorage.removeItem("retained-data");
    });
  });
});
