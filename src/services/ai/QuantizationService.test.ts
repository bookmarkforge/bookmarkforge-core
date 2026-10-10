import { describe, it, expect } from "vitest";
import { QuantizationService } from "./QuantizationService";

describe("QuantizationService", () => {
  describe("generateRotationMatrix", () => {
    it("returns a matrix of dim*dim length", () => {
      const matrix = QuantizationService.generateRotationMatrix(4);
      expect(matrix).toBeInstanceOf(Float32Array);
      expect(matrix.length).toBe(16);
    });

    it("produces deterministic output for the same seed", () => {
      const m1 = QuantizationService.generateRotationMatrix(8, 42);
      const m2 = QuantizationService.generateRotationMatrix(8, 42);
      expect(Array.from(m1)).toEqual(Array.from(m2));
    });

    it("produces different output for different seeds", () => {
      const m1 = QuantizationService.generateRotationMatrix(8, 42);
      const m2 = QuantizationService.generateRotationMatrix(8, 99);
      expect(Array.from(m1)).not.toEqual(Array.from(m2));
    });

    it("normalizes rows to unit length", () => {
      const dim = 4;
      const matrix = QuantizationService.generateRotationMatrix(dim, 42);
      for (let i = 0; i < dim; i++) {
        let norm = 0;
        for (let j = 0; j < dim; j++) {
          norm += matrix[i * dim + j]! * matrix[i * dim + j]!;
        }
        expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5);
      }
    });
  });

  describe("quantizePolar8", () => {
    it("returns data and scale", () => {
      const vector = [1, 2, 3, 4, 5, 6, 7, 8];
      const matrix = QuantizationService.generateRotationMatrix(8);
      const result = QuantizationService.quantizePolar8(vector, matrix);
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data.length).toBe(8);
      expect(typeof result.scale).toBe("number");
      expect(result.scale).toBeGreaterThan(0);
    });

    it("handles zero vector", () => {
      const vector = [0, 0, 0, 0];
      const matrix = QuantizationService.generateRotationMatrix(4);
      const result = QuantizationService.quantizePolar8(vector, matrix);
      expect(result.scale).toBe(1);
      // All values should be near the midpoint (128)
      for (const val of result.data) {
        expect(val).toBeGreaterThanOrEqual(120);
        expect(val).toBeLessThanOrEqual(136);
      }
    });

    it("output values are in valid uint8 range", () => {
      const vector = [10, -5, 3.14, -2.7, 0, 100, -100, 0.5];
      const matrix = QuantizationService.generateRotationMatrix(8);
      const result = QuantizationService.quantizePolar8(vector, matrix);
      for (const val of result.data) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(255);
      }
    });
  });

  describe("quantizePolar4", () => {
    it("returns data at half the vector length", () => {
      const vector = [1, 2, 3, 4, 5, 6, 7, 8];
      const matrix = QuantizationService.generateRotationMatrix(8);
      const result = QuantizationService.quantizePolar4(vector, matrix);
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data.length).toBe(4); // half of 8
      // Note: quantizePolar4 (direct) does not set originalLength;
      // only the quantize() dispatcher does. This is intentional.
    });

    it("handles odd-length vectors", () => {
      const vector = [1, 2, 3, 4, 5];
      const matrix = QuantizationService.generateRotationMatrix(5);
      const result = QuantizationService.quantizePolar4(vector, matrix);
      expect(result.data.length).toBe(3); // ceil(5/2)
    });
  });

  describe("dequantizePolar8", () => {
    it("returns a Float32Array of the specified dimension", () => {
      const dim = 8;
      const data = new Uint8Array(dim).fill(128);
      const result = QuantizationService.dequantizePolar8(data, 1, dim);
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(dim);
    });

    it("round-trips through quantize and dequantize preserving magnitude", () => {
      const dim = 8;
      const vector = [0.5, -0.3, 0.8, -0.1, 0.2, -0.7, 0.4, -0.6];
      const matrix = QuantizationService.generateRotationMatrix(dim);
      const { data, scale } = QuantizationService.quantizePolar8(
        vector,
        matrix,
      );
      const reconstructed = QuantizationService.dequantizePolar8(
        data,
        scale,
        dim,
      );

      // Due to quantization loss and inverse rotation, exact round-trip is not
      // guaranteed. Instead, verify the L2 norm is roughly preserved.
      const origNorm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
      const reconNorm = Math.sqrt(
        Array.from(reconstructed).reduce((s, v) => s + v * v, 0),
      );
      expect(reconNorm).toBeGreaterThan(0);
      // Within 50% of original magnitude
      expect(reconNorm).toBeLessThan(origNorm * 1.5);
      expect(reconNorm).toBeGreaterThan(origNorm * 0.5);
    });
  });

  describe("quantize (dispatch)", () => {
    it("returns quantized vector with polar8 mode", () => {
      const vector = [1, 2, 3, 4, 5, 6, 7, 8];
      const result = QuantizationService.quantize(vector, "polar8");
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.scale).toBeDefined();
      expect(result.id).toMatch(/^q_/);
    });

    it("returns quantized vector with polar4 mode", () => {
      const vector = [1, 2, 3, 4, 5, 6, 7, 8];
      const result = QuantizationService.quantize(vector, "polar4");
      expect(result.data.length).toBe(4);
      expect(result.originalLength).toBe(8);
    });

    it("returns quantized vector with none mode", () => {
      const vector = [0.5, -0.5, 1.0, -1.0];
      const result = QuantizationService.quantize(vector, "none");
      expect(result.data).toBeInstanceOf(Uint8Array);
      expect(result.data.length).toBe(4);
      expect(result.scale).toBeUndefined();
    });

    it("defaults to none mode", () => {
      const vector = [1, 2, 3];
      const result = QuantizationService.quantize(vector);
      expect(result.data.length).toBe(3);
    });

    it("generates unique IDs for each call", () => {
      const vector = [1, 2, 3];
      const r1 = QuantizationService.quantize(vector, "none");
      const r2 = QuantizationService.quantize(vector, "none");
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe("decompress", () => {
    it("decompresses polar8 quantized vector", () => {
      const vector = [0.5, -0.3, 0.8, -0.1, 0.2, -0.7, 0.4, -0.6];
      const matrix = QuantizationService.generateRotationMatrix(8);
      const { data, scale } = QuantizationService.quantizePolar8(
        vector,
        matrix,
      );
      const result = QuantizationService.decompress({
        id: "test",
        title: "",
        url: "",
        data,
        scale,
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(8);
    });

    it("decompresses none mode vector", () => {
      const vector = [0.5, -0.5, 1.0];
      const quantized = QuantizationService.quantize(vector, "none");
      const result = QuantizationService.decompress(quantized);
      expect(result.length).toBe(3);
      // Approximate round-trip
      for (let i = 0; i < 3; i++) {
        expect(result[i]).toBeCloseTo(vector[i]!, 0);
      }
    });

    it("decompresses polar4 vector by unpacking nibbles (audit #3)", () => {
      const vector = [0.5, -0.3, 0.8, -0.1, 0.2, -0.7, 0.4, -0.6];
      const quantized = QuantizationService.quantize(vector, "polar4");
      expect(quantized.data.length).toBe(4); // 2 nibbles por byte

      const result = QuantizationService.decompress(quantized);
      expect(result).toHaveLength(8);

      // The L2 norm must be preserved approximately after quantizing to 4 bits;
      // before the fix, decompressing with dequantizePolar8 corrupted the vector.
      const origNorm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
      const reconNorm = Math.sqrt(result.reduce((s, v) => s + v * v, 0));
      expect(reconNorm).toBeGreaterThan(origNorm * 0.5);
      expect(reconNorm).toBeLessThan(origNorm * 1.5);
    });
  });
});
