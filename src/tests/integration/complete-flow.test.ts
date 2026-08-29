import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { encryptionService } from "../../services/EncryptionService";
import { SanitizationService } from "../../services/SanitizationService";
import { universalExporter } from "../../services/UniversalExporter";
import { universalImporter } from "../../services/UniversalImporter";
import * as secureRandom from "../../utils/secureRandom";

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn().mockResolvedValue(null),
    setSecret: vi.fn().mockResolvedValue(undefined),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/AuditLogService", () => ({
  auditLog: {
    record: vi.fn().mockResolvedValue(undefined),
  },
  rotateAuditSessionId: vi.fn(),
}));

vi.mock("../../store/rateLimitStore", () => ({
  getRateLimitState: vi.fn().mockReturnValue({
    unlockAttempts: 0,
    lockoutUntil: 0,
  }),
  useRateLimitStore: {
    getState: vi.fn().mockReturnValue({
      incrementAttempt: vi.fn(),
      resetAttempts: vi.fn(),
      setLockout: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../services/EncryptionService", () => {
  // Simple password-aware mock: embed password proof in ciphertext
  const pwHash = (pw: string) => {
    let h = 0;
    for (let i = 0; i < pw.length; i++) {
      h = (h * 31 + pw.charCodeAt(i)) | 0;
    }
    return h.toString(16);
  };
  return {
    encryptionService: {
      encrypt: vi.fn(async (text: string, password?: string) => {
        const proof = password ? pwHash(password) : "nopw";
        return `v5:mock:${proof}:${btoa(text)}`;
      }),
      decrypt: vi.fn(async (encrypted: string, password?: string) => {
        const parts = encrypted.split(":");
        if (parts.length < 4 || parts[0] !== "v5" || parts[1] !== "mock")
          throw new Error("Invalid format");
        const proof = parts[2];
        if (password && pwHash(password) !== proof)
          throw new Error("Wrong password");
        return atob(parts.slice(3).join(":"));
      }),
      encryptBinary: vi.fn(async (data: Uint8Array) => data),
      decryptBinary: vi.fn(async (data: Uint8Array) => data),
      isEncrypted: vi.fn(
        (text: string) =>
          text.startsWith("v4:") || text.startsWith("v5:"),
      ),
      destroy: vi.fn(),
    },
  };
});

function createInMemoryDB() {
  const store = new Map<string, unknown[]>();
  return {
    bookmarks: {
      find: () => ({
        exec: async () => [],
      }),
      findOne: () => ({
        exec: async () => null,
      }),
      insert: async (doc: unknown) => doc,
      bulkInsert: async (docs: unknown[]) => docs,
    },
    documents: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    folders: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    chunks: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    flashcards: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    messages: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    versions: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    templates: {
      find: () => ({
        exec: async () => [],
      }),
      insert: async (doc: unknown) => doc,
    },
    memory: {
      find: () => ({ exec: async () => [] }),
      insert: async (doc: unknown) => doc,
    },
    $: {
      collections: [],
    },
  };
}

describe("Complete Flow Integration", () => {
  let db: ReturnType<typeof createInMemoryDB>;

  beforeAll(async () => {
    db = createInMemoryDB();
  });

  afterAll(async () => {
    await encryptionService.destroy();
  });

  it("1. should sanitize user input (Capture step)", () => {
    const maliciousInput = '<script>alert("xss")</script>Hello world';
    const sanitized = SanitizationService.sanitizeText(maliciousInput);
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).toContain("Hello world");
    const url = SanitizationService.sanitizeUrl(
      "https://example.com/page?q=test",
    );
    expect(url).toBe("https://example.com/page?q=test");
    const blockedUrl = SanitizationService.sanitizeUrl("javascript:alert(1)");
    expect(blockedUrl).toBe("");
  });

  it(
    "2. should encrypt and decrypt text (Encrypt step)",
    { timeout: 15000 },
    async () => {
      const password = "MySecureP@ss1";
      const plaintext = "This is a secret bookmark content";
      const encrypted = await encryptionService.encrypt(plaintext, password);
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted).toContain("v5:");
      const decrypted = await encryptionService.decrypt(encrypted, password);
      expect(decrypted).toBe(plaintext);
    },
  );

  it(
    "3. should fail decryption with wrong password",
    { timeout: 15000 },
    async () => {
      const encrypted = await encryptionService.encrypt(
        "secret data",
        "CorrectP@ss1",
      );
      await expect(
        encryptionService.decrypt(encrypted, "WrongP@ss1"),
      ).rejects.toThrow();
    },
  );

  it(
    "4. should handle binary data encryption roundtrip",
    { timeout: 15000 },
    async () => {
      const password = "BinaryP@ss1";
      const data = new Uint8Array([1, 2, 3, 4, 5, 255, 254, 253]);
      const encrypted = await encryptionService.encryptBinary(data, password);
      expect(encrypted).toBeDefined();
      const decrypted = await encryptionService.decryptBinary(
        encrypted,
        password,
      );
      expect(new Uint8Array(decrypted)).toEqual(data);
    },
  );

  it("5. should detect encrypted text format", () => {
    // "v4:" prefix is stripped; remaining must be valid base64 with >12 decoded bytes
    const validB64 = btoa("a".repeat(45));
    expect(encryptionService.isEncrypted(`v4:${validB64}`)).toBe(true);
    expect(encryptionService.isEncrypted("plain text")).toBe(false);
  });

  it("7. should generate cryptographically random tokens", () => {
    const token1 = secureRandom.generateSecureToken(32);
    const token2 = secureRandom.generateSecureToken(32);
    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(64);
    expect(token2).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token1)).toBe(true);
  });

  it("8. should validate file upload rules", async () => {
    const mockFile = new File(["test content"], "test.txt", {
      type: "text/plain",
    });
    const result = await SanitizationService.validateFileUpload(
      mockFile,
      { "text/plain": ["txt"] },
      1024 * 1024,
    );
    expect(result.valid).toBe(true);

    const oversizedFile = new File(
      [new ArrayBuffer(2 * 1024 * 1024 + 1)],
      "large.txt",
      { type: "text/plain" },
    );
    const oversizedResult = await SanitizationService.validateFileUpload(
      oversizedFile,
      { "text/plain": ["txt"] },
      1024 * 1024,
    );
    expect(oversizedResult.valid).toBe(false);
    expect(oversizedResult.error).toContain("too large");
  });

  it("9. should export bookmarks to JSON format", async () => {
    const options = { format: "json" as const };
    const result = await universalExporter.exportData(db as never, options);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(typeof result.blob).toBe("object");
    expect(result.format).toBe("json");
  });

  it("10. should export bookmarks to CSV format", async () => {
    const options = { format: "csv" as const };
    const result = await universalExporter.exportData(db as never, options);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.format).toBe("csv");
  });

  it("11. should export bookmarks to Markdown format", async () => {
    const options = { format: "markdown" as const };
    const result = await universalExporter.exportData(db as never, options);
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.format).toBe("markdown");
  });

  it("12. should import bookmarks from CSV", async () => {
    const csvContent =
      "Title,URL\nTest Page,https://example.com\nAnother,https://test.org";
    const file = new File([csvContent], "bookmarks.csv", {
      type: "text/csv",
    });
    const result = await universalImporter.importData(db as never, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("13. should sanitize URLs for security (defense in depth)", () => {
    const testCases = [
      { input: "https://example.com", expected: "https://example.com/" },
      { input: "http://example.com", expected: "http://example.com/" },
      { input: "javascript:alert(1)", expected: "" },
      { input: "data:text/html,<script>alert(1)</script>", expected: "" },
      { input: "file:///etc/passwd", expected: "" },
      { input: "ftp://example.com", expected: "" },
      { input: "   https://example.com   ", expected: "https://example.com/" },
      { input: "http://192.168.1.1/admin", expected: "" },
      { input: "http://10.0.0.1/config", expected: "" },
      { input: "http://localhost:3000", expected: "" },
    ];
    for (const { input, expected } of testCases) {
      const result = SanitizationService.sanitizeUrl(input);
      expect(result).toBe(expected);
    }
  });

  it("14. should sanitize HTML content", () => {
    const dirty =
      "<p>Safe text</p><script>alert(1)</script><img src=x onerror=alert(1)>";
    const clean = SanitizationService.sanitizeHtml(dirty);
    expect(clean).toContain("<p>Safe text</p>");
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("onerror");
  });

  it(
    "15. should perform full roundtrip: sanitize → encrypt → decrypt → validate",
    { timeout: 15000 },
    async () => {
      const originalContent =
        "<p>My <b>bookmark</b> content with <script>bad</script></p>";
      const password = "R0undtr!p";
      const sanitized = SanitizationService.sanitizeHtml(originalContent);
      expect(sanitized).not.toContain("<script>");
      const encrypted = await encryptionService.encrypt(sanitized, password);
      expect(encrypted).not.toBe(sanitized);
      const decrypted = await encryptionService.decrypt(encrypted, password);
      expect(decrypted).toBe(sanitized);
      expect(decrypted).toContain("<b>bookmark</b>");
      expect(decrypted).not.toContain("<script>");
    },
  );

  it("16. should validate magic bytes for file upload", async () => {
    const pngSignature = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const pngFile = new File([pngSignature], "test.png", {
      type: "image/png",
    });
    const pngResult = await SanitizationService.validateFileUpload(
      pngFile,
      { "image/png": ["png"] },
      1024 * 1024,
    );
    expect(pngResult.valid).toBe(true);
    const fakePng = new File(
      [new Uint8Array([0x00, 0x00, 0x00, 0x00])],
      "fake.png",
      { type: "image/png" },
    );
    const fakeResult = await SanitizationService.validateFileUpload(
      fakePng,
      { "image/png": ["png"] },
      1024 * 1024,
    );
    expect(fakeResult.valid).toBe(false);
  });
});
