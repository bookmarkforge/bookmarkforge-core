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
  SanitizationService,
  sanitizeUserInput,
  sanitizeTags,
  sanitizeSearchQuery,
} from "../../services/SanitizationService";

describe("SanitizationService", () => {
  describe("sanitizeHtml", () => {
    it("allows safe HTML tags", () => {
      const input = "<p>Hello <strong>world</strong></p>";
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).toContain("<p>");
      expect(result).toContain("<strong>");
    });

    it("strips script tags (KEEP_CONTENT preserva texto)", () => {
      const input = '<p>Hello</p><script>alert("xss")</script>';
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).not.toContain("<script>");
      // KEEP_CONTENT=true: the script's internal text is preserved as
      // harmless plain text (the tag no longer exists)
    });

    it("strips event handler attributes", () => {
      const input = '<a href="https://example.com" onclick="alert(1)">link</a>';
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).not.toContain("onclick");
    });

    it("strips onerror attributes", () => {
      const input = '<img src="x" onerror="alert(1)">';
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).not.toContain("onerror");
    });

    it("returns empty string for falsy input", () => {
      expect(SanitizationService.sanitizeHtml("")).toBe("");
      expect(SanitizationService.sanitizeHtml(null as any)).toBe("");
      expect(SanitizationService.sanitizeHtml(undefined as any)).toBe("");
    });

    it("returns empty string for non-string input", () => {
      expect(SanitizationService.sanitizeHtml(123 as any)).toBe("");
    });

    it("applies strict config when strict=true", () => {
      const input = '<div><p>Hello</p><a href="https://example.com">link</a></div>';
      const result = SanitizationService.sanitizeHtml(input, true);
      expect(result).not.toContain("<div>");
      expect(result).not.toContain("<a>");
    });

    it("adds noopener noreferrer to external links", () => {
      const input = '<a href="https://example.com">link</a>';
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).toContain("noopener");
      expect(result).toContain("nofollow");
    });
  });

  describe("sanitizeText", () => {
    it("escapes HTML entities", () => {
      const input = '<script>alert("xss")</script>';
      const result = SanitizationService.sanitizeText(input);
      expect(result).not.toContain("<script>");
      expect(result).toContain("&lt;");
    });

    it("returns empty string for falsy input", () => {
      expect(SanitizationService.sanitizeText("")).toBe("");
      expect(SanitizationService.sanitizeText(null as any)).toBe("");
    });

    it("preserves plain text", () => {
      const input = "Hello world 123";
      const result = SanitizationService.sanitizeText(input);
      expect(result).toBe("Hello world 123");
    });
  });

  describe("sanitizeUrl", () => {
    it("allows http and https URLs", () => {
      expect(SanitizationService.sanitizeUrl("https://example.com")).toBe(
        "https://example.com/",
      );
      expect(SanitizationService.sanitizeUrl("http://example.com")).toBe(
        "http://example.com/",
      );
    });

    it("blocks javascript: URLs", () => {
      expect(SanitizationService.sanitizeUrl("javascript:alert(1)")).toBe("");
    });

    it("blocks data: URLs", () => {
      expect(SanitizationService.sanitizeUrl("data:text/html,<script>")).toBe(
        "",
      );
    });

    it("blocks localhost", () => {
      expect(SanitizationService.sanitizeUrl("http://localhost/")).toBe("");
    });

    it("blocks 127.0.0.1", () => {
      expect(SanitizationService.sanitizeUrl("http://127.0.0.1/")).toBe("");
    });

    it("blocks private IP ranges", () => {
      expect(SanitizationService.sanitizeUrl("http://192.168.1.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://10.0.0.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://172.16.0.1/")).toBe("");
    });

    it("returns empty string for empty input", () => {
      expect(SanitizationService.sanitizeUrl("")).toBe("");
      expect(SanitizationService.sanitizeUrl(null as any)).toBe("");
    });

    it("returns empty string for invalid URLs", () => {
      expect(SanitizationService.sanitizeUrl("not-a-url")).toBe("");
    });
  });

  describe("sanitizeForMarkdown", () => {
    it("allows markdown-style HTML", () => {
      const input = "<p><strong>Bold</strong> text</p>";
      const result = SanitizationService.sanitizeForMarkdown(input);
      expect(result).toContain("<p>");
      expect(result).toContain("<strong>");
    });

    it("strips dangerous tags from markdown", () => {
      const input = '<p>Safe</p><script>alert(1)</script>';
      const result = SanitizationService.sanitizeForMarkdown(input);
      expect(result).not.toContain("<script>");
    });
  });

  describe("sanitizeUserContent", () => {
    it("allows basic formatting", () => {
      const input = "<p><strong>Hello</strong></p>";
      const result = SanitizationService.sanitizeUserContent(input);
      expect(result).toContain("<p>");
      expect(result).toContain("<strong>");
    });

    it("strips links from user content", () => {
      const input = '<a href="https://evil.com">click</a>';
      const result = SanitizationService.sanitizeUserContent(input);
      expect(result).not.toContain("<a>");
    });

    it("strips divs from user content", () => {
      const input = '<div class="evil">content</div>';
      const result = SanitizationService.sanitizeUserContent(input);
      expect(result).not.toContain("<div>");
    });
  });

  describe("sanitizeObject", () => {
    it("sanitizes string values in objects", () => {
      const input = { title: '<script>alert(1)</script>Hello' };
      const result = SanitizationService.sanitizeObject(input);
      expect(result.title).not.toContain("<script>");
    });

    it("recursively sanitizes nested objects", () => {
      const input = {
        nested: {
          content: '<img src=x onerror=alert(1)>',
        },
      };
      const result = SanitizationService.sanitizeObject(input);
      expect((result.nested as any).content).not.toContain("onerror");
    });

    it("sanitizes arrays", () => {
      const input = ['<script>alert(1)</script>', "safe"];
      const result = SanitizationService.sanitizeObject({ items: input });
      expect(result.items[0]).not.toContain("<script>");
    });

    it("handles circular references", () => {
      const input: Record<string, unknown> = { a: "safe" };
      input.self = input;
      const result = SanitizationService.sanitizeObject(input);
      expect(result.a).toBe("safe");
    });
  });

  describe("validateFileUpload", () => {
    const allowedTypes = {
      "image/png": ["png"],
      "application/pdf": ["pdf"],
    };

    it("rejects files with null bytes in name", async () => {
      const file = new File(["content"], "test\0file.png", {
        type: "image/png",
      });
      const result = await SanitizationService.validateFileUpload(
        file,
        allowedTypes,
      );
      expect(result.valid).toBe(false);
    });

    it("rejects empty files", async () => {
      const file = new File([], "empty.png", { type: "image/png" });
      const result = await SanitizationService.validateFileUpload(
        file,
        allowedTypes,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("rejects disallowed MIME types", async () => {
      const file = new File(["content"], "test.exe", {
        type: "application/exe",
      });
      const result = await SanitizationService.validateFileUpload(
        file,
        allowedTypes,
      );
      expect(result.valid).toBe(false);
    });

    it("accepts valid files", async () => {
      const pngHeader = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const file = new File([pngHeader], "test.png", { type: "image/png" });
      const result = await SanitizationService.validateFileUpload(
        file,
        allowedTypes,
      );
      expect(result.valid).toBe(true);
    });

    it("sanitizes filenames", async () => {
      const file = new File(["content"], "../../../etc/passwd.png", {
        type: "image/png",
      });
      const result = await SanitizationService.validateFileUpload(
        file,
        allowedTypes,
      );
      expect(result.sanitizedName).not.toContain("..");
      expect(result.sanitizedName).not.toContain("/");
    });
  });

  describe("sanitizeUserInput (standalone)", () => {
    it("returns empty string for empty input", () => {
      expect(sanitizeUserInput("")).toBe("");
    });

    it("truncates to max length", () => {
      const result = sanitizeUserInput("a".repeat(20000), 100);
      expect(result.length).toBe(100);
    });
  });

  describe("sanitizeTags (standalone)", () => {
    it("sanitizes array of tags", () => {
      const result = sanitizeTags(["<script>evil</script>", "safe-tag"]);
      expect(result).not.toContain("<script>");
      expect(result).toContain("safe-tag");
    });

    it("returns empty array for non-array input", () => {
      expect(sanitizeTags("not-array")).toEqual([]);
    });

    it("deduplicates tags", () => {
      const result = sanitizeTags(["tag1", "tag1", "tag2"]);
      expect(result).toEqual(["tag1", "tag2"]);
    });
  });

  describe("sanitizeSearchQuery (standalone)", () => {
    it("strips angle brackets", () => {
      const result = sanitizeSearchQuery("<script>alert(1)</script>");
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
    });

    it("truncates to max length", () => {
      const result = sanitizeSearchQuery("a".repeat(1000));
      expect(result.length).toBe(500);
    });
  });
});
