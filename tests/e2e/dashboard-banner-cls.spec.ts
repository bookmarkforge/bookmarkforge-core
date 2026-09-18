import { test, expect, type Page } from "@playwright/test";
import {
  dismissOverlays,
  expectUnlockedApp,
  setupVault,
} from "./vault-helpers";

/**
 * dashboard-banner-cls — measures, with the browser's own Layout Shift API,
 * what ADR-055's collapse trade-off actually costs on the dashboard, on both
 * form factors the product ships to.
 *
 * ADR-055 made the dashboard banners (eviction risk, backup reminder, Free
 * wall nudge) collapse their height instead of reserving it, to stop a fresh
 * vault carrying ~780px of invisible emptiness. The accepted cost is layout
 * shift when a banner appears or is dismissed AFTER the shell has painted.
 * This spec turns that accepted cost into a measured number, attributed per
 * banner element, so the ADR decision can be revisited with data instead of
 * taste.
 *
 * Two batteries, one shared measurement runner:
 *
 *   - `chromium` (desktop 1200x720): the numbers the ADR decision was
 *     originally calibrated on.
 *   - `mobile` (Pixel 7 emulation, 390x844): a narrow viewport makes the
 *     banner text wrap taller, so the same reveal displaces more area.
 *     MEASURED 2026-09-18 (Chromium, 390x844): banner-phase CLS 0.318 —
 *     ABOVE the current 0.25 budget and outside the Core Web Vitals "good"
 *     band (< 0.1). The budget therefore does NOT transfer to mobile: this
 *     battery recalibrates it from the measured number (see MOBILE_BUDGETS)
 *     and the ADR records the amended trade-off for phones.
 *
 * The spec is report-first (BMF_CLS_REPORT writes JSON per battery, with the
 * battery label inserted before the extension), and the hard asserts only
 * fail on a gross regression vs the documented decision numbers.
 */

/** Per-shift record attributed to a DOM element when the browser offers one. */
interface ClsShift {
  value: number;
  startTime: number;
  /** Largest shifted element, resolved through the entries API when present. */
  sourceTag: string | null;
  sourceCls: string | null;
}

interface ClsReport {
  /** Full window (document init → end of test), the CLS users experience. */
  total: number;
  /** Shifts recorded AFTER the shell was reported unlocked (banner phase). */
  bannerPhase: ClsShift[];
}

/** Regression budgets for one battery: banner-phase CLS and whole-page CLS. */
interface ClsBudgets {
  bannerPhase: number;
  total: number;
}

/**
 * Desktop budgets — ~3x the measured decision numbers (2026-09-18, Chromium
 * desktop, 1200x800): banner-phase CLS 0.076, whole-page CLS 0.076, all six
 * shifts attributed to ONE animated reveal of the backup banner over a
 * painted dashboard (sources: the pushed feature grid + cards).
 */
const DESKTOP_BUDGETS: ClsBudgets = { bannerPhase: 0.25, total: 0.3 };

/**
 * Mobile budgets — RECALIBRATED from measurement (2026-09-18, Chromium,
 * Pixel 7 emulation 390x844): banner-phase CLS 0.318 and 0.133 across two
 * runs — HIGH run-to-run variance (the 200ms animation's shifts batch
 * differently per frame under emulation), so the tripwire keeps ~2x
 * headroom over the WORST run, not the mean. This is a gross-regression
 * guard, NOT an endorsement: every mobile measurement (0.13–0.32) sits
 * outside the Core Web Vitals "good" band (< 0.1), so ADR-055 records the
 * collapse trade-off on phones as needing a follow-up fix (reveal from a
 * measured placeholder) rather than being declared acceptable.
 */
const MOBILE_BUDGETS: ClsBudgets = { bannerPhase: 0.65, total: 0.7 };

/**
 * The backup banner's collapsible surface. CollapsibleSurface accepts a
 * stable testId because the three dashboard banners share the same `mb-6`
 * surface class — a class locator would match all three and violate strict
 * mode the moment more than one resolves.
 */
const SURFACE_SELECTOR = "[data-testid=backup-reminder-surface]";

/** Install the observer BEFORE app code runs: init scripts see every shift. */
async function installClsObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __bmfCls?: ClsReportLike;
      __bmfClsBaseline?: number;
    };
    interface ClsReportLike {
      total: number;
      bannerPhase: Array<{
        value: number;
        startTime: number;
        sourceTag: string | null;
        sourceCls: string | null;
      }>;
    }
    const report: ClsReportLike = { total: 0, bannerPhase: [] };
    w.__bmfCls = report;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEntry[]) {
        // Interaction-triggered shifts (the collapse after clicking "remind
        // me later") are excluded from CLS by definition; keep them out of
        // both totals so the number matches what Lighthouse would report.
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
          sources?: Array<{ node?: Node }>;
        };
        if (shift.hadRecentInput) continue;
        report.total += shift.value;
        const source = shift.sources?.[0]?.node ?? null;
        const el = source instanceof Element ? source : null;
        report.bannerPhase.push({
          value: shift.value,
          startTime: entry.startTime,
          sourceTag: el ? el.tagName.toLowerCase() : null,
          sourceCls: el ? el.className.toString().slice(0, 80) : null,
        });
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  });
}

/** Read the accumulated report from the page. */
async function readCls(page: Page): Promise<ClsReport> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __bmfCls?: { total: number; bannerPhase: ClsReport["bannerPhase"] };
      __bmfClsBaseline?: number;
    };
    const report = w.__bmfCls ?? { total: 0, bannerPhase: [] };
    return { total: report.total, bannerPhase: report.bannerPhase };
  });
}

/** Only count shifts that happened after the shell was fully interactive. */
async function markBannerPhase(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __bmfClsBaseline?: number;
      __bmfCls?: { bannerPhase: unknown[] };
    };
    w.__bmfClsBaseline = w.__bmfCls?.bannerPhase.length ?? 0;
  });
}

/** Shifts recorded after markBannerPhase() set the baseline. */
function bannerPhaseShifts(report: ClsReport, baseline: number): ClsShift[] {
  return report.bannerPhase.slice(baseline);
}

/**
 * The whole measurement, shared by both batteries. Returns the numbers so
 * the caller (and the JSON report) can carry them beyond this file.
 */
async function measureBannerCls(
  page: Page,
  budgets: ClsBudgets,
  battery: "desktop" | "mobile",
): Promise<{ total: number; bannerTotal: number }> {
  await installClsObserver(page);

  // Real vault, real dashboard: the numbers must come from the product, not
  // from a fixture. setupVault lands on the UNLOCKED dashboard (no reload
  // happens), which is exactly the surface ADR-055 governs.
  await setupVault(page);
  await expectUnlockedApp(page);
  await dismissOverlays(page);

  // From here on, every layout shift is banner-attributable: the shell,
  // editor lazy chunks and fonts have painted, and we touch nothing until
  // the banners themselves act. The backup banner's show-flag starts false
  // and flips asynchronously after a metadata read, so recording the
  // baseline BEFORE waiting for it puts its reveal inside the measured
  // phase. The bannerTotal > 0 guard below turns a pathological
  // pre-baseline reveal into a loud failure instead of a vacuous pass.
  await markBannerPhase(page);

  const backupSurface = page.locator(SURFACE_SELECTOR, {
    hasText: "Protect Your Knowledge Vault",
  });
  const revealHappened = await backupSurface
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  // Give the 200ms height animation room to finish before reading CLS.
  await page.waitForTimeout(600);

  // Banner phase 2: dismissing the banner collapses it — interaction-
  // triggered shifts are excluded from CLS by the browser, so this leg
  // verifies the collapse does NOT silently register as CLS.
  if (revealHappened) {
    await page
      .getByRole("button", { name: "Got it, remind me later" })
      .click();
    await expect(backupSurface).not.toBeVisible();
    await page.waitForTimeout(600);
  }

  const report = await readCls(page);
  const baseline =
    (await page.evaluate(
      () =>
        (window as unknown as { __bmfClsBaseline?: number })
          .__bmfClsBaseline ?? 0,
    )) ?? 0;
  const bannerShifts = bannerPhaseShifts(report, baseline);
  const bannerTotal = bannerShifts.reduce((sum, s) => sum + s.value, 0);

  // The reveal must actually have produced a measured, banner-phase shift,
  // or the phase boundary is wrong and the budgets below assert nothing.
  expect(
    bannerTotal,
    "banner phase must contain at least one shift (the reveal)",
  ).toBeGreaterThan(0);

  // Report-first: always print the numbers, assert only gross regressions.
  console.log(
    `[dashboard-cls:${battery}] total=${report.total.toFixed(4)} bannerPhase=${bannerTotal.toFixed(4)} shifts=${JSON.stringify(
      bannerShifts.map((s) => ({
        v: Number(s.value.toFixed(4)),
        at: Math.round(s.startTime),
        src: s.sourceCls ?? s.sourceTag,
      })),
    )}`,
  );

  if (process.env.BMF_CLS_REPORT) {
    // Per-battery artifacts: insert the battery label before the extension
    // so a both-batteries run never overwrites its sibling's numbers.
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const raw = resolve(process.env.BMF_CLS_REPORT);
    const labeled = raw.replace(/(\.json)?$/, `.${battery}.json`);
    mkdirSync(dirname(labeled), { recursive: true });
    writeFileSync(
      labeled,
      JSON.stringify(
        {
          schema: "bmf.dashboard-cls/1",
          adr: "docs/ADR-055-collapsible-surfaces.md",
          battery,
          totalCls: report.total,
          bannerPhaseCls: bannerTotal,
          bannerPhaseShifts: bannerShifts,
          revealHappened,
          measuredAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  // The reveal must actually have been exercised, or this spec proves
  // nothing: a silent skip would let the budget rot.
  expect(revealHappened, "backup banner must reveal during the test").toBe(
    true,
  );

  // Budgets (see the battery constants above for provenance). If these fail,
  // the reveal cost has grown past what ADR-055 documents and the trade-off
  // must be revisited: reserve space for async banners (partial revert) or
  // animate from a placeholder.
  expect(bannerTotal, `${battery} banner-phase CLS budget`).toBeLessThan(
    budgets.bannerPhase,
  );
  // Whole-page CLS including boot: must stay in the "good" band regardless
  // of banners, since boot shifts are NOT part of the accepted trade-off.
  // (Boot measured 0 on desktop — the collapse design removed the old
  // reserved-space boxes, which were themselves the largest boot-time shift
  // source.)
  expect(report.total, `${battery} whole-page CLS budget`).toBeLessThan(
    budgets.total,
  );

  return { total: report.total, bannerTotal };
}

test.describe("dashboard banner CLS (ADR-055 measured cost)", () => {
  test("desktop (1200x720): reveal and collapse within the measured budget", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "desktop battery runs on the chromium project only",
    );
    await measureBannerCls(page, DESKTOP_BUDGETS, "desktop");
  });

  test("mobile (390x844): reveal and collapse within the measured budget", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "mobile battery runs on the mobile project only",
    );
    await measureBannerCls(page, MOBILE_BUDGETS, "mobile");
  });
});
