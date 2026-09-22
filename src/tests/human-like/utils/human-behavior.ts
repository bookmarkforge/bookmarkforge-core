/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Human Behavior Simulation Utilities
 * 
 * Simulates realistic human behavior patterns for testing:
 * - Mouse movements with acceleration/deceleration
 * - Keyboard typing with natural delays
 * - Scrolling patterns
 * - Random delays and hesitations
 * - Touch gestures (for mobile testing)
 */

import type { Page, Locator } from '@playwright/test';
import { ciBehavior } from '../config';

export interface HumanBehaviorOptions {
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
  /** Simulate user fatigue (slower over time) */
  simulateFatigue?: boolean;
  /** Fatigue rate (delay increase per action) */
  fatigueRate?: number;
  /** Simulate reading patterns (F-shape scanning) */
  readingPatterns?: boolean;
}

export interface MousePath {
  x: number;
  y: number;
  timestamp: number;
}

/**
 * CI-friendly options for the basic HumanBehavior simulator, mirroring
 * ciHumanOptions in advanced-human-behavior.ts. Derived from `ciBehavior`
 * (config.ts) so the central CI profile stays the single source of truth;
 * the basic class has no fatigue/hesitation/reading-time flags, so the
 * derived behavior profile (baseDelay 30, mouseSpeed fast, no natural
 * scrolling, no mistakes) is the complete fast profile.
 */
export const ciBasicOptions: HumanBehaviorOptions = {
  ...ciBehavior,
};

/**
 * Generates natural Bezier curve points for mouse movement
 */
function bezierCurve(
  points: Array<{ x: number; y: number }>,
  steps: number = 20
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points;

  const result: Array<{ x: number; y: number }> = [];
  
  for (let t = 0; t <= 1; t += 1 / steps) {
    // De Casteljau's algorithm
    const tempPoints = [...points];
    
    for (let i = points.length - 1; i > 0; i--) {
      for (let j = 0; j < i; j++) {
        tempPoints[j] = {
          x: (1 - t) * tempPoints[j].x + t * tempPoints[j + 1].x,
          y: (1 - t) * tempPoints[j].y + t * tempPoints[j + 1].y,
        };
      }
    }
    
    result.push(tempPoints[0]);
  }
  
  return result;
}

/**
 * Adds realistic acceleration/deceleration to mouse movement
 */
function addAcceleration(
  points: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;

  const result: Array<{ x: number; y: number }> = [];
  
  // Slow start (ease-in)
  for (let i = 0; i < Math.min(3, points.length); i++) {
    const factor = (i + 1) / 4;
    result.push({
      x: points[i].x * factor + points[0].x * (1 - factor),
      y: points[i].y * factor + points[0].y * (1 - factor),
    });
  }
  
  // Middle section (constant speed)
  for (let i = 3; i < points.length - 3; i++) {
    result.push(points[i]);
  }
  
  // Slow end (ease-out)
  for (let i = Math.max(0, points.length - 3); i < points.length; i++) {
    const factor = (points.length - i) / 4;
    const lastIndex = points.length - 1;
    result.push({
      x: points[i].x * factor + points[lastIndex].x * (1 - factor),
      y: points[i].y * factor + points[lastIndex].y * (1 - factor),
    });
  }
  
  return result;
}

/**
 * HumanBehavior class for simulating realistic user interactions
 */
export class HumanBehavior {
  private page: Page;
  private options: Required<HumanBehaviorOptions>;
  private lastMousePosition = { x: 0, y: 0 };
  private actionCount = 0;
  private fatigueMultiplier = 1.0;

  constructor(page: Page, options: HumanBehaviorOptions = {}) {
    this.page = page;
    this.options = {
      baseDelay: options.baseDelay ?? 100,
      delayVariation: options.delayVariation ?? 50,
      mouseSpeed: options.mouseSpeed ?? 'normal',
      naturalScrolling: options.naturalScrolling ?? true,
      simulateMistakes: options.simulateMistakes ?? false,
      simulateFatigue: options.simulateFatigue ?? false,
      fatigueRate: options.fatigueRate ?? 5,
      readingPatterns: options.readingPatterns ?? true,
    };
  }

  /**
   * Get random delay between actions (with fatigue simulation)
   */
  private getDelay(): number {
    // Apply fatigue if enabled
    if (this.options.simulateFatigue) {
      this.fatigueMultiplier = 1 + (this.actionCount * this.options.fatigueRate / 1000);
    }
    
    const variation = Math.random() * this.options.delayVariation * 2 - this.options.delayVariation;
    const baseDelay = this.options.baseDelay * this.fatigueMultiplier;
    return Math.max(50, baseDelay + variation);
  }

  /**
   * Wait for random human-like delay
   */
  async wait(): Promise<void> {
    await this.page.waitForTimeout(this.getDelay());
  }

  /**
   * Generate natural mouse path between two points
   */
  private generateMousePath(
    startX: number,
    startY: number,
    endX: number,
    endY: number
  ): Array<{ x: number; y: number }> {
    // Add some randomness to control points
    const midX = (startX + endX) / 2 + (Math.random() - 0.5) * 50;
    const midY = (startY + endY) / 2 + (Math.random() - 0.5) * 50;
    
    const controlPoints = [
      { x: startX, y: startY },
      { x: midX, y: midY },
      { x: endX, y: endY },
    ];
    
    let path = bezierCurve(controlPoints, 30);
    path = addAcceleration(path);
    
    return path;
  }

  /**
   * Move mouse with natural movement
   */
  async moveMouse(x: number, y: number): Promise<void> {
    const path = this.generateMousePath(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
      x,
      y
    );

    const speedMultiplier = {
      slow: 2,
      normal: 1,
      fast: 0.5,
    }[this.options.mouseSpeed];

    for (const point of path) {
      await this.page.mouse.move(point.x, point.y);
      await this.page.waitForTimeout(10 * speedMultiplier);
    }

    this.lastMousePosition = { x, y };
  }

  /**
   * Click with natural movement and delay
   */
  async click(locator: Locator | string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;

    // Wait for element to be visible
    await element.waitFor({ state: 'visible' });

    // Increment action count for fatigue tracking
    this.actionCount++;

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
      if (!box) {
        throw new Error('Element not found or not visible');
      }

      // Calculate click position (slightly randomized within element)
      const clickX = box.x + box.width * (0.3 + Math.random() * 0.4);
      const clickY = box.y + box.height * (0.3 + Math.random() * 0.4);

      // Move to element naturally
      await this.moveMouse(clickX, clickY);

      // Small pause before clicking (human hesitation)
      await this.page.waitForTimeout(this.getDelay() / 2);

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

        // Post-click delay
        await this.wait();
        return;
      }

      if (attempt < MAX_ATTEMPTS - 1) {
        await this.page.waitForTimeout(100 * (attempt + 1));
      }
    }

    throw new Error('Element moved during click (unstable layout)');
  }

  /**
   * Type text with natural keystroke delays
   */
  async type(locator: Locator | string, text: string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    // Click on element first
    await this.click(element);
    
    // Clear existing text
    await element.fill('');
    
    // Type each character with delay
    for (const char of text) {
      await this.page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
      
      // Occasional longer pause (thinking)
      if (Math.random() < 0.1) {
        await this.page.waitForTimeout(200 + Math.random() * 300);
      }
    }
  }

  /**
   * Scroll naturally
   */
  async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number = 3
  ): Promise<void> {
    if (!this.options.naturalScrolling) {
      // Simple scroll
      const delta = direction === 'up' || direction === 'left' ? -amount : amount;
      await this.page.mouse.wheel(
        direction === 'left' || direction === 'right' ? delta : 0,
        direction === 'up' || direction === 'down' ? delta : 0
      );
      return;
    }

    // Natural scrolling with momentum
    const isVertical = direction === 'up' || direction === 'down';
    const delta = direction === 'up' || direction === 'left' ? -1 : 1;
    
    for (let i = 0; i < amount; i++) {
      const scrollAmount = delta * (20 + Math.random() * 30);
      
      await this.page.mouse.wheel(
        isVertical ? 0 : scrollAmount,
        isVertical ? scrollAmount : 0
      );
      
      await this.page.waitForTimeout(50 + Math.random() * 50);
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
      
      // 10% chance of typing wrong character
      if (this.options.simulateMistakes && Math.random() < 0.1) {
        // Type wrong character
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
        await this.page.keyboard.type(wrongChar, { delay: 50 });
        
        // Realize mistake and correct it
        await this.page.waitForTimeout(300 + Math.random() * 200);
        await this.page.keyboard.press('Backspace');
        await this.page.waitForTimeout(100);
      }
      
      // Type correct character
      await this.page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
    }
  }

  /**
   * Hover over element naturally
   */
  async hover(locator: Locator | string): Promise<void> {
    const element = typeof locator === 'string' ? this.page.locator(locator) : locator;
    
    await element.waitFor({ state: 'visible' });
    
    // Scroll into view so the computed coordinates are actually on-screen
    // (waitFor visible does not guarantee viewport visibility).
    await this.scrollIntoViewSafely(element);
    
    const box = await element.boundingBox();
    if (!box) throw new Error('Element not found or not visible');
    
    const hoverX = box.x + box.width / 2;
    const hoverY = box.y + box.height / 2;
    
    await this.moveMouse(hoverX, hoverY);
    
    // Small delay while hovering
    await this.page.waitForTimeout(200 + Math.random() * 300);
  }

  /**
   * Press key combination naturally
   */
  async pressKey(key: string, modifiers?: Array<'Control' | 'Alt' | 'Shift' | 'Meta'>): Promise<void> {
    if (modifiers) {
      for (const modifier of modifiers) {
        await this.page.keyboard.down(modifier);
      }
    }
    
    await this.page.keyboard.press(key);
    
    if (modifiers) {
      // Copy before reversing so the caller's array is never mutated in place.
      for (const modifier of [...modifiers].reverse()) {
        await this.page.keyboard.up(modifier);
      }
    }
    
    await this.wait();
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
    
    await this.wait();
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
    
    // Start drag
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    
    await this.moveMouse(startX, startY);
    await this.page.mouse.down();
    await this.page.waitForTimeout(200);
    
    // Move to target with natural path
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;
    
    await this.moveMouse(endX, endY);
    
    // Drop
    await this.page.waitForTimeout(100);
    await this.page.mouse.up();
    
    await this.wait();
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
    
    // Triple click to select all text
    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;
    
    await this.moveMouse(clickX, clickY);
    await this.page.mouse.click(clickX, clickY, { clickCount: 3 });
    
    await this.wait();
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
   * Wait for user to "read" content with F-shape scanning pattern
   */
  async readContent(duration: number = 1000): Promise<void> {
    if (!this.options.readingPatterns) {
      // Simple reading simulation
      await this.page.waitForTimeout(duration);
      return;
    }

    // F-shape scanning pattern: users scan content in an F pattern
    // - Read top line fully
    // - Scan second line partially
    // - Vertical scan down left side
    const initialDelay = duration * 0.3;
    await this.page.waitForTimeout(initialDelay);

    // Simulate reading with occasional scrolling (F-shape)
    const scrollCount = Math.floor(duration / 500);
    
    for (let i = 0; i < scrollCount; i++) {
      // Horizontal scan (reading)
      if (i % 2 === 0) {
        await this.scroll('right', 1);
        await this.page.waitForTimeout(200 + Math.random() * 100);
      }
      
      // Vertical scan (skimming)
      await this.scroll('down', 1);
      await this.page.waitForTimeout(300 + Math.random() * 200);
      
      // Move mouse slightly while reading (simulating eye tracking)
      const mouseX = this.lastMousePosition.x + (Math.random() - 0.5) * 100;
      const mouseY = this.lastMousePosition.y + 50;
      await this.moveMouse(mouseX, mouseY);
    }
  }

  /**
   * Simulate user pausing/thinking time
   */
  async think(duration: number = 500): Promise<void> {
    // Users pause before making decisions
    const thinkingTime = duration * (0.8 + Math.random() * 0.4);
    await this.page.waitForTimeout(thinkingTime);
  }

  /**
   * Reset fatigue counter (for test isolation)
   */
  resetFatigue(): void {
    this.actionCount = 0;
    this.fatigueMultiplier = 1.0;
  }
}

/**
 * Create a human behavior instance for a page
 */
export function createHumanBehavior(
  page: Page,
  options?: HumanBehaviorOptions
): HumanBehavior {
  return new HumanBehavior(page, options);
}

/**
 * Quick helper for natural delays
 */
export async function humanDelay(page: Page, ms: number = 100): Promise<void> {
  const variation = ms * 0.3;
  const delay = ms + (Math.random() * variation * 2 - variation);
  await page.waitForTimeout(Math.max(50, delay));
}
