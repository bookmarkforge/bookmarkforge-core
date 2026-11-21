import { describe, it, expect } from "vitest";
import { sanitizeThemeCss } from "../../services/ThemeService";

describe("manual CSS battery", () => {
  const cases: Array<[string, string, boolean]> = [
    // Valid themes users would actually write
    ["dark override", ":root { --accent-primary: #ff0000; --bg-card: #111; }", true],
    ["light theme vars", ":root, [data-theme='light'] { --bg-primary: #fff; --text-primary: #000; }", true],
    ["component tweak", ".bookmark-row { border-radius: 20px; } h1 { font-family: serif; }", true],
    ["media query", "@media (prefers-color-scheme: light) { :root { --bg-card: #eee; } }", true],
    ["supports query", "@supports (display: grid) { .x { display: grid; } }", true],
    ["keyframes", "@keyframes pulse { from { opacity: 0 } to { opacity: 1 } } .a { animation: pulse 1s; }", true],
    ["font-face local", "@font-face { font-family: X; src: local('Arial'); }", true],
    ["unicode-range", ":root { --x: '日本語 テスト'; }", true],
    ["calc + var", ".a { width: calc(var(--space-md) * 2); margin: -4px; }", true],
    ["important", ".a { color: red !important; }", true],
    ["empty-ish whitespace", "   \n  ", false],
    ["64KB boundary ok", "a".repeat(65000), true],
    ["64KB+1", "a".repeat(66000), false],
    // Malicious / forbidden
    ["import", "@import url('https://evil.com/x.css');", false],
    ["import obfuscated", "@im\\70 ort 'x';", false],
    ["url https", ".a { background: url(https://evil.com/t.png); }", false],
    ["url data", ".a { background: url(data:image/png;base64,AAA); }", false],
    ["url fragment", ".a { fill: url(#grad); }", false],
    ["url escaped", ".a { background: u\\72 l(evil); }", false],
    ["url comment split", ".a { background: u/**/rl(x); }", false],
    ["expression", ".a { width: expression(alert(1)); }", false],
    ["expression escaped", ".a { width: expr\\65 ssion(1); }", false],
    ["behavior", ".a { behavior: url(x.htc); }", false],
    ["javascript scheme", ".a { background: javascript:alert(1); }", false],
    ["js scheme escaped", ".a { x: java\\73 cript:alert(1); }", false],
    ["moz-binding", ".a { -moz-binding: url(x.xml); }", false],
    ["style breakout", "</style><script>alert(1)</script>", true], // textContent makes it inert CSS text
    ["html tags in css", "<img src=x onerror=alert(1)>", true], // inert: invalid CSS, ignored by parser
    ["css comment url", "/* url(evil) */ .a{color:red}", true], // comments stripped before check
    ["nested comment url", ".a{color:red} /* u/**/rl(x) */", true],
    ["charset", "@charset 'UTF-8'; :root{--a:1}", true],
    ["namespace", "@namespace url(http://www.w3.org/1999/xhtml);", false],
  ];

  for (const [name, css, shouldPass] of cases) {
    it(name, () => {
      const r = sanitizeThemeCss(css);
      expect(r.ok).toBe(shouldPass);
      if (r.ok) expect(r.css).toBeDefined();
    });
  }
});
