/**
 * Integration Testing Utilities
 * 
 * Tests for API integration, service communication, and data flow:
 * - API endpoint testing
 * - Request/response validation
 * - Error handling
 * - Authentication flows
 * - Data persistence
 */

import type { Page, Request, Response } from '@playwright/test';

export interface APIEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface APIResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  duration: number;
}

export interface IntegrationConfig {
  /** Base URL for API requests */
  baseUrl?: string;
  /** Default headers for all requests */
  defaultHeaders?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable request/response logging */
  logging?: boolean;
}

export interface TestData {
  /** Unique identifier */
  id: string;
  /** Creation timestamp */
  createdAt: number;
  /** Test data payload */
  payload: unknown;
}

/**
 * Integration Testing class
 */
export class IntegrationTesting {
  private page: Page;
  private config: Required<IntegrationConfig>;
  private requests: Array<{ request: Request; response: Response; duration: number }> = [];

  constructor(page: Page, config: IntegrationConfig = {}) {
    this.page = page;
    this.config = {
      baseUrl: config.baseUrl ?? '',
      defaultHeaders: config.defaultHeaders ?? {},
      timeout: config.timeout ?? 30000,
      logging: config.logging ?? true,
    };

    // Set up request interception
    this.setupRequestInterception();
  }

  /**
   * Set up request interception to track API calls
   */
  private setupRequestInterception(): void {
    this.page.on('request', (request) => {
      const startTime = Date.now();
      
      this.page.on('response', async (response) => {
        const duration = Date.now() - startTime;
        
        if (this.config.logging) {
          console.log(`[${request.method()}] ${request.url()} - ${response.status()} (${duration}ms)`);
        }
        
        this.requests.push({
          request,
          response,
          duration,
        });
      });
    });
  }

  /**
   * Make API request via page context
   */
  async makeRequest(endpoint: APIEndpoint): Promise<APIResponse> {
    const url = this.config.baseUrl + endpoint.url;
    const headers = {
      ...this.config.defaultHeaders,
      ...endpoint.headers,
    };

    const startTime = Date.now();

    const response = await this.page.evaluate(
      async ({ url, method, headers, body }) => {
        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await globalThis.fetch(url, fetchOptions);
        const responseBody = await response.json().catch(() => null);

        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
        };
      },
      { url, method: endpoint.method, headers, body: endpoint.body }
    );

    const duration = Date.now() - startTime;

    return {
      ...response,
      duration,
    };
  }

  /**
   * Test API endpoint
   */
  async testEndpoint(
    endpoint: APIEndpoint,
    options?: {
      expectStatus?: number;
      expectBody?: (body: unknown) => boolean;
      expectHeaders?: Record<string, string>;
    }
  ): Promise<{
    success: boolean;
    response: APIResponse;
    errors: string[];
  }> {
    const errors: string[] = [];
    let response: APIResponse;

    try {
      response = await this.makeRequest(endpoint);

      // Check status code
      if (options?.expectStatus && response.status !== options.expectStatus) {
        errors.push(
          `Expected status ${options.expectStatus}, got ${response.status}`
        );
      }

      // Check response body
      if (options?.expectBody && !options.expectBody(response.body)) {
        errors.push('Response body validation failed');
      }

      // Check headers
      if (options?.expectHeaders) {
        for (const [key, value] of Object.entries(options.expectHeaders)) {
          if (response.headers[key.toLowerCase()] !== value) {
            errors.push(`Expected header ${key}: ${value}, got ${response.headers[key.toLowerCase()]}`);
          }
        }
      }
    } catch (error) {
      response = {
        status: 0,
        statusText: 'Error',
        headers: {},
        body: null,
        duration: 0,
      };
      errors.push(`Request failed: ${error}`);
    }

    return {
      success: errors.length === 0,
      response,
      errors,
    };
  }

  /**
   * Test CRUD operations
   */
  async testCRUD(
    basePath: string,
    createData: unknown,
    updateData: unknown
  ): Promise<{
    create: APIResponse;
    read: APIResponse;
    update: APIResponse;
    delete: APIResponse;
    success: boolean;
  }> {
    // Create
    const createResult = await this.makeRequest({
      method: 'POST',
      url: basePath,
      body: createData,
    });

    const createdId = (createResult.body as any)?.id;

    // Read
    const readResult = await this.makeRequest({
      method: 'GET',
      url: `${basePath}/${createdId}`,
    });

    // Update
    const updateResult = await this.makeRequest({
      method: 'PUT',
      url: `${basePath}/${createdId}`,
      body: updateData,
    });

    // Delete
    const deleteResult = await this.makeRequest({
      method: 'DELETE',
      url: `${basePath}/${createdId}`,
    });

    const success = 
      createResult.status === 201 &&
      readResult.status === 200 &&
      updateResult.status === 200 &&
      deleteResult.status === 200;

    return {
      create: createResult,
      read: readResult,
      update: updateResult,
      delete: deleteResult,
      success,
    };
  }

  /**
   * Test authentication flow
   */
  async testAuthFlow(
    loginEndpoint: string,
    credentials: { username: string; password: string },
    protectedEndpoint: string
  ): Promise<{
    login: APIResponse;
    protected: APIResponse;
    success: boolean;
  }> {
    // Login
    const loginResult = await this.makeRequest({
      method: 'POST',
      url: loginEndpoint,
      body: credentials,
    });

    // Extract token
    const token = (loginResult.body as any)?.token;

    // Access protected endpoint
    const protectedResult = await this.makeRequest({
      method: 'GET',
      url: protectedEndpoint,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    const success = 
      loginResult.status === 200 &&
      protectedResult.status === 200;

    return {
      login: loginResult,
      protected: protectedResult,
      success,
    };
  }

  /**
   * Test error handling
   */
  async testErrorHandling(
    endpoint: APIEndpoint,
    expectedErrors: Array<{ status: number; message?: string }>
  ): Promise<{
    passed: boolean;
    results: Array<{ status: number; expected: number; matches: boolean }>;
  }> {
    const results = [];

    for (const expectedError of expectedErrors) {
      // Modify endpoint to trigger error
      const errorEndpoint = {
        ...endpoint,
        body: {
          ...(endpoint.body as object),
          _triggerError: expectedError.status,
        },
      };

      const response = await this.makeRequest(errorEndpoint);
      
      results.push({
        status: response.status,
        expected: expectedError.status,
        matches: response.status === expectedError.status,
      });
    }

    return {
      passed: results.every(r => r.matches),
      results,
    };
  }

  /**
   * Get all captured requests
   */
  getRequests(): Array<{ request: Request; response: Response; duration: number }> {
    return this.requests;
  }

  /**
   * Clear captured requests
   */
  clearRequests(): void {
    this.requests = [];
  }

  /**
   * Get request statistics
   */
  getStats(): {
    totalRequests: number;
    averageDuration: number;
    statusCodes: Record<number, number>;
    endpoints: Record<string, number>;
  } {
    const statusCodes: Record<number, number> = {};
    const endpoints: Record<string, number> = {};
    let totalDuration = 0;

    for (const { request, response, duration } of this.requests) {
      // Status codes (Playwright Response exposes status as a method)
      const status = response.status();
      statusCodes[status] = (statusCodes[status] || 0) + 1;

      // Endpoints
      const url = request.url();
      endpoints[url] = (endpoints[url] || 0) + 1;

      totalDuration += duration;
    }

    return {
      totalRequests: this.requests.length,
      averageDuration: this.requests.length > 0 ? totalDuration / this.requests.length : 0,
      statusCodes,
      endpoints,
    };
  }
}

/**
 * Create integration testing instance
 */
export function createIntegrationTesting(
  page: Page,
  config?: IntegrationConfig
): IntegrationTesting {
  return new IntegrationTesting(page, config);
}

/**
 * Quick API test helper
 */
export async function testAPI(
  page: Page,
  endpoint: APIEndpoint,
  expectedStatus: number = 200
): Promise<boolean> {
  const testing = new IntegrationTesting(page);
  const result = await testing.testEndpoint(endpoint, {
    expectStatus: expectedStatus,
  });
  return result.success;
}
