/**
 * Self-Healing Locator System
 * 
 * Automatically finds elements even when selectors change.
 * Uses multiple strategies to locate elements:
 * 1. Text content matching
 * 2. ARIA roles and labels
 * 3. Visual similarity
 * 4. Element hierarchy
 * 5. Historical success patterns
 */

import type { Page, Locator } from '@playwright/test';

export interface LocatorStrategy {
  name: string;
  priority: number;
  confidence: number;
}

export interface ElementCandidate {
  locator: Locator;
  strategy: string;
  confidence: number;
  timestamp: number;
}

export interface HealingConfig {
  /** Maximum number of strategies to try */
  maxStrategies?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Enable learning from successful heals */
  enableLearning?: boolean;
  /** Cache successful locators */
  cacheResults?: boolean;
}

/**
 * Self-Healing Locator class
 */
export class SelfHealingLocator {
  private page: Page;
  private config: Required<HealingConfig>;
  private successCache: Map<string, string> = new Map();
  private failureHistory: Map<string, string[]> = new Map();

  constructor(page: Page, config: HealingConfig = {}) {
    this.page = page;
    this.config = {
      maxStrategies: config.maxStrategies ?? 5,
      minConfidence: config.minConfidence ?? 0.6,
      enableLearning: config.enableLearning ?? true,
      cacheResults: config.cacheResults ?? true,
    };
  }

  /**
   * Find element with self-healing capability
   */
  async find(
    description: string,
    originalSelector?: string,
    options?: { timeout?: number }
  ): Promise<Locator> {
    const cacheKey = this.getCacheKey(description, originalSelector);
    
    // Check cache first
    if (this.config.cacheResults && this.successCache.has(cacheKey)) {
      const cachedSelector = this.successCache.get(cacheKey)!;
      const cachedLocator = this.page.locator(cachedSelector);
      
      try {
        await cachedLocator.first().waitFor({ 
          state: 'visible', 
          timeout: options?.timeout ?? 5000 
        });
        return cachedLocator.first();
      } catch {
        // Cache miss, continue with healing
        this.successCache.delete(cacheKey);
      }
    }

    // Try original selector first
    if (originalSelector) {
      try {
        const locator = this.page.locator(originalSelector);
        await locator.first().waitFor({ 
          state: 'visible', 
          timeout: 2000 
        });
        
        // Success - cache it
        if (this.config.cacheResults) {
          this.successCache.set(cacheKey, originalSelector);
        }
        
        return locator.first();
      } catch {
        // Original selector failed, start healing
      }
    }

    // Apply healing strategies
    const strategies = this.getStrategies(description);
    
    for (const strategy of strategies.slice(0, this.config.maxStrategies)) {
      try {
        const locator = await this.applyStrategy(strategy, description);
        
        if (locator) {
          await locator.first().waitFor({ 
            state: 'visible', 
            timeout: 2000 
          });
          
          // Success - learn from it. Skip empty selectors: caching a broken
          // `text=` for icon-only elements (e.g. the capture FAB) would make
          // every later find() of the same description stall 5s on a dead
          // cache entry before re-healing.
          if (this.config.enableLearning) {
            const healedSelector = await this.getLocatorSelector(locator.first());
            if (healedSelector) {
              this.successCache.set(cacheKey, healedSelector);
            }
          }
          
          return locator.first();
        }
      } catch {
        // Strategy failed, try next
        continue;
      }
    }

    throw new Error(`Could not find element: ${description}`);
  }

  /**
   * Get healing strategies based on element description
   */
  private getStrategies(description: string): LocatorStrategy[] {
    const strategies: LocatorStrategy[] = [];
    
    // Text-based strategies
    if (description.includes('button') || description.includes('click')) {
      strategies.push({
        name: 'role-button-text',
        priority: 1,
        confidence: 0.9,
      });
      strategies.push({
        name: 'aria-label',
        priority: 2,
        confidence: 0.85,
      });
    }
    
    // Input-related descriptions trigger textbox/placeholder strategies.
    // 'URL', 'title', 'search' and 'tag' are common in natural-language
    // steps even though the word "input"/"field" itself was stripped by
    // the DSL's extractTarget(), so treat them as input descriptors too.
    const INPUT_KEYWORDS = [
      'input', 'field', 'enter', 'url', 'title', 'search',
      'tag', 'text', 'query', 'name', 'email', 'password',
    ];
    if (INPUT_KEYWORDS.some((kw) => description.toLowerCase().includes(kw))) {
      strategies.push({
        name: 'role-textbox',
        priority: 1,
        confidence: 0.9,
      });
      strategies.push({
        name: 'placeholder',
        priority: 2,
        confidence: 0.85,
      });
    }
    
    if (description.includes('link') || description.includes('navigate')) {
      strategies.push({
        name: 'role-link',
        priority: 1,
        confidence: 0.9,
      });
    }
    
    // Generic strategies. data-testid runs FIRST (priority 0) because it is
    // the most specific and stable selector in BookmarkForge: every
    // interactive element carries one, while text/role heuristics routinely
    // false-positive on the sidebar ('add bookmark button' matched the
    // sidebar "Bookmarks" nav via /bookmark/i before reaching the FAB's
    // data-testid, so the capture panel never opened).
    strategies.push({
      name: 'data-testid',
      priority: 0,
      confidence: 0.7,
    });
    strategies.push({
      name: 'text-content',
      priority: 3,
      confidence: 0.8,
    });
    strategies.push({
      name: 'aria-role',
      priority: 4,
      confidence: 0.75,
    });
    
    return strategies.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Apply a specific healing strategy
   */
  private async applyStrategy(
    strategy: LocatorStrategy,
    description: string
  ): Promise<Locator | null> {
    const keywords = this.extractKeywords(description);
    
    switch (strategy.name) {
      case 'role-button-text':
        return this.findByRoleAndText('button', keywords);
      
      case 'role-textbox':
        return this.findByRoleAndText('textbox', keywords);
      
      case 'role-link':
        return this.findByRoleAndText('link', keywords);
      
      case 'aria-label':
        return this.findByAriaLabel(keywords);
      
      case 'placeholder':
        return this.findByPlaceholder(keywords);
      
      case 'text-content':
        return this.findByTextContent(keywords);
      
      case 'aria-role':
        return this.findByAriaRole(keywords);
      
      case 'data-testid':
        return this.findByTestId(keywords);
      
      default:
        return null;
    }
  }

  /**
   * Extract meaningful keywords from description
   */
  private extractKeywords(description: string): string[] {
    // Only remove truly common words that don't help identify elements
    // Keep action words like 'add', 'button', 'click', 'save', etc.
    const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at',
      'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
      'once'];
    
    const words = description.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
    
    return [...new Set(words)];
  }

  /**
   * Find by role and text content
   */
  private async findByRoleAndText(
    role: 'button' | 'textbox' | 'link' | 'heading' | 'navigation',
    keywords: string[]
  ): Promise<Locator | null> {
    try {
      // Try exact text match first
      const textPattern = keywords.join(' ');
      const locator = this.page.getByRole(role, { name: new RegExp(textPattern, 'i') });
      
      const count = await locator.count();
      if (count > 0) {
        return locator;
      }
      
      // Try partial matches
      for (const keyword of keywords) {
        const partialLocator = this.page.getByRole(role, { name: new RegExp(keyword, 'i') });
        if (await partialLocator.count() > 0) {
          return partialLocator;
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find by aria-label
   */
  private async findByAriaLabel(keywords: string[]): Promise<Locator | null> {
    try {
      for (const keyword of keywords) {
        const locator = this.page.locator(`[aria-label*="${keyword}" i]`);
        if (await locator.count() > 0) {
          return locator;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find by placeholder
   */
  private async findByPlaceholder(keywords: string[]): Promise<Locator | null> {
    try {
      for (const keyword of keywords) {
        const locator = this.page.locator(`[placeholder*="${keyword}" i]`);
        if (await locator.count() > 0) {
          return locator;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find by text content
   */
  private async findByTextContent(keywords: string[]): Promise<Locator | null> {
    try {
      for (const keyword of keywords) {
        const locator = this.page.getByText(new RegExp(keyword, 'i'));
        if (await locator.count() > 0) {
          return locator;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find by aria-role
   */
  private async findByAriaRole(keywords: string[]): Promise<Locator | null> {
    try {
      const roles = ['button', 'link', 'textbox', 'heading', 'navigation', 'main', 'complementary'];
      
      for (const role of roles) {
        for (const keyword of keywords) {
          const locator = this.page.locator(`[role="${role}"]`).filter({ hasText: new RegExp(keyword, 'i') });
          if (await locator.count() > 0) {
            return locator;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Find by data-testid
   */
  private async findByTestId(keywords: string[]): Promise<Locator | null> {
    try {
      for (const keyword of keywords) {
        const locator = this.page.locator(`[data-testid*="${keyword}" i]`);
        if (await locator.count() > 0) {
          return locator;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get selector string from locator
   */
  private async getLocatorSelector(locator: Locator): Promise<string> {
    // Prefer the data-testid — it is unambiguous and stable, while a text
    // selector is ambiguous and EMPTY for icon-only buttons (the capture
    // FAB), which would poison the cache with a dead `text=` entry.
    const testId = await locator.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${testId}"]`;
    }
    const text = await locator.textContent();
    return text ? `text=${text}` : '';
  }

  /**
   * Generate cache key
   */
  private getCacheKey(description: string, selector?: string): string {
    return `${description}::${selector || ''}`;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.successCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.successCache.size,
      misses: this.failureHistory.size,
      size: this.successCache.size + this.failureHistory.size,
    };
  }
}

/**
 * Create a self-healing locator instance
 */
export function createSelfHealingLocator(
  page: Page,
  config?: HealingConfig
): SelfHealingLocator {
  return new SelfHealingLocator(page, config);
}

/**
 * Quick helper to find element with self-healing
 */
export async function findElement(
  page: Page,
  description: string,
  originalSelector?: string
): Promise<Locator> {
  const healer = new SelfHealingLocator(page);
  return healer.find(description, originalSelector);
}
