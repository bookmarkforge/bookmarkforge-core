#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function validateWorkflowArtifacts(name, text) {
  const errors = [];
  if (!/uses:\s*actions\/upload-artifact@/i.test(text)) return errors;
  if (!/permissions:\s*[\s\S]{0,160}contents:\s*read/im.test(text)) errors.push(`${name}: artifact workflow must declare read-only contents permission`);
  if (!/retention-days:\s*(?:[1-9]|[1-8][0-9]|90)\s*$/im.test(text)) errors.push(`${name}: artifact retention must be between 1 and 90 days`);
  // The path block ends at the next YAML key at the start of a line. Job ids
  // legitimately contain digits (`e2e-public-relay:`) — leaving them out of the
  // class does not "scan more paths", it makes the slice run past the block and
  // scan unrelated workflow text, where an innocuous comment about credentials
  // reads as a sensitive artifact path.
  const paths = text.split(/\bpath:\s*[|>]?/i)[1]?.split(/\n\s*(?:[A-Za-z0-9_-]+:|$)/)[0] ?? "";
  if (/(?:\.env(?:\b|\.)|\.pem\b|\.key\b|password|secret|credential|token)/i.test(paths)) errors.push(`${name}: artifact paths must exclude credentials and secret material`);
  if (!/if-no-files-found:\s*(?:ignore|warn|error)/i.test(text)) errors.push(`${name}: artifact upload must define if-no-files-found`);
  return errors;
}

export function validateWorkflowArtifactFiles(root = join(process.cwd(), ".github", "workflows")) {
  const errors = [];
  if (!existsSync(root)) return ["workflow directory is missing"];
  for (const file of readdirSync(root).filter((entry) => /\.(yml|yaml)$/i.test(entry))) errors.push(...validateWorkflowArtifacts(file, readFileSync(join(root, file), "utf8")));
  return errors;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const errors = validateWorkflowArtifactFiles();
  if (errors.length) {
    console.error("[validate-workflow-artifacts] FAIL");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log("[validate-workflow-artifacts] artifact policies passed");
}
