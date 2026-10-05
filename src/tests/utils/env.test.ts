import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEnvVar, isProdBuild, isTestMode } from "../../utils/env";

// isProdBuild() and isTestMode() read from env.config (object frozen at import).
// To test different values we mock the whole module. The object is
// created with vi.hoisted so it is available when vi.mock (hoisted to the
// top of the file) runs its factory.
const mockEnv = vi.hoisted(() => ({
  isProd: false,
  mode: "test" as string,
}));

vi.mock("../../env.config", () => ({
  env: mockEnv,
  readDynamicEnv: vi.fn(),
  // networkFirewall (setup.ts) imports parseBool transitivamente — sin
  // including it here, the global mock leaves it undefined and it explodes when called.
  parseBool: vi.fn(() => undefined),
  parseString: vi.fn((s?: string) => s),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getEnvVar", () => {
  it("returns undefined for unknown env var", () => {
    expect(getEnvVar("NONEXISTENT_VAR_XYZ_123")).toBeUndefined();
  });

  it("returns the value from process.env fallback", () => {
    vi.stubEnv("VITE_KNOWN_VAR", "known-value");
    expect(getEnvVar("VITE_KNOWN_VAR")).toBe("known-value");
  });

  it("returns undefined for an env var that has never been set", () => {
    expect(getEnvVar("VITE_NEVER_SET_VAR_12345")).toBeUndefined();
  });
});

describe("isProdBuild", () => {
  it("returns false by default (test environment)", () => {
    expect(isProdBuild()).toBe(false);
  });

  it("returns true when PROD env is true", () => {
    mockEnv.isProd = true;
    expect(isProdBuild()).toBe(true);
  });
});

describe("isTestMode", () => {
  it("returns true in vitest environment (NODE_ENV=test)", () => {
    expect(isTestMode()).toBe(true);
  });

  it("returns true when import.meta.env.MODE is test", () => {
    mockEnv.mode = "test";
    expect(isTestMode()).toBe(true);
  });

  it("returns false in non-test mode", () => {
    mockEnv.mode = "production";
    expect(isTestMode()).toBe(false);
  });
});
