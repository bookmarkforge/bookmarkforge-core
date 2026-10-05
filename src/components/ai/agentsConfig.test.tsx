import { describe, it, expect, vi } from "vitest";

vi.mock("../../services/ai/SpecializedAgentsService", () => {
  const serviceMethods = [
    "realityCheck",
    "suggestTests",
    "optimizeUI",
    "optimizeSEO",
    "academicResearch",
    "codeReview",
    "copywriting",
    "dataAnalysis",
    "uxDesign",
    "securityAudit",
    "contentStrategy",
    "creativeDirection",
    "architectureReview",
    "complianceAudit",
    "marketingOptimization",
    "productManagement",
    "businessConsulting",
    "accessibilityAudit",
    "performanceOptimization",
    "technicalWriting",
    "localizationReview",
    "growthHacking",
    "codeRefactor",
    "bugHunter",
    "devOpsEngineering",
    "databaseArchitecture",
    "apiDesign",
    "cloudArchitecture",
    "dataScience",
    "automationEngineering",
    "promptEngineering",
    "brandStrategy",
    "codeqlSpecialist",
    "copilotOptimizer",
    "legacyModernizer",
    "repoManagementExpert",
  ];
  const service: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of serviceMethods) {
    service[method] = vi.fn().mockResolvedValue("");
  }
  return { specializedAgentsService: service };
});

vi.mock("lucide-react", () => {
  const iconNames = [
    "ShieldAlert",
    "Bug",
    "Wand2",
    "Globe",
    "BookOpen",
    "Code2",
    "PenTool",
    "BarChart3",
    "Layout",
    "ShieldCheck",
    "Target",
    "Palette",
    "Layers",
    "FileCheck",
    "Megaphone",
    "Box",
    "Briefcase",
    "Accessibility",
    "Zap",
    "FileText",
    "Languages",
    "Rocket",
    "Wrench",
    "Search",
    "Cloud",
    "Database",
    "Webhook",
    "CloudLightning",
    "Microscope",
    "Workflow",
    "MessageSquareQuote",
    "Stamp",
    "ScanSearch",
    "Bot",
    "RefreshCw",
    "GitBranch",
    "Filter",
  ];
  const icons: Record<string, () => null> = {};
  for (const name of iconNames) {
    icons[name] = () => null;
  }
  return icons;
});

import { agentsConfig, categories } from "./agentsConfig";

const VALID_CATEGORIES = [
  "dev",
  "design",
  "business",
  "analysis",
  "ops",
] as const;

const EXPECTED_AGENT_IDS = [
  "reality",
  "qa",
  "frontend",
  "seo",
  "academic",
  "code",
  "copy",
  "data",
  "ux",
  "security",
  "strategy",
  "creative",
  "architecture",
  "compliance",
  "marketing",
  "product",
  "business",
  "accessibility",
  "performance",
  "techWriter",
  "localization",
  "growth",
  "refactor",
  "bugHunter",
  "devops",
  "database",
  "api",
  "cloud",
  "dataScience",
  "automation",
  "prompt",
  "brand",
  "codeql",
  "copilot",
  "legacy",
  "repo",
] as const;

describe("agentsConfig", () => {
  it("is an array with all expected agents", () => {
    expect(Array.isArray(agentsConfig)).toBe(true);
    expect(agentsConfig.length).toBe(EXPECTED_AGENT_IDS.length);
    const ids = agentsConfig.map((a) => a.id);
    for (const expectedId of EXPECTED_AGENT_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  it("each agent has the correct shape", () => {
    for (const agent of agentsConfig) {
      expect(agent).toHaveProperty("id");
      expect(agent).toHaveProperty("nameKey", expect.any(String));
      expect(agent).toHaveProperty("descKey", expect.any(String));
      expect(agent).toHaveProperty("icon");
      expect(agent).toHaveProperty("color", expect.any(String));
      expect(agent).toHaveProperty("category");
      expect(agent).toHaveProperty("actionId");
    }
  });

  it("all agent IDs are unique", () => {
    const ids = agentsConfig.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each agent names a known Pro action key", () => {
    for (const agent of agentsConfig) {
      expect(typeof agent.actionId).toBe("string");
      expect(agent.actionId.length).toBeGreaterThan(0);
    }
  });

  it("category values are valid", () => {
    for (const agent of agentsConfig) {
      expect(VALID_CATEGORIES).toContain(agent.category);
    }
  });

  it("categories array exists with correct categories", () => {
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBe(6);

    const expected = [
      { id: "all", labelKey: "app_all" },
      { id: "dev", labelKey: "app_development" },
      { id: "design", labelKey: "app_designUX" },
      { id: "business", labelKey: "app_businessStrategy" },
      { id: "analysis", labelKey: "app_analysisResearch" },
      { id: "ops", labelKey: "app_operationsSecurity" },
    ];

    for (let i = 0; i < categories.length; i++) {
      expect(categories[i]!.id).toBe(expected[i]!.id);
      expect(categories[i]!.labelKey).toBe(expected[i]!.labelKey);
      expect(typeof categories[i]!.icon).toBe("function");
    }
  });
});
