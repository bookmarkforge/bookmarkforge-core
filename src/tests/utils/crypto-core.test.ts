import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock argon2-kdf since it requires WebAssembly
vi.mock("../../utils/argon2-kdf", () => ({
  deriveArgon2idAesKey: vi.fn(),
  deriveArgon2idHkdfBaseKey: vi.fn(),
  deriveArgon2idKey: vi.fn(),
}));

import {
  LegacyV5FormatRemovedError,
  generateSecureSalt,
  isLegacyV5FormatRemovedError,
} from "../../utils/crypto-core";

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

// ADR-052 Phase 3: the retired-v5 refusal must be TYPED and ACTIONABLE — a
// caller has to tell it apart from a wrong password (retrying cannot help) and
// the message has to name the remedy.
describe("LegacyV5FormatRemovedError", () => {
  it("carries a stable code for boundary crossings", () => {
    const error = new LegacyV5FormatRemovedError();
    expect(error.name).toBe("LegacyV5FormatRemovedError");
    expect(LegacyV5FormatRemovedError.CODE).toBe("V5_LEGACY_FORMAT_RETIRED");
    expect(error.code).toBe(LegacyV5FormatRemovedError.CODE);
    expect(error.message).toContain(`[${LegacyV5FormatRemovedError.CODE}]`);
  });

  it("names both remedies and says the password is not the problem", () => {
    const message = new LegacyV5FormatRemovedError().message;
    expect(message).toContain("older release that still supports v5");
    expect(message).toContain("restore a backup exported by a current build");
    expect(message).toContain("Re-entering the password cannot help");
    expect(message).toContain("ADR-052");
  });

  it("keeps a caller-supplied detail for logs", () => {
    expect(
      new LegacyV5FormatRemovedError("secure-storage:verification").message,
    ).toContain("(secure-storage:verification)");
  });

  it("is recognised across name, code, message token and cause chains", () => {
    expect(isLegacyV5FormatRemovedError(new LegacyV5FormatRemovedError())).toBe(
      true,
    );
    // Worker round-trip: the class becomes a plain Error, the token survives.
    expect(
      isLegacyV5FormatRemovedError(
        new Error(`[${LegacyV5FormatRemovedError.CODE}] refused`),
      ),
    ).toBe(true);
    expect(
      isLegacyV5FormatRemovedError({ name: "LegacyV5FormatRemovedError" }),
    ).toBe(true);
    expect(
      isLegacyV5FormatRemovedError({ code: LegacyV5FormatRemovedError.CODE }),
    ).toBe(true);
    const wrapped = Object.assign(new Error("db init failed"), {
      cause: new LegacyV5FormatRemovedError(),
    });
    expect(isLegacyV5FormatRemovedError(wrapped)).toBe(true);
    expect(isLegacyV5FormatRemovedError(new Error("Invalid password"))).toBe(
      false,
    );
    expect(isLegacyV5FormatRemovedError(null)).toBe(false);
  });
});
