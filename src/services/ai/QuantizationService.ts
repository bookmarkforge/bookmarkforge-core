import { logger } from "../../utils/logger";

export type QuantizationMode = "none" | "polar8" | "polar4" | "qjl";

export interface QuantizedVector {
  id: string;
  title: string;
  url: string;
  data: Uint8Array;
  scale?: number;
  originalLength?: number;
}

export class QuantizationService {
  private static LCG_A = 1664525;
  private static LCG_C = 1013904223;
  private static LCG_M = 4294967296;

  // Memoize rotation matrices by (dim, seed) — avoids O(dim²) allocation
  // on every dequantize call (critical for polar4/polar8 per-chunk).
  private static matrixCache = new Map<string, Float32Array>();

  public static generateRotationMatrix(
    dim: number,
    seed: number = 42,
  ): Float32Array {
    const key = `${dim}:${seed}`;
    const cached = QuantizationService.matrixCache.get(key);
    if (cached) {return cached;}

    const matrix = new Float32Array(dim * dim);
    let state = seed;

    for (let i = 0; i < dim * dim; i++) {
      state =
        (QuantizationService.LCG_A * state + QuantizationService.LCG_C) %
        QuantizationService.LCG_M;
      matrix[i] = (state / QuantizationService.LCG_M) * 2 - 1;
    }

    for (let i = 0; i < dim; i++) {
      let norm = 0;
      for (let j = 0; j < dim; j++) {
        const val = matrix[i * dim + j] ?? 0;
        norm += val * val;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let j = 0; j < dim; j++) {
          matrix[i * dim + j] = (matrix[i * dim + j] ?? 0) / norm;
        }
      }
    }

    QuantizationService.matrixCache.set(key, matrix);
    return matrix;
  }

  private static rotateVector(
    vector: number[] | Float32Array,
    matrix: Float32Array,
  ): Float32Array {
    const dim = vector.length;
    const rotated = new Float32Array(dim);

    for (let i = 0; i < dim; i++) {
      let sum = 0;
      const rowOffset = i * dim;
      for (let j = 0; j < dim; j++) {
        sum += (vector[j] ?? 0) * (matrix[rowOffset + j] ?? 0);
      }
      rotated[i] = sum;
    }
    return rotated;
  }

  static quantizePolar8(
    vector: number[] | Float32Array,
    matrix: Float32Array,
  ): { data: Uint8Array; scale: number } {
    const rotated = this.rotateVector(vector, matrix);
    let maxAbs = 0;
    for (const val of rotated) {
      const abs = Math.abs(val ?? 0);
      if (abs > maxAbs) {maxAbs = abs;}
    }

    const scale = maxAbs === 0 ? 1 : maxAbs;
    const data = new Uint8Array(rotated.length);

    for (let i = 0; i < rotated.length; i++) {
      const normalized = ((rotated[i] ?? 0) / scale + 1) / 2;
      data[i] = Math.round(normalized * 255);
    }

    return { data, scale };
  }

  static quantizePolar4(
    vector: number[] | Float32Array,
    matrix: Float32Array,
  ): { data: Uint8Array; scale: number } {
    const rotated = this.rotateVector(vector, matrix);
    let maxAbs = 0;
    for (const val of rotated) {
      const abs = Math.abs(val ?? 0);
      if (abs > maxAbs) {maxAbs = abs;}
    }

    const scale = maxAbs === 0 ? 1 : maxAbs;
    const data = new Uint8Array(Math.ceil(rotated.length / 2));

    for (let i = 0; i < rotated.length; i += 2) {
      const v1 = ((rotated[i] ?? 0) / scale + 1) / 2;
      const v2 =
        i + 1 < rotated.length ? ((rotated[i + 1] ?? 0) / scale + 1) / 2 : 0;
      data[Math.floor(i / 2)] =
        (Math.round(v1 * 15) << 4) | Math.round(v2 * 15);
    }

    return { data, scale };
  }

  static dequantizePolar8(
    data: Uint8Array,
    scale: number,
    dim: number,
  ): Float32Array {
    const rotated = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      rotated[i] = (((data[i] ?? 0) / 255) * 2 - 1) * scale;
    }

    const matrix = this.generateRotationMatrix(dim);
    const original = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      let sum = 0;
      for (let j = 0; j < dim; j++) {
        sum += (rotated[j] ?? 0) * (matrix[i * dim + j] ?? 0);
      }
      original[i] = sum;
    }
    return original;
  }

  /**
   * CRITICAL (audit #3): inverse of quantizePolar4. Each byte packs TWO
   * 4-bit nibbles (even index → high nibble, odd index → low nibble);
   * dequantizePolar8 must NOT be used here (it reads one value per byte).
   */
  static dequantizePolar4(
    data: Uint8Array,
    scale: number,
    dim: number,
  ): Float32Array {
    const rotated = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      const byte = data[Math.floor(i / 2)] ?? 0;
      const nib = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
      rotated[i] = ((nib / 15) * 2 - 1) * scale;
    }

    const matrix = this.generateRotationMatrix(dim);
    const original = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      let sum = 0;
      for (let j = 0; j < dim; j++) {
        sum += (rotated[j] ?? 0) * (matrix[i * dim + j] ?? 0);
      }
      original[i] = sum;
    }
    return original;
  }

  static quantize(
    vector: number[],
    mode: QuantizationMode = "none",
  ): QuantizedVector {
    const id = `q_${Date.now()}_${crypto.randomUUID()}`;

    switch (mode) {
      case "polar8": {
        const float32 = new Float32Array(vector);
        const matrix = this.generateRotationMatrix(vector.length);
        const { data, scale } = this.quantizePolar8(float32, matrix);
        return { id, title: "", url: "", data, scale };
      }
      case "polar4": {
        const float32 = new Float32Array(vector);
        const matrix = this.generateRotationMatrix(vector.length);
        const { data, scale } = this.quantizePolar4(float32, matrix);
        return {
          id,
          title: "",
          url: "",
          data,
          scale,
          originalLength: vector.length,
        };
      }
      default: {
        const data = new Uint8Array(vector.length);
        for (let i = 0; i < vector.length; i++) {
          data[i] = Math.round((vector[i] ?? 0) * 127 + 128);
        }
        return { id, title: "", url: "", data };
      }
    }
  }

  static decompress(vector: QuantizedVector): number[] {
    const _id = vector.id;
    const data = vector.data;
    const scale = vector.scale ?? 1;
    const dim = vector.originalLength ?? data.length;

    if (vector.scale !== undefined) {
      // Only quantize(..., "polar4") sets originalLength; polar8 never does.
      // That flag is the exact signal of nibble packing (2 per byte) — more
      // reliable than comparing lengths, which would fail in the degenerate
      // dim === 1 case (data.length === dim).
      const isPacked4Bit =
        vector.originalLength !== undefined && vector.originalLength > 0;
      const requiredBytes = Math.ceil(dim / 2);
      if (isPacked4Bit && data.length < requiredBytes) {
        // Each byte contains two 4-bit components. Never decode a truncated
        // vector as valid data; zero-filling would silently corrupt RAG.
        logger.warn(
          "[QuantizationService] dequantizePolar4: truncated data (dim " +
            dim +
            " requires " +
            requiredBytes +
            " bytes, got " +
            data.length +
            ") — vector rejected",
        );
        return [];
      }
      const rotated = isPacked4Bit
        ? this.dequantizePolar4(data, scale, dim)
        : this.dequantizePolar8(data, scale, dim);
      return Array.from(rotated);
    }
    return Array.from(data).map((v) => ((v ?? 0) - 128) / 127);
  }
}
