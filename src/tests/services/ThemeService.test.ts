import { describe, it, expect, beforeEach } from "vitest";
import {
  sanitizeThemeCss,
  ThemeService,
} from "../../services/ThemeService";

const VALID_THEME = `
:root {
  --bg-primary: #101418;
  --text-primary: #e6edf3;
  --accent: #7dd3fc;
}
body { font-family: sans-serif; }
.card > .title { color: var(--accent); }
`;

describe("sanitizeThemeCss", () => {
  it("accepts a CSS-variable theme", () => {
    const result = sanitizeThemeCss(VALID_THEME);
    expect(result.ok).toBe(true);
    expect(result.css).toContain("--accent");
  });

  it("rejects an external @import", () => {
    expect(sanitizeThemeCss('@import url("https://evil.example/x.css");').ok).toBe(false);
  });

  it("rejects an external url()", () => {
    expect(sanitizeThemeCss("body { background: url(https://evil.example/t.gif); }").ok).toBe(false);
  });

  it("rejects CSS-escaped url()", () => {
    expect(sanitizeThemeCss("body { background: u\\72l(https://evil.example/t.gif); }").ok).toBe(false);
  });

  it("rejects comment-obfuscated url()", () => {
    expect(sanitizeThemeCss("body { background: u/**/rl(https://evil.example/t.gif); }").ok).toBe(false);
  });

  it("rejects legacy expression()", () => {
    expect(sanitizeThemeCss("body { width: expression(alert(1)); }").ok).toBe(false);
  });

  it("rejects legacy behavior:", () => {
    expect(sanitizeThemeCss("body { behavior: url(#default#time2); }").ok).toBe(false);
  });

  it("rejects javascript: scheme", () => {
    expect(sanitizeThemeCss("a { color: javascript:alert(1); }").ok).toBe(false);
  });

  it("rejects empty CSS", () => {
    expect(sanitizeThemeCss("   ").ok).toBe(false);
  });

  it("rejects CSS over the 64 KB limit", () => {
    expect(sanitizeThemeCss(`body{--x:"${"a".repeat(70 * 1024)}";}`).ok).toBe(false);
  });
});

describe("ThemeService", () => {
  let service: ThemeService;

  beforeEach(() => {
    service = new ThemeService();
    service.clear();
    localStorage.clear();
  });

  it("applies a valid theme into a dedicated <style> element", () => {
    const result = service.apply(VALID_THEME);
    expect(result.ok).toBe(true);

    const el = document.getElementById("bookmarkforge-user-theme");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("--accent");
    expect(service.getAppliedCss()).toContain("--accent");
  });

  it("does not apply a forbidden theme", () => {
    const result = service.apply("@import url('https://evil.example/x.css');");
    expect(result.ok).toBe(false);
    expect(document.getElementById("bookmarkforge-user-theme")).toBeNull();
  });

  it("clear removes the applied theme", () => {
    service.apply(VALID_THEME);
    service.clear();
    expect(document.getElementById("bookmarkforge-user-theme")).toBeNull();
    expect(service.getAppliedCss()).toBeNull();
  });

  it("save/load round-trips a sanitized theme", () => {
    expect(service.save(VALID_THEME).ok).toBe(true);
    expect(service.load()).toContain("--accent");
  });

  it("save rejects a forbidden theme and stores nothing", () => {
    expect(service.save("body{background:url(https://x.example/i.gif)}").ok).toBe(false);
    expect(service.load()).toBeNull();
  });

  it("load returns null for invalid persisted CSS", () => {
    localStorage.setItem("forge_user_theme_css", "body{width:expression(1)}");
    expect(service.load()).toBeNull();
  });

  it("removePersisted clears storage without touching the applied style", () => {
    service.apply(VALID_THEME);
    service.save(VALID_THEME);
    service.removePersisted();
    expect(service.load()).toBeNull();
    expect(service.getAppliedCss()).toContain("--accent");
  });
});
