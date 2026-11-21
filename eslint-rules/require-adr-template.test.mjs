/**
 * eslint-rules/require-adr-template.test.mjs
 *
 * Unit suite for the ADR template guard. Covers both the original Spanish
 * template labels and their English equivalents, since the repository is being
 * translated to English and the rule must keep enforcing the SAME five
 * sections in either language (ADR-046 taught us the sections carry the ADR
 * registry's meaning, not just a heading).
 */
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import rule from "./require-adr-template.mjs";
import parser from "./lib/markdown-parser.mjs";

const linter = new Linter({ configType: "flat" });

function lint(text, filename = "docs/ADR-900-test.md") {
  return linter.verify(
    text,
    {
      plugins: { bmf: { rules: { "require-adr-template": rule } } },
      files: ["docs/ADR-*.md"],
      languageOptions: { parser },
      rules: { "bmf/require-adr-template": "error" },
    },
    { filename },
  );
}

const SPANISH = `# ADR-900: Título

- **Estado:** aceptado
- **Fecha:** 2026-09-12

## Contexto

Algo pasa.

## Decisión

Hacemos esto.

## Consecuencias

Fin.
`;

const ENGLISH = `# ADR-900: Title

- **Status:** accepted
- **Date:** 2026-09-12

## Context

Something happens.

## Decision

We do this.

## Consequences

Done.
`;

describe("require-adr-template", () => {
  it("accepts the five Spanish section labels", () => {
    expect(lint(SPANISH)).toEqual([]);
  });

  it("accepts the five English section labels", () => {
    expect(lint(ENGLISH)).toEqual([]);
  });

  it("accepts a file that mixes both languages across sections", () => {
    const mixed = `# ADR-900: Mixto

- **Estado:** aceptado
- **Date:** 2026-09-12

## Contexto

Algo.

## Decision

Doing it.

## Consequences

Fin.
`;
    expect(lint(mixed)).toEqual([]);
  });

  it("matches the accented Spanish heading (accent-insensitive lookup)", () => {
    // The regression this suite exists for: normalizing only the accepted
    // spellings (and not the scanned line) made `## Decisión` stop matching.
    const accented = ENGLISH.replace("## Decision", "## Decisión");
    expect(lint(accented)).toEqual([]);
  });

  it("accepts the English labels in bold-list form", () => {
    const boldList = `# ADR-900: Bold

- **Status:** accepted
- **Date:** 2026-09-12

**Context**

Algo.

**Decision**

Hacemos esto.

**Consequences**

Fin.
`;
    expect(lint(boldList)).toEqual([]);
  });

  it("reports all five sections when the template is absent", () => {
    const messages = lint("# ADR-900: Vacío\n\nNada aquí.\n");
    expect(messages).toHaveLength(5);
    for (const word of ["Estado", "Fecha", "Contexto", "Decisión", "Consecuencias"]) {
      expect(messages.some((m) => m.message.includes(`\`${word}\``))).toBe(true);
    }
  });

  it("requires a value on the Status/Date entries", () => {
    const emptyMeta = ENGLISH.replace("- **Status:** accepted", "- **Status:**")
      .replace("- **Date:** 2026-09-12", "- **Date:**");
    const messages = lint(emptyMeta);
    expect(messages).toHaveLength(2);
  });

  it("rejects a first heading whose number does not match the filename", () => {
    const mismatched = ENGLISH.replace("# ADR-900:", "# ADR-901:");
    expect(lint(mismatched, "docs/ADR-900-test.md").some((m) => m.messageId === "invalidHeader")).toBe(true);
  });

  it("ignores section headings inside fenced code blocks", () => {
    const fenced = `# ADR-900: Fenced

- **Status:** accepted
- **Date:** 2026-09-12

## Context

\`\`\`md
## Decisión
## Consecuencias
\`\`\`
`;
    const messages = lint(fenced);
    expect(messages.map((m) => m.messageId)).toContain("missingSection");
    expect(messages.filter((m) => m.message.includes("`Decisión`"))).toHaveLength(1);
  });

  it("does not apply to non-ADR markdown", () => {
    const notAnAdr = "# Guía\n\n## Contexto\n\nSin plantilla.\n";
    // The rule self-gates on the basename, so it must report no rule
    // violation for a plain Markdown file (any remaining message is ESLint
    // itself noting the file is outside the configured `files` glob).
    const messages = lint(notAnAdr, "docs/guia.md");
    expect(messages.filter((m) => m.ruleId === "bmf/require-adr-template")).toEqual([]);
  });
});