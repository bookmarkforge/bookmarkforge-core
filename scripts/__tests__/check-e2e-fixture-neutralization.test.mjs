/**
 * scripts/__tests__/check-e2e-fixture-neutralization.test.mjs
 *
 * Vitest unit tests for `scripts/check-e2e-fixture-neutralization.mjs`.
 *
 * The gate exists to keep the e2e fixtures from silently neutralizing the
 * surface a spec is about (the dashboard-banner-cls / ADR-055 class). These
 * tests pin the guarantees, one per rule:
 *
 *   (a) healthy tree → zero failures
 *   (b) rule A — a block that references the surface's own UI but whose
 *       preceding setup call is unguarded → failure naming the fix
 *   (c) rule A, POSITIONAL — a block whose reference is preceded by a GUARDED
 *       call passes even when an earlier call in the same block is unguarded
 *       (the launch-smoke shape: plain setup, then `dismissOnboarding: false`
 *       for the wizard phase). A per-block rule false-positives here, which is
 *       exactly why position is part of the rule.
 *   (d) rule B — reviving the surface's own key (`removeItem`) with an
 *       unguarded setup call → failure
 *   (e) rule B, DIRECTION — seeding a key to "true" (suppression) AGREES with
 *       the fixture and must not fire; only revival is a conflict
 *   (f) rule C — a test title claiming the surface is enough on its own
 *   (g) the waiver is the only escape hatch, and it must carry a reason
 *   (h) a waiver nobody needs is a WARNING, never a silent permanent pass
 *   (i) R3 — a new dismissal control (or storage key) in the helper with no
 *       catalog entry fails, so the neutralized set cannot grow behind the specs
 *   (j) R4 — a catalog key the app's STORAGE_KEYS does not define fails
 *   (k) missing helper/storage-keys files fail loudly instead of passing
 *   (l) `skipPassword` neutralizes the tour with no opt-out → a tour spec is
 *       caught (option-less surfaces are still guarded)
 *
 * Each test builds a fresh `mkdtempSync()` tree containing only the files the
 * gate reads; the real repo is never modified.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_SURFACES,
  collectHelperNeutralizations,
  evaluateCatalogAgainstApp,
  evaluateManifestCoverage,
  evaluateNeutralizationContract,
  evaluateSourceContract,
  loadAppStorageKeys,
  parseWaiver,
  surfaceReviveReferences,
  surfaceUiReferences,
} from "../check-e2e-fixture-neutralization.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "check-e2e-fixture-neutralization.mjs");

const STORAGE_KEYS_SOURCE = `export const STORAGE_KEYS = {
  ONBOARDING_COMPLETE: "forge_onboarding_complete",
  WELCOME_TOUR_COMPLETE: "forge_welcome_tour_complete",
  DISMISSED_TIPS: "forge_dismissed_tips",
  BACKUP_BANNER_DISMISSED_UNTIL: "forge_backup_banner_dismissed_until",
  LAST_MANUAL_BACKUP_DATE: "forge_last_manual_backup_date",
};
`;

const KEYS = loadAppStorageKeys(STORAGE_KEYS_SOURCE).keys;

/**
 * Minimal stand-in for tests/e2e/vault-helpers.ts. It has to be a FAITHFUL
 * shape for the parser: the dismissal controls live inside dismissOverlays()'s
 * body, which ends at a column-0 brace, and skipPassword seeds a surface key
 * far from any click.
 */
const HELPER_SOURCE = `import { expect } from "@playwright/test";

export async function dismissOverlays(page, options = {}) {
  const onboarding = page.locator('[aria-labelledby="onboarding-dialog-title"]');
  const skipTour = page.getByRole("button", { name: /skip tour/i });
  const backupDismiss = page.getByRole("button", {
    name: "Got it, remind me later",
  });
  const tipDismiss = page.getByRole("button", { name: "Dismiss tip" });
  const skipOnboarding = page.getByRole("button", { name: "Skip onboarding" });
  void skipOnboarding;
  void onboarding;
  void skipTour;
  void backupDismiss;
  void tipDismiss;
  void options;
}

export async function setupVault(page, options = {}) {
  await dismissOverlays(page, { keepBackupNotice: options.keepBackupNotice });
}

export async function skipPassword(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("forge_welcome_tour_complete", "true");
  });
  await dismissOverlays(page);
}
`;

let root;

function seed({
  specs = {},
  helper = HELPER_SOURCE,
  storageKeys = STORAGE_KEYS_SOURCE,
} = {}) {
  mkdirSync(join(root, "tests", "e2e"), { recursive: true });
  mkdirSync(join(root, "src", "constants"), { recursive: true });
  writeFileSync(join(root, "tests", "e2e", "vault-helpers.ts"), helper);
  writeFileSync(join(root, "src", "constants", "storage-keys.ts"), storageKeys);
  for (const [name, body] of Object.entries(specs)) {
    writeFileSync(join(root, "tests", "e2e", name), body);
  }
}

function runCli() {
  return spawnSync("node", [SCRIPT_PATH], {
    encoding: "utf8",
    env: { ...process.env, E2E_FIXTURE_ROOT: root },
  });
}

/** Run the contract over a one-off source, as the tree runner would. */
function contract(source, surfaces = FIXTURE_SURFACES) {
  return evaluateSourceContract(source, {
    file: "tests/e2e/x.spec.ts",
    storageKeys: KEYS,
    surfaces,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fixture-neutralization-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("helper parsing", () => {
  test("collects dismissal controls (string and regex forms) and surface keys", () => {
    const collected = collectHelperNeutralizations(HELPER_SOURCE);
    expect(collected.dismissalRegionFound).toBe(true);
    expect([...collected.controls].map((c) => c.toLowerCase()).sort()).toEqual(
      ["dismiss tip", "got it, remind me later", "skip onboarding", "skip tour"],
    );
    expect([...collected.keyLiterals]).toContain("forge_welcome_tour_complete");
  });
});

describe("rule A — the block references the surface's own UI", () => {
  test("(b) unguarded setup + banner reference → failure naming the fix", () => {
    const source = `test("export backup from dashboard banner completes", async ({ page }) => {
  await setupVault(page);
  await page.getByRole("button", { name: "Export Physical Backup File" }).click();
});
`;
    const { failures } = contract(source);
    expect(failures.join("\n")).toContain("backup reminder banner");
    expect(failures.join("\n")).toContain("keepBackupNotice: true");
  });

  test("(c) POSITIONAL: a guarded call after an unguarded one satisfies the reference", () => {
    const source = `test("critical path: encrypted backup round-trip", async ({ page }) => {
  await setupVault(page, { password: LAUNCH_PASSWORD });
  await page.getByRole("button", { name: "Lock Vault" }).click();
  await setupVault(page, { dismissOnboarding: false, password: LAUNCH_PASSWORD });
  const dialog = page.locator('[aria-labelledby="onboarding-dialog-title"]');
  await expect(dialog).toBeVisible();
});
`;
    expect(contract(source).failures).toEqual([]);
  });

  test("(c2) the same reference with NO guarded call does fail (the rule is not dead)", () => {
    const source = `test("critical path: encrypted backup round-trip", async ({ page }) => {
  await setupVault(page, { password: LAUNCH_PASSWORD });
  const dialog = page.locator('[aria-labelledby="onboarding-dialog-title"]');
  await expect(dialog).toBeVisible();
});
`;
    expect(contract(source).failures.join("\n")).toContain("onboarding wizard");
  });

  test("(l) skipPassword neutralizes the tour with no opt-out → tour spec is caught", () => {
    const source = `test("welcome tour appears on first unlock", async ({ page }) => {
  await skipPassword(page);
  await page.getByRole("button", { name: "Skip tour" }).click();
});
`;
    const { failures } = contract(source);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toContain("WelcomeTour guided tour");
  });
});

describe("rule B — reviving the surface's state", () => {
  test("(d) removeItem on the snooze key + unguarded setup → failure", () => {
    const source = `test("banner shows after a pristine unlock", async ({ page }) => {
  await setupVault(page);
  await page.evaluate(() => localStorage.removeItem("forge_backup_banner_dismissed_until"));
});
`;
    const { failures } = contract(source);
    expect(failures.join("\n")).toContain("revives its storage state");
    expect(failures.join("\n")).toContain("forge_backup_banner_dismissed_until");
  });

  test("(d2) removing the banner's CONDITION key counts too", () => {
    const source = `test("banner shows after a pristine unlock", async ({ page }) => {
  await setupVault(page);
  await page.evaluate(() => localStorage.removeItem("forge_last_manual_backup_date"));
});
`;
    expect(contract(source).failures.join("\n")).toContain("forge_last_manual_backup_date");
  });

  test("(e) DIRECTION: suppression agrees with the fixture, revival does not", () => {
    const tour = FIXTURE_SURFACES.find((s) => s.id === "welcomeTour");
    expect(
      surfaceReviveReferences(
        'window.localStorage.setItem("forge_welcome_tour_complete", "true");',
        tour,
        KEYS,
      ),
    ).toEqual([]);
    expect(
      surfaceReviveReferences(
        'window.localStorage.setItem("forge_welcome_tour_complete", "false");',
        tour,
        KEYS,
      ),
    ).toHaveLength(1);
    expect(
      surfaceReviveReferences(
        'window.localStorage.removeItem("forge_welcome_tour_complete");',
        tour,
        KEYS,
      ),
    ).toHaveLength(1);

    const source = `test("visual snapshots stay deterministic", async ({ page }) => {
  await skipPassword(page);
  await page.evaluate(() => {
    window.localStorage.setItem("forge_welcome_tour_complete", "true");
    window.localStorage.setItem("forge_dismissed_tips", JSON.stringify(["tip"]));
  });
});
`;
    expect(contract(source).failures).toEqual([]);
  });
});

describe("rule C — the test title claims the surface", () => {
  test("(f) a title alone triggers the requirement", () => {
    const source = `test("backup reminder banner shows after unlock", async ({ page }) => {
  await dismissOverlays(page);
  await expect(page.getByTestId("settings-button")).toBeVisible();
});
`;
    expect(contract(source).failures.join("\n")).toContain("its title claims it");
  });

  test("UI references are reported with their evidence", () => {
    const banner = FIXTURE_SURFACES.find((s) => s.id === "backupNotice");
    expect(
      surfaceUiReferences(
        'page.getByRole("button", { name: "Export Physical Backup File" })',
        banner,
      ),
    ).toHaveLength(1);
    expect(
      surfaceUiReferences('page.getByRole("button", { name: "Unrelated" })', banner),
    ).toEqual([]);
  });
});

describe("the waiver", () => {
  const BODY = `  await setupVault(page);
  await page.getByRole("button", { name: "Export Physical Backup File" }).click();`;

  test("(g) a reasoned waiver passes; an unreasoned one fails", () => {
    const unreasoned = contract(
      `test("banner", async ({ page }) => {\n${BODY}\n});\n// fixture-neutralization-waiver: backupNotice\n`,
    );
    expect(unreasoned.failures.join("\n")).toContain("has no reason");

    const reasoned = contract(
      `test("banner", async ({ page }) => {\n${BODY}\n});\n// fixture-neutralization-waiver: backupNotice — the spec re-seeds the banner itself below this point\n`,
    );
    expect(reasoned.failures).toEqual([]);
    expect(reasoned.waived).toHaveLength(1);
  });

  test("(h) a waiver that silences nothing is a warning, not a failure", () => {
    const result = contract(
      `test("unrelated", async ({ page }) => {\n  await setupVault(page);\n});\n// fixture-neutralization-waiver: quickTips — we thought we needed this\n`,
    );
    expect(result.failures).toEqual([]);
    expect(result.warnings.join("\n")).toContain("no violation was detected");
  });

  test("parseWaiver tolerates both dash forms and multi-surface lists", () => {
    expect(
      parseWaiver(
        "// fixture-neutralization-waiver: welcomeTour, quickTips - both are suppressed on purpose here",
      ),
    ).toEqual({
      surfaces: ["welcomeTour", "quickTips"],
      reason: "both are suppressed on purpose here",
    });
    expect(parseWaiver("// nothing here")).toBe(null);
  });
});

describe("catalog integrity", () => {
  test("(i) R3: a new dismissal control with no catalog entry fails", () => {
    const helper = HELPER_SOURCE.replace(
      '  const tipDismiss = page.getByRole("button", { name: "Dismiss tip" });',
      '  const tipDismiss = page.getByRole("button", { name: "Dismiss tip" });\n  const billing = page.getByRole("button", { name: "Dismiss billing notice" });\n  void billing;',
    );
    const failures = evaluateManifestCoverage(
      collectHelperNeutralizations(helper),
      FIXTURE_SURFACES,
      KEYS,
    );
    expect(failures.join("\n")).toContain("Dismiss billing notice");
    expect(failures.join("\n")).toContain("FIXTURE_SURFACES");
  });

  test("(i2) R3: an unregistered storage key the helper writes fails", () => {
    const helper = `${HELPER_SOURCE}\n// neutralizes the eviction notice too\nexport function seed(page) {\n  return page.evaluate(() => localStorage.setItem("forge_eviction_banner_dismissed", "true"));\n}\n`;
    const failures = evaluateManifestCoverage(
      collectHelperNeutralizations(helper),
      FIXTURE_SURFACES,
      KEYS,
    );
    expect(failures.join("\n")).toContain("forge_eviction_banner_dismissed");
  });

  test("(i3) R3: a helper whose dismissOverlays moved fails loudly", () => {
    const helper = HELPER_SOURCE.replace(
      "export async function dismissOverlays(",
      "export async function someOtherName(",
    );
    const failures = evaluateManifestCoverage(
      collectHelperNeutralizations(helper),
      FIXTURE_SURFACES,
      KEYS,
    );
    expect(failures.join("\n")).toContain("refusing to pass");
  });

  test("(j) R4: a catalog symbol the app does not define fails", () => {
    const failures = evaluateCatalogAgainstApp(
      [
        {
          id: "ghost",
          storageKeySymbols: ["NOT_A_REAL_KEY"],
          relatedKeySymbols: [],
          dynamicKeyPrefixes: [],
          controls: [],
          domMarkers: [],
        },
      ],
      KEYS,
    );
    expect(failures.join("\n")).toContain("NOT_A_REAL_KEY");
  });

  test("(j2) the shipped catalog resolves against the real app storage keys", () => {
    const real = loadAppStorageKeys(
      readFileSync(join(REPO_ROOT, "src", "constants", "storage-keys.ts"), "utf8"),
    );
    expect(real.errors).toEqual([]);
    expect(evaluateCatalogAgainstApp(FIXTURE_SURFACES, real.keys)).toEqual([]);
  });
});

describe("CLI contract", () => {
  test("(a) a healthy tree exits 0", () => {
    seed({
      specs: {
        "clean.spec.ts": `test("plain unlock", async ({ page }) => {\n  await setupVault(page);\n  await expect(page.getByTestId("settings-button")).toBeVisible();\n});\n`,
      },
    });
    const result = runCli();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No undeclared fixture neutralizations");
    expect(result.stdout).toContain("registered surfaces");
  });

  test("(k) a broken tree exits 1 with the fix, and a missing helper exits 1 too", () => {
    seed({
      specs: {
        "bad.spec.ts": `test("export backup from dashboard banner completes", async ({ page }) => {\n  await setupVault(page);\n  await page.getByRole("button", { name: "Export Physical Backup File" }).click();\n});\n`,
      },
    });
    const bad = runCli();
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("keepBackupNotice: true");

    rmSync(join(root, "tests", "e2e", "vault-helpers.ts"));
    const missing = runCli();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("missing vault helpers");
  });

  test("the real repo tree passes", () => {
    const result = evaluateNeutralizationContract(REPO_ROOT);
    expect(result.failures).toEqual([]);
  });
});
