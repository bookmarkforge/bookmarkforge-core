/**
 * Tests for `src/env.config.ts` — the single source of truth for all env reads.
 *
 * IMPORTANT: The module calls `validateEnv()` eagerly at import time. In Vitest
 * (NODE_ENV=test) the validation auto-skips, so importing is safe. However, the
 * typed `env` accessor is built ONCE at module load time and frozen. Tests that
 * need a FRESH `env` with specific stubbed env vars MUST use:
 *   vi.resetModules() + vi.stubEnv(...) + await import("../env.config")
 *
 * Static imports at the top of the file get the cached module — they can access
 * exported functions (parseBool, readDynamicEnv, etc.) but NOT a fresh `env`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Static imports for exported pure functions (no module state needed)
import {
  parseBool,
  parseNumber,
  parseString,
  readDynamicEnv,
  ENV_REGISTRY,
  ALLOWED_ENV_VAR_NAMES,
} from "../env.config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ───────────────────────────────────────────────────────────────────
// 1. PARSERS (pure functions, no module state needed)
// ───────────────────────────────────────────────────────────────────

describe("parseBool", () => {
  it("returns undefined for undefined input", () => {
    expect(parseBool(undefined)).toBeUndefined();
  });

  it.each([
    { input: "", expected: false },
    { input: "false", expected: false },
    { input: "FALSE", expected: false },
    { input: "0", expected: false },
    { input: "no", expected: false },
    { input: "off", expected: false },
    { input: "true", expected: true },
    { input: "TRUE", expected: true },
    { input: "1", expected: true },
    { input: "yes", expected: true },
    { input: "on", expected: true },
    { input: "  true  ", expected: true }, // trimmed
  ])("parses '$input' as $expected", ({ input, expected }) => {
    expect(parseBool(input)).toBe(expected);
  });

  it("throws for invalid boolean strings", () => {
    expect(() => parseBool("maybe")).toThrow(
      "[env.config] expected boolean for",
    );
    expect(() => parseBool("2")).toThrow(
      "[env.config] expected boolean for",
    );
    expect(() => parseBool("yeah")).toThrow(
      "[env.config] expected boolean for",
    );
  });
});

describe("parseNumber", () => {
  it("returns undefined for undefined input", () => {
    expect(parseNumber(undefined)).toBeUndefined();
  });

  it.each([
    { input: "0", expected: 0 },
    { input: "42", expected: 42 },
    { input: "3.14", expected: 3.14 },
    { input: "-1", expected: -1 },
    { input: "1e3", expected: 1000 },
  ])("parses '$input' as $expected", ({ input, expected }) => {
    expect(parseNumber(input)).toBe(expected);
  });

  it("throws for non-numeric strings", () => {
    expect(() => parseNumber("abc")).toThrow(
      "[env.config] expected number for",
    );
    expect(() => parseNumber("")).toThrow(
      "[env.config] expected number for",
    );
    expect(() => parseNumber("NaN")).toThrow(
      "[env.config] expected number for",
    );
  });
});

describe("parseString", () => {
  it("returns undefined for undefined input", () => {
    expect(parseString(undefined)).toBeUndefined();
  });

  it("returns the raw string as-is", () => {
    expect(parseString("hello")).toBe("hello");
    expect(parseString("")).toBe("");
  });
});

// ───────────────────────────────────────────────────────────────────
// 2. ENV_REGISTRY structure (static, no env needed)
// ───────────────────────────────────────────────────────────────────

describe("ENV_REGISTRY", () => {
  it("contains at least 20 entries", () => {
    const keys = Object.keys(ENV_REGISTRY);
    expect(keys.length).toBeGreaterThanOrEqual(20);
  });

  it("every entry has envVar and parser", () => {
    for (const [key, entry] of Object.entries(ENV_REGISTRY)) {
      expect(entry).toHaveProperty("envVar");
      expect(typeof entry.envVar).toBe("string");
      expect(entry).toHaveProperty("parser");
      expect(typeof entry.parser).toBe("function");
    }
  });

  it("all envVar names are unique", () => {
    const names = Object.values(ENV_REGISTRY).map((e) => e.envVar);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("contains Vite built-in entries (isDev, isProd, mode, baseUrl)", () => {
    expect(ENV_REGISTRY.isDev).toBeDefined();
    expect(ENV_REGISTRY.isProd).toBeDefined();
    expect(ENV_REGISTRY.mode).toBeDefined();
    expect(ENV_REGISTRY.baseUrl).toBeDefined();
  });

  it("contains app-specific VITE_* entries", () => {
    // Provider keys intentionally removed from ENV_REGISTRY (DCE —
    // provider keys must not be readable from the browser bundle).
    expect(ENV_REGISTRY.p2pSignalingUrl).toBeDefined();
    expect(ENV_REGISTRY.bootStrict).toBeDefined();
    expect(ENV_REGISTRY.prefixStrict).toBeDefined();
  });

  it("entries with defaults have default !== undefined", () => {
    const withDefault = Object.entries(ENV_REGISTRY).filter(
      ([_, e]) => "default" in e,
    );
    for (const [key, entry] of withDefault) {
      expect((entry as any).default).not.toBeUndefined();
    }
  });

  it("no entry currently has required: true (documented state)", () => {
    const required = Object.entries(ENV_REGISTRY).filter(        ([_, e]) => (e as any).required === true,
    );
    expect(required).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────
// 3. ALLOWED_ENV_VAR_NAMES (static, no env needed)
// ───────────────────────────────────────────────────────────────────

describe("ALLOWED_ENV_VAR_NAMES", () => {
  it("has same number of entries as ENV_REGISTRY", () => {
    expect(ALLOWED_ENV_VAR_NAMES.size).toBe(Object.keys(ENV_REGISTRY).length);
  });

  it("includes all envVar values from the registry", () => {
    for (const entry of Object.values(ENV_REGISTRY)) {
      expect(ALLOWED_ENV_VAR_NAMES.has(entry.envVar)).toBe(true);
    }
  });

  it("includes key VITE_* names", () => {
    // VITE_GEMINI_API_KEY removed from ENV_REGISTRY (DCE) — no longer in ALLOWED set
    expect(ALLOWED_ENV_VAR_NAMES.has("VITE_GEMINI_API_KEY")).toBe(false);
    expect(ALLOWED_ENV_VAR_NAMES.has("VITE_APP_VERSION")).toBe(true);
    expect(ALLOWED_ENV_VAR_NAMES.has("VITE_DISABLE_NETWORK_FIREWALL")).toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────────────────────────────
// 4. TYPED env ACCESSOR (needs FRESH module via vi.resetModules)
// ───────────────────────────────────────────────────────────────────

describe("env accessor", () => {
  beforeEach(() => {
    // Each test gets a completely fresh module so vi.stubEnv takes effect
    vi.resetModules();
  });

  it("is frozen (Object.freeze)", async () => {
    const { env } = await import("../env.config");
    expect(Object.isFrozen(env)).toBe(true);
  });

  it("provides defaults for entries with defaults", async () => {
    const { env } = await import("../env.config");
    // These have explicit `default:` values in ENV_REGISTRY
    expect(typeof env.isDev).toBe("boolean");
    expect(typeof env.isProd).toBe("boolean");
    expect(typeof env.mode).toBe("string");
    expect(typeof env.baseUrl).toBe("string");
    expect(env.disableNetworkFirewall).toBe(false);
    expect(env.forceMemoryStorage).toBe(false);
    expect(env.bootStrict).toBe(false);
    expect(env.prefixStrict).toBe(false);
  });

  it("provides undefined for optional entries without defaults", async () => {
    const { env } = await import("../env.config");
    // These have no default → undefined when unset
    expect(env.buildHash).toBeUndefined();
    expect(env.dbName).toBeUndefined();
  });

  it("reflects stubbed env vars (stub BEFORE module load)", async () => {
    vi.stubEnv("VITE_APP_VERSION", "2.0.0");
    // resetModules was already called in beforeEach, so module is fresh
    const { env } = await import("../env.config");
    expect(env.appVersion).toBe("2.0.0");
  });

  it("applies stubbed boolean vars correctly", async () => {
    vi.stubEnv("VITE_DISABLE_NETWORK_FIREWALL", "true");
    const { env } = await import("../env.config");
    expect(env.disableNetworkFirewall).toBe(true);
  });

  it("reads stubbed string var correctly", async () => {
    vi.stubEnv("VITE_P2P_SIGNALING_URL", "wss://signal.example.com");
    const { env } = await import("../env.config");
    expect(env.p2pSignalingUrl).toBe("wss://signal.example.com");
  });
});

// ───────────────────────────────────────────────────────────────────
// 5. readDynamicEnv (reads live env, no module reload needed)
// ───────────────────────────────────────────────────────────────────

describe("readDynamicEnv", () => {
  it("returns undefined for unknown vars", () => {
    expect(readDynamicEnv("NONEXISTENT_VAR_XYZ")).toBeUndefined();
  });

  it("reads from process.env via vi.stubEnv", () => {
    vi.stubEnv("VITE_DYNAMIC_TEST_KEY", "dynamic-value");
    expect(readDynamicEnv("VITE_DYNAMIC_TEST_KEY")).toBe("dynamic-value");
  });

  it("returns undefined after unstubbing", () => {
    vi.stubEnv("VITE_TEMP_KEY", "temp");
    expect(readDynamicEnv("VITE_TEMP_KEY")).toBe("temp");
    vi.unstubAllEnvs();
    expect(readDynamicEnv("VITE_TEMP_KEY")).toBeUndefined();
  });

  it("returns empty string for vars set to empty string", () => {
    vi.stubEnv("VITE_EMPTY_ENV", "");
    expect(readDynamicEnv("VITE_EMPTY_ENV")).toBe("");
  });

  it("does not throw when env is partially torn down", () => {
    expect(readDynamicEnv("ANY_VAR")).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────
// 6. validateEnv (tested via fresh module import)
// ───────────────────────────────────────────────────────────────────

describe("validateEnv", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips and does not throw in test environment", async () => {
    // NODE_ENV=test is set by Vitest — validateEnv auto-skips
    await expect(import("../env.config")).resolves.toBeDefined();
  });

  it("skips when SKIP_ENV_BOOT_VALIDATION=1", async () => {
    vi.stubEnv("SKIP_ENV_BOOT_VALIDATION", "1");
    vi.stubEnv("NODE_ENV", "development");
    await expect(import("../env.config")).resolves.toBeDefined();
  });

  it("can be called directly without throwing in clean env", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SKIP_ENV_BOOT_VALIDATION", "1");
    const mod = await import("../env.config");
    // Calling validateEnv() manually in a clean env should not throw
    expect(typeof mod.validateEnv).toBe("function");
    expect(() => mod.validateEnv()).not.toThrow();
  });

  it("warns for optional vars without defaults (not strict)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "development");
    // Don't set SKIP_ENV_BOOT_VALIDATION — validateEnv will run on import
    // and there are many optional-without-default vars that trigger warnings.
    // Actually, validateEnv skips in test, so we need to call it manually.
    const mod = await import("../env.config");
    mod.validateEnv();
    // At least one optional-without-default var should trigger a warning
    expect(warnSpy).toHaveBeenCalled();
    // Verify the warning mentions the unset optional var
    const warnCalls = warnSpy.mock.calls.flat().join(" ");
    expect(warnCalls).toContain("[env.config]");
    expect(warnCalls).toContain("optional env var unset");
  });

  it("throws when strict mode and optional var missing", async () => {
    // SKIP_ENV_BOOT_VALIDATION prevents validateEnv() from running during
    // module load — without it, import() would reject with a throw.
    vi.stubEnv("SKIP_ENV_BOOT_VALIDATION", "1");
    vi.stubEnv("VITE_ENV_BOOT_STRICT", "1");
    vi.stubEnv("NODE_ENV", "development");
    const mod = await import("../env.config");
    // Remove SKIP so the manual call DOES run the validation
    vi.stubEnv("SKIP_ENV_BOOT_VALIDATION", "");
    // validateEnv() manual ahora ve VITE_ENV_BOOT_STRICT=1 y tira error
    expect(() => mod.validateEnv()).toThrow(
      "[env.config] optional env var unset, no default applied",
    );
  });
});

// ───────────────────────────────────────────────────────────────────
// 7. Type regression checks (via fresh module)
// ───────────────────────────────────────────────────────────────────

describe("env accessor — type regression checks", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("has string-typed mode (not undefined)", async () => {
    const { env } = await import("../env.config");
    expect(typeof env.mode).toBe("string");
  });

  it("has boolean-typed isDev and isProd", async () => {
    const { env } = await import("../env.config");
    expect(typeof env.isDev).toBe("boolean");
    expect(typeof env.isProd).toBe("boolean");
  });
});
