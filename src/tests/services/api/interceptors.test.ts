/**
 * Tests for interceptors.ts
 * Mocks HttpClient, logger and sanitizationService
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockOnRequest = vi.hoisted(() => vi.fn());
const mockOnResponse = vi.hoisted(() => vi.fn());
const mockOnError = vi.hoisted(() => vi.fn());

vi.mock("../../../services/api/HttpClient", () => ({
  httpClient: {
    onRequest: mockOnRequest,
    onResponse: mockOnResponse,
    onError: mockOnError,
  },
  HttpRequestConfig: class {},
  HttpResponse: class {},
  HttpError: class {},
}));

const mockSanitizeHtml = vi.hoisted(() => vi.fn((html: string) => {
  let current = html;
  let iterations = 0;
  const MAX_ITERATIONS = 1000; // Safety cap for test mock
  for (;;) {
    if (iterations >= MAX_ITERATIONS) break;
    iterations++;
    const lower = current.toLowerCase();
    const open = lower.indexOf("<script");
    if (open === -1) return current;
    const close = lower.indexOf("</script>", open + 7);
    if (close === -1) return current.slice(0, open);
    current = current.slice(0, open) + current.slice(close + 9);
  }
  return current;
}));
vi.mock("../../../services/SanitizationService", () => ({
  SanitizationService: {
    sanitizeObject: vi.fn(),
    sanitizeHtml: mockSanitizeHtml,
  },
}));

vi.mock("../../../utils/logger", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../../utils/logger")>();
  return {
    ...mod,
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  };
});

import {
  setupAuthInterceptor,
  setupLoggingInterceptor,
  setupErrorTransformationInterceptor,
  setupSecurityInterceptor,
  setupApiInterceptors,
} from "../../../services/api/interceptors";

describe("setupAuthInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should add Bearer token if it exists", () => {
    const getToken = vi.fn(() => "my-token");
    setupAuthInterceptor(getToken);

    // Get the registered function
    const handler = mockOnRequest.mock.calls[0]![0];
    const config = handler({ headers: {} });
    expect(config.headers.Authorization).toBe("Bearer my-token");
  });

  it("should skip if skipAuth is true", () => {
    setupAuthInterceptor(() => "tok");
    const handler = mockOnRequest.mock.calls[0]![0];
    const config = handler({ headers: {}, skipAuth: true });
    expect(config.headers.Authorization).toBeUndefined();
  });

  it("should return config unchanged if there is no token", () => {
    setupAuthInterceptor(() => null);
    const handler = mockOnRequest.mock.calls[0]![0];
    const config = handler({ headers: { "X-Custom": "val" } });
    expect(config.headers.Authorization).toBeUndefined();
    expect(config.headers["X-Custom"]).toBe("val");
  });
});

describe("setupLoggingInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should register request, response and error interceptors", () => {
    setupLoggingInterceptor();
    expect(mockOnRequest).toHaveBeenCalledTimes(1);
    expect(mockOnResponse).toHaveBeenCalledTimes(1);
    expect(mockOnError).toHaveBeenCalledTimes(1);
  });

  it("request interceptor should return config", () => {
    setupLoggingInterceptor();
    const handler = mockOnRequest.mock.calls[0]![0];
    const cfg = handler({ method: "GET" });
    expect(cfg.method).toBe("GET");
  });

  it("response interceptor should return response", () => {
    setupLoggingInterceptor();
    const handler = mockOnResponse.mock.calls[0]![0];
    const res = handler({ status: 200 });
    expect(res.status).toBe(200);
  });

  it("error interceptor should return error", () => {
    setupLoggingInterceptor();
    const handler = mockOnError.mock.calls[0]![0];
    const err = handler({
      message: "err",
      isNetworkError: false,
      isTimeout: false,
    });
    expect(err.message).toBe("err");
  });
});

describe("setupErrorTransformationInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should transform 401 into a friendly message", () => {
    setupErrorTransformationInterceptor();
    const handler = mockOnError.mock.calls[0]![0];
    const err = handler({
      status: 401,
      message: "Unauthorized",
      isNetworkError: false,
      isTimeout: false,
    });
    expect(err.message).toBe("Authentication required. Please sign in again.");
  });

  it("should transform 404", () => {
    setupErrorTransformationInterceptor();
    const handler = mockOnError.mock.calls[0]![0];
    const err = handler({
      status: 404,
      message: "Not Found",
      isNetworkError: false,
      isTimeout: false,
    });
    expect(err.message).toContain("not found");
  });

  it("should return original message if status is not mapped", () => {
    setupErrorTransformationInterceptor();
    const handler = mockOnError.mock.calls[0]![0];
    const err = handler({
      status: 418,
      message: "I'm a teapot",
      isNetworkError: false,
      isTimeout: false,
    });
    expect(err.message).toBe("I'm a teapot");
  });

  it("should return error unchanged if it has no status", () => {
    setupErrorTransformationInterceptor();
    const handler = mockOnError.mock.calls[0]![0];
    const err = handler({
      message: "error",
      isNetworkError: false,
      isTimeout: false,
    });
    expect(err.message).toBe("error");
  });
});

describe("setupSecurityInterceptor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should sanitize HTML fields (content) but leave JSON fields intact", () => {
    setupSecurityInterceptor();
    const handler = mockOnResponse.mock.calls[0]![0];
    const res = handler({
      data: {
        name: "test <script>",
        price: "< 100",
        content: "<p>Hello</p><script>alert(1)</script>",
        summary: "<b>Bold</b>",
      },
    });
    // HTML fields should be sanitized
    expect(res.data.content).not.toContain("<script>");
    expect(res.data.content).toContain("<p>Hello</p>");
    expect(res.data.summary).toContain("<b>Bold</b>");
    // Non-HTML fields should pass through unmodified (no HTML entity encoding)
    expect(res.data.name).toBe("test <script>");
    expect(res.data.price).toBe("< 100");
  });

  it("should return response unchanged if data is not an object", () => {
    setupSecurityInterceptor();
    const handler = mockOnResponse.mock.calls[0]![0];
    const res = handler({ data: "string" });
    expect(res.data).toBe("string");
  });

  it("should handle sanitization error without throwing", () => {
    setupSecurityInterceptor();
    const handler = mockOnResponse.mock.calls[0]![0];
    // Pass a problematic value that might trigger an error path
    const res = handler({ data: null });
    expect(res.data).toBe(null);
  });
});

describe("setupApiInterceptors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should configure all interceptors without token", () => {
    setupApiInterceptors();
    expect(mockOnRequest).toHaveBeenCalled();
    expect(mockOnResponse).toHaveBeenCalled();
    expect(mockOnError).toHaveBeenCalled();
  });

  it("should configure auth interceptor if getToken is provided", () => {
    setupApiInterceptors(() => "tok");
    // 2 request interceptors (logging + auth)
    expect(mockOnRequest).toHaveBeenCalledTimes(2);
  });
});
