#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function validateWorkflowText(name, text) {
  const errors = [];
  const warnings = [];
  if (!/^name:\s*\S/m.test(text)) errors.push(`${name}: missing workflow name`);
  if (!/^on:/m.test(text)) errors.push(`${name}: missing on trigger`);
  if (!/^permissions:\s*$/m.test(text)) warnings.push(`${name}: top-level permissions block not found`);
  if (/^permissions:\s*$/m.test(text) && !/^\s+contents:\s+read\s*$/m.test(text)) errors.push(`${name}: permissions must explicitly restrict contents to read`);
  if (/pull-requests:\s*write/.test(text)) warnings.push(`${name}: pull-requests write permission requires explicit review`);
  if (/docker\s+run[\s\S]{0,800}(?:TOKEN|PASSWORD|SECRET|AUTH_HEADER)/i.test(text)) errors.push(`${name}: possible secret interpolation in docker command`);
  if (/echo\s+.*(?:TOKEN|PASSWORD|SECRET|AUTH)/i.test(text)) errors.push(`${name}: possible secret printed to logs`);
  if (/\$\{\{\s*secrets\.[^}]+\}\}/.test(text) && !/^permissions:/m.test(text)) errors.push(`${name}: secret usage without permissions declaration`);
  // Local references (workflow_call to ./... or .github/...) are not external
  // actions and must not trigger the pin warning.
  if (/uses:\s+(?!(?:\.\/|\.github\/))[^@\s]+\s*$/m.test(text)) warnings.push(`${name}: action reference is not pinned to a version or SHA`);
  if (/run:\s*[^\n]*\$\{\{\s*secrets\./.test(text)) errors.push(`${name}: secrets must be passed through env, not interpolated in run commands`);
  // `secrets` is not a valid context in `if:` conditions (job or step): the
  // workflow file fails to PARSE, and GitHub records a 0-second red run with
  // zero jobs on every push — a tombstone, not a real test result. Documented
  // workaround: promote the secret into a job-level `env:` block (where
  // secrets ARE allowed) and let the condition read the env context.
  // staging-smoke.yml shipped this for its whole life unparsed; no repository
  // existed to reject the file until 2026-09-22 (found by workflow-dispatch
  // probe, HTTP 422, "Unrecognized named-value: 'secrets'", line 82).
  if (/^\s*if:.*secrets\./m.test(text)) errors.push(`${name}: secrets cannot be used in if conditions — promote the secret to job-level env and test the env context instead`);
  if (/bash\s+-c\s+"\$[A-Z_]+"/.test(text)) warnings.push(`${name}: dynamic bash command should be replaced by a versioned script`);
  if (/upload-artifact@[^\s]+[\s\S]{0,500}path:\s*[^\n]*(?:\.env|secret|credential|key)/i.test(text)) errors.push(`${name}: sensitive files must not be uploaded as artifacts`);
  if (/uses:\s+actions\/upload-artifact@/i.test(text) && !/retention-days:\s*\d+/i.test(text)) warnings.push(`${name}: artifact retention should be explicitly limited`);
  const externalActions = [...text.matchAll(/^\s*(?:-\s+)?uses:\s+([^\s]+)$/gm)].map((match) => match[1]).filter((ref) => !ref.startsWith("./"));
  for (const ref of externalActions) {
    // Supply-chain hardening: any external action must be pinned to a
    // full 40-char commit SHA. Mutable refs (tags like @v4 or branches)
    // can silently move and pull in unvetted code. Local refs (./.github/...)
    // are exempt and filtered above.
    if (!/@[0-9a-f]{40}$/i.test(ref)) errors.push(`${name}: external action must be pinned by full 40-char SHA (supply-chain): ${ref}`);
  }
  const withoutRunnerLatest = text.replace(/runs-on:\s*ubuntu-latest/g, "");
  if (/(?:^|[^\w])(?:latest|:latest)(?:[^\w]|$)/i.test(withoutRunnerLatest) && !/Never use|no usar latest|latest ni|mutable latest reference/i.test(text)) errors.push(`${name}: mutable latest reference detected`);
  return { errors, warnings };
}

const root = join(process.cwd(), ".github", "workflows");
// Artifact safety is checked by the dedicated validator invoked from CI.

const errors = [];
const warnings = [];
const files = existsSync(root) ? readdirSync(root).filter((file) => /\.(yml|yaml)$/i.test(file)) : [];
if (!files.length) errors.push("no workflow files found");
for (const file of files) {
  const result = validateWorkflowText(file, readFileSync(join(root, file), "utf8"));
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}
const ci = files.includes("ci.yml") ? readFileSync(join(root, "ci.yml"), "utf8") : "";
for (const expected of ["Typecheck, lint, tests and security gates", "Playwright E2E", "Production build and repository checks"]) if (ci && !ci.includes(`name: ${expected}`)) errors.push(`ci.yml: expected job name missing: ${expected}`);
if (errors.length) {
  console.error("[validate-workflows] FAIL");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`[validate-workflows] ${files.length} workflow files passed internal safety checks`);
}
for (const warning of [...new Set(warnings)]) console.warn(`- WARN: ${warning}`);
