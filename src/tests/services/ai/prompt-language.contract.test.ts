/**
 * src/tests/services/ai/prompt-language.contract.test.ts
 *
 * Prompt-language contract for the AI service layer.
 *
 * WHY THIS EXISTS (drift class, found 2026-10-01):
 * the prompt-language migration moved several AI services to English-only
 * prompts while five unit suites kept asserting the retired Spanish ones —
 * and one half-translated test had been renamed to claim English while its
 * assertion still checked Spanish. Unit tests pin prompt CONTENT, so they
 * fail loudly per assertion, but nothing pinned the LANGUAGE POLICY itself
 * or the honesty of the test names. This file closes that gap with three
 * executable guards:
 *
 *   1. POLICY — a manifest declares, per service method, whether prompts
 *      are `english-only`, `localized-es`, or `english-shell-lang-directive`
 *      (English shell + "Respond in language: <lang>."). The real services
 *      are invoked with lang="es" and lang="en" and their actual prompts
 *      are captured at generateText time; any policy change — someone
 *      re-adding a Spanish branch, or translating a localized prompt —
 *      fails here first. The manifest is the single source of truth: a
 *      deliberate policy change updates it in review.
 *
 *   2. PROVENANCE — a positive prompt assertion carrying a Spanish literal
 *      must trace to the corresponding service source (or the en/es locale
 *      data). A Spanish expectation whose service no longer emits it can
 *      never pass silently again.
 *
 *   3. NAME HONESTY — an `it()` name claiming "Spanish"/"English" prompt
 *      language must agree with the language of the literals asserted in
 *      its body. This is the exact half-translation pattern ("uses English
 *      prompt for all languages" asserting "Resumen del").
 *
 * Guards 2-3 are source scans over the AI test suites (self-excluded), so
 * they also cover future test files in src/tests/services.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock layer (union of the dependencies the captured services import).
// ---------------------------------------------------------------------------

const mockGenerateText = vi.hoisted(() => vi.fn());

const mockVaultCallbacks = vi.hoisted(() => ({
  lock: [] as Array<() => void>,
  unlock: [] as Array<() => void>,
}));

const mockInitDB = vi.hoisted(() => vi.fn());
const mockSafeGet = vi.hoisted(() => vi.fn());
const mockSafeSet = vi.hoisted(() => vi.fn());

vi.mock("../../../services/ai/ProviderManager", () => ({
  aiManager: {
    get generateText() {
      return mockGenerateText;
    },
    getApiKey: vi.fn(),
    getProviderInfo: vi
      .fn()
      .mockReturnValue({ provider: "gemini", model: "gemini-contract" }),
  },
}));

// require-securityvault-mock-lock-unlock: lock/unlock lifecycle symmetry.
vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    onLock: (listener: () => void) => {
      mockVaultCallbacks.lock.push(listener);
      return () => {};
    },
    onUnlock: (listener: () => void) => {
      mockVaultCallbacks.unlock.push(listener);
      return () => {};
    },
  },
}));

vi.mock("../../../services/ai/RAGEngine", () => ({
  ragEngine: {
    searchSimilar: vi.fn(),
    generateEmbedding: vi.fn(),
  },
}));

vi.mock("../../../services/RateLimitService", () => ({
  rateLimitService: {
    checkLimit: vi.fn(() => ({ exhausted: false, used: 0 })),
    getUsage: vi.fn(() => ({ requestsToday: 0 })),
  },
}));

vi.mock("../../../db/database", () => ({ initDB: mockInitDB }));

vi.mock("../../../store/safeStorage", () => ({
  safeGet: mockSafeGet,
  safeSet: mockSafeSet,
  safeRemove: vi.fn(),
}));

vi.mock("../../../i18n", () => ({
  default: {
    t: vi.fn((key: string, opts?: Record<string, unknown>) => {
      const defaults: Record<string, string> = {
        "ai_prompts.existing_tags_context": `Existing tags: ${(opts?.tags as string) || ""}`,
        "ai_prompts.folder_list": `Existing folders: ${(opts?.folders as string) || ""}`,
        general_folder: "General",
      };
      return defaults[key] || key;
    }),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockLocalStorage = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage });

const { ragEngine } = await import("../../../services/ai/RAGEngine");
const { taggingService } = await import("../../../services/ai/TaggingService");
const { crossPollinationService } = await import(
  "../../../services/ai/CrossPollinationService"
);
const { flashcardService } = await import("../../../services/ai/FlashcardService");
const { webSearchService } = await import("../../../services/ai/WebSearchService");

// ---------------------------------------------------------------------------
// Language classifier (deterministic, marker-based).
// ---------------------------------------------------------------------------

type PromptLanguage = "spanish" | "english";

const SPANISH_MARKERS =
  /[áéíóúñü¿¡]|(?:^|\s)(?:resumen|responde|genera|generar|etiquetas?|siguiente|contenido|título|titulo|organizador|devuelve|carpeta|palabras|nombre|como|solo|para|con|una|este|las?|los?|del|de)(?=\s|[.:,)]|$)/i;

function classifyLanguage(text: string): PromptLanguage {
  return SPANISH_MARKERS.test(text) ? "spanish" : "english";
}

// ---------------------------------------------------------------------------
// Guard 1 — policy manifest + runtime prompt capture.
// ---------------------------------------------------------------------------

type PromptPolicy = "english-only" | "localized-es" | "english-shell-lang-directive";

interface PromptShot {
  user: string;
  system: string;
}

interface CaptureEntry {
  key: string;
  policy: PromptPolicy;
  run: (lang: "es" | "en") => Promise<unknown>;
}

const FIXTURE_TEXT = "Contract fixture content for prompt capture. ".repeat(8); // >100 chars

const crossDb = {
  documents: {
    find: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([
        {
          id: "doc-1",
          title: "AI Research",
          content: "Deep learning and neural networks content.",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "doc-2",
          title: "Quantum Computing",
          content: "Quantum mechanics and computing.",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    })),
  },
  bookmarks: {
    find: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([
        {
          id: "bm-1",
          title: "Python Tutorial",
          description: "Learn Python programming.",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    })),
  },
  insights: {
    find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
    upsert: vi.fn().mockResolvedValue(undefined),
  },
};

const flashcardDb = {
  flashcards: { insert: vi.fn().mockResolvedValue({}) },
  documents: {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
    find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
  },
};

const SEARCH_STUB = [{ id: "doc-2", similarity: 0.85 }];

/**
 * The single source of truth for which language each service's prompts use.
 * Changing a service's prompt language REQUIRES updating this manifest —
 * that diff is the reviewable policy decision.
 */
const PROMPT_LANGUAGE_POLICY: Array<Omit<CaptureEntry, "run">> = [
  { key: "TaggingService.suggestTags", policy: "localized-es" },
  { key: "TaggingService.generateSummary", policy: "localized-es" },
  { key: "TaggingService.suggestFolder", policy: "localized-es" },
  { key: "CrossPollinationService.generateInsights", policy: "english-only" },
  { key: "CrossPollinationService.generateWeeklyCuration", policy: "english-only" },
  { key: "FlashcardService.generateFlashcards", policy: "english-only" },
  { key: "FlashcardService.generateFromBookmark", policy: "english-only" },
  { key: "WebSearchService.search", policy: "english-shell-lang-directive" },
];

const CAPTURES: CaptureEntry[] = [
  {
    key: "TaggingService.suggestTags",
    policy: "localized-es",
    run: (lang) => taggingService.suggestTags(FIXTURE_TEXT, lang),
  },
  {
    key: "TaggingService.generateSummary",
    policy: "localized-es",
    run: (lang) => taggingService.generateSummary(FIXTURE_TEXT, "Contract", lang),
  },
  {
    key: "TaggingService.suggestFolder",
    policy: "localized-es",
    run: (lang) => taggingService.suggestFolder(FIXTURE_TEXT, "Contract", [], lang),
  },
  {
    key: "CrossPollinationService.generateInsights",
    policy: "english-only",
    run: (lang) => {
      mockInitDB.mockResolvedValue(crossDb);
      (ragEngine.searchSimilar as ReturnType<typeof vi.fn>).mockResolvedValue(
        SEARCH_STUB,
      );
      crossPollinationService.__resetInsightsForTests();
      return crossPollinationService.generateInsights(lang);
    },
  },
  {
    key: "CrossPollinationService.generateWeeklyCuration",
    policy: "english-only",
    run: (lang) => {
      mockInitDB.mockResolvedValue(crossDb);
      crossPollinationService.__resetInsightsForTests();
      return crossPollinationService.generateWeeklyCuration(lang);
    },
  },
  {
    key: "FlashcardService.generateFlashcards",
    policy: "english-only",
    run: (lang) => {
      mockInitDB.mockResolvedValue(flashcardDb);
      return flashcardService.generateFlashcards("doc-contract", FIXTURE_TEXT, lang);
    },
  },
  {
    key: "FlashcardService.generateFromBookmark",
    policy: "english-only",
    run: (lang) => {
      mockInitDB.mockResolvedValue(flashcardDb);
      return flashcardService.generateFromBookmark(
        "bm-contract",
        "Contract",
        FIXTURE_TEXT,
        lang,
      );
    },
  },
  {
    key: "WebSearchService.search",
    policy: "english-shell-lang-directive",
    run: (lang) =>
      webSearchService.search("contract prompt fixture", lang, { isPrivate: false }),
  },
];

async function captureBoth(
  run: (lang: "es" | "en") => Promise<unknown>,
): Promise<{ es: PromptShot[]; en: PromptShot[] }> {
  const out: Record<"es" | "en", PromptShot[]> = { es: [], en: [] };
  for (const lang of ["es", "en"] as const) {
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: "[]", provider: "gemini" });
    try {
      await run(lang);
    } catch {
      /* INTENTIONAL SILENCE: post-prompt persistence/response-shaping steps
         may fail in this stripped harness — the guard only inspects the
         prompts captured at generateText time, which always happened first. */
    }
    out[lang] = mockGenerateText.mock.calls.map((call) => ({
      user: String(call[0] ?? ""),
      system: String(call[1] ?? ""),
    }));
  }
  return out;
}

function joined(shots: PromptShot[]): string {
  return shots.map((s) => `${s.system}\n${s.user}`).join("\n---\n");
}

function stripLangDirective(shots: PromptShot[]): PromptShot[] {
  return shots.map((s) => ({
    user: s.user,
    system: s.system.replace(/Respond in language: [a-z-]+\./g, ""),
  }));
}

// ---------------------------------------------------------------------------
// Guard 2/3 — source scans over the AI service test suites.
// ---------------------------------------------------------------------------

const TESTS_SERVICES_DIR = join(import.meta.dirname, "..", "..");
const SRC_DIR = join(TESTS_SERVICES_DIR, "..");
const SERVICES_DIR = join(SRC_DIR, "services");
const LOCALES_DIR = join(SRC_DIR, "..", "public", "locales");
const SELF = join(import.meta.dirname, "prompt-language.contract.test.ts");

/** Literal → reason it may legitimately lack provenance in the service. */
const PROVENANCE_EXEMPTIONS: Record<string, string> = {};

function listTestFiles(): string[] {
  return readdirSync(TESTS_SERVICES_DIR, { recursive: true })
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter((f) => f.endsWith(".test.ts") || f.endsWith(".test.tsx"))
    .map((f) => join(TESTS_SERVICES_DIR, f))
    .filter((f) => f !== SELF);
}

function serviceSourceFor(testFile: string): string | null {
  const base = testFile.replaceAll("\\", "/").split("/").pop()!.replace(/\.test\.tsx?$/, "");
  const candidates = readdirSync(SERVICES_DIR, { recursive: true })
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter((f) => f.endsWith(`${base}.ts`) || f.endsWith(`${base}.tsx`));
  if (candidates.length === 0) return null;
  return readFileSync(join(SERVICES_DIR, candidates[0]!), "utf8");
}

const localeCorpus = ["en.json", "es.json"]
  .map((f) => {
    try {
      return readFileSync(join(LOCALES_DIR, f), "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

// Negative assertions (not.toContain / not.toBe) are excluded: the dot
// before the matcher IS the dot of ".not", hence the `(?<!not)` guard.
const POSITIVE_LITERAL_RE = /(?<!not)(?:\.toContain|\.toBe)\(\s*(["'`])([^"'`]+)\1/g;

function promptAssertionLiterals(content: string): string[] {
  const literals: string[] = [];
  for (const match of content.matchAll(POSITIVE_LITERAL_RE)) {
    const before = content.slice(Math.max(0, match.index! - 120), match.index!);
    // Only assertions on prompt-ish receivers (captured call args).
    if (!/(prompt|system|calls\s*\[\s*0\s*\]|calls\s*\[\s*1\s*\])/i.test(before)) {
      continue;
    }
    literals.push(match[2]!);
  }
  return literals;
}

function bodyOfTestAt(lines: string[], start: number): string {
  const chunk: string[] = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(?:it|test|describe)(?:\.each)?\s*[(.`]/.test(lines[i]!)) break;
    chunk.push(lines[i]!);
  }
  return chunk.join("\n");
}

// ---------------------------------------------------------------------------

describe("AI prompt-language contract", () => {
  describe("guard 1: services honor the declared prompt-language policy", () => {
    // The manifest and the captures must describe the same surface — a new
    // captured method without a policy (or vice versa) fails here.
    it("policy manifest and captures cover the same methods", () => {
      const manifestKeys = PROMPT_LANGUAGE_POLICY.map((e) => e.key).sort();
      const captureKeys = CAPTURES.map((e) => e.key).sort();
      expect(captureKeys).toEqual(manifestKeys);
    });

    for (const entry of CAPTURES) {
      it(`${entry.key} → ${entry.policy}`, async () => {
        const captured = await captureBoth(entry.run);
        expect(
          captured.es.length,
          `${entry.key}: no prompts captured — the harness no longer reaches generateText`,
        ).toBeGreaterThan(0);

        switch (entry.policy) {
          case "english-only": {
            expect(
              captured.es,
              `${entry.key}: english-only policy — prompts must not vary with lang`,
            ).toEqual(captured.en);
            expect(
              classifyLanguage(joined(captured.es)),
              `${entry.key}: english-only policy — captured prompt is not English`,
            ).toBe("english");
            break;
          }
          case "localized-es": {
            expect(
              captured.es,
              `${entry.key}: localized-es policy — prompts must vary with lang`,
            ).not.toEqual(captured.en);
            expect(
              classifyLanguage(joined(captured.es)),
              `${entry.key}: localized-es policy — the es prompt must be Spanish`,
            ).toBe("spanish");
            expect(
              classifyLanguage(joined(captured.en)),
              `${entry.key}: localized-es policy — the en prompt must be English`,
            ).toBe("english");
            break;
          }
          case "english-shell-lang-directive": {
            expect(
              stripLangDirective(captured.es),
              `${entry.key}: only the "Respond in language:" directive may vary with lang`,
            ).toEqual(stripLangDirective(captured.en));
            expect(
              captured.es.some((s) => /Respond in language: es/.test(s.system)),
              `${entry.key}: es run must carry the language directive`,
            ).toBe(true);
            expect(
              classifyLanguage(joined(stripLangDirective(captured.es))),
              `${entry.key}: prompt shell must be English`,
            ).toBe("english");
            break;
          }
        }
      });
    }
  });

  describe("guard 2: Spanish prompt assertions trace to service or locale source", () => {
    it("every Spanish prompt-assertion literal has provenance", () => {
      const offenders: string[] = [];
      for (const testFile of listTestFiles()) {
        const content = readFileSync(testFile, "utf8");
        const serviceSource = serviceSourceFor(testFile);
        if (serviceSource === null) continue; // no service under test → no contract
        for (const literal of promptAssertionLiterals(content)) {
          if (classifyLanguage(literal) !== "spanish") continue;
          const provenance =
            serviceSource.includes(literal) ||
            localeCorpus.includes(literal) ||
            Object.hasOwn(PROVENANCE_EXEMPTIONS, literal);
          if (!provenance) {
            offenders.push(
              `${testFile.replaceAll("\\", "/").split("/").slice(-2).join("/")}: "${literal}"`,
            );
          }
        }
      }
      expect(
        offenders,
        "Spanish prompt assertions whose service no longer emits them — " +
          "update the test or add a reviewed PROVENANCE_EXEMPTIONS entry:\n" +
          offenders.join("\n"),
      ).toEqual([]);
    });
  });

  describe("guard 3: test names agree with the language they assert", () => {
    it("no it() name claims a prompt language its assertions contradict", () => {
      const offenders: string[] = [];
      for (const testFile of listTestFiles()) {
        const lines = readFileSync(testFile, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const nameMatch = lines[i]!.match(
            /\b(?:it|test)(?:\.each\([^)]*\))?\(\s*(["'`])([^"'`]+)\1/,
          );
          if (!nameMatch) continue;
          const name = nameMatch[2]!;
          if (!/prompt/i.test(name)) continue;
          const claimsSpanish = /spanish|español/i.test(name);
          const claimsEnglish = /english/i.test(name);
          if (!claimsSpanish && !claimsEnglish) continue;

          const body = bodyOfTestAt(lines, i);
          const literals = [...body.matchAll(POSITIVE_LITERAL_RE)].map((m) => m[2]!);
          const languages = new Set(literals.map(classifyLanguage));

          if (claimsEnglish && languages.has("spanish")) {
            offenders.push(
              `${testFile.replaceAll("\\", "/").split("/").slice(-2).join("/")}: "${name}" ` +
                "claims English but asserts a Spanish literal — half-translated test",
            );
          }
          if (claimsSpanish && literals.length > 0 && !languages.has("spanish")) {
            offenders.push(
              `${testFile.replaceAll("\\", "/").split("/").slice(-2).join("/")}: "${name}" ` +
                "claims Spanish but asserts no Spanish literal — half-translated test",
            );
          }
        }
      }
      expect(
        offenders,
        "Prompt-language test names contradicting their assertions:\n" + offenders.join("\n"),
      ).toEqual([]);
    });
  });
});
