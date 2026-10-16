/**
 * tests/e2e/text-fit-helpers.ts
 *
 * Helpers for the cross-locale text-fit spec (tests/e2e/text-fit.spec.ts).
 *
 * Two responsibilities:
 *
 *   1. Pre-seed `localStorage["i18nextLng"]` BEFORE the app boots. src/i18n.ts
 *      calls detectUserLanguage() on init, which reads that key, so seeding
 *      via `addInitScript` is the cleanest "user just switched language"
 *      path — it survives a hard reload AND it is applied before react/i18n
 *      wires up.
 *
 *   2. Walk the rendered DOM and produce per-element layout metrics so we
 *      can flag two distinct failure modes:
 *
 *      a) **Overflow without defense** — visible text scrolls past its
 *         container width AND there is no truncation defense anywhere in
 *         the element's rendering chain (own class, computed style, or
 *         ancestor with the same). This is the bug the spec exists to
 *         catch — a button whose Spanish label spills past the sidebar
 *         and nobody bothered to `truncate` it.
 *      b) **Dead truncation** (informational log, not a failure) — an
 *         element claims to be truncating (own or ancestor) but currently
 *         has no overflow. Not a bug today, but a smell that the safety
 *         net is defensive-only and may have been forgotten.
 */
import { expect, type Page } from "@playwright/test";
import type { BookmarkDocType } from "../../src/db/schema";
import {
  CRITICAL_LOCALE_CODES,
  NIGHTLY_LOCALE_CODES,
  SUPPORTED_LOCALE_CODES,
  SMALL_FALLBACK_LOCALES,
  type LocaleCode,
} from "../../src/constants/locales";

/**
 * Re-export the canonical locale lists so spec files only have to
 * import from `./text-fit-helpers` (single entry point). Source-of-
 * truth lives in `src/constants/locales.ts`; we re-export to keep the
 * spec ergonomics flat.
 */
export {
  CRITICAL_LOCALE_CODES,
  NIGHTLY_LOCALE_CODES,
  SMALL_FALLBACK_LOCALES,
};

export type { LocaleCode };

/**
 * Every supported locale, derived from the canonical list. Convenience
 * alias so spec files can say `ALL_LOCALE_CODES` without reaching into
 * `src/constants/locales.ts`.
 */
export const ALL_LOCALE_CODES: ReadonlyArray<LocaleCode> =
  SUPPORTED_LOCALE_CODES as ReadonlyArray<LocaleCode>;

/**
 * Spec gate scopes. Each maps 1:1 to a Playwright config / CI workflow:
 *   - `critical` — `tests/e2e/text-fit.spec.ts` runs on every CI gate.
 *   - `nightly`  — `tests/e2e/text-fit.nightly.spec.ts` runs in the
 *                  nightly workflow only.
 *   - `all`      — convenience scope if a one-off sweep is ever
 *                  wanted (e.g. `npx playwright test --grep "@critical"`).
 *   - `small`    — universal three-locale fallback for a quick smoke.
 */
export type LocaleScope = "critical" | "nightly" | "all" | "small";

/**
 * Resolve locale codes for a spec scope. The critical/nightly/all
 * branches are sourced from the canonical `SUPPORTED_LOCALE_CODES`;
 * the `small` branch hands back `SMALL_FALLBACK_LOCALES` so a smoke
 * run never accidentally pulls in the full 30-locale union.
 *
 * If the underlying constant module fails to load (build / sandbox
 * glitch), the constant module itself throws at module init with a
 * descriptive message — there is intentionally no try/catch here:
 * silent fall-back would hide a config regression.
 */
export function loadLocaleCodes(
  scope: LocaleScope,
): ReadonlyArray<LocaleCode> {
  switch (scope) {
    case "critical":
      return CRITICAL_LOCALE_CODES;
    case "nightly":
      return NIGHTLY_LOCALE_CODES;
    case "all":
      return SUPPORTED_LOCALE_CODES as ReadonlyArray<LocaleCode>;
    case "small":
      return SMALL_FALLBACK_LOCALES;
  }
}

export type ViewId =
  | "lock-screen"
  | "dashboard"
  | "bookmark-list"
  | "bookmark-filters"
  | "settings-panel"
  | "editor"
  | "chat"
  | "canvas"
  | "collaboration"
  | "onboarding";
export const VIEWS: ViewId[] = [
  "lock-screen",
  "dashboard",
  "bookmark-list",
  "bookmark-filters",
  "settings-panel",
  "editor",
  "chat",
  "canvas",
  "collaboration",
  "onboarding",
];

/**
 * Unicode-heavy tag pool for the populated-bookmark stress seed. Each
 * entry pushes a different width/bidi profile through the TagFilterBar
 * chips and the row TagManager pills: wide CJK, emoji ZWJ sequences,
 * combining marks, and RTL text.
 */
export const PATHOLOGICAL_TAGS: ReadonlyArray<string> = [
  "🔥日本語カフェ",
  "👨‍👩‍👧‍👦familie",
  "ünïcödé-täg",
  "الشَّرِكةُ",
  "café☕strasse",
  "中文标签",
  "🏳️‍🌈tag",
];

/**
 * Title archetypes for the pathological seed. Each is repeated to the
 * schema's `maxLength: 500` code units and stresses a different layout
 * axis (widest Latin glyph, CJK, RTL, emoji ZWJ, combining marks,
 * word-wrapped prose).
 */
const TITLE_TEMPLATES: ReadonlyArray<string> = [
  "W",
  "日本語テスト漢字",
  "الألفية العربية",
  "👨‍👩‍👧‍👦🧪🚀🔥",
  "combining: a\u0301e\u0301i\u0301o\u0301u\u0301",
  "The quick brown fox jumps over the lazy dog. ",
];

/**
 * Repeat `template` until it reaches `maxLen` UTF-16 code units WITHOUT
 * ever splitting a surrogate pair. A naive `template.repeat().slice(0,
 * n)` can cut an emoji ZWJ sequence mid-surrogate, producing a lone
 * surrogate that renders as � and makes row-content assertions flaky.
 * Returns a string of length ≤ maxLen.
 */
function repeatToCodeUnits(template: string, maxLen: number): string {
  const cps = Array.from(template);
  const out: string[] = [];
  let units = 0;
  let guard = 0;
  while (guard++ < 100_000) {
    for (const cp of cps) {
      if (units + cp.length > maxLen) return out.join("");
      out.push(cp);
      units += cp.length;
    }
    if (units >= maxLen) return out.join("");
  }
  return out.join("");
}

export interface SeedPathologicalBookmarksOptions {
  /** Number of bookmarks to inject. Default 8 (user asked 5-10). */
  count?: number;
  /** Title length in code units, capped at schema maxLength 500. */
  titleLen?: number;
  /** URL length in chars, capped at schema maxLength 2000. */
  urlLen?: number;
}

/**
 * Inject `count` pathological bookmarks DIRECTLY into IndexedDB via the
 * RxDB `bulkInsert` API — deliberately NOT through the UI. Same access
 * path as `text-fit-fuzz.spec.ts` (`await import("/src/db/database.ts")`
 * + `initDB()`), so encryption + schema validation run as in normal use.
 *
 * Each doc: 500-code-unit title (mixed archetypes, ASCII `PATHO{n}:`
 * prefix for deterministic DOM waiting), 2000-char URL, and Unicode
 * tags. The collection is hard-wiped first (`find().remove()`) so the
 * seed is idempotent across locales / iterations.
 *
 * Requires the app to be UNLOCKED (call after `skipPassword`) so the
 * RxDB instance is open — mirrors the fuzz spec's ordering.
 */
export async function seedPathologicalBookmarks(
  page: Page,
  opts: SeedPathologicalBookmarksOptions = {},
): Promise<void> {
  const count = opts.count ?? 8;
  const titleLen = Math.min(opts.titleLen ?? 500, 500);
  const urlLen = Math.min(opts.urlLen ?? 2000, 2000);

  const now = Date.now();
  const docs: BookmarkDocType[] = Array.from(
    { length: count },
    (_, i): BookmarkDocType => {
      // Prefix length is computed from the actual value so a future
      // count > 9 (PATHO10: is 8 chars) cannot push title past the
      // schema maxLength. The ASCII prefix keeps row-wait sentinels
      // searchable even when the body is all-emoji / RTL.
      const titlePrefix = `PATHO${i}:`;
      const title =
        titlePrefix +
        repeatToCodeUnits(
          TITLE_TEMPLATES[i % TITLE_TEMPLATES.length]!,
          Math.max(0, titleLen - titlePrefix.length),
        );
      const urlPrefix = "https://e.example.com/";
      const url = urlPrefix + "a".repeat(Math.max(0, urlLen - urlPrefix.length));
      const tagA = PATHOLOGICAL_TAGS[0]!;
      const tagB = PATHOLOGICAL_TAGS[1 + (i % 3)]!;
      return {
        id: `patho-${i}-${now}`,
        url,
        urlHash: "",
        title,
        // Every doc carries the first tag; the second tag is spread across
        // docs so filtering by tagB yields a deterministic 3-row subset
        // (docs 0, 3, 6) the spec can assert on.
        tags: [tagA, tagB],
        relatedLinks: [],
        processed: true,
        isPrivate: false,
        isDeleted: false,
        visitCount: 0,
        createdAt: new Date(now - i * 1000).toISOString(),
        updatedAt: new Date(now - i * 1000).toISOString(),
      };
    },
  );

  await page.evaluate(
    async (payload: { docs: BookmarkDocType[] }) => {
      const { initDB } = await import("/src/db/database.ts");
      const db = await initDB();
      await db.bookmarks.find().remove();
      await db.bookmarks.bulkInsert(payload.docs);
    },
    { docs },
  );
}

/** Tailwind class markers that add real truncation behavior (overflow:hidden +
 *  text-overflow:ellipsis, or vertical line-clamp). Tested on this element OR
 *  on a close ancestor — that is what catches "truncate on the parent <div>
 *  protects the child <span>" correctly. */
const TRUNCATION_CLASS = /\b(?:truncate|line-clamp-[1-6])\b/;

/** Per-element audit row returned from the DOM walker. */
export interface AuditRow {
  tag: string;
  testId: string | null;
  ariaLabel: string | null;
  role: string | null;
  text: string;
  scrollW: number;
  clientW: number;
  scrollH: number;
  clientH: number;
  hasOwnTruncationClass: boolean;
  hasDefense: boolean;
  defenseSource: "own-class" | "own-computed" | "ancestor-class" | "ancestor-computed" | "none";
  defenseDepth: number; // -1 when none
  overflowX: boolean;
  overflowY: boolean;
  visible: boolean;
}

export interface OverflowViolation {
  row: AuditRow;
  reason: string;
}

/**
 * Fuzz-spec helper. Used by `tests/e2e/text-fit-fuzz.spec.ts` (and any
 * future pathologically-stressed spec) to assert two failure modes:
 *
 *   1. overflow WITHOUT defense (delegates to `findOverflowViolations`),
 *   2. `document.documentElement.scrollHeight` exceeds an absolute
 *      ceiling. The documentElement (not body) is read because
 *
 * Returns the measured metrics so the caller (typically a fast-check
 * `asyncProperty` predicate) can compare the *current* height against the
 * previous iteration's height and fail on a large inter-iteration delta.
 * The previous-height comparison is deliberately NOT encapsulated here
 * because fast-check needs the closure-captured `prev` across iterations
 * — keeping it out of this helper avoids a hidden module-level cache
 * that would silently couple tests to each other.
 */
export interface AssertTextFitsOptions {
  /**
   * Maximum allowed number of overflow-without-defense bugs. Default `0`.
   * Setting `> 0` is useful for "no regressions above today's count" gating.
   */
  maxOverflowViolations?: number;
  /**
   * Maximum allowed `document.body.scrollHeight` (in CSS pixels). Default
   * uninterested. Use this to fail fast when the test renders an
   * unbounded-length title that breaks the layout's intrinsic bounds
   * (e.g. a row that we expect to be 80 px tall ballooned to 600 px).
   */
  maxHeight?: number;
}

export interface AssertTextFitsResult {
  bodyHeight: number;
  overflowCount: number;
  violations: OverflowViolation[];
}

export async function assertTextFits(
  page: Page,
  opts: AssertTextFitsOptions = {},
): Promise<AssertTextFitsResult> {
  const rows = await auditTextOverflow(page);
  const violations = findOverflowViolations(rows);
  const bodyHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );

  const overflowCount = violations.length;
  const maxOverflow = opts.maxOverflowViolations ?? 0;
  if (overflowCount > maxOverflow) {
    const first = violations[0];
    const sample = first
      ? `${first.row.tag}[role=${first.row.role ?? "?"}]${
          first.row.testId ? `[testid=${first.row.testId}]` : ""
        } "${first.row.text}" +${
          first.row.scrollW - first.row.clientW
        }px (scrollW=${first.row.scrollW} > clientW=${first.row.clientW})`
      : "<none>";
    throw new Error(
      `[text-fit-fuzz] ${overflowCount} overflow violation(s) detected ` +
        `(max ${maxOverflow}). First: ${sample}. ` +
        `All flows: ${violations.slice(0, 3).map((v) => `${v.row.tag}("${v.row.text.slice(0, 40)}…")`).join(", ")}`,
    );
  }
  if (opts.maxHeight !== undefined && bodyHeight > opts.maxHeight) {
    throw new Error(
      `[text-fit-fuzz] document.documentElement.scrollHeight = ${bodyHeight}px ` +
        `exceeds maxHeight = ${opts.maxHeight}px`,
    );
  }

  return { bodyHeight, overflowCount, violations };
}

/**
 * Pre-seed localStorage so the app boots in a specific locale, and disable
 * transient overlays that would nondeterministically cover our audit
 * targets. Mirrors the trick used by tests/e2e/visual-testing.spec.ts.
 *
 * `addInitScript`'s `(script, arg)` form is documented Playwright API; the
 * locale string is JSON-serialized into the page-context callback.
 *
 * The seed is scoped PER browser context: `addInitScript` re-attaches to
 * every navigation inside the same `page` lifetime, but a fresh test gets a
 * fresh context. Do not hoist this into a `beforeAll`/`test.beforeAll`
 * shared across multiple `test(...)` blocks — the locale would leak across
 * tests and the second test would silently inherit the first test's locale.
 */
export async function seedLocale(
  page: Page,
  locale: LocaleCode,
): Promise<void> {
  await page.addInitScript((code: string) => {
    window.localStorage.setItem("i18nextLng", code);
    // Skip the WebLLM warmup download (ProviderManager reads
    // forge_test_mode from localStorage, which suppresses warmup no matter
    // which production trigger fires it — unlock listener or editor-focus
    // handler): the model card with its moving
    // progress bar would make the chat-view baseline non-deterministic.
    window.localStorage.setItem("forge_test_mode", "true");
    // WelcomeTour: never render the guided tour overlay.
    window.localStorage.setItem("forge_welcome_tour_complete", "true");
    // QuickTips: mark today's tip as shown so it never renders.
    window.localStorage.setItem(
      `forge_tip_shown_${new Date().toDateString()}`,
      "true",
    );
    window.localStorage.setItem("forge_dismissed_tips", "[]");
  }, locale);
}

/**
 * Walk the rendered DOM, filter to visible text-bearing elements with
 * bounding boxes, and return layout metrics + truncation-defense status
 * for each. Pure DOM-side measurement — Playwright never receives a huge
 * HTML string, just the resulting JSON-friendly row objects.
 */
export async function auditTextOverflow(page: Page): Promise<AuditRow[]> {
  return await page.evaluate(() => {
    type Row = {
      tag: string;
      testId: string | null;
      ariaLabel: string | null;
      role: string | null;
      text: string;
      scrollW: number;
      clientW: number;
      scrollH: number;
      clientH: number;
      hasOwnTruncationClass: boolean;
      hasDefense: boolean;
      defenseSource:
        | "own-class"
        | "own-computed"
        | "ancestor-class"
        | "ancestor-computed"
        | "none";
      defenseDepth: number;
      overflowX: boolean;
      overflowY: boolean;
      visible: boolean;
    };

    const TIGHT_TRUNCATION_CLASS = /\b(?:truncate|line-clamp-[1-6])\b/;
    // 5 levels of ancestor walking covers Tailwind utility nesting in
    // card stacks (e.g. card > header > row > wrapper > span) while
    // keeping the walk bounded. Tightening to depth 1 in the name of
    // "perf" will silently lose ancestor-defense coverage and produce
    // false-positive overflow violations against legitimate layouts.
    const TRUNCATION_DEPTH_LIMIT = 5;

    function isInAriaHidden(el: Element): boolean {
      let cur: Element | null = el;
      while (cur) {
        if (cur.getAttribute("aria-hidden") === "true") return true;
        cur = cur.parentElement;
      }
      return false;
    }

    // Selectors below target HTML tags only (`h1..dd`), so `el.className`
    // is always a `string`. The element-union type lies about that for
    // SVG; coerce defensively rather than chase it through `SVGAnimatedString`.
    function classString(el: Element): string {
      return String(el.className ?? "");
    }

    /** Walks the element + ancestors looking for a truncation defense. */
    function detectDefense(
      el: HTMLElement,
    ): {
      hasDefense: boolean;
      source: Row["defenseSource"];
      depth: number;
      ownHasClass: boolean;
    } {
      const ownClass = classString(el);
      const ownHasClass = TIGHT_TRUNCATION_CLASS.test(ownClass);
      if (ownHasClass) {
        return { hasDefense: true, source: "own-class", depth: 0, ownHasClass: true };
      }
      const ownCS = window.getComputedStyle(el);
    if (
      ownCS.textOverflow === "ellipsis" &&
      (ownCS.overflowX === "hidden" || ownCS.overflowX === "clip")
    ) {
      // Defense-by-computed-style is treated as legitimate; the
      // `countDeadTruncationsBySource` rule below intentionally excludes
      // these from the dead-truncation counter because they may be
      // applied by theme CSS rather than an explicit styling choice —
      // surfacing them as "dead" would create noisy false reports on
      // every clean run.
      return {
        hasDefense: true,
        source: "own-computed",
        depth: 0,
        ownHasClass: false,
      };
    }
    let cur: Element | null = el.parentElement;
    let depth = 1;
    while (cur && depth <= TRUNCATION_DEPTH_LIMIT) {
      if (cur instanceof HTMLElement) {
        if (TIGHT_TRUNCATION_CLASS.test(classString(cur))) {
          return {
            hasDefense: true,
            source: "ancestor-class",
            depth,
            ownHasClass: false,
          };
        }
        const cs = window.getComputedStyle(cur);
        if (
          cs.textOverflow === "ellipsis" &&
          (cs.overflowX === "hidden" || cs.overflowX === "clip")
        ) {
            return {
              hasDefense: true,
              source: "ancestor-computed",
              depth,
              ownHasClass: false,
            };
          }
        }
        cur = cur.parentElement;
        depth += 1;
      }
      return { hasDefense: false, source: "none", depth: -1, ownHasClass: false };
    }

    const TAGS =
      "h1, h2, h3, h4, h5, h6, p, span, button, a, label, td, th, li, dt, dd";
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>(TAGS),
    );

    const out: Row[] = [];
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      // The skip link is intentionally visually collapsed to 1×1 until
      // keyboard focus; its scrollWidth therefore contains the hidden label
      // by design, not a user-visible layout defect.
      if (el.classList.contains("skip-link")) continue;
      const rawText = (el.textContent ?? "").trim();
      if (!rawText) continue;
      if (isInAriaHidden(el)) continue;

      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const rects = el.getClientRects();
      if (rects.length === 0) continue;
      // Inline elements expose client rects but have no scroll container:
      // Firefox/WebKit report clientWidth/clientHeight as 0 for these
      // spans, while scrollWidth still contains the glyph width. Treating
      // that pair as overflow creates a false positive (the surrounding
      // flex/grid item is the actual layout container and is audited
      // separately). Only audit elements with a measurable client box.
      if (el.clientWidth === 0 && el.clientHeight === 0) continue;

      const defense = detectDefense(el);
      const scrollW = el.scrollWidth;
      const clientW = el.clientWidth;
      const scrollH = el.scrollHeight;
      const clientH = el.clientHeight;

      out.push({
        tag: el.tagName.toLowerCase(),
        testId: el.getAttribute("data-testid"),
        ariaLabel: el.getAttribute("aria-label"),
        role: el.getAttribute("role"),
        text:
          rawText.length > 80 ? rawText.slice(0, 77) + "…" : rawText,
        scrollW,
        clientW,
        scrollH,
        clientH,
        hasOwnTruncationClass: defense.ownHasClass,
        hasDefense: defense.hasDefense,
        defenseSource: defense.source,
        defenseDepth: defense.depth,
        // 1px fudge absorbs sub-pixel rendering noise across locales.
        overflowX: scrollW > clientW + 1,
        overflowY: scrollH > clientH + 1,
        visible: true,
      });
    }
    return out;
  });
}

/**
 * The hard failure rule. An element is a "real overflow violation" if:
 *
 *   - it is currently visible (returned by the walker),
 *   - it is horizontally overflowing (`scrollW > clientW + 1`), AND
 *   - no truncation defense exists at this element OR any ancestor up
 *     to depth 5 (own / ancestor `truncate`/`line-clamp-N` class OR own
 *     / ancestor `text-overflow:ellipsis` with `overflow-x:hidden|clip`).
 *
 * In other words: real words are spilling past the container AND nobody
 * bothered to truncate them, anywhere along the chain. This is the bug
 * the spec exists to catch.
 */
export function findOverflowViolations(
  rows: AuditRow[],
): OverflowViolation[] {
  const out: OverflowViolation[] = [];
  for (const row of rows) {
    if (!row.visible) continue;
    if (!row.overflowX) continue;
    if (row.hasDefense) continue;
    out.push({
      row,
      reason: `${row.tag}${row.role ? `[role=${row.role}]` : ""}${
        row.testId ? `[testid=${row.testId}]` : ""
      } "${
        row.text
      }" overflows (scrollW=${row.scrollW} > clientW=${row.clientW})`,
    });
  }
  return out;
}

/**
 * Informational only. Group by defense source so the console output
 * clusters "ten buttons cargo-culted truncate" instead of listing them
 * individually.
 */
export function countDeadTruncationsBySource(
  rows: AuditRow[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (!r.visible) continue;
    if (!r.hasDefense) continue;
    if (!r.hasOwnTruncationClass && r.defenseSource !== "own-class" && r.defenseSource !== "ancestor-class") {
      // Defense that came from computed style only is harder to call
      // "dead" — could be inherited CSS. Skip from this counter.
      continue;
    }
    if (r.overflowX || r.overflowY) continue; // currently truncating → alive
    const key = `${r.defenseSource}@${
      r.defenseSource === "own-class" ? "self" : `depth${r.defenseDepth}`
    }`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Sort violations by the magnitude of the overflow delta (worst first). */
export function topOverflowOffsets(
  rows: AuditRow[],
  limit = 5,
): OverflowViolation[] {
  const vs = findOverflowViolations(rows);
  vs.sort(
    (a, b) =>
      b.row.scrollW -
      b.row.clientW -
      (a.row.scrollW - a.row.clientW),
  );
  return vs.slice(0, limit);
}

/**
 * Pretty per-locale / per-view report. Console output only; never used
 * for assertions. Sized to stay compact in CI logs (dead-truncations are
 * summarized by defense-source key, not listed individually).
 */
export function formatReport(
  locale: LocaleCode,
  view: ViewId,
  rows: AuditRow[],
): string {
  const violations = findOverflowViolations(rows);
  const dead = countDeadTruncationsBySource(rows);
  const lines: string[] = [];
  lines.push(
    `[text-fit] ${locale.toUpperCase()} · ${view} · ` +
      `${rows.length} elements · ` +
      `${violations.length} overflow violations · ` +
      `${Object.values(dead).reduce((a, b) => a + b, 0)} dead-truncations ` +
      `(${Object.entries(dead).map(([k, v]) => `${k}=${v}`).join(", ") || "none"})`,
  );
  if (violations.length > 0) {
    lines.push(`  ✗ overflow without defense:`);
    for (const v of violations) {
      lines.push(
        `    - ${v.row.tag}` +
          (v.row.role ? `[role=${v.row.role}]` : "") +
          (v.row.testId ? `[testid=${v.row.testId}]` : "") +
          ` "${v.row.text}" (+${v.row.scrollW - v.row.clientW}px)`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Stabilize the page before a `toHaveScreenshot` baseline comparison.
 *
 * Playwright's `animations: "disabled"` (the `toHaveScreenshot` default)
 * freezes CSS/WAAPI animations at capture time, but three sources of
 * nondeterminism are NOT covered and show up as flaky pixel diffs under
 * parallel load (the observed hi/hr/pt/ro nightly failures):
 *
 *   1. The self-hosted Inter variable font loads over HTTP after first
 *      paint — until `document.fonts.ready` resolves, Latin text renders
 *      in the system fallback whose metrics differ from Inter, so the
 *      same view can diff against its baseline purely on font-load
 *      timing. Fonts are not affected by `animations: "disabled"`.
 *   2. Finite entrance animations (Mantine modal enter, dashboard card
 *      motion, the fixed sync-status pill's entrance) are caught by
 *      waiting for `document.getAnimations()` to finish. Infinite
 *      pulse/rotate animations are filtered out — they never finish,
 *      and `animations: "disabled"` freezes them deterministically at
 *      capture time.
 *   3. Async sections render a spinner while loading (e.g.
 *      ModelManagerSection queries Cache Storage on mount). The
 *      spinner's PRESENCE is a content difference, not an animation, so
 *      `animations: "disabled"` cannot help — wait (bounded, non-fatal)
 *      until no `.animate-spin` element remains.
 *
 * The waits are bounded (1.5s animation race, 8s spinner bound) so a
 * genuinely stuck animation degrades to the current behavior instead of
 * hanging the suite.
 */
export async function stabilizeRender(
  page: Page,
  opts: { settleMs?: number; waitSpinners?: boolean } = {},
): Promise<void> {
  const settleMs = opts.settleMs ?? 250;

  // 1. Fonts fully loaded — Latin metrics must match the baseline.
  await page.evaluate(() => document.fonts.ready.then(() => true));

  // 2. Wait for finite animations to finish (bounded race for stragglers
  //    and infinite animations, which are excluded from the wait list).
  await page.evaluate(() => {
    const running = document.getAnimations().filter((a) => {
      const t = (a.effect as KeyframeEffect | null)?.getTiming?.();
      return (
        a.playState === "running" &&
        t !== undefined &&
        t !== null &&
        t.iterations !== Infinity &&
        (typeof t.duration === "number" ? t.duration : 0) > 0
      );
    });
    return Promise.race([
      Promise.all(running.map((a) => a.finished.catch(() => undefined))),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]).then(() => true);
  });

  // 3. Async spinner-gated content settled (settings panel only — the
  //    only view with a known mount-time async section).
  if (opts.waitSpinners) {
    await page
      .waitForFunction(
        () => document.querySelectorAll(".animate-spin").length === 0,
        undefined,
        { timeout: 8000 },
      )
      .catch(() => {
        /* Non-fatal: proceed and let `animations: "disabled"` freeze any
           leftover spinner at capture time. */
      });
  }

  // 4. Small settle so React re-renders triggered by the waits above are
  //    flushed before the capture.
  await page.waitForTimeout(settleMs);
}

/**
 * A per-view audit snapshot, accumulated across a locale test so the
 * final assertion sees the WHOLE diagnostic surface at once.
 */
export interface ViewAudit {
  view: ViewId;
  rows: AuditRow[];
}

/**
 * Audit ONE view WITHOUT asserting. Logs the per-view console report
 * (violations + dead-truncations breakdown) and returns the rows so the
 * caller can accumulate across views and assert ONCE at the end with
 * `assertAggregatedOverflow`.
 *
 * Deliberately does NOT short-circuit on the first bad view — a locale
 * with a broken view reports its full diagnostic surface instead of
 * dying at view #1. That trade-off (diagnosis-completeness over
 * fail-fast) is the contract the cross-locale specs chose.
 */
export async function auditViewRows(
  page: Page,
  locale: LocaleCode,
  view: ViewId,
): Promise<AuditRow[]> {
  const rows = await auditTextOverflow(page);
  console.log(formatReport(locale, view, rows));
  if (rows.some((r) => r.overflowY && !r.hasDefense)) {
    const vc = rows.filter((r) => r.overflowY && !r.hasDefense).slice(0, 3);
    console.log(
      `[text-fit] ${locale}/${view} vertical overflow w/o defense (informational): ` +
        vc.map((r) => `${r.tag}("${r.text}")`).join(", "),
    );
  }
  return rows;
}

/**
 * The final per-test assertion: every overflow violation across ALL
 * audited views of this locale, in ONE expect block, including the full
 * pixel offset of each violation (`+offset px (scrollW=… > clientW=…)`).
 *
 * The spec no longer fails on the first bad view — a broken locale
 * reports its complete diagnostic surface at once, which is the
 * trade-off this suite chose over fail-fast.
 */
export function assertAggregatedOverflow(
  locale: LocaleCode,
  audits: ReadonlyArray<ViewAudit>,
): void {
  const violations: Array<{ view: ViewId; violation: OverflowViolation }> =
    [];
  for (const { view, rows } of audits) {
    for (const v of findOverflowViolations(rows)) {
      violations.push({ view, violation: v });
    }
  }
  const detail = violations
    .map(({ view, violation }) => {
      const { row } = violation;
      const offset = row.scrollW - row.clientW;
      return (
        `  [${view}] <${row.tag}>` +
        (row.role ? `[role=${row.role}]` : "") +
        (row.testId ? `[testid=${row.testId}]` : "") +
        ` "${row.text}" +${offset}px ` +
        `(scrollW=${row.scrollW} > clientW=${row.clientW})`
      );
    })
    .join("\n");
  expect(
    violations,
    `[text-fit] ${locale.toUpperCase()}: ${violations.length} overflow ` +
      `violation(s) across ${audits.length} view(s).\n${detail || "  <none>"}`,
  ).toEqual([]);
}

/**
 * Single-view fail-fast convenience (audit + assert one view). Kept for
 * specs that don't aggregate; the cross-locale specs use
 * `auditViewRows` + `assertAggregatedOverflow` instead.
 */
export async function assertNoOverflow(
  page: Page,
  locale: LocaleCode,
  view: ViewId,
): Promise<void> {
  const rows = await auditViewRows(page, locale, view);
  assertAggregatedOverflow(locale, [{ view, rows }]);
}
