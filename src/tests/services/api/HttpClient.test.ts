/**
 * Tests for HttpClient
 * Mocks fetch, requestDeduper and logger
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockDeduper = vi.hoisted(() => ({
  dedupe: vi.fn((_key: string, fn: () => Promise<any>) => fn()),
  clear: vi.fn(),
}));
vi.mock("../../../utils/requestDeduper", () => ({
  globalRequestDeduper: mockDeduper,
  RequestDeduper: vi.fn(() => mockDeduper),
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
  HttpClient,
  createHttpClient,
  httpClient,
  type HttpRequestConfig,
} from "../../../services/api/HttpClient";

describe("HttpClient", () => {
  let client: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    client = new HttpClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildUrl", () => {
    it("should use absolute URL directly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      await client.request("https://api.example.com/data");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.anything(),
      );
    });

    it("should concatenate baseUrl with relative path", async () => {
      const c = new HttpClient("https://base.com/api");
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      await c.request("/users");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://base.com/api/users",
        expect.anything(),
      );
    });
  });

  describe("convenience methods", () => {
    it("get should perform GET request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ data: "ok" }),
      });
      const res = await client.get("/test");
      expect(res.data).toEqual({ data: "ok" });
    });

    it("post should perform POST with serialized body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ id: 1 }),
      });
      const res = await client.post("/items", { name: "test" });
      expect(res.data).toEqual({ id: 1 });
    });

    it("put should perform PUT request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ updated: true }),
      });
      const res = await client.put("/items/1", { name: "new" });
      expect((res.data as any).updated).toBe(true);
    });

    it("patch should perform PATCH request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ patched: true }),
      });
      const res = await client.patch("/items/1", { name: "patched" });
      expect((res.data as any).patched).toBe(true);
    });

    it("delete should perform DELETE request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ deleted: true }),
      });
      const res = await client.delete("/items/1");
      expect((res.data as any).deleted).toBe(true);
    });
  });

  describe("timeout", () => {
    it("should throw timeout error if aborted", async () => {
      mockFetch.mockImplementation(async () => {
        return new Promise((_, reject) => {
          setTimeout(
            () => reject(new DOMException("Aborted", "AbortError")),
            50,
          );
        });
      });

      await expect(client.request("/test")).rejects.toMatchObject({
        isTimeout: true,
      });
    });
  });

  describe("response safety", () => {
    it("rejects a streamed response after cancelling at the size limit", async () => {
      const cancel = vi.fn(async () => undefined);
      const oversizedChunk = new Uint8Array(10 * 1024 * 1024 + 1);
      let readCount = 0;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        body: {
          getReader: () => ({
            read: async () => {
              readCount += 1;
              return readCount === 1
                ? { done: false, value: oversizedChunk }
                : { done: true, value: undefined };
            },
            cancel,
            releaseLock: vi.fn(),
          }),
        },
      });

      await expect(client.get("/large", { retries: 0 })).rejects.toMatchObject({
        isNetworkError: false,
      });
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("redacts query values from normalized HTTP errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "invalid",
      });

      await expect(
        client.get("https://api.example.test/items?token=secret-value&vaultKey=private"),
      ).rejects.toMatchObject({
        url: "https://api.example.test/items?token=[REDACTED]&vaultKey=[REDACTED]",
      });
    });

    it("redacts credentials echoed in server error bodies", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () =>
          "gateway echo: Authorization: Bearer A1b2C3d4E5f6G7h8 request-id abcd\nBasic dXNlcjpwYXNz",
      });

      await expect(
        client.get("https://api.example.test/items", { retries: 0 }),
      ).rejects.toMatchObject({
        message: expect.not.stringContaining("A1b2C3d4E5f6G7h8"),
      });
    });
  });

  describe("interceptors", () => {
    it("should run request interceptors in order", async () => {
      const orders: number[] = [];
      client.onRequest((cfg) => {
        orders.push(1);
        return cfg;
      });
      client.onRequest((cfg) => {
        orders.push(2);
        return { ...cfg, headers: { ...(cfg.headers as any), "X-Test": "val" } };
      });
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      await client.request("/test");
      expect(orders).toEqual([1, 2]);
    });

    it("should run response interceptors", async () => {
      client.onResponse((res: any) => ({
        ...res,
        data: { ...res.data, intercepted: true },
      }));
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ a: 1 }),
      });
      const res = await client.request("/test");
      expect((res.data as any).intercepted).toBe(true);
    });

    it("should run error interceptors", async () => {
      client.onError((err) => ({
        ...err,
        message: "Transformed: " + err.message,
      }));
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
      await expect(client.request("/test")).rejects.toMatchObject({
        message: expect.stringContaining("Transformed"),
      });
    });

    it("normaliza el error de un request interceptor que lanza (M-07)", async () => {
      client.onRequest(() => {
        throw new Error("auth failed");
      });
      await expect(client.request("/test")).rejects.toMatchObject({
        message: "auth failed",
        isTimeout: false,
        isNetworkError: false,
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("retry", () => {
    it("should retry on 5xx error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Server Error",
          headers: new Headers({ "content-type": "text/plain" }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ success: true }),
        });

      const res = await client.request("/test", { retries: 1, retryDelay: 10 });
      expect((res.data as any).success).toBe(true);
    });

    it("should fail after retries are exhausted", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "",
      });
      await expect(
        client.request("/test", { retries: 1, retryDelay: 10 }),
      ).rejects.toBeDefined();
    });

    it("retries POST with explicit Idempotency-Key header (L-08)", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Server Error",
          headers: new Headers({ "content-type": "text/plain" }),
          text: async () => "",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ success: true }),
        });

      const res = await client.request("/test", {
        method: "POST",
        headers: { "Idempotency-Key": "idem-123" },
        retries: 1,
        retryDelay: 10,
      });
      expect((res.data as any).success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("does not retry POST without Idempotency-Key (L-08)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        headers: new Headers({ "content-type": "text/plain" }),
        text: async () => "",
      });
      await expect(
        client.request("/test", {
          method: "POST",
          retries: 1,
          retryDelay: 10,
        }),
      ).rejects.toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("deduplication", () => {
    it("should use deduper if dedupe=true for GET", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      await client.request("/test", { dedupe: true });
      expect(mockDeduper.dedupe).toHaveBeenCalled();
    });

    it("does not dedupe POST without explicit key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      await client.request("/test", { method: "POST", dedupe: true });
      expect(mockDeduper.dedupe).not.toHaveBeenCalled();
    });

    it("allows deduping POST only with explicit key", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      await client.request("/test", {
        method: "POST",
        dedupe: true,
        dedupeKey: "search:react",
      });
      expect(mockDeduper.dedupe).toHaveBeenCalledWith(
        "search:react",
        expect.any(Function),
      );
    });

    it("keeps the consumer's AbortSignal", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({}),
      });
      const controller = new AbortController();
      await client.request("/test", { signal: controller.signal });
      const passedSignal = mockFetch.mock.calls[0]?.[1]?.signal;
      controller.abort();
      expect(passedSignal).toBeInstanceOf(AbortSignal);
      expect(passedSignal.aborted).toBe(false);
    });

    it("keeps the timeout active while reading the body", async () => {
      let abortSignal!: AbortSignal;
      mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
        abortSignal = init.signal!;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: new Headers({ "content-type": "application/json" }),
          json: () => new Promise((resolve) => {
            abortSignal.addEventListener("abort", () => resolve({ aborted: true }));
          }),
        };
      });

      const result = await client.request("/test", { timeout: 10, retries: 0 });
      expect(result.data).toEqual({ aborted: true });
    });
  });

  describe("clearDedupeCache", () => {
    it("should clear dedup cache", () => {
      client.clearDedupeCache();
      expect(mockDeduper.clear).toHaveBeenCalled();
    });
  });

  describe("createHttpClient", () => {
    it("should create instance with baseUrl", () => {
      const c = createHttpClient("https://api.test.com", { "X-API": "key" });
      expect(c).toBeInstanceOf(HttpClient);
    });
  });
});
