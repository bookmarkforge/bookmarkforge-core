/**
 * API Interceptors - Enterprise middleware for HttpClient
 *
 * Provides auth, logging, error transformation, and security interceptors.
 */

import {
  httpClient,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
} from "./HttpClient";
import { logger } from "../../utils/logger";
import { SanitizationService } from "../SanitizationService";

/**
 * Auth Interceptor - Adds authentication tokens to requests
 */
export function setupAuthInterceptor(getToken: () => string | null): void {
  httpClient.onRequest((config: HttpRequestConfig) => {
    if (config.skipAuth) {return config;}

    const token = getToken();
    if (token) {
      return {
        ...config,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${token}`,
        },
      };
    }

    return config;
  });
}

/**
 * Logging Interceptor - Logs all requests and responses
 */
export function setupLoggingInterceptor(): void {
  httpClient.onRequest((config: HttpRequestConfig) => {
    const startTime = Date.now();
    logger.debug("[HTTP Request]", {
      method: config.method,
      timestamp: startTime,
    });
    return config;
  });

  httpClient.onResponse((response: HttpResponse<unknown>) => {
    logger.debug("[HTTP Response]", {
      status: response.status,
    });
    return response;
  });

  httpClient.onError((error: HttpError) => {
    logger.error("[HTTP Error]", {
      message: error.message,
      status: error.status,
      url: error.url,
      isNetworkError: error.isNetworkError,
      isTimeout: error.isTimeout,
    });
    return error;
  });
}

/**
 * Error Transformation Interceptor - Converts HTTP errors to user-friendly messages
 */
export function setupErrorTransformationInterceptor(): void {
  httpClient.onError((error: HttpError) => {
    if (!error.status) {return error;}

    const userMessages: Record<number, string> = {
      400: "Invalid request. Please check your input.",
      401: "Authentication required. Please sign in again.",
      403: "You do not have permission to perform this action.",
      404: "The requested resource was not found.",
      408: "Request timed out. Please try again.",
      409: "Conflict: The resource has been modified by another user.",
      429: "Too many requests. Please wait a moment and try again.",
      500: "Server error. Please try again later.",
      502: "Service temporarily unavailable. Please try again later.",
      503: "Service under maintenance. Please try again later.",
      504: "Gateway timeout. Please try again later.",
    };

    const userMessage = userMessages[error.status] || error.message;

    return {
      ...error,
      message: userMessage,
    };
  });
}

/**
 * Sanitizes API response data without corrupting JSON.
 *
 * Only sanitizes known HTML-content fields (content, blocks, summary,
 * description, bio) with sanitizeHtml(). All other fields (JSON data,
 * numbers, booleans, plain text) pass through untouched. This prevents
 * the previous sanitizeObject() behavior of HTML-encoding every string
 * (turning "price < 100" into "price &lt; 100") while still protecting
 * against XSS in rich-text fields.
 */
function sanitizeApiResponse(
  data: unknown,
  visited?: WeakSet<object>,
): unknown {
  if (!data || typeof data !== "object") return data;
  if (visited?.has(data as object)) return {};
  const visitedSet = visited || new WeakSet<object>();
  visitedSet.add(data as object);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeApiResponse(item, visitedSet));
  }

  const htmlFields = ["content", "blocks", "summary", "description", "bio"];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(
    data as Record<string, unknown>,
  )) {
    if (typeof value === "string") {
      const isHtmlField = htmlFields.some((field) =>
        key.toLowerCase().includes(field),
      );
      sanitized[key] = isHtmlField
        ? SanitizationService.sanitizeHtml(value)
        : value; // JSON/plain-text: pass through unmodified
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeApiResponse(value, visitedSet);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Security Interceptor - Sanitizes response data
 */
export function setupSecurityInterceptor(): void {
  httpClient.onResponse((response: HttpResponse) => {
    if (response.data && typeof response.data === "object") {
      try {
        const sanitized = sanitizeApiResponse(response.data);
        return {
          ...response,
          data: sanitized,
        };
      } catch (_err) {
        logger.warn("[SecurityInterceptor] Failed to sanitize response data");
      }
    }
    return response;
  });
}

/**
 * Setup all enterprise interceptors
 */
export function setupApiInterceptors(getToken?: () => string | null): void {
  setupLoggingInterceptor();
  setupErrorTransformationInterceptor();
  setupSecurityInterceptor();

  if (getToken) {
    setupAuthInterceptor(getToken);
  }
}
