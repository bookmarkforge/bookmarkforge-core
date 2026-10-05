/**
 * Service to handle text chunking for RAG.
 */
export class ChunkingService {
  /**
   * Splits text into chunks of a specified size with overlap.
   * Uses semantic boundaries (paragraphs, sentences) when possible.
   *
   * @param text The text to split.
   * @param chunkSize The maximum size of each chunk (in characters).
   * @param overlap The number of characters to overlap between chunks.
   * @returns An array of string chunks.
   */
  static splitText(
    text: string,
    chunkSize: number = 1000,
    overlap: number = 200,
  ): string[] {
    if (!text || text.trim().length === 0) {return [];}
    if (text.length <= chunkSize) {return [text.trim()];}

    const chunks: string[] = [];

    // 1. Split by double newlines (paragraphs)
    const paragraphs = text.split(/\n\s*\n/);

    let currentChunk = "";

    for (const paragraph of paragraphs) {
      // If a single paragraph is larger than chunkSize, we need to split it by sentences
      if (paragraph.length > chunkSize) {
        // If we have accumulated text, push it first
        if (currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }

        // Split paragraph by sentence boundaries (., !, ?) or single newlines
        const sentences = paragraph.match(/[^.!?\n]+[.!?\n]+/g) || [paragraph];
        let currentSentenceChunk = "";

        for (const sentence of sentences) {
          if (currentSentenceChunk.length + sentence.length <= chunkSize) {
            currentSentenceChunk +=
              (currentSentenceChunk ? " " : "") + sentence.trim();
          } else {
            if (currentSentenceChunk.length > 0) {
              chunks.push(currentSentenceChunk.trim());
            }
            // If a single sentence is STILL larger than chunkSize, fallback to raw character splitting
            if (sentence.length > chunkSize) {
              const rawChunks = this.rawSplit(sentence, chunkSize, overlap);
              chunks.push(...rawChunks.slice(0, -1));
              currentSentenceChunk = rawChunks[rawChunks.length - 1] ?? "";
            } else {
              currentSentenceChunk = sentence.trim() ?? "";
            }
          }
        }
        if (currentSentenceChunk.length > 0) {
          // Instead of pushing immediately, we can start the next chunk with it
          currentChunk = currentSentenceChunk;
        }
      } else {
        // Paragraph fits, check if it fits in the current chunk
        if (currentChunk.length + paragraph.length + 2 <= chunkSize) {
          currentChunk += (currentChunk ? "\n\n" : "") + paragraph.trim();
        } else {
          // Push current chunk and start a new one
          if (currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = paragraph.trim();
        }
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }

    // Apply overlap between chunks: prepend the tail of the previous chunk
    // (last ~overlap characters, trimmed to a sentence boundary) to maintain
    // RAG context continuity across chunk boundaries.
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!;
      const tail = prev.length > overlap
        ? prev.slice(-overlap).replace(/^[^.!?]*[.!?]\s*/, "").trim()
        : "";
      if (tail && !chunks[i]!.startsWith(tail)) {
        chunks[i] = tail + " " + chunks[i]!;
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  private static rawSplit(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = start + chunkSize;
      if (end < text.length) {
        const lastSpace = text.lastIndexOf(" ", end);
        if (lastSpace > start + chunkSize / 2) {
          end = lastSpace + 1;
        }
      }
      chunks.push(text.slice(start, end).trim());
      start = end - overlap;
      if (start <= end - chunkSize) {start = end;}
    }
    return chunks;
  }
}
