/**
 * Obsidian round-trip integration tests: exporter → UniversalImporter →
 * exporter. Validates F1-C criteria 3 and 4 (import fidelity + round-trip
 * equality of counts, tag sets and wikilink targets) via the REAL exporter
 * formatter and the real AttachmentStore against an in-memory fake db.
 */
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { exportToObsidian } from "../../services/exporter.formatters";
import { UniversalImporter } from "../../services/UniversalImporter";
import { attachmentStore } from "../../services/documentAttachments";
import { splitFrontmatter } from "../../services/importer.markdown";
import type {
  BookmarkData,
  DocumentData,
  ExportData,
} from "../../services/exporter.types";
import type { FolderDocType } from "../../db/schema";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function makeBookmark(overrides: Partial<BookmarkData> = {}): BookmarkData {
  return {
    id: "b1",
    url: "https://example.com",
    urlHash: "",
    title: "Bookmark",
    content: "",
    summary: "",
    tags: [],
    relatedLinks: [],
    processed: false,
    isPrivate: false,
    isDeleted: false,
    visitCount: 0,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDocument(overrides: Partial<DocumentData> = {}): DocumentData {
  return {
    id: "d1",
    folderId: "root",
    title: "Document",
    blocks: [],
    textContent: "",
    summary: "",
    tags: [],
    links: [],
    processed: false,
    isPrivate: false,
    isDeleted: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeFolder(overrides: Partial<FolderDocType> = {}): FolderDocType {
  return {
    id: "f1",
    title: "Folder",
    parentId: "root",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type AnyRecord = Record<string, unknown>;

/**
 * Minimal in-memory BookmarkForgeDB: findOne honors `{ id }` and `{ urlHash }`
 * selectors, insert persists, and documentAttachments serves both upsert and
 * find (so the real AttachmentStore — and the re-export resolution — work).
 */
function createMemoryDb() {
  const bookmarks = new Map<string, AnyRecord>();
  const documents = new Map<string, AnyRecord>();
  const folders = new Map<string, AnyRecord>();
  const attachments = new Map<string, AnyRecord>();

  const makeFindOne = (store: Map<string, AnyRecord>) => (query: {
    selector: AnyRecord;
  }) => ({
    exec: async () => {
      for (const doc of store.values()) {
        if (
          query.selector.id !== undefined &&
          doc.id === query.selector.id
        ) {
          return doc;
        }
        if (
          query.selector.urlHash !== undefined &&
          doc.urlHash === query.selector.urlHash
        ) {
          return doc;
        }
      }
      return null;
    },
  });

  return {
    bookmarks: {
      findOne: vi.fn(makeFindOne(bookmarks)),
      insert: vi.fn(async (doc: AnyRecord) => {
        bookmarks.set(doc.id as string, doc);
        return doc;
      }),
      find: vi.fn(() => ({ exec: async () => [] })),
      bulkRemove: vi.fn(async () => {}),
    },
    documents: {
      findOne: vi.fn(makeFindOne(documents)),
      insert: vi.fn(async (doc: AnyRecord) => {
        documents.set(doc.id as string, doc);
        return doc;
      }),
      find: vi.fn(() => ({ exec: async () => [] })),
      bulkRemove: vi.fn(async () => {}),
    },
    folders: {
      findOne: vi.fn(makeFindOne(folders)),
      insert: vi.fn(async (doc: AnyRecord) => {
        folders.set(doc.id as string, doc);
        return doc;
      }),
      find: vi.fn(() => ({ exec: async () => [] })),
      bulkRemove: vi.fn(async () => {}),
    },
    documentAttachments: {
      upsert: vi.fn(async (doc: AnyRecord) => {
        attachments.set(doc.id as string, doc);
        return doc;
      }),
      find: vi.fn((query?: { selector?: AnyRecord }) => ({
        exec: async () =>
          Array.from(attachments.values())
            .filter(
              (record) =>
                !query?.selector?.documentId ||
                record.documentId === query.selector.documentId,
            )
            .map((record) => ({ toJSON: () => record })),
      })),
    },
  };
}

/** Three cross-linked bookmarks + two linked documents in one folder. */
function makeRoundTripData(): ExportData {
  return {
    bookmarks: [
      makeBookmark({
        id: "b-alpha",
        url: "https://alpha.example",
        urlHash: "h-alpha",
        title: "Alpha Article",
        summary: "Alpha summary.",
        content: "Alpha body.",
        tags: ["news"],
        relatedLinks: ["https://beta.example"],
      }),
      makeBookmark({
        id: "b-beta",
        url: "https://beta.example",
        urlHash: "h-beta",
        title: "Beta Post",
        tags: ["dev"],
      }),
      makeBookmark({
        id: "b-gamma",
        url: "https://gamma.example",
        urlHash: "h-gamma",
        title: "Gamma Deep Dive",
        tags: ["news", "dev"],
        relatedLinks: ["https://beta.example", "https://external.example"],
      }),
    ],
    documents: [
      makeDocument({
        id: "d-one",
        title: "Note One",
        tags: ["work"],
        textContent: "First note body.",
        links: ["d-two"],
      }),
      makeDocument({
        id: "d-two",
        title: "Note Two",
        folderId: "f-projects",
        tags: ["work"],
        textContent: "Second note body.",
        links: ["d-one"],
      }),
    ],
    folders: [makeFolder({ id: "f-projects", title: "Projects" })],
  };
}

describe("Obsidian markdown round-trip (F1-C)", () => {
  it("export → import reproduces counts, tags, folders and wikilink targets", async () => {
    const exported = await exportToObsidian(makeRoundTripData(), {
      format: "obsidian",
    });
    const zip1 = await JSZip.loadAsync(exported.blob);
    expect(Object.keys(zip1.files)).toContain("alpha-article.md");
    expect(Object.keys(zip1.files)).toContain("projects/note-two.md");

    const db = createMemoryDb();
    const result = await new UniversalImporter().importData(
      db as never,
      new File([exported.blob], "vault.zip", { type: "application/zip" }),
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(5);
    expect(result.skippedCount).toBe(0);

    const importedBookmarks = db.bookmarks.insert.mock.calls.map(
      (call: unknown[]) => call[0] as AnyRecord,
    );
    const importedDocuments = db.documents.insert.mock.calls.map(
      (call: unknown[]) => call[0] as AnyRecord,
    );
    expect(importedBookmarks.map((b) => b.title).sort()).toEqual([
      "Alpha Article",
      "Beta Post",
      "Gamma Deep Dive",
    ]);
    // The "bookmark" marker tag is stripped; user tags survive unchanged.
    expect(importedBookmarks.map((b) => b.tags).sort()).toEqual([
      ["dev"],
      ["news"],
      ["news", "dev"],
    ]);
    expect(
      importedBookmarks.map((b) => b.url).sort(),
    ).toEqual([
      // sanitizeUrl normalizes root URLs with a trailing slash.
      "https://alpha.example/",
      "https://beta.example/",
      "https://gamma.example/",
    ]);

    // [[wikilinks]] resolved back to the target bookmarks' URLs.
    const alpha = importedBookmarks.find((b) => b.title === "Alpha Article")!;
    expect(alpha.relatedLinks).toEqual(["https://beta.example/"]);
    const gamma = importedBookmarks.find((b) => b.title === "Gamma Deep Dive")!;
    expect(gamma.relatedLinks).toEqual([
      "https://beta.example/",
      "https://external.example/",
    ]);
    expect(alpha.content).toBe("Alpha body.");
    expect(alpha.summary).toBe("Alpha summary.");

    // The bmf_id contract keeps document ids stable, so links resolve to the
    // exact same ids; folder paths mirror into new folders.
    const one = importedDocuments.find((d) => d.title === "Note One")!;
    expect(one.links).toEqual(["d-two"]);
    const two = importedDocuments.find((d) => d.title === "Note Two")!;
    expect(two.links).toEqual(["d-one"]);
    expect(two.folderId).not.toBe("root");
    const importedFolders = db.folders.insert.mock.calls.map(
      (call: unknown[]) => call[0] as AnyRecord,
    );
    expect(importedFolders).toHaveLength(1);
    expect(importedFolders[0]).toMatchObject({
      title: "projects",
      parentId: "root",
    });

    // Second leg: re-export the imported records and compare.
    const reexported = await exportToObsidian(
      {
        bookmarks: importedBookmarks as unknown as BookmarkData[],
        documents: importedDocuments as unknown as DocumentData[],
        folders: importedFolders as unknown as FolderDocType[],
      },
      { format: "obsidian" },
    );
    const zip2 = await JSZip.loadAsync(reexported.blob);

    const alphaText = await zip2.file("alpha-article.md")!.async("string");
    expect(alphaText).toContain("[[beta-post]]");
    const gammaText = await zip2.file("gamma-deep-dive.md")!.async("string");
    expect(gammaText).toContain("[[beta-post]]");
    expect(gammaText).toContain(
      "[https://external.example/](https://external.example/)",
    );
    const oneText = await zip2.file("note-one.md")!.async("string");
    expect(oneText).toContain("[[note-two]]");
    const twoText = await zip2.file("projects/note-two.md")!.async("string");
    expect(twoText).toContain("[[note-one]]");

    // Tag sets are stable across the round trip.
    const alphaFrontmatter = splitFrontmatter(alphaText)!;
    expect(alphaFrontmatter.metadata.tags).toEqual(["bookmark", "news"]);
    const oneFrontmatter = splitFrontmatter(oneText)!;
    expect(oneFrontmatter.metadata.tags).toEqual(["document", "work"]);
    const twoFrontmatter = splitFrontmatter(twoText)!;
    expect(twoFrontmatter.metadata.folder).toBe("projects");
    expect(twoFrontmatter.metadata.tags).toEqual(["document", "work"]);
  });

  it("skips records whose bmf_id already exists (stable dedup contract)", async () => {
    const exported = await exportToObsidian(makeRoundTripData(), {
      format: "obsidian",
    });
    const file = new File([exported.blob], "vault.zip", {
      type: "application/zip",
    });
    const importer = new UniversalImporter();
    const db = createMemoryDb();

    const first = await importer.importData(db as never, file);
    expect(first.importedCount).toBe(5);

    // Re-make the File: its text()/arrayBuffer() streams are one-shot.
    const second = await importer.importData(
      db as never,
      new File([exported.blob], "vault.zip", { type: "application/zip" }),
    );
    expect(second.success).toBe(true);
    expect(second.importedCount).toBe(0);
    expect(second.skippedCount).toBe(5);
    expect(db.bookmarks.insert).toHaveBeenCalledTimes(3);
    expect(db.documents.insert).toHaveBeenCalledTimes(2);
    expect(db.folders.insert).toHaveBeenCalledTimes(1);
  });

  it("imports a single .md bookmark note", async () => {
    const file = new File(
      [
        [
          "---",
          'title: "Single Note"',
          'url: "https://single.example"',
          'tags: ["web"]',
          'bmf_id: "b-single"',
          'bmf_type: "bookmark"',
          'created: "2024-02-02T00:00:00.000Z"',
          "---",
          "",
          "# Single Note",
          "",
          "## Summary",
          "",
          "A summary.",
          "",
          "## Content",
          "",
          "Body text.",
        ].join("\n"),
      ],
      "single-note.md",
      { type: "text/markdown" },
    );
    const db = createMemoryDb();
    const result = await new UniversalImporter().importData(db as never, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);

    const bookmark = db.bookmarks.insert.mock.calls[0]![0] as AnyRecord;
    expect(bookmark).toMatchObject({
      id: "b-single",
      url: "https://single.example/",
      title: "Single Note",
      summary: "A summary.",
      content: "Body text.",
      tags: ["web"],
      relatedLinks: [],
      createdAt: "2024-02-02T00:00:00.000Z",
    });
  });

  it("imports a frontmatter-less .md file as a document", async () => {
    const file = new File(
      ["# My Notes\n\nSome content here.\n\n## Linked notes\n\n[[unknown-note]]\n"],
      "my-notes.md",
      { type: "text/markdown" },
    );
    const db = createMemoryDb();
    const result = await new UniversalImporter().importData(db as never, file);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);

    const doc = db.documents.insert.mock.calls[0]![0] as AnyRecord;
    expect(doc).toMatchObject({
      title: "My Notes",
      textContent: "Some content here.",
      folderId: "root",
      links: [], // unknown wikilink target → dropped, not fabricated
    });
  });

  it("rejects ZIPs without Markdown notes and invalid ZIPs", async () => {
    const importer = new UniversalImporter();
    const db = createMemoryDb();

    const noNotes = new JSZip();
    noNotes.file("attachments/icon.png", new Uint8Array([1, 2, 3]));
    const emptyResult = await importer.importData(
      db as never,
      new File([await noNotes.generateAsync({ type: "blob" })], "vault.zip", {
        type: "application/zip",
      }),
    );
    expect(emptyResult.success).toBe(false);
    expect(emptyResult.error).toMatch(/No Markdown notes/i);

    const fakeZip = new File(["this is not a zip"], "vault.zip", {
      type: "application/zip",
    });
    const invalidResult = await importer.importData(db as never, fakeZip);
    expect(invalidResult.success).toBe(false);
    expect(invalidResult.error).toMatch(/Invalid ZIP/i);
  });

  it("round-trips attachments through the real AttachmentStore", async () => {
    const pngDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const data: ExportData = {
      bookmarks: [],
      documents: [
        makeDocument({
          id: "d-att",
          title: "Doc With Image",
          textContent: `A diagram: ![diagram](${pngDataUrl})`,
        }),
      ],
      folders: [],
    };

    const exported = await exportToObsidian(data, { format: "obsidian" });
    const zip1 = await JSZip.loadAsync(exported.blob);
    const attachmentName = Object.keys(zip1.files).find((name) =>
      name.startsWith("attachments/"),
    );
    expect(attachmentName).toBeDefined();

    const db = createMemoryDb();
    const result = await new UniversalImporter().importData(
      db as never,
      new File([exported.blob], "vault.zip", { type: "application/zip" }),
    );
    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(1);

    const doc = db.documents.insert.mock.calls[0]![0] as AnyRecord;
    // The relative ref was re-persisted through AttachmentStore.
    const textContent = String(doc.textContent);
    const storedRef = textContent.match(
      /bmf-attachment:\/\/(att-[A-Za-z0-9-]+)/,
    );
    expect(storedRef).not.toBeNull();
    const storedId = storedRef![1]!;
    const attachmentRecord =
      db.documentAttachments.upsert.mock.calls
        .map((call: unknown[]) => call[0] as AnyRecord)
        .find((record) => record.id === storedId);
    expect(attachmentRecord).toBeDefined();
    expect(attachmentRecord!.mimeType).toBe("image/png");

    // Re-export resolves the ref back to a data URL and re-extracts it.
    const resolvedText = await attachmentStore.resolveTextForExport(
      String(doc.id),
      String(doc.textContent),
      db as never,
    );
    const reexported = await exportToObsidian(
      {
        bookmarks: [],
        documents: [
          { ...doc, textContent: resolvedText } as unknown as DocumentData,
        ],
        folders: [],
      },
      { format: "obsidian" },
    );
    const zip2 = await JSZip.loadAsync(reexported.blob);
    expect(
      Object.keys(zip2.files).some((name) => name.startsWith("attachments/")),
    ).toBe(true);
    const noteText = await zip2.file("doc-with-image.md")!.async("string");
    expect(noteText).toContain(`![diagram](attachments/`);
  });
});