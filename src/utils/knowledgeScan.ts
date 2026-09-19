/**
 * Pure knowledge-scan primitives shared between the main thread and the
 * knowledge-scan Web Worker (src/workers/knowledgeScan.worker.ts).
 *
 * No DOM / React / i18n dependencies: the worker imports this module directly,
 * and CrossLanguageBridge imports the same functions for its inline fallback
 * (jsdom tests, environments where workers are unavailable, transient pool
 * failures).
 *
 * The pairwise scan is deliberately bounded so a vault with 100k+ bookmarks
 * cannot freeze the UI (main-thread fallback) or the worker:
 *   - MAX_ITEMS_PER_LANG: at most this many items per language, sampled by
 *     RELEVANCE (visitCount desc, then updatedAt desc, id tie-break) so the
 *     most-used bookmarks of each language group win and one huge group
 *     cannot dominate the comparison.
 *   - MAX_SCAN_ITEMS: global cap across all languages (largest groups win,
 *     deterministic order). Worst case is ~(1200²)/2 ≈ 720k jaccard
 *     evaluations — sub-second even on the main thread.
 *
 * `topic` is `string | null` on purpose: the fallback label is an i18n
 * concern ("Shared Topic"), so the worker returns `null` and the component
 * resolves it through `t()` at render time.
 */

export interface ScanBookmark {
  id: string;
  title: string;
  url: string;
  tags: string[];
  /** ISO date used for the recency leg of relevance sampling. */
  updatedAt?: string;
  /** Visit count — the primary relevance signal in sampling. */
  visitCount?: number;
}

interface LanguagePair {
  lang: string;
  title: string;
}

export interface Bridge {
  topic: string | null;
  pairs: LanguagePair[];
}

export interface BridgeScanOptions {
  maxItemsPerLang?: number;
  maxScanItems?: number;
}

/** Coarse scan phases reported through the optional progress callback. */
export type ScanPhase = "sampling" | "comparing" | "done";

/**
 * Progress callback invoked at phase checkpoints during computeBridges.
 * `fraction` is 0..1. Cheap to call: the worker posts a status message per
 * invocation, so it must never be called per-item on large inputs — it is
 * called once per language-group pass, at most a few dozen times.
 */
type ScanProgressCallback = (phase: ScanPhase, fraction: number) => void;

export const MAX_ITEMS_PER_LANG = 200;
export const MAX_SCAN_ITEMS = 1200;

function clampPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Relevance comparator for bounded sampling: usage first (visitCount desc),
 * recency second (updatedAt desc), then id asc — a strict total order so the
 * sample is identical across runs and devices. Never-visited bookmarks rank
 * by recency; ties are broken by id. The sort spec treats a NaN comparator
 * result as equal, so a corrupt visitCount can never break determinism.
 */
function compareByRelevance(a: ScanBookmark, b: ScanBookmark): number {
  const byVisits = (b.visitCount ?? 0) - (a.visitCount ?? 0);
  if (byVisits !== 0) {return byVisits;}
  const byDate = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  if (byDate !== 0) {return byDate;}
  return a.id.localeCompare(b.id);
}

/** Detects the script of a bookmark title/URL; returns the language code. */
export function detectLanguage(title: string, url: string): string {
  const text = `${title} ${url}`;
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {return "ja";}
  if (/[\uAC00-\uD7AF]/.test(text)) {return "ko";}
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) {return "zh";}
  if (/[\u0400-\u04FF]/.test(text)) {return "ru";}
  if (/[\u0600-\u06FF]/.test(text)) {return "ar";}
  if (/[\u0900-\u097F]/.test(text)) {return "hi";}
  return "en";
}

/** Jaccard overlap of two tag sets; 0 when either side is empty. */
export function jaccardOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {return 0;}
  const setA = new Set(a);
  const intersection = b.filter((t) => setA.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

function pushPair(
  bridge: Bridge,
  lang: string,
  title: string,
): void {
  if (
    bridge.pairs.some((p) => p.lang === lang && p.title === title)
  ) {
    return;
  }
  bridge.pairs.push({ lang, title });
}

function validBookmark(value: unknown): value is ScanBookmark {
  if (typeof value !== "object" || value === null) {return false;}
  const bm = value as Record<string, unknown>;
  return (
    typeof bm.id === "string" &&
    typeof bm.title === "string" &&
    typeof bm.url === "string" &&
    Array.isArray(bm.tags) &&
    bm.tags.every((tag) => typeof tag === "string")
  );
}

/**
 * Computes cross-language bridges from bookmarks. Bounded and deterministic:
 * the same input always yields the same output, and the pairwise comparison
 * never exceeds the caps above.
 *
 * `onProgress` is optional and is invoked at coarse phase checkpoints
 * (sampling → comparing → done). The callback may throw (e.g. an abort
 * check) and the exception propagates to the caller.
 */
export function computeBridges(
  bookmarks: readonly unknown[],
  options: BridgeScanOptions = {},
  onProgress?: ScanProgressCallback,
): Bridge[] {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) {return [];}

  const maxItemsPerLang = clampPositiveInt(
    options.maxItemsPerLang,
    MAX_ITEMS_PER_LANG,
  );
  const maxScanItems = clampPositiveInt(options.maxScanItems, MAX_SCAN_ITEMS);

  // Group by detected language (single O(n) pass over all bookmarks).
  const byLang = new Map<string, ScanBookmark[]>();
  for (const raw of bookmarks) {
    if (!validBookmark(raw)) {continue;}
    const lang = detectLanguage(raw.title, raw.url);
    const group = byLang.get(lang);
    if (group) {
      group.push(raw);
    } else {
      byLang.set(lang, [raw]);
    }
  }
  if (byLang.size === 0) {return [];}

  // Per-language relevance sample (visitCount desc → updatedAt desc → id).
  for (const group of byLang.values()) {
    if (group.length > maxItemsPerLang) {
      group.sort(compareByRelevance);
      group.length = maxItemsPerLang;
    }
  }

  // Global cap: keep the largest groups (deterministic tie-break by lang
  // name) so the pairwise bound holds no matter how many languages exist.
  const groups = [...byLang.entries()].sort(
    (a, b) =>
      b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const selected: Array<[string, ScanBookmark[]]> = [];
  let kept = 0;
  for (const [lang, group] of groups) {
    if (kept >= maxScanItems) {break;}
    const remaining = maxScanItems - kept;
    if (group.length > remaining) {
      // Keep a deterministic prefix of the sampled group (already sorted by
      // relevance, so the most relevant `remaining` items win).
      selected.push([lang, group.slice(0, remaining)]);
      kept += remaining;
    } else {
      selected.push([lang, group]);
      kept += group.length;
    }
  }

  const langs = selected.map(([lang]) => lang);
  const selectedByLang = new Map(selected);
  const computed: Bridge[] = [];

  // Coarse progress: the O(n) sampling pass and one update per language
  // pair-group pass. Never per-item — the callback posts a worker message.
  onProgress?.("sampling", 0.05);

  for (let i = 0; i < langs.length; i++) {
    onProgress?.("comparing", 0.05 + 0.9 * (i / Math.max(langs.length, 1)));
    for (let j = i + 1; j < langs.length; j++) {
      const langA = langs[i]!;
      const langB = langs[j]!;
      const groupA = selectedByLang.get(langA)!;
      const groupB = selectedByLang.get(langB)!;
      for (const itemA of groupA) {
        for (const itemB of groupB) {
          if (jaccardOverlap(itemA.tags, itemB.tags) <= 0) {continue;}
          const sharedTags = itemA.tags.filter((tag) =>
            itemB.tags.includes(tag),
          );
          const topic = sharedTags[0] ?? null;
          const existing = computed.find((br) => br.topic === topic);
          if (existing) {
            pushPair(existing, langA, itemA.title);
            pushPair(existing, langB, itemB.title);
          } else {
            computed.push({
              topic,
              pairs: [
                { lang: langA, title: itemA.title },
                { lang: langB, title: itemB.title },
              ],
            });
          }
        }
      }
    }
  }

  onProgress?.("done", 1);
  return computed;
}
