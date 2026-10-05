import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isLoopbackHost,
  isPrivateHost,
  isPrivateIpv4,
  normalizeIpv4,
} from "../../utils/ipSecurity";
import { allUrls, ipv4Bases, ipv4Forms } from "../helpers/ssrfCorpus";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Mock DOMPurify: en happy-dom/Windows no se auto-inicializa correctamente.
// We use vi.hoisted so purifyRef is available when the factory
// of vi.mock runs (vitest hoists vi.mock before other statements).
const purifyRef = vi.hoisted(() => ({ sanitize: vi.fn() }));

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

  // Keep a reference so the error-handling tests can spy on it.
  // Important: fn.sanitize DELEGATES to purifyRef.sanitize instead of assigning a
  // directly, because vi.spyOn(purifyRef, "sanitize") replaces
  // purifyRef.sanitize with a spy but does NOT affect fn.sanitize if it is a
  // direct reference. With delegation, the spy activates correctly.
  (purifyRef as any).sanitize = sanitize;

  const fn = function (this: any, ...args: any[]) {
    return purifyRef.sanitize(...args);
  } as any;
  fn.sanitize = function (...args: any[]) {
    return purifyRef.sanitize(...args);
  };
  fn.isSupported = true;
  fn.setConfig = vi.fn();
  fn.clearConfig = vi.fn();
  fn.removed = [];
  return { default: fn };
});

describe("SanitizationService", () => {
  let SanitizationService: any;

  beforeEach(async () => {
    const mod = await import("../../services/SanitizationService");
    SanitizationService = mod.SanitizationService;
  });

  describe("sanitizeHtml", () => {
    it("cleans malicious HTML", () => {
      const result = SanitizationService.sanitizeHtml(
        '<script>alert("xss")</script><p>safe</p>',
      );
      expect(result).not.toContain("<script>");
      expect(result).toContain("safe");
    });

    it("returns empty string for invalid input", () => {
      expect(SanitizationService.sanitizeHtml("")).toBe("");
      expect(SanitizationService.sanitizeHtml(null)).toBe("");
    });

    it("uses strict configuration when requested", () => {
      const result = SanitizationService.sanitizeHtml(
        "<h1>Title</h1><script>bad()</script>",
        true,
      );
      expect(result).not.toContain("<h1>");
      expect(result).not.toContain("<script>");
    });
  });

  describe("sanitizeText", () => {
    it("escapa entidades HTML", () => {
      const result = SanitizationService.sanitizeText('<b>bold</b> & "quote"');
      expect(result).toContain("&lt;b&gt;");
      expect(result).toContain("&amp;");
      expect(result).not.toContain("<b>");
    });

    it("returns empty string for invalid input", () => {
      expect(SanitizationService.sanitizeText("")).toBe("");
    });
  });

  describe("sanitizeUrl", () => {
    it("allows http/https URLs", () => {
      expect(SanitizationService.sanitizeUrl("https://example.com")).toBe(
        "https://example.com/",
      );
    });

    it("blocks javascript: URLs", () => {
      expect(SanitizationService.sanitizeUrl("javascript:alert(1)")).toBe("");
    });

    it("blocks data: URLs", () => {
      expect(
        SanitizationService.sanitizeUrl(
          "data:text/html,<script>alert(1)</script>",
        ),
      ).toBe("");
    });

    it("blocks localhost", () => {
      expect(SanitizationService.sanitizeUrl("http://localhost:3000")).toBe("");
    });

    it("blocks private IPs", () => {
      expect(SanitizationService.sanitizeUrl("http://192.168.1.1")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://10.0.0.1")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://172.16.0.1")).toBe("");
    });

    it("returns empty string for invalid input", () => {
      expect(SanitizationService.sanitizeUrl("")).toBe("");
    });
  });

  describe("sanitizeForMarkdown", () => {
    it("allows safe HTML for markdown", () => {
      const result = SanitizationService.sanitizeForMarkdown(
        "<h1>Title</h1><p>Content</p>",
      );
      expect(result).toContain("<h1>");
      expect(result).toContain("Content");
    });

    it("blocks scripts in markdown", () => {
      const result = SanitizationService.sanitizeForMarkdown(
        "<script>alert(1)</script>",
      );
      expect(result).not.toContain("<script>");
    });
  });

  describe("sanitizeUserContent", () => {
    it("allows basic formatting", () => {
      const result = SanitizationService.sanitizeUserContent(
        "<b>bold</b><p>para</p><h1>no</h1>",
      );
      expect(result).toContain("<b>");
      expect(result).toContain("<p>");
      expect(result).not.toContain("<h1>");
    });

    it("blocks scripts", () => {
      const result = SanitizationService.sanitizeUserContent(
        "<script>evil()</script>",
      );
      expect(result).not.toContain("<script>");
    });
  });

  describe("sanitizeObject", () => {
    it("sanitiza campos de texto recursivamente", () => {
      const obj = {
        content: "<script>alert(1)</script><p>safe</p>",
        name: "<b>Name</b>",
        nested: { description: "<script>bad()</script>" },
      };
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.content).not.toContain("<script>");
      expect(result.content).toContain("<p>");
      expect(result.name).not.toContain("<b>");
      expect(result.nested.description).not.toContain("<script>");
    });

    it("sanitizes strings inside arrays", () => {
      const obj = {
        tags: ["<script>alert(1)</script>", "safe", "<b>bold</b>"],
        names: ["<img src=x onerror=alert(1)>"],
        nested: { items: ["<p>safe</p>", "<script>bad()</script>"] },
      };
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.tags[0]).not.toContain("<script>");
      expect(result.tags[1]).toBe("safe");
      expect(result.tags[2]).not.toContain("<b>");
      // sanitizeText escapes (not strips) HTML, so the tag becomes inert text
      expect(result.names[0]).not.toContain("<img");
      expect(result.names[0]).not.toContain("<script");
      expect(result.nested.items[0]).toContain("safe");
      expect(result.nested.items[1]).not.toContain("<script>");
    });
  });

  describe("fuzzing — sanitizeHtml", () => {
    it("unicode zero-width characters", () => {
      const input = "\u200B\u200C\u200D\uFEFF<script>alert(1)</script>";
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).not.toContain("<script>");
    });

    it("right-to-left override", () => {
      const input = "<p>\u202Esafe.txt\u202C.exe</p>";
      const result = SanitizationService.sanitizeHtml(input);
      expect(result).toContain("safe");
    });

    it("null byte injection", () => {
      const result = SanitizationService.sanitizeHtml(
        "<scr\u0000ipt>alert(1)</scr\u0000ipt>",
      );
      expect(result).not.toContain("<script>");
    });

    it("double encoding bypass", () => {
      const result = SanitizationService.sanitizeHtml(
        "&lt;script&gt;alert(1)&lt;/script&gt;",
      );
      expect(result).not.toContain("<script>");
    });

    it("event handler attributes", () => {
      const result = SanitizationService.sanitizeHtml(
        "<img src=x onerror=alert(1)>",
      );
      expect(result).not.toContain("onerror");
    });

    it("nested malicious tags", () => {
      const result = SanitizationService.sanitizeHtml(
        "<div><div><script>evil()</script></div></div>",
      );
      expect(result).not.toContain("<script>");
    });

    it("very long string (buffer overflow attempt)", () => {
      const input = "<p>" + "A".repeat(100000) + "<script>evil()</script></p>";
      const result = SanitizationService.sanitizeHtml(input);
      expect(typeof result).toBe("string");
      expect(result.length).toBeLessThan(input.length);
      expect(result).not.toContain("<script>");
    });

    it("mixed case script tag", () => {
      const result = SanitizationService.sanitizeHtml(
        "<ScRiPt>alert(1)</ScRiPt>",
      );
      expect(result).not.toContain("<ScRiPt>");
    });

    it("html comment bypass", () => {
      const result = SanitizationService.sanitizeHtml(
        "<!--<script>-->alert(1)<!--</script>-->",
      );
      expect(result).not.toContain("<script>");
    });

    it("svg/mathml namespace confusion", () => {
      const result = SanitizationService.sanitizeHtml(
        "<svg><desc><script>alert(1)</script></desc></svg>",
      );
      expect(result).not.toContain("<script>");
    });
  });

  describe("fuzzing — sanitizeUrl", () => {
    it("vbscript protocol", () => {
      expect(SanitizationService.sanitizeUrl("vbscript:msgbox(1)")).toBe("");
    });

    it("file protocol", () => {
      expect(SanitizationService.sanitizeUrl("file:///etc/passwd")).toBe("");
    });

    it("unicode URL bypass", () => {
      const result = SanitizationService.sanitizeUrl("https://evil.cоm");
      expect(typeof result).toBe("string");
      expect(result).toContain("xn--");
    });

    it("URL with @ symbol (auth bypass)", () => {
      const result = SanitizationService.sanitizeUrl(
        "https://evil.com@trusted.com",
      );
      expect(typeof result).toBe("string");
    });

    it("tab character in protocol", () => {
      expect(SanitizationService.sanitizeUrl("java\tscript:alert(1)")).toBe("");
    });

    it("newline in protocol", () => {
      expect(SanitizationService.sanitizeUrl("java\nscript:alert(1)")).toBe("");
    });

    it("empty host", () => {
      const result = SanitizationService.sanitizeUrl("http:///path");
      expect(typeof result).toBe("string");
    });

    it("very long URL", () => {
      const long = "https://example.com/" + "a".repeat(10000);
      const result = SanitizationService.sanitizeUrl(long);
      expect(result.startsWith("https://")).toBe(true);
    });
  });

  describe("fuzzing — sanitizeText", () => {
    it("unicode escapes in text", () => {
      const result = SanitizationService.sanitizeText(
        "\u003Cscript\u003Ealert(1)\u003C/script\u003E",
      );
      expect(result).toContain("alert");
    });

    it("emoji with zero-width joiners", () => {
      const result = SanitizationService.sanitizeText("Hello 👨‍👩‍👧‍👦 world 🎉");
      expect(result).toContain("Hello");
      expect(result).toContain("world");
    });

    it("mixed scripts (CJK + Arabic + Latin)", () => {
      const result = SanitizationService.sanitizeText("Hello 世界 مرحبا 123");
      expect(result).toContain("Hello");
    });

    it("control characters", () => {
      const result = SanitizationService.sanitizeText(
        "line1\u0000line2\u001Fline3",
      );
      expect(result).toContain("line");
    });

    it("surrogate pairs", () => {
      const result = SanitizationService.sanitizeText("𝕿𝖍𝖊 𝖖𝖚𝖎𝖈𝖐 𝖇𝖗𝖔𝖜𝖓 𝖋𝖔𝖝");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("fuzzing — sanitizeUserContent", () => {
    it("template injection attempt", () => {
      const result = SanitizationService.sanitizeUserContent(
        '{{constructor.constructor("alert(1)")()}}',
      );
      expect(typeof result).toBe("string");
    });

    it("angular sandbox escape", () => {
      const result = SanitizationService.sanitizeUserContent(
        '{{a[b]="constructor";a[a]("alert(1)")()}}',
      );
      expect(typeof result).toBe("string");
    });

    it("deeply nested allowed tags", () => {
      const result = SanitizationService.sanitizeUserContent(
        "<b><i><u><s><b><i><u><s>deep</s></u></i></b></s></u></i></b>",
      );
      expect(result).toContain("deep");
    });

    it("tag with only whitespace", () => {
      const result = SanitizationService.sanitizeUserContent("<b>   </b>");
      expect(typeof result).toBe("string");
    });
  });

  describe("fuzzing — sanitizeObject", () => {
    it("circular reference", () => {
      const obj: any = { name: "<script>evil()</script>" };
      obj.self = obj;
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.name).not.toContain("<script>");
    });

    it("array with mixed types", () => {
      const obj = {
        items: [
          "<script>a()</script>",
          123,
          null,
          true,
          { x: "<img onerror=bad()>" },
        ],
      };
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.items[0]).not.toContain("<script>");
      expect(result.items[0]).toContain("a()");
      expect(result.items[4].x).not.toContain("<script>");
    });

    it("deeply nested object", () => {
      let obj: any = { level: "<script>deep</script>" };
      for (let i = 0; i < 50; i++) {
        obj = { inner: obj };
      }
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.inner).toBeDefined();
    });

    it("prototype pollution attempt", () => {
      const obj = JSON.parse(
        '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
      );
      const result = SanitizationService.sanitizeObject(obj);
      expect(typeof result).toBe("object");
    });

    it("plain text field via isHtmlField=false path", () => {
      const obj = { name: "<b>bold</b>", email: "test@example.com" };
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.email).not.toContain("<b>");
    });

    it("non-string, non-object values passthrough", () => {
      const obj = { num: 42, flag: true, nothing: null };
      const result = SanitizationService.sanitizeObject(obj);
      expect(result.num).toBe(42);
      expect(result.flag).toBe(true);
      expect(result.nothing).toBeNull();
    });

    it("null/undefined input returns same", () => {
      expect(SanitizationService.sanitizeObject(null)).toBeNull();
      const undef = undefined as any;
      expect(SanitizationService.sanitizeObject(undef)).toBeUndefined();
    });

    it("visited set prevents infinite recursion", () => {
      const a: any = { name: "a" };
      const b: any = { name: "b", ref: a };
      a.ref = b;
      const visited = new WeakSet();
      visited.add(a);
      visited.add(b);
      const result = SanitizationService.sanitizeObject(a, visited);
      expect(result).toEqual({});
    });
  });

  describe("sanitizeLinks", () => {
    it("adds target=_blank and rel=noopener to external links", () => {
      const html = '<a href="https://example.com">link</a>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toContain('target="_blank"');
      expect(result).toContain("noopener");
    });

    it("no modifica enlaces internos", () => {
      const html = '<a href="#section">internal</a>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("noopener");
    });

    it("strips data: URIs from anchor href (XSS/phishing vector)", () => {
      const html = '<a href="data:text/html,<script>alert(1)</script>">click me</a>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("data:");
      expect(result).not.toContain("href");
      expect(result).toContain("click me");
    });

    it("strips data: SVG URIs from anchor href", () => {
      const html = '<a href="data:image/svg+xml,<svg onload=alert(1)>">link</a>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("data:");
    });
  });

  describe("standalone functions", () => {
    it("sanitizeUserInput returns empty string for invalid input", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(mod.sanitizeUserInput("")).toBe("");
      expect(mod.sanitizeUserInput("  ")).toBe("");
    });

    it("sanitizeUserInput trunca a maxLength", async () => {
      const mod = await import("../../services/SanitizationService");
      const long = "a".repeat(500);
      const result = mod.sanitizeUserInput(long, 10);
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("sanitizeTags returns empty array for invalid input", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(mod.sanitizeTags(null)).toEqual([]);
      expect(mod.sanitizeTags("not-array")).toEqual([]);
    });

    it("sanitizeTags filters duplicates and truncates", async () => {
      const mod = await import("../../services/SanitizationService");
      const result = mod.sanitizeTags(["a", "b", "a", "c"]);
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("sanitizeTags trunca tags largos", async () => {
      const mod = await import("../../services/SanitizationService");
      const long = "a".repeat(100);
      const result = mod.sanitizeTags([long]);
      expect(result[0]!.length).toBeLessThanOrEqual(50);
    });

    it("sanitizeTags normalizes case and # to collapse tags (L-07)", async () => {
      const mod = await import("../../services/SanitizationService");
      // Before L-07, ["AI", "ai", "#ai"] survived as 3 distinct tags.
      const result = mod.sanitizeTags(["AI", "ai", "#ai", " #AI "]);
      expect(result).toEqual(["ai"]);
    });

    it("validateAndSanitizeUrl throws for an invalid URL", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(() => mod.validateAndSanitizeUrl("javascript:alert(1)")).toThrow(
        "Invalid URL",
      );
    });

    it("validateAndSanitizeUrl returns valid URL", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(mod.validateAndSanitizeUrl("https://example.com")).toBe(
        "https://example.com/",
      );
    });

    it("sanitizeSearchQuery removes dangerous characters", async () => {
      const mod = await import("../../services/SanitizationService");
      const result = mod.sanitizeSearchQuery("<script>alert(1)</script>");
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
    });

    it("sanitizeSearchQuery returns empty string for invalid input", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(mod.sanitizeSearchQuery("")).toBe("");
    });

    it("sanitizeSearchQuery trunca a 500 chars", async () => {
      const mod = await import("../../services/SanitizationService");
      const long = "a".repeat(1000);
      const result = mod.sanitizeSearchQuery(long);
      expect(result.length).toBeLessThanOrEqual(500);
    });

    it("sanitizeHtmlForDisplay returns sanitized HTML", async () => {
      const mod = await import("../../services/SanitizationService");
      const result = mod.sanitizeHtmlForDisplay(
        "<script>alert(1)</script><p>safe</p>",
      );
      expect(result).not.toContain("<script>");
      expect(result).toContain("<p>");
    });
  });

  describe("error handling", () => {
    it("sanitizeHtml silently returns empty when there is no string", () => {
      expect(SanitizationService.sanitizeHtml(null)).toBe("");
      expect(SanitizationService.sanitizeHtml(undefined)).toBe("");
    });

    it("sanitizeForMarkdown returns empty without input", () => {
      expect(SanitizationService.sanitizeForMarkdown("")).toBe("");
    });

    it("sanitizeUserContent returns empty without input", () => {
      expect(SanitizationService.sanitizeUserContent("")).toBe("");
    });
  });

  describe("sanitizeUrl edge cases", () => {
    it("blocks IPv6 ULA", () => {
      expect(SanitizationService.sanitizeUrl("http://fd12:3456:789a::1")).toBe(
        "",
      );
    });

    it("blocks IPv6 link-local", () => {
      expect(SanitizationService.sanitizeUrl("http://fe80::1")).toBe("");
    });

    it("blocks IPv4-mapped IPv6", () => {
      expect(SanitizationService.sanitizeUrl("http://::ffff:192.168.1.1")).toBe(
        "",
      );
    });

    it("blocks 0.0.0.0 and 255.255.255.255", () => {
      expect(SanitizationService.sanitizeUrl("http://0.0.0.0")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://255.255.255.255")).toBe(
        "",
      );
    });

    it("blocks 127.0.0.1", () => {
      expect(SanitizationService.sanitizeUrl("http://127.0.0.1:8080")).toBe("");
    });

    it("URL with non-http/https protocol returns empty", () => {
      expect(SanitizationService.sanitizeUrl("ftp://example.com")).toBe("");
      expect(SanitizationService.sanitizeUrl("chrome://settings")).toBe("");
    });

    it("URL con 169.254.x.x (link-local) bloqueada", () => {
      expect(SanitizationService.sanitizeUrl("http://169.254.1.1")).toBe("");
    });
  });

  describe("SSRF bypass obfuscations (P76)", () => {
    it("blocks IPv6 loopback with brackets ([::1])", () => {
      expect(SanitizationService.sanitizeUrl("http://[::1]/")).toBe("");
    });

    it("blocks IPv6 ULA/link-local with brackets", () => {
      expect(
        SanitizationService.sanitizeUrl("http://[fd12:3456:789a::1]/"),
      ).toBe("");
      expect(SanitizationService.sanitizeUrl("http://[fc00::1]/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://[fe80::1]/")).toBe("");
    });

    it("blocks private IPv4-mapped IPv6 (dotted and hex)", () => {
      expect(
        SanitizationService.sanitizeUrl("http://[::ffff:192.168.1.1]/"),
      ).toBe("");
      expect(
        SanitizationService.sanitizeUrl("http://[::ffff:127.0.0.1]/"),
      ).toBe("");
      // El parser URL reescribe la cola embebida a hex (c0a8:101 = 192.168.1.1)
      expect(
        SanitizationService.sanitizeUrl("http://[::ffff:c0a8:101]/"),
      ).toBe("");
      expect(SanitizationService.sanitizeUrl("http://[::ffff:7f00:1]/")).toBe(
        "",
      );
    });

    it("allows public IPv4-mapped IPv6", () => {
      const result = SanitizationService.sanitizeUrl("http://[::ffff:8.8.8.8]/");
      expect(result.startsWith("http://[")).toBe(true);
    });

    it("blocks full 127/8 loopback (not just 127.0.0.1)", () => {
      expect(SanitizationService.sanitizeUrl("http://127.0.0.2/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://127.1.2.3/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://127.255.255.255/")).toBe(
        "",
      );
    });

    it("blocks short loopback forms (127.1, 127.0.1)", () => {
      expect(SanitizationService.sanitizeUrl("http://127.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://127.0.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://0x7f.0.0.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://0177.0.0.1/")).toBe("");
    });

    it("blocks obfuscated IPv4 numbers (hex/octal/int)", () => {
      expect(SanitizationService.sanitizeUrl("http://0x7f000001/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://017700000001/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://2130706433/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://0x7f000000/")).toBe("");
    });

    it("blocks CGNAT, TEST-NET and multicast/reserved", () => {
      expect(SanitizationService.sanitizeUrl("http://100.64.0.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://100.127.255.255/")).toBe(
        "",
      );
      expect(SanitizationService.sanitizeUrl("http://192.0.2.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://198.51.100.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://203.0.113.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://224.0.0.1/")).toBe("");
      expect(SanitizationService.sanitizeUrl("http://240.0.0.1/")).toBe("");
    });

    it("blocks IPv6 loopback/unspecified in full form", () => {
      // El parser URL normaliza la forma completa a comprimida ([0:0:0:0:0:0:0:1]
      // → [::1]); this ensures the long-form bypass is blocked the same way.
      expect(SanitizationService.sanitizeUrl("http://[0:0:0:0:0:0:0:1]/")).toBe(
        "",
      );
      expect(SanitizationService.sanitizeUrl("http://[0:0:0:0:0:0:0:0]/")).toBe(
        "",
      );
    });

    it("allows normal public IPs", () => {
      expect(SanitizationService.sanitizeUrl("http://8.8.8.8/")).toBe(
        "http://8.8.8.8/",
      );
      expect(SanitizationService.sanitizeUrl("http://1.1.1.1/")).toBe(
        "http://1.1.1.1/",
      );
    });
  });

  describe("SSRF fuzz corpus (P77)", () => {
    // Every variant must be blocked (returns ""). Includes obfuscations
    // IPv4/IPv6, trailing-dot, rangos especiales completos y protocolos.
    const blockedVariants = [
      // Loopback 127/8 — dotted, cortos, hex, octal, integer, trailing-dot
      "http://127.0.0.1/",
      "http://127.0.0.1:8080/",
      "http://127.1/",
      "http://127.0.1/",
      "http://127.0.0.2/",
      "http://127.255.255.255/",
      "http://127.0.0.1./",
      "http://0177.0.0.1/",
      "http://0x7f.0.0.1/",
      "http://0x7f.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0X7f000001/",
      "http://0x7F.0.0.1/",
      "http://017700000001/",
      // localhost + trailing dot + credenciales
      "http://localhost/",
      "http://localhost./",
      "http://localhost:3000/",
      "http://user@localhost/",
      "http://user:pass@127.0.0.1/",
      // RFC1918 privadas
      "http://10.0.0.1/",
      "http://10.255.255.255/",
      "http://10.0.0.1:22/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://192.168.255.255/",
      "http://192.168.1.1/path?x=1",
      // Link-local
      "http://169.254.1.1/",
      "http://169.254.169.254/",
      // 0/8 y broadcast
      "http://0.0.0.0/",
      "http://0.0.0.1/",
      "http://0.1.2.3/",
      "http://255.255.255.255/",
      // CGNAT 100.64/10
      "http://100.64.0.1/",
      "http://100.127.255.255/",
      // TEST-NET y asignaciones IETF
      "http://192.0.2.1/",
      "http://198.51.100.1/",
      "http://203.0.113.1/",
      "http://192.0.0.9/",
      "http://198.18.0.1/",
      // Full multicast 224/4 (225–239 too)
      "http://224.0.0.1/",
      "http://225.0.0.1/",
      "http://231.1.2.3/",
      "http://239.255.255.255/",
      // Full reserved 240/4 (241–255 too)
      "http://240.0.0.1/",
      "http://241.0.0.1/",
      "http://250.1.2.3/",
      "http://254.0.0.1/",
      // IPv6 privadas (loopback, ULA, link-local, unspecified)
      "http://[::1]/",
      "http://[::]/",
      "http://[0:0:0:0:0:0:0:1]/",
      "http://[0:0:0:0:0:0:0:0]/",
      "http://[fc00::1]/",
      "http://[fd12:3456:789a::1]/",
      "http://[fe80::1]/",
      "http://[fec0::1]/",
      // IPv4-mapped IPv6 (dotted y hex)
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:192.168.1.1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::ffff:c0a8:101]/",
      "http://[::ffff:0:0]/",
      // Protocolos no http/https
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://127.0.0.1/",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
    ];

    // Public hosts that must NEVER be blocked (range boundaries).
    const allowedHosts = [
      "http://8.8.8.8/",
      "http://1.1.1.1/",
      "http://9.9.9.9/",
      "http://172.15.0.1/", // fuera de 172.16/12
      "http://172.32.0.1/", // fuera de 172.16/12
      "http://100.63.0.1/", // just before CGNAT
      "http://100.128.0.1/", // just after CGNAT
      "http://198.17.0.1/", // fuera de 198.18/15
      "http://203.0.112.1/", // just before TEST-NET-3
      "http://223.255.255.255/", // just before multicast
      "http://192.0.1.1/", // 192.0.1/24 is public (only .0 and .2 reserved)
      "http://[2001:4860:4860::8888]/", // Google DNS IPv6 publico
      "http://[::ffff:8.8.8.8]/", // mapped publico
      "http://example.com/",
      "http://github.com/",
      "http://www.google.com/",
      "http://sub.domain.example/",
      "http://localhost.example.com/", // contains localhost but is a public domain
      "http://127.0.0.1@evil.com/", // credenciales; host real = evil.com
    ];

    it.each(blockedVariants)("bloquea variante SSRF: %s", (url) => {
      expect(SanitizationService.sanitizeUrl(url)).toBe("");
    });

    it.each(allowedHosts)("permite host publico: %s", (url) => {
      const result = SanitizationService.sanitizeUrl(url);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("validateFileUpload edge cases", () => {
    it("MIME type sin magic bytes pasa validacion (unknown)", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "test.bin"),
        { "application/octet-stream": ["bin"] },
        1024,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("DOMPurify error handling", () => {
    it("sanitizeHtml captura error de DOMPurify", async () => {
      const mod = await import("../../services/SanitizationService");
      vi.spyOn(purifyRef, "sanitize").mockImplementationOnce(() => {
        throw new Error("mock error");
      });
      const result = mod.SanitizationService.sanitizeHtml("<p>test</p>");
      expect(result).toBe("");
    });

    it("sanitizeForMarkdown captura error de DOMPurify", async () => {
      const mod = await import("../../services/SanitizationService");
      vi.spyOn(purifyRef, "sanitize").mockImplementationOnce(() => {
        throw new Error("mock error");
      });
      const result = mod.SanitizationService.sanitizeForMarkdown("test");
      expect(result).toBe("test");
    });

    it("sanitizeUserContent captura error de DOMPurify", async () => {
      const mod = await import("../../services/SanitizationService");
      vi.spyOn(purifyRef, "sanitize").mockImplementationOnce(() => {
        throw new Error("mock error");
      });
      const result = mod.SanitizationService.sanitizeUserContent("<b>test</b>");
      expect(result).toBe("&lt;b&gt;test&lt;/b&gt;");
    });
  });

  describe("standalone functions edge cases", () => {
    it("sanitizeUserInput with non-string input returns empty", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(mod.sanitizeUserInput(undefined as any)).toBe("");
      expect(mod.sanitizeUserInput(123 as any)).toBe("");
    });

    it("sanitizeSearchQuery with non-string input returns empty", async () => {
      const mod = await import("../../services/SanitizationService");
      expect(mod.sanitizeSearchQuery(undefined as any)).toBe("");
      expect(mod.sanitizeSearchQuery(null as any)).toBe("");
    });
  });

  describe("validateFileUpload", () => {
    it("rejects filename with path traversal", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "../../etc/passwd"),
        { "text/plain": ["txt"] },
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid file name");
    });

    it("rejects filename with null byte", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "evil\0.txt"),
        { "text/plain": ["txt"] },
      );
      expect(result.valid).toBe(false);
    });

    it("rejects empty file", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File([], "empty.txt"),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("rejects file that is too large", async () => {
      const big = new Blob(["x".repeat(200)]);
      const result = await SanitizationService.validateFileUpload(
        new File([big], "big.txt"),
        { "text/plain": ["txt"] },
        100,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too large");
    });

    it("rejects disallowed MIME type", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "test.exe", { type: "application/x-msdownload" }),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not allowed");
    });

    it("rejects extension not allowed for the MIME type", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "test.exe", { type: "text/plain" }),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("extension");
    });

    it("accepts valid file", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "test.txt", { type: "text/plain" }),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(true);
      expect(result.sanitizedName).toBe("test.txt");
    });

    it("sanitiza filename: remove leading dots, double dots, special chars", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "..._..__file!@#.txt", { type: "text/plain" }),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(true);
      expect(result.sanitizedName).not.toContain("..");
    });

    it("rejects empty filename after sanitization", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["test"], "...", { type: "text/plain" }),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(false);
    });

    it("validates magic bytes for PNG image", async () => {
      const pngBytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const result = await SanitizationService.validateFileUpload(
        new File([pngBytes], "test.png", { type: "image/png" }),
        { "image/png": ["png"] },
        1024,
      );
      expect(result.valid).toBe(true);
    });

    it("rejects mismatched magic bytes", async () => {
      const fakePng = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const result = await SanitizationService.validateFileUpload(
        new File([fakePng], "fake.png", { type: "image/png" }),
        { "image/png": ["png"] },
        1024,
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain("magic bytes");
    });

    it("text/plain sin magic bytes pasa validacion", async () => {
      const result = await SanitizationService.validateFileUpload(
        new File(["hello"], "hello.txt", { type: "text/plain" }),
        { "text/plain": ["txt"] },
        1024,
      );
      expect(result.valid).toBe(true);
    });
  });

  describe("SSRF chain differential fuzzing (P81)", () => {
    // Shared deterministic corpus in src/tests/helpers/ssrfCorpus.ts (P81 and
    // P82 use the same source so the gates do not drift apart).
    it("gate equivalence: sanitizeUrl blocks ⇔ isPrivateHost is private", () => {
      for (const url of allUrls) {
        const gate1Blocked = SanitizationService.sanitizeUrl(url) === "";
        const hostname = new URL(url).hostname;
        const gate2Private = isPrivateHost(hostname);
        expect(gate1Blocked, `URL ${url} (host ${hostname}) — gates divergen`).toBe(
          gate2Private,
        );
      }
    });

    it("isLoopbackHost(h) ⇒ isPrivateHost(h) — loopback siempre es privado", () => {
      const hosts = [
        "localhost", "localhost.", "LOCALHOST", "[::1]", "[::]",
        "[0:0:0:0:0:0:0:1]", "0:0:0:0:0:0:0:1", "::ffff:7f00:1",
        "[::ffff:127.0.0.1]", "127.0.0.1", "127.1", "0x7f000001",
        "2130706433", "127.0.0.2", "127.0.0.1.",
      ];
      for (const h of hosts) {
        expect(isLoopbackHost(h), h).toBe(true);
        expect(isPrivateHost(h), `loopback no privado: ${h}`).toBe(true);
      }
    });

    it("hosts no-loopback no se reportan como loopback", () => {
      const nonLoopback = [
        "8.8.8.8", "10.0.0.1", "192.168.1.1", "172.16.0.1",
        "127.0.0.1.evil.com", "example.com", "localhost.example.com",
        "2001:db8::1", "[2001:4860:4860::8888]", "[::ffff:8.8.8.8]",
        "0.0.0.0", "255.255.255.255", "100.64.0.1", "224.0.0.1",
        "240.0.0.1", "169.254.169.254",
      ];
      for (const h of nonLoopback) {
        expect(isLoopbackHost(h), h).toBe(false);
      }
    });

    it("isPrivateHost ≡ isPrivateIpv4∘normalizeIpv4 on numeric hosts", () => {
      const numeric = ipv4Bases.flatMap(([a, b, c, d]) =>
        ipv4Forms(a, b, c, d),
      );
      for (const h of numeric) {
        expect(isPrivateHost(h), h).toBe(isPrivateIpv4(normalizeIpv4(h)));
      }
    });
  });
});
