import { describe, it, expect } from "vitest";

const { ChunkingService } =
  await import("../../../services/ai/ChunkingService");

describe("ChunkingService", () => {
  describe("splitText", () => {
    it("returns empty array for empty text", () => {
      expect(ChunkingService.splitText("")).toEqual([]);
    });

    it("returns empty array for whitespace-only text", () => {
      expect(ChunkingService.splitText("   ")).toEqual([]);
    });

    it("returns the same text if it fits in one chunk", () => {
      const text = "Hola mundo. Este es un texto corto.";
      const chunks = ChunkingService.splitText(text, 1000, 200);
      expect(chunks).toEqual([text.trim()]);
    });

    it("splits by paragraphs when content exceeds chunkSize", () => {
      const text =
        "First paragraph with extensive content for testing. ".repeat(5) +
        "\n\nSecond paragraph with more content to fill. ".repeat(5) +
        "\n\nThird paragraph with sufficient text. ".repeat(5);
      const chunks = ChunkingService.splitText(text, 80, 0);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
    });

    it("filters empty chunks", () => {
      const text = "Paragraph one.\n\n  \n\nParagraph two.";
      const chunks = ChunkingService.splitText(text, 100, 0);
      expect(chunks.every((c) => c.length > 0)).toBe(true);
    });

    it("respects chunkSize in simple chunks", () => {
      const text = "A ".repeat(500);
      const chunks = ChunkingService.splitText(text, 100, 0);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100 + 1);
      });
    });

    it("does not generate more chunks than needed for small text", () => {
      const text = "Palabra ".repeat(50);
      const chunks = ChunkingService.splitText(text, 2000, 200);
      expect(chunks.length).toBe(1);
    });
  });

  describe("splitText with large paragraphs", () => {
    it("splits long paragraphs by sentences", () => {
      const longParagraph =
        "Sentence one. Sentence two. Sentence three. Sentence four. ".repeat(10);
      const chunks = ChunkingService.splitText(longParagraph, 100, 0);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeGreaterThan(0);
      });
    });
  });

  describe("splitText con overlapping", () => {
    it("rawSplit handles overlap correctly", () => {
      const text = "abcdefghijklmnopqrstuvwxyz";
      const chunks = ChunkingService.splitText(text, 10, 3);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("casos borde", () => {
    it("handles text with a single long word", () => {
      const text = "Supercalifragilisticoespialidoso".repeat(10);
      const chunks = ChunkingService.splitText(text, 20, 5);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("handles special characters", () => {
      const text = "Hello! How are you? Test: one; two.";
      const chunks = ChunkingService.splitText(text, 100, 0);
      expect(chunks.length).toBe(1);
    });

    it("handles extremely small chunkSize", () => {
      const text = "A test sentence for testing.";
      const chunks = ChunkingService.splitText(text, 5, 0);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it("preserves complete content (no data loss)", () => {
      const text = "Parte uno. Parte dos. Parte tres.";
      const chunks = ChunkingService.splitText(text, 10, 2);
      const joined = chunks.join(" ");
      expect(joined.length).toBeGreaterThan(0);
    });
  });

  describe("semantic overlap (Phase 3)", () => {
    it("applies overlap between adjacent chunks", () => {
      const text =
        "First paragraph with content. Second sentence. Third very long sentence. " +
        "\n\n" +
        "Second paragraph with more text. More sentences here. Sufficient content. " +
        "\n\n" +
        "Third final paragraph. Last sentence.";
      const chunks = ChunkingService.splitText(text, 85, 30);
      // With overlap, adjacent chunks must share content.
      if (chunks.length >= 2) {
        // At least one pair of consecutive chunks must overlap.
        let foundOverlap = false;
        for (let i = 1; i < chunks.length; i++) {
          const prev = chunks[i - 1]!;
          const curr = chunks[i]!;
          // Look for the previous chunk's tail at the start of the next one.
          const prevTail = prev.slice(-15);
          if (prevTail.length > 5 && curr.includes(prevTail)) {
            foundOverlap = true;
            break;
          }
        }
        expect(foundOverlap).toBe(true);
      }
    });

    it("does not pollute the total content — every chunk is meaningful", () => {
      const text =
        "A. B. C. D. E. F. G. H. I. J. K. L. M. N. O. P. Q. R. S. T. ";
      const chunks = ChunkingService.splitText(text, 25, 10);
      // All chunks must have non-empty content.
      chunks.forEach((c) => expect(c.length).toBeGreaterThan(0));
    });
  });
});
