/**
 * eslint-rules/lib/markdown-parser.mjs
 *
 * Trivial flat-config parser that lets ESLint lint Markdown files. ESLint
 * ships no Markdown parser, and this repo has exactly one rule over docs
 * (bmf/require-adr-template), so instead of a full remark AST we expose each
 * line as a `MarkdownLine` node under a `Program` root. The rule works from
 * `context.sourceCode.getText()` / `sourceCode.lines`; the per-line nodes
 * exist so ESLint's machinery (location resolution, visitor selectors) has
 * something meaningful to point at.
 *
 * Used from `eslint.config.js` as `languageOptions: { parser }` on the
 * `docs/ADR-*.md` block. Exposed as `parseForMarkdown` (the flat-config
 * parser shape: `{ parseForESLint }`) and re-exported raw for tests.
 */

const LINE_SPLIT = /\r\n|\r|\n/;

function isFenceDelimiterRaw(value) {
  const t = value.trim();
  return t.startsWith("```") || t.startsWith("~~~");
}

/** Build one `MarkdownLine` node with real offsets. */
function makeLineNode(raw, number, startOffset, inFence, parent) {
  const trimmedStart = raw.trimStart();
  const isHeading = !inFence && /^#{1,6}\s/.test(trimmedStart);
  const headingDepth = isHeading ? trimmedStart.match(/^#+/)[0].length : 0;
  const isListItem = !inFence && /^\s*[-*+]\s/.test(raw);
  const endOffset = startOffset + raw.length;

  return {
    type: "MarkdownLine",
    parent,
    raw,
    text: raw.replace(/\uFEFF/g, "").trim(),
    number,
    // State BEFORE processing this line: true when the line sits inside a
    // ```/~~~ fence (fence delimiters themselves are never "inside").
    inFence,
    // True only for actual ```/~~~ delimiter lines — the toggle points.
    isFenceDelimiter: isFenceDelimiterRaw(raw),
    isHeading,
    headingDepth,
    isListItem,
    loc: {
      start: { line: number, column: 0 },
      end: { line: number, column: raw.length },
    },
    range: [startOffset, endOffset],
  };
}

/**
 * Parse Markdown into an ESLint-compatible AST: a `Program` whose body is one
 * `MarkdownLine` per line. `tokens` carries one token per line so token-based
 * helpers never see an empty stream; `comments` is always empty (Markdown has
 * no ESLint comment concept).
 */
export function parseForMarkdown(code) {
  const lines = code.split(LINE_SPLIT);
  const body = [];
  const tokens = [];
  let offset = 0;
  let inFence = false;

  const program = {
    type: "Program",
    body,
    comments: [],
    tokens,
    loc: { start: { line: 1, column: 0 }, end: { line: lines.length, column: 0 } },
    range: [0, code.length],
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const node = makeLineNode(raw, i + 1, offset, inFence, program);
    body.push(node);
    if (node.isFenceDelimiter) {
      inFence = !inFence;
    }
    tokens.push({
      type: "MarkdownText",
      value: raw.trim(),
      loc: node.loc,
      range: node.range,
    });
    // +1 for the newline consumed by LINE_SPLIT (absent after the last line).
    offset += raw.length + (i < lines.length - 1 ? 1 : 0);
  }

  return { ast: program };
}

/** Flat-config parser object (drop-in for `languageOptions.parser`). */
const markdownParser = {
  meta: {
    name: "bookmarkforge-markdown-parser",
    version: "1.0.0",
  },
  parseForESLint: parseForMarkdown,
  // Legacy shape kept for tooling that calls `parse` directly.
  parse: (code) => parseForMarkdown(code).ast,
};

export default markdownParser;
