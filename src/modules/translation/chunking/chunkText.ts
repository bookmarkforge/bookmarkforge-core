/**
 * src/modules/translation/chunking/chunkText.ts
 *
 * Semantic chunking for the translation pipeline — Core (MIT), pure, sync.
 *
 * The contract that makes the bilingual view safe:
 *
 *   reassembleChunks(chunkText(source)) === source        (byte-identical)
 *
 * That identity is what lets the split view map a translated paragraph back to
 * its source, and it is why chunks carry `separatorBefore` (the whitespace that
 * ran between two chunks) instead of trimming text.
 *
 * Rules, in priority order:
 *  1. Never cut inside a fenced code block — code is emitted as its own
 *     non-translatable chunk and passed through verbatim.
 *  2. Prefer paragraph boundaries (`\n\n`), unioned up to the target size.
 *  3. Inside an oversized paragraph, split at sentence boundaries only.
 *  4. Inside an oversized sentence, split at clause punctuation.
 *  5. Only as a last resort (a URL/base64 blob longer than the budget) split at
 *     whitespace, and never inside a word.
 *
 * Chunk sizes are ESTIMATED tokens (see `tokenEstimator.ts`), targeted at
 * CHUNK_TARGET_TOKENS and hard-capped at CHUNK_MAX_TOKENS.
 */

import {
  CHUNK_MAX_TOKENS,
  CHUNK_MIN_TOKENS,
  CHUNK_TARGET_TOKENS,
} from "../constants";
import { estimateTokens, tokensToCharBudget } from "./tokenEstimator";

export type ChunkKind = "prose" | "code" | "table" | "heading";

export interface TextChunk {
  /** Position in document order, 0-based. Stable for a given source text. */
  index: number;
  text: string;
  kind: ChunkKind;
  /** False for code fences: the pipeline echoes them instead of translating. */
  translatable: boolean;
  /** Exact whitespace that preceded this chunk in the source document. */
  separatorBefore: string;
  estimatedTokens: number;
  /** Absolute character offsets in the source document. */
  start: number;
  end: number;
  /**
   * Content hash of `text` (FNV-1a based, non-cryptographic). Used as the
   * cache key, and verified against the cached plaintext on read so a hash
   * collision can never return the wrong translation.
   */
  hash: string;
}

export interface ChunkTextOptions {
  /** Accumulate until at least this many estimated tokens, then flush. */
  targetTokens?: number;
  /** Hard ceiling for one chunk (estimated tokens). */
  maxTokens?: number;
  /** A trailing chunk below this is merged into its predecessor when possible. */
  minTokens?: number;
}

interface Range {
  start: number;
  end: number;
  kind: ChunkKind;
  translatable: boolean;
}

interface ParsedBlock {
  start: number;
  end: number;
  kind: ChunkKind;
}

/** Punctuation that ends a sentence in at least one shipped locale. */
const SENTENCE_TERMINATORS = new Set([
  ".",
  "!",
  "?",
  "…",
  "。",
  "！",
  "？",
  "؟",
  "۔",
  "؛",
]);

/** Terminators that end a sentence WITHOUT requiring following whitespace. */
const CJK_TERMINATORS = new Set(["。", "！", "？", "؟", "۔", "；"]);

const CLOSING_MARKS = /["'”’»)\]}〉》」』]/;

/** Clause punctuation: used only when a single sentence exceeds the cap. */
const CLAUSE_TERMINATORS = new Set([",", ";", ":", "—", "–"]);

/**
 * Abbreviations whose trailing period does not end a sentence. Matching is
 * done on the lowercased 12-character tail, so "e.g." and "i.e." are covered
 * by their final letter.
 */
const ABBREVIATION_TAIL =
  /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|fig|figs|vol|vols|pp|al|mr|mrs|ms|dr|prof|sr|jr|st|no|inc|ltd|co|dept|ed|eds|esp|min|max|art|sec|ref|refs)\.$/i;

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}#{1,6}\s/;
const TABLE_ROW_RE = /^\s*\|/;

/**
 * Split a document into semantic blocks. Blocks are contiguous slices of the
 * source; blank lines and the whitespace between blocks are NOT included, so
 * they later become chunk separators.
 */
function parseBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const length = text.length;

  let paragraphStart = -1;
  let paragraphEnd = -1;
  let paragraphKind: ChunkKind = "prose";

  const flushParagraph = () => {
    if (paragraphStart >= 0 && paragraphEnd > paragraphStart) {
      blocks.push({ start: paragraphStart, end: paragraphEnd, kind: paragraphKind });
    }
    paragraphStart = -1;
    paragraphEnd = -1;
    paragraphKind = "prose";
  };

  const appendParagraphLine = (start: number, end: number, kind: ChunkKind) => {
    if (paragraphStart < 0) {
      paragraphStart = start;
      paragraphKind = kind;
    } else if (paragraphKind !== kind) {
      // A table that starts after prose is a new block; prose after a table is
      // a new block. Heading lines are always their own block.
      flushParagraph();
      paragraphStart = start;
      paragraphKind = kind;
    }
    paragraphEnd = end;
  };

  let cursor = 0;
  let openFence: string | null = null;
  let fenceStart = -1;

  while (cursor < length) {
    const newline = text.indexOf("\n", cursor);
    const lineEnd = newline === -1 ? length : newline;
    const line = text.slice(cursor, lineEnd);

    if (openFence) {
      const closing = FENCE_RE.exec(line);
      if (
        closing &&
        closing[1] &&
        closing[1].charAt(0) === openFence.charAt(0) &&
        closing[1].length >= openFence.length
      ) {
        blocks.push({ start: fenceStart, end: lineEnd, kind: "code" });
        openFence = null;
        fenceStart = -1;
      }
      cursor = lineEnd + 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence && fence[1]) {
      flushParagraph();
      openFence = fence[1];
      fenceStart = cursor;
      cursor = lineEnd + 1;
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      cursor = lineEnd + 1;
      continue;
    }

    if (HEADING_RE.test(line)) {
      flushParagraph();
      blocks.push({ start: cursor, end: lineEnd, kind: "heading" });
      cursor = lineEnd + 1;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      appendParagraphLine(cursor, lineEnd, "table");
      cursor = lineEnd + 1;
      continue;
    }

    appendParagraphLine(cursor, lineEnd, "prose");
    cursor = lineEnd + 1;
  }

  // An unclosed fence is emitted as code (translatable: false) rather than
  // being fed to the model as prose: a broken document must not get its code
  // rewritten by a 3B model.
  if (openFence) {
    blocks.push({ start: fenceStart, end: length, kind: "code" });
  }
  flushParagraph();
  return blocks;
}

function isAbbreviation(text: string, sentenceStart: number, periodIndex: number): boolean {
  const tailStart = Math.max(sentenceStart, periodIndex - 12);
  const tail = text.slice(tailStart, periodIndex + 1);
  if (ABBREVIATION_TAIL.test(tail)) {return true;}
  // Single capital initial ("J. Smith", "U.S. Army"): merging two sentences is
  // harmless, cutting one in half is not — so err toward no boundary.
  const previous = text.charAt(periodIndex - 1);
  return /[A-Z]/.test(previous);
}

/**
 * Cut positions (indices where the NEXT sentence starts) inside [start, end).
 * Every gap stays attached to the following unit, so units reconstruct the
 * source exactly.
 */
function findSentenceCuts(text: string, start: number, end: number): number[] {
  const cuts: number[] = [];
  let i = start;

  while (i < end) {
    const char = text.charAt(i);

    if (char === "\n") {
      cuts.push(i + 1);
      i += 1;
      continue;
    }

    if (!SENTENCE_TERMINATORS.has(char)) {
      i += 1;
      continue;
    }

    // Consume repeated terminators ("?!", "…") and closing quotes/brackets.
    let after = i + 1;
    while (after < end && SENTENCE_TERMINATORS.has(text.charAt(after))) {after += 1;}
    while (after < end && CLOSING_MARKS.test(text.charAt(after))) {after += 1;}

    if (CJK_TERMINATORS.has(char)) {
      cuts.push(after);
      i = after;
      continue;
    }

    const next = text.charAt(after);
    if (after < end && /\s/.test(next) && !isAbbreviation(text, start, i)) {
      let skip = after;
      while (skip < end && /\s/.test(text.charAt(skip))) {skip += 1;}
      cuts.push(skip);
      i = skip;
      continue;
    }

    i = after;
  }

  return cuts;
}

function findClauseCuts(text: string, start: number, end: number): number[] {
  const cuts: number[] = [];
  let i = start;
  while (i < end) {
    const char = text.charAt(i);
    if (char === "\n") {
      cuts.push(i + 1);
      i += 1;
      continue;
    }
    if (CLAUSE_TERMINATORS.has(char)) {
      let after = i + 1;
      while (after < end && /\s/.test(text.charAt(after))) {after += 1;}
      if (after > i + 1 && after < end) {
        cuts.push(after);
        i = after;
        continue;
      }
    }
    i += 1;
  }
  return cuts;
}

function rangesFromCuts(
  start: number,
  end: number,
  cuts: number[],
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let from = start;
  for (const cut of cuts) {
    if (cut > from && cut <= end) {
      out.push([from, cut]);
      from = cut;
    }
  }
  if (from < end) {out.push([from, end]);}
  return out;
}

/**
 * Last resort: split a range at whitespace so no word is cut. A single token
 * longer than the budget (URL, base64 payload) is cut at the character budget;
 * that is the only place where a "word" can be split, and the alternative is
 * an untranslatable block that overflows the model context.
 */
function splitAtWhitespace(
  text: string,
  start: number,
  end: number,
  maxTokens: number,
): Array<[number, number]> {
  const budget = tokensToCharBudget(maxTokens);
  const out: Array<[number, number]> = [];
  let from = start;
  while (from < end) {
    const candidateEnd = Math.min(end, from + budget);
    let cut = candidateEnd;
    if (candidateEnd < end) {
      const space = text.lastIndexOf(" ", candidateEnd);
      if (space > from + Math.floor(budget * 0.4)) {cut = space + 1;}
    }
    if (cut <= from) {cut = Math.min(end, from + budget);}
    out.push([from, cut]);
    from = cut;
  }
  return out;
}

/** Split one unit that is still over budget, degrading clause → word. */
function splitOversizedUnit(
  text: string,
  start: number,
  end: number,
  maxTokens: number,
): Array<[number, number]> {
  const clauseRanges = rangesFromCuts(start, end, findClauseCuts(text, start, end));
  const out: Array<[number, number]> = [];

  for (const [from, to] of clauseRanges) {
    if (estimateTokens(text.slice(from, to)) <= maxTokens) {
      out.push([from, to]);
      continue;
    }
    out.push(...splitAtWhitespace(text, from, to, maxTokens));
  }
  return out;
}

/**
 * Split an oversized prose/table block into ranges that respect sentence
 * boundaries first, clause boundaries second, whitespace last.
 */
function splitOversizedBlock(
  text: string,
  block: ParsedBlock,
  targetTokens: number,
  maxTokens: number,
): Array<[number, number]> {
  let units: Array<[number, number]>;
  if (block.kind === "table") {
    // A table row is atomic: splitting inside a row breaks the Markdown.
    const rowCuts: number[] = [];
    for (let position = block.start; position < block.end; position += 1) {
      if (text.charAt(position) === "\n") {rowCuts.push(position + 1);}
    }
    units = rangesFromCuts(block.start, block.end, rowCuts);
  } else {
    units = rangesFromCuts(
      block.start,
      block.end,
      findSentenceCuts(text, block.start, block.end),
    );
  }

  const out: Array<[number, number]> = [];
  let chunkStart = -1;
  let chunkEnd = -1;
  let chunkTokens = 0;

  const flush = () => {
    if (chunkStart >= 0) {out.push([chunkStart, chunkEnd]);}
    chunkStart = -1;
    chunkEnd = -1;
    chunkTokens = 0;
  };

  for (const [from, to] of units) {
    const unitTokens = estimateTokens(text.slice(from, to));
    if (unitTokens > maxTokens) {
      flush();
      out.push(...splitOversizedUnit(text, from, to, maxTokens));
      continue;
    }
    if (chunkStart >= 0 && chunkTokens + unitTokens > maxTokens) {
      flush();
    }
    if (chunkStart < 0) {
      chunkStart = from;
      chunkTokens = 0;
    }
    chunkEnd = to;
    chunkTokens += unitTokens;
    if (chunkTokens >= targetTokens) {flush();}
  }
  flush();
  return out;
}

/** FNV-1a based content hash (two independent lanes + length). */
export function hashChunkText(text: string): string {
  let laneA = 0x811c9dc5;
  let laneB = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    laneA = Math.imul(laneA ^ code, 0x01000193);
    laneB = Math.imul(laneB ^ code, 0x85ebca6b);
  }
  return (
    (laneA >>> 0).toString(16).padStart(8, "0") +
    (laneB >>> 0).toString(16).padStart(8, "0") +
    text.length.toString(16)
  );
}

function buildRanges(
  text: string,
  blocks: ParsedBlock[],
  targetTokens: number,
  maxTokens: number,
  minTokens: number,
): Range[] {
  const ranges: Range[] = [];
  let chunkStart = -1;
  let chunkEnd = -1;
  let chunkKind: ChunkKind = "prose";
  let chunkTokens = 0;

  const flush = () => {
    if (chunkStart >= 0 && chunkEnd > chunkStart) {
      ranges.push({
        start: chunkStart,
        end: chunkEnd,
        kind: chunkKind,
        translatable: true,
      });
    }
    chunkStart = -1;
    chunkEnd = -1;
    chunkTokens = 0;
  };

  for (const block of blocks) {
    if (block.kind === "code") {
      flush();
      ranges.push({
        start: block.start,
        end: block.end,
        kind: "code",
        translatable: false,
      });
      continue;
    }

    const blockTokens = estimateTokens(text.slice(block.start, block.end));
    if (blockTokens > maxTokens) {
      flush();
      for (const [from, to] of splitOversizedBlock(
        text,
        block,
        targetTokens,
        maxTokens,
      )) {
        ranges.push({ start: from, end: to, kind: block.kind, translatable: true });
      }
      continue;
    }

    const candidateStart = chunkStart >= 0 ? chunkStart : block.start;
    const candidateTokens = estimateTokens(text.slice(candidateStart, block.end));
    if (chunkStart >= 0 && candidateTokens > maxTokens) {
      flush();
      chunkStart = block.start;
      chunkEnd = block.end;
      chunkKind = block.kind;
      chunkTokens = blockTokens;
      continue;
    }

    if (chunkStart < 0) {
      chunkStart = block.start;
      chunkKind = block.kind;
    }
    chunkEnd = block.end;
    chunkTokens = candidateTokens;
    if (chunkTokens >= targetTokens) {flush();}
  }
  flush();

  // Merge a short trailing chunk into its predecessor when the combined range
  // still fits: a 40-token tail costs a full model round-trip on its own.
  if (ranges.length >= 2) {
    const last = ranges[ranges.length - 1]!;
    const previous = ranges[ranges.length - 2]!;
    const lastTokens = estimateTokens(text.slice(last.start, last.end));
    if (
      last.translatable &&
      previous.translatable &&
      lastTokens < minTokens &&
      estimateTokens(text.slice(previous.start, last.end)) <= maxTokens
    ) {
      previous.end = last.end;
      ranges.pop();
    }
  }

  return ranges;
}

/**
 * Split `text` into translation chunks.
 *
 * The function is synchronous and pure: the same input always produces the
 * same chunks (same indices, same hashes), which is what makes the encrypted
 * pair cache deterministic across reloads.
 */
export function chunkText(text: string, options: ChunkTextOptions = {}): TextChunk[] {
  if (!text || text.trim().length === 0) {return [];}

  const targetTokens = Math.max(
    1,
    Math.min(options.targetTokens ?? CHUNK_TARGET_TOKENS, options.maxTokens ?? CHUNK_MAX_TOKENS),
  );
  const maxTokens = Math.max(targetTokens, options.maxTokens ?? CHUNK_MAX_TOKENS);
  const minTokens = Math.max(0, options.minTokens ?? CHUNK_MIN_TOKENS);

  const blocks = parseBlocks(text);
  const ranges = buildRanges(text, blocks, targetTokens, maxTokens, minTokens);

  const chunks: TextChunk[] = [];
  let previousEnd = 0;
  for (const range of ranges) {
    const chunkTextValue = text.slice(range.start, range.end);
    if (chunkTextValue.trim().length === 0) {
      // Whitespace-only range: keep it as a separator, not as a chunk.
      continue;
    }
    chunks.push({
      index: chunks.length,
      text: chunkTextValue,
      kind: range.kind,
      translatable: range.translatable,
      separatorBefore: text.slice(previousEnd, range.start),
      estimatedTokens: estimateTokens(chunkTextValue),
      start: range.start,
      end: range.end,
      hash: hashChunkText(chunkTextValue),
    });
    previousEnd = range.end;
  }

  return chunks;
}

/** Reassemble chunks into the exact source text (round-trip guarantee). */
export function reassembleChunks(chunks: TextChunk[]): string {
  return chunks.map((chunk) => `${chunk.separatorBefore}${chunk.text}`).join("");
}
