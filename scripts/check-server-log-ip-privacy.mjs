#!/usr/bin/env node
// Public-export variant of scripts/check-server-log-ip-privacy.mjs. The raw-IP
// logging gate polices the companion backend (server/**), which is private
// operations infrastructure; the public tree must not carry the backend at
// all, so this guard fails if server/ appears here.
import { existsSync } from "node:fs";
if (existsSync("server")) {
  console.error("[server-log-ip-privacy-guard] FAIL: private companion backend (server/) present in the public tree");
  process.exit(1);
}
console.log("[server-log-ip-privacy-guard] ok: no private companion backend in the public tree");
