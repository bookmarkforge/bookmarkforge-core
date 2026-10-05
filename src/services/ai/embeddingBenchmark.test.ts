import { describe, expect, it } from "vitest";
import { compareEmbeddingQuality } from "./embeddingBenchmark";

const metrics = (recallAt3: number, meanReciprocalRank: number) => ({
  dtype: "q8" as const,
  dimensions: 384,
  recallAt3,
  meanReciprocalRank,
  queryCount: 12,
  documentCount: 12,
  elapsedMs: 100,
});

describe("embedding benchmark comparison", () => {
  it("reports quality deltas and model-size reduction", () => {
    const result = compareEmbeddingQuality(
      metrics(1, 0.95),
      { ...metrics(0.92, 0.9), dtype: "uint8" },
      22_972_370,
      22_845_806,
    );

    expect(result.recallDelta).toBeCloseTo(-0.08);
    expect(result.meanReciprocalRankDelta).toBeCloseTo(-0.05);
    expect(result.sizeReductionRatio).toBeCloseTo(0.0055094, 6);
  });
});
