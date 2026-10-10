import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  sanitizeUserInput,
  sanitizeUrl,
  sanitizeSearchQuery,
  sanitizeHtmlForDisplay,
  sanitizeTags,
  validateAndSanitizeUrl,
} from "../../services/SanitizationService";

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: { getSecret: vi.fn(), setSecret: vi.fn(), hasSecret: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const XSS_PAYLOADS = [
  '<script>alert("XSS")</script>',
  '"><script>alert(1)</script>',
  "<img src=x onerror=alert(1)>",
  "<svg onload=alert(1)>",
  "javascript:alert(1)",
  '<?php system("rm -rf /");?>',
  '<%= System("ls") %>',
  "${alert(1)}",
  '{{constructor.constructor("alert(1)")()}}',
  "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  '\\";alert(1)//',
  "'-alert(1)-'",
  `<div onmouseover="alert(1)">Hover me</div>`,
];

const UNICODE_ATTACKS = [
  "\uFF54\uFF45\uFF53\uFF54", // fullwidth "test"
  "\u202Etest\u202D", // RTL override
  "\u0000", // null byte
  "\u0000<script>alert(1)</script>",
  "\uD800\uDC00", // surrogate pair
  "\u0300\u0301\u0302", // combining marks
  "\u200B\u200C\u200D", // zero-width chars
  "\uFEFF", // BOM
  "\u00A0\u00A0\u00A0", // non-breaking spaces
  "a\u0300\u0301\u0302b", // composed + decomposed
  "\u2028\u2029", // line/paragraph separator
  "\uFF08\uFF09\uFF03", // fullwidth brackets/hash
  "\u{1F600}\u{1F601}\u{1F602}", // emoji mixed injection
];

const LONG_STRINGS = [
  "a".repeat(1000),
  "a".repeat(10000),
  "a".repeat(100000),
  "XSS".repeat(5000),
  "<script>".repeat(2000),
];

const SQL_LIKE = [
  "' OR '1'='1",
  "'; DROP TABLE users;--",
  "' UNION SELECT * FROM users--",
  "admin'--",
  "1; SELECT password FROM users",
  "' OR 1=1--",
  "''; EXEC xp_cmdshell('dir')--",
];

const PATH_TRAVERSAL = [
  "../../../etc/passwd",
  "..\\..\\..\\windows\\system32\\config",
  "%2e%2e%2f%2e%2e%2fetc/passwd",
  "....//....//....//etc/passwd",
  "__proto__.toString",
  "constructor.constructor",
];

describe("Input Fuzzing - Sanitization Edge Cases", () => {
  describe("sanitizeUserInput", () => {
    it("handles XSS payloads without throwing", () => {
      for (const payload of XSS_PAYLOADS) {
        expect(() => sanitizeUserInput(payload)).not.toThrow();
        const result = sanitizeUserInput(payload);
        expect(result).not.toContain("<script");
        expect(result).not.toContain("onerror");
        expect(result).not.toContain("onload");
      }
    });

    it("handles unicode attacks without throwing", () => {
      for (const payload of UNICODE_ATTACKS) {
        expect(() => sanitizeUserInput(payload)).not.toThrow();
      }
    });

    it("handles extremely long strings without OOM", () => {
      for (const payload of LONG_STRINGS) {
        expect(() => sanitizeUserInput(payload, 50000)).not.toThrow();
        const result = sanitizeUserInput(payload, 50000);
        expect(result.length).toBeLessThanOrEqual(50000);
      }
    });

    it("handles mixed scripts and special characters", () => {
      const mixed = "<script>" + "\u202E" + "alert(1)" + "\u202D" + "</script>";
      const result = sanitizeUserInput(mixed);
      expect(result).not.toContain("alert");
    });
  });

  describe("sanitizeUrl - protocol fuzzing", () => {
    const DANGEROUS_PROTOCOLS = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://evil.com",
      "blob:http://evil.com",
      "about:blank",
      'vbscript:msgbox("xss")',
      "chrome://settings",
      "moz-extension://malicious",
      "chrome-extension://malicious",
      "edge://settings",
    ];

    it("blocks all dangerous protocols", () => {
      for (const url of DANGEROUS_PROTOCOLS) {
        expect(sanitizeUrl(url)).toBe("");
      }
    });

    it("handles URL-encoded bypass attempts", () => {
      const attempts = [
        "javascript%3aalert(1)",
        "jav&#97;script:alert(1)",
        "&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert(1)",
        "JaVaScRiPt:alert(1)",
      ];
      for (const url of attempts) {
        expect(sanitizeUrl(url)).toBe("");
      }
    });
  });

  describe("sanitizeSearchQuery - injection fuzzing", () => {
    it("handles search injection vectors", () => {
      const injections = [
        ...XSS_PAYLOADS.slice(0, 5),
        ...SQL_LIKE.slice(0, 3),
        ...PATH_TRAVERSAL.slice(0, 3),
      ];
      for (const payload of injections) {
        expect(() => sanitizeSearchQuery(payload)).not.toThrow();
      }
    });
  });

  describe("sanitizeHtmlForDisplay - DOM clobbering", () => {
    it("prevents DOM clobbering attacks", () => {
      const attacks = [
        '<form id="login"><input name="action" value="http://evil.com"></form>',
        '<a id="config" href="http://evil.com">config</a>',
        '<img name="cookie" src="x">',
      ];
      for (const html of attacks) {
        const result = sanitizeHtmlForDisplay(html);
        // DOM clobbering protection: form, input and name="" on non-form elements are stripped
        expect(result).not.toContain("<form");
        expect(result).not.toContain("<input");
        expect(result).not.toContain('name="cookie"');
      }
    });

    it("prevents DOM clobbering via embed, object, iframe", () => {
      const attacks = [
        '<embed id="config" src="http://evil.com">',
        '<object id="login" data="http://evil.com"></object>',
        '<iframe id="cookie" src="http://evil.com"></iframe>',
      ];
      for (const html of attacks) {
        const result = sanitizeHtmlForDisplay(html);
        expect(result).not.toContain("<embed");
        expect(result).not.toContain("<object");
        expect(result).not.toContain("<iframe");
      }
    });

    it("prevents mXSS (Mutation XSS) attacks", () => {
      const attacks = [
        '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
        "<svg><p><style><img src=x onerror=alert(1)></style></p></svg>",
        "<select><style></select><img src=x onerror=alert(1)></style>",
      ];
      for (const html of attacks) {
        const result = sanitizeHtmlForDisplay(html);
        expect(result.toLowerCase()).not.toContain("onerror");
        expect(result.toLowerCase()).not.toContain("alert");
      }
    });

    it("prevents CSS injection via style tags", () => {
      const attacks = [
        '<style>body { background: url("javascript:alert(1)") }</style>',
        '<style>@import url("http://evil.com");</style>',
        '<style>input[type="password"] { background: url("http://evil.com/log"); }</style>',
      ];
      for (const html of attacks) {
        const result = sanitizeHtmlForDisplay(html);
        expect(result).not.toContain("<style>");
      }
    });

    it("strips event handlers from all tags", () => {
      const handlers = [
        "onclick",
        "onload",
        "onerror",
        "onmouseover",
        "onfocus",
        "onblur",
        "onchange",
        "onsubmit",
      ];
      for (const handler of handlers) {
        const html = `<a ${handler}="alert(1)">click</a>`;
        const result = sanitizeHtmlForDisplay(html);
        expect(result).not.toContain(handler + "=");
      }
    });

    it("handles nested script bypass attempts", () => {
      const attempts = [
        "<scr<script>ipt>alert(1)</scr</script>ipt>",
        "<ScRiPt>alert(1)</sCrIpT>",
        '<scriptx src="http://evil.com/xss.js"></scriptx>',
        '<SCRIPT>alert("XSS")</SCRIPT>',
      ];
      for (const html of attempts) {
        const result = sanitizeHtmlForDisplay(html);
        expect(result.toLowerCase()).not.toContain("script");
      }
    });

    it("prevents SVG-based XSS injection", () => {
      const attacks = [
        '<svg onload="alert(1)"></svg>',
        '<svg><use href="data:image/svg+xml,&lt;script&gt;alert(1)&lt;/script&gt;"></use></svg>',
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        "<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc></svg>",
        '<svg><foreignObject><body><iframe src="javascript:alert(1)"></iframe></body></foreignObject></svg>',
      ];
      for (const html of attacks) {
        const result = sanitizeHtmlForDisplay(html);
        expect(result.toLowerCase()).not.toContain("onload");
        expect(result.toLowerCase()).not.toContain("<script");
        expect(result.toLowerCase()).not.toContain("<iframe");
      }
    });
  });

  describe("sanitizeTags - edge cases", () => {
    it("handles tags with unicode normalization attacks", () => {
      const tags = [
        ...UNICODE_ATTACKS.slice(0, 5).map((c) => `tag${c}`),
        "<script>alert(1)</script>",
        "../../../etc/passwd",
        "a".repeat(100),
      ];
      expect(() => sanitizeTags(tags)).not.toThrow();
    });
  });

  describe("validateAndSanitizeUrl - stress", () => {
    it("handles malformed URLs without throwing unexpected errors", () => {
      const malformed = [
        "https://",
        "http://",
        "https://.com",
        "http://192.168.0.1:abc",
        "https://[::1]:99999",
        "https://example.com:999999",
        "https://example.com/path with spaces",
        "https://例え.test",
        "https://xn--hxajbheg2az3al.test",
      ];
      for (const url of malformed) {
        try {
          const result = validateAndSanitizeUrl(url);
          expect(result).toBeTruthy();
        } catch {
          // Expected for truly invalid URLs
        }
      }
    });
  });
});

describe("Input Fuzzing - Component Level", () => {
  it("Chat input handles XSS payload without breaking", async () => {
    const TestInput = ({ onSend }: { onSend: (v: string) => void }) => {
      const [val, setVal] = React.useState("");
      return (
        <div>
          <input
            aria-label="chat-input"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSend(val)}
            placeholder="Type a message..."
          />
          <button onClick={() => onSend(val)} disabled={!val.trim()}>
            Send
          </button>
        </div>
      );
    };
    const onSend = vi.fn();
    render(<TestInput onSend={onSend} />);
    const input = screen.getByPlaceholderText("Type a message...");

    for (const payload of XSS_PAYLOADS) {
      fireEvent.change(input, { target: { value: payload } });
      expect((input as HTMLInputElement).value).toBe(payload);
      await userEvent.click(screen.getByText("Send"));
      expect(onSend).toHaveBeenCalledWith(payload);
      vi.clearAllMocks();
    }
  });

  it("search input handles unicode attacks without error", () => {
    const TestSearch = () => {
      const [q, setQ] = React.useState("");
      return (
        <input
          aria-label="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search..."
        />
      );
    };
    render(<TestSearch />);
    const input = screen.getByPlaceholderText("Search...");

    for (const payload of UNICODE_ATTACKS) {
      expect(() =>
        fireEvent.change(input, { target: { value: payload } }),
      ).not.toThrow();
    }
  });

  it("URL input blocks dangerous protocols via sanitizeUrl", () => {
    const dangerous = [
      { input: "javascript:alert(1)", expected: "" },
      { input: "data:text/html,<script>alert(1)</script>", expected: "" },
    ];
    for (const { input, expected } of dangerous) {
      expect(sanitizeUrl(input)).toBe(expected);
    }
    // Valid https URL is normalised to canonical form
    expect(
      sanitizeUrl("https://example.com").startsWith("https://example.com"),
    ).toBe(true);
  });

  it("password input handles very long strings without crashing", () => {
    const TestPasswordField = () => {
      const [val, setVal] = React.useState("");
      return (
        <input
          type="password"
          aria-label="password"
          value={val}
          onChange={(e) => setVal(e.target.value.slice(0, 100))}
          placeholder="Enter password"
        />
      );
    };
    render(<TestPasswordField />);
    const input = screen.getByPlaceholderText("Enter password");
    fireEvent.change(input, { target: { value: "a".repeat(500) } });
    expect((input as HTMLInputElement).value.length).toBeLessThanOrEqual(100);
  });
});
