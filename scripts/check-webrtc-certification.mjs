#!/usr/bin/env node
/**
 * Verify that every browser declared certified by the compatibility matrix
 * actually exercised the real WebRTC contract in the Playwright report.
 *
 * This is intentionally separate from the ordinary `check` chain: it consumes
 * a nightly artifact and belongs to the nightly certification workflow.
 * A missing report, missing certified project, skipped contract test, or
 * failed final attempt is a hard failure.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const DEFAULT_MATRIX_PATH = "docs/WEBRTC-COMPATIBILITY.md";
export const DEFAULT_REPORT_PATH = "playwright-report-nightly/results.json";
export const CONTRACT_FILE = "vault-sync-real.spec.ts";

function normalize(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

/**
 * Extract certified Playwright project names from the maintained matrix.
 * The exact `**Certified**` token is used so rows marked "not certified" or
 * "failed ..." cannot accidentally become required projects.
 */
export function parseCertifiedProjects(markdown) {
  const projects = [];
  for (const line of String(markdown).split(/\r?\n/)) {
    if (!line.trim().startsWith("|") || !/\|.*\|.*\|.*\|/.test(line)) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 4 || !/^\*\*Certified\*\*(?:\s|$)/.test(cells[3])) continue;
    const browser = cells[0].toLowerCase();
    const project = browser.includes("chrom")
      ? "chromium"
      : browser.includes("firefox")
        ? "firefox"
        : browser.includes("webkit") || browser.includes("safari")
          ? "webkit"
          : null;
    if (project && !projects.includes(project)) projects.push(project);
  }
  return projects;
}

function contractTests(suites, output = [], inheritedFile = "") {
  for (const suite of suites ?? []) {
    const suiteFile = normalize(suite.file ?? inheritedFile);
    for (const spec of suite.specs ?? []) {
      const specFile = normalize(spec.file ?? suiteFile);
      for (const test of spec.tests ?? []) {
        const file = normalize(
          specFile || test.location?.file || test.file || inheritedFile,
        );
        if (!file.endsWith(CONTRACT_FILE)) continue;
        const attempts = test.results ?? [];
        const statuses = attempts.map((result) => result.status);
        const fallbackStatus = test.status === "skipped" ? "skipped" : null;
        const finalStatus = statuses.at(-1) ?? fallbackStatus ?? "missing";
        output.push({
          project: test.projectName ?? test.project?.name ?? "unknown",
          title: [spec.title, test.title].filter(Boolean).join(" — "),
          finalStatus,
          statuses,
          attempts: attempts.length,
          file,
        });
      }
    }
    contractTests(suite.suites, output, suiteFile);
  }
  return output;
}

/**
 * Evaluate a Playwright JSON report against the certified project list.
 * `matrixText` may be supplied to derive the list, while tests can pass
 * `certifiedProjects` directly for focused in-memory fixtures.
 */
export function evaluateWebRtcCertification({
  report,
  matrixText = "",
  certifiedProjects = parseCertifiedProjects(matrixText),
}) {
  const required = [...new Set(certifiedProjects)];
  const tests = contractTests(report?.suites);
  const projects = required.map((project) => {
    const matching = tests.filter((test) => test.project === project);
    // The final attempt decides the outcome: a skipped intermediate attempt
    // followed by a passed retry is a pass, and a failed final attempt is a
    // failure even when an earlier attempt was skipped. Counting any attempt
    // that was ever skipped as "skipped" would mask final failures and
    // inflate the passed/skipped metrics (e.g. attempts [skipped, failed]).
    const passed = matching.filter((test) => test.finalStatus === "passed");
    const skipped = matching.filter((test) => test.finalStatus === "skipped");
    const failed = matching.filter(
      (test) => test.finalStatus !== "passed" && test.finalStatus !== "skipped",
    );
    const issues = [];
    if (matching.length === 0) {
      issues.push("contract spec coverage absent");
    } else {
      if (skipped.length > 0) issues.push(`${skipped.length} contract spec(s) skipped`);
      if (failed.length > 0) {
        issues.push(
          `${failed.length} contract spec(s) failed or did not finish passed`,
        );
      }
    }
    return {
      project,
      contractTests: matching.length,
      passed: passed.length,
      skipped: skipped.length,
      failed: failed.length,
      ok: issues.length === 0,
      issues,
      failures: failed.map((test) => ({ title: test.title, status: test.finalStatus })),
    };
  });

  const failures = projects
    .filter((project) => !project.ok)
    .flatMap((project) =>
      project.issues.map((issue) => `${project.project}: ${issue}`),
    );
  return {
    ok: required.length > 0 && failures.length === 0,
    certifiedProjects: required,
    projects,
    contractTests: tests.length,
    failures: required.length === 0 ? ["no certified browser projects declared"] : failures,
  };
}

function main() {
  const matrixPath = resolve(
    process.env.WEBRTC_COMPATIBILITY_MATRIX ?? DEFAULT_MATRIX_PATH,
  );
  const reportPath = resolve(
    process.env.WEBRTC_PLAYWRIGHT_REPORT ?? DEFAULT_REPORT_PATH,
  );
  if (!existsSync(matrixPath)) {
    console.error(`[check-webrtc-certification] FAIL matrix missing: ${matrixPath}`);
    process.exit(1);
  }
  if (!existsSync(reportPath)) {
    console.error(`[check-webrtc-certification] FAIL Playwright report missing: ${reportPath}`);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    console.error(
      `[check-webrtc-certification] FAIL invalid Playwright report: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  const result = evaluateWebRtcCertification({
    report,
    matrixText: readFileSync(matrixPath, "utf8"),
  });
  console.log(JSON.stringify(result, null, 2));
  for (const failure of result.failures) {
    console.error(`[check-webrtc-certification] FAIL ${failure}`);
  }
  if (!result.ok) {
    console.error(
      "[check-webrtc-certification] certified browsers require non-skipped, passed WebRTC contract coverage",
    );
    process.exit(1);
  }
  console.log(
    `[check-webrtc-certification] ok — ${result.certifiedProjects.join(", ")} certified project(s) covered by ${result.contractTests} contract test result(s)`,
  );
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
