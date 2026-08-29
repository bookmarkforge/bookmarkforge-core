/**
 * Behavioral Analytics System
 * 
 * Tracks and analyzes user behavior patterns to:
 * - Identify common user flows
 * - Detect usability issues
 * - Generate test scenarios from real usage
 * - Predict user intent
 */

import type { Page } from '@playwright/test';

export interface UserEvent {
  type: 'click' | 'scroll' | 'input' | 'navigation' | 'hover' | 'focus' | 'blur';
  timestamp: number;
  target: string;
  value?: string;
  coordinates?: { x: number; y: number };
  duration?: number;
  metadata?: Record<string, any>;
}

export interface UserSession {
  id: string;
  startTime: number;
  endTime?: number;
  events: UserEvent[];
  url: string;
  userAgent: string;
}

export interface BehaviorPattern {
  id: string;
  name: string;
  description: string;
  frequency: number;
  averageDuration: number;
  steps: string[];
  successRate: number;
}

export interface AnalyticsConfig {
  /** Enable event tracking */
  enableTracking?: boolean;
  /** Maximum events to store */
  maxEvents?: number;
  /** Session timeout (ms) */
  sessionTimeout?: number;
  /** Enable pattern detection */
  enablePatternDetection?: boolean;
}

/**
 * Behavioral Analytics class
 */
export class BehavioralAnalytics {
  private page: Page;
  private config: Required<AnalyticsConfig>;
  private session: UserSession | null = null;
  private events: UserEvent[] = [];
  private patterns: Map<string, BehaviorPattern> = new Map();

  constructor(page: Page, config: AnalyticsConfig = {}) {
    this.page = page;
    this.config = {
      enableTracking: config.enableTracking ?? true,
      maxEvents: config.maxEvents ?? 10000,
      sessionTimeout: config.sessionTimeout ?? 1800000, // 30 minutes
      enablePatternDetection: config.enablePatternDetection ?? true,
    };
  }

  /**
   * Start tracking a session
   */
  async startSession(): Promise<void> {
    if (!this.config.enableTracking) return;

    this.session = {
      id: this.generateSessionId(),
      startTime: Date.now(),
      events: [],
      url: this.page.url(),
      userAgent: await this.page.evaluate(() => navigator.userAgent),
    };

    await this.setupEventTracking();
    console.log(`Analytics session started: ${this.session.id}`);
  }

  /**
   * Stop tracking
   */
  async stopSession(): Promise<UserSession> {
    if (!this.session) {
      throw new Error('No active session');
    }

    this.session.endTime = Date.now();
    this.session.events = [...this.events];

    // Analyze session
    if (this.config.enablePatternDetection) {
      await this.analyzeSession(this.session);
    }

    const session = { ...this.session };
    this.session = null;
    this.events = [];

    console.log(`Analytics session stopped: ${session.id}`);
    console.log(`Events tracked: ${session.events.length}`);

    return session;
  }

  /**
   * Set up event tracking
   */
  private async setupEventTracking(): Promise<void> {
    await this.page.exposeFunction('__trackEvent', (data: UserEvent) => {
      this.trackEvent(data);
    });

    await this.page.addInitScript(() => {
      const trackEvent = (data: any) => {
        (window as any).__trackEvent({
          ...data,
          timestamp: Date.now(),
        });
      };

      // Helper function to generate selector
      function getSelector(element: HTMLElement): string {
        if (element.id) return `#${element.id}`;
        if (element.getAttribute('data-testid')) {
          return `[data-testid="${element.getAttribute('data-testid')}"]`;
        }
        if (element.getAttribute('aria-label')) {
          return `[aria-label="${element.getAttribute('aria-label')}"]`;
        }
        return element.tagName.toLowerCase();
      }

      // Click tracking
      document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        trackEvent({
          type: 'click',
          target: getSelector(target),
          coordinates: { x: e.clientX, y: e.clientY },
        });
      });

      // Input tracking
      document.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        trackEvent({
          type: 'input',
          target: getSelector(target),
          value: target.value,
        });
      });

      // Scroll tracking (debounced)
      let scrollTimeout: NodeJS.Timeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          trackEvent({
            type: 'scroll',
            coordinates: { x: window.scrollX, y: window.scrollY },
          });
        }, 100);
      });

      // Focus/blur tracking
      document.addEventListener('focusin', (e) => {
        trackEvent({
          type: 'focus',
          target: getSelector(e.target as HTMLElement),
        });
      });

      document.addEventListener('focusout', (e) => {
        trackEvent({
          type: 'blur',
          target: getSelector(e.target as HTMLElement),
        });
      });

      // Navigation tracking
      window.addEventListener('popstate', () => {
        trackEvent({
          type: 'navigation',
          target: window.location.href,
        });
      });
    });
  }

  /**
   * Track an event
   */
  trackEvent(event: UserEvent): void {
    if (!this.config.enableTracking) return;

    this.events.push(event);

    // Limit events
    if (this.events.length > this.config.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Analyze a session for patterns
   */
  private async analyzeSession(session: UserSession): Promise<void> {
    // Group events by type
    const eventGroups = this.groupEvents(session.events);
    
    // Detect common sequences
    const sequences = this.detectSequences(session.events);
    
    // Update patterns
    for (const sequence of sequences) {
      const patternId = this.generatePatternId(sequence);
      
      if (this.patterns.has(patternId)) {
        const pattern = this.patterns.get(patternId)!;
        pattern.frequency++;
        pattern.averageDuration = (pattern.averageDuration + (session.endTime! - session.startTime)) / 2;
      } else {
        this.patterns.set(patternId, {
          id: patternId,
          name: this.generatePatternName(sequence),
          description: this.generatePatternDescription(sequence),
          frequency: 1,
          averageDuration: (session.endTime! - session.startTime),
          steps: sequence.map(e => `${e.type}: ${e.target}`),
          successRate: 1,
        });
      }
    }
  }

  /**
   * Group events by type
   */
  private groupEvents(events: UserEvent[]): Map<string, UserEvent[]> {
    const groups = new Map<string, UserEvent[]>();
    
    for (const event of events) {
      const group = groups.get(event.type) || [];
      group.push(event);
      groups.set(event.type, group);
    }
    
    return groups;
  }

  /**
   * Detect common event sequences
   */
  private detectSequences(events: UserEvent[]): UserEvent[][] {
    const sequences: UserEvent[][] = [];
    const minLength = 3;
    const maxLength = 10;
    
    // Sliding window to find sequences
    for (let len = minLength; len <= maxLength; len++) {
      for (let i = 0; i <= events.length - len; i++) {
        const sequence = events.slice(i, i + len);
        sequences.push(sequence);
      }
    }
    
    return sequences;
  }

  /**
   * Generate pattern ID from sequence
   */
  private generatePatternId(sequence: UserEvent[]): string {
    const key = sequence.map(e => `${e.type}:${e.target}`).join('->');
    return this.hashString(key);
  }

  /**
   * Generate pattern name
   */
  private generatePatternName(sequence: UserEvent[]): string {
    const types = sequence.map(e => e.type);
    const uniqueTypes = [...new Set(types)];
    return uniqueTypes.join(' + ');
  }

  /**
   * Generate pattern description
   */
  private generatePatternDescription(sequence: UserEvent[]): string {
    const steps = sequence.map(e => {
      switch (e.type) {
        case 'click':
          return `Click on ${e.target}`;
        case 'input':
          return `Type in ${e.target}`;
        case 'scroll':
          return 'Scroll page';
        case 'navigation':
          return `Navigate to ${e.target}`;
        default:
          return `${e.type} on ${e.target}`;
      }
    });
    
    return steps.join(' then ');
  }

  /**
   * Hash string for pattern ID
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return `analytics-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all detected patterns
   */
  getPatterns(): BehaviorPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get most common patterns
   */
  getTopPatterns(limit: number = 10): BehaviorPattern[] {
    return this.getPatterns().slice(0, limit);
  }

  /**
   * Get pattern by ID
   */
  getPattern(id: string): BehaviorPattern | undefined {
    return this.patterns.get(id);
  }

  /**
   * Export analytics data
   */
  exportData(): {
    sessions: UserSession[];
    patterns: BehaviorPattern[];
  } {
    return {
      sessions: [],
      patterns: this.getPatterns(),
    };
  }

  /**
   * Import analytics data
   */
  importData(data: { patterns?: BehaviorPattern[] }): void {
    if (data.patterns) {
      for (const pattern of data.patterns) {
        this.patterns.set(pattern.id, pattern);
      }
    }
  }

  /**
   * Generate test scenarios from patterns
   */
  generateTestScenarios(): string[][] {
    const scenarios: string[][] = [];
    
    for (const pattern of this.getTopPatterns(5)) {
      scenarios.push(pattern.steps);
    }
    
    return scenarios;
  }

  /**
   * Get user flow statistics
   */
  getFlowStatistics(): {
    totalSessions: number;
    averageDuration: number;
    commonEntryPoints: string[];
    commonExitPoints: string[];
    dropoffPoints: string[];
  } {
    // Simplified statistics
    return {
      totalSessions: 0,
      averageDuration: 0,
      commonEntryPoints: [],
      commonExitPoints: [],
      dropoffPoints: [],
    };
  }
}

/**
 * Create behavioral analytics instance
 */
export function createBehavioralAnalytics(
  page: Page,
  config?: AnalyticsConfig
): BehavioralAnalytics {
  return new BehavioralAnalytics(page, config);
}
