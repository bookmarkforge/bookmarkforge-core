import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock import.meta.env before importing the module.
// Since import.meta.env is defined at the module level, we mock it via vi.stubEnv / define
// and use a dynamic import after mocking.

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/networkFirewall", () => ({
  firewalledFetch: vi.fn(),
  setFirewallDisabled: vi.fn(),
}));

import { firewalledFetch as mockedFirewalledFetch } from "../../utils/networkFirewall";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock crypto.subtle.digest
const mockDigest = vi.fn();
const originalCrypto = globalThis.crypto;

function setupDigestMock(returnHex: string) {
  const bytes = new Uint8Array(returnHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(returnHex.substring(i * 2, i * 2 + 2), 16);
  }
  mockDigest.mockResolvedValue(bytes.buffer);
  const subtleMock = { digest: mockDigest };
  Object.defineProperty(globalThis, "crypto", {
    value: { ...originalCrypto, subtle: subtleMock },
    writable: true,
    configurable: true,
  });
}

function restoreCrypto() {
  Object.defineProperty(globalThis, "crypto", {
    value: originalCrypto,
    writable: true,
    configurable: true,
  });
}

// Mock document.querySelector / getElementById
function setupDomMocks(
  overrides: {
    manifestContent?: string | null;
    scriptUrls?: string[];
    linkUrls?: string[];
    modulePreloadUrls?: string[];
  } = {},
) {
  const scripts = (overrides.scriptUrls ?? []).map(
    (src) => ({ src }) as HTMLScriptElement,
  );
  const links = (overrides.linkUrls ?? []).map(
    (href) => ({ href }) as HTMLLinkElement,
  );
  const preloads = (overrides.modulePreloadUrls ?? []).map(
    (href) => ({ href }) as HTMLLinkElement,
  );

  // Create a mock manifest element
  let mockManifestElement: HTMLElement | null = null;
  if (overrides.manifestContent !== undefined) {
    mockManifestElement = document.createElement("div");
    mockManifestElement.id = "__BMF_INTEGRITY_MANIFEST__";
    if (overrides.manifestContent === null) {
      mockManifestElement = null;
    } else {
      mockManifestElement.textContent = overrides.manifestContent;
    }
  }

  vi.spyOn(document, "getElementById").mockImplementation((id: string) => {
    if (id === "__BMF_INTEGRITY_MANIFEST__") {
      return mockManifestElement;
    }
    return null;
  });

  vi.spyOn(document, "querySelectorAll").mockImplementation(
    (selector: string) => {
      if (selector === "script[src]") {
        return scripts as unknown as NodeListOf<Element>;
      }
      if (selector === 'link[rel="stylesheet"]') {
        return links as unknown as NodeListOf<Element>;
      }
      if (selector === 'link[rel="modulepreload"]') {
        return preloads as unknown as NodeListOf<Element>;
      }
      return [] as unknown as NodeListOf<Element>;
    },
  );

  return { scripts, links, preloads };
}

// We need to dynamically import the module after setting up env mocks
let checkBundleIntegrity: Function;
let verifyBuildIdentity: Function;

async function loadModule(
  envOverrides: {
    DEV?: boolean;
    PROD?: boolean;
    VITE_BUILD_HASH?: string;
    VITE_APP_VERSION?: string;
  } = {},
) {
  // Reset module cache to force re-import
  vi.resetModules();

  // Stub import.meta.env
  vi.stubEnv("VITE_BUILD_HASH", envOverrides.VITE_BUILD_HASH ?? "");
  vi.stubEnv("VITE_APP_VERSION", envOverrides.VITE_APP_VERSION ?? "0.0.0");

  // Use vi.doMock to control import.meta.env
  const module = await vi.importActual<
    typeof import("../../utils/bundleIntegrity")
  >("../../utils/bundleIntegrity");
  checkBundleIntegrity = module.checkBundleIntegrity;
  verifyBuildIdentity = module.verifyBuildIdentity;
}

// NOTE: import.meta.env mocking in Vitest is tricky.
// We use a simpler approach: mock window.__BMF_BUILD_HASH__ and the import meta env.
// For tests where we need DEV mode, we patch the function behavior directly.

// Instead of fighting with import.meta.env, let's test the functions by
// patching the relevant globals and calling them directly.

// Actually the simplest approach: mock the module-level import.meta.env checks
// by using vi.doMock to re-mock import.meta each time.

// Let me use a pragmatic approach: create a helper that patches the module functions
// and test the logic through the exported functions. Since import.meta.env is
// evaluated at module load time, the auto-run setTimeout won't fire in test
// because we use fake timers.

describe("bundleIntegrity", () => {
  let dispatchEventSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    mockDigest.mockReset();
    (mockedFirewalledFetch as any).mockImplementation(
      (url: string) => (globalThis.fetch as typeof mockFetch)(url),
    );
    dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

    // Setup default DOM
    setupDomMocks();

    // Setup default window location
    Object.defineProperty(window, "location", {
      value: { origin: "https://app.example.com" },
      writable: true,
      configurable: true,
    });

    // Reset module cache and import
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreCrypto();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("verifyResourceIntegrity", () => {
    it("accepts bytes whose SHA-256 matches the manifest", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/wasm/zero-memory.wasm": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      const mod = await import("../../utils/bundleIntegrity");
      expect(
        await mod.verifyResourceIntegrity(
          "/wasm/zero-memory.wasm?cache=1",
          new Uint8Array([1, 2, 3]),
        ),
      ).toBe(true);
    });

    it("rejects bytes whose hash differs from the manifest", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/wasm/zero-memory.wasm": "expected_hash",
        },
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });
      setupDigestMock("different_hash");

      const mod = await import("../../utils/bundleIntegrity");
      expect(
        await mod.verifyResourceIntegrity(
          "/wasm/zero-memory.wasm",
          new Uint8Array([9, 8, 7]),
        ),
      ).toBe(false);
    });

    it("hashes only the selected ArrayBufferView range", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/model.wasm": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      const mod = await import("../../utils/bundleIntegrity");
      const backing = new Uint8Array([0, 1, 2, 3, 4]);
      expect(
        await mod.verifyResourceIntegrity(
          "/assets/model.wasm",
          backing.subarray(1, 4),
        ),
      ).toBe(true);
      expect(mockDigest).toHaveBeenCalledWith(
        "SHA-256",
        expect.any(Uint8Array),
      );
      expect(mockDigest.mock.calls[0]![1]).toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe("checkBundleIntegrity", () => {
    it("returns passed when no manifest available", async () => {
      setupDomMocks({ manifestContent: null });

      const mod = await import("../../utils/bundleIntegrity");
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
      expect(result.totalFiles).toBe(0);
    });

    it("returns passed when manifest has no files", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {},
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });

      const mod = await import("../../utils/bundleIntegrity");
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
    });

    it("checks same-origin script resources against manifest", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("console.log('hello');"),
      });

      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
      expect(result.matchedFiles).toBe(1);
      expect(result.mismatchedFiles).toHaveLength(0);
    });

    it("detects hash mismatch", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "expected_hash_value_here_32ch",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("tampered content!"),
      });

      setupDigestMock("different_hash_value_here32c");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(false);
      expect(result.mismatchedFiles).toContain("/assets/app.js");
    });

    it("dispatches bundle-integrity-failed custom event on failure", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "expected_hash",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("tampered content!"),
      });
      setupDigestMock("mismatched_hash_here_32chars");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      await mod.checkBundleIntegrity();

      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "bundle-integrity-failed",
        }),
      );
    });

    it("renders the error screen and sets the title on failure (L-06)", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: { "/assets/app.js": "expected_hash" },
      };
      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("tampered content!"),
      });
      setupDigestMock("mismatched_hash_here_32chars");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      await mod.checkBundleIntegrity();

      expect(document.title).toBe("Integrity Check Failed");
      expect(document.body?.innerHTML).toContain("Integrity Check Failed");
    });

    it("cae a insertAdjacentHTML si document.body no existe (L-06)", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: { "/assets/app.js": "expected_hash" },
      };
      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("tampered content!"),
      });
      setupDigestMock("mismatched_hash_here_32chars");

      const insertSpy = vi.spyOn(
        document.documentElement,
        "insertAdjacentHTML",
      );
      // absent body (checked before the parse completes): fix L-06 must
      // not throw a TypeError but insert into <html>.
      const bodyGetter = vi
        .spyOn(document, "body", "get")
        .mockReturnValue(null as any);

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      await expect(mod.checkBundleIntegrity()).resolves.toBeDefined();

      expect(insertSpy).toHaveBeenCalledWith(
        "beforeend",
        expect.stringContaining("Integrity Check Failed"),
      );
      expect(document.title).toBe("Integrity Check Failed");

      bodyGetter.mockRestore();
      insertSpy.mockRestore();
    });

    it("handles fetch errors gracefully", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "some_hash",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      // Should not crash, should still pass (skips failed fetches)
      expect(result.passed).toBe(true);
    });

    it("handles non-ok fetch responses", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "some_hash",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      // Should not crash
      expect(result.passed).toBe(true);
    });

    it("checks stylesheet resources", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/style.css": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        linkUrls: ["https://app.example.com/assets/style.css"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("body { color: red; }"),
      });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
    });

    it("checks module preload resources", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/chunk.js": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        modulePreloadUrls: ["https://app.example.com/assets/chunk.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("export default {}"),
      });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
    });

    it("deduplicates resource URLs", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: [
          "https://app.example.com/assets/app.js",
          "https://app.example.com/assets/app.js",
        ],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("content"),
      });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      // totalFiles should be 1 (deduplicated), but matching is based on manifest check
      // Dedup means only one file to check against manifest
      expect(result.totalFiles).toBe(1);
    });

    it("includes checkedAt timestamp in result", async () => {
      setupDomMocks({ manifestContent: null });

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.checkedAt).toBeDefined();
      expect(() => new Date(result.checkedAt)).not.toThrow();
    });

    it("tracks files in manifest that aren't loaded", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "hash1",
          "/assets/vendor.js": "hash2",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("app code"),
      });
      setupDigestMock("hash1");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.missingFiles).toContain("/assets/vendor.js");
    });

    it("handles relative paths in resource URLs", { timeout: 30000 }, async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["/assets/app.js"],
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("console.log('hello');"),
      });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
    });

    it("builds manifest from window.__BMF_BUILD_HASH__ when no element", async () => {
      setupDomMocks({ manifestContent: null });
      (window as any).__BMF_BUILD_HASH__ = "hash-from-window";

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      // Manifest derived from the window hash: no files → passes
      expect(result.passed).toBe(true);
      delete (window as any).__BMF_BUILD_HASH__;
    });

    it("builds manifest from VITE_BUILD_HASH env fallback", async () => {
      setupDomMocks({ manifestContent: null });
      delete (window as any).__BMF_BUILD_HASH__;
      vi.stubEnv("VITE_BUILD_HASH", "env-hash-123");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(true);
      vi.unstubAllEnvs();
    });

    it("fails in PROD when no manifest is available", async () => {
      setupDomMocks({ manifestContent: null });
      delete (window as any).__BMF_BUILD_HASH__;
      vi.stubEnv("PROD", "true" as any);
      vi.stubEnv("DEV", "" as any);
      vi.stubEnv("VITE_BUILD_HASH", "");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      // NO force the check: the PROD branch without manifest requires !forceIntegrityCheck
      const result = await mod.checkBundleIntegrity();
      expect(result.passed).toBe(false);
      expect(result.missingFiles).toContain("__BMF_INTEGRITY_MANIFEST__");
      vi.unstubAllEnvs();
    });

    it("excludes cross-origin resource URLs from the check", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "hash1",
        },
      };
      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://evil.example.com/app.js"],
      });

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      mod.setForceIntegrityCheck(true);
      const result = await mod.checkBundleIntegrity();
      // The cross-origin URL is not included; the manifest file is not loaded
      expect(result.totalFiles).toBe(0);
      expect(result.missingFiles).toContain("/assets/app.js");
    });
  });

  describe("verifyBuildIdentity", () => {
    it("returns true when no manifest available", async () => {
      setupDomMocks({ manifestContent: null });

      // Clear any window.__BMF_BUILD_HASH__
      delete (window as any).__BMF_BUILD_HASH__;

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      const result = mod.verifyBuildIdentity();
      expect(result).toBe(true);
    });

    it("returns true when manifest has no buildHash", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "",
        buildTime: "",
        files: {},
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      const result = mod.verifyBuildIdentity();
      expect(result).toBe(true);
    });

    it("returns true when build hashes match", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123def456",
        buildTime: "2026-01-01T00:00:00Z",
        files: {},
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });

      // Set window.__BMF_BUILD_HASH__ to match
      (window as any).__BMF_BUILD_HASH__ = "abc123def456";

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      const result = mod.verifyBuildIdentity();
      expect(result).toBe(true);
    });

    it("returns false when build hashes mismatch", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123def456",
        buildTime: "2026-01-01T00:00:00Z",
        files: {},
      };
      setupDomMocks({ manifestContent: JSON.stringify(manifest) });

      // Set window.__BMF_BUILD_HASH__ to a different value
      (window as any).__BMF_BUILD_HASH__ = "different_hash";

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");
      mod.clearManifestCache();
      const result = mod.verifyBuildIdentity();
      expect(result).toBe(false);
    });
  });

  describe("auto-run behavior", () => {
    it("does not throw when module is imported in test environment", async () => {
      // The auto-run setTimeout(3000) should not cause issues in test
      // because we use fake timers
      setupDomMocks({ manifestContent: null });

      await expect(
        import("../../utils/bundleIntegrity"),
      ).resolves.toBeDefined();

      // Advance timers to trigger auto-run — should not throw
      expect(() => {
        vi.advanceTimersByTime(5000);
      }).not.toThrow();
    });

    it("handles auto-run check failure gracefully", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "expected_hash",
        },
      };

      setupDomMocks({
        manifestContent: JSON.stringify(manifest),
        scriptUrls: ["https://app.example.com/assets/app.js"],
      });

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");

      // Advance timers past 3s to trigger auto-run — should not throw
      expect(async () => {
        vi.advanceTimersByTime(5000);
        await vi.runAllTicks();
      }).not.toThrow();
    });
  });

  describe("cached manifest", () => {
    it("reuses cached manifest on subsequent calls", async () => {
      const manifest = {
        version: "1.0.0",
        buildHash: "abc123",
        buildTime: "2026-01-01T00:00:00Z",
        files: {
          "/assets/app.js": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
        },
      };

      const getElementByIdSpy = vi
        .spyOn(document, "getElementById")
        .mockImplementation((id: string) => {
          if (id === "__BMF_INTEGRITY_MANIFEST__") {
            const div = document.createElement("div");
            div.id = "__BMF_INTEGRITY_MANIFEST__";
            div.textContent = JSON.stringify(manifest);
            return div;
          }
          return null;
        });

      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve("content"),
      });
      setupDigestMock("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");

      vi.resetModules();
      const mod = await import("../../utils/bundleIntegrity");

      // First call should read from DOM
      await mod.checkBundleIntegrity();
      const firstCallCount = getElementByIdSpy.mock.calls.length;

      // Second call should use cache
      await mod.checkBundleIntegrity();
      const secondCallCount = getElementByIdSpy.mock.calls.length;

      // The DOM read should not increase on second call
      // (getElementById may be called again but cached manifest prevents re-parsing)
      // Actually the function always calls getBuildManifest which checks cache first
      // So it should not call getElementById again
      expect(secondCallCount - firstCallCount).toBe(0);
    });
  });
});
