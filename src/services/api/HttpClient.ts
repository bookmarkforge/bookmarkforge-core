/**
 * HttpClient - Unified API Layer
 *
 * Enterprise-grade HTTP client combining timeout, retry, deduplication,
 * interceptors, and security features into a single abstraction.
 *
 * Based on bulletproof-react API layer patterns.
 */

import { logger, redactSecrets } from "../../utils/logger";
import { firewalledFetch } from "../../utils/networkFirewall";
import {
  globalRequestDeduper,
  RequestDeduper,
} from "../../utils/requestDeduper";

export interface HttpRequestConfig extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  dedupe?: boolean;
  dedupeKey?: string;
  skipAuth?: boolean;
  skipSanitization?: boolean;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  ok: boolean;
}

export interface HttpError {
  message: string;
  status?: number;
  statusText?: string;
  url?: string;
  isNetworkError: boolean;
  isTimeout: boolean;
  originalError?: Error;
}

export type RequestInterceptor = (
  config: HttpRequestConfig,
) => HttpRequestConfig | Promise<HttpRequestConfig>;
export type ResponseInterceptor<T = unknown> = (
  response: HttpResponse<T>,
) => HttpResponse<T> | Promise<HttpResponse<T>>;
export type ErrorInterceptor = (
  error: HttpError,
) => HttpError | Promise<HttpError>;

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 1000;
const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 8 * 1024;
const MAX_HTML_PROBE_BYTES = 16 * 1024;

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException("Request aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Request aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Server error bodies are not ours to trust: proxies and API gateways
 * commonly echo the request headers back into the error page, which would
 * put `Authorization: Bearer <token>` straight into HttpError.message — and
 * from there into persisted logs and the UI. Redact credential sequences
 * (Bearer/Basic raw header format, which redactSecrets alone does not cover
 * because the value is separated from the key by a space) plus control
 * characters, then bound the result.
 */
function sanitizeErrorBody(body: string): string {
  // Header-echo format first: `Authorization: Bearer <token>` is a plain key
  // + space + value, which redactSecrets' key:value pattern would otherwise
  // collapse to "Authorization: [REDACTED] <token>" — leaving the token raw.
  const redacted = redactSecrets(
    body
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]"),
  )
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.slice(0, MAX_ERROR_BODY_BYTES);
}

function getSafeUrlForDiagnostics(url: string): string {
  try {
    const parsed = new URL(url);
    const queryKeys = [...parsed.searchParams.keys()];
    const query = queryKeys.length > 0
      ? `?${queryKeys.map((key) => `${encodeURIComponent(key)}=[REDACTED]`).join("&")}`
      : "";
    return `${parsed.origin}${parsed.pathname}${query}`;
  } catch (_err) {
    return "[INVALID_URL]";
  }
}

export class HttpClient {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private errorInterceptors: ErrorInterceptor[] = [];
  private deduper: RequestDeduper;
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl = "", defaultHeaders: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultHeaders = defaultHeaders;
    this.deduper = globalRequestDeduper;
  }

  /**
   * Register a request interceptor
   */
  onRequest(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * Register a response interceptor
   */
  onResponse<T = unknown>(interceptor: ResponseInterceptor<T>): void {
    this.responseInterceptors.push(interceptor as ResponseInterceptor);
  }

  /**
   * Register an error interceptor
   */
  onError(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  /**
   * Execute HTTP request with all enterprise features
   */
  async request<T = unknown>(
    url: string,
    config: HttpRequestConfig = {},
  ): Promise<HttpResponse<T>> {
    const fullUrl = this.buildUrl(url);
    let finalConfig: HttpRequestConfig;
    try {
      finalConfig = await this.applyRequestInterceptors({
        ...config,
        headers: {
          ...this.defaultHeaders,
          ...config.headers,
        },
      });
    } catch (error) {
      // Audit M-07: interceptor failures must surface as normalized
      // HttpError values (isTimeout/isNetworkError/status defined) so
      // callers never crash reading undefined fields.
      throw this.normalizeError(error as Error, fullUrl);
    }
    const timeout = finalConfig.timeout ?? DEFAULT_TIMEOUT;
    const retries = finalConfig.retries ?? DEFAULT_RETRIES;
    const retryDelay = finalConfig.retryDelay ?? DEFAULT_RETRY_DELAY;
    const method = (finalConfig.method || "GET").toUpperCase();
    const isDedupeSafe = ["GET", "HEAD", "OPTIONS"].includes(method);
    // Mutable requests need an explicit key: URL + method is not enough to
    // distinguish two POST/PUT/PATCH bodies.
    const shouldDedupe =
      finalConfig.dedupe === true && (isDedupeSafe || Boolean(finalConfig.dedupeKey));

    const execute = async (): Promise<HttpResponse<T>> =>
      this.fetchWithTimeout(
        fullUrl,
        finalConfig,
        timeout,
        (response) => this.processResponse<T>(response, fullUrl),
      );

    const executeWithRetry = async (attempt = 0): Promise<HttpResponse<T>> => {
      try {
        return await execute();
      } catch (error) {
        const httpError = this.normalizeError(error as Error, fullUrl);

        const is5xx = httpError.status !== undefined && httpError.status >= 500;
        const requestMethod = (finalConfig.method || "GET").toUpperCase();
        const isIdempotent = ["GET", "HEAD", "OPTIONS"].includes(requestMethod);

        // L-08: hoist the Idempotency-Key check into a named constant with
        // explicit undefined/null handling so the retry condition's precedence
        // is readable (and the Headers wrapper is only built when needed).
        const hasIdempotencyKey = (() => {
          const headers = finalConfig.headers;
          if (headers === undefined || headers === null) {return false;}
          return new Headers(headers as HeadersInit).has("Idempotency-Key");
        })();

        // Only retry idempotent requests (GET/HEAD/OPTIONS) or those with an
        // explicit Idempotency-Key header. Retrying POST/PUT/PATCH on timeout
        // or 5xx can duplicate side effects (charge, create, etc.).
        const cancelledByCaller = finalConfig.signal?.aborted === true;
        if (
          !cancelledByCaller &&
          (httpError.isTimeout || httpError.isNetworkError || is5xx)
        ) {
          if (attempt < retries && (isIdempotent || hasIdempotencyKey)) {
            const delay = retryDelay * Math.pow(2, attempt);
            logger.warn("[HttpClient] Retry attempt", {
              attempt,
              delay,
              url: getSafeUrlForDiagnostics(fullUrl),
              method: requestMethod,
            });
            await waitForRetry(delay, finalConfig.signal ?? undefined);
            return executeWithRetry(attempt + 1);
          }
        }

        const processedError = await this.applyErrorInterceptors(httpError);
        throw processedError;
      }
    };

    if (shouldDedupe) {
      const dedupeKey =
        finalConfig.dedupeKey || `${method}:${fullUrl}`;
      return this.deduper.dedupe(dedupeKey, executeWithRetry);
    }

    return executeWithRetry();
  }

  /**
   * GET request
   */
  async get<T = unknown>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "GET" });
  }

  /**
   * POST request
   */
  async post<T = unknown>(
    url: string,
    body?: unknown,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const serialized = body ? JSON.stringify(body) : undefined;
    return this.request<T>(url, {
      ...config,
      method: "POST",
      body: serialized,
      headers: {
        "Content-Type": "application/json",
        ...config?.headers,
      },
    });
  }

  /**
   * PUT request
   */
  async put<T = unknown>(
    url: string,
    body?: unknown,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const serialized = body ? JSON.stringify(body) : undefined;
    return this.request<T>(url, {
      ...config,
      method: "PUT",
      body: serialized,
      headers: {
        "Content-Type": "application/json",
        ...config?.headers,
      },
    });
  }

  /**
   * PATCH request
   */
  async patch<T = unknown>(
    url: string,
    body?: unknown,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    const serialized = body ? JSON.stringify(body) : undefined;
    return this.request<T>(url, {
      ...config,
      method: "PATCH",
      body: serialized,
      headers: {
        "Content-Type": "application/json",
        ...config?.headers,
      },
    });
  }

  /**
   * DELETE request
   */
  async delete<T = unknown>(
    url: string,
    config?: HttpRequestConfig,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...config, method: "DELETE" });
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout<T>(
    url: string,
    config: HttpRequestConfig,
    timeoutMs: number,
    processResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const callerSignal = config.signal;
    const onCallerAbort = () => controller.abort();

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }

    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await firewalledFetch(
        url,
        {
          ...config,
          signal: controller.signal,
          headers: config.headers,
        },
        "http-client",
      );

      const contentType = response.headers.get("content-type");
      if (
        contentType?.includes("text/html") &&
        typeof response.clone === "function"
      ) {
        // Never consume the original response as a probe: processResponse
        // still needs its body for the actual result/error path.
        try {
          const cloned = response.clone();
          const text = await this.readResponseTextLimited(cloned, MAX_HTML_PROBE_BYTES);
          if (
            text.includes("<!DOCTYPE html>") ||
            text.includes("<!doctype html>")
          ) {
            throw new Error(`Expected JSON but received HTML from ${getSafeUrlForDiagnostics(url)}`);
          }
        } catch (error) {
          try {await response.body?.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary probe error. */ }
          throw error;
        }
      }

      // Keep the timeout alive while the body is consumed. Fetch resolves
      // after headers, so clearing it earlier leaves response.json()/text()
      // without any deadline.
      return await processResponse(response);
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /**
   * Process response through interceptors
   */
  private async processResponse<T>(
    response: Response,
    url: string,
  ): Promise<HttpResponse<T>> {
    const httpResponse: HttpResponse<T> = {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      ok: response.ok,
      data: null as T,
    };

    if (!response.ok) {
      const errorBody = await this.readResponseTextLimited(
        response,
        MAX_ERROR_BODY_BYTES,
      ).catch(() => "");
      throw this.normalizeError(
        new Error(
          `HTTP ${response.status}: ${response.statusText} - ${sanitizeErrorBody(errorBody)}`,
        ),
        url,
        response.status,
        response.statusText,
      );
    }

    const contentType = response.headers.get("content-type");
    const body = await this.readResponseTextLimited(
      response,
      MAX_RESPONSE_BODY_BYTES,
    );
    if (contentType?.includes("application/json")) {
      try {
        httpResponse.data = JSON.parse(body) as T;
      } catch (_err) {
        throw this.normalizeError(
          new Error("Invalid JSON response"),
          url,
          response.status,
          response.statusText,
        );
      }
    } else {
      httpResponse.data = body as unknown as T;
    }

    return this.applyResponseInterceptors(httpResponse);
  }

  private async readResponseTextLimited(
    response: Response,
    maxBytes: number,
  ): Promise<string> {
    const limit = Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.floor(maxBytes)
      : MAX_RESPONSE_BODY_BYTES;
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > limit) {
      try {await response.body?.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary response-limit error. */ }
      throw new Error("Response body exceeds the configured limit");
    }

    if (!response.body) {
      if (typeof response.text === "function") {
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > limit) {
          throw new Error("Response body exceeds the configured limit");
        }
        return text;
      }
      // Keep compatibility with lightweight Response mocks used by callers
      // and tests while real browser Responses take the bounded stream path.
      if (typeof response.json === "function") {
        const value = await response.json();
        const text = JSON.stringify(value);
        if (new TextEncoder().encode(text).byteLength > limit) {
          throw new Error("Response body exceeds the configured limit");
        }
        return text;
      }
      return "";
    }

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    } catch (error) {
      try {await response.body.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary response error. */ }
      throw error;
    }
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {break;}
        totalBytes += value.byteLength;
        if (totalBytes > limit) {
          throw new Error("Response body exceeds the configured limit");
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join("");
    } catch (error) {
      try {await reader.cancel();} catch { /* INTENTIONAL SILENCE: preserve the primary response error. */ }
      throw error;
    } finally {
      try {reader.releaseLock();} catch { /* INTENTIONAL SILENCE: the runtime already released the response reader lock. */ }
    }
  }

  /**
   * Apply request interceptors in order
   */
  private async applyRequestInterceptors(
    config: HttpRequestConfig,
  ): Promise<HttpRequestConfig> {
    let finalConfig = config;
    for (const interceptor of this.requestInterceptors) {
      finalConfig = await interceptor(finalConfig);
    }
    return finalConfig;
  }

  /**
   * Apply response interceptors in order
   */
  private async applyResponseInterceptors<T>(
    response: HttpResponse<T>,
  ): Promise<HttpResponse<T>> {
    let finalResponse = response;
    for (const interceptor of this.responseInterceptors) {
      finalResponse = await (interceptor as ResponseInterceptor<T>)(
        finalResponse,
      );
    }
    return finalResponse;
  }

  /**
   * Apply error interceptors in order
   */
  private async applyErrorInterceptors(error: HttpError): Promise<HttpError> {
    let finalError = error;
    for (const interceptor of this.errorInterceptors) {
      finalError = await interceptor(finalError);
    }
    return finalError;
  }

  /**
   * Normalize error to HttpError format
   */
  private normalizeError(
    error: unknown,
    url: string,
    status?: number,
    statusText?: string,
  ): HttpError {
    if (error && typeof error === "object" && "isNetworkError" in error) {
      return error as HttpError;
    }

    const errRecord =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    const errorObj =
      error instanceof Error
        ? error
        : { name: String(errRecord?.name ?? ""), message: String(error) };
    const errorName = "name" in errorObj ? errorObj.name : "";
    const errorMsg = errorObj.message
      ? String(errorObj.message).toLowerCase()
      : "";
    const isTimeout =
      errorName === "AbortError" || errorMsg.includes("timeout");
    const isNetworkError =
      errorMsg.includes("fetch") || errorMsg.includes("network") || isTimeout;

    let message = errorObj.message;
    if (!message.startsWith("HTTP")) {
      message = isTimeout
        ? "Request timed out"
        : isNetworkError
          ? "Network error. Check your connection."
          : message;
    }

    return {
      message,
      status,
      statusText,
      url: getSafeUrlForDiagnostics(url),
      isNetworkError,
      isTimeout,
      originalError: error instanceof Error ? error : undefined,
    };
  }

  /**
   * Build full URL from base
   */
  private buildUrl(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    return `${this.baseUrl}/${url.replace(/^\//, "")}`;
  }

  /**
   * Clear deduplication cache
   */
  clearDedupeCache(): void {
    this.deduper.clear();
  }
}

export const httpClient = new HttpClient();

export function createHttpClient(
  baseUrl: string,
  defaultHeaders?: Record<string, string>,
): HttpClient {
  return new HttpClient(baseUrl, defaultHeaders);
}
