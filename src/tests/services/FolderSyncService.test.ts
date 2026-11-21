/**
 * FolderSyncService tests — F1-E folder mode.
 * WebRTC-style convergence: repeated syncs are idempotent, edits propagate
 * in both directions, and both-side edits resolve deterministically.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FolderSyncService } from "../../services/FolderSyncService";
import { attachmentStore } from "../../services/documentAttachments";
import { STORAGE_KEYS } from "../../constants/storage-keys";

interface FakeDoc {
  id: string;
  title: string;
  tags: string[];
  textContent?: string;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  revision: string;
  folderId: string;
  blocks: unknown[];
  summary: string;
  links: string[];
  embedding: number[];
  processed: boolean;
  isPrivate: boolean;
  incrementalPatch: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function makeDoc(overrides: Partial<FakeDoc> = {}): FakeDoc {
  const doc: FakeDoc = {
    id: "doc-1",
    title: "My Note",
    tags: ["document"],
    textContent: "# Hello",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isDeleted: false,
    revision: "1-aaaa",
    folderId: "root",
    blocks: [],
    summary: "",
    links: [],
    embedding: [],
    processed: false,
    isPrivate: false,
    incrementalPatch: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
  doc.incrementalPatch.mockImplementation(async (patch: Record<string, unknown>) => {
    const height = parseInt(String(doc.revision).split("-")[0] ?? "1", 10) || 1;
    const next = { ...doc, ...patch, revision: `${height + 1}-zzzz` };
    Object.assign(doc, patch, { revision: next.revision });
    return next;
  });
  return doc;
}

function makeBookmark(overrides: Record<string, unknown> = {}) {
  const doc = {
    id: "b1",
    title: "A Page",
    tags: ["bookmark"],
    url: "https://example.com/a",
    urlHash: "hash-a",
    content: "Article body",
    summary: "Summary",
    relatedLinks: [] as string[],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isDeleted: false,
    revision: "1-aaaa",
    visitCount: 0,
    embedding: [],
    processed: false,
    isPrivate: false,
    incrementalPatch: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
  doc.incrementalPatch.mockImplementation(async (patch: Record<string, unknown>) => {
    const height = parseInt(String(doc.revision).split("-")[0] ?? "1", 10) || 1;
    const next = { ...doc, ...patch, revision: `${height + 1}-zzzz` };
    Object.assign(doc, patch, { revision: next.revision });
    return next;
  });
  return doc;
}

function makeDb(docs: FakeDoc[], bookmarks: ReturnType<typeof makeBookmark>[] = []) {
  const insertDoc = vi.fn(async (data: Record<string, unknown>) =>
    makeDoc({ ...(data as Partial<FakeDoc>), revision: "1-new" }),
  );
  const insertBookmark = vi.fn(async (data: Record<string, unknown>) =>
    makeBookmark({ ...data, revision: "1-new" }),
  );
  return {
    documents: {
      find: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue(docs),
      })),
      insert: insertDoc,
    },
    bookmarks: {
      find: vi.fn(() => ({
        exec: vi.fn().mockResolvedValue(bookmarks),
      })),
      insert: insertBookmark,
    },
  };
}

class FakeFs {
  files = new Map<string, { content: string; lastModified: number }>();
  attachments = new Map<string, Uint8Array>();
  written: string[] = [];
  removed: string[] = [];

  set(name: string, content: string, lastModified = 0): void {
    this.files.set(name, { content, lastModified });
  }

  setAttachment(name: string, bytes: Uint8Array): void {
    this.attachments.set(name, bytes);
  }

  async readMarkdownFilesWithMeta() {
    return [...this.files.entries()].map(([name, f]) => ({
      name,
      content: f.content,
      lastModified: f.lastModified,
    }));
  }

  async writeMarkdownFile(name: string, content: string): Promise<void> {
    this.files.set(name, { content, lastModified: Date.now() });
    this.written.push(name);
  }

  async removeMarkdownFile(name: string): Promise<void> {
    this.files.delete(name);
    this.removed.push(name);
  }

  async readAttachmentFiles() {
    return [...this.attachments.entries()].map(([name, bytes]) => ({
      name,
      bytes,
    }));
  }

  async writeAttachmentFile(name: string, bytes: Uint8Array): Promise<void> {
    this.attachments.set(name, bytes);
  }

  async removeAttachmentFile(name: string): Promise<void> {
    this.attachments.delete(name);
  }
}

const NOTE = (id: string, title: string, body: string, updated: string) =>
  `---\ntitle: "${title}"\ntags: ["document"]\nbmf_id: "${id}"\nbmf_type: "document"\ncreated: "2026-01-01T00:00:00.000Z"\nupdated: "${updated}"\n---\n\n${body}`;

function newService(): FolderSyncService {
  return new FolderSyncService();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FolderSyncService", () => {
  it("seeds a plain folder file as a new document and writes back bmf_id", async () => {
    const fs = new FakeFs();
    fs.set("hello.md", "# Hello\n", 1000);
    const db = makeDb([]);

    const result = await newService().sync(db as never, fs as never);

    expect(result.inserted).toBe(1);
    expect(result.writtenFiles).toBe(1);
    expect(db.documents.insert).toHaveBeenCalledTimes(1);
    const written = fs.files.get("hello.md")!.content;
    expect(written).toContain("bmf_id");
    // A frontmatter-less file promotes its H1 to the title.
    expect(written).toContain('title: "Hello"');
  });

  it("exports a document that has no file to the folder", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({ id: "d1", title: "Note", textContent: "# Body" });
    const db = makeDb([doc]);

    const result = await newService().sync(db as never, fs as never);

    expect(result.writtenFiles).toBe(1);
    expect(fs.files.get("note.md")!.content).toContain('bmf_id: "d1"');
    expect(fs.files.get("note.md")!.content).toContain("# Body");
  });

  it("propagates a folder edit into the document", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({
      id: "d1",
      title: "Note",
      textContent: "# Old",
      revision: "1-aaaa",
    });
    const db = makeDb([doc]);

    // First sync establishes the baseline.
    await newService().sync(db as never, fs as never);

    // External edit on disk (content changes, mtime advances).
    fs.set(
      "note.md",
      NOTE("d1", "Note", "# New", "2026-01-02T00:00:00.000Z"),
      Date.parse("2026-01-02T00:00:00.000Z"),
    );

    const service = newService();
    const result = await service.sync(db as never, fs as never);

    expect(result.updatedDocs).toBe(1);
    expect(doc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ textContent: "# New" }),
    );
  });

  it("propagates a document edit into the folder file", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({
      id: "d1",
      title: "Note",
      textContent: "# Old",
      revision: "1-aaaa",
    });
    const db = makeDb([doc]);

    const service = newService();
    await service.sync(db as never, fs as never);

    // App edit: revision advances.
    doc.revision = "2-bbbb";
    doc.textContent = "# Updated";
    const result = await service.sync(db as never, fs as never);

    expect(result.writtenFiles).toBe(1);
    expect(fs.files.get("note.md")!.content).toContain("# Updated");
  });

  it("is idempotent — a second unchanged sync does nothing", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({ id: "d1", title: "Note", textContent: "# Body" });
    const db = makeDb([doc]);

    const service = newService();
    await service.sync(db as never, fs as never);

    const result = await service.sync(db as never, fs as never);
    expect(result.unchanged).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.updatedDocs).toBe(0);
    expect(result.writtenFiles).toBe(0);
  });

  it("resolves a both-side edit with the newer side winning (file wins)", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({
      id: "d1",
      title: "Note",
      textContent: "# Old",
      updatedAt: "2026-01-01T00:00:00.000Z",
      revision: "1-aaaa",
    });
    const db = makeDb([doc]);

    const service = newService();
    await service.sync(db as never, fs as never);

    // Both sides edit. The file's mtime is newer than the doc's updatedAt.
    doc.revision = "2-bbbb";
    doc.updatedAt = "2026-01-02T00:00:00.000Z";
    doc.textContent = "# Doc edit";
    fs.set(
      "note.md",
      NOTE("d1", "Note", "# File edit", "2026-01-03T00:00:00.000Z"),
      Date.parse("2026-01-03T00:00:00.000Z"),
    );

    const result = await service.sync(db as never, fs as never);

    expect(result.conflicts).toBe(1);
    // File mtime (2026-01-03) > doc updatedAt (2026-01-02) → file wins.
    expect(doc.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({ textContent: "# File edit" }),
    );
  });

  it("propagates a document deletion by removing the file", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({ id: "d1", title: "Note", textContent: "# Body" });
    const db = makeDb([doc]);

    const service = newService();
    await service.sync(db as never, fs as never);

    // Document disappears from the collection.
    db.documents.find.mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });

    const result = await service.sync(db as never, fs as never);
    expect(result.removedFiles).toBe(1);
    expect(fs.removed).toContain("note.md");
  });

  it("propagates a file deletion by removing the document", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({ id: "d1", title: "Note", textContent: "# Body" });
    const db = makeDb([doc]);

    const service = newService();
    await service.sync(db as never, fs as never);

    // File disappears from the folder.
    fs.files.delete("note.md");

    const result = await service.sync(db as never, fs as never);
    expect(result.removedDocs).toBe(1);
    expect(doc.remove).toHaveBeenCalled();
  });

  it("persists sync state so a fresh instance still sees convergence", async () => {
    const fs = new FakeFs();
    const doc = makeDoc({ id: "d1", title: "Note", textContent: "# Body" });
    const db = makeDb([doc]);

    await newService().sync(db as never, fs as never);
    expect(localStorage.getItem(STORAGE_KEYS.FOLDER_SYNC_STATE)).toBeTruthy();

    // A brand-new service (same localStorage) sees no changes.
    const result = await newService().sync(db as never, fs as never);
    expect(result.unchanged).toBe(1);
  });

  describe("bookmarks", () => {
    it("seeds a bookmark file and round-trips url/content", async () => {
      const fs = new FakeFs();
      fs.set("a-page.md", BOOKMARK_NOTE("", "A Page", "https://example.com/a", "# Body"), 1000);
      const db = makeDb([]);

      const result = await newService().sync(db as never, fs as never);

      expect(result.inserted).toBe(1);
      expect(db.bookmarks.insert).toHaveBeenCalledTimes(1);
      const inserted = db.bookmarks.insert.mock.calls[0]![0] as Record<string, unknown>;
      expect(inserted.url).toBe("https://example.com/a");
      const written = fs.files.get("a-page.md")!.content;
      expect(written).toContain('bmf_type: "bookmark"');
      expect(written).toContain("# Body");
    });

    it("exports a bookmark with no file", async () => {
      const fs = new FakeFs();
      const bookmark = makeBookmark({ id: "b1", title: "A Page" });
      const db = makeDb([], [bookmark]);

      const result = await newService().sync(db as never, fs as never);

      expect(result.writtenFiles).toBe(1);
      const written = fs.files.get("a-page.md")!.content;
      expect(written).toContain('url: "https://example.com/a"');
      expect(written).toContain('bmf_id: "b1"');
    });

    it("propagates a folder edit into the bookmark", async () => {
      const fs = new FakeFs();
      const bookmark = makeBookmark({ id: "b1", title: "A Page" });
      const db = makeDb([], [bookmark]);

      await newService().sync(db as never, fs as never);

      fs.set(
        "a-page.md",
        BOOKMARK_NOTE("b1", "A Page", "https://example.com/a", "# Edited"),
        Date.parse("2026-01-02T00:00:00.000Z"),
      );
      const result = await newService().sync(db as never, fs as never);

      expect(result.updatedDocs).toBe(1);
      expect(bookmark.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "# Edited" }),
      );
    });

    it("resolves a bookmark conflict with the newer side winning", async () => {
      const fs = new FakeFs();
      const bookmark = makeBookmark({
        id: "b1",
        title: "A Page",
        updatedAt: "2026-01-01T00:00:00.000Z",
        revision: "1-aaaa",
      });
      const db = makeDb([], [bookmark]);

      const service = newService();
      await service.sync(db as never, fs as never);

      bookmark.revision = "2-bbbb";
      bookmark.updatedAt = "2026-01-02T00:00:00.000Z";
      fs.set(
        "a-page.md",
        BOOKMARK_NOTE("b1", "A Page", "https://example.com/a", "# File edit"),
        Date.parse("2026-01-03T00:00:00.000Z"),
      );
      const result = await service.sync(db as never, fs as never);

      expect(result.conflicts).toBe(1);
      expect(bookmark.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ content: "# File edit" }),
      );
    });
  });

  describe("attachments", () => {
    it("round-trips an attachment through the folder", async () => {
      const fs = new FakeFs();
      const doc = makeDoc({
        id: "d1",
        title: "Note",
        textContent: "# Doc\n\n![pic](bmf-attachment://att-x)",
      });
      const db = makeDb([doc]);

      // Export: resolve the persisted ref to a data: URL, extract it to a
      // file, and rewrite the markdown to an `attachments/` path.
      vi.spyOn(attachmentStore, "resolveTextForExport").mockResolvedValue(
        "# Doc\n\n![pic](data:image/png;base64,QUJD)",
      );

      await newService().sync(db as never, fs as never);

      const written = fs.files.get("note.md")!.content;
      expect(written).toContain("attachments/image-");
      expect(fs.attachments.size).toBe(1);
      const [attachmentName, attachmentBytes] = [
        ...fs.attachments.entries(),
      ][0]!;
      expect([...attachmentBytes]).toEqual([0x41, 0x42, 0x43]);

      // Import: persist the `attachments/` ref back through AttachmentStore.
      vi.spyOn(attachmentStore, "persistFile").mockResolvedValue("att-new");
      fs.set(
        "note.md",
        NOTE(
          "d1",
          "Note",
          `# Doc\n\n![pic](attachments/${attachmentName})`,
          "2026-01-02T00:00:00.000Z",
        ),
        Date.parse("2026-01-02T00:00:00.000Z"),
      );

      const result = await newService().sync(db as never, fs as never);

      expect(result.updatedDocs).toBe(1);
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          textContent: "# Doc\n\n![pic](bmf-attachment://att-new)",
        }),
      );
    });
  });
});

const BOOKMARK_NOTE = (
  id: string,
  title: string,
  url: string,
  content: string,
) =>
  `---
title: "${title}"
tags: ["bookmark"]
url: "${url}"
${id ? `bmf_id: "${id}"
bmf_type: "bookmark"
` : ""}created: "2026-01-01T00:00:00.000Z"
updated: "2026-01-01T00:00:00.000Z"
---

# ${title}

${content}

**URL:** ${url}
`;
