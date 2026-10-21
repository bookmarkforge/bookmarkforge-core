import { describe, expect, it } from "vitest";
import {
  EMBEDDING_MODEL_DIMENSIONS,
  EMBEDDING_MODEL_DTYPE,
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_PIPELINE_OPTIONS,
  EMBEDDING_MODEL_VARIANTS,
} from "./embeddingModel";

describe("embedding model contract", () => {
  it("keeps q8 as the explicit production baseline", () => {
    expect(EMBEDDING_MODEL_ID).toBe("Xenova/all-MiniLM-L6-v2");
    expect(EMBEDDING_MODEL_DIMENSIONS).toBe(384);
    expect(EMBEDDING_MODEL_DTYPE).toBe("q8");
    expect(EMBEDDING_MODEL_PIPELINE_OPTIONS).toEqual({ dtype: "q8" });
    expect(EMBEDDING_MODEL_VARIANTS.baseline.dtype).toBe("q8");
    expect(EMBEDDING_MODEL_VARIANTS.baseline.file).toBe(
      "onnx/model_quantized.onnx",
    );
  });

  it("keeps uint8 evaluation-only and records its measured size delta", () => {
    const { baseline, candidate } = EMBEDDING_MODEL_VARIANTS;
    const reduction = (baseline.bytes - candidate.bytes) / baseline.bytes;

    expect(candidate.dtype).toBe("uint8");
    expect(candidate.file).toBe("onnx/model_uint8.onnx");
    expect(candidate.bytes).toBeLessThan(baseline.bytes);
    // The smaller artifact saves less than 1%; quality, not this marginal
    // download reduction, must decide whether it is promoted.
    expect(reduction).toBeGreaterThan(0);
    expect(reduction).toBeLessThan(0.01);
  });
});
