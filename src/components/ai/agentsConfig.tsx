import React from "react";
import {
  ShieldAlert,
  Bug,
  Wand2,
  Globe,
  BookOpen,
  Code2,
  PenTool,
  BarChart3,
  Layout,
  ShieldCheck,
  Target,
  Palette,
  Layers,
  FileCheck,
  Megaphone,
  Box,
  Briefcase,
  Accessibility,
  Zap,
  FileText,
  Languages,
  Rocket,
  Wrench,
  Search,
  Cloud,
  Database,
  Webhook,
  CloudLightning,
  Microscope,
  Workflow,
  MessageSquareQuote,
  Stamp,
  ScanSearch,
  Bot,
  RefreshCw,
  GitBranch,
  Filter,
} from "lucide-react";
import {
  loadSpecializedAgents,
  ProUnavailableError,
} from "../../services/pro-access";

/**
 * Why the actions are resolved lazily: `specializedAgentsService` is a Pro
 * module, so importing it statically would drag the whole 30+ agent registry
 * into Core chunks. Instead each entry names its agent (`actionId`) and the
 * panel resolves the real function through the gated loader the first time
 * it runs an analysis. Without Pro the run rejects with `ProUnavailableError`
 * and the panel shows the upgrade message — the registry itself is never
 * downloaded.
 */

type AgentId =
  | "reality"
  | "qa"
  | "frontend"
  | "seo"
  | "academic"
  | "code"
  | "copy"
  | "data"
  | "ux"
  | "security"
  | "strategy"
  | "creative"
  | "architecture"
  | "compliance"
  | "marketing"
  | "product"
  | "business"
  | "accessibility"
  | "performance"
  | "techWriter"
  | "localization"
  | "growth"
  | "refactor"
  | "bugHunter"
  | "devops"
  | "database"
  | "api"
  | "cloud"
  | "dataScience"
  | "automation"
  | "prompt"
  | "brand"
  | "codeql"
  | "copilot"
  | "legacy"
  | "repo";

export interface AgentConfig {
  id: AgentId;
  nameKey: string;
  descKey: string;
  icon: React.ElementType;
  color: string;
  category: "dev" | "design" | "business" | "analysis" | "ops";
  /**
   * The Pro registry key for this agent's action. The real function is
   * resolved (behind the entitlement gate) by `resolveAgentAction` when a
   * run starts — never at import time.
   */
  actionId: AgentIdKey;
}

/** Union of every action key in the Pro registry (mirrors its table). */
type AgentIdKey =
  | "realityCheck"
  | "suggestTests"
  | "optimizeUI"
  | "optimizeSEO"
  | "academicResearch"
  | "codeReview"
  | "copywriting"
  | "dataAnalysis"
  | "uxDesign"
  | "securityAudit"
  | "contentStrategy"
  | "creativeDirection"
  | "architectureReview"
  | "complianceAudit"
  | "marketingOptimization"
  | "productManagement"
  | "businessConsulting"
  | "accessibilityAudit"
  | "performanceOptimization"
  | "technicalWriting"
  | "localizationReview"
  | "growthHacking"
  | "codeRefactor"
  | "bugHunter"
  | "devOpsEngineering"
  | "databaseArchitecture"
  | "apiDesign"
  | "cloudArchitecture"
  | "dataScience"
  | "automationEngineering"
  | "promptEngineering"
  | "brandStrategy"
  | "codeqlSpecialist"
  | "copilotOptimizer"
  | "legacyModernizer"
  | "repoManagementExpert";

/** Signature of every agent action, mirrored from the Pro registry. */
type AgentAction = (
  text: string,
  lang?: string,
  isPrivate?: boolean,
  signal?: AbortSignal,
) => Promise<string>;

/** Resolves an agent's real action through the gated Pro loader. */
export async function resolveAgentAction(
  agent: AgentConfig,
): Promise<AgentAction> {
  const registry = await loadSpecializedAgents();
  const action = (registry as Record<string, AgentAction | undefined>)[
    agent.actionId
  ];
  if (typeof action !== "function") {
    throw new Error(`Unknown agent action: ${agent.actionId}`);
  }
  return action;
}

/** Re-exported so consumers can filter rejections without importing pro-access. */
export { ProUnavailableError };

export const agentsConfig: AgentConfig[] = [
  {
    id: "reality",
    nameKey: "app_realityChecker",
    descKey: "app_realityCheckerDesc",
    icon: ShieldAlert,
    color: "text-rose-500 bg-rose-500/10",
    category: "business",
    actionId: "realityCheck",
  },
  {
    id: "qa",
    nameKey: "app_qaTester",
    descKey: "app_qaTesterDesc",
    icon: Bug,
    color: "ds-text-warning bg-[var(--color-warning)]/10",
    category: "dev",
    actionId: "suggestTests",
  },
  {
    id: "frontend",
    nameKey: "app_frontendWizard",
    descKey: "app_frontendWizardDesc",
    icon: Wand2,
    color: "text-cyan-500 bg-cyan-500/10",
    category: "design",
    actionId: "optimizeUI",
  },
  {
    id: "seo",
    nameKey: "app_seoSpecialist",
    descKey: "app_seoSpecialistDesc",
    icon: Globe,
    color: "ds-text-success ds-bg-success/10",
    category: "business",
    actionId: "optimizeSEO",
  },
  {
    id: "academic",
    nameKey: "app_academicResearcher",
    descKey: "app_academicResearcherDesc",
    icon: BookOpen,
    color: "text-blue-500 bg-blue-500/10",
    category: "analysis",
    actionId: "academicResearch",
  },
  {
    id: "code",
    nameKey: "app_codeReviewer",
    descKey: "app_codeReviewerDesc",
    icon: Code2,
    color: "text-[var(--text-muted)] bg-[var(--bg-secondary)]/10",
    category: "dev",
    actionId: "codeReview",
  },
  {
    id: "copy",
    nameKey: "app_copywriter",
    descKey: "app_copywriterDesc",
    icon: PenTool,
    color: "text-orange-500 bg-orange-500/10",
    category: "design",
    actionId: "copywriting",
  },
  {
    id: "data",
    nameKey: "app_dataAnalyst",
    descKey: "app_dataAnalystDesc",
    icon: BarChart3,
    color: "text-cyan-500 bg-cyan-500/10",
    category: "analysis",
    actionId: "dataAnalysis",
  },
  {
    id: "ux",
    nameKey: "app_uxDesigner",
    descKey: "app_uxDesignerDesc",
    icon: Layout,
    color: "text-fuchsia-500 bg-fuchsia-500/10",
    category: "design",
    actionId: "uxDesign",
  },
  {
    id: "security",
    nameKey: "app_securityAuditor",
    descKey: "app_securityAuditorDesc",
    icon: ShieldCheck,
    color: "ds-text-danger bg-[var(--color-danger)]/10",
    category: "ops",
    actionId: "securityAudit",
  },
  {
    id: "strategy",
    nameKey: "app_contentStrategist",
    descKey: "app_contentStrategistDesc",
    icon: Target,
    color: "text-yellow-500 bg-yellow-500/10",
    category: "business",
    actionId: "contentStrategy",
  },
  {
    id: "creative",
    nameKey: "app_creativeDirector",
    descKey: "app_creativeDirectorDesc",
    icon: Palette,
    color: "text-fuchsia-500 bg-fuchsia-500/10",
    category: "design",
    actionId: "creativeDirection",
  },
  {
    id: "architecture",
    nameKey: "app_architectureReviewer",
    descKey: "app_architectureReviewerDesc",
    icon: Layers,
    color: "text-[var(--text-muted)] bg-[var(--bg-secondary)]/10",
    category: "dev",
    actionId: "architectureReview",
  },
  {
    id: "compliance",
    nameKey: "app_complianceOfficer",
    descKey: "app_complianceOfficerDesc",
    icon: FileCheck,
    color: "text-indigo-500 bg-indigo-500/10",
    category: "ops",
    actionId: "complianceAudit",
  },
  {
    id: "marketing",
    nameKey: "app_marketingSpecialist",
    descKey: "app_marketingSpecialistDesc",
    icon: Megaphone,
    color: "text-pink-500 bg-pink-500/10",
    category: "business",
    actionId: "marketingOptimization",
  },
  {
    id: "product",
    nameKey: "app_productManager",
    descKey: "app_productManagerDesc",
    icon: Box,
    color: "text-sky-500 bg-sky-500/10",
    category: "business",
    actionId: "productManagement",
  },
  {
    id: "business",
    nameKey: "app_businessConsultant",
    descKey: "app_businessConsultantDesc",
    icon: Briefcase,
    color: "ds-text-success ds-bg-success/10",
    category: "business",
    actionId: "businessConsulting",
  },
  {
    id: "accessibility",
    nameKey: "app_accessibilityExpert",
    descKey: "app_accessibilityExpertDesc",
    icon: Accessibility,
    color: "text-blue-600 bg-blue-600/10",
    category: "design",
    actionId: "accessibilityAudit",
  },
  {
    id: "performance",
    nameKey: "app_performanceOptimizer",
    descKey: "app_performanceOptimizerDesc",
    icon: Zap,
    color: "text-yellow-600 bg-yellow-600/10",
    category: "ops",
    actionId: "performanceOptimization",
  },
  {
    id: "techWriter",
    nameKey: "app_technicalWriter",
    descKey: "app_technicalWriterDesc",
    icon: FileText,
    color: "text-[var(--text-secondary)] bg-[var(--bg-secondary)]/10",
    category: "ops",
    actionId: "technicalWriting",
  },
  {
    id: "localization",
    nameKey: "app_localizationExpert",
    descKey: "app_localizationExpertDesc",
    icon: Languages,
    color: "text-indigo-600 bg-indigo-600/10",
    category: "ops",
    actionId: "localizationReview",
  },
  {
    id: "growth",
    nameKey: "app_growthHacker",
    descKey: "app_growthHackerDesc",
    icon: Rocket,
    color: "text-orange-600 bg-orange-600/10",
    category: "business",
    actionId: "growthHacking",
  },
  {
    id: "refactor",
    nameKey: "app_codeRefactorer",
    descKey: "app_codeRefactorerDesc",
    icon: Wrench,
    color: "text-sky-600 bg-sky-600/10",
    category: "dev",
    actionId: "codeRefactor",
  },
  {
    id: "bugHunter",
    nameKey: "app_bugHunter",
    descKey: "app_bugHunterDesc",
    icon: Search,
    color: "ds-text-danger bg-[var(--color-danger)]/10",
    category: "dev",
    actionId: "bugHunter",
  },
  {
    id: "devops",
    nameKey: "app_devopsEngineer",
    descKey: "app_devopsEngineerDesc",
    icon: Cloud,
    color: "text-sky-600 bg-sky-600/10",
    category: "ops",
    actionId: "devOpsEngineering",
  },
  {
    id: "database",
    nameKey: "app_databaseArchitect",
    descKey: "app_databaseArchitectDesc",
    icon: Database,
    color: "ds-text-success ds-bg-success/10",
    category: "dev",
    actionId: "databaseArchitecture",
  },
  {
    id: "api",
    nameKey: "app_apiDesigner",
    descKey: "app_apiDesignerDesc",
    icon: Webhook,
    color: "text-cyan-600 bg-cyan-600/10",
    category: "dev",
    actionId: "apiDesign",
  },
  {
    id: "cloud",
    nameKey: "app_cloudArchitect",
    descKey: "app_cloudArchitectDesc",
    icon: CloudLightning,
    color: "text-blue-600 bg-blue-600/10",
    category: "ops",
    actionId: "cloudArchitecture",
  },
  {
    id: "dataScience",
    nameKey: "app_dataScientist",
    descKey: "app_dataScientistDesc",
    icon: Microscope,
    color: "text-cyan-600 bg-cyan-600/10",
    category: "analysis",
    actionId: "dataScience",
  },
  {
    id: "automation",
    nameKey: "app_automationEngineer",
    descKey: "app_automationEngineerDesc",
    icon: Workflow,
    color: "text-orange-600 bg-orange-600/10",
    category: "ops",
    actionId: "automationEngineering",
  },
  {
    id: "prompt",
    nameKey: "app_promptEngineer",
    descKey: "app_promptEngineerDesc",
    icon: MessageSquareQuote,
    color: "text-yellow-600 bg-yellow-600/10",
    category: "analysis",
    actionId: "promptEngineering",
  },
  {
    id: "brand",
    nameKey: "app_brandStrategist",
    descKey: "app_brandStrategistDesc",
    icon: Stamp,
    color: "text-rose-600 bg-rose-600/10",
    category: "business",
    actionId: "brandStrategy",
  },
  {
    id: "codeql",
    nameKey: "app_codeqlSpecialist",
    descKey: "app_codeqlSpecialistDesc",
    icon: ScanSearch,
    color: "text-blue-600 bg-blue-600/10",
    category: "dev",
    actionId: "codeqlSpecialist",
  },
  {
    id: "copilot",
    nameKey: "app_copilotOptimizer",
    descKey: "app_copilotOptimizerDesc",
    icon: Bot,
    color: "text-fuchsia-600 bg-fuchsia-600/10",
    category: "dev",
    actionId: "copilotOptimizer",
  },
  {
    id: "legacy",
    nameKey: "app_legacyModernizer",
    descKey: "app_legacyModernizerDesc",
    icon: RefreshCw,
    color: "text-orange-600 bg-orange-600/10",
    category: "dev",
    actionId: "legacyModernizer",
  },
  {
    id: "repo",
    nameKey: "app_repoManagementExpert",
    descKey: "app_repoManagementExpertDesc",
    icon: GitBranch,
    color: "ds-text-success ds-bg-success/10",
    category: "dev",
    actionId: "repoManagementExpert",
  },
];

export const categories = [
  { id: "all" as const, labelKey: "app_all", icon: Filter },
  { id: "dev" as const, labelKey: "app_development", icon: Code2 },
  { id: "design" as const, labelKey: "app_designUX", icon: Palette },
  {
    id: "business" as const,
    labelKey: "app_businessStrategy",
    icon: Briefcase,
  },
  {
    id: "analysis" as const,
    labelKey: "app_analysisResearch",
    icon: Microscope,
  },
  { id: "ops" as const, labelKey: "app_operationsSecurity", icon: ShieldCheck },
];
