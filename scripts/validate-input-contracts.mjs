#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

export function validateInputContracts(deploy, rollback, smoke) {
  const errors = [];
  const requiredSources = [["staging-deploy.yml", deploy], ["staging-rollback.yml", rollback], ["staging-smoke.yml", smoke]];
  for (const [name, source] of requiredSources) {
    if (typeof source !== "string" || source.trim() === "") errors.push(`${name}: workflow source is missing`);
  }
  const sources = [["staging-deploy.yml", deploy ?? ""], ["staging-rollback.yml", rollback ?? ""], ["staging-smoke.yml", smoke ?? ""]];
  for (const [name, source] of sources) {
    if (/\$\{\{\s*inputs\.[^}]+\}\}/.test(source) && !/env:/m.test(source)) errors.push(`${name}: workflow inputs must be passed through env`);
    if (/STAGING_URL[^\n]*\$\{\{\s*inputs\./.test(source) && !/https:\/\//i.test(source)) errors.push(`${name}: staging URL contract missing HTTPS validation`);
  }
  if (!rollback.includes("^prod-[0-9]{8}-[0-9]{4}-[0-9a-fA-F]{7,40}$")) errors.push("staging-rollback.yml: strict annotated production tag format missing");
  if (!/\[\[\s*\"\$tag\"\s*=~/.test(rollback) || !/git\s+(cat-file|show|rev-parse)[^\n]*\$tag/.test(rollback)) errors.push("staging-rollback.yml: shell tag validation missing");
  if (!/\[\[\s*\"\$url\"\s*==\s*https:\/\/\*\s*\]\]/.test(smoke)) errors.push("staging-smoke.yml: HTTPS URL validation missing");
  if (!/staging_url must not include a port/.test(smoke) || !/staging_url must not include a port/.test(rollback)) errors.push("staging workflows: staging URL port rejection missing");
  if (!/STAGING_SMOKE_TOKEN/.test(smoke) || !/secrets:\s*$/m.test(smoke)) errors.push("staging-smoke.yml: reusable workflow secret contract missing");
  // Opt-in contract, VALID shape: the admin secret is consumed explicitly
  // (${{ secrets.… }}) at job-level env — where the secrets context is legal —
  // and the step's `if` reads the env context. The old contract pinned the
  // invalid construction (secrets inside `if:`), which is what left this file
  // unparseable for GitHub its whole life: every push recorded a 0-second red
  // run with zero jobs. A regression test frozen the bug; see
  // scripts/validate-workflows.mjs for the parse-level rule that catches the
  // class.
  if (/STAGING_SMOKE_ADMIN_TOKEN/.test(smoke) && (!/STAGING_SMOKE_ADMIN_TOKEN:\s*\$\{\{\s*secrets\.STAGING_SMOKE_ADMIN_TOKEN\s*\}\}/.test(smoke) || !/if:\s*env\.STAGING_SMOKE_ADMIN_TOKEN\s*!=\s*''/.test(smoke))) errors.push("staging-smoke.yml: admin diagnostic secret contract must remain explicit and opt-in");
  return { errors };
}

const paths = [".github/workflows/staging-deploy.yml", ".github/workflows/staging-rollback.yml", ".github/workflows/staging-smoke.yml"];
const sources = paths.map((path) => existsSync(path) ? readFileSync(path, "utf8") : "");
const result = validateInputContracts(...sources);
if (result.errors.length) {
  console.error("[validate-input-contracts] FAIL");
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log("[validate-input-contracts] staging input contracts passed");
