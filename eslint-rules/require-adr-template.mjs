/**
 * eslint-rules/require-adr-template.mjs
 *
 * Structural guard for the ADR registry (AGENTS.md section 2): every
 * `docs/ADR-###-*.md` file must carry the five template sections the repo
 * standardized on — Estado / Fecha / Contexto / Decisión / Consecuencias —
 * so decisions stay scannable and the audit-anchor catalog can cite them.
 *
 * Accepted forms (matches every ADR on disk today):
 *   - `**Estado:** aceptado` / `- **Estado:** aceptado`  (bold list item —
 *     also `**Estado** : value` and `**Estado: value**`)
 *   - `## Contexto` up to `###### Contexto`              (heading; the
 *     section must not be empty below the heading)
 *
 * The rule is fence-aware: a `## Decisión` inside a ``` block does not
 * count, and headings inside fences do not terminate a section scan.
 *
 * Additionally enforced (filename ↔ content coherence, the failure mode of
 * copy-pasted ADR files):
 *   - the first heading is `# ADR-###: <título>` and its number matches the
 *     filename (`docs/ADR-042-*.md` ⇒ `# ADR-042: …`);
 *   - `Estado` and `Fecha` entries carry a value, not just the label.
 *
 * Non-ADR Markdown is out of scope: the rule self-gates on the basename
 * (`ADR-###[-slug].md`), so any other `.md` file passes untouched.
 *
 * Scope is wired in eslint.config.js over `docs/ADR-*.md` with the trivial
 * parser in `lib/markdown-parser.mjs`, and ships at `error` — the corpus is
 * clean today (verified over all 15 ADRs), so any new ADR missing the
 * template breaks `npm run lint`.
 */
export const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the Estado/Fecha/Contexto/Decisión/Consecuencias template sections in every docs/ADR-*.md file.",
      recommended: false,
    },
    schema: [],
    messages: {
      missingSection:
        "ADR file is missing the required `{{section}}` section ({{found}}/{{total}} present: Estado, Fecha, Contexto, Decisión, Consecuencias). Follow the repo template — see docs/ADR-001-check-static-brand.md.",
      emptySection:
        "The `{{section}}` section exists but has no content below its heading.",
      missingEstadoValue:
        "The `Estado` entry has no value — record the decision status (e.g. `aceptado`).",
      missingFechaValue:
        "The `Fecha` entry has no value — record the decision date (e.g. `2026-09-02`).",
      invalidHeader:
        "The first heading must be `# ADR-###: <título>` with the number matching the filename `docs/ADR-###-slug.md` (expected ADR-{{expected}}, found: {{found}}).",
    },
  },

  create(context) {
    const filename = typeof context.filename === "string" ? context.filename : "";
    const base = filename.split(/[\\/]/).pop() ?? "";
    // Self-gate: only ADR files. Any other Markdown passes untouched.
    const fileMatch = /^ADR-(\d{3})(?:-[\w-]*)?\.md$/i.exec(base);
    if (!fileMatch) return {};
    const expectedNumber = fileMatch[1];

    const sourceCode = context.sourceCode || context.getSourceCode();
    const ast = sourceCode.ast;
    const lines = sourceCode.lines ?? sourceCode.getText().split(/\r\n|\r|\n/);
    const nodeAtLine = (line) => ast.body[Math.max(0, Math.min(line - 1, ast.body.length - 1))];

    // ── fence-aware line scan ────────────────────────────────────────────
    let inFence = false;
    const info = lines.map((raw) => {
      const trimmed = raw.trim();
      const entry = { raw, trimmed, inFence };
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inFence = !inFence;
      }
      return entry;
    });

    // ── section finders ──────────────────────────────────────────────────
    const boldRe = (w) =>
      new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*\\s*${w}\\s*:?\\s*\\*\\*\\s*:?(.*)$`, "i");
    const boldValueInsideRe = (w) =>
      new RegExp(`^\\s*(?:[-*+]\\s+)?\\*\\*\\s*${w}\\s*:\\s*(.+?)\\s*\\*\\*\\s*$`, "i");
    const headingRe = (w) => new RegExp(`^#{1,6}\\s+${w}\\s*:?\\s*$`, "i");

    function findBoldSection(word) {
      for (let i = 0; i < info.length; i++) {
        const { raw, inFence: fenced } = info[i];
        if (fenced) continue;
        const inside = boldValueInsideRe(word).exec(raw);
        if (inside) return { kind: "bold", line: i + 1, value: inside[1].trim() };
        const outside = boldRe(word).exec(raw);
        if (outside) return { kind: "bold", line: i + 1, value: outside[1].trim() };
      }
      return null;
    }

    function findHeadingSection(word) {
      for (let i = 0; i < info.length; i++) {
        const { raw, inFence: fenced } = info[i];
        if (fenced) continue;
        if (headingRe(word).test(raw)) return { kind: "heading", line: i + 1 };
      }
      return null;
    }

    function headingSectionHasContent(startLine) {
      for (let i = startLine; i < info.length; i++) {
        const { trimmed, inFence: fenced } = info[i];
        // The section scan starts below the heading itself.
        if (i === startLine - 1) continue;
        if (!fenced && /^#{1,6}\s+\S/.test(trimmed)) return false; // next heading reached
        if (trimmed.length > 0) return true;
      }
      return false;
    }

    const sections = {};
    let foundCount = 0;
    for (const word of ["Estado", "Fecha", "Contexto", "Decisión", "Consecuencias"]) {
      const found = findBoldSection(word) ?? findHeadingSection(word);
      if (found) {
        foundCount += 1;
        found.word = word;
      }
      sections[word] = found;
    }

    // ── reports ──────────────────────────────────────────────────────────
    const firstLineNode = nodeAtLine(1);

    for (const word of ["Estado", "Fecha", "Contexto", "Decisión", "Consecuencias"]) {
      const found = sections[word];
      if (!found) {
        context.report({
          node: firstLineNode,
          messageId: "missingSection",
          data: { section: word, found: String(foundCount), total: "5" },
        });
      } else if (found.kind === "heading" && !headingSectionHasContent(found.line)) {
        context.report({
          node: nodeAtLine(found.line),
          messageId: "emptySection",
          data: { section: word },
        });
      }
    }

    // Label-only metadata entries (value left empty).
    if (sections.Estado?.kind === "bold" && sections.Estado.value.length === 0) {
      context.report({ node: nodeAtLine(sections.Estado.line), messageId: "missingEstadoValue" });
    }
    if (sections.Fecha?.kind === "bold" && sections.Fecha.value.length === 0) {
      context.report({ node: nodeAtLine(sections.Fecha.line), messageId: "missingFechaValue" });
    }

    // ── first heading must be `# ADR-###: título` matching the filename ──
    const firstHeading = info.find(({ trimmed, inFence: fenced }) => !fenced && /^#{1,6}\s+\S/.test(trimmed));
    const headerOk =
      firstHeading !== undefined &&
      /^#\s+ADR-(\d{3})\b/i.test(firstHeading.trimmed) &&
      /^#\s+ADR-(\d{3})\b/i.exec(firstHeading.trimmed)[1] === expectedNumber;
    if (!headerOk) {
      context.report({
        node: firstHeading ? nodeAtLine(info.indexOf(firstHeading) + 1) : firstLineNode,
        messageId: "invalidHeader",
        data: { expected: expectedNumber, found: firstHeading ? firstHeading.trimmed.slice(0, 40) : "(none)" },
      });
    }

    return {};
  },
};

export default rule;
