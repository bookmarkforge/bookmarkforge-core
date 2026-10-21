/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Advanced Human Behavior Simulation
 * 
 * Enhanced simulation with:
 * - Fatigue simulation (slower over time)
 * - Hesitation patterns (pauses before actions)
 * - Reading time simulation
 * - Natural typing errors and corrections
 * - Mouse jitter and imprecision
 * - Decision-making delays
 * - Cognitive load simulation
 */

import type { Page, Locator } from '@playwright/test';
import { ciBehavior } from '../config';

export interface AdvancedHumanOptions {
  /** Base delay between actions (ms) */
  baseDelay?: number;
  /** Random variation in delays (ms) */
  delayVariation?: number;
  /** Mouse movement speed */
  mouseSpeed?: 'slow' | 'normal' | 'fast';
  /** Enable natural scrolling */
  naturalScrolling?: boolean;
  /** Enable accidental clicks/mistakes */
  simulateMistakes?: boolean;
  /** Enable fatigue simulation */
  enableFatigue?: boolean;
  /** Enable hesitation patterns */
  enableHesitation?: boolean;
  /** Enable reading time simulation */
  enableReadingTime?: boolean;
  /** Enable mouse jitter */
  enableMouseJitter?: boolean;
  /** Session duration for fatigue calculation (ms) */
  sessionDuration?: number;
}

export interface HumanMetrics {
  totalTimeSpent: number;
  actionsPerformed: number;
  mistakesMade: number;
  hesitationsCount: number;
  fatigueLevel: number;
}

/**
 * CI-friendly options for the human-like example specs.
 *
 * The example suite runs under `npm run test:all-human-like` with a 90s
 * per-test timeout and 2 workers. The AdvancedHumanBehavior defaults are
 * tuned for realism (baseDelay 100, fatigue/hesitation/reading-time ON),
 * which can push a single action into the seconds — blowing that budget
 * (observed timeouts in `playwright-report-human-like/`). This profile
 * keeps the simulator fast and deterministic so the specs stay green in
 * CI; individual tests that specifically exercise a feature (fatigue,
 * reading time, …) re-enable just that flag on top of this base:
 *
 *   createAdvancedHumanBehavior(page, { ...ciHumanOptions, enableReadingTime: true })
 *
 * The behavior subset (baseDelay/delayVariation/mouseSpeed/naturalScrolling/
 * simulateMistakes) is derived from `ciBehavior` (config.ts), the single
 * source of truth shared with the basic class's ciBasicOptions; the
 * advanced-only realism flags are forced off here.
 */
export const ciHumanOptions: AdvancedHumanOptions = {
  ...ciBehavior,
  enableFatigue: false,
  enableHesitation: false,
  enableReadingTime: false,
  enableMouseJitter: false,
};

/**
 * Advanced HumanBehavior class with realistic patterns
 */
export class AdvancedHumanBehavior {
  // Public readonly: `simulateHumanSession` (below) needs direct access to
  // the underlying Page for the `wait` action. Readonly keeps the binding
  // immutable while exposing it — fixing TS2341 (private member access).
  readonly page: Page;
  private options: Required<AdvancedHumanOptions>;
  private lastMousePosition = { x: 0, y: 0 };
  private sessionStartTime: number;
  private metrics: HumanMetrics;
  private fatigueFactor = 1;

  constructor(page: Page, options: AdvancedHumanOptions = {}) {
    this.page = page;
    this.options = {
      baseDelay: options.baseDelay ?? 100,
      delayVariation: options.delayVariation ?? 50,
      mouseSpeed: options.mouseSpeed ?? 'normal',
      naturalScrolling: options.naturalScrolling ?? true,
      simulateMistakes: options.simulateMistakes ?? true,
      enableFatigue: options.enableFatigue ?? true,
      enableHesitation: options.enableHesitation ?? true,
      enableReadingTime: options.enableReadingTime ?? true,
      enableMouseJitter: options.enableMouseJitter ?? true,
      sessionDuration: options.sessionDuration ?? 300000, // 5 minutes
    };
    this.sessionStartTime = Date.now();
    this.metrics = {
      totalTimeSpent: 0,
      actionsPerformed: 0,
      mistakesMade: 0,
      hesitationsCount: 0,
      fatigueLevel: 0,
    };
  }

  /**
   * Update fatigue level based on session duration
   */
  private updateFatigue(): void {
    if (!this.options.enableFatigue) return;
    
    const elapsed = Date.now() - this.sessionStartTime;
    const progress = Math.min(elapsed / this.options.sessionDuration, 1);
    
    // Fatigue increases exponentially over time
    this.fatigueFactor = 1 + (progress * progress * 0.5);
    this.metrics.fatigueLevel = progress;
  }

  /**
   * Get delay with fatigue and variation
   */
  private getEnhancedDelay(baseMs?: number): number {
    this.updateFatigue();
    
    const base = baseMs ?? this.options.baseDelay;
    const variation = Math.random() * this.options.delayVariation * 2 - this.options.delayVariation;
    const delay = (base + variation) * this.fatigueFactor;
    
    return Math.max(30, delay);
  }

  /**
   * Simulate hesitation before action
   */
  private async simulateHesitation(probability: number = 0.3): Promise<void> {
    if (!this.options.enableHesitation) return;
    if (Math.random() > probability) return;
    
    // Hesitation duration increases with fatigue
    const hesitationTime = (200 + Math.random() * 500) * this.fatigueFactor;
    this.metrics.hesitationsCount++;
    
    await this.page.waitForTimeout(hesitationTime);
  }

  /**
   * Simulate reading time based on content length
   */
  async simulateReading(textLength: number): Promise<void> {
    if (!this.options.enableReadingTime) return;
    
    // Average reading speed: 200-300 words per minute
    // Average word: 5 characters
    const words = textLength / 5;
    const readingTimeMs = (words / 250) * 60 * 1000; // 250 wpm
    
    // Cap reading time between 500ms and 5000ms
    const cappedTime = Math.max(500, Math.min(5000, readingTimeMs * this.fatigueFactor));
    
    await this.page.waitForTimeout(cappedTime);
  }

  /**
   * Generate natural mouse path with jitter
   */
  private generateNaturalMousePath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    const steps = 20 + Math.floor(Math.random() * 10);
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      
      // Bezier curve interpolation
      const midX = (startX + endX) / 2 + (Math.random() - 0.5) * 80;
      const midY = (startY + endY) / 2 + (Math.random() - 0.5) * 80;
      
      const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * midX + t * t * endX;
      const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * midY + t * t * endY;
      
      // Add jitter
      if (this.options.enableMouseJitter) {
        const jitterX = (Math.random() - 0.5) * 3;
        const jitterY = (Math.random() - 0.5) * 3;
        points.push({ x: x + jitterX, y: y + jitterY });
      } else {
        points.push({ x, y });
      }
    }
    
    return points;
  }

  /**
   * Move mouse with natural movement and fatigue
   */
  async moveMouse(x: number, y: number): Promise<void> {
    const path = this.generateNaturalMousePath(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
      x,
      y
    );

    const speedMultiplier = {
      slow: 2,
      normal: 1,
      fast: 0.5,
    }[this.options.mouseSpeed] * this.fatigueFactor;

    for (const point of path) {
      await this.page.mouse.move(point.x, point.y);
      await this.page.waitForTimeout(10 * speedMultiplier);
    }

    this.lastMousePosition = { x, y };
  }

  /**
   * Click with natural movement, hesitation, and fatigue
   */
  async click(locator: Locator | string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;

    // Wait for element
    await element.waitFor({ state: 'visible', timeout: 10000 });

    // Bounded retry: the raw coordinate click has no actionability retry,
    // so under parallel load the target can shift between the box read and
    // the click and be silently missed (the panel never opens). Re-validate
    // the coordinates right before clicking and retry when they drifted.
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      // Scroll into view so the computed click point is actually on-screen
      // (waitFor visible does not guarantee viewport visibility).
      await this.scrollIntoViewSafely(element);

      // Get element position
      const box = await element.boundingBox();
      if (!box) throw new Error('Element not found or not visible');

      // Randomized click position within element
      const clickX = box.x + box.width * (0.2 + Math.random() * 0.6);
      const clickY = box.y + box.height * (0.2 + Math.random() * 0.6);

      // Simulate hesitation before clicking
      await this.simulateHesitation(0.4);

      // Move to element naturally
      await this.moveMouse(clickX, clickY);

      // Pre-click pause (human thinking)
      await this.page.waitForTimeout(this.getEnhancedDelay(80));

      // Re-read the box: the raw mouse.click has no internal retry, so if
      // the element moved under the pointer (parallel re-render) the click
      // would silently miss. Verify the point is still inside, else retry.
      const freshBox = await element.boundingBox();
      const stillOnTarget =
        freshBox &&
        clickX >= freshBox.x - 1 &&
        clickX <= freshBox.x + freshBox.width + 1 &&
        clickY >= freshBox.y - 1 &&
        clickY <= freshBox.y + freshBox.height + 1;

      if (stillOnTarget) {
        // Click
        await this.page.mouse.click(clickX, clickY);

        // Post-click delay (captured once so metrics match the real wait)
        const postClickDelay = this.getEnhancedDelay();
        await this.page.waitForTimeout(postClickDelay);

        this.metrics.actionsPerformed++;
        this.metrics.totalTimeSpent += postClickDelay;
        return;
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        await this.page.waitForTimeout(100 * (attempt + 1));
      }
    }

    throw new Error('Element moved during click (unstable layout)');
  }

  /**
   * Type text with realistic patterns
   */
  async type(locator: Locator | string, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    // Click on element first
    await this.click(element);
    
    // Clear existing text
    await element.fill('');
    
    // Simulate thinking before typing
    await this.simulateHesitation(0.2);
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Check for typos (adjacent keys on QWERTY keyboard)
      if (this.options.simulateMistakes && Math.random() < 0.08) {
        const adjacentKeys: Record<string, string[]> = {
          'a': ['s', 'q', 'w', 'z'],
          'b': ['v', 'n', 'g', 'h'],
          'c': ['x', 'v', 'd', 'f'],
          // ... more key mappings
        };
        
        const adjacent = adjacentKeys[char.toLowerCase()];
        if (adjacent && adjacent.length > 0) {
          const wrongChar = adjacent[Math.floor(Math.random() * adjacent.length)];
          await this.page.keyboard.type(wrongChar, { delay: 30 });
          
          // Pause before realizing mistake
          await this.page.waitForTimeout(200 + Math.random() * 400);
          
          // Correct the mistake
          await this.page.keyboard.press('Backspace');
          await this.page.waitForTimeout(100);
          
          this.metrics.mistakesMade++;
        }
      }
      
      // Natural typing delay with fatigue
      const typingDelay = (40 + Math.random() * 80) * this.fatigueFactor;
      
      // Playwright's keyboard.type applies the Shift modifier automatically
      // for uppercase characters, so no manual Shift handling is needed.
      await this.page.keyboard.type(char, { delay: typingDelay });
      
      // Occasional pause (thinking while typing)
      if (Math.random() < 0.05) {
        await this.page.waitForTimeout(300 + Math.random() * 500);
      }
      
      // Longer pause at punctuation
      if (char.match(/[.!?;:]/)) {
        await this.page.waitForTimeout(200 + Math.random() * 300);
      }
      
      this.metrics.actionsPerformed++;
    }
  }

  /**
   * Scroll naturally with momentum and fatigue
   */
  async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number = 3
  ): Promise<void> {
    if (!this.options.naturalScrolling) {
      const delta = direction === 'up' || direction === 'left' ? -amount * 100 : amount * 100;
      await this.page.mouse.wheel(
        direction === 'left' || direction === 'right' ? delta : 0,
        direction === 'up' || direction === 'down' ? delta : 0
      );
      return;
    }

    const isVertical = direction === 'up' || direction === 'down';
    const delta = direction === 'up' || direction === 'left' ? -1 : 1;
    
    // Scroll with natural momentum: the gap between ticks shrinks as the
    // scroll "gains speed", landing with a quick final flourish.
    for (let i = 0; i < amount; i++) {
      const scrollAmount = delta * (25 + Math.random() * 35) / this.fatigueFactor;
      
      await this.page.mouse.wheel(
        isVertical ? 0 : scrollAmount,
        isVertical ? scrollAmount : 0
      );
      
      // Delay shrinks per tick (momentum), floored so the page can settle.
      const scrollDelay = Math.max(15, (40 + Math.random() * 40) * (1 - i * 0.1));
      await this.page.waitForTimeout(scrollDelay);
      
      this.metrics.actionsPerformed++;
    }
  }

  /**
   * Type with intentional mistakes and corrections
   */
  async typeWithMistakes(locator: Locator | string, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    await this.click(element);
    await element.fill('');
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // 12% chance of typing wrong character
      if (Math.random() < 0.12) {
        // Type wrong character (nearby on keyboard)
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
        await this.page.keyboard.type(wrongChar, { delay: 40 });
        
        // Realize mistake after delay
        await this.page.waitForTimeout(250 + Math.random() * 350);
        
        // Correct it
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(80);
        
        this.metrics.mistakesMade++;
      }
      
      // Type correct character
      const delay = (45 + Math.random() * 90) * this.fatigueFactor;
      await this.page.keyboard.type(char, { delay });
      
      this.metrics.actionsPerformed++;
    }
  }

  /**
   * Hover over element with natural movement
   */
  async hover(locator: Locator | string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    await element.waitFor({ state: 'visible' });
    
    // Scroll into view so the computed coordinates are actually on-screen
    // (waitFor visible does not guarantee viewport visibility).
    await this.scrollIntoViewSafely(element);
    
    const box = await element.boundingBox();
    if (!box) throw new Error('Element not found or not visible');
    
    // Hover position with slight randomness
    const hoverX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const hoverY = box.y + box.height * (0.3 + Math.random() * 0.4);
    
    await this.moveMouse(hoverX, hoverY);
    
    // Hover duration varies with fatigue
    const hoverDuration = (150 + Math.random() * 250) * this.fatigueFactor;
    await this.page.waitForTimeout(hoverDuration);
    
    this.metrics.actionsPerformed++;
  }

  /**
   * Press key combination naturally
   */
  async pressKey(key: string, modifiers?: Array<'Control' | 'Alt' | 'Shift' | 'Meta'>): Promise<void> {
    await this.simulateHesitation(0.2);
    
    if (modifiers) {
      for (const modifier of modifiers) {
        await this.page.keyboard.down(modifier);
        await this.page.waitForTimeout(30); // Natural delay between modifiers
      }
    }
    
    await this.page.keyboard.press(key);
    
    if (modifiers) {
      // Copy before reversing so the caller's array is never mutated in place.
      for (const modifier of [...modifiers].reverse()) {
        await this.page.keyboard.up(modifier);
        await this.page.waitForTimeout(30);
      }
    }
    
    await this.page.waitForTimeout(this.getEnhancedDelay());
    this.metrics.actionsPerformed++;
  }

  /**
   * Double click naturally
   */
  async doubleClick(locator: Locator | string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    await element.waitFor({ state: 'visible' });
    
    // Scroll into view so the computed coordinates are actually on-screen
    // (waitFor visible does not guarantee viewport visibility).
    await this.scrollIntoViewSafely(element);
    
    const box = await element.boundingBox();
    if (!box) throw new Error('Element not found or not visible');
    
    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;
    
    await this.moveMouse(clickX, clickY);
    await this.page.waitForTimeout(50);
    await this.page.mouse.dblclick(clickX, clickY);
    
    await this.page.waitForTimeout(this.getEnhancedDelay());
    this.metrics.actionsPerformed++;
  }

  /**
   * Drag and drop naturally
   */
  async dragAndDrop(
    source: Locator | string,
    target: Locator | string
  ): Promise<void> {
    const sourceElement = typeof source === 'string' ? this.page.locator(source) : source;
    const targetElement = typeof target === 'string' ? this.page.locator(target) : target;
    
    await sourceElement.waitFor({ state: 'visible' });
    await targetElement.waitFor({ state: 'visible' });
    
    // Scroll both endpoints into view so the computed coordinates are
    // actually on-screen (waitFor visible does not guarantee viewport
    // visibility). Scrolling the target can push the source back out of
    // view, so re-scroll the source afterwards to guarantee the drag
    // start point is on-screen.
    await this.scrollIntoViewSafely(sourceElement);
    await this.scrollIntoViewSafely(targetElement);
    await this.scrollIntoViewSafely(sourceElement);
    
    const sourceBox = await sourceElement.boundingBox();
    const targetBox = await targetElement.boundingBox();
    
    if (!sourceBox || !targetBox) {
      throw new Error('Source or target element not found');
    }
    
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    
    await this.moveMouse(startX, startY);
    await this.page.mouse.down();
    await this.page.waitForTimeout(200); // Natural grab delay
    
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;
    
    await this.moveMouse(endX, endY);
    
    await this.page.waitForTimeout(100);
    await this.page.mouse.up();
    
    await this.page.waitForTimeout(this.getEnhancedDelay());
    this.metrics.actionsPerformed++;
  }

  /**
   * Select text naturally
   */
  async selectText(locator: Locator | string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    await element.waitFor({ state: 'visible' });
    
    // Scroll into view so the computed coordinates are actually on-screen
    // (waitFor visible does not guarantee viewport visibility).
    await this.scrollIntoViewSafely(element);
    
    const box = await element.boundingBox();
    if (!box) throw new Error('Element not found or not visible');
    
    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;
    
    await this.moveMouse(clickX, clickY);
    await this.page.mouse.click(clickX, clickY, { clickCount: 3 });
    
    await this.page.waitForTimeout(this.getEnhancedDelay());
    this.metrics.actionsPerformed++;
  }

  /**
   * Scroll the target into view with a bounded retry for transient detach
   * races. Under parallel load React can unmount/remount a node between
   * waitFor() and the scroll, making Playwright throw "Protocol error
   * (DOM.scrollIntoViewIfNeeded): Cannot find context with specified id".
   * Locators re-resolve on every call, so retrying a few times (up to 3) turns
   * that race into a no-op instead of a flaky failure. Real failures (the
   * element never re-attaches) still throw after the budget is exhausted.
   */
  private async scrollIntoViewSafely(element: Locator): Promise<void> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        await element.scrollIntoViewIfNeeded();
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const transient =
          msg.includes("Cannot find context") ||
          msg.includes("not attached to the DOM");
        if (!transient || attempt === MAX_ATTEMPTS - 1) throw err;
        // Backoff 100/200ms: enough for React to remount the node after a
        // render race under heavy parallel load, without burning CI budget.
        await this.page.waitForTimeout(100 * (attempt + 1));
      }
    }
  }

  /**
   * Wait for user to "read" content
   */
  async readContent(duration?: number): Promise<void> {
    const readTime = duration ?? (1000 + Math.random() * 2000);
    const scrollCount = Math.floor(readTime / 600);
    
    for (let i = 0; i < scrollCount; i++) {
      await this.scroll('down', 1);
      await this.page.waitForTimeout(400 + Math.random() * 300);
    }
  }

  /**
   * Simulate decision-making delay
   */
  async makeDecision(complexity: 'simple' | 'medium' | 'complex' = 'medium'): Promise<void> {
    const decisionTimes = {
      simple: 300 + Math.random() * 500,
      medium: 500 + Math.random() * 1000,
      complex: 1000 + Math.random() * 2000,
    };
    
    const decisionTime = decisionTimes[complexity] * this.fatigueFactor;
    await this.page.waitForTimeout(decisionTime);
  }

  /**
   * Get current metrics
   */
  getMetrics(): HumanMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics for new session
   */
  resetMetrics(): void {
    this.sessionStartTime = Date.now();
    this.metrics = {
      totalTimeSpent: 0,
      actionsPerformed: 0,
      mistakesMade: 0,
      hesitationsCount: 0,
      fatigueLevel: 0,
    };
    this.fatigueFactor = 1;
  }
}

/**
 * Create advanced human behavior instance
 */
export function createAdvancedHumanBehavior(
  page: Page,
  options?: AdvancedHumanOptions
): AdvancedHumanBehavior {
  return new AdvancedHumanBehavior(page, options);
}

/**
 * Simulate a complete human session
 */
export async function simulateHumanSession(
  page: Page,
  actions: Array<{ type: string; params?: any }>,
  options?: AdvancedHumanOptions
): Promise<HumanMetrics> {
  const human = createAdvancedHumanBehavior(page, options);
  
  for (const action of actions) {
    switch (action.type) {
      case 'click':
        await human.click(action.params?.locator);
        break;
      case 'type':
        await human.type(action.params?.locator, action.params?.text);
        break;
      case 'scroll':
        await human.scroll(action.params?.direction, action.params?.amount);
        break;
      case 'hover':
        await human.hover(action.params?.locator);
        break;
      case 'wait':
        await human.page.waitForTimeout(action.params?.duration || 1000);
        break;
    }
  }
  
  return human.getMetrics();
}
