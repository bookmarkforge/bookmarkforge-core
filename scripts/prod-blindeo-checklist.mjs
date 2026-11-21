#!/usr/bin/env node
// Public-export variant of the private pre-deploy hardening gates
// (check-blindeo.mjs + prod-blindeo-checklist.mjs). Rollback-tag and
// deploy-checklist enforcement is private release operations; this guard
// keeps the public check:blindeo chain entry valid and fails if private
// deploy machinery ever appears in the public tree.
import { existsSync, readdirSync } from "node:fs";

const leaked = [
  ...(existsSync("server") ? ["server/"] : []),
  ...readdirSync("scripts").filter((name) => /^(?:deploy-prod|staging-|drill-)/.test(name)),
];
if (leaked.length) {
  console.error("[deploy-gate-guard] FAIL: private deploy machinery present in the public tree:");
  for (const p of leaked) console.error("- " + p);
  process.exit(1);
}
console.log("[deploy-gate-guard] ok: no private deploy machinery in the public tree");
