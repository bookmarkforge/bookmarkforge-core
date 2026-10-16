import { beforeEach, describe, it, expect, vi } from "vitest";
import { createAdapter } from "../../services/integrations/cloudSync";
import type { CloudProvider } from "../../services/integrations/cloudSync.types";

const DRIVE_TOKEN = process.env.VITE_DRIVE_TEST_TOKEN;
const DROPBOX_TOKEN = process.env.VITE_DROPBOX_TEST_TOKEN;
const ONEDRIVE_TOKEN = process.env.VITE_ONEDRIVE_TEST_TOKEN;

// ---------------------------------------------------------------------------
// Mock-based adapter tests — always pass regardless of environment.
// These verify the same normalized-file-list contract that the real integration
// tests below check, but use a stubbed fetch so no API tokens are required.
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("cloudSync adapter normalization (mock)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("Google Drive — listFiles normalizes entries", async () => {
    const adapter = createAdapter("drive", "mock-token");
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        files: [
          { id: "g1", name: "backup.json", modifiedTime: "2026-08-01T12:00:00Z" },
          { id: "g2", name: "notes.json", modifiedTime: "2026-08-02T08:30:00Z" },
        ],
      }),
    );
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(2);
    expect(files[0]).toHaveProperty("id", "g1");
    expect(files[0]).toHaveProperty("name", "backup.json");
    expect(files[0]).toHaveProperty("modifiedTime");
    expect(files[1]).toHaveProperty("id", "g2");
  });

  it("Google Drive — listFiles filters malformed entries", async () => {
    const adapter = createAdapter("drive", "mock-token");
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        files: [
          { id: "ok", name: "good.json", modifiedTime: "2026-01-01" },
          { id: 123, name: "bad.json" },
          { name: "no-id.json" },
          {},
        ],
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("ok");
  });

  it("Google Drive — listFiles returns empty when API returns no files key", async () => {
    const adapter = createAdapter("drive", "mock-token");
    mockFetch.mockResolvedValue(mockJsonResponse({}));
    const files = await adapter.listFiles();
    expect(files).toEqual([]);
  });

  it("Dropbox — listFiles maps client_modified to modifiedTime", async () => {
    const adapter = createAdapter("dropbox", "mock-token");
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        entries: [
          { id: "d1", name: "sync.json", client_modified: "2026-07-15T10:00:00Z" },
        ],
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toHaveProperty("id", "d1");
    expect(files[0]).toHaveProperty("name", "sync.json");
    expect(files[0]).toHaveProperty("modifiedTime", "2026-07-15T10:00:00Z");
  });

  it("Dropbox — listFiles filters malformed entries", async () => {
    const adapter = createAdapter("dropbox", "mock-token");
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        entries: [
          { id: "d2", name: "ok.json", client_modified: "2026-01-01" },
          { id: null, name: "bad.json" },
          { name: "missing-id.json" },
        ],
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("d2");
  });

  it("OneDrive — listFiles maps value array with lastModifiedDateTime", async () => {
    const adapter = createAdapter("onedrive", "mock-token");
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        value: [
          { id: "o1", name: "drive.json", lastModifiedDateTime: "2026-05-20T14:00:00Z" },
          { id: "o2", name: "docs.json", lastModifiedDateTime: "2026-05-21T09:00:00Z" },
        ],
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(2);
    expect(files[0]).toHaveProperty("id", "o1");
    expect(files[0]).toHaveProperty("name", "drive.json");
    expect(files[0]).toHaveProperty("modifiedTime", "2026-05-20T14:00:00Z");
    expect(files[1]).toHaveProperty("id", "o2");
  });

  it("OneDrive — listFiles filters malformed entries", async () => {
    const adapter = createAdapter("onedrive", "mock-token");
    mockFetch.mockResolvedValue(
      mockJsonResponse({
        value: [
          { id: "o3", name: "valid.json", lastModifiedDateTime: "2026-01-01" },
          {},
          { id: "o4" },
        ],
      }),
    );
    const files = await adapter.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("o3");
  });

  it("all token-backed providers produce normalized {id, name, modifiedTime} shape", async () => {
    const providers: Array<[
      CloudProvider,
      Record<string, unknown>,
      string,
    ]> = [
      [
        "drive",
        { files: [{ id: "x", name: "a.json", modifiedTime: "2026-01-01" }] },
        "files",
      ],
      [
        "dropbox",
        { entries: [{ id: "x", name: "a.json", client_modified: "2026-01-01" }] },
        "entries",
      ],
      [
        "onedrive",
        { value: [{ id: "x", name: "a.json", lastModifiedDateTime: "2026-01-01" }] },
        "value",
      ],
      [
        "box",
        { entries: [{ id: "x", name: "a.json", modified_at: "2026-01-01" }] },
        "entries",
      ],
    ];

    for (const [provider, payload] of providers) {
      mockFetch.mockReset();
      const adapter = createAdapter(provider, "mock-token");
      mockFetch.mockResolvedValue(mockJsonResponse(payload));
      const files = await adapter.listFiles();
      expect(files.length).toBeGreaterThanOrEqual(1);
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});

// ---------------------------------------------------------------------------
// Real integration tests — only run when API tokens are present.
// ---------------------------------------------------------------------------
describe.runIf(DRIVE_TOKEN)("cloudSync real adapter — Google Drive", () => {
  const adapter = createAdapter("drive", DRIVE_TOKEN!);

  it("listFiles returns a normalized file list", async () => {
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    if (files.length > 0) {
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});

describe.runIf(DROPBOX_TOKEN)("cloudSync real adapter — Dropbox", () => {
  const adapter = createAdapter("dropbox", DROPBOX_TOKEN!);

  it("listFiles returns a normalized file list", async () => {
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    if (files.length > 0) {
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});

describe.runIf(ONEDRIVE_TOKEN)("cloudSync real adapter — OneDrive", () => {
  const adapter = createAdapter("onedrive", ONEDRIVE_TOKEN!);

  it("listFiles returns a normalized file list", async () => {
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    if (files.length > 0) {
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});
