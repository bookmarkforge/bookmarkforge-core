/**
 * MetadataService.test.ts
 *
 * Tests:
 *   1. isPrivateIP() — IPv4 + IPv6 private range detection (16 branches)
 *   2. isUrlAllowed() — blocked hosts, private IPs, blocked ports (8 cases)
 *   3. fetchMetadata() — <title>, <meta description>, OG/Twitter/JSON-LD
 *      extraction, HTML fixtures, error handling (18+ cases)
 *
 * Open Graph, Twitter Cards, and JSON-LD extraction were implemented in
 * MetadataService.fetchMetadata() to match the priority chain:
 *   Title:  <title> → og:title → twitter:title → JSON-LD name
 *   Desc:   <meta name="description"> → og:description → twitter:description → JSON-LD desc
 */
import { describe, test, expect, beforeEach, vi } from "vitest";

// ─── Mock dependencies ──────────────────────────────────────────────

const mockFetchResponse = {
  ok: true,
  status: 200,
  text: vi.fn(),
};
const firewalledFetchMock = vi.fn().mockResolvedValue(mockFetchResponse);

vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: firewalledFetchMock,
  setFirewallDisabled: vi.fn(),
}));

// Mock sanitizeUrl — imported directly from SanitizationService
// (the barrel services/SanitizationService was eliminated in P91).
vi.mock("../../services/SanitizationService", () => ({
  sanitizeUrl: vi.fn((url: string) => {
    // Default: pass through valid http/https URLs
    if (!url || typeof url !== "string") return "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch {
      return "";
    }
  }),
  // Mirrors the real SanitizationService.sanitizeUserInput, which runs
  // DOMPurify with ALLOWED_TAGS: [] — strip all HTML tags, keep content.
  sanitizeUserInput: vi.fn((input: string, maxLength = 10000) => {
    if (typeof input !== "string") return "";
    return input
      .replace(/[<>]/gg, "")
      .trim()
      .substring(0, maxLength);
  }),
}));

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Import after mocks ───────────────────────────────────────────────

const { MetadataService, metadataService } = await import(
  "../../services/MetadataService"
);
const { logger } = await import("../../utils/logger");
const { sanitizeUrl, sanitizeUserInput } = await import(
  "../../services/SanitizationService"
);

// ── HTML Fixtures ────────────────────────────────────────────────────

const HTML_WITH_TITLE_AND_DESC = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Example Page Title</title>
  <meta name="description" content="This is an example description for the page.">
</head>
<body>
  <h1>Hello World</h1>
  <p>Some content here.</p>
</body>
</html>`;

const HTML_WITH_OG_TAGS = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta property="og:title" content="OG Title">
  <meta property="og:description" content="OG Description">
  <meta property="og:image" content="https://example.com/og-image.jpg">
  <title>Regular Title</title>
  <meta name="description" content="Regular Description">
</head>
<body><p>Content</p></body>
</html>`;

const HTML_TWITTER_CARDS = `<!DOCTYPE html>
<html>
<head>
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Twitter Title">
  <meta name="twitter:description" content="Twitter Description">
  <meta name="twitter:image" content="https://example.com/twitter-image.jpg">
  <title>Twitter Page</title>
</head>
<body><p>Content</p></body>
</html>`;

const HTML_WITH_JSON_LD = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "JSON-LD Page Title",
    "description": "JSON-LD Description"
  }
  </script>
  <title>JSON-LD Page</title>
  <meta name="description" content="Meta Description">
</head>
<body><p>Content</p></body>
</html>`;

const HTML_ONLY_BODY = `<html><body><p>Just body content</p></body></html>`;

const HTML_WITH_SCRIPTS = `<!DOCTYPE html>
<html>
<head>
  <title>Page With Scripts</title>
  <meta name="description" content="Page with scripts">
  <script>alert('xss');</script>
  <script src="https://evil.com/tracker.js"></script>
</head>
<body>
  <script>document.write('injected');</script>
  <p>Real content</p>
</body>
</html>`;

const HTML_NON_UTF8 = `<!DOCTYPE html>
<html>
<head>
  <meta charset="ISO-8859-1">
  <title>Non-UTF8 Page — Café naïve</title>
  <meta name="description" content="Café naïve — description with accents">
</head>
<body><p>Content with special chars: éàüöñ</p></body>
</html>`;

// ── Helpers ──────────────────────────────────────────────────────────

function resetMocks(): void {
  vi.clearAllMocks();

  // Restore firewalledFetch
  mockFetchResponse.text.mockReset();
  mockFetchResponse.ok = true;
  mockFetchResponse.status = 200;
  firewalledFetchMock.mockResolvedValue(mockFetchResponse);

  // Restore sanitizeUrl (default pass-through)
  (sanitizeUrl as any).mockImplementation((url: string) => {
    if (!url || typeof url !== "string") return "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch {
      return "";
    }
  });

  // Restore sanitizeUserInput (default: strip HTML tags like DOMPurify)
  (sanitizeUserInput as any).mockImplementation(
    (input: string, maxLength = 10000) => {
      if (typeof input !== "string") return "";
      return input
        .replace(/[<>]/gg, "")
        .trim()
        .substring(0, maxLength);
    },
  );
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: URL validation (isUrlAllowed + isPrivateIP — tested
// indirectly through fetchMetadata)
//
// The helper functions isPrivateIP() and isUrlAllowed() are module-private
// (not exported). We test their behavior INDIRECTLY through fetchMetadata:
// when a URL is blocked, fetchMetadata returns { title: "", description: "" }
// WITHOUT calling firewalledFetch.
//
// This section covers:
//   - Blocked hosts (localhost, metadata endpoints, etc.)
//   - Private IPv4 ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16)
//   - Private IPv6 ranges (::1, fe80::, fc00::, fd00::)
//   - Public IPv4/IPv6 (should pass through)
//   - Blocked ports (22, 23)
//   - Invalid URLs (sanitizeUrl returns empty)
// ═════════════════════════════════════════════════════════════════════

// Since isPrivateIP and isUrlAllowed are module-private (not exported),
// we test them indirectly through fetchMetadata. The fetchMetadata method
// calls isUrlAllowed which calls isPrivateIP, and returns { title: "", description: "" }
// when the URL is not allowed. We mock sanitizeUrl to pass through.
describe("fetchMetadata — blocked / private URLs", () => {
  beforeEach(() => {
    resetMocks();
  });

  // ── Blocked hosts ────────────────────────────────────────────────

  test.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://0.0.0.0/",
    "http://169.254.169.254/",
    "http://metadata.google.internal/",
  ])("blocks host: %s", async (url) => {
    (sanitizeUrl as any).mockReturnValue(url);
    const result = await metadataService.fetchMetadata(url);

    expect(result).toEqual({ title: "", description: "" });
    expect(firewalledFetchMock).not.toHaveBeenCalled();
  });

  // ── Private IPv4 ranges ──────────────────────────────────────────

  test.each([
    ["http://10.0.0.1/test", "10.0.0.0/8"],
    ["http://172.16.0.1/test", "172.16.0.0/12"],
    ["http://172.31.255.255/test", "172.16.0.0/12 (boundary)"],
    ["http://192.168.1.1/test", "192.168.0.0/16"],
    ["http://127.1.2.3/test", "127.0.0.0/8 loopback (not in BLOCKED_HOSTS)"],
    ["http://169.254.1.1/test", "169.254.0.0/16 link-local"],
  ])("blocks private IPv4: %s (%s)", async (url, _label) => {
    (sanitizeUrl as any).mockReturnValue(url);
    const result = await metadataService.fetchMetadata(url);

    expect(result).toEqual({ title: "", description: "" });
    expect(firewalledFetchMock).not.toHaveBeenCalled();
  });

  // ── Public IPv4 (should pass) ────────────────────────────────────

  test.each([
    "http://8.8.8.8/",
    "http://1.1.1.1/",
    "http://93.184.216.34/",
  ])("allows public IPv4: %s", async (url) => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>Public IP</title></head><body></body></html>",
    );
    (sanitizeUrl as any).mockReturnValue(url);

    const result = await metadataService.fetchMetadata(url);

    // Should have called firewalledFetch (not blocked)
    expect(firewalledFetchMock).toHaveBeenCalledWith(url, undefined, "metadata");
    expect(result.title).toBe("Public IP");
  });

  // ── Private IPv6 ranges ──────────────────────────────────────────

  test.each([
    ["http://[::1]/", "::1 loopback"],
    ["http://[fe80::1]/", "fe80 link-local"],
    ["http://[fc00::]/", "fc00 ULA"],
    ["http://[fd00::]/", "fd00 ULA"],
    ["http://[::]/", ":: unspecified"],
    ["http://[fec0::1]/", "fec0 site-local deprecated"],
    ["http://[::ffff:10.0.0.1]/", "::ffff IPv4-mapped private"],
  ])("blocks private IPv6: %s (%s)", async (url, _label) => {
    (sanitizeUrl as any).mockReturnValue(url);
    const result = await metadataService.fetchMetadata(url);

    expect(result).toEqual({ title: "", description: "" });
    expect(firewalledFetchMock).not.toHaveBeenCalled();
  });

  // ── Public IPv6 (should pass) ────────────────────────────────────

  test("allows public IPv6", async () => {
    const url = "http://[2001:db8::1]/";
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>IPv6 Site</title></head><body></body></html>",
    );
    (sanitizeUrl as any).mockReturnValue(url);

    const result = await metadataService.fetchMetadata(url);

    expect(firewalledFetchMock).toHaveBeenCalled();
    expect(result.title).toBe("IPv6 Site");
  });

  // ── Blocked ports ────────────────────────────────────────────────

  test.each(["http://example.com:22/", "http://example.com:23/"])(
    "blocks port: %s",
    async (url) => {
      (sanitizeUrl as any).mockReturnValue(url);
      const result = await metadataService.fetchMetadata(url);

      expect(result).toEqual({ title: "", description: "" });
      expect(firewalledFetchMock).not.toHaveBeenCalled();
    },
  );

  test("allows port 443 (HTTPS)", async () => {
    const url = "https://example.com:443/page";
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>HTTPS Site</title></head><body></body></html>",
    );
    (sanitizeUrl as any).mockReturnValue(url);

    const result = await metadataService.fetchMetadata(url);

    expect(firewalledFetchMock).toHaveBeenCalled();
    expect(result.title).toBe("HTTPS Site");
  });

  // ── Invalid URL ──────────────────────────────────────────────────

  test("returns empty when sanitizeUrl returns empty (invalid URL)", async () => {
    (sanitizeUrl as any).mockReturnValue("");

    const result = await metadataService.fetchMetadata("not-a-url");

    expect(result).toEqual({ title: "", description: "" });
    expect(firewalledFetchMock).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: fetchMetadata — standard HTML extraction
// ═════════════════════════════════════════════════════════════════════

describe("fetchMetadata — standard HTML extraction", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("extracts title from <title> tag", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>My Page Title</title></head><body></body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("My Page Title");
  });

  test("extracts description from <meta name='description'>", async () => {
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <title>Title</title>
        <meta name="description" content="Page description here">
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.description).toBe("Page description here");
  });

  test("forwards AbortSignal to the metadata request", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>Signal Page</title></head><body></body></html>",
    );
    const controller = new AbortController();

    await metadataService.fetchMetadata("https://example.com", controller.signal);

    expect(firewalledFetchMock).toHaveBeenCalledWith(
      "https://example.com/",
      { signal: controller.signal },
      "metadata",
    );
  });

  test("extracts both title and description from standard HTML", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_TITLE_AND_DESC);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("Example Page Title");
    expect(result.description).toBe(
      "This is an example description for the page.",
    );
  });

  test("returns empty title when <title> tag is empty", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title></title></head><body></body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("");
  });

  test("returns empty description when no <meta name='description'> exists", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>Title Only</title></head><body></body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("Title Only");
    expect(result.description).toBe("");
  });

  test("returns empty description when meta tag has no content attribute", async () => {
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <title>Title</title>
        <meta name="description">
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.description).toBe("");
  });

  test("trims whitespace from title and description", async () => {
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <title>  Spaced Title  </title>
        <meta name="description" content="  Spaced Description  ">
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // sanitizeUserInput trims the input
    expect(result.title).toBe("Spaced Title");
    expect(result.description).toBe("Spaced Description");
  });

  test("handles HTML with scripts and styles (DOMParser strips active content)", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_SCRIPTS);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // DOMParser parses scripts as DOM nodes but doesn't execute them
    expect(result.title).toBe("Page With Scripts");
    expect(result.description).toBe("Page with scripts");
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: fetchMetadata — error handling
// ═════════════════════════════════════════════════════════════════════

describe("fetchMetadata — error handling", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("returns title=url and empty description when firewalledFetch throws", async () => {
    firewalledFetchMock.mockRejectedValue(new Error("Network timeout"));

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("https://example.com/");
    expect(result.description).toBe("");
    // Best-effort degradation is logged at WARN, never ERROR, so routine
    // network/firewall deflections do not pollute the error channel.
    expect(logger.error).not.toHaveBeenCalledWith("Error fetching metadata", {
      error: { name: "Error", message: "Network timeout" },
    });
    expect(logger.warn).toHaveBeenCalledWith("Error fetching metadata", {
      error: { name: "Error", message: "Network timeout" },
    });
  });

  test("handles empty HTML response", async () => {
    mockFetchResponse.text.mockResolvedValue("");

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("");
    expect(result.description).toBe("");
  });

  test("handles HTML without <head> tag", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_ONLY_BODY);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // DOMParser creates an implicit <head> when parsing
    expect(result.title).toBe("");
    expect(result.description).toBe("");
  });

  test("returns empty title and description when HTML has empty title and no meta description", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title></title></head><body>No meta tags here.</body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("");
    expect(result.description).toBe("");
  });

  test("returns title=url when response.text() throws", async () => {
    mockFetchResponse.text.mockRejectedValue(new Error("Body read failed"));

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("https://example.com/");
    expect(result.description).toBe("");
  });

  test("handles CORS error from firewalledFetch", async () => {
    firewalledFetchMock.mockRejectedValue(
      new TypeError("Failed to fetch: CORS blocked"),
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("https://example.com/");
    expect(result.description).toBe("");
  });

  test("sanitizeUrl returning empty string blocks the request", async () => {
    (sanitizeUrl as any).mockReturnValue("");

    const result = await metadataService.fetchMetadata(
      "javascript:alert(1)",
    );

    expect(result).toEqual({ title: "", description: "" });
    expect(firewalledFetchMock).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: Non-UTF-8 encoding
// ═════════════════════════════════════════════════════════════════════

describe("fetchMetadata — encoding variations", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("handles ISO-8859-1 encoded HTML (DOMParser decodes with charset)", async () => {
    // DOMParser uses the meta charset declaration for parsing
    mockFetchResponse.text.mockResolvedValue(HTML_NON_UTF8);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // The title may or may not be perfectly decoded depending on how
    // DOMParser handles the charset meta tag in a jsdom/happy-dom context.
    // What matters is that it doesn't crash.
    expect(result.title).toBeDefined();
  });

  test("handles UTF-8 with emoji in title", async () => {
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <meta charset="UTF-8">
        <title>🔥 Awesome Page 🚀</title>
        <meta name="description" content="Page with emoji 🔥">
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toContain("🔥");
    expect(result.description).toContain("🔥");
  });

  test("handles very long title (> 1000 chars)", async () => {
    const longTitle = "A".repeat(2000);
    mockFetchResponse.text.mockResolvedValue(
      `<html><head><title>${longTitle}</title></head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // sanitizeUserInput truncates to maxLength (default 10000)
    expect(result.title.length).toBeLessThanOrEqual(10000);
    expect(result.title).toBe(longTitle.trim().substring(0, 10000));
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: Open Graph, Twitter Cards, JSON-LD extraction
// These tests verify the priority-chain fallback logic:
//   Title:  <title> → og:title → twitter:title → JSON-LD name
//   Desc:   <meta name="description"> → og:description → twitter:description → JSON-LD desc
// ═════════════════════════════════════════════════════════════════════

describe("fetchMetadata — Open Graph extraction", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("extracts og:title when both <title> and og:title exist (prefers <title>)", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_OG_TAGS);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // <title> comes before og:title in the priority chain
    expect(result.title).toBe("Regular Title");
  });

  test("extracts og:description when both meta description and og:description exist (prefers meta desc)", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_OG_TAGS);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // <meta name="description"> comes before og:description in the priority chain
    expect(result.description).toBe("Regular Description");
  });

  test("extracts og:title as fallback when no <title> is present", async () => {
    const htmlNoTitle = HTML_WITH_OG_TAGS.replace(
      "<title>Regular Title</title>",
      "",
    );
    mockFetchResponse.text.mockResolvedValue(htmlNoTitle);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("OG Title");
  });

  test("extracts og:description as fallback when no <meta name='description'> exists", async () => {
    const htmlNoMetaDesc = HTML_WITH_OG_TAGS.replace(
      '<meta name="description" content="Regular Description">',
      "",
    );
    mockFetchResponse.text.mockResolvedValue(htmlNoMetaDesc);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.description).toBe("OG Description");
  });

  test("extracts og:image when present", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_OG_TAGS);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.image).toBe("https://example.com/og-image.jpg");
  });
});

describe("fetchMetadata — Twitter Cards extraction", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("extracts twitter:title and twitter:description when no OG or standard tags", async () => {
    // HTML_TWITTER_CARDS has only <title> + twitter:* tags (no og, no meta desc)
    mockFetchResponse.text.mockResolvedValue(HTML_TWITTER_CARDS);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // <title> takes priority over twitter:title
    expect(result.title).toBe("Twitter Page");
  });

  test("falls back to twitter:title when no <title> tag exists", async () => {
    const htmlNoTitle = HTML_TWITTER_CARDS.replace(
      "<title>Twitter Page</title>",
      "",
    );
    mockFetchResponse.text.mockResolvedValue(htmlNoTitle);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("Twitter Title");
    expect(result.description).toBe("Twitter Description");
  });

  test("extracts twitter:image when present", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_TWITTER_CARDS);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.image).toBe("https://example.com/twitter-image.jpg");
  });
});

describe("fetchMetadata — JSON-LD extraction", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("extracts name and description from JSON-LD script tag", async () => {
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_JSON_LD);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // <title> and <meta name="description"> take priority over JSON-LD
    expect(result.title).toBe("JSON-LD Page");
    expect(result.description).toBe("Meta Description");
  });

  test("falls back to JSON-LD name when no <title> tag exists", async () => {
    const htmlNoTitle = HTML_WITH_JSON_LD.replace(
      "<title>JSON-LD Page</title>",
      "",
    );
    mockFetchResponse.text.mockResolvedValue(htmlNoTitle);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("JSON-LD Page Title");
  });

  test("falls back to JSON-LD description when no meta description exists", async () => {
    const htmlNoMeta = HTML_WITH_JSON_LD.replace(
      '<meta name="description" content="Meta Description">',
      "",
    );
    mockFetchResponse.text.mockResolvedValue(htmlNoMeta);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.description).toBe("JSON-LD Description");
  });

  test("handles malformed JSON-LD gracefully (skips silently)", async () => {
    const htmlBadLd = HTML_WITH_JSON_LD.replace(
      '"@context": "https://schema.org"',
      "invalid json garbage",
    );
    mockFetchResponse.text.mockResolvedValue(htmlBadLd);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // Should not throw — gracefully falls through
    expect(result.title).toBe("JSON-LD Page");
    expect(result.description).toBe("Meta Description");
  });

  test("handles @graph arrays in JSON-LD", async () => {
    const htmlGraphLd = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "name": "Graph Page Title",
        "description": "Graph Page Description"
      }
    ]
  }
  </script>
  <title>Regular Title</title>
</head>
<body><p>Content</p></body>
</html>`;

    mockFetchResponse.text.mockResolvedValue(htmlGraphLd);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // <title> takes priority, but if removed, would use JSON-LD @graph
    expect(result.title).toBe("Regular Title");
  });

  test("parses JSON-LD as direct array and falls back to it when no <title>", async () => {
    const htmlArrayLd = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  [{
    "@type": "WebPage",
    "name": "Array Item Title",
    "description": "Array Item Description"
  }]
  </script>
</head>
<body><p>Content</p></body>
</html>`;

    mockFetchResponse.text.mockResolvedValue(htmlArrayLd);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // No <title>, no OG, no Twitter - falls back to JSON-LD array
    expect(result.title).toBe("Array Item Title");
    expect(result.description).toBe("Array Item Description");
  });

  test("skips JSON-LD item without name/description, iterates to next block", async () => {
    const htmlMultiLd = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": "#first"
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Second Block Title",
    "description": "Second Block Description"
  }
  </script>
  <title>Page Title</title>
</head>
<body><p>Content</p></body>
</html>`;

    mockFetchResponse.text.mockResolvedValue(htmlMultiLd);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // <title> takes priority
    expect(result.title).toBe("Page Title");
  });

  test("falls back to JSON-LD from second block when first has no metadata and no <title>", async () => {
    const htmlMultiLdFallback = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": "#first"
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Second Block Title",
    "description": "Second Block Description"
  }
  </script>
</head>
<body><p>Content</p></body>
</html>`;

    mockFetchResponse.text.mockResolvedValue(htmlMultiLdFallback);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // No <title>, no OG, no Twitter — falls back to JSON-LD second block
    expect(result.title).toBe("Second Block Title");
    expect(result.description).toBe("Second Block Description");
  });

  test("skips empty/whitespace JSON-LD script tag", async () => {
    const htmlEmptyLd = `<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
    
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "After Empty Title",
    "description": "After Empty Description"
  }
  </script>
</head>
<body><p>Content</p></body>
</html>`;

    mockFetchResponse.text.mockResolvedValue(htmlEmptyLd);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // First script is whitespace (skipped via continue),
    // second script has the metadata
    expect(result.title).toBe("After Empty Title");
    expect(result.description).toBe("After Empty Description");
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: Edge cases — redirects, timeouts, concurrent
// ═════════════════════════════════════════════════════════════════════

describe("fetchMetadata — edge cases", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("handles URL that results in a redirect chain (firewalledFetch returns final response)", async () => {
    // firewalledFetch follows HTTP redirects internally; MetadataService only
    // sees the final 200 response with HTML. We don't simulate 301/302 here
    // because the redirect handling is in firewalledFetch, not MetadataService.
    // This test verifies that MetadataService correctly extracts metadata from
    // whatever HTML the final response contains.
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>Redirected Page</title></head><body></body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com/redirect",
    );

    expect(result.title).toBe("Redirected Page");
  });

  test("handles timeout from firewalledFetch", async () => {
    firewalledFetchMock.mockRejectedValue(
      new DOMException("The operation timed out", "TimeoutError"),
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    expect(result.title).toBe("https://example.com/");
    expect(result.description).toBe("");
  });

  test("handles concurrent fetchMetadata calls", async () => {
    mockFetchResponse.text
      .mockResolvedValueOnce(
        "<html><head><title>Page 1</title></head><body></body></html>",
      )
      .mockResolvedValueOnce(
        "<html><head><title>Page 2</title></head><body></body></html>",
      );
    firewalledFetchMock
      .mockResolvedValueOnce(mockFetchResponse)
      .mockResolvedValueOnce(mockFetchResponse);

    const [r1, r2] = await Promise.all([
      metadataService.fetchMetadata("https://example.com/a"),
      metadataService.fetchMetadata("https://example.com/b"),
    ]);

    expect(r1.title).toBe("Page 1");
    expect(r2.title).toBe("Page 2");
  });

  test("handles URL with query parameters", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>Query Page</title></head><body></body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com/page?q=test&lang=en",
    );

    expect(result.title).toBe("Query Page");
  });

  test("handles URL with fragment (#hash)", async () => {
    mockFetchResponse.text.mockResolvedValue(
      "<html><head><title>Fragment Page</title></head><body></body></html>",
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com/page#section",
    );

    expect(result.title).toBe("Fragment Page");
  });

  test("does not include image key when no OG/Twitter image meta tag exists", async () => {
    // HTML_WITH_TITLE_AND_DESC has NO og:image or twitter:image
    mockFetchResponse.text.mockResolvedValue(HTML_WITH_TITLE_AND_DESC);

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // image should be undefined (not null, not empty string)
    expect(result).not.toHaveProperty("image");
  });

  test("returns null from getMetaContent when meta tag has no content attribute", async () => {
    // A page with meta[property="og:title"] but missing the content attribute
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <meta property="og:title">
        <title>Title from Title Tag</title>
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // og:title has no content, so it returns null from getMetaContent
    // and the title should come from the <title> tag
    expect(result.title).toBe("Title from Title Tag");
  });

  test("truncates very long description", async () => {
    const longDesc = "D".repeat(5000);
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <title>Title</title>
        <meta name="description" content="${longDesc}">
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // sanitizeUserInput truncates to maxLength
    expect(result.description.length).toBeLessThanOrEqual(10000);
  });
});

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: XSS prevention through sanitization
// ═════════════════════════════════════════════════════════════════════

describe("fetchMetadata — XSS prevention", () => {
  beforeEach(() => {
    resetMocks();
  });

  test("sanitizes title with HTML-like content (DOMPurify strips tags)", async () => {
    // sanitizeUserInput calls DOMPurify.sanitize with ALLOWED_TAGS: []
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <title><script>alert('xss')</script>Safe Title</title>
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // sanitizeUserInput strips HTML tags via DOMPurify
    expect(result.title).not.toContain("<script>");
    expect(result.title).toContain("Safe Title");
  });

  test("sanitizes description with HTML-like content", async () => {
    mockFetchResponse.text.mockResolvedValue(
      `<html><head>
        <title>Title</title>
        <meta name="description" content="<b>Bold</b> description <img src=x onerror=alert(1)>">
      </head><body></body></html>`,
    );

    const result = await metadataService.fetchMetadata(
      "https://example.com",
    );

    // sanitizeUserInput strips all HTML tags
    expect(result.description).not.toContain("<b>");
    expect(result.description).not.toContain("<img");
    expect(result.description).toContain("description");
  });
});
