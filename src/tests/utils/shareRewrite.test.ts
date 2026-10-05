import { describe, it, expect } from "vitest";
import { computeShareRewrite } from "../../utils/shareRewrite";

describe("computeShareRewrite", () => {
  describe("share_target delivery (mobile share sheet)", () => {
    it("should promote ?url=, ?title=, ?text= from search to hash", () => {
      const result = computeShareRewrite("url=https://example.com&title=Test&text=Hello", "#", "/");
      expect(result.path).toBe("/capture");
      expect(result.search).toBe("");
      expect(result.hash).toBe("url=https%3A%2F%2Fexample.com&title=Test&text=Hello");
      expect(result.rewrote).toBe(true);
    });

    it("should preserve existing hash params and promote search params", () => {
      const result = computeShareRewrite("url=https://example.com&title=Test", "#existing=param", "/");
      expect(result.path).toBe("/capture");
      expect(result.search).toBe("");
      expect(result.hash).toBe("existing=param&url=https%3A%2F%2Fexample.com&title=Test");
      expect(result.rewrote).toBe(true);
    });

    it("should not rewrite when no share params present", () => {
      const result = computeShareRewrite("foo=bar", "#baz=qux", "/dashboard");
      expect(result.path).toBe("/dashboard");
      expect(result.search).toBe("foo=bar");
      expect(result.hash).toBe("baz=qux");
      expect(result.rewrote).toBe(false);
    });

    it("should force /capture path when #url= present (share_target delivery)", () => {
      const result = computeShareRewrite("", "#url=https://example.com", "/app");
      expect(result.path).toBe("/capture");
      expect(result.hash).toBe("url=https%3A%2F%2Fexample.com");
      expect(result.rewrote).toBe(true);
    });

    it("should not double-force /capture when already on /capture", () => {
      const result = computeShareRewrite("url=https://example.com", "#", "/capture");
      expect(result.path).toBe("/capture");
      expect(result.rewrote).toBe(true);
    });

    it("should handle empty values gracefully", () => {
      const result = computeShareRewrite("url=&title=", "#", "/");
      expect(result.path).toBe("/");
      expect(result.rewrote).toBe(false);
    });
  });

  describe("protocol handler / extension delivery (?add=)", () => {
    it("should map ?add= to #url= and force /capture", () => {
      const result = computeShareRewrite("add=https://example.com", "#", "/");
      expect(result.path).toBe("/capture");
      expect(result.search).toBe("");
      expect(result.hash).toBe("url=https%3A%2F%2Fexample.com");
      expect(result.rewrote).toBe(true);
    });

    it("should remove ?add= from search params", () => {
      const result = computeShareRewrite("add=https://example.com&foo=bar", "#", "/");
      expect(result.search).toBe("foo=bar");
      expect(result.hash).toBe("url=https%3A%2F%2Fexample.com");
    });

    it("should preserve existing hash params when handling ?add=", () => {
      const result = computeShareRewrite("add=https://example.com", "#existing=param", "/");
      expect(result.hash).toBe("existing=param&url=https%3A%2F%2Fexample.com");
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings", () => {
      const result = computeShareRewrite("", "", "/");
      expect(result.path).toBe("/");
      expect(result.search).toBe("");
      expect(result.hash).toBe("");
      expect(result.rewrote).toBe(false);
    });

    it("should handle URL encoding correctly", () => {
      const result = computeShareRewrite("url=https://example.com/path?foo=bar", "#", "/");
      expect(result.hash).toBe("url=https%3A%2F%2Fexample.com%2Fpath%3Ffoo%3Dbar");
    });

    it("should handle special characters in title and text", () => {
      const result = computeShareRewrite("title=Test%20Title&text=Hello%20World%21", "#", "/");
      expect(result.hash).toBe("title=Test+Title&text=Hello+World%21");
    });

    it("should not modify search params other than url/title/text/add", () => {
      const result = computeShareRewrite("url=https://example.com&other=value&another=123", "#", "/");
      expect(result.search).toBe("other=value&another=123");
    });
  });
});
