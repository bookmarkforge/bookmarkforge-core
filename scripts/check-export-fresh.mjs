#!/usr/bin/env node
// Public-export variant of scripts/check-export-fresh.mjs (ADR-065). The
// freshness baseline (scripts/public-export-baseline.json) records the PRIVATE
// tree's per-file hashes at the last confirmed export: it is private-operations
// data and stays in the private repository, where the real staleness gate runs.
// This guard fails if that machinery ever appears in the public tree.
import { existsSync } from "node:fs";
if (existsSync("scripts/public-export-baseline.json")) {
  console.error("[export-fresh-guard] FAIL: private export baseline present in the public tree");
  process.exit(1);
}
console.log("[export-fresh-guard] ok: no private export baseline in the public tree");
