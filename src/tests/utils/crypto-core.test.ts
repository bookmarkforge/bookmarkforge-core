import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock argon2-kdf since it requires WebAssembly
vi.mock("../../utils/argon2-kdf", () => ({
  deriveArgon2idAesKey: vi.fn(),
  deriveArgon2idHkdfBaseKey: vi.fn(),
  deriveArgon2idKey: vi.fn(),
}));

import { generateSecureSalt } from "../../utils/crypto-core";

describe("generateSecureSalt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate a 64-character hex string", () => {
    const salt = generateSecureSalt();
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should generate unique salts", () => {
    const salts = new Set<string>();
    for (let i = 0; i < 50; i++) {
      salts.add(generateSecureSalt());
    }
    expect(salts.size).toBe(50);
  });
});
