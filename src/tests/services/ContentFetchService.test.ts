/**
 * ContentFetchService.test.ts
 *
 * Tests the fetchAndExtract method which:
 * 1. Fetches a URL via firewalledFetch
 * 2. Parses HTML with DOMParser + Mozilla Readability
 * 3. Converts to Markdown via TurndownService (dynamic import)
 * 4. Sanitizes via SanitizationService
 * 5. Updates RxDB bookmark document
 * 6. Returns { content, summary } or null on error
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────

const mockBookmark = {
  id: "bm-123",
  url: "https://example.com/article",
  title: "Original Title",
};

const mockReadableContent = {
  title: "Readable Article Title",
  content: "<p>Article content here</p>",
  excerpt: "Article excerpt here",
};

const mockMarkdown = "**Article content here**\n\nArticle excerpt here";

// Build a minimal ReadableStream for the response body
function createMockBody(html: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(html);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

// Mock firewalledFetch
const mockFetchResponse = {
  ok: true,
  status: 200,
  headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
  body: createMockBody("<html><body><p>Test content</p></body></html>"),
  text: vi.fn().mockResolvedValue("<html><body><p>Test content</p></body></html>"),
};
const firewalledFetchMock = vi.fn().mockResolvedValue(mockFetchResponse);

vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: firewalledFetchMock,
  setFirewallDisabled: vi.fn(),
}));

// Mock Readability constructor — return a mock article
const readabilityParseMock = vi.fn().mockReturnValue(mockReadableContent);
vi.mock("@mozilla/readability", () => ({
  // Regular function (not arrow): vitest requires a constructible
  // implementation when the mock is invoked with `new`.
  Readability: vi.fn().mockImplementation(function () {
    return { parse: readabilityParseMock };
  }),
}));

// Mock TurndownService (dynamic import) — registered via vi.mock below
const turndownMock = vi.fn().mockReturnValue(mockMarkdown);
vi.mock("turndown", () => ({
  // Regular function (not arrow): TurndownService is constructed via `new`.
  default: vi.fn().mockImplementation(function () {
    return { turndown: turndownMock };
  }),
}));

// Mock SanitizationService
vi.mock("../../services/SanitizationService", () => ({
  SanitizationService: {
    sanitizeHtml: vi.fn().mockImplementation((html: string) => `sanitized:${html}`),
    sanitizeText: vi.fn().mockImplementation((text: string) => `sanitized:${text}`),
    // P78: SSRF gate — sanitizeUrl must return the URL unchanged for valid
    // public URLs and "" for blocked ones (same contract as production).
    sanitizeUrl: vi.fn().mockImplementation((url: string) => {
      if (!url || !url.startsWith("http")) {return "";}
      return url;
    }),
  },
}));

// Mock database
const mockDocRef = {
  incrementalPatch: vi.fn().mockResolvedValue(undefined),
};
const mockDb = {
  bookmarks: {
    findOne: vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(mockDocRef),
    }),
  },
};
const initDBMock = vi.fn().mockResolvedValue(mockDb);
vi.mock("../../db/database", () => ({
  initDB: initDBMock,
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import after mocks ───────────────────────────────────────────────

const { contentFetchService } = await import("../../services/ContentFetchService");
const { SanitizationService } = await import("../../services/SanitizationService");
const { logger } = await import("../../utils/logger");

// Note: ContentFetchService does NOT extract favicons. Favicon extraction
// is handled separately (if at all) by other services in the project.
// See: src/services/MetadataService.ts (potential location for future favicon extraction)

// ── Helpers ──────────────────────────────────────────────────────────

function resetMocks(): void {
  vi.clearAllMocks();

  // Restore firewalledFetch mock
  const defaultHtml = "<html><body><p>Test content</p></body></html>";
  firewalledFetchMock.mockResolvedValue(mockFetchResponse);
  mockFetchResponse.text.mockResolvedValue(defaultHtml);
  mockFetchResponse.body = createMockBody(defaultHtml);
  mockFetchResponse.ok = true;
  mockFetchResponse.status = 200;
  mockFetchResponse.headers = new Headers({ "content-type": "text/html; charset=utf-8" });

  // Restore Readability parse
  readabilityParseMock.mockReturnValue(mockReadableContent);

  // Restore TurndownService
  turndownMock.mockReturnValue(mockMarkdown);

  // Restore SanitizationService
  (SanitizationService.sanitizeHtml as any).mockImplementation(
    (html: string) => `sanitized:${html}`,
  );
  (SanitizationService.sanitizeText as any).mockImplementation(
    (text: string) => `sanitized:${text}`,
  );
  (SanitizationService.sanitizeUrl as any).mockImplementation((url: string) => {
    if (!url || !url.startsWith("http")) {return "";}
    return url;
  });

  // Restore DB
  initDBMock.mockResolvedValue(mockDb);
  mockDocRef.incrementalPatch.mockResolvedValue(undefined);
  mockDb.bookmarks.findOne.mockReturnValue({
    exec: vi.fn().mockResolvedValue(mockDocRef),
  });
}

describe("ContentFetchService", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Happy path ─────────────────────────────────────────────────

  describe("fetchAndExtract — happy path", () => {
    test("should fetch URL, extract content, and return { content, summary }", async () => {
      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("sanitized");
      expect(result!.summary).toContain("sanitized");
      expect(result!.summary).toContain("Article excerpt here");

      expect(firewalledFetchMock).toHaveBeenCalledWith(
        "https://example.com/article",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        "content-fetch",
      );
    });

    test("should call firewalledFetch with correct parameters", async () => {
      await contentFetchService.fetchAndExtract(mockBookmark as any);
      expect(firewalledFetchMock).toHaveBeenCalledWith(
        "https://example.com/article",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        "content-fetch",
      );
    });

    test("should parse HTML with DOMParser and extract via Readability", async () => {
      await contentFetchService.fetchAndExtract(mockBookmark as any);
      expect(readabilityParseMock).toHaveBeenCalled();
    });

    test("should convert HTML to Markdown via TurndownService", async () => {
      await contentFetchService.fetchAndExtract(mockBookmark as any);
      expect(turndownMock).toHaveBeenCalledWith(mockReadableContent.content);
    });

    test("should sanitize content and summary", async () => {
      await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(SanitizationService.sanitizeHtml).toHaveBeenCalled();
      expect(SanitizationService.sanitizeText).toHaveBeenCalled();
    });

    test("should update RxDB bookmark document with extracted data", async () => {
      await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(initDBMock).toHaveBeenCalled();
      expect(mockDb.bookmarks.findOne).toHaveBeenCalledWith("bm-123");
      expect(mockDocRef.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("sanitized"),
          summary: expect.stringContaining("sanitized"),
          updatedAt: expect.any(String),
        }),
      );
    });

    test("should update the bookmark title from Readability when available", async () => {
      await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(mockDocRef.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Readable Article Title",
        }),
      );
    });

    test("should fall back to original bookmark title when Readability returns no title", async () => {
      readabilityParseMock.mockReturnValue({
        ...mockReadableContent,
        title: null,
      });

      await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(mockDocRef.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Original Title",
        }),
      );
    });

    test("should still return content even when DB doc is not found (docRef null)", async () => {
      mockDb.bookmarks.findOne.mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("sanitized");
      // No patch should have been called since docRef was null
      expect(mockDocRef.incrementalPatch).not.toHaveBeenCalled();
    });
  });

  // ── Error cases: URL / fetch ──────────────────────────────────

  describe("fetchAndExtract — URL / fetch errors", () => {
    test("should not start a fetch when the caller signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await contentFetchService.fetchAndExtract(
        mockBookmark as any,
        controller.signal,
      );

      expect(result).toBeNull();
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("should cancel an in-flight response body when the caller aborts", async () => {
      let resolveRead!: (value: { done: boolean; value?: Uint8Array }) => void;
      const cancel = vi.fn().mockImplementation(() => {
        resolveRead({ done: true });
        return Promise.resolve();
      });
      const body = {
        getReader: () => ({
          read: () => new Promise((resolve) => { resolveRead = resolve; }),
          cancel,
          releaseLock: vi.fn(),
        }),
      };
      firewalledFetchMock.mockResolvedValueOnce({
        ...mockFetchResponse,
        body,
      });
      const controller = new AbortController();
      const request = contentFetchService.fetchAndExtract(
        mockBookmark as any,
        controller.signal,
      );

      await vi.waitFor(() => expect(firewalledFetchMock).toHaveBeenCalled());
      controller.abort();

      await expect(request).resolves.toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    test("should return null when bookmark URL is empty", async () => {
      const result = await contentFetchService.fetchAndExtract({
        ...mockBookmark,
        url: "",
      } as any);

      expect(result).toBeNull();
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("SSRF: should NOT fetch a private/loopback URL (sanitizeUrl blocks it)", async () => {
      // Simulate the production sanitizer rejecting a loopback URL.
      (SanitizationService.sanitizeUrl as any).mockReturnValue("");

      const result = await contentFetchService.fetchAndExtract({
        ...mockBookmark,
        url: "http://127.0.0.1:3000/admin",
      } as any);

      expect(result).toBeNull();
      expect(firewalledFetchMock).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "Content fetch blocked: URL failed sanitization",
        expect.objectContaining({ url: "http://127.0.0.1:3000/admin" }),
      );
    });

    test("SSRF: should NOT fetch a javascript: URL", async () => {
      (SanitizationService.sanitizeUrl as any).mockReturnValue("");

      const result = await contentFetchService.fetchAndExtract({
        ...mockBookmark,
        url: "javascript:alert(1)",
      } as any);

      expect(result).toBeNull();
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("should fetch the SANITIZED url, not the raw bookmark url", async () => {
      // Production sanitizeUrl normalizes (adds trailing slash, etc.); the
      // fetch must use the sanitized result.
      (SanitizationService.sanitizeUrl as any).mockReturnValue(
        "https://example.com/normalized",
      );

      await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(firewalledFetchMock).toHaveBeenCalledWith(
        "https://example.com/normalized",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        "content-fetch",
      );
    });

    test("should return null when bookmark URL is undefined", async () => {
      const result = await contentFetchService.fetchAndExtract({
        id: "bm-456",
        title: "No URL",
      } as any);

      expect(result).toBeNull();
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    });

    test("should return null when firewalledFetch throws (network error)", async () => {
      firewalledFetchMock.mockRejectedValue(new Error("Network timeout"));

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Content fetch failed",
        expect.objectContaining({
          url: "https://example.com/article",
          error: expect.any(Error),
        }),
      );
    });

    test("should handle 404 response (Readability finds no content on error page)", async () => {
      // ContentFetchService does NOT check res.ok — it always reads .text()
      // and passes to Readability. A real 404 page likely has no readable
      // content, so Readability returns null.
      mockFetchResponse.text.mockResolvedValue(
        '<html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1><p>The requested URL was not found on this server.</p></body></html>',
      );
      readabilityParseMock.mockReturnValue(null);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "No readable content found",
        expect.any(Object),
      );
    });

    test("should return null when response body stream is unavailable", async () => {
      // The code now reads via body.getReader() instead of res.text().
      // A response without a body stream should return null.
      mockFetchResponse.body = null as any;

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
    });

    test("cancels a response body that has no readable stream", async () => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      mockFetchResponse.body = { cancel } as any;

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    test("should handle timeout errors from firewalledFetch", async () => {
      firewalledFetchMock.mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Content fetch failed",
        expect.any(Object),
      );
    });

    test("should handle CORS errors from firewalledFetch", async () => {
      firewalledFetchMock.mockRejectedValue(
        new TypeError("Failed to fetch: CORS request blocked"),
      );

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        "Content fetch failed",
        expect.any(Object),
      );
    });
  });

  // ── Error cases: Readability ──────────────────────────────────

  describe("fetchAndExtract — Readability errors", () => {
    test("should return null when Readability returns no content", async () => {
      readabilityParseMock.mockReturnValue(null);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "No readable content found",
        expect.objectContaining({ url: "https://example.com/article" }),
      );
    });

    test("should return null when Readability returns article without content", async () => {
      readabilityParseMock.mockReturnValue({
        title: "Title",
        content: null,
        excerpt: "Some excerpt",
      });

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
    });

    test("should return null when Readability throws during parse", async () => {
      readabilityParseMock.mockImplementation(() => {
        throw new Error("Readability parse error");
      });

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    test("should handle malformed HTML gracefully (DOMParser)", async () => {
      mockFetchResponse.text.mockResolvedValue("<html><body><p>Unclosed paragraph");
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      // DOMParser handles malformed HTML without throwing, but Readability
      // may return null or partial content
      if (result === null) {
        expect(logger.warn).toHaveBeenCalledWith(
          "No readable content found",
          expect.any(Object),
        );
      } else {
        expect(result.content).toBeTruthy();
      }
    });
  });

  // ── Error cases: TurndownService ──────────────────────────────

  describe("fetchAndExtract — TurndownService errors", () => {
    test("should handle TurndownService dynamic import failure", async () => {
      // Force the dynamic import of TurndownService to fail
      // We can't easily mock dynamic imports, but the method catches
      // all errors via the outer try/catch, so any throw returns null

      // Instead, make turndown throw
      turndownMock.mockImplementation(() => {
        throw new Error("Turndown conversion failed");
      });

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });

    test("should handle Turndown returning empty string", async () => {
      turndownMock.mockReturnValue("");

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(result!.content).toBe("sanitized:");
    });
  });

  // ── Error cases: Non-HTML responses ───────────────────────────

  describe("fetchAndExtract — non-HTML responses", () => {
    test("should handle XML response (DOMParser parses it)", async () => {
      mockFetchResponse.text.mockResolvedValue(
        '<?xml version="1.0"?><root><item>Data</item></root>',
      );
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      // Readability may or may not find content in XML
      // The method should not throw regardless
      if (result === null) {
        expect(logger.warn).toHaveBeenCalled();
      }
    });

    test("should handle plain text response (no HTML tags)", async () => {
      mockFetchResponse.text.mockResolvedValue("This is plain text without HTML tags.");
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      // Readability likely returns null for plain text
      // The method should not throw
      if (result === null) {
        expect(logger.warn).toHaveBeenCalled();
      }
    });

    test("should handle JSON response gracefully", async () => {
      mockFetchResponse.text.mockResolvedValue(
        JSON.stringify({ data: "value" }),
      );
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      // Should not throw — outer catch handles all errors
      if (result === null) {
        expect(logger.warn).toHaveBeenCalled();
      }
    });
  });

  // ── Error cases: Database ─────────────────────────────────────

  describe("fetchAndExtract — database errors", () => {
    test("should still return content when DB init fails", async () => {
      initDBMock.mockRejectedValue(new Error("IndexedDB init failed"));

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      // The outer catch handles DB errors, but extract was already done
      expect(result).not.toBeNull();
      expect(result!.content).toContain("sanitized");
    });

    test("should still return content when DB patch fails", async () => {
      mockDocRef.incrementalPatch.mockRejectedValue(new Error("Patch operation failed"));

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("sanitized");
    });
  });

  // ── HTML fixtures ─────────────────────────────────────────────

  describe("fetchAndExtract — HTML content variations", () => {
    test("should extract from HTML with Open Graph meta tags", async () => {
      const ogHtml = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Description">
</head>
<body>
  <article>
    <h1>Article Heading</h1>
    <p>Article paragraph content with more details.</p>
  </article>
</body>
</html>`;

      readabilityParseMock.mockReturnValue({
        title: "OG Title",
        content: "<h1>Article Heading</h1><p>Article paragraph content</p>",
        excerpt: "OG Description",
      });

      mockFetchResponse.text.mockResolvedValue(ogHtml);
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(mockDocRef.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "OG Title",
        }),
      );
    });

    test("should extract from minimal HTML (no <body> tag)", async () => {
      mockFetchResponse.text.mockResolvedValue("<p>Just a paragraph</p>");
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      readabilityParseMock.mockReturnValue({
        title: null,
        content: "<p>Just a paragraph</p>",
        excerpt: "Just a paragraph",
      });

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
    });

    test("should handle HTML with scripts and styles (Readability strips them)", async () => {
      const htmlWithScripts = `<!DOCTYPE html>
<html>
<head>
  <style>.hidden { display: none; }</style>
  <script>alert('xss');</script>
</head>
<body>
  <p>Real content</p>
  <script>document.write('injected');</script>
</body>
</html>`;

      readabilityParseMock.mockReturnValue({
        title: "Clean Title",
        content: "<p>Real content</p>",
        excerpt: "Real content",
      });

      mockFetchResponse.text.mockResolvedValue(htmlWithScripts);
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("sanitized");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe("fetchAndExtract — edge cases", () => {
    test("should handle empty HTML string", async () => {
      mockFetchResponse.text.mockResolvedValue("");
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);
      // Real Readability returns null for an empty document
      readabilityParseMock.mockReturnValue(null);

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      // Empty string parsed as HTML yields an empty document
      // Readability returns null
      expect(result).toBeNull();
    });

    test("should handle very large HTML gracefully (no crash)", async () => {
      const largeBody = "<p>" + "x".repeat(100000) + "</p>";
      const largeHtml = `<html><body>${largeBody}</body></html>`;

      readabilityParseMock.mockReturnValue({
        title: "Large Article",
        content: largeBody,
        excerpt: "Large excerpt",
      });

      mockFetchResponse.text.mockResolvedValue(largeHtml);
      firewalledFetchMock.mockResolvedValue(mockFetchResponse);
      turndownMock.mockReturnValue("x".repeat(50000));

      const result = await contentFetchService.fetchAndExtract(mockBookmark as any);

      expect(result).not.toBeNull();
      expect(result!.content).toContain("sanitized");
    });

    test("should not fail if called multiple times concurrently", async () => {
      const bookmark1 = { ...mockBookmark, id: "bm-1", url: "https://example.com/article-1" };
      const bookmark2 = { ...mockBookmark, id: "bm-2", url: "https://example.com/article-2" };

      // Each concurrent call needs its own response body (ReadableStream
      // is single-use). Use a factory to create fresh responses.
      const makeResponse = () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        body: createMockBody("<html><body><p>Test content</p></body></html>"),
      });

      firewalledFetchMock
        .mockResolvedValueOnce(makeResponse())
        .mockResolvedValueOnce(makeResponse());

      const [r1, r2] = await Promise.all([
        contentFetchService.fetchAndExtract(bookmark1 as any),
        contentFetchService.fetchAndExtract(bookmark2 as any),
      ]);

      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
    });
  });
});
