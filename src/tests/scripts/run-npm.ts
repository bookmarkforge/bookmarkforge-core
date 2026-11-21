/**
 * Shared helper for script integration tests: run a documented npm script
 * (`npm run <script>`) as a subprocess in a given cwd, exercising the real
 * package.json wiring (package.json -> node scripts/...) instead of invoking
 * node directly. Used by the CLI integration suites in src/tests/scripts/.
 */
import { spawnSync } from "node:child_process";

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run `npm run <script>` in `cwd` and return the raw result. On Windows npm
 * resolves to npm.cmd, which needs a shell to execute.
 */
export function runNpm(cwd: string, script: string): CliResult {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, ["run", script], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
