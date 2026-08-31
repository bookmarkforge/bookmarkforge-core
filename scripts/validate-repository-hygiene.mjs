#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateRepositoryHygiene(gitignore, dockerignore) {
  const required = [".freebuff", ".env", ".env.*", "*.pem", "*.key", "node_modules", "dist"];
  const errors = [];
  for (const entry of required) {
    if (!gitignore.includes(entry)) errors.push(`.gitignore missing sensitive entry: ${entry}`);
    if (!dockerignore.includes(entry)) errors.push(`.dockerignore missing sensitive entry: ${entry}`);
  }
  if (!dockerignore.includes(".git")) errors.push(".dockerignore missing sensitive entry: .git");
  if (!/!\.env\.example/.test(gitignore) || !/!\.env\.production\.example/.test(gitignore)) {
    errors.push(".gitignore must explicitly allow committed environment templates");
  }
  return { errors };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = validateRepositoryHygiene(
    existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "",
    existsSync(".dockerignore") ? readFileSync(".dockerignore", "utf8") : "",
  );
  if (result.errors.length) {
    console.error("[validate-repository-hygiene] FAIL");
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log("[validate-repository-hygiene] repository hygiene policy passed");
}
