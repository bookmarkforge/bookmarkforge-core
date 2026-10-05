import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateId } from "../../utils/id";

describe("generateId", () => {
  let originalCrypto: any;

  beforeEach(() => {
    originalCrypto = globalThis.crypto;
  });

  afterEach(() => {
    // Restore original crypto
    if (originalCrypto) {
      vi.stubGlobal("crypto", originalCrypto);
    } else {
      vi.unstubAllGlobals();
    }
  });

  it("should use crypto.randomUUID when available", () => {
    const mockUUID = "12345678-1234-1234-1234-123456789abc";

    vi.stubGlobal("crypto", {
      randomUUID: () => mockUUID,
    } as any);

    const id = generateId();
    expect(id).toBe(mockUUID);
  });

  it("should fall back to fallbackUUID when crypto.randomUUID is not available", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    } as any);

    const id = generateId();

    // Should be a valid UUID v4 format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });

  it("should throw when crypto is undefined", () => {
    vi.unstubAllGlobals();
    delete (globalThis as any).crypto;

    expect(() => generateId()).toThrow("CRYPTO_UNAVAILABLE: crypto.getRandomValues is required for generateId");
  });

  it("should throw when crypto.getRandomValues is not available", () => {
    vi.stubGlobal("crypto", {} as any);

    expect(() => generateId()).toThrow("CRYPTO_UNAVAILABLE: crypto.getRandomValues is required for generateId");
  });

  it("should generate unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    // All IDs should be unique
    expect(ids.size).toBe(100);
  });
});
