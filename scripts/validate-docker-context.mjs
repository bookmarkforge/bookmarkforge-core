#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

export function validateDockerContext(source) {
  const required = [".env", "*.pem", "*.key", "node_modules", "dist", ".git"];
  const errors = required.filter((entry) => !source.includes(entry)).map((entry) => `missing .dockerignore entry: ${entry}`);
  return { errors };
}

const file = ".dockerignore";
const result = validateDockerContext(existsSync(file) ? readFileSync(file, "utf8") : "");
if (result.errors.length) {
  console.error("[validate-docker-context] FAIL");
  result.errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log("[validate-docker-context] Docker build context policy passed");
