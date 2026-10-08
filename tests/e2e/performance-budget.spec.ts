import { test, expect, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPORT_PATH = resolve(
  process.env.BMF_PERFORMANCE_REPORT ?? "performance-budget-report.json",
);
const SCHEMA = "bmf.performance-budget/1";
const runs = Number.parseInt(process.env.BMF_PERFORMANCE_RUNS ?? "3", 10);

/**
 * Regression threshold: 50 % of the hard gate (2 500 ms).
 * Failing here catches degradations months before they actually
 * break the CI gate — a 1 100 ms regression ships invisible for
 * 9 months if it has to grow all the way to 2 500 ms first.
 * Calibrated against the CI runner's own samples (556/1 034/1 080 ms
 * for one build): the median already sat at the old 40 % / 1 000 ms
 * floor, so that floor failed on runner variance alone.
 */
const WARN_BUDGET_MS = 1_250;

/**
 * Hard gate budget, matching scripts/performance-budget.json.
 * Exported so the spec can reference the same number the gate uses.
 */
const HARD_GATE_MS = 2_500;

if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
  throw new Error(`BMF_PERFORMANCE_RUNS must be 1..5 (got ${runs})`);
}

interface Measurement {
  firstInteractionMs: number;
  navigationStart: number;
  pointerDown: number;
  buildHash: string;
}

function writeReport(measurements: Measurement[]): void {
  const sorted = [...measurements].sort(
    (a, b) => a.firstInteractionMs - b.firstInteractionMs,
  );
  const selected = sorted.at(-1);
  if (!selected) throw new Error("no performance measurements were recorded");
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    `${JSON.stringify(
      {
        schema: SCHEMA,
        metric: "firstInteractionMs",
        firstInteractionMs: Math.round(selected.firstInteractionMs),
        statistic: "max",
        samples: sorted.map((sample) => Math.round(sample.firstInteractionMs)),
        navigationStart: selected.navigationStart,
        pointerDown: selected.pointerDown,
        buildHash: selected.buildHash,
        measuredAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function measureColdInteraction(browser: Browser, url: string, index: number): Promise<Measurement> {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem("forge_consent_decision_made", "true");
      window.localStorage.setItem("forge_consent_analytics", "true");
      window.localStorage.setItem("forge_consent_error_reporting", "true");
      window.localStorage.setItem("forge_consent_client_events", "true");
      window.localStorage.setItem("bmf_local_error_storage", "true");
      window.localStorage.setItem("forge_welcome_tour_complete", "true");

      // Capture the first real user pointerdown from document initialization.
      // This listener is intentionally installed before any app script runs;
      // attaching it after the screen paints would hide an early-load regression.
      document.addEventListener(
        "pointerdown",
        (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const button = target.closest('button[aria-label="Set up password"]');
          if (!button) return;
          const navigation = performance.getEntriesByType("navigation")[0];
          const navigationStart = navigation?.startTime ?? 0;
          const pointerDown = performance.now();          (window as unknown as { __bmfFirstInteraction?: Omit<Measurement, "buildHash"> })
            .__bmfFirstInteraction = {
            firstInteractionMs: pointerDown - navigationStart,
            navigationStart,
            pointerDown,
          };
        },
        { capture: true, once: true },
      );
    } catch {
      // The test asserts the screen and metric below, so storage failures do
      // not silently turn into a passing result.
    }
  });
  const page = await context.newPage();
  try {
    await page.goto(`${url}?performanceRun=${index}`, { waitUntil: "commit" });
    const action = page.getByRole("button", { name: "Set up password" });
    await expect(action).toBeVisible({ timeout: 30_000 });
    await action.click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { __bmfFirstInteraction?: Measurement })
              .__bmfFirstInteraction ?? null,
          ),
        { timeout: 5_000 },
      )
      .not.toBeNull();
    const measurement = await page.evaluate(
      () =>
        (window as unknown as { __bmfFirstInteraction?: Omit<Measurement, "buildHash"> })
          .__bmfFirstInteraction,
    );
    if (!measurement) throw new Error("first interaction metric was not captured");
    const buildHash = await page.evaluate(async () => {
      const response = await fetch("/integrity-manifest.json", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`integrity manifest request failed: ${response.status}`);
      }
      const body = (await response.json()) as { buildHash?: unknown };
      if (typeof body.buildHash !== "string" || body.buildHash.length === 0) {
        throw new Error("integrity manifest has no buildHash");
      }
      return body.buildHash;
    });
    return { ...measurement, buildHash };
  } finally {
    await context.close();
  }
}

test("@performance performance budget: first actionable interaction", async ({ browser, baseURL }) => {
  const measurements: Measurement[] = [];
  for (let index = 0; index < runs; index += 1) {
    measurements.push(await measureColdInteraction(browser, baseURL ?? "http://127.0.0.1:4173", index));
  }

  writeReport(measurements);
  const samples = measurements.map((measurement) => measurement.firstInteractionMs);
  const slowest = Math.max(...samples);
  if (!Number.isFinite(slowest)) throw new Error("no performance measurements were recorded");

  // ── Regression floor ────────────────────────────────────────────────
  // 50 % of the hard gate.  Fails the spec early so a slow crawl is
  // caught months before it would actually break the CI budget.
  expect(
    slowest,
    `
[performance-budget] SLOW DETECTION — first interaction ${Math.round(slowest)}ms exceeds the regression floor (50 % of budget = ${WARN_BUDGET_MS}ms).
This will eventually break the CI gate when it reaches the hard budget of ${HARD_GATE_MS}ms.

Run:
  node scripts/performance-budget.js --report performance-budget-report.json

for the full budget breakdown.
`.trim(),
  ).toBeLessThanOrEqual(WARN_BUDGET_MS);

  // ── Hard budget (also checked by check-performance-budget gate) ────
  expect(slowest).toBeLessThanOrEqual(HARD_GATE_MS);

  console.log(
    `[performance-budget] first interaction samples=${samples
      .map((sample) => Math.round(sample))
      .join(",")}ms max=${Math.round(slowest)}ms report=${REPORT_PATH}`,
  );
});
