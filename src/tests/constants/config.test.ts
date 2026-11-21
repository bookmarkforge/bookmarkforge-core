import { describe, it, expect, vi, beforeEach } from "vitest";

// Helper: re-import config module so each test gets fresh env values
async function reimport() {
  vi.resetModules();
  return await import("../../constants/config");
}

describe("constants/config", () => {
  it("should export DB_CONFIG with correct structure", async () => {
    const { DB_CONFIG } = await import("../../constants/config");
    expect(DB_CONFIG.DB_NAME).toBe("bookmarkforge_v5");
    expect(DB_CONFIG.INITIAL_TIMEOUT_MS).toBe(10000);
    expect(DB_CONFIG.MAX_TIMEOUT_MS).toBe(900000);
    expect(DB_CONFIG.MIGRATION_PER_ROW_BUDGET_MS).toBe(40);
    expect(DB_CONFIG.MAX_RETRIES).toBe(3);
    expect(DB_CONFIG.SECURE_STORE_NAME).toBe("secrets");
  });

  it("should export SECURITY_CONFIG with correct structure", async () => {
    const { SECURITY_CONFIG } = await import("../../constants/config");
    expect(SECURITY_CONFIG.SESSION_TOKEN_TTL_MS).toBe(1800000);
    expect(SECURITY_CONFIG.MIN_PASSWORD_LENGTH).toBe(12);
  });

  it("should export AI_CONFIG with correct structure", async () => {
    const { AI_CONFIG } = await import("../../constants/config");
    expect(AI_CONFIG.REQUEST_TIMEOUT_MS).toBe(30000);
    expect(AI_CONFIG.GEMINI_CONTENT_MAX_LENGTH).toBe(8000);
  });

  it("should export remaining config objects", async () => {
    const mod = await import("../../constants/config");
    expect(mod.SYNC_CONFIG.DEDUPE_WINDOW_MS).toBe(5000);
    expect(mod.AUTOPROCESSOR_CONFIG.DEBOUNCE_MS).toBe(500);
  });
});

describe("validateEnvVars", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("no endpoint-related warnings (license validation removed)", async () => {
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    expect(
      result.warnings.filter((w: string) => w.includes("VALIDATE_ENDPOINT")),
    ).toHaveLength(0);
  });

  // VITE_GEMINI_API_KEY removed from ENV_REGISTRY (DCE) — these tests
  // confirm the key is no longer readable from the browser bundle.
  it("no gemini key warnings (key removed from ENV_REGISTRY)", async () => {
    vi.stubEnv("VITE_GEMINI_API_KEY", "AIzaSyTest");
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    // Key is not registered → env.geminiApiKey is always undefined
    expect(
      result.warnings.filter((w: string) => w.includes("GEMINI")),
    ).toHaveLength(0);
    expect(
      result.errors.filter((w: string) => w.includes("GEMINI")),
    ).toHaveLength(0);
  });

  it("produces dev warning when in DEV mode without VITE_DEV_MODE", async () => {
    // DEV is always true in Vitest; VITE_DEV_MODE is unset
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    expect(
      result.warnings.some((w: string) => w.includes("Running in dev mode")),
    ).toBe(true);
  });
});

describe("assertValidForBuild", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when there are validation errors", async () => {
    vi.stubEnv("PROD", "true" as any);
    vi.stubEnv("VITE_DISABLE_NETWORK_FIREWALL", "true");
    const { assertValidForBuild } = await reimport();
    expect(() => assertValidForBuild()).toThrow("BUILD FATAL");
  });

  it("does not throw when there are only warnings", async () => {
    const { assertValidForBuild } = await reimport();
    expect(() => assertValidForBuild()).not.toThrow();
  });

  it("does not throw when validation passes", async () => {
    const { assertValidForBuild } = await reimport();
    expect(() => assertValidForBuild()).not.toThrow();
  });
});

describe("validateEnvVars — PROD error paths", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports error when PROD + test-only bypass", async () => {
    vi.stubEnv("PROD", "true" as any);
    vi.stubEnv("VITE_DISABLE_NETWORK_FIREWALL", "true");
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e: string) => e.includes("BUILD FATAL"))).toBe(
      true,
    );
  });

  it("reports error for each test-only bypass in PROD", async () => {
    vi.stubEnv("PROD", "true" as any);
    vi.stubEnv("VITE_DISABLE_NETWORK_FIREWALL", "true");
    vi.stubEnv("VITE_FORCE_MEMORY_STORAGE", "true");
    vi.stubEnv("VITE_TEST_BUILD", "true");
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    expect(result.errors.length).toBe(3);
    expect(result.isValid).toBe(false);
  });

  it("does not error for removed AI provider keys in PROD", async () => {
    vi.stubEnv("PROD", "true" as any);
    vi.stubEnv("VITE_OPENAI_API_KEY", "sk-test-leaky");
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    expect(result.errors.some((e: string) => e.includes("VITE_OPENAI_API_KEY"))).toBe(
      false,
    );
  });

  it("rejects PROD + test-only bypasses (firewall, memory, test build)", async () => {
    vi.stubEnv("PROD", "true" as any);
    vi.stubEnv("VITE_DISABLE_NETWORK_FIREWALL", "true");
    vi.stubEnv("VITE_FORCE_MEMORY_STORAGE", "true");
    vi.stubEnv("VITE_TEST_BUILD", "true");
    const { validateEnvVars } = await reimport();
    const result = validateEnvVars();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("VITE_DISABLE_NETWORK_FIREWALL"),
        expect.stringContaining("VITE_FORCE_MEMORY_STORAGE"),
        expect.stringContaining("VITE_TEST_BUILD"),
      ]),
    );
    expect(result.isValid).toBe(false);
  });

});

describe("getEnvironmentInfo", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns isDev=true when DEV is true", async () => {
    vi.stubEnv("DEV", "true" as any);
    vi.stubEnv("MODE", "development");
    const { getEnvironmentInfo } = await reimport();
    const info = getEnvironmentInfo();
    expect(info.isDev).toBe(true);
    expect(info.mode).toBe("development");
  });

  it("falls back to defaults when optional env vars are missing", async () => {
    // MODE is a compile-time constant ("test" in Vitest), cannot be stubbed
    const { getEnvironmentInfo } = await reimport();
    const info = getEnvironmentInfo();
    expect(info.mode).toBe("test");
    expect(info.baseUrl).toBe("/");
  });

});
