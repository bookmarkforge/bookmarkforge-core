/**
 * importer.alt-bookmarks.ts — bookmark-source parsers for UniversalImporter.
 *
 * Pinboard (`posts/all` JSON export) and Firefox (`places.json` backup) emit
 * bookmark lists, not notes. Both parsers are pure — they return normalized
 * candidates; UniversalImporter owns sanitization, urlHash dedup, the
 * journal and the Free-tier limit.
 *
 *   Pinboard post:  { href, description, extended, time, tags }
 *   Firefox place:  { title, uri, tags, dateAdded, lastModified } inside a
 *                   recursive { children: [...] } tree (folders are flattened
 *                   — BookmarkForge bookmarks have no folder concept).
 */

export interface ParsedBookmarkCandidate {
  url: string;
  title?: string;
  /** Pinboard `extended` / Firefox has no body — kept for future use. */
  summary?: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Split a tag string on commas or whitespace runs (both exports vary). */
function parseTags(value: unknown): string[] {
  const raw = asString(value);
  if (!raw) {return [];}
  return raw
    .split(/[,,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ── Pinboard ───────────────────────────────────────────────────────────────

/**
 * Pinboard `posts/all` JSON: a top-level array of post objects.
 * Returns null when the payload is not that shape.
 */
export function parsePinboardPosts(json: string): ParsedBookmarkCandidate[] | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) {return null;}
  const first = asRecord(data[0]);
  if (!first || typeof first.href !== "string") {return null;}

  const out: ParsedBookmarkCandidate[] = [];
  for (const item of data) {
    const post = asRecord(item);
    const href = post && asString(post.href);
    if (!post || !href) {continue;}
    out.push({
      url: href,
      title: asString(post.description),
      summary: asString(post.extended),
      tags: parseTags(post.tags),
      createdAt: asString(post.time),
    });
  }
  return out;
}

// ── Firefox places.json ───────────────────────────────────────────────────

function walkFirefoxPlaces(
  node: unknown,
  out: ParsedBookmarkCandidate[],
): void {
  const place = asRecord(node);
  if (!place) {return;}
  const children = place.children;
  if (Array.isArray(children)) {
    for (const child of children) {walkFirefoxPlaces(child, out);}
    return;
  }
  const uri = asString(place.uri);
  if (!uri || !/^https?:\/\//i.test(uri)) {return;}
  out.push({
    url: uri,
    title: asString(place.title),
    tags: parseTags(place.tags),
    createdAt:
      typeof place.dateAdded === "number"
        ? new Date(place.dateAdded).toISOString()
        : asString(place.dateAdded),
    updatedAt:
      typeof place.lastModified === "number"
        ? new Date(place.lastModified).toISOString()
        : asString(place.lastModified),
  });
}

/**
 * Firefox `places.json` backup: `{ children: [...] }` tree where folders
 * carry `children` and bookmarks carry `uri`. Returns null for other shapes.
 */
export function parseFirefoxPlaces(json: string): ParsedBookmarkCandidate[] | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const root = asRecord(data);
  if (!root || !Array.isArray(root.children)) {return null;}
  const out: ParsedBookmarkCandidate[] = [];
  walkFirefoxPlaces(root, out);
  return out.length > 0 ? out : null;
}
