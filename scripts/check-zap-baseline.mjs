#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const policyPath = ".zap/baseline.conf";
const rulesPath = ".zap/rules.tsv";
const errors = [];

if (!existsSync(policyPath)) errors.push(`${policyPath} is missing`);
if (!existsSync(rulesPath)) errors.push(`${rulesPath} is missing`);

if (!errors.length) {
  const policy = readFileSync(policyPath, "utf8");
  const fail = policy.match(/^FAIL_LEVELS=(.+)$/m)?.[1]?.split(",").map((v) => v.trim()) ?? [];
  const warn = policy.match(/^WARN_LEVELS=(.+)$/m)?.[1]?.split(",").map((v) => v.trim()) ?? [];
  const allowed = new Set(["Critical", "High", "Medium", "Low", "Informational"]);
  if (!fail.includes("High") || !fail.includes("Critical")) errors.push("FAIL_LEVELS must include High and Critical");
  if (fail.some((level) => !allowed.has(level)) || warn.some((level) => !allowed.has(level))) errors.push("severity names must be Critical, High, Medium, Low or Informational");
  if (fail.some((level) => warn.includes(level))) errors.push("FAIL_LEVELS and WARN_LEVELS overlap");
  if (!policy.includes("IGNORE_FILE=.zap/rules.tsv")) errors.push("policy must reference the reviewed ignore file");

  for (const [lineNo, raw] of readFileSync(rulesPath, "utf8").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 3 || !/^\d+$/.test(fields[0]) || fields[1] !== "IGNORE" || fields[2].length < 20) {
      errors.push(`${rulesPath}:${lineNo + 1} must contain rule id, IGNORE and a meaningful reason`);
    }
  }
}

if (errors.length) {
  console.error("[check-zap-baseline] FAIL");
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}
console.log("[check-zap-baseline] policy and reviewed exclusions are valid");
