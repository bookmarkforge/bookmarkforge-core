// @vitest-environment node
/**
 * eslint-rules/require-adr-template.test.mjs
 *
 * RuleTester unit tests for bmf/require-adr-template. Cases are linted with
 * the trivial markdown parser (lib/markdown-parser.mjs) — the same one the
 * eslint.config.js block plugs in — and each case carries the `filename` the
 * rule self-gates on.
 */
import { describe } from "vitest";
import { RuleTester } from "eslint";
import markdownParser from "./lib/markdown-parser.mjs";
import rule from "./require-adr-template.mjs";

const ruleTester = new RuleTester({
  languageOptions: { parser: markdownParser },
});

// A complete, template-conformant ADR body used as the valid baseline.
const GOOD = [
  "# ADR-042: Temas de usuario solo-CSS",
  "",
  "- **Estado:** aceptado",
  "- **Fecha:** 2026-09-02",
  "",
  "## Contexto",
  "",
  "Los temas deben ser editables sin tocar el bundle.",
  "",
  "## Decisión",
  "",
  "D4 — temas solo-CSS con sanitización fail-closed.",
  "",
  "## Consecuencias",
  "",
  "El CSS de usuario se re-sanea en cada carga.",
].join("\n");

const withNumber = (n, rest) => GOOD.replace("ADR-042", `ADR-${n}`).replace(rest);

describe("require-adr-template", () => {
  ruleTester.run("require-adr-template", rule, {
    valid: [
      // Canonical repo format (bold metadata + H2 sections).
      { code: GOOD, filename: "docs/ADR-042-css-only-user-themes.md" },
      // Bold labels without colons and alternate bold placement.
      {
        code: GOOD.replace("- **Estado:** aceptado", "- **Estado** aceptado").replace(
          "- **Fecha:** 2026-09-02",
          "**Fecha: 2026-09-02**",
        ),
        filename: "docs/ADR-042-css-only-user-themes.md",
      },
      // Headings with colon, alternative level, and value inside the bold.
      {
        code: GOOD.replace("## Contexto", "### Contexto:").replace(
          "- **Fecha:** 2026-09-02",
          "- **Fecha: 2026-09-02**",
        ),
        filename: "docs/ADR-042-css-only-user-themes.md",
      },
      // Non-ADR Markdown is out of scope even when missing everything.
      { code: "# Notas\n\nalgo", filename: "docs/README.md" },
      { code: "# Notas\n\nalgo", filename: "docs/adr-index.md" },
      // ADR number without a slug suffix still self-gates.
      { code: GOOD, filename: "docs/ADR-042.md" },
      // Sections mentioned inside fenced blocks do not satisfy the template…
      // (covered in invalid); here: an ADR whose Decisión heading appears
      // after a code fence and is still detected.
      {
        code: GOOD.replace(
          "## Decisión",
          "```text\nno es un heading\n```\n\n## Decisión",
        ),
        filename: "docs/ADR-042-css-only-user-themes.md",
      },
    ],

    invalid: [
      // Missing everything (empty file): 5 missing sections + no valid
      // `# ADR-###:` header at all.
      {
        code: "",
        filename: "docs/ADR-099-incompleto.md",
        errors: [
          { messageId: "missingSection" },
          { messageId: "missingSection" },
          { messageId: "missingSection" },
          { messageId: "missingSection" },
          { messageId: "missingSection" },
          { messageId: "invalidHeader" },
        ],
      },
      // Missing one body section.
      {
        code: GOOD.replace("## Consecuencias", "## Impacto"),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "missingSection" }],
      },
      // Missing Estado.
      {
        code: GOOD.replace("- **Estado:** aceptado\n", ""),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "missingSection" }],
      },
      // Label-only Estado (no value).
      {
        code: GOOD.replace("- **Estado:** aceptado", "- **Estado:**"),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "missingEstadoValue" }],
      },
      // Label-only Fecha (no value).
      {
        code: GOOD.replace("- **Fecha:** 2026-09-02", "- **Fecha:**"),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "missingFechaValue" }],
      },
      // Empty heading section (heading exists, nothing below it).
      {
        code: `${GOOD.replace("## Consecuencias", "## Impacto")}\n\n## Consecuencias`,
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "emptySection" }],
      },
      // Header number disagrees with the filename (copy-paste failure).
      {
        code: withNumber("042", /999/g),
        filename: "docs/ADR-999-copiado.md",
        errors: [{ messageId: "invalidHeader" }],
      },
      // First heading is not an ADR header at all.
      {
        code: GOOD.replace("# ADR-042: Temas de usuario solo-CSS", "# Decisiones"),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "invalidHeader" }],
      },
      // Sections inside fenced code blocks do not count.
      {
        code: GOOD.replace("## Contexto", "```md\n## Contexto\n```"),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "missingSection" }],
      },
      // Case-insensitivity must not be exploited to skip a section: an
      // accented variant (Decision without accent) does not satisfy Decisión.
      {
        code: GOOD.replace("## Decisión", "## Decision"),
        filename: "docs/ADR-042-css-only-user-themes.md",
        errors: [{ messageId: "missingSection" }],
      },
    ],
  });
});
