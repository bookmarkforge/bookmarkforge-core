/**
 * Human-Like Testing Framework
 * 
 * A comprehensive testing framework that simulates human behavior
 * for more realistic and maintainable automated tests.
 * 
 * Features:
 * - Natural language test execution
 * - Human behavior simulation
 * - Self-healing locators
 * - Session recording and replay
 * - Intelligent visual testing
 * - Behavioral analytics
 */

// Core utilities
import { HumanBehavior, createHumanBehavior, humanDelay } from './utils/human-behavior';
export { HumanBehavior, createHumanBehavior, humanDelay };
export type { HumanBehaviorOptions, MousePath } from './utils/human-behavior';

// Self-healing locators
import { SelfHealingLocator, createSelfHealingLocator, findElement } from './core/self-healing-locators';
export { SelfHealingLocator, createSelfHealingLocator, findElement };
export type { LocatorStrategy, ElementCandidate, HealingConfig } from './core/self-healing-locators';

// Natural language DSL
import { NaturalLanguageScenario, createScenario, executeSteps } from './core/natural-language-dsl';
export { NaturalLanguageScenario, createScenario, executeSteps };
export type { StepResult, ScenarioConfig, StepType, ParsedStep } from './core/natural-language-dsl';

// Session recording
import {
  SessionRecorder,
  SessionReplayer,
  createSessionRecorder,
  createSessionReplayer,
} from './sessions/session-recorder';
export { SessionRecorder, SessionReplayer, createSessionRecorder, createSessionReplayer };
export type { RecordedAction, Session, RecorderConfig } from './sessions/session-recorder';

// Visual AI testing
import { VisualAITesting, createVisualAITesting, expectVisualMatch } from './core/visual-ai-testing';
export { VisualAITesting, createVisualAITesting, expectVisualMatch };
export type { VisualTestConfig, VisualDiff, VisualAnalysis } from './core/visual-ai-testing';

// Performance testing
import { PerformanceTesting, createPerformanceTesting, measurePerformance } from './core/performance-testing';
export { PerformanceTesting, createPerformanceTesting, measurePerformance };
export type { PerformanceMetrics, PerformanceConfig, PerformanceReport } from './core/performance-testing';

// Accessibility testing
import { AccessibilityTesting, createAccessibilityTesting, checkAccessibility } from './core/accessibility-testing';
export { AccessibilityTesting, createAccessibilityTesting, checkAccessibility };
export type { AccessibilityConfig, AccessibilityViolation, AccessibilityResult, ContrastResult } from './core/accessibility-testing';

// Integration testing
import { IntegrationTesting, createIntegrationTesting, testAPI } from './core/integration-testing';
export { IntegrationTesting, createIntegrationTesting, testAPI };
export type { APIEndpoint, APIResponse, IntegrationConfig, TestData } from './core/integration-testing';

// Behavioral analytics
import { BehavioralAnalytics, createBehavioralAnalytics } from './analytics/behavioral-analytics';
export { BehavioralAnalytics, createBehavioralAnalytics };
export type { UserEvent, UserSession, BehaviorPattern, AnalyticsConfig } from './analytics/behavioral-analytics';

/**
 * Quick setup function for human-like testing
 */
export function setupHumanLikeTesting(page: any) {
  return {
    human: createHumanBehavior(page),
    healer: createSelfHealingLocator(page),
    scenario: createScenario(page),
    recorder: createSessionRecorder(page),
    visual: createVisualAITesting(page),
    performance: createPerformanceTesting(page),
    accessibility: createAccessibilityTesting(page),
    integration: createIntegrationTesting(page),
    analytics: createBehavioralAnalytics(page),
  };
}

/**
 * Version of the framework
 */
export const VERSION = '1.0.0';
