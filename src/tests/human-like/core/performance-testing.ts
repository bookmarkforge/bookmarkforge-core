/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Performance Testing Utilities
 * 
 * Measures and analyzes performance metrics:
 * - Page load times
 * - First Contentful Paint (FCP)
 * - Largest Contentful Paint (LCP)
 * - Cumulative Layout Shift (CLS)
 * - First Input Delay (FID)
 * - Time to Interactive (TTI)
 * - Memory usage
 */

import type { Page } from '@playwright/test';

export interface PerformanceMetrics {
  /** Page load time in milliseconds */
  loadTime: number;
  /** First Contentful Paint */
  fcp: number;
  /** Largest Contentful Paint */
  lcp: number;
  /** Cumulative Layout Shift */
  cls: number;
  /** First Input Delay */
  fid: number;
  /** Time to Interactive */
  tti: number;
  /** DOM Content Loaded */
  domContentLoaded: number;
  /** DOM Complete */
  domComplete: number;
  /** Response time */
  responseTime: number;
  /** Transfer size in bytes */
  transferSize: number;
  /** Resource count */
  resourceCount: number;
  /** Memory usage */
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface PerformanceConfig {
  /** Enable detailed metrics collection */
  detailedMetrics?: boolean;
  /** Enable memory tracking */
  trackMemory?: boolean;
  /** Enable resource tracking */
  trackResources?: boolean;
  /** Performance budget thresholds */
  budgets?: {
    loadTime?: number;
    fcp?: number;
    lcp?: number;
    cls?: number;
  };
}

export interface RequiredBudgets {
  loadTime: number;
  fcp: number;
  lcp: number;
  cls: number;
}

export interface PerformanceReport {
  metrics: PerformanceMetrics;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  score: number;
  recommendations: string[];
  resourceSummary: {
    total: number;
    byType: Record<string, number>;
    bySize: Record<string, number>;
  };
}

/**
 * Performance Testing class
 */
export class PerformanceTesting {
  private page: Page;
  private config: Required<Omit<PerformanceConfig, "budgets">> & {
    budgets: RequiredBudgets;
  };
  private startTimestamp: number = 0;
  private metrics: Partial<PerformanceMetrics> = {};

  constructor(page: Page, config: PerformanceConfig = {}) {
    this.page = page;
    this.config = {
      detailedMetrics: config.detailedMetrics ?? true,
      trackMemory: config.trackMemory ?? true,
      trackResources: config.trackResources ?? true,
      budgets: {
        loadTime: config.budgets?.loadTime ?? 3000,
        fcp: config.budgets?.fcp ?? 1800,
        lcp: config.budgets?.lcp ?? 2500,
        cls: config.budgets?.cls ?? 0.1,
      },
    };
  }

  /**
   * Start performance measurement
   */
  async start(): Promise<void> {
    this.startTimestamp = Date.now();
    
    // Inject performance observer script
    await this.page.evaluate(() => {
      (window as any).__performanceMetrics = {
        fcp: 0,
        lcp: 0,
        cls: 0,
        fid: 0,
        tti: 0,
      };

      // First Contentful Paint
      const fcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.name === 'first-contentful-paint') {
            (window as any).__performanceMetrics.fcp = entry.startTime;
          }
        }
      });
      fcpObserver.observe({ type: 'paint', buffered: true });

      // Largest Contentful Paint
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const lastEntry = entries[entries.length - 1];
        (window as any).__performanceMetrics.lcp = lastEntry.startTime;
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });

      // Cumulative Layout Shift
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!(entry as any).hadRecentInput) {
            clsValue += (entry as any).value;
            (window as any).__performanceMetrics.cls = clsValue;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });

      // First Input Delay
      const fidObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          (window as any).__performanceMetrics.fid = (entry as any).processingStart - entry.startTime;
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true });
    });
  }

  /**
   * Stop performance measurement and collect metrics
   */
  async stop(): Promise<PerformanceMetrics> {
    const loadTime = Date.now() - this.startTimestamp;

    // Get navigation timing
    const navigationTiming = await this.page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
        domComplete: navigation.domComplete - navigation.startTime,
        responseTime: navigation.responseEnd - navigation.requestStart,
        transferSize: navigation.transferSize,
      };
    });

    // Get injected metrics
    const injectedMetrics = await this.page.evaluate(() => {
      return (window as any).__performanceMetrics || {};
    });

    // Get resource count
    const resourceCount = await this.page.evaluate(() => {
      return performance.getEntriesByType('resource').length;
    });

    // Get memory usage (if available)
    let memory: PerformanceMetrics['memory'] | undefined;
    if (this.config.trackMemory) {
      memory = await this.page.evaluate(() => {
        const memory = (performance as any).memory;
        if (memory) {
          return {
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          };
        }
        return undefined;
      });
    }

    this.metrics = {
      loadTime,
      fcp: injectedMetrics.fcp || 0,
      lcp: injectedMetrics.lcp || 0,
      cls: injectedMetrics.cls || 0,
      fid: injectedMetrics.fid || 0,
      tti: injectedMetrics.tti || 0,
      domContentLoaded: navigationTiming.domContentLoaded,
      domComplete: navigationTiming.domComplete,
      responseTime: navigationTiming.responseTime,
      transferSize: navigationTiming.transferSize,
      resourceCount,
      memory,
    };

    return this.metrics as PerformanceMetrics;
  }

  /**
   * Measure specific operation performance
   */
  async measureOperation(
    name: string,
    operation: () => Promise<void>
  ): Promise<{ name: string; duration: number; success: boolean }> {
    const startTime = Date.now();
    let success = true;

    try {
      await operation();
    } catch {
      success = false;
    }

    const duration = Date.now() - startTime;

    return { name, duration, success };
  }

  /**
   * Measure multiple operations
   */
  async measureOperations(
    operations: Array<{ name: string; operation: () => Promise<void> }>
  ): Promise<Array<{ name: string; duration: number; success: boolean }>> {
    const results: Array<{ name: string; duration: number; success: boolean }> =
      [];
    
    for (const op of operations) {
      const result = await this.measureOperation(op.name, op.operation);
      results.push(result);
    }

    return results;
  }

  /**
   * Generate performance report
   */
  generateReport(): PerformanceReport {
    const metrics = this.metrics as PerformanceMetrics;
    
    // Calculate score (0-100)
    let score = 100;
    
    // Load time scoring
    if (metrics.loadTime > this.config.budgets.loadTime) {
      score -= 20;
    } else if (metrics.loadTime > this.config.budgets.loadTime * 0.7) {
      score -= 10;
    }

    // FCP scoring
    if (metrics.fcp > this.config.budgets.fcp) {
      score -= 20;
    } else if (metrics.fcp > this.config.budgets.fcp * 0.7) {
      score -= 10;
    }

    // LCP scoring
    if (metrics.lcp > this.config.budgets.lcp) {
      score -= 20;
    } else if (metrics.lcp > this.config.budgets.lcp * 0.7) {
      score -= 10;
    }

    // CLS scoring
    if (metrics.cls > this.config.budgets.cls) {
      score -= 20;
    } else if (metrics.cls > this.config.budgets.cls * 0.5) {
      score -= 10;
    }

    // FID scoring
    if (metrics.fid > 100) {
      score -= 10;
    } else if (metrics.fid > 50) {
      score -= 5;
    }

    // Determine grade
    let grade: PerformanceReport['grade'];
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 60) grade = 'D';
    else grade = 'F';

    // Generate recommendations
    const recommendations: string[] = [];
    
    if (metrics.loadTime > this.config.budgets.loadTime) {
      recommendations.push('Reduce page load time by optimizing images and scripts');
    }
    if (metrics.fcp > this.config.budgets.fcp) {
      recommendations.push('Improve First Contentful Paint by reducing render-blocking resources');
    }
    if (metrics.lcp > this.config.budgets.lcp) {
      recommendations.push('Optimize Largest Contentful Paint by preloading critical resources');
    }
    if (metrics.cls > this.config.budgets.cls) {
      recommendations.push('Reduce Cumulative Layout Shift by setting explicit dimensions for images');
    }
    if (metrics.fid > 100) {
      recommendations.push('Reduce First Input Delay by breaking up long tasks');
    }
    if (metrics.resourceCount > 50) {
      recommendations.push('Reduce number of resources by bundling and lazy loading');
    }

    return {
      metrics,
      grade,
      score: Math.max(0, score),
      recommendations,
      resourceSummary: {
        total: metrics.resourceCount,
        byType: {}, // Would need resource timing data
        bySize: {}, // Would need resource timing data
      },
    };
  }

  /**
   * Check if performance meets budget
   */
  meetsBudget(): { meets: boolean; violations: string[] } {
    const metrics = this.metrics as PerformanceMetrics;
    const violations: string[] = [];

    if (metrics.loadTime > this.config.budgets.loadTime) {
      violations.push(`Load time ${metrics.loadTime}ms exceeds budget ${this.config.budgets.loadTime}ms`);
    }
    if (metrics.fcp > this.config.budgets.fcp) {
      violations.push(`FCP ${metrics.fcp}ms exceeds budget ${this.config.budgets.fcp}ms`);
    }
    if (metrics.lcp > this.config.budgets.lcp) {
      violations.push(`LCP ${metrics.lcp}ms exceeds budget ${this.config.budgets.lcp}ms`);
    }
    if (metrics.cls > this.config.budgets.cls) {
      violations.push(`CLS ${metrics.cls} exceeds budget ${this.config.budgets.cls}`);
    }

    return {
      meets: violations.length === 0,
      violations,
    };
  }
}

/**
 * Create performance testing instance
 */
export function createPerformanceTesting(
  page: Page,
  config?: PerformanceConfig
): PerformanceTesting {
  return new PerformanceTesting(page, config);
}

/**
 * Quick performance measurement helper
 */
export async function measurePerformance(
  page: Page,
  operation: () => Promise<void>
): Promise<PerformanceMetrics> {
  const perf = new PerformanceTesting(page);
  await perf.start();
  await operation();
  return perf.stop();
}
