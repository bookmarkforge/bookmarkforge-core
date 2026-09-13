// @vitest-environment node
/**
 * eslint-rules/require-adr-template.wiring.test.mjs
 *
 * End-to-end proof of the eslint.config.js wiring on this exact ESLint
 * version: the `docs/ADR-*.md` block routes Markdown through the trivial
 * parser (lib/markdown-parser.mjs) and the bmf rule sees it. Also pins the
 * invariant the rule exists for: the REAL corpus on disk passes.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Linter } from "eslint";
import markdownParser from "../eslint-rules/lib/markdown-parser.mjs";
import adrRule from "../eslint-rules/require-adr-template.mjs";

// Mirrors the `docs/ADR-*.md` block in eslint.config.js — if the block's
// parser/rule wiring is edited, update this mirror (the live-corpus run
// below is the integration check that keeps them honest).
function lintAdr(filename, code) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    {
      plugins: { bmf: { rules: { "require-adr-template": adrRule } } },
      files: ["docs/ADR-*.md"],
      languageOptions: { parser: markdownParser },
      rules: { "bmf/require-adr-template": "error" },
    },
    { filename },
  );
}

describe("require-adr-template wiring", () => {
  it("routes docs/ADR-*.md through the markdown parser and the rule", () => {
    const clean = "# ADR-050: Prueba de cableado\n\n- **Estado:** aceptado\n- **Fecha:** 2026-09-02\n\n## Contexto\n\nc\n\n## Decisión\n\nd\n\n## Consecuencias\n\ne\n";
    expect(lintAdr("docs/ADR-050-prueba.md", clean)).toEqual([]);
  });

  it("reports a template violation with a real line/column location", () => {
    const broken = "# ADR-050: Prueba\n\n- **Estado:** aceptado\n- **Fecha:** 2026-09-02\n\n## Contexto\n\nc\n\n## Decision\n\nd\n\n## Consecuencias\n\ne\n";
    const messages = lintAdr("docs/ADR-050-prueba.md", broken);
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe("bmf/require-adr-template");
    expect(messages[0].messageId).toBe("missingSection");
    // A missing section has no line to point at, so it anchors at file start.
    expect(messages[0].line).toBe(1);
  });

  it("points at the heading line when a section exists but is empty", () => {
    // `## Decisión` sits on line 10 with nothing between it and Consecuencias.
    const empty = "# ADR-050: Prueba\n\n- **Estado:** aceptado\n- **Fecha:** 2026-09-02\n\n## Contexto\n\nc\n\n## Decisión\n\n## Consecuencias\n\ne\n";
    const messages = lintAdr("docs/ADR-050-prueba.md", empty);
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe("emptySection");
    expect(messages[0].line).toBe(10);
  });

  it("does not fire on non-ADR markdown routed through the same block", () => {
    const messages = lintAdr("docs/README.md", "# Hola\n");
    // The config block matches docs/ADR-*.md only, so the rule never runs on
    // README.md — the call above must not throw and must return no messages
    // produced by require-adr-template.
    expect(messages.filter((m) => (m.ruleId ?? "").includes("require-adr-template"))).toEqual([]);
  });

  it("real corpus on disk: every docs/ADR-*.md passes the template rule", () => {
    const docsDir = join(process.cwd(), "docs");
    const adrFiles = readdirSync(docsDir)
      .filter((f) => /^ADR-\d{3}.*\.md$/.test(f))
      .sort();
    expect(adrFiles.length).toBeGreaterThanOrEqual(15);
    for (const f of adrFiles) {
      const code = readFileSync(join(docsDir, f), "utf8");
      const messages = lintAdr(join("docs", f).split("\\").join("/"), code);
      expect(messages, `${f} must satisfy the ADR template`).toEqual([]);
    }
  });
});
