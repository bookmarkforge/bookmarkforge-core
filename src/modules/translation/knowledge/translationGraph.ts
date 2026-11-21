/**
 * src/modules/translation/knowledge/translationGraph.ts
 *
 * Knowledge-graph link between the original node and its translation.
 * Core (MIT).
 *
 * The app has two relation mechanisms today:
 *   - `documents.links` (ids) → the Backlinks panel;
 *   - shared tags → edges in GraphView's `buildLinksFromTags`.
 *
 * Saving a translation therefore:
 *   1. creates a sibling document that INHERITS the source tags (so the graph
 *      clusters both languages together) and the source privacy flag (a private
 *      document must never produce a public translated copy);
 *   2. adds the new id to the source's `links` (backlink from the original);
 *   3. stores `[newId, sourceId]` in the translated document's `links`
 *      (forward link), so the pair is navigable in both directions.
 *
 * The translation itself is never re-derived here: the pipeline result is the
 * input, and the encrypted pair cache stays the source of truth for re-runs.
 */

import { initDB } from "../../../db/database";
import { logger } from "../../../utils/logger";
import { TranslationError } from "../errors";

export interface SaveTranslatedDocumentOptions {
  sourceDocumentId: string;
  /** Final translated document text (pipeline result). */
  translatedText: string;
  sourceLocale: string;
  targetLocale: string;
  /** Defaults to "<source title> · <TARGET LOCALE>". */
  title?: string;
  /** Extra tags; merged with the source document's tags. */
  tags?: string[];
  /** Defaults to the source document's folder. */
  folderId?: string;
}

export interface SaveTranslatedDocumentResult {
  documentId: string;
  sourceDocumentId: string;
  /** False when the source could not be patched (translation still saved). */
  backlinkCreated: boolean;
}

interface SimpleBlock {
  type: "heading" | "paragraph";
  content: string;
  level?: number;
}

/**
 * Convert translated Markdown into the app's shorthand block shape.
 *
 * `DocumentTemplateService.normalizeTemplateBlocksToBlockNote` (the editor's
 * own normalized) upgrades these to BlockNote specs on load, so this module
 * does not need to know the BlockNote schema — and cannot drift from it.
 */
export function markdownToSimpleBlocks(text: string): SimpleBlock[] {
  const blocks: SimpleBlock[] = [];
  for (const rawBlock of text.split(/\n{2,}/)) {
    const block = rawBlock.trim();
    if (!block) {continue;}
    const heading = /^(#{1,6})\s+(.*)$/.exec(block);
    if (heading && heading[1] && heading[2]) {
      blocks.push({
        type: "heading",
        content: heading[2].trim(),
        level: Math.min(6, heading[1].length),
      });
      continue;
    }
    blocks.push({ type: "paragraph", content: block });
  }
  if (blocks.length === 0) {blocks.push({ type: "paragraph", content: "" });}
  return blocks;
}

export async function saveTranslationAsDocument(
  options: SaveTranslatedDocumentOptions,
): Promise<SaveTranslatedDocumentResult> {
  const translatedText = options.translatedText ?? "";
  if (!translatedText.trim()) {
    throw new TranslationError("empty-source", "There is no translated text to save.");
  }

  const db = await initDB();
  const source = await db.documents.findOne(options.sourceDocumentId).exec();
  if (!source) {
    throw new TranslationError(
      "invalid-response",
      `Source document ${options.sourceDocumentId} was not found.`,
    );
  }

  const documentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const sourceTags: string[] = Array.isArray(source.tags) ? source.tags : [];
  const tags = Array.from(
    new Set([...sourceTags, ...(options.tags ?? [])].filter((tag) => tag.length > 0)),
  );
  const title =
    options.title?.trim() ||
    `${source.title} · ${options.targetLocale.toUpperCase()}`;

  await db.documents.insert({
    id: documentId,
    folderId: options.folderId ?? source.folderId,
    title,
    blocks: markdownToSimpleBlocks(translatedText),
    textContent: translatedText,
    tags,
    links: [options.sourceDocumentId],
    processed: false,
    // Privacy is inherited, never relaxed: a private source must never yield a
    // public translated copy that could be sent to a cloud provider or shared.
    isPrivate: source.isPrivate !== false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  });

  let backlinkCreated = false;
  try {
    const sourceLinks: string[] = Array.isArray(source.links) ? source.links : [];
    if (!sourceLinks.includes(documentId)) {
      await source.incrementalPatch({
        links: [...sourceLinks, documentId],
        updatedAt: now,
      });
      backlinkCreated = true;
    }
  } catch (error) {
    // The translated document is already saved; a failed backlink is a
    // degraded link, not a lost translation. Surfaced in the result.
    logger.warn("[translation] could not add the backlink to the source document", {
      documentId: options.sourceDocumentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { documentId, sourceDocumentId: options.sourceDocumentId, backlinkCreated };
}
