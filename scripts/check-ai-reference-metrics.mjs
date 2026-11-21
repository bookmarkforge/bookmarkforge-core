#!/usr/bin/env node
/** Validate real WebLLM calibration metrics against a named device profile. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { numericMetrics } from "./ai-performance-history.mjs";

const ROOT = process.cwd();
const DEFAULT_PROFILES = resolve(ROOT, "scripts/ai-reference-devices.json");

export function loadProfiles(path = DEFAULT_PROFILES) {
  if (!existsSync(path)) throw new Error(`[ai-reference] profiles file missing: ${path}`);
  const document = JSON.parse(readFileSync(path, "utf8"));
  if (document?.schema !== "bmf.ai-reference-devices/1" || !document.profiles) {
    throw new Error("[ai-reference] invalid profiles schema");
  }
  for (const [id, profile] of Object.entries(document.profiles)) {
    if (!Number.isFinite(profile.minDeviceMemoryGB) || profile.minDeviceMemoryGB < 0) {
      throw new Error(`[ai-reference] ${id}: invalid minDeviceMemoryGB`);
    }
    if (!profile.skipExpected && (!Number.isFinite(profile.firstSummaryLatencyMs) || profile.firstSummaryLatencyMs <= 0)) {
      throw new Error(`[ai-reference] ${id}: positive firstSummaryLatencyMs required`);
    }
  }
  return document.profiles;
}

export function extractMeasurements(report) {
  const entries = Array.isArray(report?.entries) ? report.entries : [report];
  return entries
    .map((entry) => entry?.metrics ?? entry)
    .filter((metrics) => numericMetrics(metrics).firstSummaryLatencyMs !== undefined);
}

export function evaluateReferenceMetrics(report, profile) {
  const measurements = extractMeasurements(report);
  if (measurements.length === 0) {
    return { ok: false, skipped: false, failures: ["no firstSummaryLatencyMs measurements found"], measurements: [] };
  }
  const failures = [];
  const results = measurements.map((metrics, index) => {
    const device = metrics.device ?? {};
    const memory = Number(device.deviceMemoryGB ?? device.deviceMemory ?? 0);
    const hardware = device.webgpu === true && !device.software;
    const latency = numericMetrics(metrics).firstSummaryLatencyMs;
    const skipReason = profile.skipExpected
      ? "profile is expected to skip local AI"
      : memory < profile.minDeviceMemoryGB
        ? `device memory ${memory}GB is below ${profile.minDeviceMemoryGB}GB`
        : profile.requireHardwareWebGPU && !hardware
          ? "hardware WebGPU adapter is required"
          : null;
    const skipped = Boolean(skipReason);
    if (!skipped && latency > profile.firstSummaryLatencyMs) {
      failures.push(`measurement ${index + 1}: ${latency}ms exceeds ${profile.firstSummaryLatencyMs}ms`);
    }
    if (profile.skipExpected && !skipped) {
      failures.push(`measurement ${index + 1}: unsupported profile unexpectedly produced a reference result`);
    }
    return { latency, memory, hardwareWebGPU: hardware, skipped, skipReason };
  });
  const comparable = results.filter((result) => !result.skipped);
  return {
    ok: failures.length === 0 && (profile.skipExpected || comparable.length > 0),
    skipped: comparable.length === 0,
    failures: comparable.length === 0 && !profile.skipExpected
      ? [...failures, "all measurements skipped; no reference-device evidence"]
      : failures,
    measurements: results,
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const metricsPath = option("--metrics");
  const profileId = option("--profile") ?? "desktop-reference";
  if (!metricsPath || !existsSync(metricsPath)) throw new Error("[ai-reference] --metrics file is required");
  const profiles = loadProfiles();
  const profile = profiles[profileId];
  if (!profile) throw new Error(`[ai-reference] unknown profile: ${profileId}`);
  const result = evaluateReferenceMetrics(JSON.parse(readFileSync(metricsPath, "utf8")), profile);
  for (const measurement of result.measurements) {
    console.log(`[ai-reference] ${measurement.skipped ? "SKIP" : "PASS"} latency=${measurement.latency}ms memory=${measurement.memory}GB hardwareWebGPU=${measurement.hardwareWebGPU}`);
  }
  if (result.failures.length) {
    for (const failure of result.failures) console.error(`[ai-reference] FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`[ai-reference] pass profile=${profileId}${result.skipped ? " (expected skip)" : ""}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
