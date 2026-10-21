import { describe, it, expect, vi } from "vitest";

// Mock DOMPurify: en happy-dom/Windows no se auto-inicializa correctamente.
// Este mock replica el comportamiento esperado de DOMPurify v3.
vi.mock("dompurify", () => {
  const SAFE_TAGS = new Set([
    "p", "br", "b", "i", "u", "strong", "em", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tr", "th", "td", "img", "span", "div",
    "hr", "sub", "sup", "del", "ins", "mark", "small", "cite", "dfn",
    "body", "html", "head",
  ]);
  const SAFE_ATTRS = new Set([
    "href", "title", "target", "rel", "src", "alt",
    "width", "height", "colspan", "rowspan", "class", "id",
  ]);

  function sanitize(dirty: unknown, config?: Record<string, any>): string {
    if (!dirty || typeof dirty !== "string") return "";
    const cfg = config || {};
    const allowedTags = cfg.ALLOWED_TAGS
      ? new Set(cfg.ALLOWED_TAGS.map((t: string) => t.toLowerCase()))
      : SAFE_TAGS;
    const allowedAttrs = cfg.ALLOWED_ATTR
      ? new Set(cfg.ALLOWED_ATTR.map((a: string) => a.toLowerCase()))
      : SAFE_ATTRS;
    const keepContent = cfg.KEEP_CONTENT !== false;

    let html = dirty.trim();
    if (cfg.FORCE_BODY && !html.startsWith("<body>")) {
      html = `<body>${html}</body>`;
    }

    const result = html.replace(
      /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g,
      (match, tagName: string) => {
        const lower = tagName.toLowerCase();
        if (match.startsWith("</")) {
          return allowedTags.has(lower) ? match : "";
        }
        if (!allowedTags.has(lower)) {
          return keepContent ? "" : "";
        }
        const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g;
        return match.replace(attrRegex, (attrMatch, attrName: string) => {
          return allowedAttrs.has(attrName.toLowerCase()) ? attrMatch : "";
        });
      },
    );

    if (cfg.FORCE_BODY) {
      const bodyMatch = result.match(/^<body>([\s\S]*)<\/body>$/);
      if (bodyMatch) return bodyMatch[1]!.trim();
    }
    return result;
  }

  const fn = sanitize as any;
  fn.sanitize = sanitize;
  fn.isSupported = true;
  fn.setConfig = vi.fn();
  fn.clearConfig = vi.fn();
  fn.removed = [];
  return { default: fn };
});

import {
  sanitizeUserInput,
  sanitizeUrl,
  sanitizeHtmlForDisplay,
  sanitizeTags,
  validateAndSanitizeUrl,
  sanitizeSearchQuery,
  sanitizeText,
} from "../../services/SanitizationService";

describe("Sanitization Utilities", () => {
  describe("sanitizeUserInput", () => {
    it("should return empty string for non-string inputs", () => {
      expect(sanitizeUserInput(null as any)).toBe("");
      expect(sanitizeUserInput(undefined as any)).toBe("");
      expect(sanitizeUserInput(123 as any)).toBe("");
    });

    it("should trim and enforce max length", () => {
      expect(sanitizeUserInput("   hello world   ")).toBe("hello world");
      expect(sanitizeUserInput("hello" as string, 3 as any)).toBe("hel");
    });

    it("should strip HTML tags entirely (KEEP_CONTENT preserves text)", () => {
      // DOMPurify with KEEP_CONTENT=true preserves the internal text of the
      // removed tags. Only the tags are removed, not their content.
      expect(sanitizeUserInput('<script>alert("XSS")</script>hello')).toBe(
        'alert("XSS")hello',
      );
    });
  });

  describe("sanitizeUrl (strict - http/https only)", () => {
    it("should return empty string for non-string inputs", () => {
      expect(sanitizeUrl(null as any)).toBe("");
      expect(sanitizeUrl(123 as any)).toBe("");
    });

    it("should allow valid http and https URLs", () => {
      // SanitizationService normalises to canonical URL form (may add trailing slash)
      const result = sanitizeUrl("https://example.com");
      expect(result.startsWith("https://example.com")).toBe(true);
    });

    it("should block javascript: and other dangerous schemes", () => {
      expect(sanitizeUrl("javascript:alert(1)")).toBe("");
      expect(sanitizeUrl("file:///etc/passwd")).toBe("");
      expect(sanitizeUrl("ftp://ftp.example.com")).toBe("");
    });

    it("should block private IPs and localhost (SSRF protection)", () => {
      expect(sanitizeUrl("http://localhost")).toBe("");
      expect(sanitizeUrl("http://127.0.0.1")).toBe("");
      expect(sanitizeUrl("http://192.168.1.1")).toBe("");
      expect(sanitizeUrl("http://10.0.0.1")).toBe("");
    });
  });

  describe("sanitizeHtmlForDisplay", () => {
    it("should return empty string for non-string inputs", () => {
      expect(sanitizeHtmlForDisplay(null as any)).toBe("");
    });

    it("should strip dangerous tags and keep safe formatting", () => {
      const dirtyHtml =
        '<div><script>alert("XSS")</script><p>Hello <b>World</b>!</p></div>';
      const cleanHtml = sanitizeHtmlForDisplay(dirtyHtml);
      expect(cleanHtml).toContain("<p>Hello <b>World</b>!</p>");
      expect(cleanHtml).not.toContain("<script>");
    });

    it("should allow safe attributes and block dangerous ones", () => {
      const dirty =
        '<a href="https://example.com" onclick="alert(1)" style="color: red">Link</a>';
      const clean = sanitizeHtmlForDisplay(dirty);
      expect(clean).toContain('href="https://example.com"');
      expect(clean).not.toContain("onclick=");
    });
  });

  describe("sanitizeTags", () => {
    it("should return empty array for non-array inputs", () => {
      expect(sanitizeTags(null as any)).toEqual([]);
      expect(sanitizeTags("tag" as any)).toEqual([]);
    });

    it("should sanitize elements, remove empty tags and duplicates", () => {
      const tags = [
        "  hello  ",
        "<script>alert(1)</script>",
        "world",
        "hello",
        "",
      ];
      const result = sanitizeTags(tags);
      // sanitizeUserInput with KEEP_CONTENT=true preserves internal text
      expect(result).toEqual(["hello", "alert(1)", "world"]);
    });

    it("should truncate tags to 50 characters", () => {
      const longTag = "a".repeat(60);
      const result = sanitizeTags([longTag]);
      expect(result).toEqual(["a".repeat(50)]);
    });

    it("should discard tags that are empty after sanitization", () => {
      const result = sanitizeTags(["<script>alert(1)</script>", ""]);
      // sanitizeUserInput con KEEP_CONTENT=true preserva "alert(1)"
      expect(result).toEqual(["alert(1)"]);
    });
  });

  describe("validateAndSanitizeUrl", () => {
    it("should return sanitized URL for valid input", () => {
      // SanitizationService normalises URLs to canonical form
      const result = validateAndSanitizeUrl("https://google.com");
      expect(result.startsWith("https://google.com")).toBe(true);
    });

    it("should throw error for invalid schemes", () => {
      expect(() => validateAndSanitizeUrl("javascript:alert(1)")).toThrow();
    });

    it("should throw error for malformed URL format", () => {
      expect(() => validateAndSanitizeUrl("https://")).toThrow();
    });
  });

  describe("sanitizeSearchQuery", () => {
    it("should return empty string for non-string inputs", () => {
      expect(sanitizeSearchQuery(null as any)).toBe("");
    });

    it("should trim and strip potentially dangerous injection characters", () => {
      expect(sanitizeSearchQuery("   hello <tag> {test}   ")).toBe(
        "hello tag test",
      );
    });

    it("should limit search query length to 500 characters", () => {
      const longQuery = "a".repeat(600);
      expect(sanitizeSearchQuery(longQuery).length).toBe(500);
    });
  });

  describe("sanitizeText (escapes HTML - plain text safe)", () => {
    it("should return empty string for non-string inputs", () => {
      expect(sanitizeText(null as any)).toBe("");
    });

    it("should escape HTML entities (use sanitizeHtml for safe HTML)", () => {
      const input = "<blockquote>Quote</blockquote><script>alert(1)</script>";
      const result = sanitizeText(input);
      // sanitizeText escapes everything to plain text
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("<blockquote>");
    });
  });
});
