/**
 * Drift guard for the benchmark's mirrored constants.
 *
 * `scripts/benchmark-import-performance.ts` cannot import
 * `src/services/UniversalImporter.ts`: that module reaches `import.meta.env`
 * through the logger, which only resolves inside Vite. The benchmark therefore
 * re-declares `EXISTENCE_QUERY_BATCH`, the operand count per `$in` query.
 *
 * A mirror that silently disagrees with the shipped code makes the benchmark
 * measure a strategy the app no longer uses while still printing a confident
 * speedup, so the two declarations are pinned together here: change either
 * number and this test fails until both move.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readNumericConstant(file: string, name: string): number {
  const source = readFileSync(resolve(process.cwd(), file), "utf8");
  const match = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(source);
  if (!match) {
    throw new Error(`Could not find "const ${name} = <number>" in ${file}`);
  }
  return Number.parseInt(match[1]!, 10);
}

const MIRRORED_CONSTANTS = [
  "EXISTENCE_QUERY_BATCH",
  "BOOKMARK_BULK_INSERT_CHUNK",
] as const;

describe("benchmark constants mirror the importer", () => {
  it.each(MIRRORED_CONSTANTS)(
    "%s equals the importer's declaration",
    (name) => {
      const importerValue = readNumericConstant(
        "src/services/UniversalImporter.ts",
        name,
      );
      const benchmarkValue = readNumericConstant(
        "scripts/benchmark-import-performance.ts",
        name,
      );

      expect(importerValue).toBeGreaterThan(0);
      expect(benchmarkValue).toBe(importerValue);
    },
  );
});
