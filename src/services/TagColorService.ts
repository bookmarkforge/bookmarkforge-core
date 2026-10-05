/**
 * TagColorService
 *
 * Manages tag color assignments and provides utilities for tag color management.
 */

import { logger } from "../utils/logger";
import { safeGet, safeSet } from "../store/safeStorage";
import { safeParseJsonArray } from "../utils/safeJsonArray";

export interface TagColor {
  tag: string;
  color: string;
}

export class TagColorService {
  private static instance: TagColorService;
  private tagColors: Map<string, string> = new Map();
  private readonly STORAGE_KEY = "bookmarkforge_tag_colors";

  // Predefined color palette
  private readonly COLOR_PALETTE = [
    "#ef4444", // red — intentional inline (user-assigned tag color data, not brand styling)
    "#f97316", // orange
    "#eab308", // yellow
    "#22c55e", // green
    "#06b6d4", // cyan
    "#3b82f6", // blue
    "#00aeef", // cyan
    "#ec4899", // pink
    "#64748b", // slate
    "#78716c", // stone
  ];

  private constructor() {
    this.loadColors();
    this.migrateLegacyColors();
  }

  public static getInstance(): TagColorService {
    if (!TagColorService.instance) {
      TagColorService.instance = new TagColorService();
    }
    return TagColorService.instance;
  }

  /**
   * Load tag colors from localStorage
   */
  private loadColors(): void {
    const { entries, parseFailed } = safeParseJsonArray<
      { tag?: unknown; color?: unknown }
    >(safeGet(this.STORAGE_KEY));
    for (const entry of entries) {
      const { tag, color } = entry;
      if (typeof tag === "string" && tag && typeof color === "string" && color) {
        this.tagColors.set(tag.toLowerCase(), color);
      }
    }
    if (parseFailed) {
      // A non-null/empty blob that was not a valid JSON array of objects —
      // log once at warn so ops can spot a tampered or upgraded-store file,
      // but do not silently drop user-assigned colors elsewhere.
      logger.warn("[TagColors] stored blob is not a valid JSON array; ignoring");
    }
  }

  /**
   * Save tag colors to localStorage
   */
  private saveColors(): void {
    try {
      const colors: TagColor[] = Array.from(this.tagColors.entries()).map(
        ([tag, color]) => ({ tag, color }),
      );
      safeSet(this.STORAGE_KEY, JSON.stringify(colors));
    } catch (error) {
      logger.error("Failed to save tag colors:", error);
    }
  }

  /**
   * Get color for a specific tag
   */
  public getTagColor(tag: string): string | undefined {
    return this.tagColors.get(tag.toLowerCase());
  }

  /**
   * Set color for a specific tag
   */
  public setTagColor(tag: string, color: string): void {
    this.tagColors.set(tag.toLowerCase(), color);
    this.saveColors();
  }

  /**
   * Remove color for a specific tag
   */
  public removeTagColor(tag: string): void {
    this.tagColors.delete(tag.toLowerCase());
    this.saveColors();
  }

  /**
   * Get all tag colors
   */
  public getAllTagColors(): TagColor[] {
    return Array.from(this.tagColors.entries()).map(([tag, color]) => ({
      tag,
      color,
    }));
  }

  /**
   * Get a random color from the palette
   */
  public getRandomColor(): string {
    const paletteLength = this.COLOR_PALETTE.length;
    const cutoff = Math.floor(0x100000000 / paletteLength) * paletteLength;
    let randomValue: number;
    do {
      randomValue = crypto.getRandomValues(new Uint32Array(1))[0]!;
    } while (randomValue >= cutoff);
    const idx = randomValue % paletteLength;
    return this.COLOR_PALETTE[idx]!;
  }

  /**
   * Assign a random color to a tag if it doesn't have one
   */
  public assignRandomColor(tag: string): string {
    const existingColor = this.getTagColor(tag);
    if (existingColor) {
      return existingColor;
    }

    const color = this.getRandomColor();
    this.setTagColor(tag, color);
    return color;
  }

  /**
   * Migrates legacy color values from the old violet/purple palette
   * to the new cyan accent color (#00aeef).
   * Runs once per session — subsequent loads have already-migrated colors.
   */
  private migrateLegacyColors(): void {
    const V1_COLORS: Record<string, string> = {
      "#7c3aed": "#00aeef", // violet → cyan
      "#8b5cf6": "#00aeef", // lighter violet → cyan
      "#6d28d9": "#00aeef", // darker violet → cyan
      "#c084fc": "#00aeef", // light purple → cyan
      "#a78bfa": "#00aeef", // light violet → cyan
    };

    let changed = false;
    for (const [tag, color] of this.tagColors.entries()) {
      const newColor = V1_COLORS[color];
      if (newColor) {
        this.tagColors.set(tag, newColor);
        changed = true;
      }
    }

    if (changed) {
      this.saveColors();
      logger.info(
        "[TagColorService] Migrated legacy tag colors: violet/purple → cyan",
        {
          migratedColors: Object.keys(V1_COLORS),
        },
      );
    }
  }

  /**
   * Get all available colors from palette
   */
  public getColorPalette(): string[] {
    return [...this.COLOR_PALETTE];
  }

  /**
   * Clear all tag colors
   */
  public clearAllColors(): void {
    this.tagColors.clear();
    this.saveColors();
  }
}

export const tagColorService = TagColorService.getInstance();
