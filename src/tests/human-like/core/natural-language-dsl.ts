/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Natural Language DSL for Testing
 * 
 * Write tests in plain English that get executed by Playwright.
 * Example:
 * 
 *   test('add bookmark flow', async ({ page }) => {
 *     const scenario = new NaturalLanguageScenario(page);
 *     
 *     await scenario.execute([
 *       'Open the app',
 *       'Skip password setup',
 *       'Click the add bookmark button',
 *       'Enter "https://example.com" in the URL field',
 *       'Click save',
 *       'Verify the bookmark appears in the list'
 *     ]);
 *   });
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { HumanBehavior } from '../utils/human-behavior';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import type { SelfHealingLocator } from './self-healing-locators';
import { createSelfHealingLocator } from './self-healing-locators';
import {
  shouldOpenBookmarksTab,
  resolveAppTab,
  selectVerifyTitle,
} from './dsl-views';

export interface StepResult {
  step: string;
  success: boolean;
  duration: number;
  error?: string;
  screenshot?: string;
}

export interface ScenarioConfig {
  /** Take screenshot after each step */
  screenshotOnStep?: boolean;
  /** Stop on first failure */
  stopOnFailure?: boolean;
  /** Max retry attempts per step */
  maxRetries?: number;
  /** Delay between steps (ms) */
  stepDelay?: number;
}

export type StepType = 
  | 'navigate'
  | 'click'
  | 'type'
  | 'fill'
  | 'press'
  | 'hover'
  | 'scroll'
  | 'verify'
  | 'wait'
  | 'custom';

export interface ParsedStep {
  type: StepType;
  target?: string;
  value?: string;
  options?: Record<string, any>;
  original: string;
}

/**
 * Natural Language Scenario executor
 */
export class NaturalLanguageScenario {
  private page: Page;
  private human: HumanBehavior;
  private healer: SelfHealingLocator;
  private config: Required<ScenarioConfig>;
  private results: StepResult[] = [];
  /** Titles entered into the capture form in scenario order, so a
   *  'Verify the bookmark appears in the list' can assert the most recent
   *  one for real (see selectVerifyTitle). */
  private capturedTitles: string[] = [];

  constructor(page: Page, config: ScenarioConfig = {}) {
    this.page = page;
    // The default HumanBehavior options are tuned for demo realism and can
    // take several seconds per action; the scenario executor is used by the
    // CI human-like suite, so it must use the fast ci profile (short base
    // delay, fatigue/hesitation/mistakes off) to stay inside the 90s/test
    // budget.
    this.human = createHumanBehavior(page, ciBasicOptions);
    this.healer = createSelfHealingLocator(page);
    this.config = {
      screenshotOnStep: config.screenshotOnStep ?? false,
      stopOnFailure: config.stopOnFailure ?? false,
      maxRetries: config.maxRetries ?? 2,
      stepDelay: config.stepDelay ?? 500,
    };
  }

  /**
   * Execute a list of natural language steps.
   *
   * Each step is recorded in this.results by executeStep (single source of
   * truth), so allPassed()/getSummary() reflect exactly what ran.
   */
  async execute(steps: string[]): Promise<StepResult[]> {
    this.results = [];
    
    for (const step of steps) {
      const result = await this.executeStep(step);
      
      if (!result.success && this.config.stopOnFailure) {
        break;
      }
      
      // Delay between steps
      await this.page.waitForTimeout(this.config.stepDelay);
    }
    
    return this.results;
  }

  /**
   * Execute a single natural language step, recording it in this.results.
   *
   * Recording here (instead of only in execute) keeps allPassed()/getSummary()
   * truthful for direct callers too — a previous version left this.results
   * empty on direct calls, so [].every() made allPassed() return true even
   * when a step had failed (a false-green).
   */
  async executeStep(step: string): Promise<StepResult> {
    const startTime = Date.now();
    let lastError: string | undefined;
    
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const parsed = this.parseStep(step);
        await this.executeParsedStep(parsed);
        
        const duration = Date.now() - startTime;
        
        // Take screenshot if configured
        if (this.config.screenshotOnStep) {
          await this.page.screenshot({
            path: `test-results/screenshots/step-${this.results.length + 1}.png`,
          });
        }
        
        const result: StepResult = { step, success: true, duration };
        this.results.push(result);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        
        // Wait before retry
        if (attempt < this.config.maxRetries - 1) {
          await this.page.waitForTimeout(1000);
        }
      }
    }
    
    const result: StepResult = {
      step,
      success: false,
      duration: Date.now() - startTime,
      error: lastError,
    };
    this.results.push(result);
    return result;
  }

  /**
   * Parse natural language step into structured format
   */
  private parseStep(step: string): ParsedStep {
    const lowerStep = step.toLowerCase().trim();
    
    // Navigation. 'go back to X' counts too — the demo step 'Go back to the
    // main page' would otherwise fall through to the default click and never
    // close the Settings modal it left open.
    if (lowerStep.startsWith('open') || lowerStep.startsWith('go back') || lowerStep.startsWith('go to') || lowerStep.startsWith('navigate')) {
      const url = this.extractQuotedString(step) || this.extractUrl(step);
      return {
        type: 'navigate',
        target: url,
        original: step,
      };
    }
    
    // Click
    if (lowerStep.includes('click') || lowerStep.includes('tap') || lowerStep.includes('press')) {
      const target = this.extractTarget(step);
      return {
        type: 'click',
        target,
        original: step,
      };
    }
    
    // Type/Fill
    if (lowerStep.includes('type') || lowerStep.includes('enter') || lowerStep.includes('fill') || lowerStep.includes('input')) {
      const value = this.extractQuotedString(step);
      const target = this.extractTarget(step);
      return {
        type: lowerStep.includes('fill') ? 'fill' : 'type',
        target,
        value,
        original: step,
      };
    }
    
    // Hover
    if (lowerStep.includes('hover') || lowerStep.includes('mouse over')) {
      const target = this.extractTarget(step);
      return {
        type: 'hover',
        target,
        original: step,
      };
    }
    
    // Scroll
    if (lowerStep.includes('scroll')) {
      const direction = lowerStep.includes('up') ? 'up' : 
                       lowerStep.includes('down') ? 'down' :
                       lowerStep.includes('left') ? 'left' : 'right';
      return {
        type: 'scroll',
        value: direction,
        original: step,
      };
    }
    
    // Verify/Assert
    if (lowerStep.includes('verify') || lowerStep.includes('check') || lowerStep.includes('assert') || lowerStep.includes('should') || lowerStep.includes('expect')) {
      const target = this.extractTarget(step);
      const value = this.extractQuotedString(step);
      return {
        type: 'verify',
        target,
        value,
        original: step,
      };
    }
    
    // Wait
    if (lowerStep.includes('wait')) {
      const duration = this.extractNumber(step) || 1000;
      return {
        type: 'wait',
        value: String(duration),
        original: step,
      };
    }
    
    // Default: try to click
    return {
      type: 'click',
      target: step,
      original: step,
    };
  }

  /**
   * Execute a parsed step
   */
  private async executeParsedStep(parsed: ParsedStep): Promise<void> {
    switch (parsed.type) {
      case 'navigate':
        if (parsed.target && /^https?:\/\//i.test(parsed.target)) {
          await this.page.goto(parsed.target);
        } else {
          // No explicit URL: the step refers to an in-app tab (BookmarkForge
          // is an SPA — 'open the settings' must activate the settings tab,
          // not navigate to a URL).
          await this.openAppTab(parsed.target ?? parsed.original);
        }
        break;
        
      case 'click':
        if (parsed.target) {
          const locator = await this.healer.find(parsed.target);
          await this.human.click(locator);
        }
        break;
        
      case 'type':
      case 'fill':
        if (parsed.target && parsed.value) {
          const locator = await this.healer.find(parsed.target);
          await this.human.type(locator, parsed.value);
          // Remember the title entered in the capture form so a following
          // 'Verify the bookmark appears in the list' can assert the actual
          // bookmark instead of only checking the search box is visible.
          // Kept in scenario order so a quoted verify can always win and
          // the most recent unquoted verify has the right fallback.
          if (/title/i.test(parsed.target)) {
            this.capturedTitles.push(parsed.value);
          }
        }
        break;
        
      case 'hover':
        if (parsed.target) {
          const locator = await this.healer.find(parsed.target);
          await this.human.hover(locator);
        }
        break;
        
      case 'scroll':
        const direction = (parsed.value as 'up' | 'down' | 'left' | 'right') || 'down';
        await this.human.scroll(direction);
        break;
        
      case 'verify': {
        // BookmarkForge does NOT auto-navigate to the bookmark list after a
        // QuickCapture save, so a verify that targets the list must open the
        // Bookmarks tab first.
        const needsList = this.mentionsBookmarkList(parsed);
        if (needsList) {
          // Resolve the title BEFORE navigating so a mis-written step fails
          // fast without opening the Bookmarks tab first. Prefer the quoted
          // title in the step, else the title entered into the capture form
          // earlier in the scenario. If neither exists the step has nothing
          // to assert — throw instead of passing silently (the original
          // false-green bug).
          const title = selectVerifyTitle(parsed.value, this.capturedTitles);
          if (!title) {
            throw new Error(
              'verify: list step needs a quoted title or a prior ' +
                '"Enter … in the title field" step',
            );
          }
          await this.openAppTab('bookmarks');
          await expect(this.page.getByTestId('search-input')).toBeVisible({
            timeout: 10_000,
          });
          // REAL assertion: the bookmark itself must render.
          await expect(this.page.getByText(title)).toBeVisible({
            timeout: 10_000,
          });
        }
        if (!needsList && !parsed.target && !parsed.value) {
          // A verify with nothing to assert (no list, no target, no quoted
          // value) would pass silently — fail fast like the list branch.
          throw new Error(
            'verify: step has nothing to assert — add a target, a quoted ' +
              'value, or a list reference',
          );
        }
        if (parsed.target && !needsList) {
          const locator = await this.healer.find(parsed.target);
          await expect(locator).toBeVisible();
        }
        if (parsed.value && !needsList) {
          await expect(this.page.getByText(parsed.value)).toBeVisible({
            timeout: 10_000,
          });
        }
        break;
      }
        
      case 'wait':
        const duration = parseInt(parsed.value || '1000', 10);
        await this.page.waitForTimeout(duration);
        break;
        
      default:
        throw new Error(`Unknown step type: ${parsed.type}`);
    }
  }

  /**
   * Open a BookmarkForge view through real UI. Accepts either a tab id
   * ('bookmarks', 'dashboard') or a natural phrase like 'open the settings'.
   *
   * Notes on the real app:
   *  - Settings is a MODAL opened by the Header settings button
   *    ([data-testid="settings-button"]), not a sidebar tab.
   *  - Bookmarks/dashboard are sidebar tabs ([data-tab-id=...]).
   */
  private async openAppTab(phrase: string): Promise<void> {
    const view = resolveAppTab(phrase);
    if (view === 'settings') {
      const settingsBtn = this.page.getByTestId('settings-button');
      await settingsBtn.first().click({ timeout: 5_000 });
      return;
    }
    // Settings is a MODAL with a full-screen overlay (z-500) that intercepts
    // pointer events, so navigating to a sidebar tab must dismiss it first
    // (Escape is its WCAG-required close handler). Otherwise the nav-item
    // click times out under the overlay.
    const overlay = this.page.locator('.ds-modal-overlay');
    if (await overlay.first().isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await expect(overlay.first()).toBeHidden({ timeout: 5_000 });
    }
    const navItem = this.page.locator(`[data-tab-id="${view}"]`).first();
    await navItem.click({ timeout: 5_000 });
  }

  /**
   * Does this verify step target the bookmark list (requiring the Bookmarks
   * tab to be opened first)?
   */
  private mentionsBookmarkList(parsed: ParsedStep): boolean {
    const haystack = `${parsed.target ?? ''} ${parsed.original}`;
    // Tight matching (see dsl-views): bare 'appears'/'is visible' no longer
    // count, so generic verifies ('the toast is visible') stay on the
    // current view. A quoted title asserted with 'appears' still lands on
    // the Bookmarks tab because the app never auto-navigates after a save.
    return shouldOpenBookmarksTab(haystack, Boolean(parsed.value));
  }

  /**
   * Extract quoted string from step
   */
  private extractQuotedString(step: string): string | undefined {
    const match = step.match(/["']([^"']+)["']/);
    return match ? match[1] : undefined;
  }

  /**
   * Extract URL from step
   */
  private extractUrl(step: string): string | undefined {
    const match = step.match(/https?:\/\/[^\s]+/);
    return match ? match[0] : undefined;
  }

  /**
   * Extract target element from step
   */
  private extractTarget(step: string): string | undefined {
    // Strip quoted values first so URLs/titles embedded in the sentence do
    // not leak into the element description ("Enter \"https://x\" in the
    // URL field" must target the URL field, not the quoted URL).
    const stepWithoutQuotes = step.replace(/["'][^"']*["']/g, '');
    
    // Try to extract after "the" or before common verbs
    const patterns = [
      /the\s+(.+?)(?:\s+button|\s+link|\s+field|\s+input|\s+box)?(?:\s+and|\s+then|\s+to|\s*$)/i,
      /(?:click|tap|press|hover|fill|type|enter)\s+(?:the\s+)?(.+?)(?:\s+button|\s+link|\s+field|\s+input|\s+box)?(?:\s+and|\s+then|\s+to|\s*$)/i,
    ];
    
    for (const pattern of patterns) {
      const match = stepWithoutQuotes.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return undefined;
  }

  /**
   * Extract number from step
   */
  private extractNumber(step: string): number | undefined {
    const match = step.match(/\d+/);
    return match ? parseInt(match[0], 10) : undefined;
  }

  /**
   * Get execution results
   */
  getResults(): StepResult[] {
    return this.results;
  }

  /**
   * Check if all steps passed
   */
  allPassed(): boolean {
    return this.results.every(r => r.success);
  }

  /**
   * Get summary
   */
  getSummary(): {
    total: number;
    passed: number;
    failed: number;
    duration: number;
  } {
    const total = this.results.length;
    const passed = this.results.filter(r => r.success).length;
    const failed = total - passed;
    const duration = this.results.reduce((sum, r) => sum + r.duration, 0);
    
    return { total, passed, failed, duration };
  }
}

/**
 * Create a natural language scenario
 */
export function createScenario(
  page: Page,
  config?: ScenarioConfig
): NaturalLanguageScenario {
  return new NaturalLanguageScenario(page, config);
}

/**
 * Quick helper to execute natural language steps
 */
export async function executeSteps(
  page: Page,
  steps: string[],
  config?: ScenarioConfig
): Promise<StepResult[]> {
  const scenario = new NaturalLanguageScenario(page, config);
  return scenario.execute(steps);
}
