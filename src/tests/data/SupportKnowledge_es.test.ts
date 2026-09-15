import { describe, it, expect } from "vitest";
import { SUPPORT_KNOWLEDGE_ES } from "../../data/SupportKnowledge_es";

describe("SUPPORT_KNOWLEDGE_ES (Spanish version)", () => {
  it("all texts are in Spanish", () => {
    expect(SUPPORT_KNOWLEDGE_ES.GENERAL.APP_NAME).toBe("BookmarkForge");
    expect(SUPPORT_KNOWLEDGE_ES.GENERAL.VERSION).toBe("1.0.0 Estable");
    expect(SUPPORT_KNOWLEDGE_ES.GENERAL.BUILD_DATE).toBe("Mayo 2026");
    expect(SUPPORT_KNOWLEDGE_ES.GENERAL.PHILOSOPHY).toContain(
      "Privacidad total",
    );
    expect(SUPPORT_KNOWLEDGE_ES.GENERAL.DATA_STORAGE).toContain(
      "100% Local-First",
    );
  });

  it("GLOSSARY has all terms translated", () => {
    const glossaryKeys = [
      "RAG",
      "EMBEDDINGS",
      "P2P_SYNC",
      "VAULT",
      "WEBLLM",
      "SPACED_REPETITION",
      "ZERO_KNOWLEDGE",
    ];
    for (const key of glossaryKeys) {
      expect(SUPPORT_KNOWLEDGE_ES.GLOSSARY).toHaveProperty(key);
      expect(
        SUPPORT_KNOWLEDGE_ES.GLOSSARY[
          key as keyof typeof SUPPORT_KNOWLEDGE_ES.GLOSSARY
        ].length,
      ).toBeGreaterThan(0);
    }
    expect(SUPPORT_KNOWLEDGE_ES.GLOSSARY.RAG).toContain("Generación Aumentada");
    expect(SUPPORT_KNOWLEDGE_ES.GLOSSARY.WEBLLM).toContain("WebGPU");
  });

  it("CORE_FEATURES_ADVANCED has all features in Spanish", () => {
    const features = [
      "EDITOR",
      "BOOKMARKS",
      "FLASHCARDS",
      "GRAPH_VIEW",
      "VOICE_COMMANDS",
      "OMNIBAR",
    ];
    for (const feat of features) {
      expect(SUPPORT_KNOWLEDGE_ES.CORE_FEATURES_ADVANCED).toHaveProperty(feat);
      expect(
        SUPPORT_KNOWLEDGE_ES.CORE_FEATURES_ADVANCED[
          feat as keyof typeof SUPPORT_KNOWLEDGE_ES.CORE_FEATURES_ADVANCED
        ].length,
      ).toBeGreaterThan(0);
    }
    expect(SUPPORT_KNOWLEDGE_ES.CORE_FEATURES_ADVANCED.EDITOR).toContain(
      "Editor basado en bloques",
    );
    expect(SUPPORT_KNOWLEDGE_ES.CORE_FEATURES_ADVANCED.OMNIBAR).toContain(
      "Ctrl+K",
    );
  });

  it("AI_CONFIGURATION_PRO has settings in Spanish", () => {
    const aiKeys = [
      "CLOUD_VS_LOCAL",
      "PRIVACY_SHIELD_DETAILS",
      "MODEL_SELECTION",
      "QUANTIZATION",
      "TOKEN_OPTIMIZATION",
    ];
    for (const key of aiKeys) {
      expect(SUPPORT_KNOWLEDGE_ES.AI_CONFIGURATION_PRO).toHaveProperty(key);
      expect(
        SUPPORT_KNOWLEDGE_ES.AI_CONFIGURATION_PRO[
          key as keyof typeof SUPPORT_KNOWLEDGE_ES.AI_CONFIGURATION_PRO
        ].length,
      ).toBeGreaterThan(0);
    }
    expect(SUPPORT_KNOWLEDGE_ES.AI_CONFIGURATION_PRO.CLOUD_VS_LOCAL).toContain(
      "Gemini",
    );
    expect(SUPPORT_KNOWLEDGE_ES.AI_CONFIGURATION_PRO.MODEL_SELECTION).toContain(
      "Qwen",
    );
  });

  it("SECURITY_DEEP_DIVE contains translated security policies", () => {
    expect(
      SUPPORT_KNOWLEDGE_ES.SECURITY_DEEP_DIVE.MASTER_PASSWORD_POLICY,
    ).toContain("Mínimo 12 caracteres");
    expect(
      SUPPORT_KNOWLEDGE_ES.SECURITY_DEEP_DIVE.ENCRYPTION_DETAILS,
    ).toContain("SubtleCrypto");
    expect(SUPPORT_KNOWLEDGE_ES.SECURITY_DEEP_DIVE.DATA_RECOVERY).toContain(
      "NO existe el enlace",
    );
    expect(
      SUPPORT_KNOWLEDGE_ES.SECURITY_DEEP_DIVE.OFFLINE_VALIDATION,
    ).toContain("validación de la licencia");
  });

  it("TROUBLESHOOTING_MASTER_LIST has 6 issues with Spanish texts", () => {
    const keys = Object.keys(SUPPORT_KNOWLEDGE_ES.TROUBLESHOOTING_MASTER_LIST);
    expect(keys).toHaveLength(6);
    expect(
      SUPPORT_KNOWLEDGE_ES.TROUBLESHOOTING_MASTER_LIST.APP_NOT_LOADING,
    ).toContain("Limpia la caché");
    expect(
      SUPPORT_KNOWLEDGE_ES.TROUBLESHOOTING_MASTER_LIST.SYNC_FAILING,
    ).toContain("Wi-Fi");
    expect(
      SUPPORT_KNOWLEDGE_ES.TROUBLESHOOTING_MASTER_LIST.AI_HALLUCINATIONS,
    ).toContain("La IA puede equivocarse");
    expect(
      SUPPORT_KNOWLEDGE_ES.TROUBLESHOOTING_MASTER_LIST.DB_CORRUPTION,
    ).toContain("copia");
  });

  it("FAQ_EXTENDED has frequently asked questions in Spanish", () => {
    const faq = SUPPORT_KNOWLEDGE_ES.FAQ_EXTENDED;
    expect(Object.keys(faq).length).toBeGreaterThan(0);
    expect(faq).toHaveProperty("¿Es gratis?");
    expect(faq).toHaveProperty("¿Puedo usarlo en el móvil?");
    expect(faq).toHaveProperty("¿Funciona sin internet?");
    for (const [question, answer] of Object.entries(faq)) {
      expect(typeof question).toBe("string");
      expect(typeof answer).toBe("string");
      expect(question.length).toBeGreaterThan(0);
      expect(answer.length).toBeGreaterThan(0);
    }
    expect(faq["¿Es gratis?"]).toContain("Licencia Pro");
  });

  it("TUTORIALS_QUICK_START has 3 tutorials in Spanish", () => {
    const tutorials = SUPPORT_KNOWLEDGE_ES.TUTORIALS_QUICK_START;
    expect(Object.keys(tutorials)).toHaveLength(3);
    expect(tutorials).toHaveProperty("Configuración en 2 min");
    expect(tutorials).toHaveProperty("Dominando la Búsqueda");
    expect(tutorials).toHaveProperty("Convirtiéndote en Usuario Pro");
  });

  it("COMPATIBILITY_MATRIX has platforms with Spanish descriptions", () => {
    expect(SUPPORT_KNOWLEDGE_ES.COMPATIBILITY_MATRIX.WINDOWS).toContain(
      "Chrome/Edge (Mejor)",
    );
    expect(SUPPORT_KNOWLEDGE_ES.COMPATIBILITY_MATRIX.MACOS).toContain("Safari");
    expect(SUPPORT_KNOWLEDGE_ES.COMPATIBILITY_MATRIX.LINUX).toContain(
      "Firefox",
    );
    expect(SUPPORT_KNOWLEDGE_ES.COMPATIBILITY_MATRIX.MOBILE).toContain("PWA");
    expect(SUPPORT_KNOWLEDGE_ES.COMPATIBILITY_MATRIX.HARDWARE).toContain("8GB");
  });

  it("GDPR_PRIVACY_COMPLIANCE is translated to Spanish", () => {
    expect(SUPPORT_KNOWLEDGE_ES.GDPR_PRIVACY_COMPLIANCE.COMPLIANCE).toContain(
      "RGPD",
    );
    expect(
      SUPPORT_KNOWLEDGE_ES.GDPR_PRIVACY_COMPLIANCE.DATA_PORTABILITY,
    ).toContain("exportar");
    expect(SUPPORT_KNOWLEDGE_ES.GDPR_PRIVACY_COMPLIANCE.NO_TRACKING).toContain(
      "100% limpio",
    );
  });

  it("LICENSE_SUPPORT has license support in Spanish", () => {
    expect(SUPPORT_KNOWLEDGE_ES.LICENSE_SUPPORT.PAYMENT_PROCESSOR).toContain(
      "proveedor de pagos",
    );
    expect(SUPPORT_KNOWLEDGE_ES.LICENSE_SUPPORT.REFUND_POLICY).toContain(
      "30 días",
    );
    expect(SUPPORT_KNOWLEDGE_ES.LICENSE_SUPPORT.PRO_FEATURES).toContain("P2P");
  });
});
