/**
 * scripts/__tests__/check-e2e-selectors.test.mjs
 *
 * Vitest unit tests for `scripts/check-e2e-selectors.mjs`. Covers the
 * guarantees the gate provides:
 *   (a) a healthy fixture tree (real selectors on both sides) → zero failures
 *   (b) a data-testid used in E2E but absent from production → failure
 *   (c) THE core case: a testid that exists ONLY in src/tests (a unit-test
 *       mock) must NOT satisfy the corpus — the production corpus excludes
 *       src/tests, otherwise the gate would pass on exactly the fabrication
 *       it exists to catch (the blocknote-view precedent).
 *   (d) a mock-only stub testid present in an E2E file → leak tripwire
 *   (e) a wrong value behind a dynamic-binding attribute → failure
 *   (f) a right value behind a dynamic-binding attribute → verified
 *   (g) an undocumented interpolated selector → failure naming
 *       MANUALLY_VERIFIED
 *   (h) aria-labelledby without a matching production id → failure
 *   (i) a healthy tree where the selector exists only under src/tests in the
 *       E2E file itself (self-contained E2E stub, the legitimate kind) →
 *       still passes the corpus check (the value is written inline in the
 *       spec, so production still carries the real one)
 *   (j) CLI: exit 0 on a healthy fixture root, exit 1 with FAIL lines on a
 *       broken one (via E2E_SELECTOR_AUDIT_ROOT — no chdir races)
 *
 * Every test builds a fresh `mkdtempSync()` fixture tree containing only the
 * files the gate needs; the real repo is never modified.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  collectUsedSelectors,
  loadProductionCorpus,
  evaluateSelectorContract,
  loadVocabularyFromSource,
} from "../check-e2e-selectors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "check-e2e-selectors.mjs");

let root;
const PROD_PAGE = `import React from "react";
export default function Page() {
  return (
    <div>
      <button data-testid="real-button">Go</button>
      <nav data-tab-id="dashboard">Dash</nav>
      <div id="dialog-title">Title</div>
    </div>
  );
}
`;

const NAVIGATION_CONSTANTS = `export const SIDEBAR_TAB_IDS = ["dashboard", "documents"] as const;
export const SUPPORT_CHAT_TAB_IDS = ["chat"] as const;
export const DATA_TAB_ID_VALUES = [...SIDEBAR_TAB_IDS, ...SUPPORT_CHAT_TAB_IDS];
export const BOTTOM_NAV_TAB_ID_VALUES = ["dashboard"];
export const DATA_TAB_ID_VALUES_CSV = "dashboard";
export const BOTTOM_NAV_TAB_ID_VALUES_CSV = "dashboard";
export const DATA_TAB_ID_VALUES_CSV = "dashboard";
export const BOTTOM_NAV_TAB_ID_VALUES_CSV = "dashboard";
`;
const LOCALE_CONSTANTS = `export const SUPPORTED_LANGUAGES = [{ code: "en", name: "English" }] as const;
export const SUPPORTED_LOCALE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);
export const SUPPORTED_LOCALE_CODES_CSV = "en";
`;

function seedTree({ e2e = [], prod = [], unitMocks = [], constants } = {}) {
  mkdirSync(join(root, "tests", "e2e"), { recursive: true });
  mkdirSync(join(root, "src", "components"), { recursive: true });
  mkdirSync(join(root, "src", "tests"), { recursive: true });
  for (const [name, body] of e2e) {
    writeFileSync(join(root, "tests", "e2e", name), body);
  }
  for (const [name, body] of prod) {
    writeFileSync(join(root, "src", "components", name), body);
  }
  for (const [name, body] of unitMocks) {
    writeFileSync(join(root, "src", "tests", name), body);
  }
  if (constants === undefined) {
    constants = [
      ["navigation.ts", NAVIGATION_CONSTANTS],
      ["locales.ts", LOCALE_CONSTANTS],
    ];
  }
  if (constants.length > 0) {
    mkdirSync(join(root, "src", "constants"), { recursive: true });
    for (const [name, body] of constants) {
      writeFileSync(join(root, "src", "constants", name), body);
    }
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "e2e-selector-audit-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("collectUsedSelectors", () => {
  test("extracts testids, data-attrs, and aria-labelledby from E2E files", () => {
    seedTree({
      e2e: [
        [
          "a.spec.ts",
          `import { test } from "@playwright/test";
test("t", async ({ page }) => {
  await page.getByTestId("real-button").click();
  await page.locator('[data-tab-id="dashboard"]').click();
  const dlg = page.locator('[aria-labelledby="dialog-title"]');
});
`,
        ],
      ],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { usedTestIds, usedDataAttrs, usedAriaLabelledby, files } =
      collectUsedSelectors(join(root, "tests", "e2e"));
    expect(files).toHaveLength(1);
    expect([...usedTestIds]).toEqual(["real-button"]);
    expect(usedDataAttrs.get("data-tab-id")).toEqual(new Set(["dashboard"]));
    expect([...usedAriaLabelledby]).toEqual(["dialog-title"]);
  });

  test("ignores snapshot directories", () => {
    seedTree({
      e2e: [
        ["a.spec.ts", `test("t", async ({ page }) => { await page.getByTestId("real-button"); });`],
      ],
      prod: [["Page.tsx", PROD_PAGE]],
    });
    mkdirSync(join(root, "tests", "e2e", "x.spec.ts-snapshots"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "tests", "e2e", "x.spec.ts-snapshots", "old.spec.ts"),
      `getByTestId("real-button"); data-testid="ghost"`,
    );

    const { usedTestIds } = collectUsedSelectors(join(root, "tests", "e2e"));
    expect([...usedTestIds]).toEqual(["real-button"]);
  });
});

describe("loadProductionCorpus", () => {
  test("includes production files but EXCLUDES src/tests mocks", () => {
    seedTree({
      prod: [["Page.tsx", PROD_PAGE]],
      unitMocks: [
        [
          "BlockEditor.test.tsx",
          `// mock-only stub the production never renders
const stub = <div data-testid="blocknote-view" />;`,
        ],
      ],
    });

    const corpus = loadProductionCorpus(join(root, "src"));
    expect(corpus).toContain('data-testid="real-button"');
    // src/tests/** is excluded from the corpus: the mock-only stub must NOT
    // count as production evidence, or the gate would pass on fabrications.
    expect(corpus).not.toContain('data-testid="blocknote-view"');
  });
});

describe("evaluateSelectorContract", () => {
  test("(a) healthy tree → zero failures", () => {
    seedTree({
      e2e: [
        [
          "a.spec.ts",
          `await page.getByTestId("real-button");
await page.locator('[data-tab-id="dashboard"]');
await page.locator('[aria-labelledby="dialog-title"]');`,
        ],
      ],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(failures).toEqual([]);
  });

  test("(b) testid used in E2E but absent from production → failure", () => {
    seedTree({
      e2e: [['a.spec.ts', `await page.getByTestId("ghost-button");`]],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(failures.some((f) => f.includes('testid "ghost-button"'))).toBe(
      true,
    );
  });

  test("(c) THE core case: testid existing only in src/tests does NOT satisfy the corpus", () => {
    seedTree({
      e2e: [['a.spec.ts', `await page.getByTestId("blocknote-view");`]],
      prod: [["Page.tsx", PROD_PAGE]],
      unitMocks: [
        [
          "BlockEditor.test.tsx",
          `const stub = <div data-testid="blocknote-view" />;`,
        ],
      ],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(failures.some((f) => f.includes('testid "blocknote-view"'))).toBe(
      true,
    );
  });

  test("(d) mock-only stub testid in an E2E file → leak tripwire fires", () => {
    seedTree({
      e2e: [['a.spec.ts', `await page.getByTestId("blocknote-view");`]],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(
      failures.some((f) =>
        f.includes('mock-only selector "blocknote-view" (unit-test stub) leaked'),
      ),
    ).toBe(true);
  });

  test("(e) wrong value behind a dynamic-binding attr → failure", () => {
    seedTree({
      e2e: [['a.spec.ts', `await page.locator('[data-tab-id="nonexistent-tab"]');`]],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(
      failures.some((f) => f.includes('data-tab-id="nonexistent-tab"')),
    ).toBe(true);
  });

  test("(f) dynamic-binding value present in the shared constants → verified EXACTLY", async () => {
    // Production must bind DYNAMICALLY (as the real Sidebar does with
    // data-tab-id={item.id}) — a literal attr in production would be caught
    // by tier 1 and never exercise the constants tier.
    seedTree({
      e2e: [['a.spec.ts', `await page.locator('[data-tab-id="dashboard"]');`]],
      prod: [
        [
          "Page.tsx",
          `const TABS = [{ id: "dashboard" }];
export default function Page() {
  return <nav>{TABS.map((t) => <button key={t.id} data-tab-id={t.id}>{t.id}</button>)}</nav>;
}`,
        ],
      ],
      constants: [
        [
          "navigation.ts",
          `export const SIDEBAR_TAB_IDS = ["dashboard", "documents"] as const;
export const SUPPORT_CHAT_TAB_IDS = ["chat"] as const;
export const DATA_TAB_ID_VALUES = [...SIDEBAR_TAB_IDS, ...SUPPORT_CHAT_TAB_IDS];
export const BOTTOM_NAV_TAB_ID_VALUES = ["dashboard"];
export const DATA_TAB_ID_VALUES_CSV = "dashboard";
export const BOTTOM_NAV_TAB_ID_VALUES_CSV = "dashboard";
`,
        ],
      ],
    });

    const { vocabulary } = await loadVocabularyFromSource(root);
    const { verified, failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
      { vocabulary },
    );
    expect(failures).toEqual([]);
    expect(
      verified.some(
        (v) =>
          v.includes('data-tab-id="dashboard"') && v.includes("(exact:"),
      ),
    ).toBe(true);
  });

  test("(f2) dynamic-binding value NOT in the shared constants → exact failure", async () => {
    seedTree({
      e2e: [
        ['a.spec.ts', `await page.locator('[data-tab-id="ghost-tab"]');`],
      ],
      prod: [["Page.tsx", PROD_PAGE]],
      constants: [
        [
          "navigation.ts",
          `export const SIDEBAR_TAB_IDS = ["dashboard"] as const;
export const SUPPORT_CHAT_TAB_IDS = ["chat"] as const;
export const DATA_TAB_ID_VALUES = [...SIDEBAR_TAB_IDS, ...SUPPORT_CHAT_TAB_IDS];
export const BOTTOM_NAV_TAB_ID_VALUES = ["dashboard"];
export const DATA_TAB_ID_VALUES_CSV = "dashboard";
export const BOTTOM_NAV_TAB_ID_VALUES_CSV = "dashboard";
`,
        ],
      ],
    });

    const { vocabulary } = await loadVocabularyFromSource(root);
    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
      { vocabulary },
    );
    expect(
      failures.some(
        (f) =>
          f.includes('data-tab-id="ghost-tab"') &&
          f.includes("shared constants"),
      ),
    ).toBe(true);
  });

  test("(f3) missing constants module → fallback scan reported as failure, never silent", async () => {
    seedTree({
      e2e: [
        ['a.spec.ts', `await page.locator('[data-tab-id="dashboard"]');`],
      ],
      prod: [[
        "Page.tsx",
        `const TABS = [{ id: "dashboard" }];
export default function Page() {
  return <nav>{TABS.map((t) => <button data-tab-id={t.id}>{t.id}</button>)}</nav>;
}`,
      ]],
      constants: [],
    });

    const { vocabulary, errors } = await loadVocabularyFromSource(root);
    expect(errors.length).toBeGreaterThan(0);

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
      { vocabulary },
    );
    // The value WOULD match by string scan (PROD_PAGE has it literally) but
    // the contract demands the failure say the exact tier is unavailable.
    expect(
      failures.some((f) => f.includes("fallback string scan")),
    ).toBe(true);
  });

  test("(f4) constants module missing an expected export → load error names the symbol", async () => {
    seedTree({
      constants: [
        ["navigation.ts", `export const SOMETHING_ELSE = ["x"];\n`],
      ],
      prod: [],
      e2e: [],
    });

    const { errors } = await loadVocabularyFromSource(root);
    expect(errors.some((e) => e.includes('"DATA_TAB_ID_VALUES_CSV"'))).toBe(true);
  });

  test("(g) undocumented interpolated selector → failure naming MANUALLY_VERIFIED", () => {
    seedTree({
      e2e: [
        [
          "a.spec.ts",
          "const code = 'en';\nawait page.locator(`[data-lang-code=\"${code}\"]`);",
        ],
      ],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(
      failures.some((f) => f.includes("MANUALLY_VERIFIED")),
    ).toBe(true);
  });

  test("(h) aria-labelledby without a production id → failure", () => {
    seedTree({
      e2e: [
        ['a.spec.ts', `await page.locator('[aria-labelledby="no-such-id"]');`],
      ],
      prod: [["Page.tsx", PROD_PAGE]],
    });

    const { failures } = evaluateSelectorContract(
      join(root, "tests", "e2e"),
      join(root, "src"),
    );
    expect(
      failures.some((f) => f.includes('aria-labelledby="no-such-id"')),
    ).toBe(true);
  });
});

describe("CLI contract", () => {
  test(
    "(j) exit 0 on healthy root, exit 1 with FAIL lines on a broken root",
    { timeout: 30_000 },
    () => {
      seedTree({
        e2e: [
          [
            "a.spec.ts",
            `await page.getByTestId("real-button");
await page.locator('[data-tab-id="dashboard"]');`,
          ],
        ],
        prod: [["Page.tsx", PROD_PAGE]],
        // The exact tier imports the shared constants; without them the
        // healthy run would exit 1 via the fallback-unavailable failure.
        constants: [
          [
            "navigation.ts",
            `export const SIDEBAR_TAB_IDS = ["dashboard"] as const;
export const SUPPORT_CHAT_TAB_IDS = ["chat"] as const;
export const DATA_TAB_ID_VALUES = [...SIDEBAR_TAB_IDS, ...SUPPORT_CHAT_TAB_IDS];
export const BOTTOM_NAV_TAB_ID_VALUES = ["dashboard"];
export const DATA_TAB_ID_VALUES_CSV = "dashboard";
export const BOTTOM_NAV_TAB_ID_VALUES_CSV = "dashboard";
`,
          ],
          ["locales.ts", LOCALE_CONSTANTS],
        ],
      });
      const ok = spawnSync("node", [SCRIPT_PATH], {
        encoding: "utf8",
        env: { ...process.env, E2E_SELECTOR_AUDIT_ROOT: root },
      });
      expect(ok.status).toBe(0);

      writeFileSync(
        join(root, "tests", "e2e", "bad.spec.ts"),
        `await page.getByTestId("ghost-button");`,
      );
      const bad = spawnSync("node", [SCRIPT_PATH], {
        encoding: "utf8",
        env: { ...process.env, E2E_SELECTOR_AUDIT_ROOT: root },
      });
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("FAIL");
      expect(bad.stderr).toContain("ghost-button");
    },
  );
});
