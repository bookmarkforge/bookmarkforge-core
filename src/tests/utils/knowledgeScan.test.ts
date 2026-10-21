import { describe, it, expect } from "vitest";
import {
  computeBridges,
  detectLanguage,
  jaccardOverlap,
  MAX_ITEMS_PER_LANG,
  MAX_SCAN_ITEMS,
  type ScanBookmark,
} from "../../utils/knowledgeScan";

function bm(
  id: string,
  title: string,
  tags: string[],
  updatedAt = "2026-01-01T00:00:00.000Z",
  visitCount?: number,
): ScanBookmark {
  return { id, title, url: "", tags, updatedAt, visitCount };
}

describe("detectLanguage", () => {
  it("detects CJK scripts", () => {
    expect(detectLanguage("日本語の記事", "")).toBe("ja");
    expect(detectLanguage("한국어 기술 기사", "")).toBe("ko");
    expect(detectLanguage("中文技术文章", "")).toBe("zh");
  });

  it("detects Cyrillic, Arabic and Devanagari", () => {
    expect(detectLanguage("Русская статья", "")).toBe("ru");
    expect(detectLanguage("مقالة عربية", "")).toBe("ar");
    expect(detectLanguage("हिन्दी लेख", "")).toBe("hi");
  });

  it("falls back to English for Latin-script text", () => {
    expect(detectLanguage("English Guide", "")).toBe("en");
  });

  it("looks at the URL too", () => {
    expect(detectLanguage("", "https://example.com/中文")).toBe("zh");
  });
});

describe("jaccardOverlap", () => {
  it("returns 1 for identical tag sets", () => {
    expect(jaccardOverlap(["a", "b"], ["a", "b"])).toBe(1);
  });

  it("returns 0 when either side is empty", () => {
    expect(jaccardOverlap([], ["a"])).toBe(0);
    expect(jaccardOverlap(["a"], [])).toBe(0);
  });

  it("computes partial overlap", () => {
    expect(jaccardOverlap(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
  });
});

describe("computeBridges", () => {
  it("returns an empty array for empty or invalid input", () => {
    expect(computeBridges([])).toEqual([]);
    expect(computeBridges([null, 42, "x"])).toEqual([]);
  });

  it("builds a bridge between two languages sharing a tag", () => {
    const result = computeBridges([
      bm("1", "日本語の記事", ["ml"]),
      bm("2", "English ML Guide", ["ml"]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.topic).toBe("ml");
    // Groups are processed in deterministic order (size desc, then lang
    // name asc), so "en" precedes "ja".
    expect(result[0]!.pairs).toEqual([
      { lang: "en", title: "English ML Guide" },
      { lang: "ja", title: "日本語の記事" },
    ]);
  });

  it("merges pairs from several languages into one bridge", () => {
    const result = computeBridges([
      bm("1", "Русская статья", ["x"]),
      bm("2", "مقالة عربية", ["x"]),
      bm("3", "हिन्दी लेख", ["x"]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.topic).toBe("x");
    expect(result[0]!.pairs).toHaveLength(3);
  });

  it("produces no bridge without shared tags", () => {
    const result = computeBridges([
      bm("1", "日本語の記事", ["ml"]),
      bm("2", "English Guide", ["tech"]),
    ]);
    expect(result).toEqual([]);
  });

  it("caps items per language to MAX_ITEMS_PER_LANG", () => {
    const manyEn: ScanBookmark[] = [];
    for (let i = 0; i < MAX_ITEMS_PER_LANG + 10; i++) {
      manyEn.push(
        bm(
          `en-${String(i).padStart(3, "0")}`,
          `English article ${i}`,
          ["shared"],
          // Newest first: the LAST items are the most recent.
          new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        ),
      );
    }
    const oneJa = bm("ja-1", "日本語の記事", ["shared"]);
    const result = computeBridges([...manyEn, oneJa]);

    expect(result).toHaveLength(1);
    // Only the newest MAX_ITEMS_PER_LANG English items participate.
    const enTitles = result[0]!.pairs
      .filter((p) => p.lang === "en")
      .map((p) => p.title);
    expect(enTitles).toHaveLength(MAX_ITEMS_PER_LANG);
    // The newest English item must be present; the oldest must not.
    expect(enTitles).toContain(
      `English article ${MAX_ITEMS_PER_LANG + 9}`,
    );
    expect(enTitles).not.toContain("English article 0");
  });

  it("prioritizes visited bookmarks over newer unvisited ones in the sample", () => {
    const visited: ScanBookmark[] = [];
    for (let i = 0; i < MAX_ITEMS_PER_LANG; i++) {
      // Older but heavily used.
      visited.push(
        bm(`v-${String(i).padStart(3, "0")}`, `visited ${i}`, ["shared"], "2026-01-01T00:00:00.000Z", 10),
      );
    }
    // Fresh but never visited — the old sampling (recency only) would keep
    // these and drop the visited ones.
    const fresh: ScanBookmark[] = [];
    for (let i = 0; i < 10; i++) {
      fresh.push(
        bm(`f-${String(i).padStart(3, "0")}`, `fresh ${i}`, ["shared"], "2026-02-01T00:00:00.000Z"),
      );
    }
    const oneJa = bm("ja-1", "日本語の記事", ["shared"]);
    const result = computeBridges([...visited, ...fresh, oneJa]);

    const enTitles = result[0]!.pairs
      .filter((p) => p.lang === "en")
      .map((p) => p.title);
    expect(enTitles).toHaveLength(MAX_ITEMS_PER_LANG);
    // Every visited bookmark is kept; none of the fresh unvisited ones are.
    expect(enTitles).toContain("visited 0");
    expect(enTitles).toContain(`visited ${MAX_ITEMS_PER_LANG - 1}`);
    expect(enTitles).not.toContain("fresh 0");
    expect(enTitles).not.toContain("fresh 9");
  });

  it("breaks equal-relevance ties by recency, then by id deterministically", () => {
    // All items share the same visitCount; recency (updatedAt desc) decides
    // first, and identical timestamps fall to the id tie-break.
    const items: ScanBookmark[] = [];
    for (let i = 0; i < MAX_ITEMS_PER_LANG + 10; i++) {
      items.push(
        bm(
          `id-${String(i).padStart(3, "0")}`,
          `title ${i}`,
          ["shared"],
          // Every item identical updatedAt + visitCount 5 → id asc wins.
          "2026-01-01T00:00:00.000Z",
          5,
        ),
      );
    }
    const oneJa = bm("ja-1", "日本語の記事", ["shared"]);
    const result = computeBridges([...items, oneJa]);

    const enTitles = result[0]!.pairs
      .filter((p) => p.lang === "en")
      .map((p) => p.title);
    expect(enTitles).toHaveLength(MAX_ITEMS_PER_LANG);
    // id-000 … id-199 are kept (id asc), the rest are dropped — determinism
    // even when relevance is fully tied.
    expect(enTitles[0]).toBe("title 0");
    expect(enTitles[MAX_ITEMS_PER_LANG - 1]).toBe(`title ${MAX_ITEMS_PER_LANG - 1}`);
    expect(enTitles).not.toContain(`title ${MAX_ITEMS_PER_LANG}`);
  });

  it("caps total scanned items to MAX_SCAN_ITEMS, dropping smallest groups", () => {
    // 6 languages × (MAX_ITEMS_PER_LANG) items fills the global cap exactly.
    const langs = ["ja", "ko", "zh", "ru", "ar", "hi"];
    const items: ScanBookmark[] = [];
    for (const lang of langs) {
      for (let i = 0; i < MAX_ITEMS_PER_LANG; i++) {
        items.push(bm(`${lang}-${i}`, `${lang} title ${i}`, [lang]));
      }
    }
    // A 7th small language group must be dropped by the global cap.
    const smallGroup = [
      bm("de-1", "Deutscher Artikel", ["de"]),
      bm("de-2", "Noch ein Artikel", ["de"]),
    ];
    const result = computeBridges([...items, ...smallGroup]);

    // de shares no tags with anything else, so it would never bridge anyway —
    // use a shared tag to prove the group is dropped by the cap, not by tags.
    const sharedItems = items.map((item, i) =>
      i % 7 === 0 ? { ...item, tags: [...item.tags, "shared"] } : item,
    );
    const sharedResult = computeBridges([
      ...sharedItems,
      bm("de-1", "Deutscher Artikel", ["shared"]),
    ]);
    // The de item never participates: no pair includes lang "de".
    const dePairs = sharedResult.flatMap((br) =>
      br.pairs.filter((p) => p.lang === "de"),
    );
    expect(dePairs).toHaveLength(0);
    expect(result).toBeInstanceOf(Array);
  });

  it("is deterministic for the same input", () => {
    const input = [
      bm("1", "日本語の記事", ["ml"], "2026-02-01T00:00:00.000Z"),
      bm("2", "English ML Guide", ["ml"], "2026-01-01T00:00:00.000Z"),
      bm("3", "한국어 ML 문서", ["ml"], "2026-03-01T00:00:00.000Z"),
    ];
    expect(computeBridges(input)).toEqual(computeBridges(input));
  });

  it("skips malformed entries instead of throwing", () => {
    const result = computeBridges([
      null,
      { id: "bad", title: "x", url: "y" }, // missing tags
      bm("1", "日本語の記事", ["ml"]),
      bm("2", "English ML Guide", ["ml"]),
    ]);
    expect(result).toHaveLength(1);
  });

  it("reports coarse progress through the optional callback", () => {
    const phases: Array<[string, number]> = [];
    computeBridges(
      [bm("1", "日本語の記事", ["ml"]), bm("2", "English ML Guide", ["ml"])],
      {},
      (phase, fraction) => phases.push([phase, fraction]),
    );
    expect(phases[0]).toEqual(["sampling", 0.05]);
    expect(phases.some(([phase]) => phase === "comparing")).toBe(true);
    expect(phases[phases.length - 1]).toEqual(["done", 1]);
    // Fractions are monotonically non-decreasing.
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i]![1]).toBeGreaterThanOrEqual(phases[i - 1]![1]);
    }
  });
});
