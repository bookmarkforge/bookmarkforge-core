import { describe, expect, it } from "vitest";

// Importa el script como módulo ESM (side-effect free en import) y expone las
// funciones puras que orquestan el drill.
const script = await import("../../scripts/drill-backup-restore.mjs");

describe("drill-backup-restore: gate RTO", () => {
  it("accepts restore times under the RTO gate", () => {
    const result = script.isRestoreWithinRto(99_000, 120_000);
    expect(result).toBe(true);
  });

  it("rejects restore times at or above the RTO gate", () => {
    expect(script.isRestoreWithinRto(120_000, 120_000)).toBe(false);
    expect(script.isRestoreWithinRto(180_000, 120_000)).toBe(false);
  });

  it("treats a missing mark as a failed gate (restore never measured)", () => {
    expect(script.isRestoreWithinRto(undefined, 120_000)).toBe(false);
  });
});

describe("drill-backup-restore: RTO degradation warning", () => {
  const gate = 120_000;
  const warn = 108_000;

  it("is not degraded when within the gate and below the warn threshold", () => {
    expect(script.isRestoreDegraded(80_000, gate, warn)).toBe(false);
    expect(script.isRestoreDegraded(warn - 1, gate, warn)).toBe(false);
  });

  it("is degraded when passing the gate but at/above the warn threshold", () => {
    expect(script.isRestoreDegraded(warn, gate, warn)).toBe(true);
    expect(script.isRestoreDegraded(115_000, gate, warn)).toBe(true);
  });

  it("is not degraded when violating the gate (that is a hard failure, not a warning)", () => {
    expect(script.isRestoreDegraded(gate, gate, warn)).toBe(false);
    expect(script.isRestoreDegraded(180_000, gate, warn)).toBe(false);
  });

  it("never flags degraded when the warn threshold is disabled (warnMs 0)", () => {
    expect(script.isRestoreDegraded(110_000, gate, 0)).toBe(false);
    expect(script.isRestoreDegraded(115_000, gate, 0)).toBe(false);
  });

  it("handles a missing mark as not degraded (gate already fails it)", () => {
    expect(script.isRestoreDegraded(undefined, gate, warn)).toBe(false);
    expect(script.isRestoreDegraded(NaN, gate, warn)).toBe(false);
  });
});