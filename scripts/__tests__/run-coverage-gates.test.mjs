import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "scripts", "run-coverage-gates.mjs");

function writeMarkerScript(path, marker) {
  writeFileSync(
    path,
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n`,
    "utf8",
  );
}

describe("run-coverage-gates fast-fail", () => {
  it("skips history and per-area post-processing when Vitest fails", () => {
    const fixture = mkdtempSync(join(tmpdir(), "bmf-coverage-fast-fail-"));
    const vitestDir = join(fixture, "node_modules", "vitest");
    const scriptsDir = join(fixture, "scripts");
    const historyMarker = join(fixture, "history-ran");
    const areaMarker = join(fixture, "area-ran");

    try {
      mkdirSync(vitestDir, { recursive: true });
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(
        join(vitestDir, "vitest.mjs"),
        'console.error("fixture Vitest failure");\nprocess.exit(17);\n',
        "utf8",
      );
      writeMarkerScript(join(scriptsDir, "test-coverage-history.mjs"), historyMarker);
      writeMarkerScript(join(scriptsDir, "check-coverage-by-area.mjs"), areaMarker);

      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: fixture,
        encoding: "utf8",
      });
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

      expect(result.status).toBe(1);
      expect(output).toContain(
        "[coverage] skipping history and per-area checks because Vitest failed",
      );
      expect(existsSync(historyMarker)).toBe(false);
      expect(existsSync(areaMarker)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
