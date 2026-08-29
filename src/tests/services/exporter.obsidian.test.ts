import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { exportToObsidian } from "../../services/exporter.formatters";
import type {
  BookmarkData,
  DocumentData,
  ExportData,
} from "../../services/exporter.types";

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

function makeData(
  bookmarks: BookmarkData[],
  documents: DocumentData[],
): ExportData {
  return { bookmarks, documents, folders: [] };
}

describe("exportToObsidian fidelity", () => {
  it("uses readable, stable title slugs instead of positional indexes", async () => {
    const result = await exportToObsidian(
      makeData(
        [
          makeBookmark({
            id: "b1",
            title: "My Favorite Article",
            url: "https://example.com/a",
          }),
          makeBookmark({
            id: "b2",
            title: "Second Post",
            url: "https://example.com/b",
          }),
        ],
        [],
      ),
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const names = Object.keys(zip.files);
    expect(names).toContain("my-favorite-article.md");
    expect(names).toContain("second-post.md");
    expect(names.some((name) => /^bookmark-\d+-/.test(name))).toBe(false);
  });

  it("disambiguates colliding slugs with a stable id suffix", async () => {
    const result = await exportToObsidian(
      makeData(
        [
          makeBookmark({
            id: "aaa11111",
            title: "Same Title",
            url: "https://a.example",
          }),
          makeBookmark({
            id: "bbb22222",
            title: "Same Title",
            url: "https://b.example",
          }),
        ],
        [],
      ),
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const names = Object.keys(zip.files);
    expect(names).toContain("same-title.md");
    expect(names).toContain("same-title-bbb22222.md");
  });

  it("emits [[wikilinks]] for document.links and bookmark.relatedLinks", async () => {
    const result = await exportToObsidian(
      makeData(
        [
          makeBookmark({
            id: "b1",
            title: "Target Page",
            url: "https://target.example",
          }),
          makeBookmark({
            id: "b2",
            title: "Source Page",
            url: "https://source.example",
            relatedLinks: [
              "https://target.example",
              "https://external.example",
            ],
          }),
        ],
        [
          makeDocument({ id: "d1", title: "Note One" }),
          makeDocument({ id: "d2", title: "Note Two", links: ["d1"] }),
        ],
      ),
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const source = await zip.file("source-page.md")!.async("string");
    expect(source).toContain("[[target-page]]");
    expect(source).toContain("[https://external.example](https://external.example)");

    const noteTwo = await zip.file("note-two.md")!.async("string");
    expect(noteTwo).toContain("[[note-one]]");
  });

  it("extracts data: images into attachments/ and rewrites references", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = await exportToObsidian(
      makeData(
        [],
        [
          makeDocument({
            id: "d1",
            title: "With Image",
            textContent: `# Hello\n\n![pic](${png})\n`,
          }),
        ],
      ),
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const markdown = await zip.file("with-image.md")!.async("string");
    expect(markdown).not.toContain(png);
    expect(markdown).toContain("](attachments/");

    const attachmentNames = Object.keys(zip.files).filter(
      (name) => name.startsWith("attachments/") && !zip.files[name]!.dir,
    );
    expect(attachmentNames).toHaveLength(1);
    expect(attachmentNames[0]).toMatch(/\.png$/);
  });

  it("emits stable bmf_id + bmf_type frontmatter for re-import dedup", async () => {
    const result = await exportToObsidian(
      makeData(
        [
          makeBookmark({
            id: "bmk-abc123",
            title: "Dedup Me",
            url: "https://example.com/x",
          }),
        ],
        [
          makeDocument({
            id: "doc-xyz789",
            folderId: "root",
            title: "Dedup Doc",
          }),
        ],
      ),
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const bookmarkMd = await zip.file("dedup-me.md")!.async("string");
    expect(bookmarkMd).toContain('bmf_id: "bmk-abc123"');
    expect(bookmarkMd).toContain('bmf_type: "bookmark"');

    const docMd = await zip.file("dedup-doc.md")!.async("string");
    expect(docMd).toContain('bmf_id: "doc-xyz789"');
    expect(docMd).toContain('bmf_type: "document"');
  });

  it("mirrors nested folders into the zip and emits the folder path in frontmatter", async () => {
    const result = await exportToObsidian(
      {
        bookmarks: [],
        documents: [
          makeDocument({
            id: "d1",
            folderId: "folder-2",
            title: "Deep Note",
          }),
          makeDocument({
            id: "d2",
            folderId: "folder-1",
            title: "Top Note",
          }),
        ],
        folders: [
          {
            id: "folder-1",
            title: "Work Notes",
            parentId: "",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "folder-2",
            title: "Projects",
            parentId: "folder-1",
            createdAt: "2024-01-02T00:00:00.000Z",
          },
        ],
      },
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    expect(zip.files["work-notes/projects/deep-note.md"]).toBeDefined();
    expect(zip.files["work-notes/top-note.md"]).toBeDefined();
    // Parent directory entries materialize for the mirrored tree.
    expect(zip.files["work-notes/"]!.dir).toBe(true);
    expect(zip.files["work-notes/projects/"]!.dir).toBe(true);

    const deep = await zip.file("work-notes/projects/deep-note.md")!.async("string");
    expect(deep).toContain('folder: "work-notes/projects"');
    const top = await zip.file("work-notes/top-note.md")!.async("string");
    expect(top).toContain('folder: "work-notes"');
  });

  it("keeps vault-root docs flat and drops the folder frontmatter", async () => {
    const result = await exportToObsidian(
      {
        bookmarks: [],
        documents: [
          makeDocument({ id: "d1", folderId: "root", title: "Root Note" }),
          makeDocument({ id: "d2", folderId: "folder-missing", title: "Orphan Note" }),
        ],
        folders: [
          {
            id: "folder-1",
            title: "Real Folder",
            parentId: "",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      },
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    expect(zip.files["root-note.md"]).toBeDefined();
    expect(zip.files["orphan-note.md"]).toBeDefined();
    expect(zip.files["real-folder/"]).toBeUndefined(); // no docs inside → not materialized
    const rootNote = await zip.file("root-note.md")!.async("string");
    expect(rootNote).not.toContain("folder:");
  });

  it("disambiguates sibling folders with the same slugified title", async () => {
    const result = await exportToObsidian(
      {
        bookmarks: [],
        documents: [
          makeDocument({ id: "d1", folderId: "folder-aaa11111", title: "One" }),
          makeDocument({ id: "d2", folderId: "folder-bbb22222", title: "Two" }),
        ],
        folders: [
          {
            id: "folder-aaa11111",
            title: "Notes",
            parentId: "",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "folder-bbb22222",
            title: "Notes",
            parentId: "",
            createdAt: "2024-01-02T00:00:00.000Z",
          },
        ],
      },
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    expect(zip.files["notes/one.md"]).toBeDefined();
    expect(zip.files["notes-bbb22222/two.md"]).toBeDefined();
  });

  it("rewrites attachment references relative to the note's folder", async () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const result = await exportToObsidian(
      {
        bookmarks: [],
        documents: [
          makeDocument({
            id: "d1",
            folderId: "folder-2",
            title: "Deep Image",
            textContent: `# Hello\n\n![pic](${png})\n`,
          }),
        ],
        folders: [
          {
            id: "folder-1",
            title: "Work",
            parentId: "",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
          {
            id: "folder-2",
            title: "Projects",
            parentId: "folder-1",
            createdAt: "2024-01-02T00:00:00.000Z",
          },
        ],
      },
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const markdown = await zip.file("work/projects/deep-image.md")!.async("string");
    expect(markdown).toContain("](../../attachments/");

    const attachmentNames = Object.keys(zip.files).filter(
      (name) => name.startsWith("attachments/") && !zip.files[name]!.dir,
    );
    expect(attachmentNames).toHaveLength(1);
  });

  it("keeps both summary and content instead of dropping one", async () => {
    const result = await exportToObsidian(
      makeData(
        [
          makeBookmark({
            id: "b1",
            title: "Full",
            summary: "Short summary",
            content: "Full body text",
          }),
        ],
        [],
      ),
      { format: "obsidian" },
    );

    const zip = await JSZip.loadAsync(result.blob);
    const markdown = await zip.file("full.md")!.async("string");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("Short summary");
    expect(markdown).toContain("## Content");
    expect(markdown).toContain("Full body text");
  });
});
