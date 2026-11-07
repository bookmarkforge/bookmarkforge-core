import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ModelIntegrityError,
  VerifiedModelCache,
  createVerifiedModelCache,
  configureModelIntegrity,
  verifyModelBytes,
  getPinnedDigest,
} from "../../utils/modelIntegrity";

// The manifest is bundled JSON — stub it with a tiny deterministic model.
// Digests below are the real SHA-256 of the byte arrays used in tests:
//   sha256([1,2,3]) = 039058c6…
//   sha256([9,9,9]) = e740a6fa…
const DIGEST_123 = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const DIGEST_999 = "e740a6faf2db65f5853148d75d9a335d7c4b94ab106fe5f237bc34fdcfc74584";

// Inline literal inside the hoisted factory — vi.mock factories are hoisted
// above const declarations, so they cannot reference top-level bindings.
vi.mock("../../data/modelDigests.json", () => ({
  default: {
    schemaVersion: 1,
    pinnedAt: "2026-01-01T00:00:00.000Z",
    remoteHost: "https://huggingface.co",
    models: {
      "org/test-model": {
        revision: "main",
        files: {
          "config.json":
            "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          "onnx/model.onnx":
            "e740a6faf2db65f5853148d75d9a335d7c4b94ab106fe5f237bc34fdcfc74584",
        },
      },
    },
  },
}));

const HF_MODEL_URL =
  "https://huggingface.co/org/test-model/resolve/main/onnx/model.onnx";
const HF_CONFIG_URL =
  "https://huggingface.co/org/test-model/resolve/main/config.json";

describe("modelIntegrity", () => {
  beforeEach(() => {
    vi.stubEnv("PROD", false as any);
    vi.stubEnv("VITE_MODEL_SELF_HOST_URL", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("getPinnedDigest", () => {
    it("resolves the digest for a pinned model file URL", () => {
      expect(getPinnedDigest(HF_MODEL_URL)).toBe(DIGEST_999);
      expect(getPinnedDigest(HF_CONFIG_URL)).toBe(DIGEST_123);
    });

    it("returns null for non-model URLs (app assets)", () => {
      expect(getPinnedDigest("https://app.example/assets/index-hash.js")).toBeNull();
      expect(getPinnedDigest("/assets/index.js")).toBeNull();
    });

    it("returns null for URLs without the /resolve/ segment", () => {
      expect(getPinnedDigest("https://huggingface.co/org/test-model/raw/main/config.json")).toBeNull();
    });

    it("returns null for unpinned models or files", () => {
      expect(
        getPinnedDigest("https://huggingface.co/other/model/resolve/main/config.json"),
      ).toBeNull();
      expect(
        getPinnedDigest("https://huggingface.co/org/test-model/resolve/main/onnx/mystery.onnx"),
      ).toBeNull();
    });

    it("returns null for invalid URLs", () => {
      expect(getPinnedDigest("not a url")).toBeNull();
    });
  });

  describe("verifyModelBytes", () => {
    it("accepts bytes whose SHA-256 matches the pinned digest", async () => {
      await expect(verifyModelBytes(HF_CONFIG_URL, new Uint8Array([1, 2, 3]))).resolves.toBe(true);
    });

    it("rejects bytes whose hash differs from the pinned digest", async () => {
      await expect(verifyModelBytes(HF_CONFIG_URL, new Uint8Array([9, 9, 9]))).resolves.toBe(false);
    });

    it("passes through non-model URLs unverified (bundle integrity covers them)", async () => {
      vi.stubEnv("PROD", true as any);
      await expect(
        verifyModelBytes("/assets/index.js", new Uint8Array([0])),
      ).resolves.toBe(true);
    });

    it("fails closed on unpinned files from a pinned host in production", async () => {
      vi.stubEnv("PROD", true as any);
      await expect(
        verifyModelBytes(
          "https://huggingface.co/org/test-model/resolve/main/onnx/mystery.onnx",
          new Uint8Array([0]),
        ),
      ).resolves.toBe(false);
    });

    it("is permissive for unpinned files from a pinned host in dev", async () => {
      await expect(
        verifyModelBytes(
          "https://huggingface.co/org/test-model/resolve/main/onnx/mystery.onnx",
          new Uint8Array([0]),
        ),
      ).resolves.toBe(true);
    });

    it("accepts self-hosted mirror URLs serving the same bytes (path-keyed)", async () => {
      vi.stubEnv("PROD", true as any);
      await expect(
        verifyModelBytes(
          "https://models.internal.example/org/test-model/resolve/main/config.json",
          new Uint8Array([1, 2, 3]),
        ),
      ).resolves.toBe(true);
    });
  });

  describe("VerifiedModelCache", () => {
    it("stores verified responses and returns them on match", async () => {
      const cache = createVerifiedModelCache();
      const response = new Response(new Uint8Array([9, 9, 9]), {
        headers: { "Content-Type": "application/octet-stream" },
      });
      await cache.put(HF_MODEL_URL, response);
      const hit = await cache.match(HF_MODEL_URL);
      expect(hit).toBeDefined();
      expect(new Uint8Array(await hit!.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]));
    });

    it("throws ModelIntegrityError on digest mismatch (fail-closed)", async () => {
      const cache = createVerifiedModelCache();
      await expect(
        cache.put(HF_MODEL_URL, new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
      ).rejects.toBeInstanceOf(ModelIntegrityError);
    });

    it("returns undefined on match miss", async () => {
      const cache = createVerifiedModelCache();
      await expect(cache.match("https://huggingface.co/missing/file.onnx")).resolves.toBeUndefined();
    });

    it("strips Content-Encoding / stale Content-Length from stored responses", async () => {
      // HF serves gzip for text/json; arrayBuffer() returns DECODED bytes,
      // so preserving the original headers would corrupt cache hits.
      const cache = createVerifiedModelCache();
      const bytes = new Uint8Array([1, 2, 3]);
      const gzipResponse = new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": "9999",
          "ETag": "\"deadbeef\"",
          "Vary": "Accept-Encoding",
        },
      });
      // `put` clones and hashes — the stored copy must be clean.
      await cache.put(HF_CONFIG_URL, gzipResponse);
      const hit = await cache.match(HF_CONFIG_URL);
      expect(hit!.headers.get("content-encoding")).toBeNull();
      expect(hit!.headers.get("etag")).toBeNull();
      expect(hit!.headers.get("vary")).toBeNull();
      expect(hit!.headers.get("content-length")).toBe(String(bytes.byteLength));
      expect(hit!.headers.get("content-type")).toBe("application/json");
    });

    it("returns a fresh body on every match (memory backend)", async () => {
      const cache = createVerifiedModelCache();
      await cache.put(HF_CONFIG_URL, new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      const a = await cache.match(HF_CONFIG_URL);
      const b = await cache.match(HF_CONFIG_URL);
      expect(new Uint8Array(await a!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(new Uint8Array(await b!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("supports delete", async () => {
      const cache = createVerifiedModelCache();
      await cache.put(HF_CONFIG_URL, new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      await expect(cache.delete(HF_CONFIG_URL)).resolves.toBe(true);
      await expect(cache.match(HF_CONFIG_URL)).resolves.toBeUndefined();
    });

    it("bounds the in-memory cache by entry count", async () => {
      const cache = createVerifiedModelCache();
      const keys = Array.from({ length: 51 }, (_, i) =>
        `${HF_CONFIG_URL}?entry=${i}`,
      );
      for (const key of keys) {
        await cache.put(key, new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
      }
      await expect(cache.match(keys[0]!)).resolves.toBeUndefined();
      await expect(cache.match(keys[keys.length - 1]!)).resolves.toBeDefined();
    });
  });

  describe("configureModelIntegrity", () => {
    it("enables custom cache and installs the verifier", () => {
      const env: { useCustomCache?: boolean; customCache?: unknown } = {};
      configureModelIntegrity(env as any);
      expect(env.useCustomCache).toBe(true);
      expect(env.customCache).toBeInstanceOf(VerifiedModelCache);
    });

    it("redirects remoteHost when a self-host mirror is configured", () => {
      vi.stubEnv("VITE_MODEL_SELF_HOST_URL", "https://models.internal.example");
      const env: { remoteHost?: string } = {};
      configureModelIntegrity(env as any);
      expect(env.remoteHost).toBe("https://models.internal.example");
    });

    it("leaves remoteHost untouched without self-host config", () => {
      const env: { remoteHost?: string } = { remoteHost: "https://huggingface.co" };
      configureModelIntegrity(env as any);
      expect(env.remoteHost).toBe("https://huggingface.co");
    });
  });
});
