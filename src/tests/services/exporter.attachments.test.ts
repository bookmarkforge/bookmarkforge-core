/**
 * Integration: persisted block-editor attachments (bmf-attachment:// refs in
 * textContent) must flow through UniversalExporter into a faithful Obsidian
 * export — the image lands in attachments/ and the markdown link is rewritten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UniversalExporter } from "../../services/UniversalExporter";
import JSZip from "jszip";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe("UniversalExporter + persisted document attachments", () => {
  const attachmentRecord = {
    id: "att-doc-1-abc123",
    documentId: "doc-1",
    filename: "photo.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,aGVsbG8=",
    size: 5,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  function createMockDb(documentText: string): any {
    return {
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      documents: {
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            {
              id: "doc-1",
              folderId: "root",
              title: "Notes with image",
              textContent: documentText,
              tags: [],
              links: [],
              isDeleted: false,
              isPrivate: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]),
        })),
      },
      folders: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      documentAttachments: {
        upsert: vi.fn(),
        find: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([
            { toJSON: () => attachmentRecord },
          ]),
        })),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts a persisted attachment into attachments/ and rewrites the link", async () => {
    const exporter = new UniversalExporter();
    const mockDb = createMockDb(
      "See ![photo](bmf-attachment://att-doc-1-abc123) below",
    );

    const result = await exporter.exportData(mockDb, { format: "obsidian" });

    expect(result.success).toBe(true);
    const zip = await JSZip.loadAsync(result.blob);
    const markdownFile = Object.keys(zip.files).find((name) =>
      name.endsWith(".md"),
    )!;
    const markdown = await zip.files[markdownFile]!.async("string");

    // The dead ref became an extracted attachment file.
    expect(markdown).toContain("](attachments/");
    expect(markdown).not.toContain("bmf-attachment://");

    const attachmentFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith("attachments/") && !zip.files[name]!.dir,
    );
    expect(attachmentFiles).toHaveLength(1);
    expect(attachmentFiles[0]).toMatch(/\.png$/);
    const bytes = await zip.files[attachmentFiles[0]!]!.async("uint8array");
    expect(new TextDecoder().decode(bytes)).toBe("hello");
  });

  it("leaves documents without refs untouched", async () => {
    const exporter = new UniversalExporter();
    const mockDb = createMockDb("Plain text, no images");

    const result = await exporter.exportData(mockDb, { format: "obsidian" });
    const zip = await JSZip.loadAsync(result.blob);
    const attachmentFiles = Object.keys(zip.files).filter(
      (name) => name.startsWith("attachments/") && !zip.files[name]!.dir,
    );
    expect(attachmentFiles).toHaveLength(0);
  });
});
