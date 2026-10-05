import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "i18n-completeness.mjs",
);

function runIn(dir: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const output = execSync(`node "${SCRIPT_PATH}"`, {
      cwd: dir,
      encoding: "utf-8",
    });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
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

const EN = JSON.stringify(
  {
    app_hello: "Hello",
    day_sun: "Sun",
    day_mon: "Mon",
    day_tue: "Tue",
    day_wed: "Wed",
    day_thu: "Thu",
    day_fri: "Fri",
    day_sat: "Sat",
  },
  null,
  2,
);
const ES = JSON.stringify(
  {
    app_hello: "Hola",
    day_sun: "Dom",
    day_mon: "Lun",
    day_tue: "Mar",
    day_wed: "Mié",
    day_thu: "Jue",
    day_fri: "Vie",
    day_sat: "Sáb",
  },
  null,
  2,
);
const LOCALES = { "public/locales/en.json": EN, "public/locales/es.json": ES };

describe("i18n-completeness.mjs — code → en.json coverage", () => {
  let cleanDir: string;
  let missingDir: string;
  let dynamicOkDir: string;
  let dynamicMissingDir: string;
  let unregisteredDir: string;

  beforeAll(async () => {
    cleanDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-clean-"));
    missingDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-missing-"));
    dynamicOkDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-dynok-"));
    dynamicMissingDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-dynmissing-"),
    );
    unregisteredDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-unreg-"));

    await scaffold(cleanDir, {
      ...LOCALES,
      "src/App.ts": 'export const label = (t: (k: string) => string) => t("app_hello");\n',
    });

    await scaffold(missingDir, {
      ...LOCALES,
      "src/App.ts": 'export const label = (t: (k: string) => string) => t("app_ghost");\n',
    });

    await scaffold(dynamicOkDir, {
      ...LOCALES,
      "src/Calendar.ts":
        'export const header = (t: (k: string) => string, d: string) => t(`day_${d}`);\n',
    });

    // Registered pattern (day_${x}) whose expansion day_sat is missing from en.
    await scaffold(dynamicMissingDir, {
      "public/locales/en.json": JSON.stringify(
        { day_sun: "Sun", day_mon: "Mon", day_tue: "Tue", day_wed: "Wed", day_thu: "Thu", day_fri: "Fri" },
        null,
        2,
      ),
      "public/locales/es.json": JSON.stringify(
        { day_sun: "Dom", day_mon: "Lun", day_tue: "Mar", day_wed: "Mié", day_thu: "Jue", day_fri: "Vie" },
        null,
        2,
      ),
      "src/Calendar.ts":
        'export const header = (t: (k: string) => string, d: string) => t(`day_${d}`);\n',
    });

    await scaffold(unregisteredDir, {
      ...LOCALES,
      "src/App.ts":
        'export const label = (t: (k: string) => string, x: string) => t(`app_${x}Thing`);\n',
    });
  });

  afterAll(async () => {
    for (const dir of [
      cleanDir,
      missingDir,
      dynamicOkDir,
      dynamicMissingDir,
      unregisteredDir,
    ]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes when every static t() key exists in en.json", () => {
    const r = runIn(cleanDir);
    expect(r.exitCode).toBe(0);
  });

  it("fails when a static t() key is missing from en.json", () => {
    const r = runIn(missingDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("app_ghost");
    expect(r.stderr).toContain("missing from en.json");
  });

  it("passes for a registered dynamic pattern whose keys exist", () => {
    const r = runIn(dynamicOkDir);
    expect(r.exitCode).toBe(0);
  });

  it("fails when a registered dynamic pattern expands to a missing key", () => {
    const r = runIn(dynamicMissingDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("day_sat");
    expect(r.stderr).toContain("missing from en.json");
  });

  it("fails on an unregistered dynamic key pattern", () => {
    const r = runIn(unregisteredDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("unregistered dynamic key pattern");
    expect(r.stderr).toContain("app_${x}Thing");
  });
});
