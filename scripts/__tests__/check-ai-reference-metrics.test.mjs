import { describe, expect, it } from "vitest";
import { evaluateReferenceMetrics, loadProfiles } from "../check-ai-reference-metrics.mjs";

describe("check-ai-reference-metrics", () => {
  const profiles = loadProfiles();

  it("passes a desktop reference result within budget", () => {
    const result = evaluateReferenceMetrics({
      firstSummaryLatencyMs: 12_000,
      device: { deviceMemoryGB: 16, webgpu: true, software: false },
    }, profiles["desktop-reference"]);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("fails a real reference result over the profile budget", () => {
    const result = evaluateReferenceMetrics({
      firstSummaryLatencyMs: 30_001,
      device: { deviceMemoryGB: 8, webgpu: true, software: false },
    }, profiles["desktop-reference"]);
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("exceeds");
  });

  it("classifies a high-end mobile result with its mobile budget", () => {
    const result = evaluateReferenceMetrics({
      firstSummaryLatencyMs: 40_000,
      device: { deviceMemoryGB: 8, webgpu: true, software: false },
    }, profiles["mobile-reference"]);
    expect(result.ok).toBe(true);
  });

  it("reports an expected skip below the local-AI floor", () => {
    const result = evaluateReferenceMetrics({
      firstSummaryLatencyMs: 0,
      device: { deviceMemoryGB: 4, webgpu: false, software: true },
    }, profiles["unsupported-mobile"]);
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("accepts calibration sidecars with multiple entries", () => {
    const result = evaluateReferenceMetrics({
      entries: [
        { metrics: { firstSummaryLatencyMs: 10_000, device: { deviceMemoryGB: 8, webgpu: true } } },
        { metrics: { firstSummaryLatencyMs: 11_000, device: { deviceMemoryGB: 8, webgpu: true } } },
      ],
    }, profiles["desktop-reference"]);
    expect(result.measurements).toHaveLength(2);
    expect(result.ok).toBe(true);
  });
});
