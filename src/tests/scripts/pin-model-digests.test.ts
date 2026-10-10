import { describe, it, expect, vi, afterEach } from "vitest";

// The script is ESM (.mjs) without its own type declarations — the wildcard
// ambient declaration lives in src/tests/scripts/pin-model-digests.d.ts.

const TREE_OK = [
  { type: "file", path: "config.json", oid: "git-blob-oid", size: 650 },
  {
    type: "file",
    path: "onnx/model.onnx",
    oid: "git-blob-oid-2",
    size: 90387606,
    lfs: { oid: "759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e", size: 90387606 },
  },
];

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(body)).buffer,
  } as unknown as Response;
}

function bufferResponse(bytes: Uint8Array) {
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

// sha256 of "hello config" (computed: node -e "createHash('sha256').update('hello config')")
const CONFIG_HASH = "fd3ca350c0c97154558ed05097f08fee6b18f8a2ef155e32b58b29a1e8a4bcd9";

const plainBytes = new TextEncoder().encode("hello config");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pin-model-digests.mjs — digest resolution", () => {
  it("uses the LFS oid for LFS-backed files without downloading", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toContain("/tree/main");
      return jsonResponse(TREE_OK);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { resolveDigest } = await import("../../../scripts/pin-model-digests.mjs");
    const digest = await resolveDigest(
      "Xenova/all-MiniLM-L6-v2",
      "main",
      "onnx/model.onnx",
    );
    expect(digest).toBe(TREE_OK[1]!.lfs!.oid);
    // Only the tree API was hit — no file download for LFS entries.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("hashes downloaded bytes for plain (non-LFS) files", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/tree/main")) return jsonResponse(TREE_OK);
      return bufferResponse(plainBytes);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { resolveDigest } = await import("../../../scripts/pin-model-digests.mjs");
    const digest = await resolveDigest(
      "Xenova/all-MiniLM-L6-v2",
      "main",
      "config.json",
    );
    expect(digest).toBe(CONFIG_HASH);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(TREE_OK)));
    const { resolveDigest } = await import("../../../scripts/pin-model-digests.mjs");
    await expect(
      resolveDigest("Xenova/all-MiniLM-L6-v2", "main", "missing.bin"),
    ).rejects.toThrow("file not found");
  });
});

describe("pin-model-digests.mjs — manifest verification", () => {
  const manifest = {
    schemaVersion: 1,
    pinnedAt: "2026-08-03T22:07:10.533Z",
    remoteHost: "https://huggingface.co",
    models: {
      "Xenova/all-MiniLM-L6-v2": {
        revision: "main",
        files: {
          "config.json": CONFIG_HASH,
          "onnx/model.onnx": TREE_OK[1]!.lfs!.oid,
        },
      },
    },
  };

  it("reports no drift when every pinned digest matches the remote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/tree/main")) return jsonResponse(TREE_OK);
        return bufferResponse(plainBytes);
      }),
    );
    const { verifyManifest } = await import("../../../scripts/pin-model-digests.mjs");
    const drift = await verifyManifest(manifest);
    expect(drift).toEqual([]);
    // One tree lookup is shared by both files; plain files add one download.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });

  it("reports drift when the remote digest differs from the pin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/tree/main")) {
          return jsonResponse([
            TREE_OK[0],
            {
              ...TREE_OK[1],
              lfs: { oid: "0".repeat(64) },
            },
          ]);
        }
        return bufferResponse(plainBytes);
      }),
    );
    const { verifyManifest } = await import("../../../scripts/pin-model-digests.mjs");
    const drift = await verifyManifest(manifest);
    expect(drift).toHaveLength(1);
    // The LFS drift is resolved from the shared tree without a model download.
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(drift[0]).toContain("onnx/model.onnx");
  });
});
