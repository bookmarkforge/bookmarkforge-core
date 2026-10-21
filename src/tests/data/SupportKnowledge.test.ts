import { describe, it, expect } from "vitest";

describe("constants/SupportKnowledge_es", () => {
  it("should export Spanish knowledge base", async () => {
    const { SUPPORT_KNOWLEDGE_ES } =
      await import("../../data/SupportKnowledge_es");
    expect(SUPPORT_KNOWLEDGE_ES.GENERAL.APP_NAME).toBe("BookmarkForge");
    expect(SUPPORT_KNOWLEDGE_ES.GLOSSARY.RAG).toContain("Recuperación");
  });
});

describe("constants/SupportKnowledge", () => {
  it("should export SUPPORT_KNOWLEDGE with en and es keys", async () => {
    const { SUPPORT_KNOWLEDGE } = await import("../../data/SupportKnowledge");
    expect(SUPPORT_KNOWLEDGE.en).toBeDefined();
    expect(SUPPORT_KNOWLEDGE.es).toBeDefined();
    expect(SUPPORT_KNOWLEDGE.en!.GENERAL.APP_NAME).toBe("BookmarkForge");
    expect(SUPPORT_KNOWLEDGE.es!.GENERAL.APP_NAME).toBe("BookmarkForge");
  });

  it("should have GLOSSARY in both languages", async () => {
    const { SUPPORT_KNOWLEDGE } = await import("../../data/SupportKnowledge");
    expect(SUPPORT_KNOWLEDGE.en!.GLOSSARY.RAG).toContain("Augmented");
    expect(SUPPORT_KNOWLEDGE.es!.GLOSSARY.RAG).toContain("Aumentada");
    expect(SUPPORT_KNOWLEDGE.en!.GLOSSARY.WEBLLM).toContain("browser");
    expect(SUPPORT_KNOWLEDGE.es!.GLOSSARY.WEBLLM).toContain("navegador");
  });

  it("should have version info in both", async () => {
    const { SUPPORT_KNOWLEDGE } = await import("../../data/SupportKnowledge");
    expect(SUPPORT_KNOWLEDGE.en!.GENERAL.VERSION).toMatch(/^\d+\.\d+/);
    expect(SUPPORT_KNOWLEDGE.es!.GENERAL.VERSION).toMatch(/^\d+\.\d+/);
  });

  it("getSupportKnowledge falls back to English for unknown/regional locales", async () => {
    const { getSupportKnowledge } = await import("../../data/SupportKnowledge");
    // Regional tags are normalized to their base language.
    expect(getSupportKnowledge("es-ES")).toBe(getSupportKnowledge("es"));
    // Unknown locale → English fallback (never undefined).
    expect(getSupportKnowledge("pt-BR").GENERAL.APP_NAME).toBe("BookmarkForge");
    expect(getSupportKnowledge("xx").GENERAL.APP_NAME).toBe("BookmarkForge");
    // No locale → English.
    expect(getSupportKnowledge(undefined).GENERAL.APP_NAME).toBe("BookmarkForge");
  });
});
