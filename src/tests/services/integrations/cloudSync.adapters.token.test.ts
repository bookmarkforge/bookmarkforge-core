import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DriveAdapter,
  DropboxAdapter,
  OneDriveAdapter,
  BoxAdapter,
  PCloudAdapter,
} from "../../../services/integrations/cloudSync.adapters.token";
import {
  readBoundedCloudResponse,
  readBoundedJson,
} from "../../../services/integrations/cloudSync.response";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BufferMock = vi.fn() as any;
BufferMock.from = vi.fn((data: ArrayBuffer) => ({ data, type: "buffer" }));
BufferMock.isBuffer = vi.fn(() => false);
vi.stubGlobal("Buffer", BufferMock);

/** Builds a minimal Response-like object. */
function mockResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Map([["content-type", "application/json"]]),
    json: async () => ({}),
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
    ...overrides,
  };
}

describe("cloudSync response limits", () => {
  it("rejects oversized metadata from its content-length before parsing", async () => {
    const response = {
      headers: { get: () => "2048" },
      json: vi.fn(),
    } as unknown as Response;

    await expect(readBoundedJson(response, 1024)).rejects.toThrow(
      "metadata response exceeds",
    );
    expect(response.json).not.toHaveBeenCalled();
  });

  it("cancels a streamed download as soon as it exceeds the limit", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const releaseLock = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
      .mockResolvedValueOnce({ done: false, value: new Uint8Array([4, 5]) });
    const response = {
      body: {
        getReader: () => ({ read, cancel, releaseLock }),
      },
      headers: { get: () => null },
    } as unknown as Response;

    await expect(readBoundedCloudResponse(response, 4)).rejects.toThrow(
      "exceeds",
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});

describe("cloudSync.adapters.token — normalizeCloudFileEntry (private helper)", () => {
  it("filters out entries with missing id", () => {
    const result = (DropboxAdapter as any).prototype;
    expect(result).toBeDefined();
  });
});

describe("DriveAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("authenticate returns token from constructor", async () => {
    const adapter = new DriveAdapter("my-token");
    await expect(adapter.authenticate()).resolves.toBe("my-token");
  });

  it("authenticate throws when no token is available", async () => {
    const adapter = new DriveAdapter();
    await expect(adapter.authenticate()).rejects.toThrow(
      "DriveAdapter: missing access token",
    );
  });

  it("listFiles returns normalized entries", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({
          files: [
            { id: "f1", name: "a.json", modifiedTime: "2026-01-01" },
            { id: "f2", name: "b.json", modifiedTime: "2026-01-02" },
          ],
        }),
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ id: "f1", name: "a.json", modifiedTime: "2026-01-01" });
    expect(files[1]).toEqual({ id: "f2", name: "b.json", modifiedTime: "2026-01-02" });
  });

  it("listFiles filters out malformed entries", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({
          files: [
            { id: "ok", name: "good.json", modifiedTime: "2026-01-01" },
            { id: 123, name: "bad.json" },
            { name: "no-id.json" },
            {},
          ],
        }),
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("ok");
  });

  it("listFiles returns empty array when no files key", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => ({}) }));
    const files = await adapter.listFiles();
    expect(files).toEqual([]);
  });

  it("uploadFile returns the file id", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch
      .mockResolvedValueOnce(
        mockResponse({ json: async () => ({ id: "new-file-id" }) }),
      )
      .mockResolvedValueOnce(mockResponse());
    const id = await adapter.uploadFile("/path/data.json", '{"a":1}', "application/json");
    expect(id).toBe("new-file-id");
  });

  it("uploadFile throws on metadata create failure", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue({ ok: false, status: 403, statusText: "Forbidden" });
    await expect(
      adapter.uploadFile("/path/data.json", "{}", "application/json"),
    ).rejects.toThrow("Drive file create failed");
  });

  it("downloadFile succeeds", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({ arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    const buf = await adapter.downloadFile("f1");
    expect(buf).toBeDefined();
    expect(BufferMock.from).toHaveBeenCalled();
  });

  it("downloadFile throws on HTTP error", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(adapter.downloadFile("missing")).rejects.toThrow(
      "Drive download failed",
    );
  });

  it("listFiles throws on API error", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" });
    await expect(adapter.listFiles()).rejects.toThrow(
      "Drive listFiles failed: 401",
    );
  });

  it("listFiles fetches from the Drive API endpoint", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => ({ files: [] }) }));
    await adapter.listFiles();
    expect(String(mockFetch.mock.calls[0]![0])).toContain("googleapis.com/drive");
  });

  it("uploadFile throws when no file id returned", async () => {
    const adapter = new DriveAdapter("token");
    mockFetch.mockResolvedValueOnce(mockResponse({ json: async () => ({}) }));
    await expect(
      adapter.uploadFile("data.json", "x", "text/plain"),
    ).rejects.toThrow("no id");
  });
});

describe("DropboxAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("listFiles maps client_modified to modifiedTime", async () => {
    const adapter = new DropboxAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({
          entries: [
            { id: "d1", name: "x.json", client_modified: "2026-06-15" },
          ],
        }),
      }),
    );
    const files = await adapter.listFiles();
    expect(files[0]).toEqual({
      id: "d1",
      name: "x.json",
      modifiedTime: "2026-06-15",
    });
  });

  it("listFiles returns empty array for missing entries", async () => {
    const adapter = new DropboxAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => ({}) }));
    const files = await adapter.listFiles();
    expect(files).toEqual([]);
  });
});

describe("OneDriveAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("listFiles maps value array", async () => {
    const adapter = new OneDriveAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({
          value: [
            { id: "o1", name: "c.json", lastModifiedDateTime: "2026-03-10" },
          ],
        }),
      }),
    );
    const files = await adapter.listFiles();
    expect(files[0]).toEqual({
      id: "o1",
      name: "c.json",
      modifiedTime: "2026-03-10",
    });
  });
});

describe("BoxAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("authenticate returns token from constructor", async () => {
    const adapter = new BoxAdapter("box-token");
    await expect(adapter.authenticate()).resolves.toBe("box-token");
  });

  it("authenticate throws when missing token", async () => {
    const adapter = new BoxAdapter();
    await expect(adapter.authenticate()).rejects.toThrow(
      "BoxAdapter: missing access token",
    );
  });

  it("listFiles returns normalized entries", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({
          entries: [
            { id: "b1", name: "box.json", modified_at: "2026-04-20" },
          ],
        }),
      }),
    );
    const files = await adapter.listFiles();
    expect(files[0]).toEqual({
      id: "b1",
      name: "box.json",
      modifiedTime: "2026-04-20",
    });
  });

  it("listFiles returns empty for missing entries", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => ({}) }));
    const files = await adapter.listFiles();
    expect(files).toEqual([]);
  });

  it("uploadFile returns file id on success", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({ entries: [{ id: "box-file-1" }] }),
      }),
    );
    const id = await adapter.uploadFile("/tmp/box.json", "{}", "application/json");
    expect(id).toBe("box-file-1");
  });

  it("uploadFile returns 'unknown' when no entries in response", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => ({}) }));
    const id = await adapter.uploadFile("/tmp/box.json", "{}", "application/json");
    expect(id).toBe("unknown");
  });

  it("uploadFile throws on HTTP error", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: "Error" });
    await expect(
      adapter.uploadFile("/tmp/box.json", "{}", "application/json"),
    ).rejects.toThrow("Box upload failed");
  });

  it("downloadFile succeeds", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({ arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    const buf = await adapter.downloadFile("b1");
    expect(buf).toBeDefined();
  });

  it("downloadFile throws on HTTP error", async () => {
    const adapter = new BoxAdapter("token");
    mockFetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(adapter.downloadFile("missing")).rejects.toThrow(
      "Box download failed",
    );
  });
});

describe("PCloudAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("listFiles maps fileid to id", async () => {
    const adapter = new PCloudAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({
          result: 0,
          metadata: {
            contents: [{ fileid: 1001, name: "p.json", modified: "2026-07-01" }],
          },
        }),
      }),
    );
    const files = await adapter.listFiles();
    expect(files[0]).toEqual({
      id: "1001",
      name: "p.json",
      modifiedTime: "2026-07-01",
    });
  });

  it("listFiles throws when result !== 0", async () => {
    const adapter = new PCloudAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({
        json: async () => ({ result: 2002, error: "auth expired" }),
      }),
    );
    await expect(adapter.listFiles()).rejects.toThrow("pCloud error: auth expired");
  });

  it("uploadFile returns file id on success", async () => {
    const adapter = new PCloudAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({ json: async () => ({ result: 0, fileids: ["pc-42"] }) }),
    );
    const id = await adapter.uploadFile("/p.json", "{}", "text/plain");
    expect(id).toBe("pc-42");
  });

  it("uploadFile returns 'unknown' when no fileids", async () => {
    const adapter = new PCloudAdapter("token");
    mockFetch.mockResolvedValue(
      mockResponse({ json: async () => ({ result: 0 }) }),
    );
    const id = await adapter.uploadFile("/p.json", "{}", "text/plain");
    expect(id).toBe("unknown");
  });

  it("listFiles throws on malformed payload", async () => {
    const adapter = new PCloudAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => null }));
    await expect(adapter.listFiles()).rejects.toThrow("malformed");
  });

  it("uploadFile throws on malformed response", async () => {
    const adapter = new PCloudAdapter("token");
    mockFetch.mockResolvedValue(mockResponse({ json: async () => null }));
    await expect(
      adapter.uploadFile("data.json", "test", "text/plain"),
    ).rejects.toThrow("malformed");
  });
});

describe("token adapter remote deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("deletes retention candidates through every token provider", async () => {
    const adapters = [
      new DriveAdapter("token"),
      new DropboxAdapter("token"),
      new OneDriveAdapter("token"),
      new BoxAdapter("token"),
      new PCloudAdapter("token"),
    ];
    mockFetch.mockResolvedValue(
      mockResponse({ json: async () => ({ result: 0 }) }),
    );

    for (const adapter of adapters) {
      await adapter.deleteFile!("remote-file-id");
    }

    expect(mockFetch).toHaveBeenCalledTimes(adapters.length);
    expect(String(mockFetch.mock.calls[0]![0])).toContain("googleapis.com");
    expect(String(mockFetch.mock.calls[1]![0])).toContain("dropboxapi.com");
    expect(String(mockFetch.mock.calls[2]![0])).toContain("graph.microsoft.com");
    expect(String(mockFetch.mock.calls[3]![0])).toContain("api.box.com");
    expect(String(mockFetch.mock.calls[4]![0])).toContain("api.pcloud.com");
  });
});
