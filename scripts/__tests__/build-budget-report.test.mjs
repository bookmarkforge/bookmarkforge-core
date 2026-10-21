import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "..", "build-budget-report.mjs");

describe("build-budget-report", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "budget-report-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns status=skip when dist/ is missing", () => {
    // Run with ROOT set to a temp dir with no dist/
    const result = execSync(`node "${SCRIPT}" --json`, {
      encoding: "utf8",
      env: { ...process.env, BMF_ROOT: tmpDir },
      cwd: tmpDir,
    });
    const report = JSON.parse(result);
    expect(report.status).toBe("skip");
    expect(report.reason).toBe("dist/ not built");
    expect(report.distPresent).toBe(false);
  });

  it("returns status=pass when dist/ has assets within budget", () => {
    // Create a minimal dist/ that passes all budgets
    const distDir = join(tmpDir, "dist");
    const assetsDir = join(distDir, "assets");
    mkdirSync(assetsDir, { recursive: true });

    // Small entry chunk
    writeFileSync(join(assetsDir, "index-abc.js"), "console.log('entry');");
    // Small precache
    writeFileSync(join(assetsDir, "precache-1.js"), "console.log('precache');");
    // Small sw.js with precache list
    writeFileSync(
      join(distDir, "sw.js"),
      `const PRECACHE_URLS = ["assets/precache-1.js"];`,
    );
    // Small SecurityManager (unlock)
    writeFileSync(
      join(assetsDir, "SecurityManager-abc.js"),
      "console.log('unlock');");
    // Small MainApp
    writeFileSync(join(assetsDir, "MainApp-abc.js"), "console.log('main');");
    // Small index.html without budget config
    writeFileSync(join(distDir, "index.html"), "<html></html>");

    const result = execSync(`node "${SCRIPT}" --json`, {
      encoding: "utf8",
      env: { ...process.env, BMF_ROOT: tmpDir },
      cwd: tmpDir,
    });
    const report = JSON.parse(result);
    expect(report.status).toBe("pass");
    expect(report.distPresent).toBe(true);
    expect(report.static).toBeDefined();
    expect(report.chunks).toBeDefined();
    expect(report.browser).toBeDefined();
  });

  it("returns status=fail when a budget is exceeded", () => {
    // Create a dist/ that exceeds the entry budget
    const distDir = join(tmpDir, "dist");
    const assetsDir = join(distDir, "assets");
    mkdirSync(assetsDir, { recursive: true });

    // Entry chunk that exceeds 1.5 MB budget
    const largeContent = "x".repeat(2 * 1024 * 1024); // 2 MB
    writeFileSync(join(assetsDir, "index-abc.js"), largeContent);

    let result;
    try {
      result = execSync(`node "${SCRIPT}" --json`, {
        encoding: "utf8",
        env: { ...process.env, BMF_ROOT: tmpDir },
        cwd: tmpDir,
      });
    } catch (e) {
      // Script exits with code 1 on budget breach — parse stdout
      result = e.stdout;
    }
    const report = JSON.parse(result);
    expect(report.status).toBe("fail");
    expect(report.chunks.entry.actual).toBeGreaterThan(
      report.chunks.entry.budget,
    );
  });

  it("writes the report file when --write is used", () => {
    const distDir = join(tmpDir, "dist");
    const assetsDir = join(distDir, "assets");
    mkdirSync(assetsDir, { recursive: true });

    // Minimal valid dist
    writeFileSync(join(assetsDir, "index-abc.js"), "x");
    writeFileSync(join(distDir, "index.html"), "<html></html>");

    const reportsDir = join(distDir, "reports");
    execSync(`node "${SCRIPT}" --write`, {
      encoding: "utf8",
      env: { ...process.env, BMF_ROOT: tmpDir },
      cwd: tmpDir,
    });

    const { existsSync, readFileSync } = require("node:fs");
    expect(existsSync(join(reportsDir, "budget-report.json"))).toBe(true);

    const report = JSON.parse(
      readFileSync(join(reportsDir, "budget-report.json"), "utf8"),
    );
    expect(report.generated).toBeDefined();
    expect(report.status).toBeDefined();
  });

  it("prints human-readable output without --json", () => {
    const distDir = join(tmpDir, "dist");
    const assetsDir = join(distDir, "assets");
    mkdirSync(assetsDir, { recursive: true });

    writeFileSync(join(assetsDir, "index-abc.js"), "x");
    writeFileSync(join(distDir, "index.html"), "<html></html>");

    const stdout = execSync(`node "${SCRIPT}"`, {
      encoding: "utf8",
      env: { ...process.env, BMF_ROOT: tmpDir },
      cwd: tmpDir,
    });

    expect(stdout).toContain("Budget report");
    expect(stdout).toContain("Static");
    expect(stdout).toContain("Chunks");
    expect(stdout).toContain("Browser");
  });

  it("reports --json output with all required fields", () => {
    const distDir = join(tmpDir, "dist");
    const assetsDir = join(distDir, "assets");
    mkdirSync(assetsDir, { recursive: true });

    writeFileSync(join(assetsDir, "index-abc.js"), "x");
    writeFileSync(join(distDir, "index.html"), "<html></html>");

    const result = execSync(`node "${SCRIPT}" --json`, {
      encoding: "utf8",
      env: { ...process.env, BMF_ROOT: tmpDir },
      cwd: tmpDir,
    });
    const report = JSON.parse(result);

    expect(report.generated).toBeDefined();
    expect(report.status).toBeDefined();
    expect(report.static).toBeDefined();
    expect(report.static.entry).toBeDefined();
    expect(report.static.entry.budget).toBeGreaterThan(0);
    expect(report.static.entry.unit).toBe("bytes");
    expect(report.chunks).toBeDefined();
    expect(report.chunks.entry).toBeDefined();
    expect(report.chunks.unlock).toBeDefined();
    expect(report.chunks.mainApp).toBeDefined();
    expect(report.chunks.precache).toBeDefined();
    expect(report.chunks.ortWasm).toBeDefined();
    expect(report.browser).toBeDefined();
    expect(report.browser.firstInteraction).toBeDefined();
    expect(report.browser.firstInteraction.unit).toBe("ms");
  });
});
