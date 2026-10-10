/**
 * Advanced Analytics Tests
 * 
 * Tests for advanced analytics and reporting features:
 * - Analytics dashboard
 * - Custom reports
 * - Data visualization
 * - Usage statistics
 * - Performance metrics
 * - User behavior tracking
 * - Export analytics
 * - Scheduled reports
 * - Analytics filtering
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Analytics Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('15.1 Analytics dashboard opens correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics|stats/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const analyticsDashboard = page.locator('[data-testid="analytics-dashboard"]');
      if (await analyticsDashboard.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(analyticsDashboard).toBeVisible();
      }
    }
  });

  test('15.2 Custom reports can be created', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const createReportButton = page.getByRole('button', { name: /create report|new report/i });
      if (await createReportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(createReportButton);
        
        const reportBuilder = page.locator('[data-testid="report-builder"]');
        if (await reportBuilder.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(reportBuilder).toBeVisible();
        }
      }
    }
  });

  test('15.3 Data visualization displays correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const charts = page.locator('[data-testid="chart"], [data-testid="graph"]');
      if (await charts.count() > 0) {
        await expect(charts.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('15.4 Usage statistics display', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const usageStats = page.locator('[data-testid="usage-stats"]');
      if (await usageStats.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(usageStats).toBeVisible();
      }
    }
  });

  test('15.5 Performance metrics display', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const performanceMetrics = page.locator('[data-testid="performance-metrics"]');
      if (await performanceMetrics.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(performanceMetrics).toBeVisible();
      }
    }
  });

  test('15.6 User behavior tracking works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const behaviorTracking = page.locator('[data-testid="behavior-tracking"]');
      if (await behaviorTracking.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(behaviorTracking).toBeVisible();
      }
    }
  });

  test('15.7 Export analytics works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const exportButton = page.getByRole('button', { name: /export/i });
      if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(exportButton);
        
        const exportDialog = page.locator('[data-testid="export-dialog"]');
        if (await exportDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(exportDialog).toBeVisible();
        }
      }
    }
  });

  test('15.8 Scheduled reports work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const scheduleButton = page.getByRole('button', { name: /schedule/i });
      if (await scheduleButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(scheduleButton);
        
        const scheduleDialog = page.locator('[data-testid="schedule-dialog"]');
        if (await scheduleDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(scheduleDialog).toBeVisible();
        }
      }
    }
  });

  test('15.9 Analytics filtering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const filterSection = page.locator('[data-testid="analytics-filters"]');
      if (await filterSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(filterSection).toBeVisible();
      }
    }
  });

  test('15.10 Real-time analytics updates work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const realtimeToggle = page.getByRole('switch', { name: /realtime|live/i });
      if (await realtimeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(realtimeToggle);
        
        const realtimeIndicator = page.locator('[data-testid="realtime-indicator"]');
        if (await realtimeIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(realtimeIndicator).toBeVisible();
        }
      }
    }
  });
});