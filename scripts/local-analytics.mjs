#!/usr/bin/env node

/**
 * Local Analytics Generator (Privacy-First)
 *
 * Generates a lightweight analytics system that:
 * - Tracks page views locally (no external services)
 * - Stores data in IndexedDB (browser-side)
 * - No user tracking, no cookies, no third-party services
 * - Completely privacy-preserving
 *
 * Usage: node scripts/local-analytics.mjs
 *
 * Output: public/analytics.js (client-side analytics script)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT_FILE = join(__dirname, '..', 'public', 'analytics.js');

/**
 * Generate analytics JavaScript code
 */
function generateAnalyticsJS() {
  return `/**
 * BookmarkForge Local Analytics
 * Privacy-first analytics using IndexedDB
 * No external services, no cookies, no tracking
 */

class LocalAnalytics {
  constructor(dbName = 'BookmarkForgeAnalytics', storeName = 'events') {
    this.dbName = dbName;
    this.storeName = storeName;
    this.db = null;
  }

  /**
   * Initialize IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('eventType', 'eventType', { unique: false });
        }
      };
    });
  }

  /**
   * Track page view
   */
  async trackPageView(pagePath) {
    await this.init();
    return this.trackEvent('pageview', { pagePath });
  }

  /**
   * Track custom event
   */
  async trackEvent(eventType, eventData = {}) {
    await this.init();

    const event = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2),
      eventType,
      timestamp: new Date().toISOString(),
      ...eventData,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.add(event);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(event);
    });
  }

  /**
   * Get events by type
   */
  async getEventsByType(eventType, limit = 100) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('eventType');
      const request = index.getAll(eventType);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const events = request.result.slice(-limit);
        resolve(events);
      };
    });
  }

  /**
   * Get all events
   */
  async getAllEvents(limit = 1000) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const events = request.result.slice(-limit);
        resolve(events);
      };
    });
  }

  /**
   * Get statistics
   */
  async getStats() {
    const events = await this.getAllEvents();

    const stats = {
      totalEvents: events.length,
      pageViews: events.filter(e => e.eventType === 'pageview').length,
      uniquePages: new Set(events.filter(e => e.eventType === 'pageview').map(e => e.pagePath)).size,
      eventTypes: {},
      dateRange: {
        first: events[0]?.timestamp || null,
        last: events[events.length - 1]?.timestamp || null,
      },
    };

    events.forEach(e => {
      stats.eventTypes[e.eventType] = (stats.eventTypes[e.eventType] || 0) + 1;
    });

    return stats;
  }

  /**
   * Clear old events (older than days)
   */
  async clearOldEvents(days = 30) {
    await this.init();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const events = await this.getAllEvents();
    const eventsToDelete = events.filter(e => new Date(e.timestamp) < cutoffDate);

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      eventsToDelete.forEach(event => {
        store.delete(event.id);
      });

      transaction.oncomplete = () => resolve(eventsToDelete.length);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Export events as JSON
   */
  async exportEvents() {
    const events = await this.getAllEvents();
    return JSON.stringify(events, null, 2);
  }
}

// Auto-initialize on page load
const analytics = new LocalAnalytics();

// Track page view automatically
if (typeof window !== 'undefined') {
  window.addEventListener('load', async () => {
    await analytics.trackPageView(window.location.pathname);
  });
}

// Export for manual tracking
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LocalAnalytics;
} else if (typeof window !== 'undefined') {
  window.LocalAnalytics = LocalAnalytics;
  window.analytics = analytics;
}
`;
}

/**
 * Generate usage documentation
 */
function generateUsageDocs() {
  return `/**
 * Usage Examples
 *
 * 1. Automatic page view tracking (already enabled):
 *    - No code needed, it tracks automatically on page load
 *
 * 2. Track custom events:
 *    analytics.trackEvent('cta_click', { button: 'signup' });
 *    analytics.trackEvent('download', { version: '1.0.0' });
 *
 * 3. Get statistics:
 *    const stats = await analytics.getStats();
 *    console.log(stats);
 *
 * 4. Get specific events:
 *    const pageViews = await analytics.getEventsByType('pageview');
 *
 * 5. Export data:
 *    const json = await analytics.exportEvents();
 *    console.log(json);
 *
 * 6. Clear old data:
 *    await analytics.clearOldEvents(30); // Clear events older than 30 days
 */
`;
}

/**
 * Main execution
 */
function main() {
  try {
    console.log('=== Local Analytics Generator ===\n');
    console.log('Output file:', OUTPUT_FILE);

    const analyticsJS = generateAnalyticsJS();
    console.log('Analytics JS length:', analyticsJS.length);
    
    writeFileSync(OUTPUT_FILE, analyticsJS, 'utf-8');

    console.log(`✅ Generated: ${OUTPUT_FILE}`);
    console.log('\n📊 Features:');
    console.log('  - Track page views automatically');
    console.log('  - Track custom events');
    console.log('  - Get statistics');
    console.log('  - Export data as JSON');
    console.log('  - Clear old data');
    console.log('\n🔒 Privacy Features:');
    console.log('  - No external services');
    console.log('  - No cookies');
    console.log('  - Data stored in IndexedDB (browser-side)');
    console.log('  - No user tracking');
    console.log('  - Complete control over data');

    console.log('\n💡 Usage:');
    console.log('  1. Add script tag to your HTML:');
    console.log('     <script src="/analytics.js"></script>');
    console.log('  2. Page views are tracked automatically');
    console.log('  3. Track custom events:');
    console.log('     analytics.trackEvent("cta_click", { button: "signup" })');
    console.log('  4. View statistics in browser console:');
    console.log('     analytics.getStats().then(console.log)');

    console.log('\n⚠️  Important:');
    console.log('  - Data is stored per-browser (not shared across devices)');
    console.log('  - Clearing browser data clears analytics');
    console.log('  - This is for development/analytics, not production monitoring');

  } catch (error) {
    console.error('❌ Error generating analytics:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, generateAnalyticsJS, generateAnalyticsJS as default };
