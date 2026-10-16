/**
 * scripts/__tests__/check-workflow-vars-documented.test.mjs
 *
 * Unit tests for the workflow vars/secrets documentation coverage gate
 * (scripts/check-workflow-vars-documented.mjs): reference extraction, the
 * built-in secret exemption and the end-to-end fixture check.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractReferences, findUndocumented, main } from "../check-workflow-vars-documented.mjs";

describe("extractReferences", () => {
  it("collects vars and secrets with their prefixes", () => {
    const yml = `
      env:
        A: \${{ vars.NIGHTLY_HUMAN_LIKE_MAX_MINUTES }}
        B: \${{ secrets.NIGHTLY_ALERT_WEBHOOK_URL || 'x' }}
        C: \${{ vars.TRENDS_MIN_CONSECUTIVE_DEGRADED }}
    `;
    expect(extractReferences(yml)).toEqual([
      "secrets.NIGHTLY_ALERT_WEBHOOK_URL",
      "vars.NIGHTLY_HUMAN_LIKE_MAX_MINUTES",
      "vars.TRENDS_MIN_CONSECUTIVE_DEGRADED",
    ]);
  });

  it("deduplicates repeated references and ignores non-workflow text", () => {
    expect(extractReferences("a ${{ vars.X }} b ${{ vars.X }} c ${{ secrets.Y }}")).toEqual(["secrets.Y", "vars.X"]);
    expect(extractReferences("no refs here")).toEqual([]);
    expect(extractReferences("")).toEqual([]);
  });
});

describe("findUndocumented", () => {
  it("returns refs absent from the documentation blob", () => {
    const refs = ["vars.KNOWN", "secrets.UNKNOWN", "vars.ALSO_MISSING"];
    expect(findUndocumented(refs, "docs mention KNOWN somewhere")).toEqual(["secrets.UNKNOWN", "vars.ALSO_MISSING"]);
  });

  it("exempts the built-in GITHUB_TOKEN secret", () => {
    expect(findUndocumented(["secrets.GITHUB_TOKEN", "secrets.REAL_SECRET"], "nothing here")).toEqual(["secrets.REAL_SECRET"]);
  });
});

describe("main", () => {
  const scaffold = () => {
    const root = mkdtempSync(join(tmpdir(), "workflow-vars-check-"));
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    return root;
  };

  it("fails listing the undocumented refs and their workflows", async () => {
    const root = scaffold();
    const lines = [];
    const out = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
    try {
      writeFileSync(join(root, ".github", "workflows", "nightly.yml"), "A: ${{ vars.DOCUMENTED_VAR }} B: ${{ secrets.UNDOCUMENTED_SECRET }}\n");
      writeFileSync(join(root, ".env.example"), "DOCUMENTED_VAR=1\n");
      writeFileSync(join(root, "docs", "ops.md"), "nightly docs\n");
      const code = await main({ root, out });
      expect(code).toBe(1);
      expect(lines.join("\n")).toContain("secrets.UNDOCUMENTED_SECRET");
      expect(lines.join("\n")).toContain("nightly.yml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when every ref is documented (GITHUB_TOKEN exempt)", async () => {
    const root = scaffold();
    const lines = [];
    const out = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
    try {
      writeFileSync(join(root, ".github", "workflows", "ci.yml"), "A: ${{ vars.DOCUMENTED_VAR }} B: ${{ secrets.GITHUB_TOKEN }}\n");
      writeFileSync(join(root, ".env.example"), "DOCUMENTED_VAR=1\n");
      const code = await main({ root, out });
      expect(code).toBe(0);
      expect(lines.join("\n")).toContain("all documented");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
