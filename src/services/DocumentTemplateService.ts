/**
 * DocumentTemplateService
 *
 * Manages document templates and provides utilities for creating documents from templates.
 */

import { logger } from "../utils/logger";
import { safeGet, safeSet } from "../store/safeStorage";
import { safeParseJsonArray } from "../utils/safeJsonArray";

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  content: unknown[]; // BlockNote content
  tags: string[];
  icon: string;
}

function inlineContentToText(item: unknown): string {
  if (typeof item === "string") {return item;}
  if (item && typeof item === "object") {
    const inline = item as { text?: string };
    return typeof inline.text === "string" ? inline.text : "";
  }
  return "";
}

function isNestedBlock(item: unknown): boolean {
  return (
    !!item &&
    typeof item === "object" &&
    !("text" in (item as object)) &&
    ("content" in (item as object) ||
      "children" in (item as object) ||
      ("type" in (item as object) &&
        (item as { type?: string }).type !== "text"))
  );
}

/**
 * Convert simplified template blocks into BlockNote-valid PartialBlocks.
 * Template shorthand uses `bulletList`/`numberedList` with `string[]` items,
 * but those block types DO NOT exist in the BlockNote schema (the real types
 * are `bulletListItem`/`numberedListItem`) — passing them raw makes BlockNote
 * throw (`Cannot read properties of undefined (reading 'isInGroup')`).
 * Already-valid types (heading/paragraph/callout/...) pass through unchanged.
 */
export function normalizeTemplateBlocksToBlockNote(
  blocks: unknown[],
): unknown[] {
  if (!Array.isArray(blocks)) {return [];}
  const out: unknown[] = [];
  const push = (b: unknown) => {
    if (b != null) {out.push(b);}
  };
  // Shorthand types that map to real BlockNote list specs. A list block with
  // non-array content is corrupt — dropping it is safer than passing an
  // unknown type through (which is exactly what crashes BlockNote).
  const LIST_TYPES: Record<string, string> = {
    bulletList: "bulletListItem",
    numberedList: "numberedListItem",
  };
  for (const block of blocks) {
    if (!block || typeof block !== "object") {push(block); continue;}
    const b = block as { type?: string; content?: unknown };
    const targetType =
      typeof b.type === "string" ? LIST_TYPES[b.type] : undefined;
    if (targetType) {
      if (!Array.isArray(b.content)) {continue;} // corrupt — drop
      for (const item of b.content) {
        // BlockNote PartialBlock.content accepts string | string[] |
        // PartialBlock[] | InlineContent[] — a bare object is invalid, so
        // wrap non-strings in an array (InlineContent[] / PartialBlock[]).
        push({ type: targetType, content: typeof item === "string" ? item : [item] });
      }
      continue;
    }
    push(block);
  }
  return out;
}

/**
 * Convert simplified template blocks (BlockNote-style: heading/paragraph with
 * string content, bulletList/numberedList with string[] items, nested blocks
 * and columnLayout `children`) to plain text — used for the document's
 * `textContent` (search/embeddings) instead of a raw JSON dump. Non-array
 * input (corrupt localStorage) and unknown shapes are handled gracefully.
 */
export function templateBlocksToPlainText(blocks: unknown[]): string {
  if (!Array.isArray(blocks)) {return "";}
  const lines: string[] = [];
  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (!node || typeof node !== "object") {continue;}
      const block = node as { type?: string; content?: unknown; children?: unknown };
      const content = block.content;
      if (Array.isArray(content)) {
        if (block.type === "bulletList" || block.type === "numberedList") {
          content.forEach((item, i) => {
            const text = inlineContentToText(item);
            if (text.trim()) {
              lines.push(
                `${block.type === "numberedList" ? `${i + 1}.` : "-"} ${text.trim()}`,
              );
            }
          });
        } else if (content.some(isNestedBlock)) {
          walk(content); // nested blocks
        } else {
          const text = content.map(inlineContentToText).join(" ");
          if (text.trim()) {lines.push(text.trim());}
        }
      } else if (typeof content === "string" && content.trim()) {
        lines.push(content.trim());
      }
      // BlockNote columnLayout-style blocks keep their children in `children`.
      if (Array.isArray(block.children) && block.children.length > 0) {
        walk(block.children);
      }
    }
  };
  walk(blocks);
  return lines.join("\n");
}

class DocumentTemplateService {
  private static instance: DocumentTemplateService;
  private readonly STORAGE_KEY = "bookmarkforge_document_templates";
  private templates: Map<string, DocumentTemplate> = new Map();

  // Default templates
  private readonly defaultTemplates: DocumentTemplate[] = [
    {
      id: "article",
      name: "Article",
      description: "Template for writing articles and blog posts",
      category: "Writing",
      content: [
        { type: "heading", content: "Title" },
        { type: "heading", content: "Introduction", level: 2 },
        { type: "paragraph", content: "Write your introduction here..." },
        { type: "heading", content: "Main Content", level: 2 },
        { type: "paragraph", content: "Write your main content here..." },
        { type: "heading", content: "Conclusion", level: 2 },
        { type: "paragraph", content: "Write your conclusion here..." },
      ],
      tags: ["article", "writing"],
      icon: "FileText",
    },
    {
      id: "meeting",
      name: "Meeting Notes",
      description: "Template for meeting notes and agendas",
      category: "Business",
      content: [
        { type: "heading", content: "Meeting Notes", level: 1 },
        { type: "heading", content: "Date & Time", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Attendees", level: 2 },
        { type: "bulletList", content: ["Attendee 1", "Attendee 2"] },
        { type: "heading", content: "Agenda", level: 2 },
        { type: "numberedList", content: ["Item 1", "Item 2", "Item 3"] },
        { type: "heading", content: "Discussion", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Action Items", level: 2 },
        { type: "bulletList", content: ["Action 1", "Action 2"] },
      ],
      tags: ["meeting", "business"],
      icon: "Users",
    },
    {
      id: "project",
      name: "Project Plan",
      description: "Template for project planning and tracking",
      category: "Business",
      content: [
        { type: "heading", content: "Project Plan", level: 1 },
        { type: "heading", content: "Overview", level: 2 },
        { type: "paragraph", content: "Project description..." },
        { type: "heading", content: "Goals", level: 2 },
        { type: "bulletList", content: ["Goal 1", "Goal 2", "Goal 3"] },
        { type: "heading", content: "Timeline", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Resources", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Risks", level: 2 },
        { type: "bulletList", content: ["Risk 1", "Risk 2"] },
      ],
      tags: ["project", "planning"],
      icon: "FolderKanban",
    },
    {
      id: "research",
      name: "Research Notes",
      description: "Template for research and academic notes",
      category: "Academic",
      content: [
        { type: "heading", content: "Research Notes", level: 1 },
        { type: "heading", content: "Topic", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Research Question", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Key Findings", level: 2 },
        { type: "bulletList", content: ["Finding 1", "Finding 2"] },
        { type: "heading", content: "Sources", level: 2 },
        { type: "bulletList", content: ["Source 1", "Source 2"] },
        { type: "heading", content: "Notes", level: 2 },
        { type: "paragraph", content: "" },
      ],
      tags: ["research", "academic"],
      icon: "BookOpen",
    },
    {
      id: "journal",
      name: "Journal Entry",
      description: "Template for personal journal entries",
      category: "Personal",
      content: [
        { type: "heading", content: "Journal Entry", level: 1 },
        { type: "heading", content: "Date", level: 2 },
        { type: "paragraph", content: "" }, // Date set dynamically on use
        { type: "heading", content: "Mood", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Gratitude", level: 2 },
        {
          type: "bulletList",
          content: ["Gratitude 1", "Gratitude 2", "Gratitude 3"],
        },
        { type: "heading", content: "Reflection", level: 2 },
        { type: "paragraph", content: "" },
        { type: "heading", content: "Goals for Tomorrow", level: 2 },
        { type: "bulletList", content: ["Goal 1", "Goal 2"] },
      ],
      tags: ["journal", "personal"],
      icon: "Heart",
    },
  ];

  private constructor() {
    this.loadTemplates();
  }

  public static getInstance(): DocumentTemplateService {
    if (!DocumentTemplateService.instance) {
      DocumentTemplateService.instance = new DocumentTemplateService();
    }
    return DocumentTemplateService.instance;
  }

  /**
   * Load templates from localStorage and merge with defaults
   */
  private loadTemplates(): void {
    const { entries, parseFailed } = safeParseJsonArray<
      { id?: unknown } & Partial<DocumentTemplate>
    >(safeGet(this.STORAGE_KEY));
    for (const entry of entries) {
      if (typeof entry.id === "string" && entry.id) {
        this.templates.set(entry.id, entry as DocumentTemplate);
      }
    }
    if (parseFailed) {
      logger.warn(
        "[DocumentTemplates] stored blob is not a valid JSON array; ignoring",
      );
    }

    // Add default templates if not already present
    this.defaultTemplates.forEach((template) => {
      if (!this.templates.has(template.id)) {
        this.templates.set(template.id, template);
      }
    });
  }

  /**
   * Save custom templates to localStorage
   */
  private saveTemplates(): void {
    try {
      const customTemplates = Array.from(this.templates.values()).filter(
        (t) => !this.defaultTemplates.some((dt) => dt.id === t.id),
      );
      safeSet(this.STORAGE_KEY, JSON.stringify(customTemplates));
    } catch (error) {
      logger.error("Failed to save templates:", error);
    }
  }

  /**
   * Get all templates
   */
  public getAllTemplates(): DocumentTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get templates by category
   */
  public getTemplatesByCategory(category: string): DocumentTemplate[] {
    return Array.from(this.templates.values()).filter(
      (t) => t.category === category,
    );
  }

  /**
   * Get a specific template by ID
   */
  public getTemplate(id: string): DocumentTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Create a new custom template
   */
  public createTemplate(
    template: Omit<DocumentTemplate, "id">,
  ): DocumentTemplate {
    const id = `custom_${Date.now()}`;
    const newTemplate: DocumentTemplate = { ...template, id };
    this.templates.set(id, newTemplate);
    this.saveTemplates();
    return newTemplate;
  }

  /**
   * Update an existing template
   */
  public updateTemplate(id: string, updates: Partial<DocumentTemplate>): void {
    const existing = this.templates.get(id);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.templates.set(id, updated);
      this.saveTemplates();
    }
  }

  /**
   * Delete a custom template
   */
  public deleteTemplate(id: string): void {
    // Only allow deleting custom templates
    if (!this.defaultTemplates.some((t) => t.id === id)) {
      this.templates.delete(id);
      this.saveTemplates();
    }
  }

  /**
   * Get all categories
   */
  public getCategories(): string[] {
    const categories = new Set(
      Array.from(this.templates.values()).map((t) => t.category),
    );
    return Array.from(categories).sort();
  }
}

export const documentTemplateService = DocumentTemplateService.getInstance();
