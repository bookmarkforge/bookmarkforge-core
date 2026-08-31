#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const paths = [
  ".github/workflows/dast-nightly.yml",
  ".github/workflows/staging-deploy.yml",
  ".github/workflows/staging-rollback.yml",
];
const errors = [];
for (const path of paths) {
  if (!existsSync(path)) {
    errors.push(`${path}: workflow is missing`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  if (/ghcr\.io\/zaproxy\/zaproxy:(?!sha256:)[^\s]+/i.test(text)) {
    errors.push(`${path}: ZAP container must be pinned by digest`);
  }
  if (/sha256:REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST/i.test(text)) {
    errors.push(`${path}: ZAP image digest placeholder must be replaced with a verified digest`);
  }
  if (/STAGING_(?:DEPLOY|ROLLBACK)_COMMAND|bash\s+-c/i.test(text)) {
    errors.push(`${path}: dynamic staging command execution is forbidden`);
  }
  if (/docker\s+run[\s\S]{0,500}(?:PASSWORD|TOKEN|AUTHORIZATION)/i.test(text)) {
    errors.push(`${path}: authentication material must not be passed to docker arguments`);
  }
}
if (errors.length) {
  console.error("[check-workflow-security] FAIL");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log("[check-workflow-security] DAST and staging workflow security passed");
