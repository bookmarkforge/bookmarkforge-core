import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdapter } from "../../../services/integrations/cloudSync";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BufferMock = vi.fn() as any;
BufferMock.byteLength = vi.fn(() => 0);
BufferMock.from = vi.fn((data: ArrayBuffer) => ({ data }));
BufferMock.alloc = vi.fn((size: number) => new Uint8Array(size));
BufferMock.concat = vi.fn((list: Uint8Array[]) => {
  const total = list.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of list) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
});
BufferMock.isBuffer = vi.fn(() => false);
vi.stubGlobal("Buffer", BufferMock);

describe("cloudSync adapters contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("drive listFiles returns normalized format", async () => {
    const adapter = createAdapter("drive", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [{ id: "1", name: "a.json", modifiedTime: "2026-01-01" }],
      }),
    });

    const files = await adapter.listFiles();
    expect(files).toEqual([
      { id: "1", name: "a.json", modifiedTime: "2026-01-01" },
    ]);
  });

  it("drive uploadFile and downloadFile work on success", async () => {
    const adapter = createAdapter("drive", "token");
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "drive-file-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      });

    const id = await adapter.uploadFile(
      "/tmp/data.json",
      '{"ok":true}',
      "application/json",
    );
    expect(id).toBe("drive-file-1");

    const blob = await adapter.downloadFile("drive-file-1");
    expect(blob).toBeDefined();
  });

  it("drive uploadFile fails on HTTP error", async () => {
    const adapter = createAdapter("drive", "token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(
      adapter.uploadFile("/tmp/data.json", "{}", "application/json"),
    ).rejects.toThrow();
  });

  it("dropbox listFiles mapea client_modified a modifiedTime", async () => {
    const adapter = createAdapter("dropbox", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        entries: [{ id: "db1", name: "b.json", client_modified: "2026-01-01" }],
      }),
    });

    const files = await adapter.listFiles();
    expect(files[0]).toEqual({
      id: "db1",
      name: "b.json",
      modifiedTime: "2026-01-01",
    });
  });

  it("dropbox uploadFile and downloadFile work on success", async () => {
    const adapter = createAdapter("dropbox", "token");
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "db-file-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      });

    const id = await adapter.uploadFile(
      "/tmp/drop.json",
      '{"a":1}',
      "application/json",
    );
    expect(id).toBe("db-file-1");

    const data = await adapter.downloadFile("/tmp/drop.json");
    expect(data).toBeDefined();
  });

  it("dropbox downloadFile fails on HTTP error", async () => {
    const adapter = createAdapter("dropbox", "token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(adapter.downloadFile("/tmp/missing.json")).rejects.toThrow(
      "Dropbox download failed",
    );
  });

  it("bounds binary downloads for every token-backed provider", async () => {
    const providers = ["dropbox", "onedrive", "box", "pcloud"] as const;
    for (const provider of providers) {
      const adapter = createAdapter(provider, "token");
      const cancel = vi.fn().mockResolvedValue(undefined);
      const arrayBuffer = vi.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({
          "content-length": String(100 * 1024 * 1024 + 1),
        }),
        body: { cancel },
        arrayBuffer,
      });

      await expect(adapter.downloadFile("remote-id")).rejects.toThrow(
        "Cloud download exceeds",
      );
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(arrayBuffer).not.toHaveBeenCalled();
      mockFetch.mockReset();
    }
  });

  it("onedrive listFiles mapea lastModifiedDateTime", async () => {
    const adapter = createAdapter("onedrive", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          { id: "od1", name: "c.json", lastModifiedDateTime: "2026-01-01" },
        ],
      }),
    });

    const files = await adapter.listFiles();
    expect(files[0]).toEqual({
      id: "od1",
      name: "c.json",
      modifiedTime: "2026-01-01",
    });
  });

  it("onedrive uploadFile and downloadFile work on success", async () => {
    const adapter = createAdapter("onedrive", "token");
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "od-file-1" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      });

    const id = await adapter.uploadFile(
      "/tmp/one.json",
      '{"x":1}',
      "application/json",
    );
    expect(id).toBe("od-file-1");

    const data = await adapter.downloadFile("od-file-1");
    expect(data).toBeDefined();
  });

  it("webdav listFiles parses basic XML", async () => {
    const adapter = createAdapter("webdav", undefined, {
      url: "https://dav.example.com",
      username: "u",
      password: "p",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        "<d:href>/a.json</d:href><d:displayname>a.json</d:displayname>",
    });

    const files = await adapter.listFiles();
    expect(files[0]).toEqual({ id: "/a.json", name: "a.json" });
  });

  it("webdav listFiles supports tags without a namespace prefix", async () => {
    const adapter = createAdapter("webdav", undefined, {
      url: "https://dav.example.com",
      username: "u",
      password: "p",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        "<href>/plain.json</href><displayname>plain.json</displayname>",
    });

    const files = await adapter.listFiles();
    expect(files[0]).toEqual({ id: "/plain.json", name: "plain.json" });
  });

  it("webdav rejects encoded traversal and unsafe display names", async () => {
    const adapter = createAdapter("webdav", undefined, {
      url: "https://dav.example.com",
      username: "u",
      password: "p",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        "<href>/safe.json</href><displayname>../evil.json</displayname><href>/safe2.json</href><displayname>safe%2Fname.json</displayname>",
    });

    const files = await adapter.listFiles();
    expect(files).toEqual([]);
  });

  it("webdav listFiles fails with empty payload", async () => {
    const adapter = createAdapter("webdav", undefined, {
      url: "https://dav.example.com",
      username: "u",
      password: "p",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    await expect(adapter.listFiles()).rejects.toThrow(
      "WebDAV list_files returned empty payload",
    );
  });

  it("webdav uploadFile and downloadFile work on success", async () => {
    const adapter = createAdapter("webdav", undefined, {
      url: "https://dav.example.com",
      username: "u",
      password: "p",
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      });

    const id = await adapter.uploadFile(
      "/folder/a.json",
      '{"v":1}',
      "application/json",
    );
    expect(id).toBe("a.json");

    const data = await adapter.downloadFile("/a.json");
    expect(data).toBeDefined();
  });

  it("pcloud listFiles fails if result != 0", async () => {
    const adapter = createAdapter("pcloud", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 500, error: "bad request" }),
    });

    await expect(adapter.listFiles()).rejects.toThrow(
      "pCloud error: bad request",
    );
  });

  it("pcloud listFiles fails with a malformed payload", async () => {
    const adapter = createAdapter("pcloud", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ metadata: { contents: [] } }),
    });

    await expect(adapter.listFiles()).rejects.toThrow(
      "pCloud list_files returned malformed payload",
    );
  });

  it("pcloud uploadFile returns fileid on success", async () => {
    const adapter = createAdapter("pcloud", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 0, fileids: ["pc-1"] }),
    });

    const id = await adapter.uploadFile(
      "/folder/pc.json",
      '{"k":1}',
      "application/json",
    );
    expect(id).toBe("pc-1");
  });

  it("pcloud uploadFile fails when the API returns a logical error", async () => {
    const adapter = createAdapter("pcloud", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ result: 2001, error: "permission denied" }),
    });

    await expect(
      adapter.uploadFile("/folder/pc.json", '{"k":1}', "application/json"),
    ).rejects.toThrow("pCloud error: permission denied");
  });

  it("pcloud uploadFile fails with a malformed payload", async () => {
    const adapter = createAdapter("pcloud", "token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ fileids: ["pc-1"] }),
    });

    await expect(
      adapter.uploadFile("/folder/pc.json", '{"k":1}', "application/json"),
    ).rejects.toThrow("pCloud upload returned malformed payload");
  });
});
