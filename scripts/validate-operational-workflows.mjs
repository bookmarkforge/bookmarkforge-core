#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

export function validateOperationalWorkflowText(deploy, rollback) {
  const errors = [];
  const deploySource = deploy ?? "";
  const rollbackSource = rollback ?? "";
  for (const [name, source] of [["staging-deploy.yml", deploySource], ["staging-rollback.yml", rollbackSource]]) {
    if (!source.includes("permissions:") || !source.includes("contents: read")) errors.push(`${name}: explicit read-only permissions required`);
    if (!source.includes("environment:")) errors.push(`${name}: protected environment required`);
    if (/--env-file\s+[^\s]+/.test(source) && /\.env\.production/.test(source)) errors.push(`${name}: production env file must not be used by staging workflow`);
    if (/docker\s+(?:compose\s+)?[^\n]*\bup\b[^\n]*\bprod/i.test(source)) errors.push(`${name}: production target detected`);
  }
  if (!/scripts\/staging-deploy\.mjs/.test(deploySource)) errors.push("staging-deploy.yml: versioned deploy script missing");
  if (!/scripts\/staging-rollback\.mjs/.test(rollbackSource)) errors.push("staging-rollback.yml: versioned rollback script missing");
  if (/STAGING_(?:DEPLOY|ROLLBACK)_COMMAND|bash\s+-c/.test(deploySource + rollbackSource)) errors.push("staging workflows: dynamic secret-backed shell execution is forbidden");
  if (!/DEPLOY_COMPOSE_FILE:\s*docker-compose\.staging\.yml/.test(rollbackSource)) errors.push("staging-rollback.yml: rollback must force staging compose file");
  if (!/workflow_dispatch:/.test(rollbackSource)) errors.push("staging-rollback.yml: manual trigger missing");
  if (/checkout@[^\n]+\n\s+with:[\s\S]{0,160}\n\s+with:/.test(rollbackSource)) errors.push("staging-rollback.yml: duplicate checkout configuration block");
  if (/run:\s*npm\s+ci\s*&&/i.test(deploySource + rollbackSource)) errors.push("staging workflows: chained dependency and verification commands are forbidden");
  if (/x-client-events-admin-token/.test(deploySource + rollbackSource) && !/CLIENT_EVENTS_ADMIN_TOKEN/.test(deploySource + rollbackSource)) errors.push("staging workflows: client-events admin token must be supplied through env");
  if (/uses:\s*\.\/\.github\/workflows\/staging-smoke\.yml/.test(deploySource) && !/secrets:\s*\n[\s\S]{0,180}STAGING_SMOKE_ADMIN_TOKEN:\s*\$\{\{\s*secrets\.STAGING_SMOKE_ADMIN_TOKEN\s*\}\}/.test(deploySource)) errors.push("staging-deploy.yml: reusable smoke secret forwarding missing");
  if (/if:\s*\$\{\{\s*env\.STAGING_SMOKE_ADMIN_TOKEN\s*!=/i.test(deploySource + rollbackSource)) errors.push("staging workflows: secret-gated steps must test the secret expression directly");
  if (/x-client-events-admin-token:[^\n]*\$CLIENT_EVENTS_ADMIN_TOKEN/.test(deploySource + rollbackSource) && !/unset CLIENT_EVENTS_ADMIN_TOKEN/.test(deploySource + rollbackSource)) errors.push("staging workflows: diagnostic token must be unset after the request");
  return { errors };
}

const deployPath = ".github/workflows/staging-deploy.yml";
const rollbackPath = ".github/workflows/staging-rollback.yml";
const result = validateOperationalWorkflowText(
  existsSync(deployPath) ? readFileSync(deployPath, "utf8") : "",
  existsSync(rollbackPath) ? readFileSync(rollbackPath, "utf8") : "",
);
if (result.errors.length) {
  console.error("[validate-operational-workflows] FAIL");
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("[validate-operational-workflows] staging deployment contracts passed");
}
