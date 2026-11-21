import { describe, expect, it } from "vitest";
import { evaluateFeatureBudgets, loadFeatureBudgets } from "../check-feature-budgets.mjs";

const config = {
  schema: "bmf.feature-budgets/1",
  unclassifiedThresholdBytes: 100,
  features: [
    { id: "editor", label: "Editor", patterns: ["^editor-"], budgetBytes: 500 },
    { id: "pdf", label: "PDF", patterns: ["^pdf-"], budgetBytes: 1_000 },
  ],
};

describe("check-feature-budgets", () => {
  it("passes classified assets within budgets", () => {
    const result = evaluateFeatureBudgets({
      config,
      assets: [
        { name: "editor-hash.js", bytes: 400 },
        { name: "pdf-hash.mjs", bytes: 900 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.unclassifiedLarge).toEqual([]);
  });

  it("fails when a feature exceeds its budget", () => {
    const result = evaluateFeatureBudgets({
      config,
      assets: [{ name: "editor-hash.js", bytes: 501 }, { name: "pdf-hash.mjs", bytes: 900 }],
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("editor");
  });

  it("fails when a newly large asset is not classified", () => {
    const result = evaluateFeatureBudgets({
      config,
      assets: [
        { name: "editor-hash.js", bytes: 400 },
        { name: "pdf-hash.mjs", bytes: 900 },
        { name: "new-vendor-hash.js", bytes: 101 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.unclassifiedLarge[0].name).toBe("new-vendor-hash.js");
  });

  it("loads the repository schema and feature definitions", () => {
    const loaded = loadFeatureBudgets();
    expect(loaded.schema).toBe("bmf.feature-budgets/1");
    expect(loaded.features.length).toBeGreaterThan(5);
  });
});
