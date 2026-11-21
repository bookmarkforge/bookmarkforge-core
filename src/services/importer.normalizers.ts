/**
 * src/services/importer.normalizers.ts — pure normalization helpers for
 * UniversalImporter, extracted from UniversalImporter.ts: the importer class file had grown past 2.6k lines; these helpers are
 * format-agnostic (dates, titles, content, tags, Pocket read-state, folder
 * parenting, document links) and have no dependency on importer state, so
 * they live here as a flat module. PocketImportPreview stays re-exported
 * through UniversalImporter for existing importers (ImportDialog).
 */
import {
  sanitizeTags,
  sanitizeUserInput,
  sanitizeUrl,
} from "./SanitizationService";

/**
 * Normalizes an untrusted source timestamp into an ISO-8601 string that
 * satisfies RxDB's `format: "date-time"` validation. Source exports differ:
 * Pocket uses unix seconds, Raindrop uses unix seconds or millis, Notion uses
 * ISO strings, and invalid/empty values must not crash the schema. Falls back
 * to `now` when the value cannot be parsed.
 */
export function normalizeImportDate(value: string | undefined | null): string {
  if (!value) {return new Date().toISOString();}
  const trimmed = String(value).trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = n < 1e12 ? n * 1000 : n; // unix seconds vs millis
    const date = new Date(ms);
    return Number.isNaN(date.getTime())
      ? new Date().toISOString()
      : date.toISOString();
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

export function normalizeOptionalImportDate(value: unknown): string | undefined {
  if (value === undefined || value === null) {return undefined;}
  const trimmed = String(value).trim();
  if (!trimmed) {return undefined;}
  const numericValue = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
  const timestamp =
    numericValue === undefined
      ? new Date(trimmed).getTime()
      : new Date(numericValue < 1e12 ? numericValue * 1000 : numericValue).getTime();
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

const IMPORT_TITLE_MAX_LENGTH = 500;
const IMPORT_CONTENT_MAX_LENGTH = 10_000;

export function normalizeImportedTitle(value: unknown, fallback: string): string {
  const title =
    typeof value === "string"
      ? sanitizeUserInput(value, IMPORT_TITLE_MAX_LENGTH)
      : "";
  return title || fallback;
}

export function normalizeImportedContent(value: unknown): string {
  return typeof value === "string"
    ? sanitizeUserInput(value, IMPORT_CONTENT_MAX_LENGTH)
    : "";
}

export function normalizeImportedBlocks(value: unknown): unknown[] {
  if (!Array.isArray(value)) {return [];}

  const sanitizeValue = (
    candidate: unknown,
    key: string | undefined,
    depth: number,
  ): unknown => {
    if (depth > 10) {return undefined;}
    if (typeof candidate === "string") {
      const normalizedKey = key?.toLowerCase();
      if (
        normalizedKey === "url" ||
        normalizedKey === "href" ||
        normalizedKey === "src"
      ) {
        return sanitizeUrl(candidate);
      }
      return candidate.substring(0, IMPORT_CONTENT_MAX_LENGTH);
    }
    if (Array.isArray(candidate)) {
      return candidate
        .slice(0, 500)
        .map((item) => sanitizeValue(item, key, depth + 1))
        .filter((item) => item !== undefined);
    }
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .slice(0, 100)
          .filter(([entryKey]) =>
            entryKey.length <= 100 &&
            entryKey !== "__proto__" &&
            entryKey !== "constructor" &&
            entryKey !== "prototype",
          )
          .map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeValue(entryValue, entryKey, depth + 1),
          ])
          .filter(([, entryValue]) => entryValue !== undefined),
      );
    }
    return candidate;
  };

  return normalizeImportedBlocksValue(sanitizeValue(value, undefined, 0));
}

function normalizeImportedBlocksValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((item) => item !== undefined) : [];
}

export function normalizeImportedInteger(
  value: unknown,
  maximum: number,
  fallback = 0,
): number {
  const numericValue = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(0, numericValue));
}

export function normalizeImportedTags(value: unknown, maximum = 100): string[] {
  const candidates = typeof value === "string" ? [value] : value;
  return sanitizeTags(candidates).slice(0, maximum);
}

export type PocketReadStateFields = {
  isRead?: boolean;
  archiveTag?: string;
};

/**
 * Pocket exports use `Unread`, `Read`, and `Archive` as human-facing status
 * values. Read state belongs in the bookmark schema so it remains queryable
 * and survives exports; archive is kept as a tag because BookmarkForge has no
 * separate archive lifecycle yet (and must never turn it into isDeleted).
 */
export function pocketReadStateFields(value: unknown): PocketReadStateFields {
  if (typeof value !== "string") {return {};}
  const normalized = value.trim().toLowerCase().replace(/[._-]+/g, " ");
  if (!normalized) {return {};}
  if (/^unread$|^not read$/.test(normalized)) {
    return { isRead: false };
  }
  if (/^read$/.test(normalized)) {
    return { isRead: true };
  }
  if (/^archive$|^archived$/.test(normalized)) {
    return { isRead: true, archiveTag: "pocket-archive" };
  }
  return {};
}

export function pocketReadStateTags(tags: string[], fields: PocketReadStateFields): string[] {
  return fields.archiveTag && !tags.includes(fields.archiveTag)
    ? [...tags, fields.archiveTag]
    : tags;
}

export function pocketHtmlStatus(link: Element, headings: readonly Element[]): string | undefined {
  let latestHeading: Element | undefined;
  for (const heading of headings) {
    // DOCUMENT_POSITION_FOLLOWING = 4. The last heading before this anchor
    // is the Pocket section that contains it (Unread, Read, or Archive).
    if ((heading.compareDocumentPosition(link) & 4) !== 0) {
      latestHeading = heading;
    }
  }
  return latestHeading?.textContent?.trim();
}

export function pocketCsvStatus(getColumn: (name: string) => string): string {
  return (
    getColumn("status") ||
    getColumn("state") ||
    getColumn("read_status") ||
    getColumn("readstate") ||
    getColumn("read_state") ||
    getColumn("archive") ||
    getColumn("archived") ||
    ""
  );
}

export function normalizePocketHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export interface PocketImportPreview {
  source: "pocket";
  filename: string;
  linkCount: number;
  datedCount: number;
  uniqueTagCount: number;
  unreadCount: number;
  archivedCount: number;
  sampleTitles: string[];
}

export function pocketPreviewFromRows(
  filename: string,
  rows: Array<{ title: string; url: string; date?: string; tags?: string; status?: string }>,
): PocketImportPreview | null {
  const links = rows.filter((row) => sanitizeUrl(row.url).startsWith("http"));
  if (links.length === 0) {return null;}
  const uniqueTags = new Set<string>();
  let datedCount = 0;
  let unreadCount = 0;
  let archivedCount = 0;
  for (const row of links) {
    if (normalizeOptionalImportDate(row.date)) {datedCount++;}
    for (const tag of (row.tags || "").split(/[,;|]/)) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) {uniqueTags.add(normalized);}
    }
    const state = pocketReadStateFields(row.status);
    if (state.isRead === false) {unreadCount++;}
    if (state.archiveTag) {archivedCount++;}
  }
  return {
    source: "pocket",
    filename,
    linkCount: links.length,
    datedCount,
    uniqueTagCount: uniqueTags.size,
    unreadCount,
    archivedCount,
    sampleTitles: links
      .map((row) => row.title.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}

export function normalizeImportedRelatedLinks(value: unknown): string[] {
  if (!Array.isArray(value)) {return [];}
  const links: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (links.length >= 100) {break;}
    if (typeof candidate !== "string" || candidate.length > 2_000) {continue;}
    const link = sanitizeUrl(candidate);
    if (!link.startsWith("http") || seen.has(link)) {continue;}
    seen.add(link);
    links.push(link);
  }
  return links;
}

export function resolveImportedFolderParent(
  id: string,
  requestedParentId: string,
  parents: ReadonlyMap<string, string>,
  maxDepth = 20,
): string {
  if (requestedParentId === "root") {return "root";}
  let current = requestedParentId;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (current === id) {return "root";}
    const parent = parents.get(current);
    if (!parent || parent === "root") {return current;}
    current = parent;
  }
  return "root";
}

export function normalizeImportedDocumentLinks(
  value: unknown,
  documentIdMap: ReadonlyMap<string, string>,
): string[] {
  if (!Array.isArray(value)) {return [];}
  const links: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (links.length >= 100) {break;}
    if (typeof candidate !== "string" || candidate.length > 200) {continue;}
    const link = documentIdMap.get(candidate);
    if (!link || seen.has(link)) {continue;}
    seen.add(link);
    links.push(link);
  }
  return links;
}
