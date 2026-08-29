import { existsSync, readFileSync, writeFileSync } from "node:fs";

const inputs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const outputIndex = process.argv.indexOf("--output");
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : "coverage/coverage-final.json";

if (inputs.length === 0) {
  console.error("Usage: node scripts/merge-coverage.mjs <coverage.json>... --output <coverage.json>");
  process.exit(1);
}

function mergeCounters(left, right) {
  const result = { ...left };
  for (const [key, value] of Object.entries(right ?? {})) {
    result[key] = typeof value === "number" && typeof result[key] === "number"
      ? result[key] + value
      : value;
  }
  return result;
}

function mergeEntry(left, right) {
  if (!left) return structuredClone(right);
  const result = structuredClone(left);
  for (const metric of ["s", "f", "b"]) {
    if (right[metric]) {
      if (metric === "b") {
        const branchKeys = new Set([...Object.keys(result[metric] ?? {}), ...Object.keys(right[metric] ?? {})]);
        result[metric] = Object.fromEntries([...branchKeys].map((key) => {
          const leftValues = Array.isArray(result[metric]?.[key]) ? result[metric][key] : [];
          const rightValues = Array.isArray(right[metric]?.[key]) ? right[metric][key] : [];
          const length = Math.max(leftValues.length, rightValues.length);
          return [key, Array.from({ length }, (_, index) => (leftValues[index] ?? 0) + (rightValues[index] ?? 0))];
        }));
      } else {
        result[metric] = mergeCounters(result[metric], right[metric]);
      }
    }
  }
  if (right.l) result.l = mergeCounters(result.l, right.l);
  for (const map of ["statementMap", "fnMap", "branchMap", "lineMap", "inputSourceMap"]) {
    if (result[map] === undefined && right[map] !== undefined) result[map] = right[map];
  }
  return result;
}

const merged = {};
for (const input of inputs) {
  if (!existsSync(input)) throw new Error(`Coverage file missing: ${input}`);
  const map = JSON.parse(readFileSync(input, "utf8"));
  for (const [file, entry] of Object.entries(map)) merged[file] = mergeEntry(merged[file], entry);
}
writeFileSync(output, `${JSON.stringify(merged)}\n`, "utf8");
console.log(`[coverage] merged ${inputs.length} maps into ${output} (${Object.keys(merged).length} files)`);
