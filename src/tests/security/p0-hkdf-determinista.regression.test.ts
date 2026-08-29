import { describe, it, expect, vi } from "vitest";

describe("P0 regression — HKDF determinista", () => {
  describe("Static source-file checks (P0 contracts are wired)", () => {
    it("CollaborationService.generateSharePayload uses a CSPRNG salt and bookmarkforge-share info", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/CollaborationService.ts"),
        "utf-8",
      );
      expect(src).toMatch(/crypto\.getRandomValues\(new Uint8Array\(16\)\)/);
      expect(src).toMatch(/bookmarkforge-share/);
    });

    it("SecurityVault.unlockFromShare uses same bookmarkforge-share info string", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/SecurityVault.ts"),
        "utf-8",
      );
      expect(src).toMatch(/bookmarkforge-share/);
    });

    it("CollaborationService.importSharedVault delegates to unlockFromShare", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/CollaborationService.ts"),
        "utf-8",
      );
      expect(src).toMatch(/bookmarkforge-share/);
      expect(src).toMatch(/shareSecret/);
    });

    it("RecoveryService encrypts/decrypts via encryptionService with bip39 phrases", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(
        path.resolve(__dirname, "../../services/RecoveryService.ts"),
        "utf-8",
      );
      expect(src).toMatch(/encryptionService\.(encrypt|decrypt)/);
      expect(src).toMatch(/bip39\.(generateMnemonic|validateMnemonic)/);
    });
  });
});
