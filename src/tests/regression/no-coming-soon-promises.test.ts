import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Out-of-plan promises guard (roadmap non-goals, docs/ROADMAP.md) — repo-wide
 * extension of the tier-copy guard in src/tests/constants/pricing.test.ts.
 *
 * User-facing copy must never promise features that are not in the plan.
 * The "coming soon" family is the tell: pricing.html shipped disabled
 * Team/Empresa cards with "Coming Soon" buttons for tiers that do not exist
 * in the license engine (LicenseService only knows free|pro), and tier copy
 * once contained "Basic collaboration (coming soon)". The Spanish leak
 * (`próximamente`/`proximamente`) is scanned because that exact page mixed
 * Spanish into an English landing.
 *
 * Scope:
 *   - src/**\/*.{ts,tsx}  (UI strings, diagnostics panel) — comments stripped,
 *     tests and src/tests/ excluded
 *   - public/**\/*.html   (landings, root pages) — HTML comments stripped
 *   - public/locales/*.json (app UI strings, 30 languages) — an English
 *     "coming soon" literal anywhere is either an untranslated leak or the
 *     original promise; both are violations
 *
 * Allowed: documented non-goal comments (stripped as comments), support
 * response-time copy ("as soon as possible"), the guard's own file, and the
 * single committed roadmap feature that ships with a "coming soon" label
 * (Local AI Translation — the Pro hook in the pricing matrix).
 *
 * [i18n-allow: "próximamente" is the Spanish coming-soon token this guard
 * exists to match — it must not appear in user-facing copy.]
 */
const PROMISE_RE = /\bcoming\s+soon\b/gi;
const SPANISH_LEAK_RE = /\bpr[oó]ximamente\b/gi;
const ADMIN_PANEL_RE = /\badmin\s+panel\b/gi;
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: PROMISE_RE, label: '"coming soon"' },
  { re: SPANISH_LEAK_RE, label: '"próximamente" (Spanish coming-soon leak)' },
  { re: ADMIN_PANEL_RE, label: '"admin panel"' },
];

/** Benign phrases that must never be flagged (support copy, not promises). */
const BENIGN = [/\bas soon as possible\b/i];

/**
 * Committed roadmap feature with a dated "coming soon" label.
 *
 * Local AI Translation is not an out-of-plan promise: it is listed in the Pro
 * column of the pricing matrix ("✅ Local AI Translation (Coming Soon)") and
 * shipped here as the Pro hook. The exemption is deliberately phrase-scoped —
 * only a context that names THIS feature may say "coming soon"; every other
 * promise (Team/Empresa tiers, collaboration, admin panel) still fails.
 */
const PLANNED_FEATURE_RE =
  /(?:local\s+)?ai\s+translation|traducci[oó]n\s+con\s+ia\s+local/i;

function stripTsComments(src: string): string {
  // Crude but sufficient for a promise scan: block + line comments. A string
  // containing "//" (e.g. a URL) could lose the rest of its line — acceptable
  // false-negative risk for a regression guard.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

/**
 * The app-side label of the SAME committed roadmap feature (Local AI
 * Translation). The app namespace cannot repeat "AI translation" in every
 * translation, so the exemption is key-scoped: only the value of these exact
 * keys may say "coming soon", and every other promise still fails. This is
 * not a blanket translation exemption.
 */
const COMMITTED_TRANSLATION_KEYS = ["app_translatorComingSoon", "app_comingSoon"];

function lineAt(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const end = content.indexOf("\n", index);
  return content.slice(start, end === -1 ? undefined : end);
}

function isBenign(text: string): boolean {
  return BENIGN.some((re) => re.test(text)) || PLANNED_FEATURE_RE.test(text);
}

function collectViolations(content: string, file: string): string[] {
  const out: string[] = [];
  for (const { re, label } of PATTERNS) {
    for (const m of content.matchAll(re)) {
      const ctx = content.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ");
      if (isBenign(ctx)) continue;
      // Key-scoped exemption: the committed Local AI Translation feature also
      // ships as an app label with no room for the words "AI translation".
      const line = lineAt(content, m.index);
      if (COMMITTED_TRANSLATION_KEYS.some((key) => line.includes(`"${key}"`))) {
        continue;
      }
      out.push(`${file}: ${label} → …${ctx}…`);
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "tests" || name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (
      name.endsWith(".ts") ||
      name.endsWith(".tsx") ||
      name.endsWith(".html")
    ) {
      out.push(p);
    }
  }
  return out;
}

describe("regression/no-coming-soon-promises", () => {
  it("never promises out-of-plan features via 'coming soon' in src/ or public/", () => {
    const violations: string[] = [];
    const root = process.cwd();

    // src/ TypeScript sources (UI strings, diagnostics), comments stripped.
    for (const file of walk(join(root, "src"))) {
      if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
      const src = readFileSync(file, "utf8");
      violations.push(...collectViolations(stripTsComments(src), relative(root, file)));
    }

    // public/ HTML (landings + root pages), HTML comments stripped.
    for (const file of walk(join(root, "public"))) {
      if (!file.endsWith(".html")) continue;
      const html = readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, " ");
      violations.push(...collectViolations(html, relative(root, file)));
    }

    // public/locales/*.json — app UI strings in all 30 languages.
    const localesDir = join(root, "public", "locales");
    for (const name of readdirSync(localesDir)) {
      if (!name.endsWith(".json")) continue;
      const file = join(localesDir, name);
      const json = readFileSync(file, "utf8");
      violations.push(...collectViolations(json, relative(root, name)));
    }

    expect(
      violations,
      `user-facing copy must not promise out-of-plan features ` +
        `(coming soon / próximamente / admin panel) — ROADMAP non-goal: ` +
        `"Don't chase Notion-style collaboration; the private individual is ` +
        `the market". Regression anchor: pricing.html shipped disabled ` +
        `Team/Empresa cards with "Coming Soon" buttons for tiers that do ` +
        `not exist in the license engine.`,
    ).toEqual([]);
  });
});
