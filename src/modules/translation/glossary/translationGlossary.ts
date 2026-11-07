/**
 * src/modules/translation/glossary/translationGlossary.ts
 *
 * User glossary (the keyword rules a user has saved in their library). Core (MIT).
 *
 * Entries are user data, so they live in the encrypted IndexedDB secret store
 * like every other vault secret — not in localStorage, and not in the RxDB
 * vault (which would spend the last open-collection slot). They are injected
 * into the SYSTEM prompt of both passes, which is why every field is sanitized
 * to a single line before storage: a glossary term must never be able to add
 * prompt structure.
 */

import { logger } from "../../../utils/logger";
import { secureStorage } from "../../../services/SecureStorage";
import { MAX_GLOSSARY_ENTRIES } from "../constants";
import type { GlossaryEntry } from "../types";

const GLOSSARY_KEY = "bmf_translation_glossary_v1";
const GLOSSARY_VERSION = 1;
const MAX_STORED_ENTRIES = 200;

interface StoredGlossary {
  version: number;
  entries: GlossaryEntry[];
  updatedAt: string;
}

function normalizeField(value: string, maxChars: number): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, maxChars);
}

function normalizeEntry(entry: GlossaryEntry): GlossaryEntry | null {
  const source = normalizeField(String(entry.source ?? ""), 120);
  const target = normalizeField(String(entry.target ?? ""), 160);
  if (!source || !target) {return null;}
  const note = normalizeField(String(entry.note ?? ""), 120);
  return note ? { source, target, note } : { source, target };
}

class TranslationGlossaryStore {
  private cache: GlossaryEntry[] | null = null;

  async list(): Promise<GlossaryEntry[]> {
    if (this.cache) {return [...this.cache];}
    try {
      const raw = await secureStorage.getSecret(GLOSSARY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredGlossary>;
        if (parsed.version === GLOSSARY_VERSION && Array.isArray(parsed.entries)) {
          this.cache = parsed.entries
            .map((entry) => normalizeEntry(entry))
            .filter((entry): entry is GlossaryEntry => entry !== null)
            .slice(0, MAX_STORED_ENTRIES);
          return [...this.cache];
        }
      }
    } catch (error) {
      // A locked vault or corrupt record means "no glossary", and the user
      // must still be able to translate. The failure is logged, not hidden.
      logger.warn("[translation] glossary unreadable; continuing without it", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.cache = [];
    return [];
  }

  /** Entries to inject into a prompt (bounded; most recent first). */
  async forPrompt(): Promise<GlossaryEntry[]> {
    const entries = await this.list();
    return entries.slice(0, MAX_GLOSSARY_ENTRIES);
  }

  async add(entry: GlossaryEntry): Promise<GlossaryEntry[]> {
    const normalized = normalizeEntry(entry);
    if (!normalized) {
      throw new Error("[translation] glossary entry needs both source and target");
    }
    const current = await this.list();
    const withoutDuplicate = current.filter(
      (existing) =>
        existing.source.toLowerCase() !== normalized.source.toLowerCase(),
    );
    const next = [normalized, ...withoutDuplicate].slice(0, MAX_STORED_ENTRIES);
    await this.persist(next);
    return [...next];
  }

  async remove(source: string): Promise<GlossaryEntry[]> {
    const needle = normalizeField(source, 120).toLowerCase();
    const next = (await this.list()).filter(
      (entry) => entry.source.toLowerCase() !== needle,
    );
    await this.persist(next);
    return [...next];
  }

  async clear(): Promise<void> {
    this.cache = [];
    try {
      await secureStorage.deleteSecret(GLOSSARY_KEY);
    } catch (error) {
      logger.warn("[translation] glossary clear failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persist(entries: GlossaryEntry[]): Promise<void> {
    const record: StoredGlossary = {
      version: GLOSSARY_VERSION,
      entries,
      updatedAt: new Date().toISOString(),
    };
    // Writes are NOT swallowed: the settings screen must be able to tell the
    // user their terminology rule was not saved.
    await secureStorage.setSecret(GLOSSARY_KEY, JSON.stringify(record));
    this.cache = [...entries];
  }

  /** Vault lock: drop the decrypted glossary from memory. */
  reset(): void {
    this.cache = null;
  }
}

export const translationGlossary = new TranslationGlossaryStore();
