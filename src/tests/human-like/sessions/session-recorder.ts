/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Session Recording and Replay System
 * 
 * Records user interactions and replays them as automated tests.
 * Captures:
 * - Click events
 * - Keyboard input
 * - Scroll positions
 * - Navigation
 * - Screenshots at key moments
 * - Network requests
 */

import type { Page, Locator } from '@playwright/test';

export interface RecordedAction {
  type: 'click' | 'type' | 'scroll' | 'navigate' | 'hover' | 'press' | 'screenshot';
  timestamp: number;
  target?: string;
  value?: string;
  coordinates?: { x: number; y: number };
  url?: string;
  key?: string;
  modifiers?: string[];
  screenshot?: string;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  actions: RecordedAction[];
  url: string;
  userAgent: string;
  viewport: { width: number; height: number };
  tags?: string[];
}

export interface RecorderConfig {
  /** Auto-take screenshots after important actions */
  autoScreenshot?: boolean;
  /** Record network requests */
  recordNetwork?: boolean;
  /** Record console logs */
  recordConsole?: boolean;
  /** Debounce delay for rapid actions (ms) */
  debounceDelay?: number;
  /** Maximum session duration (ms) */
  maxDuration?: number;
}

/**
 * Session Recorder class
 */
export class SessionRecorder {
  private page: Page;
  private config: Required<RecorderConfig>;
  private session: Session | null = null;
  private isRecording = false;
  private actionBuffer: RecordedAction[] = [];
  private screenshotCounter = 0;

  constructor(page: Page, config: RecorderConfig = {}) {
    this.page = page;
    this.config = {
      autoScreenshot: config.autoScreenshot ?? true,
      recordNetwork: config.recordNetwork ?? false,
      recordConsole: config.recordConsole ?? false,
      debounceDelay: config.debounceDelay ?? 100,
      maxDuration: config.maxDuration ?? 300000, // 5 minutes
    };
  }

  /**
   * Start recording a session
   */
  async start(name: string, tags?: string[]): Promise<void> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    this.session = {
      id: this.generateSessionId(),
      name,
      startTime: Date.now(),
      actions: [],
      url: this.page.url(),
      userAgent: await this.page.evaluate(() => navigator.userAgent),
      viewport: this.page.viewportSize() || { width: 1280, height: 720 },
      tags,
    };

    this.isRecording = true;
    this.actionBuffer = [];
    this.screenshotCounter = 0;

    // Set up event listeners
    await this.setupEventListeners();

    // Take initial screenshot
    if (this.config.autoScreenshot) {
      await this.takeScreenshot('session-start');
    }

    console.log(`Recording started: ${name}`);
  }

  /**
   * Stop recording
   */
  async stop(): Promise<Session> {
    if (!this.isRecording || !this.session) {
      throw new Error('Not recording');
    }

    // Flush any buffered actions
    await this.flushBuffer();

    // Take final screenshot
    if (this.config.autoScreenshot) {
      await this.takeScreenshot('session-end');
    }

    // Remove event listeners
    await this.removeEventListeners();

    this.session.endTime = Date.now();
    this.session.actions = [...this.session.actions, ...this.actionBuffer];
    this.isRecording = false;

    console.log(`Recording stopped: ${this.session.name}`);
    console.log(`Total actions: ${this.session.actions.length}`);

    return this.session;
  }

  /**
   * Set up event listeners
   */
  private async setupEventListeners(): Promise<void> {
    // Click events
    await this.page.exposeFunction('__recordClick', (data: any) => {
      this.bufferAction({
        type: 'click',
        timestamp: Date.now(),
        coordinates: { x: data.x, y: data.y },
        target: data.selector,
      });
    });

    // Keyboard events
    await this.page.exposeFunction('__recordKey', (data: any) => {
      this.bufferAction({
        type: data.type === 'input' ? 'type' : 'press',
        timestamp: Date.now(),
        value: data.value,
        key: data.key,
        modifiers: data.modifiers,
        target: data.selector,
      });
    });

    // Scroll events
    await this.page.exposeFunction('__recordScroll', (data: any) => {
      this.bufferAction({
        type: 'scroll',
        timestamp: Date.now(),
        coordinates: { x: data.scrollX, y: data.scrollY },
      });
    });

    // Navigation events
    await this.page.exposeFunction('__recordNavigation', (data: any) => {
      this.bufferAction({
        type: 'navigate',
        timestamp: Date.now(),
        url: data.url,
      });
    });

    // Inject recording script
    await this.page.addInitScript(() => {
      let lastClickTime = 0;
      let lastScrollTime = 0;

      // Helper function to generate selector
      function getSelector(element: HTMLElement): string {
        if (element.id) {
          return `#${element.id}`;
        }
        
        if (element.getAttribute('data-testid')) {
          return `[data-testid="${element.getAttribute('data-testid')}"]`;
        }
        
        if (element.getAttribute('aria-label')) {
          return `[aria-label="${element.getAttribute('aria-label')}"]`;
        }
        
        if (element.className && typeof element.className === 'string') {
          const classes = element.className.split(' ').filter(c => c).slice(0, 2);
          if (classes.length > 0) {
            return `.${classes.join('.')}`;
          }
        }
        
        return element.tagName.toLowerCase();
      }

      // Click handler
      document.addEventListener('click', (e) => {
        const now = Date.now();
        if (now - lastClickTime < 100) return; // Debounce
        lastClickTime = now;

        const target = e.target as HTMLElement;
        const selector = getSelector(target);
        
        (window as any).__recordClick({
          x: e.clientX,
          y: e.clientY,
          selector,
        });
      }, true);

      // Keyboard handler
      document.addEventListener('keydown', (e) => {
        const target = e.target as HTMLElement;
        const selector = getSelector(target);
        
        (window as any).__recordKey({
          type: 'keydown',
          key: e.key,
          modifiers: [
            e.ctrlKey ? 'Control' : null,
            e.shiftKey ? 'Shift' : null,
            e.altKey ? 'Alt' : null,
            e.metaKey ? 'Meta' : null,
          ].filter(Boolean),
          selector,
        });
      }, true);

      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const selector = getSelector(target);
        
        (window as any).__recordKey({
          type: 'input',
          value: target.value,
          selector,
        });
      }, true);

      // Scroll handler
      window.addEventListener('scroll', () => {
        const now = Date.now();
        if (now - lastScrollTime < 200) return; // Debounce
        lastScrollTime = now;

        (window as any).__recordScroll({
          scrollX: window.scrollX,
          scrollY: window.scrollY,
        });
      }, true);

      // Navigation handler
      window.addEventListener('popstate', () => {
        (window as any).__recordNavigation({
          url: window.location.href,
        });
      });
    });
  }

  /**
   * Remove event listeners
   */
  private async removeEventListeners(): Promise<void> {
    // Nullify exposed functions so buffered calls are no-ops after stop.
    // Exposed functions survive until page navigation, but nullifying them
    // prevents stale actions from being recorded after the session ends.
    await this.page.evaluate(() => {
      (window as any).__recordClick = undefined;
      (window as any).__recordKey = undefined;
      (window as any).__recordScroll = undefined;
      (window as any).__recordNavigation = undefined;
    });
  }

  /**
   * Buffer an action
   */
  private bufferAction(action: RecordedAction): void {
    if (!this.isRecording) return;
    
    this.actionBuffer.push(action);
    
    // Flush buffer if it gets too large
    if (this.actionBuffer.length >= 50) {
      this.flushBuffer();
    }
  }

  /**
   * Flush action buffer to session
   */
  private async flushBuffer(): Promise<void> {
    if (!this.session || this.actionBuffer.length === 0) return;
    
    this.session.actions.push(...this.actionBuffer);
    this.actionBuffer = [];
  }

  /**
   * Take a screenshot
   */
  private async takeScreenshot(name: string): Promise<void> {
    if (!this.session) return;
    
    this.screenshotCounter++;
    const screenshotName = `${name}-${this.screenshotCounter.toString().padStart(3, '0')}`;
    
    // Store screenshot as base64 (in real implementation, save to file)
    // For now, just record the action
    this.bufferAction({
      type: 'screenshot',
      timestamp: Date.now(),
      metadata: { name: screenshotName },
    });
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get current session
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Check if recording
   */
  isSessionRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Export session as JSON
   */
  exportSession(): string {
    if (!this.session) {
      throw new Error('No session to export');
    }
    return JSON.stringify(this.session, null, 2);
  }

  /**
   * Import session from JSON
   */
  importSession(json: string): Session {
    this.session = JSON.parse(json) as Session;
    return this.session;
  }
}

/**
 * Session Replayer class
 */
export class SessionReplayer {
  private page: Page;
  private session: Session | null = null;
  private speed: number = 1;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Load a session for replay
   */
  loadSession(session: Session): void {
    this.session = session;
  }

  /**
   * Set replay speed (1 = normal, 2 = double speed, etc.)
   */
  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(10, speed));
  }

  /**
   * Replay the session
   */
  async replay(options?: { 
    startFrom?: number;
    endAt?: number;
    skipNavigation?: boolean;
  }): Promise<void> {
    if (!this.session) {
      throw new Error('No session loaded');
    }

    const startIdx = options?.startFrom ?? 0;
    const endIdx = options?.endAt ?? this.session.actions.length;

    console.log(`Replaying session: ${this.session.name}`);
    console.log(`Speed: ${this.speed}x`);

    for (let i = startIdx; i < endIdx; i++) {
      const action = this.session.actions[i];
      
      // Calculate delay based on timestamp difference
      if (i > startIdx) {
        const prevAction = this.session.actions[i - 1];
        const delay = (action.timestamp - prevAction.timestamp) / this.speed;
        await this.page.waitForTimeout(Math.min(delay, 5000)); // Cap at 5 seconds
      }

      try {
        await this.executeAction(action, options?.skipNavigation);
      } catch (error) {
        console.error(`Failed to execute action ${i}:`, error);
        // Continue with next action
      }
    }

    console.log('Replay completed');
  }

  /**
   * Execute a single recorded action
   */
  private async executeAction(
    action: RecordedAction,
    skipNavigation?: boolean
  ): Promise<void> {
    switch (action.type) {
      case 'click':
        if (action.target) {
          try {
            await this.page.locator(action.target).first().click({
              timeout: 5000,
            });
          } catch {
            // Fallback to coordinates
            if (action.coordinates) {
              await this.page.mouse.click(
                action.coordinates.x,
                action.coordinates.y
              );
            }
          }
        } else if (action.coordinates) {
          await this.page.mouse.click(
            action.coordinates.x,
            action.coordinates.y
          );
        }
        break;

      case 'type':
        if (action.target && action.value) {
          await this.page.locator(action.target).first().fill(action.value);
        }
        break;

      case 'press':
        if (action.key) {
          await this.page.keyboard.press(action.key);
        }
        break;

      case 'scroll':
        if (action.coordinates) {
          await this.page.evaluate(
            ({ x, y }) => window.scrollTo(x, y),
            action.coordinates
          );
        }
        break;

      case 'navigate':
        if (!skipNavigation && action.url) {
          await this.page.goto(action.url);
        }
        break;

      case 'hover':
        if (action.target) {
          await this.page.locator(action.target).first().hover();
        }
        break;

      case 'screenshot':
        // Skip screenshots during replay
        break;
    }
  }
}

/**
 * Create a session recorder
 */
export function createSessionRecorder(
  page: Page,
  config?: RecorderConfig
): SessionRecorder {
  return new SessionRecorder(page, config);
}

/**
 * Create a session replayer
 */
export function createSessionReplayer(page: Page): SessionReplayer {
  return new SessionReplayer(page);
}
