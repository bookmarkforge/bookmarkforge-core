import { describe, it, expect } from "vitest";
import { QuantizationService } from "../../../services/ai/QuantizationService";
import type { QuantizationMode } from "../../../services/ai/QuantizationService";

describe("QuantizationService", () => {
  describe("generateRotationMatrix", () => {
    it("generates a dim x dim matrix", () => {
      const matrix = QuantizationService.generateRotationMatrix(4);
      expect(matrix.length).toBe(16);
    });

    it("generates normalized rows", () => {
      const dim = 4;
      const matrix = QuantizationService.generateRotationMatrix(dim);
      for (let i = 0; i < dim; i++) {
        let norm = 0;
        for (let j = 0; j < dim; j++) {
          norm += (matrix[i * dim + j] ?? 0) ** 2;
        }
        expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
      }
    });

    it("produces the same matrix with the same seed", () => {
      const a = QuantizationService.generateRotationMatrix(8, 42);
      const b = QuantizationService.generateRotationMatrix(8, 42);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("produces a different matrix with a different seed", () => {
      const a = QuantizationService.generateRotationMatrix(8, 42);
      const b = QuantizationService.generateRotationMatrix(8, 99);
      expect(Array.from(a)).not.toEqual(Array.from(b));
    });
  });

  describe("quantizePolar8", () => {
    it("encodes the vector correctly", () => {
      const dim = 4;
      const matrix = QuantizationService.generateRotationMatrix(dim);
      const vector = [1.0, 0.5, -0.5, -1.0];
      const { data, scale } = QuantizationService.quantizePolar8(
        vector,
        matrix,
      );
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(dim);
      expect(scale).toBeGreaterThan(0);
    });

    it("handles all-zeros vector", () => {
      const dim = 4;
      const matrix = QuantizationService.generateRotationMatrix(dim);
      const { data, scale } = QuantizationService.quantizePolar8(
        [0, 0, 0, 0],
        matrix,
      );
      expect(scale).toBe(1);
      expect(data.every((b) => b === 128)).toBe(true);
    });
  });

  describe("quantizePolar4", () => {
    it("encodes in half the size", () => {
      const dim = 8;
      const matrix = QuantizationService.generateRotationMatrix(dim);
      const { data } = QuantizationService.quantizePolar4(
        [1, -1, 1, -1, 0.5, -0.5, 0.3, -0.3],
        matrix,
      );
      expect(data.length).toBe(4);
    });

    it("handles all-zeros vector", () => {
      const dim = 4;
      const matrix = QuantizationService.generateRotationMatrix(dim);
      const { scale } = QuantizationService.quantizePolar4(
        [0, 0, 0, 0],
        matrix,
      );
      expect(scale).toBe(1);
    });
  });

  describe("quantize", () => {
    const vector = [0.5, -0.3, 0.8, -0.1];

    it("quantiza modo none", () => {
      const result = QuantizationService.quantize(vector, "none");
      expect(result.id).toMatch(/^q_/);
      expect(result.data.length).toBe(vector.length);
      expect(result.scale).toBeUndefined();
    });

    it("quantiza modo polar8", () => {
      const result = QuantizationService.quantize(vector, "polar8");
      expect(result.data.length).toBe(vector.length);
      expect(result.scale).toBeDefined();
    });

    it("quantiza modo polar4", () => {
      const result = QuantizationService.quantize(vector, "polar4");
      expect(result.data.length).toBe(Math.ceil(vector.length / 2));
      expect(result.scale).toBeDefined();
      expect(result.originalLength).toBe(vector.length);
    });

    it("uses none by default", () => {
      const result = QuantizationService.quantize(vector);
      expect(result.scale).toBeUndefined();
    });

    it("generates a unique id each time", () => {
      const a = QuantizationService.quantize(vector);
      const b = QuantizationService.quantize(vector);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("decompress", () => {
    it("recovers quantized vector in none mode", () => {
      const original = [0.5, -0.3, 0.8];
      const q = QuantizationService.quantize(original, "none");
      const recovered = QuantizationService.decompress(q);
      expect(recovered.length).toBe(original.length);
      recovered.forEach((v, i) => {
        expect(v).toBeCloseTo(original[i]!, 1);
      });
    });

    it("recovers quantized polar8 vector", () => {
      const original = [0.5, -0.3, 0.8];
      const q = QuantizationService.quantize(original, "polar8");
      const recovered = QuantizationService.decompress(q);
      expect(recovered.length).toBe(original.length);
    });

    it("rejects a truncated polar4 buffer", () => {
      const vector = QuantizationService.quantize([0.5, -0.3, 0.8, -0.1], "polar4");
      vector.data = vector.data.slice(0, 1);
      expect(QuantizationService.decompress(vector)).toEqual([]);
    });

    it("recovers quantized polar4 vector (nibble unpacking, audit #3)", () => {
      const original = [0.5, -0.3, 0.8, -0.1, 0.2, -0.7, 0.4, -0.6];
      const q = QuantizationService.quantize(original, "polar4");
      const recovered = QuantizationService.decompress(q);
      expect(recovered.length).toBe(original.length);
      // Norma L2 aproximadamente preservada (4 bits por componente).
      const origNorm = Math.sqrt(original.reduce((s, v) => s + v * v, 0));
      const reconNorm = Math.sqrt(recovered.reduce((s, v) => s + v * v, 0));
      expect(reconNorm).toBeGreaterThan(origNorm * 0.5);
      expect(reconNorm).toBeLessThan(origNorm * 1.5);
    });
  });
});
