#!/usr/bin/env node
// Public-export variant of scripts/check-license-mirror-sync.mjs. The
// api/ ↔ server/ license mirror contract polices the private issuance
// backend, which never ships publicly; this guard keeps the
// check:security-internal chain entry valid and fails if the private
// mirror surface ever appears in the public tree.
import { existsSync } from "node:fs";

const mirrorFiles = [
  "api/license/_license-seats.ts",
  "api/license/_license-signing.ts",
  "server/src/license-seats.ts",
  "server/src/license-signing.ts",
];
const present = mirrorFiles.filter((path) => existsSync(path));
if (present.length) {
  console.error("[license-mirror-guard] FAIL: private license mirror files present in the public tree:");
  for (const p of present) console.error("- " + p);
  process.exit(1);
}
console.log("[license-mirror-guard] ok: license mirror machinery stays private");
