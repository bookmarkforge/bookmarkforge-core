import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = resolve(root, "coverage", "batches");
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");
const testPattern = /\.test\.(?:ts|tsx|mjs)$/;
const batchSize = Math.max(10, Number.parseInt(process.env.BMF_COVERAGE_BATCH_SIZE ?? "40", 10) || 40);

function collect(dir) {
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== "dist") result.push(...collect(path));
    else if (entry.isFile() && testPattern.test(entry.name)) result.push(relative(root, path).replaceAll("\\", "/"));
  }
  return result;
}

const files = [...collect(join(root, "src")), ...collect(join(root, "eslint-rules")), ...collect(join(root, "scripts", "__tests__"))].sort();
if (!existsSync(vitest)) throw new Error("Vitest entrypoint is missing");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (let index = 0; index < files.length; index += batchSize) {
  const batch = files.slice(index, index + batchSize);
  const output = join(outDir, `coverage-${String(index / batchSize).padStart(3, "0")}.json`);
  console.log(`[coverage-bounded] batch ${index / batchSize + 1}/${Math.ceil(files.length / batchSize)} (${batch.length} files)`);
  const result = spawnSync(process.execPath, [vitest, "run", "--coverage.enabled", "true", "--coverage.thresholds.lines=0", "--coverage.thresholds.statements=0", "--coverage.thresholds.functions=0", "--coverage.thresholds.branches=0", "--coverage.reporter=json", "--coverage.reportsDirectory=" + join(outDir, `raw-${String(index / batchSize).padStart(3, "0")}`), ...batch], { cwd: root, stdio: "inherit", env: { ...process.env, BMF_TEST_CACHE_DIR: process.env.BMF_TEST_CACHE_DIR ?? "node_modules/.vite-test-bounded" } });
  if (result.status !== 0) { console.error(`[coverage-bounded] batch failed: ${index / batchSize + 1}`); process.exit(result.status ?? 1); }
  const generated = join(outDir, `raw-${String(index / batchSize).padStart(3, "0")}`, "coverage-final.json");
  if (!existsSync(generated)) throw new Error(`Coverage output missing for batch ${index / batchSize + 1}`);
  rmSync(output, { force: true });
  const copy = spawnSync(process.execPath, ["-e", "const fs=require('fs'); fs.copyFileSync(process.argv[1], process.argv[2]);", generated, output], { cwd: root });
  if (copy.status !== 0) process.exit(copy.status ?? 1);
}

const maps = readdirSync(outDir).filter((name) => /^coverage-\d{3}\.json$/.test(name)).sort().map((name) => join(outDir, name));
const merge = spawnSync(process.execPath, [resolve(root, "scripts/merge-coverage.mjs"), ...maps, "--output", resolve(root, "coverage/coverage-final.json")], { cwd: root, stdio: "inherit" });
process.exit(merge.status ?? 1);
