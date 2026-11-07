#!/usr/bin/env node
// Public-export variant of scripts/check-audit-freshness.mjs. The freshness
// record (audit-freshness.json) and its raw discovery corpus
// (docs/audit-raw.mjs) describe an internal audit of the PRIVATE tree; they
// stay private, where the real gate runs. This guard fails if that machinery
// appears in the public tree.
import { existsSync } from "node:fs";
const leaked = ["audit-freshness.json", "docs/audit-raw.mjs"].filter((p) => existsSync(p));
if (leaked.length) {
  console.error("[audit-freshness-guard] FAIL: private audit machinery present in the public tree:");
  for (const p of leaked) console.error("- " + p);
  process.exit(1);
}
console.log("[audit-freshness-guard] ok: no private audit machinery in the public tree");
