/**
 * tests/e2e/text-fit-fuzz.spec.ts
 *
 * Property-based fuzz against pathological bookmark content. fast-check
 * drives title length (1-500 chars, the schema maxLength) and URL length
 * (200-2000 chars, the schema maxLength) over many iterations. For each
 * iteration we:
 *
 *   1. Clear the bookmarks collection (one row per iter, deterministic).
 *   2. Insert one bookmark with the fuzz-supplied title and URL.
 *   3. Wait for RxDB's live query to render the row.
 *   4. Call `assertTextFits(page, opts)` which asserts:
 *        - no visible element horizontally overflows its parent WITHOUT
 *          a defensive className, AND
 *        - `document.documentElement.scrollHeight` stays under an
 *          absolute ceiling.
 *   5. Compare the new height against the previous iteration's. If the
 *      delta exceeds `HEIGHT_JUMP_PCT`, the rule suite fails — a row's
 *      height is content-sensitive, which means truncation broke.
 *
 * Why height-comparison across iterations matters: any truncation that
 * is purely cosmetic (a className with `truncate` but no width
 * constraint, a `whitespace-nowrap` on a free-flow container) will only
 * manifest when the input gets long enough. fast-check explores edge
 * cases fast-check programmers wouldn't think to write by hand, so a
 * single hand-picked "long" input can pass while `numRuns: 30` will
 * surface the regression.
 *
 * Reuses `vault-helpers.skipPassword` / `dismissOverlays` / `expectUnlockedApp`
 * for the unlock flow and `text-fit-helpers.seedLocale` / `assertTextFits`
 * for layout assertions. `initDB()` is invoked inside the page's bundle
 * via `await import("/src/db/...")` — same pattern as `ai-guard-helpers.ts`.
 */
import { test, expect, type Page } from "@playwright/test";
import fc from "fast-check";
import { seedLocale, assertTextFits } from "./text-fit-helpers";
import {
  dismissOverlays,
  expectUnlockedApp,
  skipPassword,
} from "./vault-helpers";

/**
 * Threshold for the inter-iteration height delta. 20% absorbs:
 *   - first-paint font-load jitter (~5-10% on dev server),
 *   - sub-pixel rendering noise between React commits,
 * while still catching the canonical regression where a row's height
 * grows ~linearly with title length (a 500-char title failing to
 * truncate produces ~5-10x height, far above this threshold).
 */
const HEIGHT_JUMP_PCT = 20;

/**
 * Number of fast-check property evaluations. ~30 is enough for the
 * schema-maxLength dimensions to be exercised at multiple lengths AND
 * for fast-check to find mid-range edge cases (Unicode extremists,
 * URL-encoded nonsense, etc.) the codebase never typed by hand.
 */
const NUM_RUNS = 30;

/**
 * Absolute ceiling for `document.documentElement.scrollHeight`. A single
 * bookmark row should never exceed a few hundred pixels even with
 * pathological content — anything above 4000 px means one of the rows
 * has expanded into a wall of untruncated text.
 */
const ABSOLUTE_MAX_HEIGHT = 4000;

/**
 * Helper: extract the first `len` chars of `title` for use as a
 * deterministic sentinel in the DOM. Strings that start with non-text
 * characters (e.g. emoji) still produce a string-searchable prefix;
 * fast-check's `fc.string({ minLength: 1 })` always produces at least
 * one character.
 */
function titleSentinel(title: string, len = 8): string {
  return title.slice(0, Math.min(len, title.length));
}

/**
 * Title length arbiter: anywhere from 1 char to the schema's maxLength
 * (500). `fc.string()` is already well-distributed across ASCII and the
 * headline Unicode ranges, so 30 iterations give us reasonable edge-case
 * coverage without needing a custom arbitraries list.
 */
const titleArb = fc.string({ minLength: 1, maxLength: 500 });

/**
 * URL length arbiter. BookmarkForge's schema allows up to 2000 chars
 * but `fc.webUrl()` caps around ~256 — so we synthesize a URL-shaped
 * string with the full schema range via fc.string + a path suffix.
 * `replace(/[^a-zA-Z0-9_-]/g, "x")` keeps the string URL-safe so
 * BookmarkRow's URL parsing doesn't blow up and produce a different
 * failure mode (a parse error, not a layout overflow).
 */
const urlArb = fc
  .string({ minLength: 200, maxLength: 2000 })
  .map((s) => {
    const safe = s.replace(/[^a-zA-Z0-9_-]/g, "x").slice(0, 1990);
    return `https://e.example.com/${safe}`;
  });

/**
 * Inject (or replace) the bookmark collection contents so it has exactly
 * one row carrying the fuzz input. Implemented via RxDB's `initDB()` —
 * same access path the App uses, so encryption / schema validation
 * run as in normal use. Any RxDB error is surfaced as a Playwright
 * failure rather than swallowed, so a broken schema or a closed
 * collection surfaces immediately instead of producing a "height jump"
 * that masks the real cause.
 */
async function seedSingleBookmark(
  page: Page,
  doc: { title: string; url: string },
): Promise<void> {
  await page.evaluate(async (payload) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    // Bulk wipe via RxQuery.remove() — RxDB natively supports this and
    // HARD-deletes without toggling `isDeleted: true`, so the soft-delete
    // bookkeeping in production Hooks does not interfere with test
    // isolation between iterations.
    await db.bookmarks.find().remove();
    await db.bookmarks.insert({
      id: `fuzz-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      url: payload.url,
      urlHash: "",
      title: payload.title,
      tags: [],
      relatedLinks: [],
      processed: true,
      isPrivate: false,
      isDeleted: false,
      visitCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }, doc);
}

test.describe("text-fit fuzz: pathological bookmark titles + URLs", () => {
  test("row heights are bounded and no element overflows its parent", async ({
    page,
  }) => {
    // Single locale for deterministic rendering width. Cross-locale
    // coverage is owned by text-fit.spec.ts; this spec owns layout
    // boundedness under pathological INPUTS, not translations.
    await seedLocale(page, "en");
    await skipPassword(page);
    await dismissOverlays(page);
    await expectUnlockedApp(page);

    // Navigate once through the already-unlocked SPA. Live RxDB
    // subscriptions keep re-rendering the row on every DB mutation, so a
    // hard reload would unnecessarily return to the lock screen.
    await page.locator('[data-tab-id="bookmarks"]').click();
    await expect(page.locator('[aria-label="Bookmarks list"]')).toBeVisible({
      timeout: 30_000,
    });

    let prevHeight = 0;
    let iterIndex = 0;

    await fc.assert(
      fc.asyncProperty(
        fc.record({ title: titleArb, url: urlArb }),
        async ({ title, url }) => {
          iterIndex += 1;
          await seedSingleBookmark(page, { title, url });
          // Replace the canonical flake-antipattern `waitForTimeout(N)`
          // with a deterministic content-wait: Playwright polls for the
          // inserted title's prefix to appear in the bookmarks section.
          // Works on fast AND slow machines; no arbitrary ms budget.
          await expect(
            page.getByTestId("bookmarks-virtual-list"),
          ).toContainText(titleSentinel(title), { timeout: 5_000 });

          // 1. Per-iteration: no element overflows its parent WITHOUT
          //    a defensive className, and total height stays bounded.
          const result = await assertTextFits(page, {
            maxOverflowViolations: 0,
            maxHeight: ABSOLUTE_MAX_HEIGHT,
          });

          // 2. Across iterations: if a previous height was recorded,
          //    the delta must stay under HEIGHT_JUMP_PCT. Iter 0 is
          //    treated as a baseline and logged so a reader of the CI
          //    log sees where the deltas are anchored from.
          if (prevHeight > 0) {
            const deltaPct =
              Math.abs(result.bodyHeight - prevHeight) / prevHeight * 100;
            if (deltaPct > HEIGHT_JUMP_PCT) {
              throw new Error(
                `[text-fit-fuzz iter ${iterIndex}] body height jumped ` +
                  `${deltaPct.toFixed(1)}% (prev=${prevHeight}px, ` +
                  `current=${result.bodyHeight}px, title.length=${title.length}, ` +
                  `url.length=${url.length}). Bookmark row truncation is ` +
                  `sensitive to content length.`,
              );
            }
          } else {
            console.log(
              `[text-fit-fuzz iter ${iterIndex}] baseline height = ` +
                `${result.bodyHeight}px (title.length=${title.length}, ` +
                `url.length=${url.length}) — subsequent iters will diff against this.`,
            );
          }
          prevHeight = result.bodyHeight;
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
