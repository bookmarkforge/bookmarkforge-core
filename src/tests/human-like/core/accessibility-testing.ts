/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Accessibility Testing Utilities
 * 
 * Tests for WCAG 2.1 compliance:
 * - Color contrast
 * - Keyboard navigation
 * - Screen reader compatibility
 * - ARIA attributes
 * - Focus management
 * - Form labels
 * - Alternative text
 */

import type { Page } from '@playwright/test';

export interface AccessibilityConfig {
  /** WCAG level to test against */
  wcagLevel?: 'A' | 'AA' | 'AAA';
  /** Enable automated checks */
  automatedChecks?: boolean;
  /** Enable manual checks */
  manualChecks?: boolean;
  /** Include best practices */
  bestPractices?: boolean;
}

export interface AccessibilityViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    html: string;
    target: string[];
    failureSummary: string;
  }>;
}

export interface AccessibilityResult {
  url: string;
  timestamp: number;
  violations: AccessibilityViolation[];
  passes: number;
  incomplete: number;
  inapplicable: number;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface ContrastResult {
  foreground: string;
  background: string;
  ratio: number;
  meets: boolean;
  level: 'A' | 'AA' | 'AAA';
}

/**
 * Accessibility Testing class
 */
export class AccessibilityTesting {
  private page: Page;
  private config: Required<AccessibilityConfig>;

  constructor(page: Page, config: AccessibilityConfig = {}) {
    this.page = page;
    this.config = {
      wcagLevel: config.wcagLevel ?? 'AA',
      automatedChecks: config.automatedChecks ?? true,
      manualChecks: config.manualChecks ?? true,
      bestPractices: config.bestPractices ?? true,
    };
  }

  /**
   * Run automated accessibility checks
   */
  async runAutomatedChecks(): Promise<AccessibilityResult> {
    // axe-core is bundled with the test toolchain; inject it without a
    // third-party CDN dependency.
    const axe = (await import('axe-core')).default;
    await this.page.addScriptTag({ content: axe.source });

    // Run axe analysis
    const axeResults = await this.page.evaluate(async () => {
      const axe = (window as any).axe;
      if (!axe) {
        throw new Error('axe-core not loaded');
      }

      const results = await axe.run();
      return {
        violations: results.violations.map((v: any) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n: any) => ({
            html: n.html,
            target: n.target,
            failureSummary: n.failureSummary,
          })),
        })),
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length,
      };
    });

    // Calculate score
    const totalChecks = axeResults.violations.length + axeResults.passes;
    const score = totalChecks > 0 
      ? Math.round((axeResults.passes / totalChecks) * 100)
      : 100;

    // Determine grade
    let grade: AccessibilityResult['grade'];
    if (score >= 90) grade = 'A';
    else if (score >= 80) grade = 'B';
    else if (score >= 70) grade = 'C';
    else if (score >= 60) grade = 'D';
    else grade = 'F';

    return {
      url: this.page.url(),
      timestamp: Date.now(),
      violations: axeResults.violations,
      passes: axeResults.passes,
      incomplete: axeResults.incomplete,
      inapplicable: axeResults.inapplicable,
      score,
      grade,
    };
  }

  /**
   * Test keyboard navigation
   */
  async testKeyboardNavigation(): Promise<{
    tabOrder: string[];
    focusVisible: boolean;
    skipLinks: boolean;
    focusTrapped: boolean;
  }> {
    const tabOrder: string[] = [];
    let focusVisible = true;
    let skipLinks = false;
    let focusTrapped = false;

    // Check for skip links
    const skipLink = await this.page.locator('a[href="#main"], a[href="#content"], .skip-link').first();
    if (await skipLink.count() > 0) {
      skipLinks = true;
    }

    // Test tab order
    for (let i = 0; i < 20; i++) {
      await this.page.keyboard.press('Tab');
      
      const focusedElement = await this.page.evaluate(() => {
        const el = document.activeElement;
        return {
          tagName: el?.tagName,
          id: el?.id,
          className: el?.className,
          ariaLabel: el?.getAttribute('aria-label'),
          role: el?.getAttribute('role'),
        };
      });

      if (focusedElement.tagName) {
        const identifier = focusedElement.id || 
          focusedElement.ariaLabel || 
          focusedElement.className || 
          focusedElement.tagName;
        tabOrder.push(identifier);
      }

      // Check if focus is visible
      const isFocusVisible = await this.page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return false;
        
        const style = window.getComputedStyle(el);
        const outline = style.outline;
        const boxShadow = style.boxShadow;
        
        return outline !== 'none' || boxShadow !== 'none';
      });

      if (!isFocusVisible) {
        focusVisible = false;
      }
    }

    // Check if focus is trapped in modal (if present)
    const modal = await this.page.locator('[role="dialog"], .modal').first();
    if (await modal.count() > 0) {
      // Try to tab out of modal
      await this.page.keyboard.press('Tab');
      const stillInModal = await this.page.evaluate(() => {
        const el = document.activeElement;
        const modal = document.querySelector('[role="dialog"], .modal');
        return modal?.contains(el) ?? false;
      });
      focusTrapped = stillInModal;
    }

    return {
      tabOrder,
      focusVisible,
      skipLinks,
      focusTrapped,
    };
  }

  /**
   * Test color contrast
   */
  async testColorContrast(
    foreground: string,
    background: string
  ): Promise<ContrastResult> {
    // Calculate contrast ratio
    const ratio = await this.page.evaluate(
      ({ fg, bg }) => {
        const getLuminance = (color: string) => {
          const rgb = color.match(/\d+/g)?.map(Number) || [0, 0, 0];
          const [r, g, b] = rgb.map(c => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };

        const l1 = getLuminance(fg);
        const l2 = getLuminance(bg);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        
        return (lighter + 0.05) / (darker + 0.05);
      },
      { fg: foreground, bg: background }
    );

    // Determine if ratio meets WCAG requirements
    let level: ContrastResult['level'] = 'A';
    let meets = false;

    if (ratio >= 7) {
      level = 'AAA';
      meets = true;
    } else if (ratio >= 4.5) {
      level = 'AA';
      meets = this.config.wcagLevel === 'A' || this.config.wcagLevel === 'AA';
    } else if (ratio >= 3) {
      level = 'A';
      meets = this.config.wcagLevel === 'A';
    }

    return {
      foreground,
      background,
      ratio,
      meets,
      level,
    };
  }

  /**
   * Test ARIA attributes
   */
  async testAriaAttributes(): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check for missing ARIA labels on interactive elements
    const interactiveElements = await this.page.locator(
      'button, input, select, textarea, a[href]'
    ).all();

    for (const element of interactiveElements) {
      const hasLabel = await element.evaluate((el) => {
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const label = el.closest('label');
        const placeholder = el.getAttribute('placeholder');
        const title = el.getAttribute('title');
        
        return !!(ariaLabel || ariaLabelledBy || label || placeholder || title);
      });

      if (!hasLabel) {
        const elementInfo = await element.evaluate((el) => ({
          tag: el.tagName,
          type: el.getAttribute('type'),
          text: el.textContent?.substring(0, 50),
        }));
        
        issues.push(
          `Missing label on ${elementInfo.tag}${elementInfo.type ? `[type="${elementInfo.type}"]` : ''}: "${elementInfo.text}"`
        );
      }
    }

    // Check for valid ARIA roles
    const elementsWithRoles = await this.page.locator('[role]').all();
    
    for (const element of elementsWithRoles) {
      const role = await element.getAttribute('role');
      const validRoles = [
        'alert', 'button', 'checkbox', 'dialog', 'gridcell', 'link', 'log',
        'marquee', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
        'option', 'progressbar', 'radio', 'scrollbar', 'search', 'slider',
        'spinbutton', 'status', 'tab', 'tabpanel', 'textbox', 'timer', 'tooltip',
        'treeitem', 'combobox', 'menu', 'menubar', 'tablist', 'tree', 'treegrid',
        'article', 'cell', 'columnheader', 'definition', 'directory', 'document',
        'feed', 'figure', 'group', 'heading', 'img', 'list', 'listitem',
        'math', 'none', 'note', 'presentation', 'region', 'row', 'rowgroup',
        'rowheader', 'separator', 'table', 'term', 'toolbar',
      ];

      if (role && !validRoles.includes(role)) {
        issues.push(`Invalid ARIA role: "${role}"`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Test form accessibility
   */
  async testFormAccessibility(): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    // Check all form inputs
    const inputs = await this.page.locator('input, select, textarea').all();

    for (const input of inputs) {
      const inputInfo = await input.evaluate((el) => {
        const id = el.id;
        const type = el.getAttribute('type');
        const ariaLabel = el.getAttribute('aria-label');
        const ariaLabelledBy = el.getAttribute('aria-labelledby');
        const label = document.querySelector(`label[for="${id}"]`);
        const parentLabel = el.closest('label');
        const placeholder = el.getAttribute('placeholder');
        
        return {
          id,
          type,
          hasLabel: !!(ariaLabel || ariaLabelledBy || label || parentLabel),
          hasPlaceholder: !!placeholder,
          isRequired: el.hasAttribute('required'),
          ariaDescribedBy: el.getAttribute('aria-describedby'),
        };
      });

      // Check for missing labels (except hidden inputs)
      if (!inputInfo.hasLabel && inputInfo.type !== 'hidden') {
        issues.push(
          `Input${inputInfo.id ? `#${inputInfo.id}` : ''} missing accessible label`
        );
      }

      // Check required inputs have proper indication
      if (inputInfo.isRequired && !inputInfo.ariaDescribedBy) {
        issues.push(
          `Required input${inputInfo.id ? `#${inputInfo.id}` : ''} should have aria-describedby for error messages`
        );
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Test image accessibility
   */
  async testImageAccessibility(): Promise<{
    valid: boolean;
    issues: string[];
  }> {
    const issues: string[] = [];

    const images = await this.page.locator('img').all();

    for (const image of images) {
      const imageInfo = await image.evaluate((el) => ({
        src: el.getAttribute('src'),
        alt: el.getAttribute('alt'),
        role: el.getAttribute('role'),
        ariaHidden: el.getAttribute('aria-hidden'),
        width: el.getAttribute('width'),
        height: el.getAttribute('height'),
      }));

      // Check for missing alt text (unless decorative)
      if (!imageInfo.alt && imageInfo.role !== 'presentation' && imageInfo.ariaHidden !== 'true') {
        issues.push(`Image missing alt text: ${imageInfo.src}`);
      }

      // Check for empty alt on non-decorative images
      if (imageInfo.alt === '' && imageInfo.role !== 'presentation') {
        issues.push(`Image has empty alt but is not marked as decorative: ${imageInfo.src}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Generate comprehensive accessibility report
   */
  async generateReport(): Promise<{
    automated: AccessibilityResult;
    keyboard: Awaited<ReturnType<AccessibilityTesting['testKeyboardNavigation']>>;
    aria: Awaited<ReturnType<AccessibilityTesting['testAriaAttributes']>>;
    forms: Awaited<ReturnType<AccessibilityTesting['testFormAccessibility']>>;
    images: Awaited<ReturnType<AccessibilityTesting['testImageAccessibility']>>;
    summary: {
      totalIssues: number;
      criticalIssues: number;
      overallScore: number;
    };
  }> {
    const automated = await this.runAutomatedChecks();
    const keyboard = await this.testKeyboardNavigation();
    const aria = await this.testAriaAttributes();
    const forms = await this.testFormAccessibility();
    const images = await this.testImageAccessibility();

    const criticalIssues = automated.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    ).length;

    const totalIssues = 
      automated.violations.length + 
      aria.issues.length + 
      forms.issues.length + 
      images.issues.length;

    const overallScore = Math.max(0, 100 - (totalIssues * 5) - (criticalIssues * 10));

    return {
      automated,
      keyboard,
      aria,
      forms,
      images,
      summary: {
        totalIssues,
        criticalIssues,
        overallScore,
      },
    };
  }
}

/**
 * Create accessibility testing instance
 */
export function createAccessibilityTesting(
  page: Page,
  config?: AccessibilityConfig
): AccessibilityTesting {
  return new AccessibilityTesting(page, config);
}

/**
 * Quick accessibility check helper
 */
export async function checkAccessibility(
  page: Page,
  level: 'A' | 'AA' | 'AAA' = 'AA'
): Promise<AccessibilityResult> {
  const testing = new AccessibilityTesting(page, { wcagLevel: level });
  return testing.runAutomatedChecks();
}
