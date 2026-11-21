#!/usr/bin/env node
// Public-export variant of scripts/check-zap-baseline.mjs. The ZAP baseline
// policy (.zap/) is private pen-test infrastructure and is intentionally
// absent from the public tree; this guard keeps the check:security-internal
// chain entry valid and fails if the baseline ever leaks here.
import { existsSync } from "node:fs";

if (existsSync(".zap")) {
  console.error("[zap-baseline-guard] FAIL: private ZAP baseline (.zap/) present in the public tree");
  process.exit(1);
}
console.log("[zap-baseline-guard] ok: no ZAP baseline in the public tree");
