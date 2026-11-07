#!/usr/bin/env node
// Public-export variant of scripts/generate-license-keys.mjs. Issuing license
// keys is private business logic: the signing key is a server-side secret and
// the generator never ships publicly. This guard keeps the public
// check:security gate valid (its body names this path) and fails if private
// signing material is ever committed here.
import { existsSync, readdirSync } from "node:fs";

const keyFiles = readdirSync(".").filter((name) => /.(?:pem|key)$/i.test(name));
const leaked = [
  ...(existsSync("server") ? ["server/"] : []),
  ...keyFiles,
];
if (leaked.length) {
  console.error("[license-keys-guard] FAIL: private key issuance surface present in the public tree:");
  for (const p of leaked) console.error("- " + p);
  process.exit(1);
}
console.log("[license-keys-guard] ok: license key issuance stays private");
