// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evaluatePerformanceBudget,
  extractPrecacheUrls,
  extractStaticImports,
  PERFORMANCE_SCHEMA_LABEL,
} from "../check-performance-budget.mjs";

const budget = {
  entryStaticChainBytes: 1000,
  precacheBytes: 2000,
  firstInteractionMs: 2500,
};

describe("check-performance-budget", () => {
  it("extracts relative static JavaScript imports", () => {
    expect(
      extractStaticImports(
        'import "./one-a.js"; import("./lazy.js"); export * from "./two-b.mjs";',
      ),
    ).toEqual(["./one-a.js", "./two-b.mjs"]);
  });

  it("extracts Workbox precache URLs", () => {
    expect(
      extractPrecacheUrls(
        'precacheAndRoute([{url:"index.html",revision:"a"},{url:"assets/index.js",revision:"b"}],{});',
      ),
    ).toEqual(["index.html", "assets/index.js"]);
  });

  it("passes metrics exactly at their budgets", () => {
    const result = evaluatePerformanceBudget({
      budget,
      metrics: {
        entryStaticChainBytes: 1000,
        precacheBytes: 2000,
        firstInteractionMs: 2500,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails each metric independently when it exceeds its budget", () => {
    const result = evaluatePerformanceBudget({
      budget,
      metrics: {
        entryStaticChainBytes: 1001,
        precacheBytes: 2001,
        firstInteractionMs: 2501,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
    expect(result.failures.join("\n")).toContain("entry static chain");
    expect(result.failures.join("\n")).toContain("precache");
    expect(result.failures.join("\n")).toContain("first interaction");
  });

  it("can evaluate static metrics before a browser report exists", () => {
    const result = evaluatePerformanceBudget({
      budget,
      metrics: { entryStaticChainBytes: 900, precacheBytes: 1900 },
      requireFirstInteraction: false,
    });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).not.toContain("first interaction");
  });

  it("keeps the schema identifier stable for browser reports", () => {
    expect(PERFORMANCE_SCHEMA_LABEL).toBe("bmf.performance-budget/1");
  });
});
