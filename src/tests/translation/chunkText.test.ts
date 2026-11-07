/**
 * src/tests/translation/chunkText.test.ts
 *
 * The chunker's contract is a round-trip identity plus "never cut a sentence":
 * both are properties, not examples, so the long fixtures below are exercised
 * through assertions that hold for every chunk.
 */

import { describe, expect, it } from "vitest";
import {
  chunkText,
  hashChunkText,
  reassembleChunks,
} from "../../modules/translation/chunking/chunkText";
import { estimateTokens } from "../../modules/translation/chunking/tokenEstimator";
import { CHUNK_MAX_TOKENS } from "../../modules/translation/constants";

const MARKDOWN_DOC = `# Release notes

BookmarkForge 1.0 ships a local-first vault. Everything is encrypted at rest, and nothing leaves the machine unless the user asks for it.

## What changed

- The sync engine now compares revisions before writing.
- Search returns highlights in the correct order.

| Feature | Free | Pro |
| --- | --- | --- |
| Local AI | no | yes |
| Bookmarks | 200 | unlimited |

\`\`\`ts
const answer = items.map((item) => item.id);
console.log(answer);
\`\`\`

Final paragraph with a [link](https://example.com) and an inline \`code\` span.`;

const CJK_DOC = "这是一个用于测试分块的段落。它包含多个句子。每个句子都应该保持完整。".repeat(40);

const ARABIC_DOC = "هذه فقرة لاختبار التقسيم إلى أجزاء. تحتوي على عدة جمل. يجب أن تبقى كل جملة كاملة. ".repeat(80);

function assertNoWordWasCut(source: string, chunks: ReturnType<typeof chunkText>): void {
  for (const chunk of chunks) {
    const before = source.charAt(chunk.start - 1);
    const first = source.charAt(chunk.start);
    const last = source.charAt(chunk.end - 1);
    const after = source.charAt(chunk.end);
    // A cut inside a word would leave a letter on both sides of the boundary.
    const splitsWordStart = /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(first);
    const splitsWordEnd = /[\p{L}\p{N}]/u.test(last) && /[\p{L}\p{N}]/u.test(after);
    expect(splitsWordStart, `chunk ${chunk.index} starts mid-word`).toBe(false);
    expect(splitsWordEnd, `chunk ${chunk.index} ends mid-word`).toBe(false);
  }
}

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n \t ")).toEqual([]);
  });

  it("round-trips a Markdown document byte-for-byte", () => {
    const chunks = chunkText(MARKDOWN_DOC);
    expect(chunks.length).toBeGreaterThan(0);
    expect(reassembleChunks(chunks)).toBe(MARKDOWN_DOC);
  });

  it("round-trips CJK and Arabic documents byte-for-byte", () => {
    for (const doc of [CJK_DOC, ARABIC_DOC]) {
      const chunks = chunkText(doc);
      expect(chunks.length).toBeGreaterThan(1);
      expect(reassembleChunks(chunks)).toBe(doc);
      assertNoWordWasCut(doc, chunks);
    }
  });

  it("keeps fenced code as one non-translatable chunk", () => {
    const chunks = chunkText(MARKDOWN_DOC);
    const code = chunks.filter((chunk) => chunk.kind === "code");
    expect(code).toHaveLength(1);
    expect(code[0]!.translatable).toBe(false);
    expect(code[0]!.text).toContain("const answer = items.map");
  });

  it("never lets a chunk exceed the hard token cap", () => {
    const long = Array.from(
      { length: 120 },
      (_, index) =>
        `Paragraph ${index} explains the migration in enough detail that the estimator treats it as real prose rather than a label. It contains two sentences and a list of terms.`,
    ).join("\n\n");
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
      expect(estimateTokens(chunk.text)).toBe(chunk.estimatedTokens);
    }
    expect(reassembleChunks(chunks)).toBe(long);
    assertNoWordWasCut(long, chunks);
  });

  it("splits an oversized paragraph at sentence boundaries, never mid-word", () => {
    const sentence =
      "The pipeline reads the document, normalizes the whitespace, chunks the paragraphs, " +
      "translates every chunk, reviews the draft, and persists the encrypted pairs, " +
      "which makes a full rebuild unnecessary, cheap, and predictable for the reader.";
    const long = sentence.repeat(20);
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(reassembleChunks(chunks)).toBe(long);
    assertNoWordWasCut(long, chunks);
    for (const chunk of chunks) {
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
  });

  it("produces stable indices and hashes for the same input", () => {
    const first = chunkText(MARKDOWN_DOC);
    const second = chunkText(MARKDOWN_DOC);
    expect(first.map((chunk) => [chunk.index, chunk.hash])).toEqual(
      second.map((chunk) => [chunk.index, chunk.hash]),
    );
  });

  it("changes only the hash of the edited paragraph", () => {
    const before = chunkText(MARKDOWN_DOC);
    const after = chunkText(
      MARKDOWN_DOC.replace("Final paragraph", "Closing paragraph"),
    );
    expect(after.at(-1)!.hash).not.toBe(before.at(-1)!.hash);
    expect(after[0]!.hash).toBe(before[0]!.hash);
  });

  it("honours a reduced budget (NLLB's smaller context window)", () => {
    const chunks = chunkText(MARKDOWN_DOC, { targetTokens: 120, maxTokens: 160, minTokens: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.estimatedTokens).toBeLessThanOrEqual(160);
    }
    expect(reassembleChunks(chunks)).toBe(MARKDOWN_DOC);
  });

  it("keeps a heading attached to the content it introduces", () => {
    const chunks = chunkText(
      "# Heading\n\n" +
        "Body paragraph that belongs to the heading above and should not be separated from it by the chunker.",
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.startsWith("# Heading")).toBe(true);
  });

  it("hashes identical text identically and different text differently", () => {
    expect(hashChunkText("hello")).toBe(hashChunkText("hello"));
    expect(hashChunkText("hello")).not.toBe(hashChunkText("hello!"));
  });
});
