import { describe, it, expect } from "vitest";
import { _internal } from "../../components/block-editor/useBlockEditorLogic";

describe("useBlockEditorLogic — local heuristics", () => {
  describe("tokenize", () => {
    it("lowercase + filter stopwords", () => {
      const out = _internal.tokenize(
        "The quick brown fox jumps over the lazy dog",
      );
      expect(out).toEqual([
        "quick",
        "brown",
        "fox",
        "jumps",
        "over",
        "lazy",
        "dog",
      ]);
    });

    it("removes short words (< 3 chars)", () => {
      const out = _internal.tokenize("a be to of");
      expect(out).toEqual([]);
    });

    it("preserves accents and ñ", () => {
      const out = _internal.tokenize("años atrás español niño");
      expect(out).toContain("años");
      expect(out).toContain("español");
    });

    it("removes punctuation", () => {
      const out = _internal.tokenize("Hello, world! How are you?");
      expect(out).toEqual(["hello", "world", "how"]);
    });
  });

  describe("extractTagsFromText", () => {
    it("returns most frequent words, without stopwords", () => {
      const text =
        "JavaScript is great. JavaScript runs everywhere. TypeScript is JavaScript with types.";
      const tags = _internal.extractTagsFromText(text);
      expect(tags[0]).toBe("javascript");
      expect(tags).toContain("typescript");
    });

    it("respects max", () => {
      const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
      const tags = _internal.extractTagsFromText(words, 5);
      expect(tags).toHaveLength(5);
    });

    it("returns [] for empty text", () => {
      expect(_internal.extractTagsFromText("")).toEqual([]);
    });
  });

  describe("splitSentences", () => {
    it("separa por . ! ?", () => {
      const out = _internal.splitSentences(
        "Hola mundo. Adiós amigo. ¿Cómo estás amigo? Bien amigo.",
      );
      expect(out.length).toBeGreaterThanOrEqual(2);
    });

    it("discards sentences that are too short or too long", () => {
      const out = _internal.splitSentences(
        "Hi. This is a medium length sentence that should be included in the output because it is a reasonable size.",
      );
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((s) => s.length >= 10 && s.length <= 200)).toBe(true);
    });
  });

  describe("extractFlashcards", () => {
    it('detects "X is Y" definitions', () => {
      const cards = _internal.extractFlashcards(
        "Photosynthesis is the process by which plants convert light into energy.",
      );
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.front).toMatch(/photosynthesis/i);
    });

    it('detects "X: Y"', () => {
      const cards = _internal.extractFlashcards(
        "API: Application Programming Interface used for service communication.",
      );
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.front).toBe("API");
      expect(cards[0]!.back).toMatch(/application programming interface/i);
    });

    it("respects max", () => {
      const text = Array.from(
        { length: 20 },
        (_, i) => `Concept ${i} is a definition of term ${i}.`,
      ).join(" ");
      const cards = _internal.extractFlashcards(text, 3);
      expect(cards.length).toBeLessThanOrEqual(3);
    });

    it("returns [] for empty text", () => {
      expect(_internal.extractFlashcards("")).toEqual([]);
    });
  });

  describe("suggestFolder", () => {
    it("suggests tech for technical content", () => {
      const folder = _internal.suggestFolder(
        "This tutorial covers JavaScript and React development with TypeScript and Node.js APIs.",
      );
      expect(folder).toBe("tech");
    });

    it("suggests recipes for cooking content", () => {
      const folder = _internal.suggestFolder(
        "This recipe uses simple ingredients you can find in any kitchen.",
      );
      expect(folder).toBe("recipes");
    });

    it("suggests general for neutral content", () => {
      const folder = _internal.suggestFolder(
        "Lorem ipsum dolor sit amet consectetur adipiscing elit.",
      );
      expect(folder).toBe("general");
    });

    it("detects health/fitness", () => {
      const folder = _internal.suggestFolder(
        "A good workout and exercise routine improves your health and fitness level significantly.",
      );
      expect(folder).toBe("health");
    });

    it("detects finance", () => {
      const folder = _internal.suggestFolder(
        "How to invest in stock market and manage your budget with crypto savings.",
      );
      expect(folder).toBe("finance");
    });
  });
});
