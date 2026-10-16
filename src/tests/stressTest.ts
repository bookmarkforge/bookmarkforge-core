/**
 * Stress Test Script for BookmarkForge Database
 *
 * Usage: Run this in the browser console or as a test
 * Creates 10,000+ bookmarks to test database performance
 */

import { initDB } from "../db/database";
import { logger } from "../utils/logger";

interface StressTestConfig {
  count: number;
  batchSize: number;
  delayMs: number;
}

interface StressTestResult {
  totalCreated: number;
  totalTimeMs: number;
  avgTimePerDoc: number;
  errors: number;
  memoryBefore: number;
  memoryAfter: number;
}

export async function runStressTest(
  config: Partial<StressTestConfig> = {},
): Promise<StressTestResult> {
  const { count = 10000, batchSize = 100, delayMs = 0 } = config;

  logger.info(
    `[StressTest] Starting with ${count} bookmarks, batch size ${batchSize}`,
  );

  const memoryBefore = (performance as any).memory?.usedJSHeapSize || 0;
  const db = await initDB();
  const startTime = Date.now();
  let totalCreated = 0;
  let errors = 0;

  const tags = [
    "work",
    "personal",
    "research",
    "ai",
    "dev",
    "design",
    "news",
    "tutorial",
    "reference",
    "archive",
  ];
  const titles = [
    "Understanding React Patterns",
    "Advanced TypeScript Tips",
    "Machine Learning Basics",
    "Web Performance Guide",
    "CSS Grid Layout Tutorial",
    "Node.js Best Practices",
    "Database Design Patterns",
    "API Security Checklist",
    "Docker for Beginners",
    "Git Workflow Strategies",
  ];

  for (let i = 0; i < count; i += batchSize) {
    const batch: Record<string, unknown>[] = [];
    const end = Math.min(i + batchSize, count);

    for (let j = i; j < end; j++) {
      batch.push({
        id: `stress-test-${j}-${Date.now()}`,
        url: `https://example.com/article/${j}`,
        title: `${titles[j % titles.length]} #${j}`,
        content: `This is test content for bookmark ${j}. It contains some text to simulate real bookmark data.`,
        summary: `Summary for bookmark ${j}`,
        tags: [tags[j % tags.length], tags[(j + 3) % tags.length]],
        relatedLinks: [],
        processed: false,
        isDeleted: false,
        createdAt: new Date(
          Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      await (db as any).bookmarks.bulkInsert(batch);
      totalCreated += batch.length;

      if (totalCreated % 1000 === 0) {
        logger.info(`[StressTest] Created ${totalCreated}/${count} bookmarks`);
      }

      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } catch (err) {
      errors += batch.length;
      logger.error(`[StressTest] Failed to insert batch at ${i}`, {
        error: err,
      });
    }
  }

  const endTime = Date.now();
  const memoryAfter = (performance as any).memory?.usedJSHeapSize || 0;

  const result: StressTestResult = {
    totalCreated,
    totalTimeMs: endTime - startTime,
    avgTimePerDoc: (endTime - startTime) / totalCreated,
    errors,
    memoryBefore,
    memoryAfter,
  };

  logger.info("[StressTest] Results", {
    totalCreated: result.totalCreated,
    totalTimeMs: result.totalTimeMs,
    avgTimePerDoc: `${result.avgTimePerDoc.toFixed(2)}ms`,
    errors: result.errors,
    memoryDeltaMB: ((memoryAfter - memoryBefore) / 1024 / 1024).toFixed(2),
  });

  return result;
}

export async function cleanupStressTestData(): Promise<void> {
  logger.info("[StressTest] Cleaning up test data...");
  const db = await initDB();

  try {
    const docs = await (db as any).bookmarks
      .find({
        selector: { id: { $regex: "^stress-test-" } },
      })
      .exec();

    for (const doc of docs) {
      await doc.remove();
    }

    logger.info(`[StressTest] Cleaned up ${docs.length} test documents`);
  } catch (err) {
    logger.error("[StressTest] Cleanup failed", { error: err });
  }
}
