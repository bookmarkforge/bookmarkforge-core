/**
 * Resilience utilities for BookmarkForge
 * 
 * Provides retry, circuit breaker, and fallback patterns
 * for critical services like encryption, sync, and storage.
 */
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

interface CircuitBreakerOptions {
  failureThreshold?: number;
  recoveryTimeout?: number;
  onStateChange?: (state: 'closed' | 'open' | 'half-open') => void;
}

interface FallbackOptions<T> {
  fallback: () => Promise<T> | T;
  onError?: (error: Error) => void;
}

// ============================================================================
// Retry with Exponential Backoff
// ============================================================================

/**
 * Retry a function with exponential backoff and optional jitter
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 100,
    maxDelay = 60000,
    jitter = true,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      
      // Add jitter to prevent thundering herd
      if (jitter) {
        delay += Math.random() * delay * 0.1;
      }

      // Notify retry
      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ============================================================================
// Circuit Breaker
// ============================================================================

type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker pattern to prevent cascade failures
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      failureThreshold: options.failureThreshold ?? 5,
      recoveryTimeout: options.recoveryTimeout ?? 60000,
      onStateChange: options.onStateChange ?? (() => {}),
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceLastFailure >= this.options.recoveryTimeout) {
        this.setState('half-open');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();

      // Success - reset if half-open
      if (this.state === 'half-open') {
        this.setState('closed');
        this.failureCount = 0;
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold reached
      if (this.failureCount >= this.options.failureThreshold) {
        this.setState('open');
      }

      throw error;
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Reset circuit breaker
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  private setState(state: CircuitState): void {
    if (this.state !== state) {
      this.state = state;
      this.options.onStateChange(state);
    }
  }
}

// ============================================================================
// Graceful Degradation
// ============================================================================

/**
 * Execute with graceful degradation to fallback
 */
export async function withFallback<T>(
  fn: () => Promise<T>,
  options: FallbackOptions<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (options.onError) {
      options.onError(error as Error);
    }
    return options.fallback();
  }
}

// ============================================================================
// Timeout
// ============================================================================

/**
 * Execute with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

// ============================================================================
// Combined Resilience
// ============================================================================

/**
 * Combined resilience wrapper with retry, circuit breaker, and timeout
 */
export async function withResilience<T>(
  fn: () => Promise<T>,
  options: {
    retry?: RetryOptions;
    circuitBreaker?: CircuitBreaker;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { circuitBreaker, timeoutMs } = options;

  const wrappedFn = async (): Promise<T> => {
    let executionFn = fn;

    // Add timeout if specified
    if (timeoutMs) {
      executionFn = () => withTimeout(fn, timeoutMs);
    }

    // Add circuit breaker if specified
    if (circuitBreaker) {
      return circuitBreaker.execute(executionFn);
    }

    return executionFn();
  };

  // Add retry if specified
  if (options.retry) {
    return withRetry(wrappedFn, options.retry);
  }

  return wrappedFn();
}

// ============================================================================
// State Persistence
// ============================================================================

/**
 * State manager for saving and recovering progress
 */
export class StateManager<T extends Record<string, unknown>> {
  private stateFile: string;
  private state: T;

  constructor(stateFile: string, defaultState: T) {
    this.stateFile = stateFile;
    this.state = defaultState;
  }

  /**
   * Load state from storage
   */
  async load(): Promise<T> {
    try {
      // In browser: use localStorage
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(this.stateFile);
        if (stored) {
          this.state = JSON.parse(stored);
        }
      }
    } catch (error) {
      logger.warn("[StateManager] Failed to load state", { error });
    }
    return this.state;
  }

  /**
   * Save state to storage
   */
  async save(state?: Partial<T>): Promise<void> {
    if (state) {
      this.state = { ...this.state, ...state };
    }

    try {
      // In browser: use localStorage
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.stateFile, JSON.stringify(this.state));
      }
    } catch (error) {
      logger.warn("[StateManager] Failed to save state", { error });
    }
  }

  /**
   * Clear state
   */
  async clear(): Promise<void> {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.stateFile);
      }
    } catch (error) {
      logger.warn("[StateManager] Failed to clear state", { error });
    }
  }

  /**
   * Get current state
   */
  getState(): T {
    return this.state;
  }
}

