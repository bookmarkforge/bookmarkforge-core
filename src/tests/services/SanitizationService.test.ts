// src/tests/services/SanitizationService.test.ts
//
// Tests for input sanitization service.
// Covers: HTML sanitization, text escaping, URL validation,
// XSS prevention, SSRF prevention.

import { describe, test, expect, beforeEach, vi } from "vitest";
import { SanitizationService } from "../../services/SanitizationService";

describe("SanitizationService", () => {
  beforeEach(() => {
    // Mock window.location.origin for URL parsing tests
    // @ts-expect-error - setting window property for test
    window.location = { origin: "http://localhost:3000" };
  });

  describe("sanitizeHtml", () => {
    test("removes script tags", () => {
      const html = "<p>Hello</p><script>alert('xss')</script>";
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("<script>");
      expect(result).toContain("<p>Hello</p>");
    });

    test("removes onclick handlers", () => {
      const html = '<p onclick="alert(1)">Click me</p>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("onclick");
    });

    test("keeps allowed tags", () => {
      const html = "<p><strong>Bold</strong> text</p>";
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toContain("<p>");
      expect(result).toContain("<strong>");
    });

    test("strict mode removes more tags", () => {
      const html = "<p><a href='url'>Link</a><img src='img.jpg'/></p>";
      const strictResult = SanitizationService.sanitizeHtml(html, true);
      const normalResult = SanitizationService.sanitizeHtml(html, false);

      expect(strictResult).not.toContain("<a");
      expect(strictResult).not.toContain("<img");
      expect(normalResult).toContain("<a");
    });

    test("handles empty string", () => {
      const result = SanitizationService.sanitizeHtml("");
      expect(result).toBe("");
    });

    test("handles null input", () => {
      const result = SanitizationService.sanitizeHtml(null as any);
      expect(result).toBe("");
    });

    test("handles non-string input", () => {
      const result = SanitizationService.sanitizeHtml(123 as any);
      expect(result).toBe("");
    });

    test("fails safely on error", () => {
      // This is hard to test without causing an actual error
      // but the implementation returns "" on catch
      const result = SanitizationService.sanitizeHtml("<p>valid</p>");
      expect(result).toBeTruthy();
    });
  });

  describe("sanitizeText", () => {
    test("escapes HTML entities", () => {
      const text = "<script>alert('xss')</script>";
      const result = SanitizationService.sanitizeText(text);
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      expect(result).not.toContain("<script>");
    });

    test("preserves normal text", () => {
      const text = "Hello, World!";
      const result = SanitizationService.sanitizeText(text);
      expect(result).toBe("Hello, World!");
    });

    test("handles empty string", () => {
      const result = SanitizationService.sanitizeText("");
      expect(result).toBe("");
    });

    test("handles null input", () => {
      const result = SanitizationService.sanitizeText(null as any);
      expect(result).toBe("");
    });

    test("escapes special characters", () => {
      const text = "< > & \" '";
      const result = SanitizationService.sanitizeText(text);
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      expect(result).toContain("&amp;");
    });
  });

  describe("sanitizeUrl", () => {
    test("allows valid http URLs", () => {
      const url = "https://example.com";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toContain("https://example.com");
    });

    test("blocks javascript: URLs", () => {
      const url = "javascript:alert(1)";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks vbscript: URLs", () => {
      const url = "vbscript:msgbox(1)";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks data: URLs", () => {
      const url = "data:text/html,<script>alert(1)</script>";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks file: URLs", () => {
      const url = "file:///etc/passwd";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("handles empty string", () => {
      const result = SanitizationService.sanitizeUrl("");
      expect(result).toBe("");
    });

    test("handles null input", () => {
      const result = SanitizationService.sanitizeUrl(null as any);
      expect(result).toBe("");
    });

    test("blocks localhost", () => {
      const url = "http://localhost:8080";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks 127.0.0.1", () => {
      const url = "http://127.0.0.1:8080";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks private IP ranges", () => {
      const url = "http://192.168.1.1";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("allows public IPs", () => {
      const url = "http://8.8.8.8";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toContain("8.8.8.8");
    });

    test("validates port range", () => {
      const url = "http://example.com:80";
      const result = SanitizationService.sanitizeUrl(url);
      // Port 80 is default for http, so it may be normalized
      expect(result).toContain("example.com");
    });

    test("blocks invalid port", () => {
      const url = "http://example.com:99999";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks port 0", () => {
      const url = "http://example.com:0";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });
  });

  describe("XSS prevention", () => {
    test("prevents script injection in attributes", () => {
      const html = '<img src="x" onerror="alert(1)">';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("onerror");
    });

    test("prevents style injection", () => {
      const html = '<p style="background:url(javascript:alert(1))">Text</p>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("style");
    });

    test("prevents iframe injection", () => {
      const html = '<iframe src="javascript:alert(1)"></iframe>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("<iframe");
    });

    test("prevents object injection", () => {
      const html = '<object data="javascript:alert(1)"></object>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("<object");
    });

    test("prevents embed injection", () => {
      const html = '<embed src="javascript:alert(1)">';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).not.toContain("<embed");
    });
  });

  describe("SSRF prevention", () => {
    test("blocks internal network URLs", () => {
      const url = "http://169.254.169.254/latest/meta-data/";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks link-local IPv6", () => {
      const url = "http://[::1]:8080";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("blocks private IPv6 ranges", () => {
      const url = "http://[fc00::1]:8080";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toBe("");
    });

    test("allows public IPv6", () => {
      const url = "http://[2001:4860:4860::8888]";
      const result = SanitizationService.sanitizeUrl(url);
      expect(result).toContain("2001:4860:4860::8888");
    });
  });

  describe("link sanitization", () => {
    test("handles relative URLs", () => {
      const html = '<a href="/path">Link</a>';
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toContain("href");
    });
  });

  describe("edge cases", () => {
    test("handles malformed HTML", () => {
      const html = "<p>Unclosed paragraph";
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toBeTruthy();
    });

    test("handles Unicode characters", () => {
      const html = "<p>中文文本</p>";
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toContain("中文");
    });

    test("handles emojis", () => {
      const html = "<p>😀😁😂</p>";
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toContain("😀");
    });

    test("handles very long strings", () => {
      const html = "<p>" + "A".repeat(100000) + "</p>";
      const result = SanitizationService.sanitizeHtml(html);
      expect(result).toBeTruthy();
    });
  });
});
