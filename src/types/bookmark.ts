/**
 * BookmarkView — structural adapter type that bridges RxDB's
 * DeepReadonlyObject<BookmarkDocType> and the runtime consumer's
 * `Bookmark` interface from src/types.ts.
 *
 * - Fields that RxDB marks as optional (`content?`, `summary?`,
 *   `embedding?`, `broken?`, `lastChecked?`, `lastVisitedAt?`) are
 *   typed here as `T | undefined` so they widen cleanly from
 *   RxDocument.toJSON() output.
 * - All other fields are required, matching the runtime invariant.
 *
 * Use `toBookmarkView(input)` at boundary sites (after db.find().
 *   exec().map(d => d.toJSON())) to project any compatible shape
 *   into a BookmarkView for component state and array.map callbacks.
 *
 * This is consumed by components in src/components/{knowledge,ai}/*
 * that previously did `(bm as Bookmark)` after `setBookmarks(doc.map
 * (d => d.toJSON()))`.
 */
import type { RxDocument } from "rxdb";
import type { BookmarkDocType } from "../db/schema";

export interface BookmarkView {
  id: string;
  url: string;
  title: string;
  content: string | undefined;
  summary: string | undefined;
  tags: string[];
  relatedLinks: string[];
  embedding: number[] | undefined;
  processed: boolean;
  isPrivate: boolean;
  isDeleted: boolean;
  broken: boolean | undefined;
  lastChecked: string | undefined;
  visitCount: number;
  lastVisitedAt: string | undefined;
  createdAt: string;
  updatedAt: string;
}

type BookmarkLike =
  | BookmarkDocType
  | RxDocument<BookmarkDocType>
  | BookmarkView
  | { toJSON?: () => unknown }
  | Record<string, unknown>
  | null
  | undefined;

const EMPTY: BookmarkView = {
  id: "",
  url: "",
  title: "",
  content: undefined,
  summary: undefined,
  tags: [],
  relatedLinks: [],
  embedding: undefined,
  processed: false,
  isPrivate: false,
  isDeleted: false,
  broken: undefined,
  lastChecked: undefined,
  visitCount: 0,
  lastVisitedAt: undefined,
  createdAt: "",
  updatedAt: "",
};

/**
 * Project any compatible bookmark-like value into a `BookmarkView`.
 *
 * Accepts `BookmarkDocType` (from RxDB queries), `RxDocument`
 * (calls `.toJSON()`), `BookmarkView` (passthrough), and
 * `Record<string, unknown>` (loose object — typical test mock).
 *
 * Always returns a fully-typed `BookmarkView`. Missing fields
 * default to the EMPTY sentinel. Use this wherever production
 * source previously did `(bm as Bookmark)` casts.
 */
export function toBookmarkView(input: BookmarkLike): BookmarkView {
  if (input == null) {return EMPTY;}
  const source = typeof (input as { toJSON?: () => unknown }).toJSON ===
    "function"
    ? (input as { toJSON: () => unknown }).toJSON()
    : input;
  const r = source as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    url: String(r.url ?? ""),
    title: String(r.title ?? ""),
    content: typeof r.content === "string" ? r.content : undefined,
    summary: typeof r.summary === "string" ? r.summary : undefined,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
    relatedLinks: Array.isArray(r.relatedLinks)
      ? (r.relatedLinks as string[])
      : [],
    embedding: Array.isArray(r.embedding)
      ? (r.embedding as number[])
      : undefined,
    processed: Boolean(r.processed ?? false),
    isPrivate: Boolean(r.isPrivate ?? false),
    isDeleted: Boolean(r.isDeleted ?? false),
    broken: r.broken == null ? undefined : Boolean(r.broken),
    lastChecked:
      typeof r.lastChecked === "string" ? r.lastChecked : undefined,
    visitCount: Number(r.visitCount ?? 0),
    lastVisitedAt:
      typeof r.lastVisitedAt === "string" ? r.lastVisitedAt : undefined,
    createdAt: String(r.createdAt ?? ""),
    updatedAt: String(r.updatedAt ?? ""),
  };
}
