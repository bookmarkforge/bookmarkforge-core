/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/ai/SpecializedAgentsService.ts`. No implementation is present in this repository. */
type AgentId = "realityCheck" | "suggestTests" | "optimizeUI" | "optimizeSEO" | "academicResearch" | "codeReview" | "copywriting" | "dataAnalysis" | "uxDesign" | "securityAudit" | "contentStrategy" | "creativeDirection" | "architectureReview" | "complianceAudit" | "marketingOptimization" | "productManagement" | "businessConsulting" | "accessibilityAudit" | "performanceOptimization" | "technicalWriting" | "localizationReview" | "growthHacking" | "codeRefactor" | "bugHunter" | "devOpsEngineering" | "databaseArchitecture" | "apiDesign" | "cloudArchitecture" | "dataScience" | "automationEngineering" | "promptEngineering" | "brandStrategy" | "codeqlSpecialist" | "copilotOptimizer" | "legacyModernizer" | "repoManagementExpert";
type AgentFn = (text: string, lang?: string, isPrivate?: boolean, signal?: AbortSignal) => Promise<string>;
export declare const specializedAgentsService: { [K in AgentId]: AgentFn; };
export {};
