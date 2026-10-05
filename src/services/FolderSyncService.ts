/**
 * FolderSyncService — F1-E folder mode (bidirectional vault↔folder sync).
 *
 * Turns the vault (documents and bookmarks) into a folder of Obsidian-
 * compatible markdown notes and keeps the two directions in sync without
 * data loss:
 *
 * - Identity is the RxDB primary key, carried in frontmatter as `bmf_id`
 *   plus `bmf_type` (the same fields the Obsidian exporter writes). The type
 *   disambiguates the two collections, whose primary keys may collide, so a
 *   sync-state key is `${kind}:${id}`.
 * - Changes are detected per side with a content hash (files) and the RxDB
 *   revision (documents/bookmarks), stored in a localStorage sync-state map.
 *   Using a content hash rather than mtime avoids the classic "write a file,
 *   then it looks newer than the doc" feedback loop.
 * - When both sides changed since the last sync, the conflict is resolved
 *   with the same deterministic last-writer-wins order the WebRTC sync uses
 *   (`compareSyncVersions`: updatedAt → RxDB revision → id), so repeated
 *   syncs converge regardless of direction or order.
 * - Deletion propagates: a synced key that disappears on one side removes
 *   the surviving copy on the other. A key that was never synced (no state
 *   entry) is treated as a restore/seed instead, so exporting to a fresh
 *   folder or importing into an empty vault does not delete anything.
 *
 * Scope (F1-E slice): flat folder (`folderId: "root"`), no attachments or
 * nested-folder mirroring (candidate for F3-A desktop-file work). Bookmark
 * URLs are identity and are not editable from a file; wikilinks are
 * preserved verbatim in textContent but the resolved `links` id-array is not
 * mirrored.
 */

import {
  parseMarkdownNote,
  type MarkdownLink,
  type ParsedMarkdownNote,
} from "./importer.markdown";
import { compareSyncVersions } from "./webrtc-sync/compare";
import { FileSystemService } from "./FileSystemService";
import { attachmentStore, attachmentUrl } from "./documentAttachments";
import type { BookmarkForgeDB, DocumentDocument } from "../db/types";
import type { DocumentDocType, BookmarkDocType } from "../db/schema";
import type { RxDocument } from "rxdb";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { logger } from "../utils/logger";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import { fnv1aHash } from "../utils/hash";
import { decodeDataUrlToBytes } from "../utils/defensive-base64";

/** Upper bound for a single decoded inline attachment during folder sync. */
export const MAX_SYNC_ATTACHMENT_BYTES = 15 * 1024 * 1024;

type NoteKind = "bookmark" | "document";

interface SyncStateEntry {
  /** Deterministic hash of the last-seen file content. */
  fileHash: string;
  /** RxDB revision of the last-seen document state. */
  docRev: string;
}

type SyncState = Record<string, SyncStateEntry>;

interface FolderSyncResult {
  inserted: number;
  updatedDocs: number;
  writtenFiles: number;
  removedDocs: number;
  removedFiles: number;
  conflicts: number;
  unchanged: number;
}

const EMPTY_RESULT: FolderSyncResult = {
  inserted: 0,
  updatedDocs: 0,
  writtenFiles: 0,
  removedDocs: 0,
  removedFiles: 0,
  conflicts: 0,
  unchanged: 0,
};

/** Normalized payload shared by the document and bookmark collections. */
interface EntityData {
  kind: NoteKind;
  id: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  textContent?: string;
  url?: string;
  summary?: string;
  content?: string;
  relatedLinks?: string[];
}

/** A document/bookmark read from the database, plus its RxDB revision. */
interface DbEntity {
  data: EntityData;
  revision: string;
  /** Remove the entity from the collection. */
  remove: () => Promise<unknown>;
  /** Apply a file-side edit, returning the new revision. */
  applyFile: (note: EntityData) => Promise<string>;
}

interface FileNote {
  key: string;
  name: string;
  content: string;
  lastModified: number;
  data: EntityData;
}

const kindKey = (kind: NoteKind, id: string): string => `${kind}:${id}`;

function escapeYamlValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/** Mirrors the exporter's frontmatter dialect (double-quoted, inline arrays). */
function serializeFrontmatter(metadata: Record<string, unknown>): string {
  const lines = Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return `${key}: [${value
          .map((item: unknown) => `"${escapeYamlValue(String(item))}"`)
          .join(", ")}]`;
      }
      if (typeof value === "string") {
        return `${key}: "${escapeYamlValue(value)}"`;
      }
      return `${key}: ${String(value)}`;
    });
  return `---\n${lines.join("\n")}\n---\n`;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

/** Assign deterministic, collision-free filenames across both collections. */
function assignFileNames(entities: EntityData[]): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  const sorted = [...entities].sort((a, b) =>
    kindKey(a.kind, a.id) < kindKey(b.kind, b.id) ? -1 : 1,
  );
  for (const entity of sorted) {
    const base = slugify(entity.title);
    let name = base;
    if (used.has(name)) {
      name = `${base}-${entity.id.slice(0, 8)}`;
    }
    let candidate = name;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = `${name}-${counter}`;
      counter += 1;
    }
    used.add(candidate);
    names.set(kindKey(entity.kind, entity.id), `${candidate}.md`);
  }
  return names;
}

function mtimeIso(lastModified: number): string {
  if (Number.isFinite(lastModified) && lastModified > 0) {
    return new Date(lastModified).toISOString();
  }
  return new Date(0).toISOString();
}

function relatedLinksToUrls(links: MarkdownLink[]): string[] {
  const urls: string[] = [];
  for (const link of links) {
    if (link.kind === "url" && link.target) urls.push(link.target);
  }
  return urls;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
};

/** Short deterministic hash used to name extracted attachment files. */
function attachmentNameHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) % 0x100000000;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Decode a `data:` URL into bytes + extension (mirrors the exporter). Base64
 * payloads go through the shared defensive decoder; percent-encoded payloads
 * keep the bounded `decodeURIComponent` path. Malformed input returns `null`
 * so the caller leaves the reference untouched.
 */
function dataUrlToBytes(dataUrl: string): {
  bytes: Uint8Array;
  ext: string;
} | null {
  if (!dataUrl.startsWith("data:")) {return null;}
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {return null;}
  const header = dataUrl.slice(5, comma);
  const semi = header.indexOf(";");
  const mime = (semi === -1 ? header : header.slice(0, semi)).toLowerCase();
  let bytes: Uint8Array;
  if (header.toLowerCase().endsWith(";base64")) {
    const decoded = decodeDataUrlToBytes(dataUrl, MAX_SYNC_ATTACHMENT_BYTES);
    if (!decoded) {return null;}
    bytes = decoded.bytes;
  } else {
    const payload = dataUrl.slice(comma + 1);
    // Percent-encoding can expand input by up to 3x. Reject oversized
    // encoded payloads before `decodeURIComponent` allocates a large string.
    if (payload.length > MAX_SYNC_ATTACHMENT_BYTES * 3) {return null;}
    try {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    } catch {
      return null;
    }
  }
  const ext =
    MIME_TO_EXT[mime] ??
    (mime.includes("/") ? `.${mime.split("/")[1]}` : ".bin");
  return { bytes, ext };
}

/** Extract inline `data:` image URLs into `attachments/` files. */
function extractInlineAttachments(content: string): {
  text: string;
  attachments: { filename: string; bytes: Uint8Array }[];
} {
  const usedNames = new Set<string>();
  const attachments: { filename: string; bytes: Uint8Array }[] = [];
  const text = content.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (full: string, alt: string, url: string) => {
      if (!url.startsWith("data:")) {return full;}
      const decoded = dataUrlToBytes(url);
      if (!decoded) {return full;}
      const base = `image-${attachmentNameHash(url)}${decoded.ext}`;
      let filename = base;
      let counter = 2;
      while (usedNames.has(filename)) {
        const dot = base.lastIndexOf(".");
        filename = `${base.slice(0, dot)}-${counter}${decoded.ext}`;
        counter += 1;
      }
      usedNames.add(filename);
      attachments.push({ filename, bytes: decoded.bytes });
      return `![${alt}](attachments/${filename})`;
    },
  );
  return { text, attachments };
}

function parseFileToNote(file: {
  name: string;
  content: string;
  lastModified: number;
}): FileNote {
  const parsed: ParsedMarkdownNote = parseMarkdownNote(file.name, file.content);
  const kind: NoteKind = parsed.kind;
  const id = parsed.bmfId ?? "";
  return {
    key: id ? kindKey(kind, id) : "",
    name: file.name,
    content: file.content,
    lastModified: file.lastModified,
    data: {
      kind,
      id,
      title: parsed.title,
      tags: parsed.tags,
      createdAt: parsed.createdAt ?? "",
      updatedAt: parsed.updatedAt ?? "",
      textContent: parsed.textContent,
      url: parsed.url,
      summary: parsed.summary,
      content: parsed.content,
      relatedLinks: relatedLinksToUrls(parsed.relatedLinks),
    },
  };
}

export class FolderSyncService {
  private state: SyncState | null = null;

  private loadState(): SyncState {
    if (this.state) return this.state;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FOLDER_SYNC_STATE);
      this.state = raw ? (JSON.parse(raw) as SyncState) : {};
    } catch {
      this.state = {};
    }
    return this.state;
  }

  private saveState(state: SyncState): void {
    this.state = state;
    try {
      localStorage.setItem(
        STORAGE_KEYS.FOLDER_SYNC_STATE,
        JSON.stringify(state),
      );
    } catch (err) {
      logger.warn("Folder sync state could not be persisted", err);
    }
  }

  private serializeEntity(data: EntityData): string {
    if (data.kind === "bookmark") {
      return this.serializeBookmark(data);
    }
    return this.serializeDocument(data);
  }

  /**
   * Prepare a document for export: resolve persisted `bmf-attachment://`
   * refs to `data:` URLs, extract them into `attachments/` files, and rewrite
   * the text to the relative file refs. Bookmarks pass through untouched.
   */
  private async exportDocumentData(
    fs: FileSystemService,
    db: BookmarkForgeDB,
    data: EntityData,
  ): Promise<EntityData> {
    if (data.kind !== "document") {return data;}
    const resolved = await attachmentStore.resolveTextForExport(
      data.id,
      data.textContent ?? "",
      db,
    );
    const { text, attachments } = extractInlineAttachments(resolved);
    for (const attachment of attachments) {
      await fs.writeAttachmentFile(attachment.filename, attachment.bytes);
    }
    return { ...data, textContent: text };
  }

  /**
   * Prepare an imported document: persist `attachments/` refs back through
   * AttachmentStore and rewrite them to `bmf-attachment://` ids. Missing
   * attachment files are left verbatim (visible, debuggable).
   */
  private async importDocumentData(
    fs: FileSystemService,
    db: BookmarkForgeDB,
    docId: string,
    data: EntityData,
  ): Promise<EntityData> {
    if (data.kind !== "document") {return data;}
    const text = data.textContent ?? "";
    const filenames = new Set<string>();
    text.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_full, url: string) => {
      if (url.startsWith("attachments/")) {
        filenames.add(url.slice("attachments/".length));
      }
      return _full;
    });
    if (filenames.size === 0) {return data;}

    const files = await fs.readAttachmentFiles();
    const bytesByName = new Map(files.map((file) => [file.name, file.bytes]));
    const idByFilename = new Map<string, string>();
    for (const filename of filenames) {
      const bytes = bytesByName.get(filename);
      if (!bytes) {continue;}
      try {
        const id = await attachmentStore.persistFile(
          docId,
          new Blob([bytes.buffer as ArrayBuffer]),
          filename,
          db,
        );
        idByFilename.set(filename, id);
      } catch (err) {
        logger.warn(`[FolderSync] could not persist attachment "${filename}"`, err);
      }
    }

    const rewritten = text.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (full, alt: string, url: string) => {
        if (!url.startsWith("attachments/")) {return full;}
        const id = idByFilename.get(url.slice("attachments/".length));
        return id ? `![${alt}](${attachmentUrl(id)})` : full;
      },
    );
    return { ...data, textContent: rewritten };
  }

  private serializeDocument(data: EntityData): string {
    const frontmatter = serializeFrontmatter({
      title: data.title,
      tags: ["document", ...(data.tags || [])],
      bmf_id: data.id,
      bmf_type: "document",
      created: data.createdAt,
      updated: data.updatedAt,
    });
    return `${frontmatter}\n${data.textContent ?? ""}`;
  }

  private serializeBookmark(data: EntityData): string {
    const frontmatter = serializeFrontmatter({
      title: data.title,
      tags: ["bookmark", ...(data.tags || [])],
      url: data.url ?? "",
      bmf_id: data.id,
      bmf_type: "bookmark",
      created: data.createdAt,
      updated: data.updatedAt,
    });
    const sections: string[] = [];
    if (data.summary) sections.push(`## Summary\n\n${data.summary}`);
    if (data.content) sections.push(`## Content\n\n${data.content}`);
    const related = (data.relatedLinks || []).map(
      (url) => `- [${url}](${url})`,
    );
    if (related.length > 0) {
      sections.push(`## Related\n\n${related.join("\n")}`);
    }
    const body = sections.join("\n\n");
    const footerUrl = data.url ? `\n\n**URL:** ${data.url}` : "";
    const footerTags = (data.tags || []).length
      ? `\n\n**Tags:** ${data.tags.join(", ")}`
      : "";
    return `${frontmatter}\n\n# ${data.title}\n\n${body}${footerUrl}${footerTags}\n`;
  }

  private async readDocuments(
    db: BookmarkForgeDB,
  ): Promise<Map<string, DbEntity>> {
    const docs = (await db.documents.find().exec()).filter(
      (doc) => !doc.isDeleted,
    );
    const map = new Map<string, DbEntity>();
    for (const doc of docs) {
      map.set(kindKey("document", doc.id), this.documentEntity(doc));
    }
    return map;
  }

  private documentEntity(doc: DocumentDocument): DbEntity {
    return {
      data: {
        kind: "document",
        id: doc.id,
        title: doc.title,
        tags: doc.tags,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        textContent: doc.textContent ?? "",
      },
      revision: doc.revision ?? "",
      remove: () => doc.remove(),
      applyFile: async (note: EntityData) => {
        const updated = await doc.incrementalPatch({
          title: note.title,
          tags: note.tags,
          textContent: note.textContent ?? "",
          updatedAt: new Date().toISOString(),
        });
        return updated.revision ?? "";
      },
    };
  }

  private async readBookmarks(
    db: BookmarkForgeDB,
  ): Promise<Map<string, DbEntity>> {
    const docs = (await db.bookmarks.find().exec()).filter(
      (doc) => !doc.isDeleted,
    );
    const map = new Map<string, DbEntity>();
    for (const doc of docs) {
      map.set(kindKey("bookmark", doc.id), this.bookmarkEntity(doc));
    }
    return map;
  }

  private bookmarkEntity(doc: RxDocument<BookmarkDocType>): DbEntity {
    return {
      data: {
        kind: "bookmark",
        id: doc.id,
        title: doc.title,
        tags: doc.tags,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        url: doc.url,
        summary: doc.summary ?? "",
        content: doc.content ?? "",
        relatedLinks: doc.relatedLinks ?? [],
      },
      revision: doc.revision ?? "",
      remove: () => doc.remove(),
      applyFile: async (note: EntityData) => {
        // URL is identity (and urlHash is an encrypted-field index) — never
        // rewrite it from a file edit.
        const updated = await doc.incrementalPatch({
          title: note.title,
          tags: note.tags,
          summary: note.summary ?? "",
          content: note.content ?? "",
          relatedLinks: note.relatedLinks ?? [],
          updatedAt: new Date().toISOString(),
        });
        return updated.revision ?? "";
      },
    };
  }

  private async insertDocument(
    db: BookmarkForgeDB,
    id: string,
    note: EntityData,
  ): Promise<string> {
    const docData: DocumentDocType = {
      id,
      folderId: "root",
      title: note.title,
      blocks: [],
      textContent: note.textContent ?? "",
      summary: "",
      tags: note.tags,
      links: [],
      embedding: [],
      processed: false,
      isPrivate: false,
      isDeleted: false,
      createdAt: note.createdAt || new Date().toISOString(),
      updatedAt: note.updatedAt || new Date().toISOString(),
    };
    const inserted = await db.documents.insert(docData);
    return inserted.revision ?? "";
  }

  private async insertBookmark(
    db: BookmarkForgeDB,
    id: string,
    note: EntityData,
  ): Promise<string> {
    const url = note.url ?? "";
    const docData: BookmarkDocType = {
      id,
      url,
      urlHash: await hashString(url),
      title: note.title,
      content: note.content ?? "",
      summary: note.summary ?? "",
      tags: note.tags,
      relatedLinks: note.relatedLinks ?? [],
      embedding: [],
      processed: false,
      isPrivate: false,
      isDeleted: false,
      visitCount: 0,
      createdAt: note.createdAt || new Date().toISOString(),
      updatedAt: note.updatedAt || new Date().toISOString(),
    };
    const inserted = await db.bookmarks.insert(docData);
    return inserted.revision ?? "";
  }

  /**
   * Synchronize the vault with the granted folder. Returns a summary of the
   * operations performed. Safe to call repeatedly; repeated syncs of an
   * unchanged vault are a no-op (convergence).
   */
  async sync(
    db: BookmarkForgeDB,
    fs: FileSystemService,
  ): Promise<FolderSyncResult> {
    const result: FolderSyncResult = { ...EMPTY_RESULT };
    const state = this.loadState();
    const nextState: SyncState = {};

    // ── Read both sides ────────────────────────────────────────────────
    const files = await fs.readMarkdownFilesWithMeta();
    const fileByKey = new Map<string, FileNote>();
    const newFiles: FileNote[] = [];
    for (const file of files) {
      const note = parseFileToNote(file);
      if (note.key) {
        fileByKey.set(note.key, note);
      } else {
        newFiles.push(note);
      }
    }

    const docEntities = await this.readDocuments(db);
    const bookmarkEntities = await this.readBookmarks(db);
    const entities = new Map<string, DbEntity>([
      ...docEntities,
      ...bookmarkEntities,
    ]);

    const names = assignFileNames(
      [...entities.values()].map((entity) => entity.data),
    );

    // ── Seed: files without an id become new entities, then get one ────
    for (const note of newFiles) {
      const id = generateId();
      const key = kindKey(note.data.kind, id);
      const data: EntityData = { ...note.data, id };
      const dbData =
        data.kind === "document"
          ? await this.importDocumentData(fs, db, id, data)
          : data;
      const revision =
        data.kind === "bookmark"
          ? await this.insertBookmark(db, id, dbData)
          : await this.insertDocument(db, id, dbData);
      const content = this.serializeEntity(data);
      await fs.writeMarkdownFile(note.name, content);
      nextState[key] = { fileHash: fnv1aHash(content), docRev: revision };
      result.inserted += 1;
      result.writtenFiles += 1;
    }

    // ── Sync the union of both key sets ────────────────────────────────
    const allKeys = new Set<string>([
      ...fileByKey.keys(),
      ...entities.keys(),
    ]);

    for (const key of allKeys) {
      const file = fileByKey.get(key);
      const entity = entities.get(key);
      const prev = state[key];

      if (file && entity) {
        const fileChanged =
          !prev || fnv1aHash(file.content) !== prev.fileHash;
        const docChanged = !prev || entity.revision !== prev.docRev;

        if (!fileChanged && !docChanged) {
          result.unchanged += 1;
          nextState[key] = prev!;
          continue;
        }

        if (!fileChanged && docChanged) {
          const target = names.get(key) ?? `${slugify(entity.data.title)}.md`;
          const content = this.serializeEntity(
            await this.exportDocumentData(fs, db, entity.data),
          );
          await fs.writeMarkdownFile(target, content);
          if (target !== file.name) {
            await fs.removeMarkdownFile(file.name);
          }
          nextState[key] = {
            fileHash: fnv1aHash(content),
            docRev: entity.revision,
          };
          result.writtenFiles += 1;
        } else if (fileChanged && !docChanged) {
          const revision = await entity.applyFile(
            await this.importDocumentData(fs, db, entity.data.id, file.data),
          );
          nextState[key] = {
            fileHash: fnv1aHash(file.content),
            docRev: revision,
          };
          result.updatedDocs += 1;
        } else {
          // Both changed — deterministic LWW (same order as WebRTC sync).
          result.conflicts += 1;
          const fileVersion = {
            id: entity.data.id,
            updatedAt: mtimeIso(file.lastModified),
            _rev: "",
          };
          const docVersion = {
            id: entity.data.id,
            updatedAt: entity.data.updatedAt,
            _rev: entity.revision,
          };
          if (compareSyncVersions(fileVersion, docVersion) > 0) {
            const revision = await entity.applyFile(
            await this.importDocumentData(fs, db, entity.data.id, file.data),
          );
            nextState[key] = {
              fileHash: fnv1aHash(file.content),
              docRev: revision,
            };
            result.updatedDocs += 1;
          } else {
            const target = names.get(key) ?? `${slugify(entity.data.title)}.md`;
            const content = this.serializeEntity(
            await this.exportDocumentData(fs, db, entity.data),
          );
            await fs.writeMarkdownFile(target, content);
            if (target !== file.name) {
              await fs.removeMarkdownFile(file.name);
            }
            nextState[key] = {
              fileHash: fnv1aHash(content),
              docRev: entity.revision,
            };
            result.writtenFiles += 1;
          }
        }
      } else if (file && !entity) {
        if (prev) {
          // Entity deleted in-app → remove the file (deletion propagates).
          await fs.removeMarkdownFile(file.name);
          result.removedFiles += 1;
        } else {
          // File with an id but no matching entity → restore/seed it.
          const id = file.data.id;
          const dbData =
            file.data.kind === "document"
              ? await this.importDocumentData(fs, db, id, file.data)
              : file.data;
          const revision =
            file.data.kind === "bookmark"
              ? await this.insertBookmark(db, id, dbData)
              : await this.insertDocument(db, id, dbData);
          nextState[key] = {
            fileHash: fnv1aHash(file.content),
            docRev: revision,
          };
          result.inserted += 1;
        }
      } else if (!file && entity) {
        if (prev) {
          // File deleted on disk → remove the entity.
          await entity.remove();
          result.removedDocs += 1;
        } else {
          // Entity without a file → export to the folder.
          const target = names.get(key) ?? `${slugify(entity.data.title)}.md`;
          const content = this.serializeEntity(
            await this.exportDocumentData(fs, db, entity.data),
          );
          await fs.writeMarkdownFile(target, content);
          nextState[key] = {
            fileHash: fnv1aHash(content),
            docRev: entity.revision,
          };
          result.writtenFiles += 1;
        }
      }
    }

    this.saveState(nextState);
    return result;
  }
}

