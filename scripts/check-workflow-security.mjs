#!/usr/bin/env node
// Public-export variant. The staging/DAST/nightly/export workflows and their deploy
// scripts are private-infrastructure files and are intentionally absent from
// this repository. This gate fails if such a workflow ever appears here
// directly: infrastructure changes must be made in the private source
// repository and flow into this one through the export process.
import { existsSync, readdirSync } from "node:fs";

const dir = ".github/workflows";
if (!existsSync(dir)) {
  console.error("[public-workflow-guard] FAIL: .github/workflows is missing");
  process.exit(1);
}
const infra = readdirSync(dir).filter((f) => /staging|deploy|rollback|dast|nightly|pen-test|drill|open-core-export/i.test(f));
if (infra.length) {
  console.error("[public-workflow-guard] FAIL: private-infrastructure workflows present in public export:");
  infra.forEach((f) => console.error("- " + f));
  process.exit(1);
}
console.log("[public-workflow-guard] ok: no private-infrastructure workflows in public export");
