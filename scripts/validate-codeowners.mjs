#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function validateCodeownersContent(content, configuredOrg = "") {
  const errors = [];
  const ownerRefs = new Set();
  const placeholderPattern = /(YOUR_GITHUB_ORG|your[-_ ]github[-_ ]org|TODO|REPLACE_ME|example\.com|@your[-_])/i;
  if (!content.trim()) errors.push(".github/CODEOWNERS is missing or empty");
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (placeholderPattern.test(line)) errors.push(`line ${index + 1}: placeholder owner detected`);
    const parts = line.split(/\s+/);
    if (parts.length < 2) { errors.push(`line ${index + 1}: every rule needs a path and at least one owner`); continue; }
    for (const owner of parts.slice(1)) {
      if (!/^@[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(owner)) errors.push(`line ${index + 1}: invalid owner '${owner}'`);
      else {
        const ref = owner.slice(1);
        if (configuredOrg && ref.includes("/") && ref.split("/")[0] !== configuredOrg) errors.push(`line ${index + 1}: owner '${owner}' is outside configured CODEOWNERS_ORG '${configuredOrg}'`);
        ownerRefs.add(ref);
      }
    }
  }
  return { errors, ownerRefs };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const file = join(process.cwd(), ".github", "CODEOWNERS");
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  const configuredOrg = (process.env.CODEOWNERS_ORG ?? "").trim().replace(/^@/, "");
  const result = validateCodeownersContent(content, configuredOrg);
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const shouldVerify = process.env.VERIFY_GITHUB_OWNERS === "true" || Boolean(token && repository);
  if (shouldVerify && (!token || !repository)) result.errors.push("owner verification requires GITHUB_TOKEN and GITHUB_REPOSITORY");
  if (result.errors.length) {
    console.error("[validate-codeowners] FAIL");
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log(`[validate-codeowners] syntax and placeholders valid (${result.ownerRefs.size} owners)`);
}
