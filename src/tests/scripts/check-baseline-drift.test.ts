import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import PNGlib from "pngjs";

const SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "check-baseline-drift.mjs",
);
const GIT = "git";

/** Tiny solid-color PNG with an optically-distinct second variant. */
function solidPng(color: "red" | "blue"): Buffer {
  const png = new PNGlib.PNG({ width: 32, height: 32 });
  const rgb: [number, number, number] =
    color === "red" ? [255, 0, 0] : [0, 0, 255];
  for (let i = 0; i < 32 * 32 * 4; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNGlib.PNG.sync.write(png);
}

function git(tmp: string, ...args: string[]): void {
  execSync(`${GIT} -C "${tmp}" ${args.map((a) => `"${a}"`).join(" ")}`, {
    stdio: "pipe",
  });
}

function runScript(repoRoot: string, args: string[]): {
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  try {
    const output = execSync(
      `node "${SCRIPT_PATH}" --root "${repoRoot}" ${args.map((a) => `"${a}"`).join(" ")}`,
      { cwd: process.cwd(), encoding: "utf-8" },
    );
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (e: unknown) {
    const err = e as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("check-baseline-drift.mjs", () => {
  let baseDir: string;

  beforeAll(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "baseline-drift-"));
  });

  afterAll(async () => {
    if (baseDir) {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  async function freshRepo(): Promise<string> {
    const repo = path.join(baseDir, `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(path.join(repo, "tests", "e2e", "text-fit.spec.ts-snapshots"), {
      recursive: true,
    });
    // A tracked baseline whose regeneration must be reviewable.
    await fs.writeFile(
      path.join(repo, "tests", "e2e", "text-fit.spec.ts-snapshots", "text-fit-lock-screen-en-chromium-win32.png"),
      solidPng("red"),
    );
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "test@example.com");
    git(repo, "config", "user.name", "Test");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "baseline");
    return repo;
  }

  it("passes when a baseline is unchanged vs the base ref", async () => {
    const repo = await freshRepo();
    const result = runScript(repo, ["--base", "HEAD"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("unchanged");
  });

  it("fails when a baseline regenerates with >10% pixel drift", async () => {
    const repo = await freshRepo();
    await fs.writeFile(
      path.join(repo, "tests", "e2e", "text-fit.spec.ts-snapshots", "text-fit-lock-screen-en-chromium-win32.png"),
      solidPng("blue"),
    );
    const result = runScript(repo, ["--base", "HEAD"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAIL");
    expect(result.stderr).toContain("text-fit-lock-screen");
  });

  it("does not fail for an added baseline (no prior version to drift against)", async () => {
    const repo = await freshRepo();
    await fs.writeFile(
      path.join(repo, "tests", "e2e", "text-fit.spec.ts-snapshots", "text-fit-dashboard-en-chromium-win32.png"),
      solidPng("blue"),
    );
    const result = runScript(repo, ["--base", "HEAD"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("added baseline");
  });

  it("does not fail for a removed baseline", async () => {
    const repo = await freshRepo();
    await fs.rm(
      path.join(repo, "tests", "e2e", "text-fit.spec.ts-snapshots", "text-fit-lock-screen-en-chromium-win32.png"),
    );
    const result = runScript(repo, ["--base", "HEAD"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("removed");
  });

  it("rejects a --max-ratio outside [0, 1] as a usage error", async () => {
    const repo = await freshRepo();
    const result = runScript(repo, ["--base", "HEAD", "--max-ratio", "1.5"]);
    expect(result.exitCode).toBe(2);
  });
});