import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mod = await import("../../services/DocumentTemplateService");
const DocumentTemplateServiceClass = (mod.documentTemplateService as any)
  .constructor;
const documentTemplateService = mod.documentTemplateService;

describe("DocumentTemplateService", () => {
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    DocumentTemplateServiceClass.instance = undefined;
    service = DocumentTemplateServiceClass.getInstance();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getInstance (singleton)", () => {
    it("returns the same instance every time", () => {
      const inst1 = DocumentTemplateServiceClass.getInstance();
      const inst2 = DocumentTemplateServiceClass.getInstance();
      expect(inst1).toBe(inst2);
    });
  });

  describe("getAllTemplates", () => {
    it("returns the 5 default templates", () => {
      const templates = service.getAllTemplates();
      expect(templates).toHaveLength(5);
    });

    it("each template has the correct structure", () => {
      const templates = service.getAllTemplates();
      templates.forEach((t: any) => {
        expect(t).toHaveProperty("id");
        expect(t).toHaveProperty("name");
        expect(t).toHaveProperty("description");
        expect(t).toHaveProperty("category");
        expect(t).toHaveProperty("content");
        expect(t).toHaveProperty("tags");
        expect(t).toHaveProperty("icon");
      });
    });

    it("includes article template", () => {
      const templates = service.getAllTemplates();
      const article = templates.find((t: any) => t.id === "article");
      expect(article).toBeDefined();
      expect(article.name).toBe("Article");
      expect(article.category).toBe("Writing");
    });
  });

  describe("getTemplate", () => {
    it("returns template by id", () => {
      const t = service.getTemplate("article");
      expect(t).toBeDefined();
      expect(t.id).toBe("article");
    });

    it("returns undefined for nonexistent id", () => {
      expect(service.getTemplate("no-existe")).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(service.getTemplate("")).toBeUndefined();
    });
  });

  describe("getTemplatesByCategory", () => {
    it("filters by Business category", () => {
      const templates = service.getTemplatesByCategory("Business");
      expect(templates).toHaveLength(2);
      templates.forEach((t: any) => expect(t.category).toBe("Business"));
    });

    it("filters by Academic category", () => {
      const templates = service.getTemplatesByCategory("Academic");
      expect(templates).toHaveLength(1);
      expect(templates[0].id).toBe("research");
    });

    it("returns empty array for category without templates", () => {
      const templates = service.getTemplatesByCategory("NoExist");
      expect(templates).toEqual([]);
    });
  });

  describe("createTemplate", () => {
    it("creates template with generated id", () => {
      const newT = service.createTemplate({
        name: "Mi Template",
        description: "Test",
        category: "Personal",
        content: [{ type: "paragraph", content: "hola" }],
        tags: ["test"],
        icon: "Star",
      });
      expect(newT.id).toMatch(/^custom_\d+/);
      expect(newT.name).toBe("Mi Template");
      expect(service.getTemplate(newT.id)).toBeDefined();
    });

    it("persists to localStorage", () => {
      service.createTemplate({
        name: "Persistente",
        description: "",
        category: "Test",
        content: [],
        tags: [],
        icon: "X",
      });
      const stored = localStorage.getItem("bookmarkforge_document_templates");
      expect(stored).toBeDefined();
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("Persistente");
    });
  });

  describe("updateTemplate", () => {
    it("updates existing template", () => {
      service.updateTemplate("article", { name: "Artículo Modificado" });
      expect(service.getTemplate("article").name).toBe("Artículo Modificado");
    });

    it("partially updates without losing other fields", () => {
      service.updateTemplate("article", { description: "Nueva desc" });
      const t = service.getTemplate("article");
      expect(t.description).toBe("Nueva desc");
      expect(t.name).toBe("Article");
    });

    it("does nothing if the template does not exist", () => {
      service.updateTemplate("no-existe", { name: "test" });
      expect(service.getTemplate("no-existe")).toBeUndefined();
    });
  });

  describe("deleteTemplate", () => {
    it("deletes custom template", () => {
      const created = service.createTemplate({
        name: "Temp",
        description: "",
        category: "Test",
        content: [],
        tags: [],
        icon: "X",
      });
      service.deleteTemplate(created.id);
      expect(service.getTemplate(created.id)).toBeUndefined();
    });

    it("does not delete default template", () => {
      service.deleteTemplate("article");
      expect(service.getTemplate("article")).toBeDefined();
    });
  });

  describe("getCategories", () => {
    it("returns ordered categories", () => {
      const cats = service.getCategories();
      expect(cats).toContain("Academic");
      expect(cats).toContain("Business");
      expect(cats).toContain("Personal");
      expect(cats).toContain("Writing");
      expect(cats).toEqual(cats.slice().sort());
    });

    it("includes custom template categories", () => {
      service.createTemplate({
        name: "Test",
        description: "",
        category: "NuevaCat",
        content: [],
        tags: [],
        icon: "X",
      });
      const cats = service.getCategories();
      expect(cats).toContain("NuevaCat");
    });
  });

  describe("loads from localStorage", () => {
    it("loads saved custom templates", () => {
      const custom = [
        {
          id: "custom_1",
          name: "Custom",
          description: "",
          category: "Test",
          content: [],
          tags: [],
          icon: "X",
        },
      ];
      localStorage.setItem(
        "bookmarkforge_document_templates",
        JSON.stringify(custom),
      );
      DocumentTemplateServiceClass.instance = undefined;
      const inst = DocumentTemplateServiceClass.getInstance();
      const all = inst.getAllTemplates();
      expect(all.find((t: any) => t.id === "custom_1")).toBeDefined();
    });

    it("mergea templates custom con defaults", () => {
      const custom = [
        {
          id: "custom_1",
          name: "Custom",
          description: "",
          category: "Test",
          content: [],
          tags: [],
          icon: "X",
        },
      ];
      localStorage.setItem(
        "bookmarkforge_document_templates",
        JSON.stringify(custom),
      );
      DocumentTemplateServiceClass.instance = undefined;
      const inst = DocumentTemplateServiceClass.getInstance();
      expect(inst.getAllTemplates()).toHaveLength(6);
    });

    it("custom template overrides default with the same id because it loads first", () => {
      const custom = [
        {
          id: "article",
          name: "Sobreescrito",
          description: "",
          category: "Test",
          content: [],
          tags: [],
          icon: "X",
        },
      ];
      localStorage.setItem(
        "bookmarkforge_document_templates",
        JSON.stringify(custom),
      );
      DocumentTemplateServiceClass.instance = undefined;
      const inst = DocumentTemplateServiceClass.getInstance();
      // Custom loads first, then defaults only if they don't exist -> since 'article' already exists, it is not overwritten
      expect(inst.getTemplate("article").name).toBe("Sobreescrito");
    });

    it("tolerates invalid JSON in localStorage", () => {
      localStorage.setItem("bookmarkforge_document_templates", "no-es-json");
      DocumentTemplateServiceClass.instance = undefined;
      const inst = DocumentTemplateServiceClass.getInstance();
      expect(inst.getAllTemplates()).toHaveLength(5);
    });

    it("ignores valid JSON that is not an array", () => {
      localStorage.setItem(
        "bookmarkforge_document_templates",
        JSON.stringify({ id: "custom_1", name: "Not an array" }),
      );
      DocumentTemplateServiceClass.instance = undefined;
      const inst = DocumentTemplateServiceClass.getInstance();
      expect(inst.getAllTemplates()).toHaveLength(5);
    });

    it("skips entries without a string id without aborting the load", () => {
      localStorage.setItem(
        "bookmarkforge_document_templates",
        JSON.stringify([
          {
            id: "custom_ok",
            name: "Custom",
            description: "",
            category: "Test",
            content: [],
            tags: [],
            icon: "X",
          },
          null,
          42,
          { name: "no-id" },
        ]),
      );
      DocumentTemplateServiceClass.instance = undefined;
      const inst = DocumentTemplateServiceClass.getInstance();
      expect(inst.getTemplate("custom_ok")).toBeDefined();
      expect(inst.getAllTemplates()).toHaveLength(6);
    });
  });

  describe("documentTemplateService exportado", () => {
    it("exists and has main methods", () => {
      expect(documentTemplateService).toBeDefined();
      expect(typeof documentTemplateService.getAllTemplates).toBe("function");
      expect(typeof documentTemplateService.createTemplate).toBe("function");
      expect(typeof documentTemplateService.updateTemplate).toBe("function");
      expect(typeof documentTemplateService.deleteTemplate).toBe("function");
    });
  });

  describe("templateBlocksToPlainText", () => {
    it("converts headings and paragraphs to plain text", () => {
      const text = mod.templateBlocksToPlainText([
        { type: "heading", content: "Title" },
        { type: "paragraph", content: "Intro text" },
      ]);
      expect(text).toBe("Title\nIntro text");
    });

    it("prefija items de bulletList con guiones", () => {
      const text = mod.templateBlocksToPlainText([
        { type: "bulletList", content: ["Item 1", "Item 2"] },
      ]);
      expect(text).toBe("- Item 1\n- Item 2");
    });

    it("enumera items de numberedList", () => {
      const text = mod.templateBlocksToPlainText([
        { type: "numberedList", content: ["A", "B"] },
      ]);
      expect(text).toBe("1. A\n2. B");
    });

    it("extracts text from inline content of real BlockNote blocks", () => {
      const text = mod.templateBlocksToPlainText([
        {
          type: "paragraph",
          content: [{ type: "text", text: "hola", styles: {} }],
        },
      ]);
      expect(text).toBe("hola");
    });

    it("ignores empty blocks and returns empty string without blocks", () => {
      expect(mod.templateBlocksToPlainText([])).toBe("");
      expect(
        mod.templateBlocksToPlainText([{ type: "paragraph", content: "" }]),
      ).toBe("");
    });

    it("tolera entradas no-objeto sin lanzar", () => {
      expect(() => mod.templateBlocksToPlainText([null, 42, "x"])).not.toThrow();
    });

    it("recorre children de bloques columnLayout", () => {
      const text = mod.templateBlocksToPlainText([
        {
          type: "columnLayout",
          props: { count: 2 },
          content: [],
          children: [
            {
              type: "column",
              content: [
                { type: "paragraph", content: "Columna 1" },
              ],
            },
            {
              type: "column",
              content: [{ type: "paragraph", content: "Columna 2" }],
            },
          ],
        },
      ]);
      expect(text).toContain("Columna 1");
      expect(text).toContain("Columna 2");
    });

    it("returns empty string for non-array input", () => {
      expect(
        mod.templateBlocksToPlainText(null as unknown as unknown[]),
      ).toBe("");
      expect(
        mod.templateBlocksToPlainText("x" as unknown as unknown[]),
      ).toBe("");
    });
  });

  describe("normalizeTemplateBlocksToBlockNote", () => {
    it("converts bulletList with string items to bulletListItem", () => {
      const blocks = mod.normalizeTemplateBlocksToBlockNote([
        { type: "bulletList", content: ["A", "B"] },
      ]);
      expect(blocks).toEqual([
        { type: "bulletListItem", content: "A" },
        { type: "bulletListItem", content: "B" },
      ]);
    });

    it("converts numberedList to numberedListItem", () => {
      const blocks = mod.normalizeTemplateBlocksToBlockNote([
        { type: "numberedList", content: ["1", "2"] },
      ]);
      expect(blocks).toEqual([
        { type: "numberedListItem", content: "1" },
        { type: "numberedListItem", content: "2" },
      ]);
    });

    it("lets already-valid BlockNote blocks pass through", () => {
      const input = [
        { type: "heading", content: "Title", props: { level: 1 } },
        { type: "paragraph", content: "text" },
        { type: "callout", content: "note", props: { icon: "💡" } },
      ];
      expect(mod.normalizeTemplateBlocksToBlockNote(input)).toEqual(input);
    });

    it("returns empty array for non-array input", () => {
      expect(
        mod.normalizeTemplateBlocksToBlockNote(null as unknown as unknown[]),
      ).toEqual([]);
    });

    it("wraps object items in an array (InlineContent/PartialBlock)", () => {
      const blocks = mod.normalizeTemplateBlocksToBlockNote([
        {
          type: "bulletList",
          content: [{ type: "text", text: "inline" }],
        },
      ]);
      expect(blocks).toEqual([
        { type: "bulletListItem", content: [{ type: "text", text: "inline" }] },
      ]);
    });

    it("discards corrupted list blocks with non-array content", () => {
      const blocks = mod.normalizeTemplateBlocksToBlockNote([
        { type: "bulletList", content: "not-an-array" },
        { type: "paragraph", content: "kept" },
      ]);
      expect(blocks).toEqual([{ type: "paragraph", content: "kept" }]);
    });

    it("normaliza numberedList con items objeto", () => {
      const blocks = mod.normalizeTemplateBlocksToBlockNote([
        { type: "numberedList", content: [{ text: "x" }] },
      ]);
      expect(blocks).toEqual([
        { type: "numberedListItem", content: [{ text: "x" }] },
      ]);
    });
  });
});
