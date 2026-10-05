/**
 * Unit tests for the pure Markdown/Obsidian parsing module.
 * The exporter dialect is defined in exporter.formatters.ts (escapeYamlValue
 * + generateFrontmatter); these tests pin the exact inverse contract.
 */
import { describe, it, expect } from "vitest";
import {
  extractWikilinkTargets,
  findAttachmentRefs,
  normalizeAttachmentRefPath,
  noteSlugFromPath,
  parseMarkdownNote,
  rewriteAttachmentRef,
  sanitizeFolderPath,
  splitFrontmatter,
} from "../../services/importer.markdown";

describe("splitFrontmatter", () => {
  it("parses the exporter's double-quoted dialect with escapes", () => {
    const note = [
      "---",
      'title: "He said \\"hi\\" \\\\ and\\nnewline"',
      'tags: ["bookmark", "dev"]',
      'url: "https://x.example"',
      'bmf_id: "b-1"',
      'bmf_type: "bookmark"',
      'created: "2024-01-01T00:00:00.000Z"',
      "---",
      "",
      "# Body",
    ].join("\n");
    const parsed = splitFrontmatter(note);
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.title).toBe('He said "hi" \\ and\nnewline');
    expect(parsed!.metadata.tags).toEqual(["bookmark", "dev"]);
    expect(parsed!.metadata.url).toBe("https://x.example");
    expect(parsed!.metadata.bmf_type).toBe("bookmark");
    expect(parsed!.body).toBe("# Body");
  });

  it("returns null without an opening fence", () => {
    expect(splitFrontmatter("# No frontmatter")).toBeNull();
  });

  it("returns null for an unterminated fence", () => {
    expect(splitFrontmatter('---\ntitle: "x"\n# no closing fence')).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const note = '---\r\ntitle: "CRLF"\r\n---\r\n\r\nBody\r\n';
    const parsed = splitFrontmatter(note);
    expect(parsed!.metadata.title).toBe("CRLF");
    expect(parsed!.body).toBe("Body\n");
  });
});

describe("extractWikilinkTargets", () => {
  it("extracts targets and ignores Obsidian aliases", () => {
    expect(
      extractWikilinkTargets("- [[note-one]]\n- [[note-two|an alias]]"),
    ).toEqual(["note-one", "note-two"]);
  });

  it("returns an empty array without links", () => {
    expect(extractWikilinkTargets("plain text")).toEqual([]);
  });
});

describe("parseMarkdownNote", () => {
  it("parses an exported bookmark note, stripping the marker tag and footer", () => {
    const note = [
      "---",
      'title: "Alpha"',
      'tags: ["bookmark", "news"]',
      'url: "https://alpha.example"',
      'bmf_id: "b-alpha"',
      'bmf_type: "bookmark"',
      'created: "2024-01-01T00:00:00.000Z"',
      'updated: "2024-01-02T00:00:00.000Z"',
      "---",
      "",
      "# Alpha",
      "",
      "## Summary",
      "",
      "The summary.",
      "",
      "## Content",
      "",
      "The content.",
      "",
      "## Related",
      "",
      "- [[beta-post]]",
      "- [https://external.example](https://external.example)",
      "",
      "**URL:** https://alpha.example",
      "",
      "**Tags:** news",
    ].join("\n");
    const parsed = parseMarkdownNote("alpha.md", note);
    expect(parsed.kind).toBe("bookmark");
    expect(parsed.title).toBe("Alpha");
    expect(parsed.url).toBe("https://alpha.example");
    expect(parsed.tags).toEqual(["news"]); // "bookmark" marker stripped
    expect(parsed.summary).toBe("The summary.");
    expect(parsed.content).toBe("The content.");
    expect(parsed.bmfId).toBe("b-alpha");
    expect(parsed.relatedLinks).toEqual([
      { kind: "wikilink", target: "beta-post" },
      { kind: "url", target: "https://external.example" },
    ]);
    expect(parsed.slug).toBe("alpha");
  });

  it("parses an exported document note with folder and linked notes", () => {
    const note = [
      "---",
      'title: "Note Two"',
      'tags: ["document", "work"]',
      'bmf_id: "d-two"',
      'bmf_type: "document"',
      'created: "2024-01-01T00:00:00.000Z"',
      'updated: "2024-01-01T00:00:00.000Z"',
      'folder: "projects"',
      "---",
      "",
      "Second note body.",
      "",
      "## Linked notes",
      "",
      "- [[note-one]]",
    ].join("\n");
    const parsed = parseMarkdownNote("projects/note-two.md", note);
    expect(parsed.kind).toBe("document");
    expect(parsed.title).toBe("Note Two");
    expect(parsed.folderPath).toBe("projects");
    expect(parsed.textContent).toBe("Second note body.");
    expect(parsed.linkedNotes).toEqual(["note-one"]);
    expect(parsed.tags).toEqual(["work"]);
  });

  it("imports a frontmatter-less .md as a document titled from its H1", () => {
    const parsed = parseMarkdownNote(
      "my-notes.md",
      "# My Notes\n\nSome content here.\n",
    );
    expect(parsed.kind).toBe("document");
    expect(parsed.title).toBe("My Notes");
    expect(parsed.textContent).toBe("Some content here.");
    expect(parsed.tags).toEqual([]);
  });

  it("uses the filename when a raw note has no heading", () => {
    const parsed = parseMarkdownNote("readme.md", "Just body text.");
    expect(parsed.title).toBe("readme");
    expect(parsed.textContent).toBe("Just body text.");
  });

  it("keeps an existing H1 inside an exported document's body verbatim", () => {
    // Exported documents have frontmatter title; a user H1 is body content.
    const note = [
      "---",
      'title: "Exported"',
      'bmf_type: "document"',
      'bmf_id: "d-1"',
      "---",
      "",
      "# A heading inside the body",
      "",
      "Text.",
    ].join("\n");
    const parsed = parseMarkdownNote("exported.md", note);
    expect(parsed.title).toBe("Exported");
    expect(parsed.textContent).toBe("# A heading inside the body\n\nText.");
  });

  it("rejects hostile bmf_id and folder values", () => {
    const note = [
      "---",
      'title: "Hostile"',
      'bmf_id: "../../etc/passwd"',
      'bmf_type: "document"',
      'folder: "../sneaky"',
      "---",
      "",
      "Text.",
    ].join("\n");
    const parsed = parseMarkdownNote("hostile.md", note);
    expect(parsed.bmfId).toBeUndefined();
    expect(parsed.folderPath).toBe("../sneaky");
    expect(sanitizeFolderPath(parsed.folderPath!)).toBeUndefined();
  });
});

describe("folder path sanitization", () => {
  it("accepts plain slash paths and rejects traversal", () => {
    expect(sanitizeFolderPath("work/projects")).toBe("work/projects");
    expect(sanitizeFolderPath("work/ projects /docs")).toBe("work/projects/docs");
    expect(sanitizeFolderPath("..")).toBeUndefined();
    expect(sanitizeFolderPath("a/../b")).toBeUndefined();
    expect(sanitizeFolderPath("a\\b")).toBeUndefined();
    expect(sanitizeFolderPath("a:*b")).toBeUndefined();
  });
});

describe("attachment refs", () => {
  it("finds refs pointing into an attachments folder, skipping CDN refs", () => {
    const refs = findAttachmentRefs(
      "![a](../../attachments/x.png) ![b](attachments/y.png) ![c](https://cdn.example/z.png) ![d](_attachments/q.pdf)",
    );
    expect(refs.map((ref) => ref.path)).toEqual([
      "../../attachments/x.png",
      "attachments/y.png",
      "_attachments/q.pdf",
    ]);
  });

  it("normalizes relative attachment paths", () => {
    expect(normalizeAttachmentRefPath("../../attachments/x.png")).toBe(
      "attachments/x.png",
    );
    expect(normalizeAttachmentRefPath("./attachments/x.png")).toBe(
      "attachments/x.png",
    );
  });

  it("rewrites a ref to the stable bmf-attachment scheme", () => {
    const text = "See ![image](../../attachments/image-abc.png) here";
    const out = rewriteAttachmentRef(
      text,
      { alt: "image", path: "../../attachments/image-abc.png" },
      "att-doc-123",
    );
    expect(out).toBe("See ![image](bmf-attachment://att-doc-123) here");
  });
});

describe("noteSlugFromPath", () => {
  it("returns the filename without extension", () => {
    expect(noteSlugFromPath("projects/note-two.md")).toBe("note-two");
    expect(noteSlugFromPath("note.MD")).toBe("note");
  });
});