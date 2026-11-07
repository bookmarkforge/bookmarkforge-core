/**
 * Tests for AttachmentStore — durable persistence of block-editor
 * attachments (blob: ObjectURLs → stable bmf-attachment:// refs).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  attachmentStore,
  ATTACHMENT_URL_PREFIX,
  MAX_ATTACHMENT_BYTES,
  type AttachmentDb,
} from "../../services/documentAttachments";

type StoredRecord = {
  id: string;
  documentId: string;
  filename: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  createdAt: string;
};

describe("AttachmentStore", () => {
  let records: StoredRecord[];
  let upsertMock: ReturnType<typeof vi.fn>;
  let mockDb: AttachmentDb;

  beforeEach(() => {
    records = [];
    upsertMock = vi.fn(async (doc: StoredRecord) => {
      records.push(doc);
    });
    const findMock = vi.fn((query?: { selector?: { documentId?: string } }) => ({
      exec: async () =>
        records
          .filter(
            (r) =>
              !query?.selector?.documentId ||
              r.documentId === query.selector.documentId,
          )
          .map((r) => ({ toJSON: () => r })),
    }));
    mockDb = {
      documentAttachments: { upsert: upsertMock, find: findMock },
    } as unknown as AttachmentDb;

    let counter = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:hydrated-${counter++}`),
      revokeObjectURL: vi.fn(),
    });
  });

  describe("persistFile", () => {
    it("stores the bytes as an encrypted data: URL and returns a stable id", async () => {
      const file = new File(["hello"], "photo.png", { type: "image/png" });
      const id = await attachmentStore.persistFile(
        "doc-1",
        file,
        "photo.png",
        mockDb,
      );

      expect(id).toMatch(/^att-doc-1-[a-f0-9]{24}$/);
      expect(upsertMock).toHaveBeenCalledTimes(1);
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          documentId: "doc-1",
          filename: "photo.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,aGVsbG8=",
          size: 5,
        }),
      );
    });

    it("dedups identical uploads to the same id", async () => {
      const file = new File(["hello"], "photo.png", { type: "image/png" });
      const a = await attachmentStore.persistFile("doc-1", file, "photo.png", mockDb);
      const b = await attachmentStore.persistFile("doc-1", file, "photo.png", mockDb);
      expect(a).toBe(b);
      expect(upsertMock).toHaveBeenCalledTimes(2); // idempotent upsert
    });

    it("rejects oversized attachments before touching the database", async () => {
      const big = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)]);
      await expect(
        attachmentStore.persistFile("doc-1", big),
      ).rejects.toThrow(/limit/);
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it("throws a clear error when the collection is missing", async () => {
      const file = new File(["hello"], "photo.png", { type: "image/png" });
      await expect(
        attachmentStore.persistFile("doc-1", file, "photo.png", {} as never),
      ).rejects.toThrow(/documentAttachments collection/);
    });
  });

  describe("persistBlocks", () => {
    it("rewrites registered blob: URLs to stable refs and leaves others alone", async () => {
      attachmentStore.register("blob:live-1", "att-doc-1-abc");

      const blocks = [
        { type: "image", props: { url: "blob:live-1" } },
        { type: "image", props: { url: "data:image/png;base64,xyz" } },
        { type: "image", props: { url: "blob:foreign" } },
        {
          type: "columnLayout",
          children: [{ type: "column", children: [{ type: "image", props: { url: "blob:live-1" } }] }],
        },
      ];

      const out = (await attachmentStore.persistBlocks(
        "doc-1",
        blocks,
        mockDb,
      )) as Array<{ props?: { url?: string }; children?: unknown[] }>;

      expect(out[0]!.props!.url).toBe(`${ATTACHMENT_URL_PREFIX}att-doc-1-abc`);
      expect(out[1]!.props!.url).toBe("data:image/png;base64,xyz");
      expect(out[2]!.props!.url).toBe("blob:foreign");
      const nested = out[3]!.children![0] as { children: unknown[] };
      const leaf = (nested as { children: Array<{ props: { url: string } }> })
        .children[0]!;
      expect(leaf.props.url).toBe(`${ATTACHMENT_URL_PREFIX}att-doc-1-abc`);
    });
  });

  describe("round trip persist → hydrate → persist", () => {
    it("hydrates refs back to ObjectURLs and round-trips to the same ref", async () => {
      attachmentStore.register("blob:live-1", "att-doc-1-abc");
      records.push({
        id: "att-doc-1-abc",
        documentId: "doc-1",
        filename: "photo.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8=",
        size: 5,
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      const persisted = (await attachmentStore.persistBlocks(
        "doc-1",
        [{ type: "image", props: { url: "blob:live-1" } }],
        mockDb,
      )) as Array<{ props: { url: string } }>;

      const hydrated = (await attachmentStore.hydrateBlocks(
        "doc-1",
        persisted,
        mockDb,
      )) as Array<{ props: { url: string } }>;
      expect(hydrated[0]!.props.url).toBe("blob:hydrated-0");

      const roundTripped = (await attachmentStore.persistBlocks(
        "doc-1",
        hydrated,
        mockDb,
      )) as Array<{ props: { url: string } }>;
      expect(roundTripped[0]!.props.url).toBe(
        `${ATTACHMENT_URL_PREFIX}att-doc-1-abc`,
      );
    });

    it("leaves an unresolvable ref untouched (orphan guard)", async () => {
      const hydrated = await attachmentStore.hydrateBlocks(
        "doc-1",
        [{ type: "image", props: { url: `${ATTACHMENT_URL_PREFIX}att-missing` } }],
        mockDb,
      );
      const block = (hydrated as Array<{ props: { url: string } }>)[0]!;
      expect(block.props.url).toBe(`${ATTACHMENT_URL_PREFIX}att-missing`);
    });
  });

  describe("persistText / hydrateText", () => {
    it("rewrites registered blob: image refs in markdown", async () => {
      attachmentStore.register("blob:live-2", "att-doc-1-xyz");
      const text = "Hello ![img](blob:live-2) world ![other](blob:foreign)";
      const out = await attachmentStore.persistText("doc-1", text);
      expect(out).toBe(
        `Hello ![img](${ATTACHMENT_URL_PREFIX}att-doc-1-xyz) world ![other](blob:foreign)`,
      );
    });

    it("hydrates refs back to ObjectURLs in markdown", async () => {
      records.push({
        id: "att-doc-1-xyz",
        documentId: "doc-1",
        filename: "img.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8=",
        size: 5,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const out = await attachmentStore.hydrateText(
        "doc-1",
        `Hello ![img](${ATTACHMENT_URL_PREFIX}att-doc-1-xyz) world`,
        mockDb,
      );
      expect(out).toBe("Hello ![img](blob:hydrated-0) world");
    });
  });

  describe("resolveTextForExport", () => {
    it("rewrites refs to self-contained data: URLs", async () => {
      records.push({
        id: "att-doc-1-xyz",
        documentId: "doc-1",
        filename: "img.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8=",
        size: 5,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const out = await attachmentStore.resolveTextForExport(
        "doc-1",
        `![img](${ATTACHMENT_URL_PREFIX}att-doc-1-xyz)`,
        mockDb,
      );
      expect(out).toBe("![img](data:image/png;base64,aGVsbG8=)");
    });

    it("returns text unchanged when it has no refs", async () => {
      const out = await attachmentStore.resolveTextForExport(
        "doc-1",
        "plain text ![img](data:image/png;base64,abc)",
        mockDb,
      );
      expect(out).toBe("plain text ![img](data:image/png;base64,abc)");
    });
  });

  describe("revokeDocumentUrls", () => {
    it("revokes every ObjectURL hydrated for the document", async () => {
      records.push({
        id: "att-doc-1-abc",
        documentId: "doc-1",
        filename: "photo.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8=",
        size: 5,
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const hydrated = (await attachmentStore.hydrateBlocks(
        "doc-1",
        [{ type: "image", props: { url: `${ATTACHMENT_URL_PREFIX}att-doc-1-abc` } }],
        mockDb,
      )) as Array<{ props: { url: string } }>;
      await attachmentStore.hydrateText(
        "doc-1",
        `![alt](${ATTACHMENT_URL_PREFIX}att-doc-1-abc)`,
        mockDb,
      );
      expect(hydrated[0]!.props.url).toBe("blob:hydrated-0");

      const revokeMock = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
      expect(revokeMock).not.toHaveBeenCalled();
      attachmentStore.revokeDocumentUrls("doc-1");

      // Both block and markdown hydration URLs are released.
      expect(revokeMock).toHaveBeenCalledWith("blob:hydrated-0");
      expect(revokeMock).toHaveBeenCalledWith("blob:hydrated-1");
    });

    it("is a no-op for a document with no hydrated URLs", async () => {
      const revokeMock = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
      attachmentStore.revokeDocumentUrls("doc-never-opened");
      expect(revokeMock).not.toHaveBeenCalled();
    });
  });
});
