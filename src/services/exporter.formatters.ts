import JSZip from "jszip";
import { logger } from "../utils/logger";
import { formatDate } from "../utils/localization";
import i18n from "../i18n";
import { ExportData, ExportOptions, ExportResult } from "./exporter.types";
import { sanitizeHtml, SanitizationService } from "./SanitizationService";
import { decodeDataUrlToBytes } from "../utils/defensive-base64";

/**
 * Formats a doc timestamp for export meta lines. Empty timestamps (common in
 * fixtures and legacy data) render as "" instead of throwing RangeError via
 * formatDate (the previous `new Date("").toLocaleDateString()` silently
 * produced "Invalid Date").
 */
function formatExportDate(value: string | undefined): string {
  return value ? formatDate(value, {}, i18n.language) : "";
}

export const MAX_EXPORT_TEXT_BYTES = 100 * 1024 * 1024;
/** Upper bound for a single decoded inline attachment during export. */
export const MAX_EXPORT_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {return;}
  const error = new Error("Export cancelled");
  error.name = "AbortError";
  throw error;
}

function createTextBlob(content: string | BlobPart[], type: string): Blob {
  // Blob.size reports the encoded byte length without retaining a separate
  // full-size TextEncoder Uint8Array alongside the final export blob.
  const blob = new Blob(Array.isArray(content) ? content : [content], { type });
  if (blob.size > MAX_EXPORT_TEXT_BYTES) {
    throw new Error("Export output exceeds the 100 MB size limit");
  }
  return blob;
}

async function createZip(
  files: Array<{ filename: string; content: string | Uint8Array }>,
  signal?: AbortSignal,
): Promise<Blob> {
  try {
    throwIfAborted(signal);
    let totalBytes = 0;
    const zip = new JSZip();
    for (const file of files) {
      throwIfAborted(signal);
      totalBytes +=
        typeof file.content === "string"
          ? new TextEncoder().encode(file.content).byteLength
          : file.content.byteLength;
      if (totalBytes > MAX_EXPORT_TEXT_BYTES) {
        throw new Error("Export output exceeds the 100 MB size limit");
      }
      zip.file(file.filename, file.content);
    }
    const generationOptions = {
      type: "blob" as const,
      compression: "DEFLATE" as const,
      compressionOptions: { level: 6 },
      // JSZip supports this callback at runtime, but older @types/jszip
      // versions omit it from JSZipGeneratorOptions.
      onUpdate: () => throwIfAborted(signal),
    };
    return (await zip.generateAsync(
      generationOptions as Parameters<typeof zip.generateAsync>[0],
    )) as Blob;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {throw error;}
    logger.error("[UniversalExporter] Failed to create zip file", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Failed to create zip file");
  }
}

function escapeYamlValue(value: string): string {
  // Escape backslashes and double-quotes for YAML double-quoted strings.
  // Newlines become YAML escape sequences (\n/\r) instead of literal line
  // breaks: a literal newline in a title would fold the value to a space
  // (data corruption) and, worse, a title line containing `---` would be
  // mistaken for the closing frontmatter delimiter by split-on-`---`
  // parsers, producing an unterminated scalar and leaking the remaining
  // fields into the markdown body. \n/\r escapes preserve the value exactly.
  // Also strip control characters that break YAML parsers.
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

function generateFrontmatter(metadata: Record<string, unknown>): string {
  const frontmatter = Object.entries(metadata)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: [${value.map((v: unknown) => `"${escapeYamlValue(String(v))}"`).join(", ")}]`;
      } else if (typeof value === "string") {
        return `${key}: "${escapeYamlValue(value)}"`;
      }
      return `${key}: ${String(value)}`;
    })
    .join("\n");
  return `---\n${frontmatter}\n---\n`;
}

/** Maps common data-URL MIME types to a safe file extension for attachments. */
const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
};

/** A short, stable hash used to dedup identical attachments by name. */
function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) % 0x100000000;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Turn a title into a readable, URL-safe note slug. Deterministic for a given
 * input (no positional index), so re-exporting the same vault keeps the same
 * file names; the caller resolves collisions with a stable id suffix.
 */
function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

/** Assign a unique, stable note name, disambiguating collisions by id. */
function uniqueNoteName(base: string, id: string, usedNames: Set<string>): string {
  const root = base || "untitled";
  let name = root;
  if (usedNames.has(name)) {
    name = `${root}-${id.slice(0, 8)}`;
  }
  let candidate = name;
  let counter = 2;
  while (usedNames.has(candidate)) {
    candidate = `${name}-${counter}`;
    counter++;
  }
  usedNames.add(candidate);
  return candidate;
}

/**
 * Decode a `data:` URL into bytes and a file extension. Base64 payloads go
 * through the shared defensive decoder; percent-encoded payloads keep the
 * bounded `decodeURIComponent` path. Returns null when the payload is not
 * valid base64/data or exceeds the size bound, so the caller leaves the
 * reference untouched instead of guessing.
 */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  if (!dataUrl.startsWith("data:")) {return null;}
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {return null;}
  const header = dataUrl.slice(5, comma);
  const semi = header.indexOf(";");
  const mime = (semi === -1 ? header : header.slice(0, semi)).toLowerCase();
  let bytes: Uint8Array;
  if (header.toLowerCase().endsWith(";base64")) {
    const decoded = decodeDataUrlToBytes(dataUrl, MAX_EXPORT_ATTACHMENT_BYTES);
    if (!decoded) {return null;}
    bytes = decoded.bytes;
  } else {
    const payload = dataUrl.slice(comma + 1);
    // Percent-encoding can expand input by up to 3x. Reject oversized
    // encoded payloads before `decodeURIComponent` allocates a large string.
    if (payload.length > MAX_EXPORT_ATTACHMENT_BYTES * 3) {return null;}
    try {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    } catch {
      return null;
    }
  }
  const ext =
    MIME_TO_EXT[mime] ?? (mime.includes("/") ? `.${mime.split("/")[1]}` : ".bin");
  return { bytes, ext };
}

interface ObsidianAttachment {
  filename: string;
  content: Uint8Array;
}

/**
 * Extract inline `data:` image URLs from Markdown into the vault-level
 * `attachments/` folder and rewrite the reference to point at it. The
 * reference is relative to the note's own directory (`noteDir`), so notes
 * living in mirrored subfolders still resolve: a note at `work/projects/x.md`
 * references `../../attachments/image.png`. `blob:` and `http(s):` URLs are
 * left verbatim — `blob:` URLs are ephemeral object URLs whose bytes are not
 * persisted in the vault, so there is nothing faithful to extract.
 */
function extractAttachments(
  content: string,
  attachments: ObsidianAttachment[],
  usedNames: Set<string>,
  noteDir: string,
): string {
  const relToRoot = noteDir ? "../".repeat(noteDir.split("/").length) : "";
  return content.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (full: string, alt: string, url: string) => {
      if (!url.startsWith("data:")) {return full;}
      const decoded = dataUrlToBytes(url);
      if (!decoded) {return full;}
      const base = `image-${hashString(url)}${decoded.ext}`;
      let filename = base;
      let counter = 2;
      while (usedNames.has(filename)) {
        const dot = base.lastIndexOf(".");
        filename = `${base.slice(0, dot)}-${counter}${decoded.ext}`;
        counter++;
      }
      usedNames.add(filename);
      attachments.push({ filename, content: decoded.bytes });
      return `![${alt}](${relToRoot}attachments/${filename})`;
    },
  );
}

/**
 * Build the vault-relative folder tree from `data.folders` (P1 fidelity:
 * mirror the app's folder structure inside the Obsidian vault).
 *
 * Rules:
 *  - The app's implicit root is the folder id `"root"` → maps to `""` (the
 *    vault root, never a `root/` directory).
 *  - Each folder's path is its title (slugified) under its parent's path;
 *    `parentId` empty/missing/dangling or a cycle collapses that level to the
 *    vault root instead of fabricating a broken path.
 *  - Sibling collisions (two folders resolving to the same path) are
 *    disambiguated with the stable id suffix, like note slugs.
 *  - Deterministic: folders are processed in id order, so re-exporting the
 *    same vault yields the same tree.
 */
function buildObsidianFolderPaths(
  folders: readonly { id: string; title: string; parentId?: string }[],
): Map<string, string> {
  const byId = new Map<string, { id: string; title: string; parentId?: string }>();
  for (const folder of folders) {
    byId.set(folder.id, folder);
  }

  const cache = new Map<string, string | null>();
  const visiting = new Set<string>();

  const rawPath = (id: string): string | null => {
    if (cache.has(id)) {return cache.get(id)!;}
    if (id === "root") {
      cache.set(id, "");
      return "";
    }
    if (visiting.has(id)) {return null;} // cycle → collapse to root
    const folder = byId.get(id);
    if (!folder) {
      cache.set(id, null);
      return null;
    }
    visiting.add(id);
    const parentPath = folder.parentId ? rawPath(folder.parentId) : "";
    visiting.delete(id);
    const slug = slugify(folder.title);
    const path =
      parentPath === null || parentPath === "" ? slug : `${parentPath}/${slug}`;
    cache.set(id, path);
    return path;
  };

  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const id of [...byId.keys()].sort()) {
    if (id === "root") {continue;}
    const path = rawPath(id);
    if (path === null || path === "") {continue;}
    let candidate = path;
    let counter = 2;
    // Folder ids carry a `folder-` prefix; strip it so the disambiguation
    // suffix reads as the folder's own identifier (bbb22222, not folder-bb).
    const shortId = id.replace(/^folder-/, "").slice(0, 8);
    while (used.has(candidate)) {
      const slash = candidate.lastIndexOf("/");
      const dir = slash === -1 ? "" : candidate.slice(0, slash + 1);
      const base = slash === -1 ? candidate : candidate.slice(slash + 1);
      const suffix = counter === 2 ? shortId : `${shortId}-${counter}`;
      candidate = `${dir}${base}-${suffix}`;
      counter++;
    }
    used.add(candidate);
    result.set(id, candidate);
  }
  return result;
}

export function escapeCsv(value: string): string {
  // Double-quote escaping per RFC 4180.
  const escaped = value.replace(/"/g, '""');
  // Prevent CSV formula injection (Excel, Google Sheets, LibreOffice).
  // Values starting with =, +, -, or @ are prefixed with a single quote
  // so the spreadsheet interprets them as literal text, not formulas.
  if (/^[=+\-@]/.test(escaped)) {
    return "'" + escaped;
  }
  return escaped;
}

export function exportToNotion(
  data: ExportData,
  _options: ExportOptions,
): ExportResult {
  const notionData: Record<string, unknown> = {
    bookmarks: data.bookmarks.map((bookmark) => ({
      title: bookmark.title,
      url: bookmark.url,
      description: bookmark.summary || bookmark.content || "",
      tags: bookmark.tags || [],
      created_time: bookmark.createdAt,
      last_edited_time: bookmark.updatedAt,
      icon: "",
      archived: bookmark.isDeleted || false,
    })),
    documents: data.documents.map((doc) => ({
      title: doc.title,
      content: doc.textContent || "",
      tags: doc.tags || [],
      created_time: doc.createdAt,
      last_edited_time: doc.updatedAt,
      archived: doc.isDeleted || false,
    })),
    export_date: new Date().toISOString(),
    exported_by: "BookmarkForge",
    version: "1.0",
  };

  const content = JSON.stringify(notionData, null, 2);
  const blob = createTextBlob(content, "application/json");

  return {
    success: true,
    format: "notion",
    size: blob.size,
    filename: `bookmarkforge-notion-export-${Date.now()}.json`,
    blob,
  };
}

export function exportToObsidian(
  data: ExportData,
  _options: ExportOptions,
): Promise<ExportResult> {
  const usedNames = new Set<string>();
  const attachments: ObsidianAttachment[] = [];
  const usedAttachmentNames = new Set<string>();

  // Pass 1 — mirror the folder tree (P1 fidelity). Empty when the caller did
  // not request folders (includeFolders), in which case everything lands flat.
  const folderPathById = buildObsidianFolderPaths(data.folders);

  // The app's implicit root is the folder id "root" (docs are created there
  // by default); a missing/dangling folder id also falls back to the vault
  // root rather than fabricating a path.
  const documentDir = (folderId: string | undefined): string => {
    if (!folderId || folderId === "root") {return "";}
    return folderPathById.get(folderId) ?? "";
  };

  // Pass 2 — stable, readable note names. No positional index: a slug is
  // derived from the title and disambiguated by a stable id suffix only on a
  // real collision, so re-exporting the same vault keeps the same file names.
  const bookmarkNames = new Map<string, string>();
  const documentNames = new Map<string, string>();
  const bookmarkNameByUrl = new Map<string, string>();
  for (const bookmark of data.bookmarks) {
    const name = uniqueNoteName(slugify(bookmark.title), bookmark.id, usedNames);
    bookmarkNames.set(bookmark.id, name);
    if (bookmark.url) {bookmarkNameByUrl.set(bookmark.url, name);}
  }
  for (const doc of data.documents) {
    documentNames.set(doc.id, uniqueNoteName(slugify(doc.title), doc.id, usedNames));
  }

  const obsidianFiles: Array<{ filename: string; content: string | Uint8Array }> = [];

  for (const bookmark of data.bookmarks) {
    const frontmatter = generateFrontmatter({
      title: bookmark.title,
      tags: ["bookmark", ...(bookmark.tags || [])],
      url: bookmark.url,
      // Stable dedup contract for re-import: bmf_id is the RxDB primary key
      // (stable across re-exports) and bmf_type disambiguates the two
      // collections whose ids may collide (bookmark vs document).
      bmf_id: bookmark.id,
      bmf_type: "bookmark",
      created: bookmark.createdAt,
      updated: bookmark.updatedAt,
    });

    const sections: string[] = [];
    if (bookmark.summary) {
      sections.push(`## Summary

${bookmark.summary}`);
    }
    if (bookmark.content) {
      sections.push(`## Content

${bookmark.content}`);
    }
    const related = (bookmark.relatedLinks || []).map((link) => {
      const target = bookmarkNameByUrl.get(link);
      return target ? `[[${target}]]` : `[${link}](${link})`;
    });
    if (related.length > 0) {
      sections.push(`## Related

${related.map((link) => `- ${link}`).join("\n")}`);
    }

    const body = extractAttachments(
      sections.join("\n\n"),
      attachments,
      usedAttachmentNames,
      "",
    );

    const content = `${frontmatter}

# ${bookmark.title}

${body}

**URL:** ${bookmark.url}

**Tags:** ${(bookmark.tags || []).join(", ")}
`;

    obsidianFiles.push({
      filename: `${bookmarkNames.get(bookmark.id)!}.md`,
      content,
    });
  }

  for (const doc of data.documents) {
    const docDir = documentDir(doc.folderId);
    const frontmatter = generateFrontmatter({
      title: doc.title,
      tags: ["document", ...(doc.tags || [])],
      // Stable dedup contract for re-import: see the bookmark frontmatter.
      bmf_id: doc.id,
      bmf_type: "document",
      created: doc.createdAt,
      updated: doc.updatedAt,
      folder: docDir || undefined,
    });

    const linked = (doc.links || []).map((linkId) => {
      const target = documentNames.get(linkId);
      return target ? `[[${target}]]` : linkId;
    });

    const sections: string[] = [];
    if (doc.textContent) {
      sections.push(doc.textContent);
    }
    if (linked.length > 0) {
      sections.push(`## Linked notes

${linked.map((link) => `- ${link}`).join("\n")}`);
    }

    const body = extractAttachments(
      sections.join("\n\n"),
      attachments,
      usedAttachmentNames,
      docDir,
    );

    const content = `${frontmatter}

${body}
`;

    const noteName = `${documentNames.get(doc.id)!}.md`;
    obsidianFiles.push({
      filename: docDir ? `${docDir}/${noteName}` : noteName,
      content,
    });
  }

  for (const attachment of attachments) {
    obsidianFiles.push({
      filename: `attachments/${attachment.filename}`,
      content: attachment.content,
    });
  }

  return createZip(obsidianFiles, _options.signal).then((zip) => ({
    success: true,
    format: "obsidian",
    size: zip.size,
    filename: `bookmarkforge-obsidian-export-${Date.now()}.zip`,
    blob: zip,
  }));
}

function appendJsonArray(
  chunks: BlobPart[],
  records: readonly unknown[],
  itemIndent: string,
  closingIndent: string,
  signal?: AbortSignal,
): void {
  chunks.push("[");
  records.forEach((record, index) => {
    throwIfAborted(signal);
    chunks.push(index === 0 ? "\n" : ",\n");
    chunks.push(itemIndent, JSON.stringify(record));
  });
  chunks.push(records.length > 0 ? `\n${closingIndent}]` : "]");
}

export function exportToJSON(
  data: ExportData,
  options: ExportOptions,
): ExportResult {
  const exportDate = new Date().toISOString();
  const jsonChunks: BlobPart[] = [
    "{\n",
    `  "version": ${JSON.stringify("1.0")},\n`,
    `  "exportDate": ${JSON.stringify(exportDate)},\n`,
    `  "exportedBy": ${JSON.stringify("BookmarkForge")},\n`,
    "  \"data\": {\n    \"bookmarks\": ",
  ];
  appendJsonArray(jsonChunks, data.bookmarks, "      ", "    ", options.signal);
  jsonChunks.push(",\n    \"documents\": ");
  appendJsonArray(jsonChunks, data.documents, "      ", "    ", options.signal);
  jsonChunks.push(",\n    \"folders\": ");
  appendJsonArray(jsonChunks, data.folders, "      ", "    ", options.signal);
  jsonChunks.push(
    "\n  },\n  \"metadata\": {\n",
    `    \"totalBookmarks\": ${data.bookmarks.length},\n`,
    `    \"totalDocuments\": ${data.documents.length},\n`,
    `    \"totalFolders\": ${data.folders.length},\n`,
    `    \"includesEmbeddings\": ${Boolean(options.includeEmbeddings)}\n`,
    "  }\n}\n",
  );

  const blob = createTextBlob(jsonChunks, "application/json");

  return {
    success: true,
    format: "json",
    size: blob.size,
    filename: `bookmarkforge-export-${Date.now()}.json`,
    blob,
  };
}

/**
 * JSONL (NDJSON) export: one JSON object per line, each independently
 * parseable. Type-discriminated records (
 * {"type":"bookmark"|"document"|"folder"}) so a stream consumer can route
 * rows without a schema. Ideal for jq pipelines, streaming imports, and
 * diffable vault snapshots. Embeds the same fields the JSON export carries;
 * embeddings are included only when explicitly requested (the pipeline in
 * UniversalExporter strips them from ExportData otherwise).
 */
export function exportToJSONL(
  data: ExportData,
  options: ExportOptions,
): ExportResult {
  const chunks: BlobPart[] = [];
  const appendRecord = (record: Record<string, unknown>): void => {
    throwIfAborted(options.signal);
    chunks.push(JSON.stringify(record), "\n");
  };

  data.bookmarks.forEach((bookmark) => {
    const record: Record<string, unknown> = {
      type: "bookmark",
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      summary: bookmark.summary || "",
      content: bookmark.content || "",
      tags: bookmark.tags || [],
      relatedLinks: bookmark.relatedLinks || [],
      // Missing privacy metadata must not be serialized as public.
      isPrivate: bookmark.isPrivate !== false,
      isDeleted: bookmark.isDeleted || false,
      visitCount: bookmark.visitCount || 0,
      createdAt: bookmark.createdAt || "",
      updatedAt: bookmark.updatedAt || "",
    };
    if (options.includeEmbeddings && bookmark.embedding) {
      record.embedding = bookmark.embedding;
    }
    appendRecord(record);
  });

  data.documents.forEach((doc) => {
    const record: Record<string, unknown> = {
      type: "document",
      id: doc.id,
      folderId: doc.folderId || "",
      title: doc.title,
      textContent: doc.textContent || "",
      summary: doc.summary || "",
      tags: doc.tags || [],
      links: doc.links || [],
      // Missing privacy metadata must not be serialized as public.
      isPrivate: doc.isPrivate !== false,
      isDeleted: doc.isDeleted || false,
      createdAt: doc.createdAt || "",
      updatedAt: doc.updatedAt || "",
    };
    if (options.includeEmbeddings && doc.embedding) {
      record.embedding = doc.embedding;
    }
    appendRecord(record);
  });

  data.folders.forEach((folder) => {
    appendRecord({
      type: "folder",
      id: folder.id,
      title: folder.title,
      parentId: folder.parentId || "",
      createdAt: folder.createdAt || "",
    });
  });

  const blob = createTextBlob(chunks, "application/x-ndjson");

  return {
    success: true,
    format: "jsonl",
    size: blob.size,
    filename: `bookmarkforge-export-${Date.now()}.jsonl`,
    blob,
  };
}

export function exportToCSV(
  data: ExportData,
  _options: ExportOptions,
): ExportResult {
  interface CsvRow {
    type: string;
    title: string;
    url: string;
    content: string;
    description: string;
    tags: string;
    created: string;
    updated: string;
    folder: string;
  }

  const csvData: CsvRow[] = [];

  data.bookmarks.forEach((bookmark) => {
    csvData.push({
      type: "Bookmark",
      title: bookmark.title,
      url: bookmark.url,
      content: bookmark.content || "",
      description: bookmark.summary || "",
      tags: (bookmark.tags || []).join("; "),
      created: bookmark.createdAt,
      updated: bookmark.updatedAt,
      folder: "",
    });
  });

  data.documents.forEach((doc) => {
    csvData.push({
      type: "Document",
      title: doc.title,
      url: "",
      content:
        (doc.textContent || "").substring(0, 200) +
        (doc.textContent && doc.textContent.length > 200 ? "..." : ""),
      description: "",
      tags: (doc.tags || []).join("; "),
      created: doc.createdAt,
      updated: doc.updatedAt,
      folder: doc.folderId || "",
    });
  });

  const headers = [
    "Type",
    "Title",
    "URL/Content",
    "Description",
    "Tags",
    "Created",
    "Updated",
    "Folder",
  ];
  // Keep CSV rows as Blob parts instead of joining the full export into a
  // second monolithic string before Blob construction.
  const csvChunks = [
    headers.join(","),
    ...csvData.map((row) =>
      "\n" + [
        row.type,
        `"${escapeCsv(row.title)}"`,
        `"${escapeCsv(row.type === "Bookmark" ? row.url : row.content)}"`,
        `"${escapeCsv(row.description || "")}"`,
        `"${escapeCsv(row.tags)}"`,
        `"${escapeCsv(row.created)}"`,
        `"${escapeCsv(row.updated)}"`,
        `"${escapeCsv(row.folder || "")}"`,
      ].join(","),
    ),
  ];

  const blob = createTextBlob(csvChunks, "text/csv");

  return {
    success: true,
    format: "csv",
    size: blob.size,
    filename: `bookmarkforge-export-${Date.now()}.csv`,
    blob,
  };
}

export function exportToMarkdown(
  data: ExportData,
  _options: ExportOptions,
): ExportResult {
  const markdownChunks: string[] = [
    "# BookmarkForge Export\n\n",
    `**Export Date:** ${formatDate(new Date(), {}, i18n.language)}\n`,
    `**Total Bookmarks:** ${data.bookmarks.length}\n`,
    `**Total Documents:** ${data.documents.length}\n\n`,
    "---\n\n",
  ];

  if (data.bookmarks.length > 0) {
    markdownChunks.push("## Bookmarks\n\n");
    data.bookmarks.forEach((bookmark) => {
      // The title is rendered INSIDE a markdown link label. A hostile or
      // imported title containing `](` could terminate the label early and
      // inject its own destination (e.g. `abc](https://evil.com)` renders
      // as a link to evil.com before the intended URL). Escape the brackets
      // so the label cannot break out of the link; the URL is already
      // sanitized by sanitizeUrl.
      const safeTitle = bookmark.title
        .replace(/\\/g, "\\\\")
        .replace(/([\[\]])/g, "\\$1");
      markdownChunks.push(
        `### [${safeTitle}](${SanitizationService.sanitizeUrl(bookmark.url)})\n\n`,
      );
      if (bookmark.summary || bookmark.content) {
        markdownChunks.push(`${bookmark.summary || bookmark.content}\n\n`);
      }
      if (bookmark.tags && bookmark.tags.length > 0) {
        markdownChunks.push(`**Tags:** ${bookmark.tags.join(", ")}\n\n`);
      }
      markdownChunks.push("---\n\n");
    });
  }

  if (data.documents.length > 0) {
    markdownChunks.push("## Documents\n\n");
    data.documents.forEach((doc) => {
      markdownChunks.push(`### ${doc.title}\n\n`);
      markdownChunks.push(`${doc.textContent || ""}\n\n`);
      if (doc.tags && doc.tags.length > 0) {
        markdownChunks.push(`**Tags:** ${doc.tags.join(", ")}\n\n`);
      }
      markdownChunks.push("---\n\n");
    });
  }

  const blob = createTextBlob(markdownChunks, "text/markdown");

  return {
    success: true,
    format: "markdown",
    size: blob.size,
    filename: `bookmarkforge-export-${Date.now()}.md`,
    blob,
  };
}

export function exportToHTML(
  data: ExportData,
  _options: ExportOptions,
): ExportResult {
  const htmlChunks: string[] = [`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BookmarkForge Export</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
        .bookmark { border: 1px solid #e1e5e9; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .bookmark h3 { margin: 0 0 8px 0; color: #2563eb; }
        .bookmark a { color: #2563eb; text-decoration: none; }
        .bookmark a:hover { text-decoration: underline; }
        .document { border: 1px solid #f0f0f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fafafa; }
        .document h3 { margin: 0 0 8px 0; color: #111827; }
        .tags { margin-top: 8px; }
        .tag { display: inline-block; background: #e5e7eb; color: #6b7280; padding: 2px 8px; border-radius: 12px; font-size: 12px; margin-right: 4px; }
        .meta { color: #6b7280; font-size: 14px; margin-top: 8px; }
    </style>
</head>
<body>
    <header>
        <h1>BookmarkForge Export</h1>
        <p class="meta">Exported on ${formatDate(new Date(), {}, i18n.language)} | ${data.bookmarks.length} bookmarks | ${data.documents.length} documents</p>
    </header>
    <main>
`];

  if (data.bookmarks.length > 0) {
    htmlChunks.push(`        <section>
            <h2>Bookmarks</h2>
`);

    data.bookmarks.forEach((bookmark) => {
      htmlChunks.push(`            <div class="bookmark">
                <h3><a href="${SanitizationService.sanitizeUrl(bookmark.url)}" target="_blank" rel="noopener noreferrer">${sanitizeHtml(bookmark.title)}</a></h3>
                ${bookmark.description ? `<p>${sanitizeHtml(bookmark.description)}</p>` : ""}
                ${
                  bookmark.tags && bookmark.tags.length > 0
                    ? `
                    <div class="tags">
                        ${bookmark.tags.map((tag) => `<span class="tag">${sanitizeHtml(tag)}</span>`).join("")}
                    </div>
                `
                    : ""
                }
                <div class="meta">Created: ${formatExportDate(bookmark.createdAt)}</div>
            </div>`);
    });

    htmlChunks.push(`        </section>
`);
  }

  if (data.documents.length > 0) {
    htmlChunks.push(`        <section>
            <h2>Documents</h2>
`);

    data.documents.forEach((doc) => {
      htmlChunks.push(`            <div class="document">
                <h3>${sanitizeHtml(doc.title)}</h3>
                <div>${sanitizeHtml(doc.textContent || "")}</div>
                ${
                  doc.tags && doc.tags.length > 0
                    ? `
                    <div class="tags">
                        ${doc.tags.map((tag) => `<span class="tag">${sanitizeHtml(tag)}</span>`).join("")}
                    </div>
                `
                    : ""
                }
                <div class="meta">Created: ${formatExportDate(doc.createdAt)}</div>
            </div>`);
    });

    htmlChunks.push(`        </section>
`);
  }

  htmlChunks.push(`    </main>
    <footer>
        <p>Exported by <a href="https://bookmarkforgeapp.com">BookmarkForge</a></p>
    </footer>
</body>
</html>`);

  const blob = createTextBlob(htmlChunks, "text/html");

  return {
    success: true,
    format: "html",
    size: blob.size,
    filename: `bookmarkforge-export-${Date.now()}.html`,
    blob,
  };
}
