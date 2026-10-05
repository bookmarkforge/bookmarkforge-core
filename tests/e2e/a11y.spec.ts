/**
 * tests/e2e/a11y.spec.ts — automated WCAG AA regression gate (audit 2026-08-13,
 * "mejora de alto impacto" #3: a11y automatizada en CI).
 *
 * Runs axe-core over the critical user flows in a real Chromium:
 *   1. the pre-unlock SecurityConfirmation screen (first paint, before the
 *      UI-runtime vendor chunk loads);
 *   2. the unlocked main app shell (header + dashboard);
 *   3. the Settings dialog (security-critical form controls).
 *
 * The gate fails on any `serious`/`critical` violation in a critical flow.
 * Full violation details (rule id, impact, help URL, affected selectors)
 * are printed so the CI log is the diagnosis, not just a red check.
 *
 * axe-core is injected from node_modules (`axe.source`), never from a CDN —
 * consistent with the human-like accessibility harness
 * (src/tests/human-like/core/accessibility-testing.ts) and with CSP
 * constraints. No new dependency.
 */
import { test, expect, type Page } from "@playwright/test";
import { skipPassword } from "./vault-helpers";

/** Serious/critical budget — WCAG AA must remain clean in critical flows. */
const MAX_SERIOUS_CRITICAL = 0;

interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  helpUrl: string;
  targets: string[];
}

/**
 * Inject axe-core and run a WCAG A/AA audit over the current document.
 * Returns only serious/critical violations (the gating set) after logging
 * the full picture.
 */
async function auditSerious(page: Page, label: string): Promise<AxeViolation[]> {
  const axe = (await import("axe-core")).default;
  await page.addScriptTag({ content: axe.source });

  // Freeze mount transitions and wait for fonts so axe measures a settled DOM.
  // The app's `motion.div` opacity/skeleton transitions paint backgrounds
  // conditionally; auditing mid-animation makes axe compute color-contrast
  // against a transparent/animated surface and report false positives.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      transition: none !important;
      animation: none !important;
      animation-duration: 0s !important;
      transition-duration: 0s !important;
      caret-color: transparent !important;
    }`,
  });
  await page.evaluate(() => (document as any).fonts?.ready?.catch(() => {}));

  const violations = await page.evaluate<AxeViolation[]>(async () => {
    const axe = (window as any).axe;
    if (!axe) {
      throw new Error("axe-core not injected");
    }
    const results = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    return results.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      helpUrl: v.helpUrl,
      targets: v.nodes.map((n: any) => String(n.target)),
    }));
  });

  const serious = violations.filter(
    (v: AxeViolation) =>
      v.impact === "serious" || v.impact === "critical",
  );
  console.log(
    `[a11y] ${label}: ${violations.length} violations total, ${serious.length} serious/critical`,
  );
  for (const v of serious) {
    console.log(
      `[a11y]   ${v.impact.toUpperCase()} ${v.id} — ${v.help} (${v.helpUrl}) ` +
        `targets=${JSON.stringify(v.targets.slice(0, 3))}`,
    );
  }
  return serious;
}

function assertWithinBudget(label: string, serious: AxeViolation[]): void {
  expect(
    serious.length,
    `${label}: ${serious.length} serious/critical WCAG violations (budget ${MAX_SERIOUS_CRITICAL}): ` +
      JSON.stringify(
        serious.map((v) => `${v.impact} ${v.id} @ ${v.targets.slice(0, 2)}`),
      ),
  ).toBeLessThanOrEqual(MAX_SERIOUS_CRITICAL);
}

test("a11y: pre-unlock SecurityConfirmation screen", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Secure your vault" }),
  ).toBeVisible({ timeout: 30_000 });
  const serious = await auditSerious(page, "locked-screen");
  assertWithinBudget("locked-screen", serious);
});

test("a11y: unlocked main app shell", async ({ page }) => {
  await skipPassword(page);
  const serious = await auditSerious(page, "main-shell");
  assertWithinBudget("main-shell", serious);
});

test("a11y: settings dialog", async ({ page }) => {
  await skipPassword(page);
  await page.getByTestId("settings-button").click();
  await expect(
    page.locator('[aria-labelledby="settings-dialog-title"]'),
  ).toBeVisible({ timeout: 30_000 });
  const serious = await auditSerious(page, "settings-dialog");
  assertWithinBudget("settings-dialog", serious);
});
