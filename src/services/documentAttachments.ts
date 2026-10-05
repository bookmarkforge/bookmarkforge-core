/**
 * AttachmentStore — durable storage for block-editor attachments.
 *
 * The BlockNote editor renders images through ephemeral `blob:` ObjectURLs
 * (tracked by ObjectUrlRegistry). Those URLs die on reload and their bytes
 * were never persisted, so a document saved with an image lost the image
 * (and exports shipped a dead `blob:` link).
 *
 * This service fixes that at the persistence boundary, without touching how
 * the editor renders:
 *
 *   - `persistFile` stores the raw bytes (as an encrypted `data:` URL) in a
 *     dedicated RxDB collection and returns a stable attachment id.
 *   - `persistBlocks` / `persistText` rewrite live `blob:` references to the
 *     stable scheme `bmf-attachment://<id>` before autosave, so what lands in
 *     the vault is deterministic and survives reload.
 *   - `hydrateBlocks` reverses that on load: it fetches the stored bytes,
 *     creates fresh ObjectURLs and hands the editor renderable `blob:` URLs.
 *   - `resolveTextForExport` rewrites the stable refs back to full `data:`
 *     URLs so exporters (which already decode `data:` URLs into attachment
 *     files) produce faithful output.
 *
 * The `blob:` ↔ id map is session-scoped (module state); it is rebuilt every
 * time a document is hydrated. Only URLs this process created are rewritable,
 * which keeps foreign `blob:` URLs (none exist in practice) untouched.
 */
import { initDB } from "../db/database";
import type { BookmarkForgeDB } from "../db/types";
import type { DocumentAttachmentDocType } from "../db/schema";
import { hashString } from "../utils/crypto-core";
import { decodeDataUrlToBytes } from "../utils/defensive-base64";
import { logger } from "../utils/logger";

/** Stable URL scheme stored inside blocks / textContent for one attachment. */
export const ATTACHMENT_URL_PREFIX = "bmf-attachment://";

export function attachmentUrl(attachmentId: string): string {
  return `${ATTACHMENT_URL_PREFIX}${attachmentId}`;
}

function parseAttachmentUrl(url: string): string | null {
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) {return null;}
  const id = url.slice(ATTACHMENT_URL_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** Session-scoped map from live ObjectURL → persisted attachment id. */
const blobUrlToAttachmentId = new Map<string, string>();

/**
 * ObjectURLs created by hydrateBlocks/hydrateText, grouped by document.
 * These URLs are created directly (not through a component's registry), so
 * they would otherwise stay alive until the page unloads — each open of a
 * document with attachments would pin its blobs in memory forever.
 * revokeDocumentUrls() releases them when the owner (document editor)
 * unmounts or switches documents.
 */
const hydratedUrlsByDocument = new Map<string, Set<string>>();

/** Track a hydrated ObjectURL so the owning document can release it. */
function trackHydratedUrl(documentId: string, url: string): void {
  let urls = hydratedUrlsByDocument.get(documentId);
  if (!urls) {
    urls = new Set<string>();
    hydratedUrlsByDocument.set(documentId, urls);
  }
  urls.add(url);
}

/** Max bytes of decoded payload we accept per attachment (≈ base64 cap). */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

type AttachmentRecord = DocumentAttachmentDocType;

/** The only part of the database the store touches. */
export type AttachmentDb = Pick<BookmarkForgeDB, "documentAttachments">;

type AttachmentCollection = {
  upsert: (doc: AttachmentRecord) => Promise<unknown>;
  find: (query?: {
    selector?: Record<string, unknown>;
  }) => {
    exec: () => Promise<Array<{ toJSON: () => AttachmentRecord }>>;
  };
};

function getAttachmentCollection(db: AttachmentDb): AttachmentCollection {
  const collection = (db as unknown as Record<string, unknown>)
    .documentAttachments as AttachmentCollection | undefined;
  if (!collection) {
    throw new Error(
      "documentAttachments collection is not registered on the database instance",
    );
  }
  return collection;
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("FileReader did not produce a data URL"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Decode a stored attachment `data:` URL into raw bytes + MIME type. Malformed
 * or oversized payloads return `null` (the caller leaves the reference
 * untouched); the decode is delegated to the shared defensive Base64
 * decoder (`decodeDataUrlToBytes` in utils/defensive-base64).
 */
function dataUrlToBlobParts(dataUrl: string): {
  bytes: Uint8Array;
  mimeType: string;
} | null {
  return decodeDataUrlToBytes(dataUrl, MAX_ATTACHMENT_BYTES);
}

/** Deep-walk a block tree, mapping every string via `rewrite`. */
function mapBlockUrls(
  value: unknown,
  rewrite: (url: string) => string | null,
): unknown {
  if (typeof value === "string") {
    if (!value.startsWith("blob:") && !value.startsWith(ATTACHMENT_URL_PREFIX)) {
      return value;
    }
    return rewrite(value) ?? value;
  }
  if (Array.isArray(value)) {
    const mapped = value.map((item) => mapBlockUrls(item, rewrite));
    return mapped.every((item, index) => Object.is(item, value[index]))
      ? value
      : mapped;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      const next = mapBlockUrls(record[key], rewrite);
      out[key] = next;
      if (!Object.is(next, record[key])) {changed = true;}
    }
    return changed ? out : value;
  }
  return value;
}

/**
 * Walks a `PartialBlock[]` (or a single block) and rewrites image URLs.
 * Returns the ORIGINAL input when nothing changed, a shallow-cloned tree
 * otherwise — so callers can safely persist the result without churning the
 * live editor document.
 */
function rewriteBlockUrls(
  blocks: unknown,
  rewrite: (url: string) => string | null,
): unknown {
  return mapBlockUrls(blocks, rewrite);
}

/** Replace markdown image refs `![alt](url)` whose url the rewrite accepts. */
function rewriteMarkdownImageUrls(
  text: string,
  rewrite: (url: string) => string | null,
): string {
  return text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (full: string, alt: string, url: string) => {
      const rewritten = rewrite(url);
      return rewritten === null ? full : `![${alt}](${rewritten})`;
    },
  );
}

export class AttachmentStore {
  /**
   * Persist a file's bytes for a document and return the stable attachment id.
   * The caller creates the ObjectURL it wants to render and calls `register`
   * to bind it to the returned id.
   */
  async persistFile(
    documentId: string,
    file: Blob,
    filename?: string,
    db?: AttachmentDb,
  ): Promise<string> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachment exceeds the ${MAX_ATTACHMENT_BYTES} byte limit`,
      );
    }
    const dataUrl = await readFileAsDataUrl(file);
    const dataUrlParts = dataUrlToBlobParts(dataUrl);
    if (!dataUrlParts) {
      throw new Error("Attachment could not be encoded as base64");
    }
    const name =
      filename ?? (file instanceof File && file.name ? file.name : "attachment");
    // Stable id: identical bytes + name → identical id → uploads dedup.
    const id = `att-${documentId.slice(0, 8)}-${(
      await hashString(`${documentId}:${name}:${dataUrl}`)
    ).slice(0, 24)}`;
    const instance = db ?? (await initDB());
    await getAttachmentCollection(instance).upsert({
      id,
      documentId,
      filename: name,
      mimeType: dataUrlParts.mimeType,
      dataUrl,
      size: file.size,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  /** Bind a live ObjectURL to its persisted attachment id. */
  register(blobUrl: string, attachmentId: string): void {
    if (!blobUrl.startsWith("blob:")) {return;}
    blobUrlToAttachmentId.set(blobUrl, attachmentId);
  }

  /** Map a live ObjectURL to its attachment id, if this session knows it. */
  lookupByBlobUrl(blobUrl: string): string | null {
    return blobUrlToAttachmentId.get(blobUrl) ?? null;
  }

  /**
   * Rewrite a block tree for persistence: live `blob:` URLs registered this
   * session become `bmf-attachment://<id>`. `data:` URLs and unregistered
   * `blob:` URLs (foreign / already-dead) pass through untouched.
   */
  async persistBlocks(
    documentId: string,
    blocks: unknown,
    db?: AttachmentDb,
  ): Promise<unknown> {
    void documentId;
    void db;
    return rewriteBlockUrls(blocks, (url) => {
      if (!url.startsWith("blob:")) {return null;}
      const attachmentId = blobUrlToAttachmentId.get(url);
      return attachmentId ? attachmentUrl(attachmentId) : null;
    });
  }

  /**
   * Rewrite markdown text for persistence: `![alt](blob:…)` image refs whose
   * ObjectURL is registered become `bmf-attachment://<id>` refs.
   */
  async persistText(documentId: string, text: string): Promise<string> {
    void documentId;
    return rewriteMarkdownImageUrls(text, (url) => {
      if (!url.startsWith("blob:")) {return null;}
      const attachmentId = blobUrlToAttachmentId.get(url);
      return attachmentId ? attachmentUrl(attachmentId) : null;
    });
  }

  /**
   * Turn persisted `bmf-attachment://<id>` refs in a block tree back into
   * renderable ObjectURLs. Also registers the new URLs so a later autosave
   * round-trips them to the same ids.
   */
  async hydrateBlocks(
    documentId: string,
    blocks: unknown,
    db?: AttachmentDb,
  ): Promise<unknown> {
    const ids = new Set<string>();
    const collect = (value: unknown): void => {
      if (typeof value === "string") {
        const id = parseAttachmentUrl(value);
        if (id) {ids.add(id);}
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {collect(item);}
        return;
      }
      if (value && typeof value === "object") {
        for (const child of Object.values(value)) {collect(child);}
      }
    };
    collect(blocks);
    if (ids.size === 0) {return blocks;}

    const records = await this.getAttachmentsForDocument(documentId, db);
    const byId = new Map(records.map((record) => [record.id, record]));

    return rewriteBlockUrls(blocks, (url) => {
      const id = parseAttachmentUrl(url);
      if (!id) {return null;}
      const record = byId.get(id);
      if (!record) {return null;} // orphan ref — leave as-is (visible, debuggable)
      const parts = dataUrlToBlobParts(record.dataUrl);
      if (!parts) {return null;}
      const blobUrl = URL.createObjectURL(
        new Blob([parts.bytes.buffer as ArrayBuffer], { type: parts.mimeType }),
      );
      blobUrlToAttachmentId.set(blobUrl, record.id);
      trackHydratedUrl(documentId, blobUrl);
      return blobUrl;
    });
  }

  /**
   * Release every ObjectURL this store created for a document. Called by the
   * document editor's unmount/cleanup so hydrated attachment blobs are not
   * pinned in memory for the lifetime of the page.
   */
  revokeDocumentUrls(documentId: string): void {
    const urls = hydratedUrlsByDocument.get(documentId);
    if (!urls) {return;}
    hydratedUrlsByDocument.delete(documentId);
    for (const url of urls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Best-effort revoke; a failing revocation must not break teardown.
      }
    }
    urls.clear();
  }

  /**
   * Rewrite persisted refs in markdown text back to renderable ObjectURLs
   * (for the live preview, which is fed `textContent`). Registers the fresh
   * URLs so a later autosave round-trips them to the same ids.
   */
  async hydrateText(
    documentId: string,
    text: string,
    db?: AttachmentDb,
  ): Promise<string> {
    if (!text.includes(ATTACHMENT_URL_PREFIX)) {return text;}
    const records = await this.getAttachmentsForDocument(documentId, db);
    const byId = new Map(records.map((record) => [record.id, record]));
    return rewriteMarkdownImageUrls(text, (url) => {
      const id = parseAttachmentUrl(url);
      if (!id) {return null;}
      const record = byId.get(id);
      if (!record) {return null;}
      const parts = dataUrlToBlobParts(record.dataUrl);
      if (!parts) {return null;}
      const blobUrl = URL.createObjectURL(
        new Blob([parts.bytes.buffer as ArrayBuffer], { type: parts.mimeType }),
      );
      blobUrlToAttachmentId.set(blobUrl, record.id);
      trackHydratedUrl(documentId, blobUrl);
      return blobUrl;
    });
  }

  /** All attachment records belonging to a document. */
  async getAttachmentsForDocument(
    documentId: string,
    db?: AttachmentDb,
  ): Promise<AttachmentRecord[]> {
    const instance = db ?? (await initDB());
    try {
      const docs = await getAttachmentCollection(instance)
        .find({ selector: { documentId } })
        .exec();
      return docs.map((doc) => doc.toJSON());
    } catch (error) {
      logger.warn("[AttachmentStore] failed to read document attachments", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Resolve persisted refs in markdown text back to full `data:` URLs so
   * exporters produce self-contained output (the Obsidian formatter already
   * extracts `data:` URLs into an `attachments/` folder).
   */
  async resolveTextForExport(
    documentId: string,
    text: string,
    db?: AttachmentDb,
  ): Promise<string> {
    if (!text.includes(ATTACHMENT_URL_PREFIX)) {return text;}
    const records = await this.getAttachmentsForDocument(documentId, db);
    const byId = new Map(records.map((record) => [record.id, record]));
    return rewriteMarkdownImageUrls(text, (url) => {
      const id = parseAttachmentUrl(url);
      if (!id) {return null;}
      const record = byId.get(id);
      return record ? record.dataUrl : null;
    });
  }
}

export const attachmentStore = new AttachmentStore();
