/**
 * Landing A/B Testing Framework - Local Browser-Based Testing
 * 
 * Simple A/B testing system that runs locally in the browser.
 * No external services, no user tracking, completely local.
 * 
 * Usage:
 * 1. Import this script in your landing page
 * 2. Define variants
 * 3. The framework randomly assigns variants to users
 * 4. Store assignments in localStorage for consistency
 * 
 * IMPORTANT: This is for internal optimization testing only.
 * Do not use for production user tracking or analytics.
 */

import { logger } from "./logger";

export interface Variant<T> {
  name: string;
  weight: number; // Relative weight (e.g., 50 for 50%)
  data: T;
}

export interface ABTestConfig<T> {
  testName: string;
  variants: Variant<T>[];
  cookieDays?: number; // How long to keep assignment (default: 7)
}

export class ABTest<T> {
  private config: ABTestConfig<T>;
  private storageKey: string;
  
  constructor(config: ABTestConfig<T>) {
    this.config = config;
    this.storageKey = `ab_test_${config.testName}`;
  }
  
  /**
   * Get the assigned variant for the current user
   * Uses localStorage for persistence (completely local)
   */
  getVariant(): Variant<T> {
    // Check if already assigned
    const stored = this.getStoredAssignment();
    if (stored) {
      return this.findVariant(stored);
    }
    
    // Assign new variant
    const variant = this.assignVariant();
    this.storeAssignment(variant.name);
    
    return variant;
  }
  
  /**
   * Get all available variants
   */
  getAllVariants(): Variant<T>[] {
    return this.config.variants;
  }
  
  /**
   * Force a specific variant (for testing/debugging)
   * Use URL parameter: ?ab_test_<name>=variant_name
   */
  forceVariant(variantName: string): Variant<T> | null {
    const variant = this.findVariant(variantName);
    if (variant) {
      this.storeAssignment(variantName);
      return variant;
    }
    return null;
  }
  
  /**
   * Check if URL parameter forces a variant
   */
  checkURLParam(): Variant<T> | null {
    const params = new URLSearchParams(window.location.search);
    const forcedVariant = params.get(`ab_test_${this.config.testName}`);
    
    if (forcedVariant) {
      return this.forceVariant(forcedVariant);
    }
    
    return null;
  }
  
  /**
   * Get assigned variant (check URL param first, then localStorage)
   */
  getAssignedVariant(): Variant<T> {
    // Check URL param for debugging
    const urlVariant = this.checkURLParam();
    if (urlVariant) {
      return urlVariant;
    }
    
    // Check localStorage
    return this.getVariant();
  }
  
  /**
   * Clear assignment (for testing)
   */
  clearAssignment(): void {
    localStorage.removeItem(this.storageKey);
  }
  
  /**
   * Get stored assignment from localStorage
   */
  private getStoredAssignment(): string | null {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return null;
      
      const data = JSON.parse(stored);
      
      // Check if assignment is expired
      const days = this.config.cookieDays || 7;
      const expiryDate = new Date(data.timestamp);
      expiryDate.setDate(expiryDate.getDate() + days);
      
      if (new Date() > expiryDate) {
        localStorage.removeItem(this.storageKey);
        return null;
      }
      
      return data.variant;
    } catch {
      return null;
    }
  }
  
  /**
   * Store assignment in localStorage
   */
  private storeAssignment(variantName: string): void {
    try {
      const data = {
        variant: variantName,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Storage might be disabled
    }
  }
  
  /**
   * Assign variant based on weights
   */
  private assignVariant(): Variant<T> {
    if (this.config.variants.length === 0) {
      throw new Error(`AB test "${this.config.testName}" has no variants defined`);
    }

    const totalWeight = this.config.variants.reduce((sum, v) => sum + v.weight, 0);
    const random = Math.random() * totalWeight;

    let cumulative = 0;
    for (const variant of this.config.variants) {
      cumulative += variant.weight;
      if (random < cumulative) {
        return variant;
      }
    }

    // Fallback to first variant
    return this.config.variants[0]!;
  }
  
  /**
   * Find variant by name
   */
  private findVariant(name: string): Variant<T> {
    const variant = this.config.variants.find(v => v.name === name);
    if (!variant) {
      logger.warn(`Variant "${name}" not found, using first variant`);
      return this.config.variants[0]!;
    }
    return variant;
  }
}

/**
 * Example usage for BookmarkForge landing
 */
export const bookmarkForgeABTests = {
  // Test different headlines
  headline: new ABTest<string>({
    testName: 'headline',
    variants: [
      { name: 'control', weight: 50, data: 'Everything stays on your computer. Pay once.' },
      { name: 'variant_a', weight: 25, data: 'Your private AI knowledge vault. 100% local.' },
      { name: 'variant_b', weight: 25, data: 'The privacy-first Pocket alternative.' },
    ],
    cookieDays: 7,
  }),
  
  // Test different CTA button colors
  ctaColor: new ABTest<string>({
    testName: 'cta_color',
    variants: [
      { name: 'blue', weight: 50, data: '#00aeef' },
      { name: 'green', weight: 25, data: '#00c853' },
      { name: 'purple', weight: 25, data: '#6200ea' },
    ],
    cookieDays: 7,
  }),
  
  // Test different pricing display
  pricing: new ABTest<string>({
    testName: 'pricing',
    variants: [
      { name: 'show_price', weight: 50, data: '$59 once' },
      { name: 'show_value', weight: 50, data: 'Lifetime access' },
    ],
    cookieDays: 7,
  }),
};

/**
   * Initialize A/B tests on page load
   */
  export function initABTests() {
    // This would be called from the landing page
    // For example:
    // const headlineTest = bookmarkForgeABTests.headline.getAssignedVariant();
    // document.querySelector('h1').textContent = headlineTest.data;
    //
    // Audit B1: logger.debug (not console.log) so production builds
    // suppress this entirely. console.log in production code can leak
    // A/B test assignments (which variant each user receives) to the
    // browser console — profiling data usable for fingerprinting or
    // targeted attacks. logger.debug is gated by currentLevel, which
    // defaults to "warn" in production (see logger.ts:150).
    logger.debug("A/B Testing Framework initialized", {
      tests: Object.keys(bookmarkForgeABTests),
    });
  }

  /**
   * Debug helper to see current assignments
   *
   * Audit B1: logger.debug (not console.log) — see initABTests for the
   * rationale. This function is intended for manual debugging only and
   // must never log in production builds.
   */
  export function debugABTests() {
    logger.debug("Current A/B Test Assignments");

    for (const [name, test] of Object.entries(bookmarkForgeABTests)) {
      const variant = test.getAssignedVariant();
      logger.debug(`  ${name}: ${variant.name} (${variant.weight}%)`);
    }
  }
