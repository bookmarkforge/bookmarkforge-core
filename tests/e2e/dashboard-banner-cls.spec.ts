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
 *     ABOVE the old 0.25 budget and outside the Core Web Vitals "good"
 *     band (< 0.1). The budget did NOT transfer to mobile, and the ADR
 *     recorded the collapse trade-off on phones as a debt.
 *
 * The spec is report-first (BMF_CLS_REPORT writes JSON per battery, with the
 * battery label inserted before the extension), and the hard asserts only
 * fail on a gross regression vs the documented decision numbers.
 *
 * UPDATE 2026-09-22 — the measured path is recorded now, not assumed, and the
 * old guard was measuring the wrong thing:
 *
 *   1. The shared setup path (`setupVault` → `dismissOverlays`) clicks the
 *      banner's own "Got it, remind me later", which writes the 48 h snooze
 *      (BACKUP_BANNER_DISMISSED_UNTIL) BEFORE the first assertion. The banner
 *      then stays hidden for the whole run and the measurement is vacuous:
 *      MEASURED 2026-09-22 with the snooze in place — `revealHappened` false on
 *      both batteries, i.e. the `bannerTotal > 0` guard was firing correctly on
 *      a fixture that had deleted its own subject.
 *   2. With the banner kept alive (the `keepBackupNotice` option threaded
 *      through setupVault/dismissOverlays), the SHIPPED path is held → shown:
 *      ADR-055's hold reserves the banner's height before this phase starts
 *      (MEASURED: 249px desktop / 531px mobile at baseline) and the reveal is a
 *      pure visibility flip — banner-phase CLS 0.0000 on both batteries. The
 *      reservation that does displace content is a boot-phase shift, inside
 *      `report.total`.
 *
 *   3. UPDATE 2026-09-22 (product fix): the measured-hold raced first paint
 *      on mobile. The hold painted with the 160px default estimate before the
 *      measurement landed, and the 160→531px correction then ANIMATED —
 *      probed live: surface absent → PRESENT computed=160 inline=531 →
 *      computed=312 → 516 → 531 (seven layout-shift frames, 0.152 total).
 *      The hold now uses the NATURAL height (`height: auto`, transitions
 *      off): the content is mounted under `visibility: hidden`, which does
 *      not affect layout, so the box is exactly as tall as its content from
 *      the first layout — no measurement to lose the race, no estimate to
 *      correct, nothing left to animate. Mobile measures 0.0000 with the
 *      hold at 531px; both budgets tighten to the CWV good band (< 0.1).
 *
 * So `bannerTotal > 0` is unsatisfiable on the shipped path: it could only
 * pass when the banner started COLLAPSED and shifted later (hidden → shown).
 * The numbers on file (0.076 desktop / 0.318 and 0.133 mobile) therefore
 * describe the collapsed → animated path. That is why the reveal precondition
 * replaced the guard, and why every report now carries `surfaceHeldAtBaseline`
 * + `bannerPath`: a zero must read as "held → shown, free", not as "nothing was
 * measured", and the two paths are never confused again.
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
 * Budgets — the Core Web Vitals "good" band (< 0.1) on BOTH batteries,
 * enabled by the natural-height hold (see UPDATE 2026-09-22 #3). These are
 * no longer gross-regression tripwires: they now ENFORCE the good band.
 *
 * Provenance of the headroom:
 *  - Desktop: the 0.068–0.085 decision numbers were the animated
 *    collapse-reveal path; the held path measures 0.0000 (ADR-055), so the
 *    0.1 cap covers font/async-content noise with ~2x margin over anything
 *    ever measured.
 *  - Mobile: the animated path measured 0.13–0.32 (2026-09-18) and 0.152
 *    (2026-09-22, probe-verified estimate-first hold animating 160→531px).
 *    With the natural-height hold the same run measures 0.0000 with the
 *    hold already in place at baseline — the geometry is final from the
 *    first layout, so nothing is left to vary run to run.
 *  - The whole-page budget is the same 0.1: boot shifts are NOT part of
 *    the accepted trade-off, and the hold reserves from the first layout
 *    instead of displacing content after paint.
 *
 * If these fail, the reveal path has regressed away from the hold (a
 * caller stopped passing `pending`, or a new async banner skips it): fix
 * the hold, do not raise the budget — ADR-055 documents the hold as the
 * mechanism that keeps mobile inside the good band.
 */
const DESKTOP_BUDGETS: ClsBudgets = { bannerPhase: 0.1, total: 0.1 };

/** Mobile: the same CWV good band — see DESKTOP_BUDGETS for provenance. */
const MOBILE_BUDGETS: ClsBudgets = { bannerPhase: 0.1, total: 0.1 };

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

/**
 * The measured surface's inline height, or null when it is not mounted.
 * Right after the baseline this says whether ADR-055's hold was already
 * reserving space — the fact that decides how `bannerTotal` must be read.
 */
async function readSurfaceHeight(page: Page): Promise<string | null> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    return el?.style.height ?? null;
  }, SURFACE_SELECTOR);
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
  // keepBackupNotice on BOTH calls: the generic helpers click "Got it, remind
  // me later", which writes the 48 h snooze (BACKUP_BANNER_DISMISSED_UNTIL).
  // setupVault dismisses overlays itself, so the flag has to be threaded
  // through it as well — otherwise the banner this spec measures is snoozed
  // before the first assertion and the measurement degrades into a vacuous
  // zero (which is exactly what the guard below caught).
  await setupVault(page, { keepBackupNotice: true });
  await expectUnlockedApp(page);
  await dismissOverlays(page, { keepBackupNotice: true });

  // From here on, every layout shift is banner-attributable: the shell,
  // editor lazy chunks and fonts have painted, and we touch nothing until
  // the banners themselves act. The backup banner's show-flag flips
  // asynchronously after a metadata read, so recording the baseline BEFORE
  // waiting for it puts its reveal inside the measured phase.
  await markBannerPhase(page);
  const surfaceHeldAtBaseline = await readSurfaceHeight(page);

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

  /** Which ADR-055 path this run measured (see the header update). */
  const bannerPath: "held" | "collapse-reveal" =
    Number.parseFloat(surfaceHeldAtBaseline ?? "0") > 0
      ? "held"
      : "collapse-reveal";

  // Precondition FIRST: if the subject never revealed, there is no measurement
  // and every number below is vacuous. Naming it here beats inferring it from a
  // zero total — this is the failure the old fixture produced by dismissing the
  // banner it was about to measure (see the keepBackupNotice call above).
  expect(revealHappened, "backup banner must reveal during the test").toBe(
    true,
  );

  // Deliberately NO `bannerTotal > 0` guard: a reveal is not required to move
  // anything. With the hold in place (`bannerPath === "held"`) the honest
  // number is 0 — the reveal is a visibility flip, and the reservation that
  // did displace content belongs to the boot phase, already inside
  // `report.total`. The budget asserts below are what must hold, and they are
  // also how a broken hold fails: height reserved AFTER the shell painted
  // lands in this phase and trips them instead of silently re-baselining.

  // Report-first: always print the numbers, assert only gross regressions.
  console.log(
    `[dashboard-cls:${battery}] path=${bannerPath} heldAtBaseline=${surfaceHeldAtBaseline ?? "none"} total=${report.total.toFixed(4)} bannerPhase=${bannerTotal.toFixed(4)} shifts=${JSON.stringify(
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
          // Which ADR-055 path produced the numbers: "held" means the reveal
          // was the designed free visibility flip (bannerPhaseCls ≈ 0), and
          // "collapse-reveal" means the banner genuinely appeared late
          // (hidden → shown) and paid the documented shift.
          bannerPath,
          surfaceHeldAtBaseline,
          measuredAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

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
