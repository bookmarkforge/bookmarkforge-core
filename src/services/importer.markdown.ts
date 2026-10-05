/**
 * importer.markdown.ts — Markdown/Obsidian import support for UniversalImporter.
 *
 * Parses the exact dialect the Obsidian exporter emits (exporter.formatters.ts):
 *
 *   - `---` frontmatter with double-quoted strings (backslash, quote, newline
 *     and carriage-return escapes) and `["a", "b"]` string arrays
 *   - `[[wikilinks]]` in the `## Related` (bookmarks) and `## Linked notes`
 *     (documents) sections
 *   - a `folder: "path/to/folder"` frontmatter key that mirrors documents
 *     into the app's folder tree
 *   - `attachments/`-folder image refs (`![alt](relative/path)`) that the
 *     import pipeline re-persists through AttachmentStore
 *
 * This module is pure parsing — no database access. The write pipeline lives
 * in UniversalImporter so it shares the journal/rollback machinery.
 */

/** A markdown image reference whose target points into the attachments dir. */
export interface MarkdownNoteAttachmentRef {
  alt: string;
  /** Raw relative path exactly as written in the note. */
  path: string;
}

/** A `## Related` link: an internal `[[wikilink]]` or an external URL. */
export interface MarkdownLink {
  kind: "wikilink" | "url";
  target: string;
}

export interface ParsedMarkdownNote {
  kind: "bookmark" | "document";
  /** Note name (filename without `.md`) — the target of `[[wikilinks]]`. */
  slug: string;
  title: string;
  url?: string;
  summary?: string;
  content?: string;
  textContent?: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  /** Stable dedup contract id emitted by the exporter (`bmf_id`). */
  bmfId?: string;
  folderPath?: string;
  relatedLinks: MarkdownLink[];
  linkedNotes: string[];
  attachmentRefs: MarkdownNoteAttachmentRef[];
}

// ── Path helpers ───────────────────────────────────────────────────────────

export function isMarkdownFilePath(path: string): boolean {
  return /\.md$/i.test(path);
}

/** Folder entries that carry importable attachment bytes. */
export function isAttachmentPath(path: string): boolean {
  return /^(?:attachments|_attachments)\//i.test(path.replace(/\\/g, "/"));
}

/** Strip `./` and `../` prefixes so relative refs resolve from the vault root. */
export function normalizeAttachmentRefPath(path: string): string {
  let normalized = path.trim();
  while (normalized.startsWith("./") || normalized.startsWith("../")) {
    normalized = normalized.slice(normalized.startsWith("../") ? 3 : 2);
  }
  return normalized;
}

/** Note name (filename without `.md`) — the target of `[[wikilinks]]`. */
export function noteSlugFromPath(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.md$/i, "");
}

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

export function mimeFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

/**
 * Validate a folder path from untrusted frontmatter. Returns the normalized
 * slash-joined path, or undefined when a segment would traverse the vault
 * (`..`), contain path separators or shell-ish control characters, or exceed
 * the depth/size caps the rest of the importer enforces.
 */
export function sanitizeFolderPath(path: string): string | undefined {
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.length > 20) {return undefined;}
  for (const segment of segments) {
    if (segment.length > 100) {return undefined;}
    if (/^\.{1,2}$/.test(segment)) {return undefined;}
    if (/[\\:*?"<>|]/.test(segment)) {return undefined;}
  }
  return segments.join("/");
}

// ── Frontmatter ────────────────────────────────────────────────────────────

export function hasFrontmatter(content: string): boolean {
  return content.startsWith("---\n") || content.startsWith("---\r\n");
}

export interface ParsedFrontmatter {
  metadata: Record<string, unknown>;
  body: string;
}

/**
 * Split a note into its `---` frontmatter block and markdown body. Returns
 * null when there is no fence or the block is unterminated. The exporter
 * escapes newlines inside values, so the closing fence is always a line that
 * is exactly `---`; user-written values cannot span lines in this dialect.
 */
export function splitFrontmatter(content: string): ParsedFrontmatter | null {
  if (!hasFrontmatter(content)) {return null;}
  const lines = content.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (end === -1) {return null;}
  const metadata = parseFrontmatterLines(lines.slice(1, end));
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  return { metadata, body };
}

function parseFrontmatterLines(lines: string[]): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {continue;}
    const colon = trimmed.indexOf(":");
    if (colon === -1) {continue;}
    const key = trimmed.slice(0, colon).trim();
    if (!key || key.length > 100) {continue;}
    metadata[key] = parseFrontmatterValue(trimmed.slice(colon + 1).trim());
  }
  return metadata;
}

function parseFrontmatterValue(raw: string): unknown {
  if (raw.startsWith('"')) {return parseDoubleQuotedString(raw);}
  if (raw.startsWith("[")) {return parseFrontmatterArray(raw);}
  if (raw === "true") {return true;}
  if (raw === "false") {return false;}
  if (raw === "null") {return null;}
  if (/^-?\d+(\.\d+)?$/.test(raw)) {return Number(raw);}
  return raw;
}

/** Parse the exporter's `["a", "b"]` array dialect (quoted, comma-joined). */
function parseFrontmatterArray(raw: string): string[] {
  const inner = raw.endsWith("]") ? raw.slice(1, -1) : raw.slice(1);
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < inner.length; index++) {
    const ch = inner[index]!;
    if (ch === '"') {
      current += ch;
      if (!isEscapedQuote(inner, index)) {inQuotes = !inQuotes;}
    } else if (ch === "," && !inQuotes) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  const last = current.trim();
  if (last) {parts.push(last);}
  return parts.map((part) =>
    part.startsWith('"') ? parseDoubleQuotedString(part) : part,
  );
}

/** True when the quote at `index` is escaped by an odd run of backslashes. */
function isEscapedQuote(value: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === "\\"; i--) {backslashes++;}
  return backslashes % 2 === 1;
}

/**
 * Parse a double-quoted string in the exporter's escape dialect: `\\`, `\"`,
 * `\n`, `\r`, `\t` (any other `\x` collapses to `x`). Stops at the first
 * unescaped closing quote.
 */
function parseDoubleQuotedString(raw: string): string {
  let out = "";
  let escaped = false;
  for (let index = 1; index < raw.length; index++) {
    const ch = raw[index]!;
    if (escaped) {
      if (ch === "n") {out += "\n";}
      else if (ch === "r") {out += "\r";}
      else if (ch === "t") {out += "\t";}
      else {out += ch;}
      escaped = false;
    } else if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      break;
    } else {
      out += ch;
    }
  }
  return out;
}

// ── Wikilinks ──────────────────────────────────────────────────────────────

export function extractWikilinkTargets(text: string): string[] {
  const targets: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  for (const match of text.matchAll(regex)) {
    const raw = match[1] ?? "";
    // Obsidian aliases (`[[note|alias]]`) resolve to the note itself.
    const target = raw.split("|")[0]!.trim();
    if (target && !targets.includes(target)) {targets.push(target);}
  }
  return targets;
}

// ── Note parsing ───────────────────────────────────────────────────────────

/** The first `# ` level-1 heading in a note (used as a raw-file title). */
function extractTitleHeading(body: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim();
}

function titleFromFrontmatter(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stripTitleHeading(body: string): string {
  return body.replace(/^#\s+.+\n?/, "");
}

const BOOKMARK_MARKER_TAG = "bookmark";
const DOCUMENT_MARKER_TAG = "document";

/**
 * The exporter prepends a type marker tag (`tags: ["bookmark", ...]`). Strip
 * the FIRST occurrence so a re-import → re-export round-trip reproduces the
 * original tag set instead of accumulating `["bookmark", "bookmark", ...]`.
 */
function stripMarkerTag(tags: string[], marker: string): string[] {
  const index = tags.indexOf(marker);
  if (index === -1) {return tags;}
  return tags.slice(0, index).concat(tags.slice(index + 1));
}

const LINKED_NOTES_HEADING = "## Linked notes";

function splitDocumentBody(body: string): {
  textContent?: string;
  linkedNotes: string[];
} {
  const index = body.indexOf(LINKED_NOTES_HEADING);
  if (index === -1) {
    return { textContent: body.trim() || undefined, linkedNotes: [] };
  }
  return {
    textContent: body.slice(0, index).trim() || undefined,
    linkedNotes: extractWikilinkTargets(
      body.slice(index + LINKED_NOTES_HEADING.length),
    ),
  };
}

function parseBookmarkBody(body: string): {
  summary?: string;
  content?: string;
  relatedLinks: MarkdownLink[];
} {
  const lines = body.split("\n");
  let section: "stray" | "summary" | "content" | "related" | "skip" = "stray";
  const stray: string[] = [];
  const summary: string[] = [];
  const content: string[] = [];
  const related: string[] = [];
  for (const line of lines) {
    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      const name = headingMatch[1]!.trim().toLowerCase();
      if (name === "summary") {section = "summary";}
      else if (name === "content") {section = "content";}
      else if (name === "related") {section = "related";}
      else {section = "skip";}
      continue;
    }
    // The exporter's footer lines duplicate the frontmatter — drop them.
    if (/^\*\*(?:URL|Tags):\*\*/.test(line.trim())) {continue;}
    if (section === "stray") {stray.push(line);}
    else if (section === "summary") {summary.push(line);}
    else if (section === "content") {content.push(line);}
    else if (section === "related") {related.push(line);}
  }
  const strayText = stray.join("\n").trim();
  const contentText = content.join("\n").trim();
  const summaryText = summary.join("\n").trim();
  return {
    summary: summaryText || undefined,
    content: [strayText, contentText].filter(Boolean).join("\n\n") || undefined,
    relatedLinks: parseRelatedLinks(related.join("\n")),
  };
}

function parseRelatedLinks(text: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim().replace(/^-\s+/, "");
    if (!trimmed) {continue;}
    if (trimmed.startsWith("[[")) {
      for (const target of extractWikilinkTargets(trimmed)) {
        links.push({ kind: "wikilink", target });
      }
    } else {
      const urlMatch = /^\[[^\]]*\]\(([^)]+)\)$/.exec(trimmed);
      const candidate = urlMatch ? urlMatch[1]! : trimmed;
      if (/^https?:\/\//.test(candidate)) {
        links.push({ kind: "url", target: candidate });
      }
    }
  }
  return links;
}

const ATTACHMENT_REF_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Collect markdown image refs whose target points into an attachments folder.
 * The exporter writes refs relative to the note's own directory
 * (`../../attachments/x.png`), so refs are normalized before the check.
 */
export function findAttachmentRefs(...texts: string[]): MarkdownNoteAttachmentRef[] {
  const refs: MarkdownNoteAttachmentRef[] = [];
  for (const text of texts) {
    if (!text) {continue;}
    for (const match of text.matchAll(ATTACHMENT_REF_REGEX)) {
      const path = (match[2] ?? "").trim();
      if (!path) {continue;}
      const normalized = normalizeAttachmentRefPath(path);
      const segments = normalized.split("/");
      if (
        segments.some(
          (segment) => segment === "attachments" || segment === "_attachments",
        )
      ) {
        refs.push({ alt: match[1] ?? "", path });
      }
    }
  }
  return refs;
}

/**
 * Rewrite one image ref back to the app's stable attachment scheme
 * (`bmf-attachment://<id>`), reversing the exporter's data-URL extraction.
 */
export function rewriteAttachmentRef(
  text: string,
  ref: MarkdownNoteAttachmentRef,
  storedId: string,
): string {
  const escaped = ref.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(
    new RegExp(`(!\\[[^\\]]*\\]\\()${escaped}(\\))`, "g"),
    `$1bmf-attachment://${storedId}$2`,
  );
}

const SAFE_BMF_ID = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Parse a single markdown note into an importable record. The kind is decided
 * by the exporter's `bmf_type`, falling back to `url` presence (a note with a
 * URL is a bookmark) and finally to document — so raw markdown files import
 * as documents without any frontmatter.
 */
export function parseMarkdownNote(
  path: string,
  content: string,
): ParsedMarkdownNote {
  const split = splitFrontmatter(content);
  const metadata = split?.metadata ?? {};
  const body = split?.body ?? content;

  const rawType = typeof metadata.bmf_type === "string" ? metadata.bmf_type : "";
  const rawUrl = typeof metadata.url === "string" ? metadata.url.trim() : "";
  const kind: "bookmark" | "document" =
    rawType === "bookmark" || (rawType !== "document" && rawUrl !== "")
      ? "bookmark"
      : "document";

  const heading = extractTitleHeading(body);
  const hasFrontmatterTitle = titleFromFrontmatter(metadata.title) !== undefined;
  const title =
    titleFromFrontmatter(metadata.title) ?? heading ?? noteSlugFromPath(path);

  const rawTags = Array.isArray(metadata.tags)
    ? metadata.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const marker = kind === "bookmark" ? BOOKMARK_MARKER_TAG : DOCUMENT_MARKER_TAG;
  const tags = stripMarkerTag(rawTags, marker);

  const bmfId =
    typeof metadata.bmf_id === "string" && SAFE_BMF_ID.test(metadata.bmf_id)
      ? metadata.bmf_id
      : undefined;
  const createdAt =
    typeof metadata.created === "string" ? metadata.created : undefined;
  const updatedAt =
    typeof metadata.updated === "string" ? metadata.updated : undefined;

  if (kind === "bookmark") {
    // The exporter scaffolds an H1 (`# title`) above the body sections.
    const parsed = parseBookmarkBody(stripTitleHeading(body));
    return {
      kind,
      slug: noteSlugFromPath(path),
      title,
      url: rawUrl || undefined,
      summary: parsed.summary,
      content: parsed.content,
      tags,
      createdAt,
      updatedAt,
      bmfId,
      relatedLinks: parsed.relatedLinks,
      linkedNotes: [],
      attachmentRefs: findAttachmentRefs(
        parsed.content ?? "",
        parsed.summary ?? "",
      ),
    };
  }

  // Exporters emit the body verbatim; only raw frontmatter-less files get
  // their H1 promoted to the title and stripped from the text.
  const textContentSource = hasFrontmatterTitle ? body : stripTitleHeading(body);
  const parsedDocument = splitDocumentBody(textContentSource);
  return {
    kind,
    slug: noteSlugFromPath(path),
    title,
    folderPath:
      typeof metadata.folder === "string" ? metadata.folder : undefined,
    textContent: parsedDocument.textContent,
    tags,
    createdAt,
    updatedAt,
    bmfId,
    relatedLinks: [],
    linkedNotes: parsedDocument.linkedNotes,
    attachmentRefs: findAttachmentRefs(parsedDocument.textContent ?? ""),
  };
}
