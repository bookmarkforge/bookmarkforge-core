import { describe, it, expect } from "vitest";
import { PRIORITY_DELAYS } from "../../../components/streaming-hydration/constants";

describe("PRIORITY_DELAYS", () => {
  it("defines a delay for every hydration priority", () => {
    expect(Object.keys(PRIORITY_DELAYS).sort()).toEqual([
      "critical",
      "high",
      "idle",
      "low",
      "medium",
    ]);
  });

  it("schedules critical hydration immediately", () => {
    expect(PRIORITY_DELAYS.critical).toBe(0);
  });

  it("orders delays from most to least urgent", () => {
    expect(PRIORITY_DELAYS.critical).toBeLessThan(PRIORITY_DELAYS.high);
    expect(PRIORITY_DELAYS.high).toBeLessThan(PRIORITY_DELAYS.medium);
    expect(PRIORITY_DELAYS.medium).toBeLessThan(PRIORITY_DELAYS.low);
    expect(PRIORITY_DELAYS.low).toBeLessThan(PRIORITY_DELAYS.idle);
  });

  it("keeps delays as non-negative finite numbers", () => {
    for (const [name, delay] of Object.entries(PRIORITY_DELAYS)) {
      expect(Number.isFinite(delay), `${name} is finite`).toBe(true);
      expect(delay, `${name} is non-negative`).toBeGreaterThanOrEqual(0);
    }
  });
});
