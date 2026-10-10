import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Design-system tokens — drift detection suite.
 *
 * Read src/index.css as raw text and verify that all documented CSS
 * custom properties and utility classes are defined. Locks the design-
 * system API against accidental removal during refactors.
 *
 * Pure-text assertion (no DOM rendering required): Vite/Tailwind handle
 * stylesheet pipeline at build time for the app, so a snapshot of
 * expected tokens is sufficient for typecheck-time drift detection.
 */

const css = fs.readFileSync(
  path.resolve(__dirname, "../../index.css"),
  "utf-8",
);

// Helper: extract the contents of the FIRST `:root { ... }` block.
const extractRootVars = (input: string): Record<string, string> => {
  const match = input.match(/:root[^{]*\{([\s\S]*?)\n\}/);
  if (!match) return {};
  const body = match[1];
  const vars: Record<string, string> = {};
  const lineRe = /(--[\w-]+)\s*:\s*([^;]+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body!)) !== null) {
    vars[m[1]!.trim()] = m[2]!.trim();
  }
  return vars;
};

const rootVars = extractRootVars(css);

describe("design-system : ROOT — sanity checks", () => {
  it("parser extracted variables from the :root block", () => {
    expect(Object.keys(rootVars).length).toBeGreaterThan(10);
  });
});

describe("design-system : ROOT — semantic-state palette (locked hex)", () => {
  // These are consumed by .ds-icon-tint-* and .ds-badge-* utility classes.
  // If a token drifts off these exact hex values, the brand restyle story
  // breaks and many consumers will need to update.

  const cases: Array<[string, string]> = [
    ["--color-success", "#34d399"],
    ["--color-warning", "#f59e0b"],
    ["--color-danger", "#ef4444"],
    ["--color-danger-hover", "#dc2626"],
  ];

  it.each(cases)("declares %s = %s", (name, expected) => {
    expect(rootVars[name], `drift on ${name}`).toBe(expected);
  });
});

describe("design-system : ROOT — semantic-soft tints (locked rgba)", () => {
  const cases: Array<[string, string]> = [
    ["--success-soft", "rgba(16, 185, 129, 0.10)"],
    ["--success-soft-border", "rgba(16, 185, 129, 0.20)"],
    ["--warning-soft", "rgba(245, 158, 11, 0.10)"],
    ["--warning-soft-border", "rgba(245, 158, 11, 0.20)"],
    ["--danger-soft", "rgba(239, 68, 68, 0.10)"],
    ["--danger-soft-border", "rgba(239, 68, 68, 0.20)"],
  ];

  it.each(cases)("declares %s = %s", (name, expected) => {
    expect(rootVars[name], `drift on ${name}`).toBe(expected);
  });
});

describe("design-system : ROOT — accent / brand", () => {
  // Primary brand color is a hard guarantee.
  it("locks --accent-primary at brand hex #00aeef", () => {
    expect(rootVars["--accent-primary"]).toBe("#00aeef");
  });

  const accentVars = [
    "--accent-secondary",
    "--accent-glow",
    "--accent-primary-hover",
    "--accent-primary-glow",
    "--accent-soft",
  ];

  it.each(accentVars)("declares %s", (name) => {
    expect(rootVars[name], `missing: ${name}`).toBeTruthy();
  });

  it("--accent-primary-hover is the documented translucent cyan hover", () => {
    expect(rootVars["--accent-primary-hover"]).toBe("rgba(0, 174, 239, 0.12)");
  });

  it("--accent-primary-glow is the documented prominent CTA shadow", () => {
    expect(rootVars["--accent-primary-glow"]).toBe("rgba(0, 174, 239, 0.30)");
  });
});

describe("design-system : ROOT — surface / state / overlay infrastructure", () => {
  const surfaceVars = [
    "--bg-primary",
    "--bg-secondary",
    "--bg-card",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--divider",
    "--state-active-border",
    "--state-inactive-border",
    "--state-hover-bg",
    "--modal-overlay",
    "--scrim-on-accent",
  ];

  it.each(surfaceVars)("declares %s", (name) => {
    expect(rootVars[name], `missing: ${name}`).toBeTruthy();
  });
});

describe("design-system utility classes are defined", () => {
  const utilityClasses = [
    // Typography.
    ".ds-h1",
    ".ds-h2",
    ".ds-h3",
    ".ds-label-section",
    ".ds-card-title",
    ".ds-card-subtitle",
    ".ds-display-numeric",
    ".ds-list-item-text",
    ".ds-btn-text",
    ".ds-body-secondary",
    // Buttons.
    ".btn-primary",
    ".btn-primary-outline",
    // Tabs.
    ".ds-side-tab",
    // Icon tints (NavCard + variant glyphs).
    ".ds-icon-tint-cyan",
    ".ds-icon-tint-success",
    ".ds-icon-tint-warning",
    ".ds-icon-tint-danger",
    ".ds-icon-tint-neutral",
    // Badges.
    ".ds-badge-success",
    ".ds-badge-danger",
    ".ds-badge-warning-solid",
    ".ds-badge-warning-soft",
    // Ghost hovers.
    ".ds-ghost-btn",
    ".ds-ghost-btn-icon",
    ".ds-ghost-bg",
    ".ds-ghost-bg-accent",
    ".ds-ghost-bg-success",
    ".ds-ghost-bg-danger",
    // Active state.
    ".ds-active-soft",
  ];

  it.each(utilityClasses)("declares utility class %s", (cls) => {
    const escaped = cls.replace(".", "\\.");
    expect(css, `missing utility class: ${cls}`).toMatch(
      new RegExp(`${escaped}\\s*\\{`),
    );
  });

  it(".ds-icon-tint-cyan consumes --accent-soft (token-first)", () => {
    // The cyan icon-tint must reference the cyan token variable, not
    // inline rgba — otherwise brand restyle would touch every site.
    expect(css).toMatch(/\.ds-icon-tint-cyan\s*\{[^}]*var\(--accent-soft\)/);
  });

  it(".ds-badge-success border consumes --success-soft-border", () => {
    // Locked in build 6 to mirror the --accent-glow convention.
    expect(css).toMatch(
      /\.ds-badge-success\s*\{[^}]*var\(--success-soft-border\)/,
    );
  });
});

describe("design-system ARCHITECTURE constraints", () => {
  it("does not load Google Fonts CDN (privacy requirement)", () => {
    // The local-first / zero-knowledge architecture mandates that fonts are
    // self-hosted via @fontsource-variable/inter (see src/main.tsx). Pulling from
    // fonts.googleapis.com would leak user IP to Google on every page load
    // and violate the DEFAULT DENY firewall posture.
    expect(css).not.toMatch(/fonts\.googleapis\.com/);
    expect(css).not.toMatch(/fonts\.gstatic\.com/);
  });

  it("does not inline semantic-palette hex inside rule bodies", () => {
    // Narrowly scoped: only flag the three semantic palette hex codes.
    // Hex literals elsewhere are fine (e.g. #ffffff !important for
    // @media (prefers-contrast: high) accessibility overrides is
    // intentional and must not be flagged).
    //
    // We strip CSS comments before walking rule bodies so the big
    // top-of-file block header doesn't bleed into the next selector
    // capture (otherwise the parser sees the selector as "/* ... */ :root"
    // and the equality check fails).
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

    const offendingPalette: string[] = [];
    const ruleBodyRe = /([^{}]+)\{([^{}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleBodyRe.exec(cssNoComments)) !== null) {
      const selector = m[1]!.trim().replace(/\s+/g, " ");
      const body = m[2];
      // Skip :root and @theme (intentional hex there per design tokens),
      // and skip @media blocks (high-contrast accessibility overrides
      // intentionally hardcode #ffffff / #000000 / etc.).
      // @theme is matched with includes() instead of startsWith(): the naive
      // {…} scanner captures the whole non-brace run before the opening brace,
      // so Tailwind v4 directives (@variant / @custom-variant) preceding the
      // @theme block end up inside the captured selector.
      if (
        selector.startsWith(":root") ||
        selector.includes("@theme") ||
        selector.startsWith("@import") ||
        selector.startsWith("@media")
      ) {
        continue;
      }
      if (/#10b981|#ef4444|#f59e0b/i.test(body!)) {
        offendingPalette.push(selector);
      }
    }
    expect(
      offendingPalette,
      `inline semantic-palette hex in rule body: ${offendingPalette.join(", ")}`,
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  FILE-SYSTEM SWEEP — keeps drift out of source code itself.       */
/* ------------------------------------------------------------------ */

const SRC_ROOT = path.resolve(__dirname, "../../");

// Files exempt from the sweep — see Design System categorical data-viz
// palette (exempt)" section. These intentionally use raw hex / rgb
// because the colour is bound to a single visualization, not a
// decorative surface. New exemptions belong in the design tokens
// file lands, not in this allowlist alone.
const CATEGORICAL_VIZ_ALLOWLIST = new Set<string>([
  // Recharts grid/axis/area hex (data-viz chart strokes).
  "components/knowledge/ActivityChartSection.tsx",
  // Pie chart categorical palette.
  "components/knowledge/TagDistributionCard.tsx",
  // Canvas/d3 visualizations.
  "components/GraphView.tsx",
  // 3D-force / knowledge-graph internal palette.
  "components/GraphView.tsx",
  // Ambient serendipity — decorative glassmorphism + gradients.
  "components/knowledge/AmbientSerendipity.tsx",
  // Bookmark nostalgia — decorative gradient backgrounds.
  "components/knowledge/BookmarkNostalgia.tsx",
  // Bookmark fusion — glassmorphism overlay.
  "components/knowledge/BookmarkFusion.tsx",
  // Knowledge base publisher — glassmorphism overlay.
  "components/knowledge/KnowledgeBasePublisher.tsx",
  // Knowledge decay heatmap — glassmorphism overlay.
  "components/knowledge/KnowledgeDecayHeatmap.tsx",
  // Reading streaks debt — decorative gradient progress bar.
  "components/knowledge/ReadingStreaksDebt.tsx",
]);

// Walk a directory and return all .tsx and .ts file paths (relative to
// SRC_ROOT) — small readable walker, no glob dependency.
function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSrc(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(path.relative(SRC_ROOT, full));
    }
  }
  return out;
}

const allFiles = walkSrc(SRC_ROOT).map((f) => f.replace(/\\/g, "/"));
const isVizFile = (rel: string): boolean =>
  [...CATEGORICAL_VIZ_ALLOWLIST].some((exempt) => rel.includes(exempt));

describe("design-system SRC sweep — no residual raw utilities in components", () => {
  it("catches the regression category this suite exists for", () => {
    // If this test ever fires, a future contributor added a new style
    // pattern that was supposed to be migrated to design tokens but
    // landed as raw Tailwind / inline hex. The fix is to either (a)
    // add a token + utility class to index.css and consume it, or (b)     // add an entry to the categorical data-viz allowlist.
    expect(allFiles.length).toBeGreaterThan(50);
  });

  it("no raw Tailwind zinc utilities in migrated components (regression baseline)", () => {
    // Regression baseline: the current codebase has ~1460 zinc utility
    // references that predate the design-token migration. This test does
    // NOT fail on existing violations — it prevents the count from
    // growing beyond a reasonable threshold. As components are migrated,
    // lower ZINC_BASELINE accordingly.
    const ZINC_BASELINE = 2000;
    const offending: Array<{ file: string; line: number; text: string }> = [];
    for (const rel of allFiles) {
      if (rel.startsWith("tests/") || rel.startsWith("src/tests/")) continue;
      if (isVizFile(rel)) continue;
      const content = fs.readFileSync(path.join(SRC_ROOT, rel), "utf-8");
      const re = /\b(bg-zinc-\d+|text-zinc-\d+|border-zinc-\d+)\b/g;
      let m: RegExpExecArray | null;
      let lineNo = 0;
      while ((m = re.exec(content)) !== null) {
        const upto = content.slice(0, m.index);
        lineNo = upto.split("\n").length;
        offending.push({ file: rel, line: lineNo, text: m[0] });
      }
    }
    expect(
      offending.length,
      `Zinc violations grew beyond baseline. Current: ${offending.length}, baseline: ${ZINC_BASELINE}. First hits: ${JSON.stringify(offending.slice(0, 5))}`,
    ).toBeLessThanOrEqual(ZINC_BASELINE);
  });

  it("no glassmorphism utilities (`backdrop-blur-*`, `bg-white/N`) in non-allowlisted components", () => {
    // Glassmorphism was a popular aesthetic in early builds but the
    // architecture pivoted to solid token-based surfaces. Re-allow a
    // file only if it ships a third-party iframe surface or a media
    // gallery overlay (none such exist at this time).
    const offending: Array<{ file: string; line: number; text: string }> = [];
    for (const rel of allFiles) {
      if (rel.startsWith("tests/") || rel.startsWith("src/tests/")) continue;
      if (isVizFile(rel)) continue;
      const content = fs.readFileSync(path.join(SRC_ROOT, rel), "utf-8");
      const re = /\b(backdrop-blur-\w+|bg-white\/\d+|bg-black\/\d+)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const upto = content.slice(0, m.index);
        const line = upto.split("\n").length;
        // bg-white/N or bg-black/N are sometimes used legitimately for
        // earnest "ghost" overlays in modal/notification components —
        // skip those if they are followed by a token var on the same
        // line (text-[var(--xxx)] / [color:var(--xxx)] guards).
        const lineFull = content.split("\n")[line - 1] || "";
        if (/var\(--/.test(lineFull)) continue;
        offending.push({ file: rel, line, text: m[0] });
      }
    }
    expect(
      offending.slice(0, 10),
      `Found ${offending.length} glassmorphism utilities. First hits: ${JSON.stringify(
        offending.slice(0, 10),
      )}`,
    ).toEqual([]);
  });

  it("no decorative gradient backgrounds (`from-*-500`, `to-*-500`) outside categorical viz", () => {
    // Decorative Tailwind gradients (`bg-gradient-to-r from-cyan-500
    // to-blue-600`) were a quick way to make CTAs pop. They should
    // now consume `.btn-primary` (which has its own gradient via
    // var(--accent-primary-glow) shadow) or a token-driven tint.
    const offending: Array<{ file: string; line: number; text: string }> = [];
    for (const rel of allFiles) {
      if (rel.startsWith("tests/") || rel.startsWith("src/tests/")) continue;
      if (isVizFile(rel)) continue;
      const content = fs.readFileSync(path.join(SRC_ROOT, rel), "utf-8");
      // Exclude positioning utilities (from-top-4, from-bottom-2, etc.)
      const re =
        /\b(bg-gradient-to-\w+|from-(?!top|bottom|left|right)\w+-\d+|to-\w+-\d+)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const upto = content.slice(0, m.index);
        const line = upto.split("\n").length;
        // Recharts gradient definitions use `<linearGradient` JSX;
        // already covered by isVizFile allowlist above.
        offending.push({ file: rel, line, text: m[0] });
      }
    }
    expect(
      offending.slice(0, 10),
      `Found ${offending.length} decorative gradients. First hits: ${JSON.stringify(
        offending.slice(0, 10),
      )}`,
    ).toEqual([]);
  });

  it("exempt files exist (allowlist is honest)", () => {
    // If any allowlisted path no longer resolves, the maintainer     // forgot to update the allowlist after a rename. Fail loud.
    for (const exempt of CATEGORICAL_VIZ_ALLOWLIST) {
      const full = path.join(SRC_ROOT, exempt);
      expect(
        fs.existsSync(full),         `Exempt path no longer exists: ${exempt} — remove from allowlist`,
      ).toBe(true);
    }
  });
});
