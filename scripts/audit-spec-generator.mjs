#!/usr/bin/env node
/**
 * scripts/audit-spec-generator.mjs — Spec Generator Agent
 *
 * Converts a PRD (Product Requirements Document) into an executable spec
 * with tasks, acceptance criteria, dependencies, and validation commands.
 *
 * This is the first stage of the Software Factory audit pipeline.
 *
 * Usage:
 *   node scripts/audit-spec-generator.mjs --prd <path> [--output <path>]
 *
 * Example:
 *   node scripts/audit-spec-generator.mjs --prd docs/audits/AUDIT-001-security.md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * Parse PRD markdown and extract requirements.
 */
function parsePRD(prdPath) {
  const content = readFileSync(prdPath, "utf8");

  // Extract metadata
  const idMatch = content.match(/^\*\*ID:\*\*\s*(.+)$/m);
  const statusMatch = content.match(/^\*\*Status:\*\*\s*(.+)$/m);
  const scopeMatch = content.match(/^\*\*Scope:\*\*\s*(.+)$/m);
  const createdMatch = content.match(/^\*\*Created:\*\*\s*(.+)$/m);

  const metadata = {
    id: idMatch ? idMatch[1].trim() : "UNKNOWN",
    status: statusMatch ? statusMatch[1].trim() : "Draft",
    scope: scopeMatch ? scopeMatch[1].trim() : "Unknown",
    created: createdMatch ? createdMatch[1].trim() : new Date().toISOString(),
  };

  // Extract sections
  const sections = {};
  const sectionRegex = /^##\s+(.+)$/gm;
  let match;
  const sectionPositions = [];

  while ((match = sectionRegex.exec(content)) !== null) {
    sectionPositions.push({
      title: match[1].trim(),
      start: match.index,
      end: sectionRegex.lastIndex,
    });
  }

  // Extract content for each section
  for (let i = 0; i < sectionPositions.length; i++) {
    const section = sectionPositions[i];
    const nextSection = sectionPositions[i + 1];
    const sectionContent = content.substring(
      section.end,
      nextSection ? nextSection.start : content.length,
    );
    sections[section.title] = sectionContent.trim();
  }

  // Extract requirements
  const requirements = extractRequirements(sections);

  // Extract acceptance criteria
  const acceptanceCriteria = extractAcceptanceCriteria(sections);

  // Extract constraints
  const constraints = extractConstraints(sections);

  return {
    metadata,
    sections,
    requirements,
    acceptanceCriteria,
    constraints,
    rawContent: content,
  };
}

/**
 * Extract R1-R4 requirements from PRD.
 */
function extractRequirements(sections) {
  const requirements = {};

  // Look for "## Requirements" section
  const reqSection = sections["Requirements"];
  if (!reqSection) return requirements;

  // Parse R1, R2, R3, R4 subsections
  const reqRegex = /^###\s+(R\d+):\s*(.+)$/gm;
  let match;
  const reqPositions = [];

  while ((match = reqRegex.exec(reqSection)) !== null) {
    reqPositions.push({
      id: match[1],
      title: match[2].trim(),
      start: match.index,
      end: reqRegex.lastIndex,
    });
  }

  for (let i = 0; i < reqPositions.length; i++) {
    const req = reqPositions[i];
    const nextReq = reqPositions[i + 1];
    const reqContent = reqSection.substring(
      req.end,
      nextReq ? nextReq.start : reqSection.length,
    );

    requirements[req.id] = {
      title: req.title,
      content: reqContent.trim(),
      items: extractChecklistItems(reqContent),
    };
  }

  return requirements;
}

/**
 * Extract acceptance criteria from PRD.
 */
function extractAcceptanceCriteria(sections) {
  const criteria = [];

  const accSection = sections["Acceptance Criteria"];
  if (!accSection) return criteria;

  // Extract checklist items
  const checklistRegex = /^-\s*\[\s*\]\s*(.+)$/gm;
  let match;

  while ((match = checklistRegex.exec(accSection)) !== null) {
    criteria.push({
      text: match[1].trim(),
      satisfied: false,
    });
  }

  return criteria;
}

/**
 * Extract constraints from PRD.
 */
function extractConstraints(sections) {
  const constraints = {
    time: null,
    resources: [],
    approvals: [],
  };

  const reqSection = sections["Requirements"];
  if (!reqSection) return constraints;

  // Look for R4: Constraints subsection
  const r4Match = reqSection.match(/###\s+R4:\s*Constraints([\s\S]*?)(?=###|$)/);
  if (!r4Match) return constraints;

  const r4Content = r4Match[1];

  // Extract time constraint
  const timeMatch = r4Content.match(/\*\*Time constraints:\*\*([\s\S]*?)(?=\*\*|$)/);
  if (timeMatch) {
    constraints.time = timeMatch[1].trim();
  }

  // Extract resource constraints
  const resourceMatches = r4Content.matchAll(/-\s*(.+)/g);
  for (const match of resourceMatches) {
    constraints.resources.push(match[1].trim());
  }

  return constraints;
}

/**
 * Extract checklist items from markdown content.
 */
function extractChecklistItems(content) {
  const items = [];
  const checklistRegex = /^-\s*\[\s*\]\s*(.+)$/gm;
  let match;

  while ((match = checklistRegex.exec(content)) !== null) {
    items.push({
      text: match[1].trim(),
      satisfied: false,
    });
  }

  return items;
}

/**
 * Map requirements to check scripts based on scope and content.
 */
function mapRequirementsToScripts(requirements, scope) {
  const scripts = [];
  // Only the IN-SCOPE checklist items count — "out of scope" mentions must
  // not pull a gate in. R1 content holds both lists, so cut it at the
  // out-of-scope marker before matching on explicit gate names.
  const r1Full = requirements.R1?.content ?? "";
  const r1 = r1Full.split(/out of scope/i)[0].toLowerCase();
  const wants = (name) => r1.includes(name);

  // Security scope
  if (wants("check:security") || scope.toLowerCase().includes("security")) {
    scripts.push({
      name: "check:security",
      description: "Security gates (open-core, pro-imports, env, workflows, CSP, CVE)",
      command: "npm run check:security > findings/security.log 2>&1",
      outputFile: "findings/security.log",
      phase: "security",
      timeout: 300000, // 5 minutes
    });
  }

  // Quality scope
  if (wants("check:quality") || scope.toLowerCase() === "quality") {
    scripts.push({
      name: "check:quality",
      description: "Quality gates (boundaries, e2e helpers, chunks, knip)",
      command: "npm run check:quality > findings/quality.log 2>&1",
      outputFile: "findings/quality.log",
      phase: "quality",
      timeout: 300000,
    });
  }

  // Content scope
  if (wants("check:content") || wants("i18n") || scope.toLowerCase() === "content") {
    scripts.push({
      name: "check:content",
      description: "Content gates (i18n, docs, SEO, claims, audit drift)",
      command: "npm run check:content > findings/content.log 2>&1",
      outputFile: "findings/content.log",
      phase: "content",
      timeout: 300000,
    });
  }

  // Brand scope
  if (wants("check:brand") || scope.toLowerCase() === "brand") {
    scripts.push({
      name: "check:brand",
      description: "Brand gates (logo, static tokens, sitemap, nginx)",
      command: "npm run check:brand > findings/brand.log 2>&1",
      outputFile: "findings/brand.log",
      phase: "brand",
      timeout: 120000,
    });
  }

  // Build scope
  if (wants("build:ci") || wants("build") || scope.toLowerCase() === "build") {
    scripts.push({
      name: "build:ci",
      description: "Build with integrity checks",
      command: "npm run build:ci > findings/build.log 2>&1",
      outputFile: "findings/build.log",
      phase: "build",
      timeout: 600000, // 10 minutes
    });
  }

  // Typecheck and tests are opt-in via explicit names (or scope keywords)
  if (wants("typecheck") || scope.toLowerCase().includes("typecheck")) {
    scripts.push({
      name: "typecheck:prod",
      description: "TypeScript type checking",
      command: "npm run typecheck:prod > findings/typecheck.log 2>&1",
      outputFile: "findings/typecheck.log",
      phase: "typecheck",
      timeout: 300000,
    });
  }

  if (wants("test:fast") || wants("test") || scope.toLowerCase().includes("test")) {
    scripts.push({
      name: "test:fast",
      description: "Fast test suite",
      command: "npm run test:fast > findings/tests.log 2>&1",
      outputFile: "findings/tests.log",
      phase: "tests",
      timeout: 600000,
    });
  }

  // Dependency audit (network-dependent)
  if (requirements.R2?.content?.toLowerCase().includes("dependency") || requirements.R2?.content?.toLowerCase().includes("supply-chain")) {
    scripts.push({
      name: "npm-audit",
      description: "Dependency vulnerability scan",
      command: "npm audit --omit=dev --json > findings/npm-audit.json",
      outputFile: "findings/npm-audit.json",
      phase: "dependencies",
      timeout: 120000,
      networkRequired: true,
    });
  }

  return scripts;
}

/**
 * Generate tasks from scripts and requirements.
 */
function generateTasks(scripts, _requirements, _acceptanceCriteria) {
  const tasks = [];
  let taskId = 1;

  // Phase 1: Setup
  tasks.push({
    id: `T${taskId++}`,
    phase: "setup",
    title: "Create audit worktree",
    description: "Create isolated git worktree for audit execution",
    command: "git worktree add ../audit-[ID] [current-branch]",
    validation: "Worktree is isolated and clean",
    dependencies: [],
    estimatedDuration: "5 minutes",
  });

  tasks.push({
    id: `T${taskId++}`,
    phase: "setup",
    title: "Generate spec",
    description: "Generate executable spec from PRD",
    command: "node scripts/audit-spec-generator.mjs --prd [PRD_PATH]",
    validation: "spec.json created with all tasks",
    dependencies: [`T${taskId - 2}`],
    estimatedDuration: "10 seconds",
  });

  // Phase 2: Execute scripts
  const executionStartId = taskId;
  for (const script of scripts) {
    tasks.push({
      id: `T${taskId++}`,
      phase: script.phase,
      title: `Run ${script.name}`,
      description: script.description,
      command: script.command,
      validation: `Exit code 0 or findings extracted from ${script.outputFile}`,
      dependencies: [`T${executionStartId - 1}`], // Depends on setup
      estimatedDuration: script.timeout ? `${Math.ceil(script.timeout / 60000)} minutes` : "Unknown",
      timeout: script.timeout,
      networkRequired: script.networkRequired || false,
      // A failing gate is a FINDING, not a pipeline error — the analyzer,
      // fixer and verifier stages must still run on the captured output.
      continueOnFailure: true,
    });
  }

  // Phase 3: Analyze findings (single pass: aggregate + classify + recommend)
  const analysisStartId = taskId;
  tasks.push({
    id: `T${taskId++}`,
    phase: "analysis",
    title: "Aggregate and classify findings",
    description: "Collect, deduplicate, severity-classify findings and generate recommendations",
    command: "node scripts/audit-findings-analyzer.mjs --input findings/ --output findings/aggregated.json --classify --recommend",
    validation: "All findings deduplicated, severity assigned, recommendations generated",
    dependencies: [`T${analysisStartId - 1}`],
    estimatedDuration: "1 minute",
  });

  // Phase 4: Generate fixes
  const fixesStartId = taskId;
  tasks.push({
    id: `T${taskId++}`,
    phase: "fixes",
    title: "Generate automated patches",
    description: "Create patches for findings that allow automated fixes",
    command: "node scripts/audit-fix-generator.mjs --input findings/aggregated.json --output patches/",
    validation: "All patches are minimal, reversible, documented",
    dependencies: [`T${fixesStartId - 1}`],
    estimatedDuration: "2 minutes",
  });

  tasks.push({
    id: `T${taskId++}`,
    phase: "fixes",
    title: "Review and approve patches",
    description: "Manual review of all generated patches",
    command: "Manual review of patches/ directory",
    validation: "No unintended changes, patches follow conventions",
    dependencies: [`T${fixesStartId}`],
    estimatedDuration: "Variable (human review)",
  });

  tasks.push({
    id: `T${taskId++}`,
    phase: "fixes",
    title: "Apply approved patches",
    description: "Apply patches to the worktree",
    command: "node scripts/audit-fix-generator.mjs --apply --input findings/aggregated.json --output patches/",
    validation: "All patches applied, git diff shows expected changes",
    dependencies: [`T${fixesStartId + 1}`],
    estimatedDuration: "1 minute",
  });

  // Phase 5: Verify fixes — re-run the exact checks this audit selected,
  // writing to findings/verify-*.log so the original output is preserved.
  const verifyStartId = taskId;
  for (const script of scripts) {
    const verifyCommand = script.command.replace(
      />\s*findings\//,
      "> findings/verify-",
    );
    tasks.push({
      id: `T${taskId++}`,
      phase: "verification",
      title: `Re-run ${script.name} after fixes`,
      description: `Re-run ${script.name} to confirm fixes hold`,
      command: verifyCommand,
      validation: "Gate passes with the patches applied",
      dependencies: [`T${verifyStartId - 1}`],
      estimatedDuration: script.timeout ? `${Math.ceil(script.timeout / 60000)} minutes` : "5 minutes",
      timeout: script.timeout,
      networkRequired: script.networkRequired || false,
      // A failed re-verification is a finding for the acceptance stage,
      // not a reason to skip it — the evaluator must see the final state.
      continueOnFailure: true,
    });
  }

  // Phase 6: Acceptance and ship
  const acceptStartId = taskId;
  tasks.push({
    id: `T${taskId++}`,
    phase: "acceptance",
    title: "Run acceptance evaluator",
    description: "Verify all acceptance criteria from PRD are satisfied",
    command: "node scripts/audit-acceptance-evaluator.mjs --prd [PRD_PATH] --input findings/aggregated.json --output reports/acceptance-evaluation.json",
    validation: "100% of acceptance criteria satisfied",
    dependencies: [`T${acceptStartId - 1}`],
    estimatedDuration: "30 seconds",
  });

  tasks.push({
    id: `T${taskId++}`,
    phase: "acceptance",
    title: "Update audit documentation",
    description: "Update docs/audit.md and audit-specific docs with findings",
    command: "Manual update of docs/audit.md and docs/audits/AUDIT-NNN-[slug].md",
    validation: "Documentation reflects current state",
    dependencies: [`T${acceptStartId}`],
    estimatedDuration: "Variable",
  });

  tasks.push({
    id: `T${taskId++}`,
    phase: "acceptance",
    title: "Create ADR for this audit",
    description: "Document the audit decision in an ADR",
    command: "Manual: create docs/ADR-XXX-audit-[slug].md following the ADR template",
    validation: "ADR follows template and is linked from audit.md",
    dependencies: [`T${acceptStartId + 1}`],
    estimatedDuration: "15 minutes",
  });

  tasks.push({
    id: `T${taskId++}`,
    phase: "ship",
    title: "Ship decision",
    description: "Decide how to integrate the audit results (direct merge, PR, or park)",
    command: "node scripts/audit-ship.mjs --mode [direct-merge|pr|park]",
    validation: "Work is integrated or parked with clear handoff",
    dependencies: [`T${acceptStartId + 2}`],
    estimatedDuration: "Variable",
  });

  return tasks;
}

/**
 * Generate the executable spec.
 */
function generateSpec(prdPath, outputPath) {
  console.log(`[audit-spec-generator] Parsing PRD: ${prdPath}`);

  const prd = parsePRD(prdPath);
  console.log(`[audit-spec-generator] PRD ID: ${prd.metadata.id}`);
  console.log(`[audit-spec-generator] Scope: ${prd.metadata.scope}`);
  console.log(`[audit-spec-generator] Requirements: ${Object.keys(prd.requirements).join(", ")}`);
  console.log(`[audit-spec-generator] Acceptance criteria: ${prd.acceptanceCriteria.length}`);

  // Map requirements to scripts
  const scripts = mapRequirementsToScripts(prd.requirements, prd.metadata.scope);
  console.log(`[audit-spec-generator] Check scripts: ${scripts.length}`);

  // Generate tasks
  const tasks = generateTasks(scripts, prd.requirements, prd.acceptanceCriteria);
  console.log(`[audit-spec-generator] Tasks generated: ${tasks.length}`);

  // Build spec object
  const spec = {
    metadata: {
      ...prd.metadata,
      specGeneratedAt: new Date().toISOString(),
      specGeneratorVersion: "1.0.0",
    },
    prd: {
      path: prdPath,
      requirements: prd.requirements,
      acceptanceCriteria: prd.acceptanceCriteria,
      constraints: prd.constraints,
    },
    scripts,
    tasks,
    phases: {
      setup: tasks.filter((t) => t.phase === "setup"),
      execution: tasks.filter((t) => scripts.some((s) => s.phase === t.phase)),
      analysis: tasks.filter((t) => t.phase === "analysis"),
      fixes: tasks.filter((t) => t.phase === "fixes"),
      verification: tasks.filter((t) => t.phase === "verification"),
      acceptance: tasks.filter((t) => t.phase === "acceptance"),
      ship: tasks.filter((t) => t.phase === "ship"),
    },
    estimatedDuration: estimateTotalDuration(tasks),
    networkRequired: scripts.some((s) => s.networkRequired),
  };

  // Write output
  const outputDir = outputPath ? dirname(outputPath) : join(ROOT, "docs", "audits", prd.metadata.id);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputFile = outputPath || join(outputDir, "spec.json");
  writeFileSync(outputFile, JSON.stringify(spec, null, 2));

  console.log(`[audit-spec-generator] Spec written to: ${outputFile}`);
  console.log(`[audit-spec-generator] Estimated duration: ${spec.estimatedDuration}`);
  console.log(`[audit-spec-generator] Network required: ${spec.networkRequired}`);

  return spec;
}

/**
 * Estimate total duration from tasks.
 */
function estimateTotalDuration(tasks) {
  let totalMinutes = 0;

  for (const task of tasks) {
    const duration = task.estimatedDuration;
    if (duration.includes("minutes")) {
      const minutes = parseInt(duration);
      totalMinutes += minutes;
    } else if (duration.includes("seconds")) {
      const seconds = parseInt(duration);
      totalMinutes += seconds / 60;
    } else if (duration.includes("hours")) {
      const hours = parseInt(duration);
      totalMinutes += hours * 60;
    } else if (duration.includes("Variable")) {
      // Human tasks - assume 30 minutes average
      totalMinutes += 30;
    }
  }

  // Round to nearest hour
  const hours = Math.ceil(totalMinutes / 60);
  return `${hours} hour${hours !== 1 ? "s" : ""}`;
}

/**
 * Main CLI entry point.
 */
function main() {
  const args = process.argv.slice(2);
  const prdIndex = args.indexOf("--prd");
  const outputIndex = args.indexOf("--output");

  if (prdIndex === -1 || !args[prdIndex + 1]) {
    console.error("Usage: node scripts/audit-spec-generator.mjs --prd <path> [--output <path>]");
    process.exit(1);
  }

  const prdPath = args[prdIndex + 1];
  const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : null;

  if (!existsSync(prdPath)) {
    console.error(`[audit-spec-generator] PRD not found: ${prdPath}`);
    process.exit(1);
  }

  try {
    generateSpec(prdPath, outputPath);
    console.log("[audit-spec-generator] Spec generation complete");
  } catch (error) {
    console.error(`[audit-spec-generator] Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

export { parsePRD, generateSpec, mapRequirementsToScripts };
