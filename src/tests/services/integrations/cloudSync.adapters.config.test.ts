import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { WebDAVAdapter } from "../../../services/integrations/cloudSync.adapters.config";

describe("WebDAVAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  describe("safeWebDavSegment (internal via upload/download)", () => {
    it("rejects path traversal in download id", async () => {
      const adapter = new WebDAVAdapter({
        url: "https://dav.example.com",
      });
      await expect(adapter.downloadFile("../../etc/passwd")).rejects.toThrow(
        "WebDAVAdapter: invalid file id",
      );
    });

    it("rejects backslashes in download id", async () => {
      const adapter = new WebDAVAdapter({
        url: "https://dav.example.com",
      });
      await expect(
        adapter.downloadFile("..\\windows\\system32"),
      ).rejects.toThrow("WebDAVAdapter: invalid file id");
    });

    it("rejects encoded slash in a display name", async () => {
      const adapter = new WebDAVAdapter({
        url: "https://dav.example.com",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          "<href>/safe.json</href><displayname>safe%2Fname.json</displayname>",
      });
      await expect(adapter.listFiles()).resolves.toEqual([]);
    });

    it("accepts ordinary display names containing f and x", async () => {
      const adapter = new WebDAVAdapter({
        url: "https://dav.example.com",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () =>
          "<href>/file.json</href><displayname>file.json</displayname>",
      });
      await expect(adapter.listFiles()).resolves.toEqual([
        { id: "/file.json", name: "file.json" },
      ]);
    });
  });

  describe("authenticate", () => {
    it("returns Basic auth header from config", async () => {
      const adapter = new WebDAVAdapter({
        url: "https://dav.example.com",
        username: "alice",
        password: "secret",
      });
      const auth = await adapter.authenticate();
      expect(auth).toBe("Basic " + btoa("alice:secret"));
    });

    it("throws when url is missing", async () => {
      const adapter = new WebDAVAdapter();
      await expect(adapter.authenticate()).rejects.toThrow(
        "WebDAVAdapter: missing configuration",
      );
    });
  });
});
