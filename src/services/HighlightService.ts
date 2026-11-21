import { generateId } from "../utils/id";
import { initDB } from "../db/database";
import { logger } from "../utils/logger";

export interface HighlightData {
  id: string;
  bookmarkId: string;
  text: string;
  color: string;
  note: string;
  createdAt: string;
}

class HighlightService {
  async getHighlights(bookmarkId: string): Promise<HighlightData[]> {
    try {
      const db = await initDB();
      const docs = await db.highlights
        .find({ selector: { bookmarkId } })
        .exec();
      return docs.map(
        (d: { toJSON: () => Record<string, unknown> }) =>
          d.toJSON() as unknown as HighlightData,
      );
    } catch (err) {
      logger.error("Error fetching highlights", { bookmarkId, error: err });
      return [];
    }
  }

  async addHighlight(
    bookmarkId: string,
    text: string,
    color = "#fef08a",
    note = "",
  ): Promise<HighlightData | null> {
    try {
      const db = await initDB();
      const id = generateId();
      const highlight: HighlightData = {
        id,
        bookmarkId,
        text,
        color,
        note,
        createdAt: new Date().toISOString(),
      };
      await db.highlights.insert(highlight as never);
      return highlight;
    } catch (err) {
      logger.error("Error adding highlight", { bookmarkId, error: err });
      return null;
    }
  }

  async removeHighlight(id: string): Promise<void> {
    try {
      const db = await initDB();
      const doc = await db.highlights.findOne(id).exec();
      if (doc) {
        await doc.remove();
      }
    } catch (err) {
      logger.error("Error removing highlight", { id, error: err });
    }
  }

  async updateNote(id: string, note: string): Promise<void> {
    try {
      const db = await initDB();
      const doc = await db.highlights.findOne(id).exec();
      if (doc) {
        await doc.incrementalPatch({ note } as never);
      }
    } catch (err) {
      logger.error("Error updating highlight note", { id, error: err });
    }
  }
}

export const highlightService = new HighlightService();
