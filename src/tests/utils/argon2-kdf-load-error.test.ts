import { describe, it, expect, vi } from "vitest";

// argon2.js exports argon2id as undefined — loadArgon2 must throw the explicit error.
vi.mock("@noble/hashes/argon2.js", () => ({ argon2id: undefined }));

import { deriveArgon2idKey } from "../../utils/argon2-kdf";

describe("loadArgon2 error handling", () => {
  it("throws a descriptive error when argon2id is not a function", async () => {
    await expect(
      deriveArgon2idKey(new Uint8Array(4), new Uint8Array(4)),
    ).rejects.toThrow("@noble/hashes/argon2.argon2id is not a function");
  });

  it("propagates the same error on subsequent calls (cached rejected promise)", async () => {
    await expect(
      deriveArgon2idKey(new Uint8Array(4), new Uint8Array(4)),
    ).rejects.toThrow("@noble/hashes/argon2.argon2id is not a function");
  });
});
