import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "check-code-i18n.mjs");

function runIn(dir: string): { exitCode: number; stderr: string } {
  try {
    const output = execSync(`node "${SCRIPT_PATH}"`, {
      cwd: dir,
      encoding: "utf-8",
    });
    return { exitCode: 0, stderr: output };
  } catch (e: unknown) {
    const err = e as { status?: number; stderr?: string };
    return { exitCode: err.status ?? 1, stderr: err.stderr ?? "" };
  }
}

async function scaffold(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
}

const EN = {
  app_daysAgo: "{{count}} days ago",
  app_colorSwatch: "{{color}} color",
  app_ok: "Everything is fine",
  app_storageVectors: "Vectors: {{size}}",
};

const json = (o: Record<string, unknown>) => JSON.stringify(o, null, 2);

describe("check-code-i18n.mjs — code-vs-keys interpolation gate", () => {
  let cleanDir: string;
  let mismatchDir: string;
  let missingKeyDir: string;
  let shorthandDir: string;

  beforeAll(async () => {
    cleanDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-i18n-clean-"));
    await scaffold(cleanDir, {
      "public/locales/en.json": json(EN),
      "src/App.tsx": `
        const x = t("app_daysAgo", "{{count}} days ago", { count: 3 });
        const y = t("app_ok", "Everything is fine");
      `,
    });

    // The class of bug batch-38 fixed: options object names a different
    // variable than the key's placeholder.
    mismatchDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-i18n-mismatch-"));
    await scaffold(mismatchDir, {
      "public/locales/en.json": json(EN),
      "src/App.tsx": `
        const x = t("app_daysAgo", "{{count}} days ago", { days: 3 });
      `,
    });

    // Literal key that does not exist in en.json.
    missingKeyDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-i18n-missing-"));
    await scaffold(missingKeyDir, {
      "public/locales/en.json": json(EN),
      "src/App.tsx": `
        const x = t("app_doesNotExist", "Fallback text");
      `,
    });

    // Shorthand options and named options must both be recognized; the
    // gate's brace scanner must not confuse {{placeholders}} in the fallback
    // string with the options object.
    shorthandDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-i18n-short-"));
    await scaffold(shorthandDir, {
      "public/locales/en.json": json(EN),
      "src/App.tsx": `
        const c = "#fff";
        const a = t("app_colorSwatch", "{{color}} color", { color: c });
        const s = t("app_storageVectors", "Vectors: {{size}}", {
          size: formatBytes(123),
        });
      `,
    });
  });

  afterAll(async () => {
    for (const dir of [cleanDir, mismatchDir, missingKeyDir, shorthandDir]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes when all placeholders are provided", () => {
    const r = runIn(cleanDir);
    expect(r.exitCode).toBe(0);
  });

  it("fails when options name a different variable than the placeholder", () => {
    const r = runIn(mismatchDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("app_daysAgo");
    expect(r.stderr).toContain("{{count}} not provided");
  });

  it("fails when a literal key is missing from en.json", () => {
    const r = runIn(missingKeyDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("app_doesNotExist");
    expect(r.stderr).toContain("key not in en.json");
  });

  it("recognizes shorthand and multi-line named options", () => {
    const r = runIn(shorthandDir);
    expect(r.exitCode).toBe(0);
  });
});
