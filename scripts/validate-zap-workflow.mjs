#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

export function validateZapWorkflowText(text) {
  const errors = [];
  if (!text.includes("secrets.STAGING_DAST_CONTEXT_B64")) errors.push("DAST context secret contract missing");
  if (!text.includes("secrets.STAGING_DAST_CONTEXT_PASSWORD")) errors.push("DAST context password secret contract missing");
  if (!/DAST_CONTEXT_B64:\s*\$\{\{\s*secrets\.STAGING_DAST_CONTEXT_B64\s*\}\}/.test(text) || !/DAST_CONTEXT_PASSWORD:\s*\$\{\{\s*secrets\.STAGING_DAST_CONTEXT_PASSWORD\s*\}\}/.test(text)) errors.push("DAST secrets must be scoped from the protected environment");
  if (!/name:\s*Prepare and validate authenticated ZAP context[\s\S]*?if:\s*\$\{\{\s*false\s*\}\}/.test(text)) errors.push("authenticated context preparation must remain disabled until verified");
  if (!/if:\s*\$\{\{\s*(?:secrets\.STAGING_DAST_CONTEXT_B64\s*!=\s*''|false)\s*\}\}/.test(text)) errors.push("authenticated DAST scan must be opt-in");
  if ((text.match(/name: Run OWASP ZAP authenticated scan from validated context[\s\S]*?if:\s*\$\{\{\s*false\s*\}\}/g) ?? []).length !== 1) errors.push("authenticated DAST execution must remain disabled until verified");
  if ((text.match(/if:\s*\$\{\{\s*false\s*\}\}/g) ?? []).length < 2) errors.push("all authenticated DAST steps must remain disabled until verified");
  if (!text.includes("umask 077")) errors.push("DAST authentication material must use restrictive umask");
  if (!text.includes('test -n "${DAST_CONTEXT_B64:-}"')) errors.push("DAST context must fail closed when the secret is empty");
  if (!text.includes("chmod 600 .dast-context-password")) errors.push("DAST password file permissions must be restricted");
  if (!text.includes('test -n "${DAST_CONTEXT_PASSWORD:-}"')) errors.push("DAST password secret must fail closed when empty");
  if (!text.includes("rm -f .dast-auth.context .dast-context-password .dast-zap.env")) errors.push("DAST cleanup step missing");
  if (!/if:\s*always\(\)/.test(text)) errors.push("DAST cleanup must run after failures");
  if (/ghcr\.io\/zaproxy\/zaproxy:(?!sha256:)[^\s]+/i.test(text)) errors.push("ZAP image must use a digest");
  if (/sha256:REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST/i.test(text)) errors.push("ZAP image digest placeholder is not allowed");
  if (/docker\s+(?:run|[A-Za-z]+)[\s\S]{0,500}(?:\$DAST_CONTEXT_PASSWORD|\$DAST_CONTEXT_B64)/i.test(text)) errors.push("DAST secrets must not be passed as Docker arguments");
  return errors;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\\\", "/")}`) {
  const path = ".github/workflows/dast-nightly.yml";
  const result = validateZapWorkflowText(existsSync(path) ? readFileSync(path, "utf8") : "");
  if (result.length) {
    console.error("[validate-zap-workflow] FAIL");
    result.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log("[validate-zap-workflow] DAST workflow security passed");
  }
}
