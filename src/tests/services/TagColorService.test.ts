import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock de logger
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { TagColorService, tagColorService } =
  await import("../../services/TagColorService");
import type { TagColor } from "../../services/TagColorService";

describe("TagColorService", () => {
  let service: ReturnType<typeof TagColorService.getInstance>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset the singleton for isolated tests
    (TagColorService as any).instance = undefined;
    service = TagColorService.getInstance();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("getInstance (singleton)", () => {
    it("returns the same instance on multiple calls", () => {
      const inst1 = TagColorService.getInstance();
      const inst2 = TagColorService.getInstance();
      expect(inst1).toBe(inst2);
    });

    it("getInstance creates an instance if it does not exist", () => {
      (TagColorService as any).instance = undefined;
      const inst = TagColorService.getInstance();
      expect(inst).toBeDefined();
      expect(inst).toBeInstanceOf(TagColorService);
    });
  });

  describe("setTagColor y getTagColor", () => {
    it("setTagColor stores and getTagColor retrieves a color", () => {
      service.setTagColor("angular", "#ef4444");
      expect(service.getTagColor("angular")).toBe("#ef4444");
    });

    it("getTagColor is case-insensitive", () => {
      service.setTagColor("Angular", "#ef4444");
      expect(service.getTagColor("angular")).toBe("#ef4444");
      expect(service.getTagColor("ANGULAR")).toBe("#ef4444");
      expect(service.getTagColor("Angular")).toBe("#ef4444");
    });

    it("getTagColor returns undefined for a tag without a color", () => {
      expect(service.getTagColor("inexistente")).toBeUndefined();
    });

    it("setTagColor sobrescribe un color existente", () => {
      service.setTagColor("react", "#ef4444");
      service.setTagColor("react", "#3b82f6");
      expect(service.getTagColor("react")).toBe("#3b82f6");
    });

    it("getTagColor returns undefined for empty tag", () => {
      expect(service.getTagColor("")).toBeUndefined();
    });
  });

  describe("removeTagColor", () => {
    it("deletes an existing tag color", () => {
      service.setTagColor("node", "#22c55e");
      service.removeTagColor("node");
      expect(service.getTagColor("node")).toBeUndefined();
    });

    it("removeTagColor is case-insensitive", () => {
      service.setTagColor("Node", "#22c55e");
      service.removeTagColor("node");
      expect(service.getTagColor("node")).toBeUndefined();
    });

    it("removeTagColor does not fail if the tag does not exist", () => {
      expect(() => service.removeTagColor("no-existe")).not.toThrow();
    });
  });

  describe("getAllTagColors", () => {
    it("returns all tag colors as a TagColor[] array", () => {
      service.setTagColor("a", "#ef4444");
      service.setTagColor("b", "#22c55e");
      const all = service.getAllTagColors();
      expect(all).toHaveLength(2);
      expect(all).toEqual(
        expect.arrayContaining([
          { tag: "a", color: "#ef4444" },
          { tag: "b", color: "#22c55e" },
        ]),
      );
    });

    it("returns empty array when there are no colors", () => {
      expect(service.getAllTagColors()).toEqual([]);
    });

    it("returns a copy, not an internal reference", () => {
      service.setTagColor("x", "#000");
      const all = service.getAllTagColors();
      all.push({ tag: "y", color: "#fff" });
      expect(service.getAllTagColors()).toHaveLength(1);
    });
  });

  describe("getRandomColor", () => {
    it("returns a color from COLOR_PALETTE", () => {
      const palette = service.getColorPalette();
      const color = service.getRandomColor();
      expect(palette).toContain(color);
    });

    it("returns different colors on successive calls (probabilistic)", () => {
      const colores = new Set(
        Array.from({ length: 20 }, () => service.getRandomColor()),
      );
      expect(colores.size).toBeGreaterThan(1);
    });
  });

  describe("assignRandomColor", () => {
    it("assigns a random color if the tag has no color", () => {
      const color = service.assignRandomColor("nuevo-tag");
      const palette = service.getColorPalette();
      expect(palette).toContain(color);
      expect(service.getTagColor("nuevo-tag")).toBe(color);
    });

    it("returns the existing color if the tag already has one", () => {
      service.setTagColor("existente", "#3b82f6");
      const color = service.assignRandomColor("existente");
      expect(color).toBe("#3b82f6");
    });

    it("does not change the color if the tag already has one", () => {
      service.setTagColor("fijo", "#ec4899");
      service.assignRandomColor("fijo");
      expect(service.getTagColor("fijo")).toBe("#ec4899");
    });

    it("assigns a different color for different tags", () => {
      const c1 = service.assignRandomColor("tag1");
      const c2 = service.assignRandomColor("tag2");
      // They may coincide randomly, but verify that both are in the palette
      expect(service.getColorPalette()).toContain(c1);
      expect(service.getColorPalette()).toContain(c2);
    });
  });

  describe("getColorPalette", () => {
    it("returns a copy of the palette array", () => {
      const paleta = service.getColorPalette();
      expect(Array.isArray(paleta)).toBe(true);
      expect(paleta.length).toBeGreaterThan(0);
    });

    it("mutating the copy does not affect the original", () => {
      const paleta = service.getColorPalette();
      paleta.push("#nuevo");
      expect(service.getColorPalette()).not.toContain("#nuevo");
    });

    it("contains expected hex colors", () => {
      const paleta = service.getColorPalette();
      expect(paleta).toContain("#ef4444");
      expect(paleta).toContain("#22c55e");
      expect(paleta).toContain("#3b82f6");
    });
  });

  describe("clearAllColors", () => {
    it("clears all colors", () => {
      service.setTagColor("a", "#111");
      service.setTagColor("b", "#222");
      service.clearAllColors();
      expect(service.getAllTagColors()).toEqual([]);
    });

    it("after clearAllColors, individual tags return undefined", () => {
      service.setTagColor("a", "#111");
      service.clearAllColors();
      expect(service.getTagColor("a")).toBeUndefined();
    });
  });

  describe("localStorage persistence", () => {
    it("saves to localStorage when setting a color", () => {
      service.setTagColor("persistente", "#f97316");
      const stored = JSON.parse(
        localStorage.getItem("bookmarkforge_tag_colors") || "[]",
      );
      expect(stored).toEqual(
        expect.arrayContaining([{ tag: "persistente", color: "#f97316" }]),
      );
    });

    it("saves to localStorage when assigning a random color", () => {
      service.assignRandomColor("random-persist");
      const stored = JSON.parse(
        localStorage.getItem("bookmarkforge_tag_colors") || "[]",
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].tag).toBe("random-persist");
    });

    it("loads colors from localStorage in loadColors", () => {
      localStorage.setItem("bookmarkforge_tag_colores", JSON.stringify([]));
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([{ tag: "cargado", color: "#06b6d4" }]),
      );
      (TagColorService as any).instance = undefined;
      const nuevaInstancia = TagColorService.getInstance();
      expect(nuevaInstancia.getTagColor("cargado")).toBe("#06b6d4");
    });

    it("removeTagColors updates localStorage", () => {
      service.setTagColor("borrar", "#64748b");
      service.removeTagColor("borrar");
      const stored = JSON.parse(
        localStorage.getItem("bookmarkforge_tag_colors") || "[]",
      );
      expect(stored).toEqual([]);
    });

    it("clearAllColors updates localStorage", () => {
      service.setTagColor("a", "#111");
      service.setTagColor("b", "#222");
      service.clearAllColors();
      const stored = localStorage.getItem("bookmarkforge_tag_colors");
      expect(JSON.parse(stored || "[]")).toEqual([]);
    });

    it("does not fail if localStorage has corrupted data", () => {
      localStorage.setItem("bookmarkforge_tag_colors", "{corrupto");
      (TagColorService as any).instance = undefined;
      const instancia = TagColorService.getInstance();
      expect(instancia.getAllTagColors()).toEqual([]);
    });

    it("does not fail if localStorage.getItem throws", () => {
      const getItemOriginal = Storage.prototype.getItem;
      Storage.prototype.getItem = vi.fn().mockImplementation(() => {
        throw new Error("acceso denegado");
      });
      (TagColorService as any).instance = undefined;
      const instancia = TagColorService.getInstance();
      expect(instancia.getAllTagColors()).toEqual([]);
      Storage.prototype.getItem = getItemOriginal;
    });

    it("ignores valid JSON that is not an array", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify({ tag: "x", color: "#ef4444" }),
      );
      (TagColorService as any).instance = undefined;
      const instancia = TagColorService.getInstance();
      expect(instancia.getAllTagColors()).toEqual([]);
    });

    it("skips non-object and invalid entries without aborting the load", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([
          { tag: "good", color: "#ef4444" },
          null,
          42,
          { tag: "", color: "#ef4444" },
          { tag: "missing-color" },
          { color: "#ef4444" },
        ]),
      );
      (TagColorService as any).instance = undefined;
      const instancia = TagColorService.getInstance();
      expect(instancia.getTagColor("good")).toBe("#ef4444");
      expect(instancia.getAllTagColors()).toHaveLength(1);
    });
  });

  describe("migrateLegacyColors", () => {
    it("migrates #7c3aed (violet) to #00aeef (cyan) from localStorage", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([{ tag: "legacy-tag", color: "#7c3aed" }]),
      );
      (TagColorService as any).instance = undefined;
      const inst = TagColorService.getInstance();
      expect(inst.getTagColor("legacy-tag")).toBe("#00aeef");
    });

    it("migrates all legacy violet/purple hex values to #00aeef", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([
          { tag: "v", color: "#7c3aed" },
          { tag: "lv", color: "#8b5cf6" },
          { tag: "dv", color: "#6d28d9" },
          { tag: "lp", color: "#c084fc" },
          { tag: "lv2", color: "#a78bfa" },
        ]),
      );
      (TagColorService as any).instance = undefined;
      const inst = TagColorService.getInstance();
      expect(inst.getTagColor("v")).toBe("#00aeef");
      expect(inst.getTagColor("lv")).toBe("#00aeef");
      expect(inst.getTagColor("dv")).toBe("#00aeef");
      expect(inst.getTagColor("lp")).toBe("#00aeef");
      expect(inst.getTagColor("lv2")).toBe("#00aeef");
    });

    it("is a no-op when colors are already migrated (no #00aeef in V1_COLORS keys)", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([{ tag: "already-cyan", color: "#00aeef" }]),
      );
      (TagColorService as any).instance = undefined;
      const inst = TagColorService.getInstance();
      // Already-cyan is not in V1_COLORS keys, so it should remain unchanged
      expect(inst.getTagColor("already-cyan")).toBe("#00aeef");
    });

    it("does not touch colors not in the legacy set", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([
          { tag: "red", color: "#ef4444" },
          { tag: "green", color: "#22c55e" },
          { tag: "blue", color: "#3b82f6" },
        ]),
      );
      (TagColorService as any).instance = undefined;
      const inst = TagColorService.getInstance();
      expect(inst.getTagColor("red")).toBe("#ef4444");
      expect(inst.getTagColor("green")).toBe("#22c55e");
      expect(inst.getTagColor("blue")).toBe("#3b82f6");
    });

    it("persists migrated colors to localStorage", () => {
      localStorage.setItem(
        "bookmarkforge_tag_colors",
        JSON.stringify([{ tag: "migrate-me", color: "#7c3aed" }]),
      );
      (TagColorService as any).instance = undefined;
      TagColorService.getInstance();
      const stored = JSON.parse(
        localStorage.getItem("bookmarkforge_tag_colors") || "[]",
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].color).toBe("#00aeef");
    });

    it("no-ops when localStorage is empty", () => {
      localStorage.removeItem("bookmarkforge_tag_colors");
      (TagColorService as any).instance = undefined;
      const inst = TagColorService.getInstance();
      expect(inst.getAllTagColors()).toEqual([]);
    });
  });

  describe("tagColorService singleton exportado", () => {
    it("exists and is an instance of TagColorService", () => {
      expect(tagColorService).toBeDefined();
      expect(tagColorService).toBeInstanceOf(TagColorService);
    });
  });
});
