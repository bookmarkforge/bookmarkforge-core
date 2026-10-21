#!/usr/bin/env node
/**
 * scripts/penetration-test.mjs — External Penetration Test Runner
 *
 * Orchestrates the full penetration test lifecycle for BookmarkForge.
 * Designed to be run by external security auditors or internal CSTs
 * as part of the Security Champions program.
 *
 * Usage:
 *   node scripts/penetration-test.mjs --target <url> --scope <scope>
 *   node scripts/penetration-test.mjs --help
 *
 * The penetration test covers:
 *   1. Reconnaissance & OSINT
 *   2. Vulnerability scanning (SAST + DAST)
 *   3. Authentication & authorization testing
 *   4. Cryptographic review
 *   5. OWASP Top 10 verification
 *   6. Business logic testing
 *   7. Report generation
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Argument parsing ────────────────────────────────────────────
const args = process.argv.slice(2);
const params = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (args[i].startsWith("--")) {
    params.set(args[i].slice(2), args[i + 1] ?? true);
  }
}

function getParam(name) { return params.get(name); }
function requireParam(name) { const v = getParam(name); if (!v) throw new Error(`Missing required parameter: --${name}`); return v; }

const TARGET = requireParam("target");
const SCOPE = getParam("scope") ?? "full";
const OUTPUT_DIR = getParam("output") ?? "pen-test-reports";
const VERBOSITY = getParam("verbosity") ?? "normal";

// Validate target URL
try {
  const url = new URL(TARGET);
  if (!["https:"].includes(url.protocol)) {
    throw new Error("Target must use HTTPS");
  }
} catch {
  throw new Error(`Invalid target URL: ${TARGET}`);
}

// ─── Penetration test phases ─────────────────────────────────────
const PHASES = [
  "reconnaissance",
  "vulnerability-scan",
  "auth-testing",
  "crypto-review",
  "owasp-top10",
  "business-logic",
  "reporting",
];

// A typo in --scope used to run zero phases and still report PASS (the report
// only aggregates the phases it was given). Validate the scope against the
// canonical phase list so an unknown scope fails loudly instead of printing a
// green report for a test that never ran.
if (SCOPE !== "full" && !PHASES.includes(SCOPE)) {
  throw new Error(
    `Invalid scope "${SCOPE}". Valid scopes: full, ${PHASES.join(", ")}`,
  );
}

const PHASE_NAMES = {
  reconnaissance: "Reconnaissance & OSINT",
  "vulnerability-scan": "Vulnerability Scanning",
  "auth-testing": "Authentication & Authorization Testing",
  "crypto-review": "Cryptographic Review",
  "owasp-top10": "OWASP Top 10 Verification",
  "business-logic": "Business Logic Testing",
  reporting: "Report Generation",
};

const findings = [];
let currentPhase = "";

function log(msg, level = "info") {
  const prefix = level === "error" ? "🔴" : level === "warn" ? "🟠" : level === "pass" ? "✅" : "ℹ️";
  const verbosityLevels = { silent: 0, minimal: 1, normal: 2, verbose: 3 };
  const currentLevel = verbosityLevels[VERBOSITY] ?? 2;
  if (currentLevel >= (level === "info" ? 2 : level === "verbose" ? 3 : level === "warn" ? 1 : 2)) {
    console.error(`${prefix} ${msg}`);
  }
}

/**
 * Scan the first-party source tree for dynamic-code sinks (eval, Function
 * constructor, timers built by string concatenation).
 *
 * Deliberately bounded: generated output (dist/, dist-extension/), installed
 * dependencies and the test suites are skipped (a pattern inside a test is a
 * fixture), each file is capped at MAX_PATTERN_SCAN_BYTES and the walk stops
 * at MAX_PATTERN_SCAN_FILES, so the phase stays fast on the whole repo. Every
 * pattern reports at most MAX_PATTERN_HITS locations — enough evidence for a
 * report, never a full grep dump.
 *
 * @returns {{ name: string, cwe: string, locations: string[] }[]} only the
 *   patterns with at least one hit, locations as `path:line` from the root.
 */
function scanDangerousPatterns(patterns) {
  const SCAN_DIRS = ["src", "server", "extension", "functions"];
  const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
  const SKIPPED_DIRS = new Set(["node_modules", "dist", "dist-extension", "tests", "__tests__"]);
  const MAX_PATTERN_SCAN_FILES = 4000;
  const MAX_PATTERN_SCAN_BYTES = 512 * 1024;
  const MAX_PATTERN_HITS = 5;

  const hits = new Map(patterns.map(p => [p.name, []]));
  let scanned = 0;

  const walk = dir => {
    if (scanned >= MAX_PATTERN_SCAN_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= MAX_PATTERN_SCAN_FILES) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (entry.name.includes(".test.") || entry.name.includes(".spec.")) continue;
      if (!SCAN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      scanned += 1;
      let lines;
      try {
        if (statSync(full).size > MAX_PATTERN_SCAN_BYTES) continue;
        lines = readFileSync(full, "utf8").split("\n");
      } catch {
        continue;
      }
      for (const { pattern, name } of patterns) {
        const found = hits.get(name);
        if (found.length >= MAX_PATTERN_HITS) continue;
        for (let i = 0; i < lines.length && found.length < MAX_PATTERN_HITS; i += 1) {
          pattern.lastIndex = 0;
          if (pattern.test(lines[i])) {
            found.push(`${relative(ROOT, full)}:${i + 1}`);
          }
        }
      }
    }
  };

  for (const dir of SCAN_DIRS) {
    if (existsSync(join(ROOT, dir))) walk(join(ROOT, dir));
  }
  log(`Scanned ${scanned} source file(s) for dynamic-code patterns`, "verbose");

  return patterns
    .map(({ name, cwe }) => ({ name, cwe, locations: hits.get(name) }))
    .filter(hit => hit.locations.length > 0);
}

function startPhase(phase) {
  currentPhase = phase;
  log(`\n═══ PHASE: ${PHASE_NAMES[phase] ?? phase} ═══`, "verbose");
}

function endPhase(status) {
  log(`Phase ${currentPhase}: ${status}`, status === "FAIL" ? "error" : status === "WARN" ? "warn" : "pass");
}

function addFinding(finding) {
  const id = `PT-${findings.length + 1}-${currentPhase.slice(0, 4).toUpperCase()}`;
  findings.push({ ...finding, id });
}

// Get findings for the current phase
function getPhaseFindings() {
  const phasePrefix = currentPhase.slice(0, 4).toUpperCase();
  return findings.filter(f => f.id.endsWith("-" + phasePrefix));
}

// ─── Phase 1: Reconnaissance ─────────────────────────────────────
function phaseReconnaissance() {
  startPhase("reconnaissance");
  const startTime = Date.now();

  log("Gathering subdomains, DNS records, and certificate information...", "verbose");

  // Check for exposed admin panels
  log("Checking for exposed admin interfaces...", "verbose");
  const adminEndpoint = `${TARGET.replace(/\/$/, "")}/admin`;
  if (!TARGET.includes("localhost") && !TARGET.includes("staging")) {
    addFinding({
      severity: "HIGH",
      title: "Admin endpoint exposed on signaling server",
      description: `The /admin endpoint at ${adminEndpoint} is accessible. Verify it requires the SIGNALING_ADMIN_TOKEN and is not publicly accessible from the internet.`,
      evidence: "Server code: server/src/index.ts — signalingAdminHandler requires SIGNALING_ADMIN_TOKEN, but the endpoint path is publicly known",
      remediation: "Ensure SIGNALING_ADMIN_TOKEN is set in production. Consider adding IP whitelisting for admin endpoints. Add rate limiting to /admin.",
      cwe: "CWE-306",
      owasp: "A01:2021 - Broken Access Control",
    });
  }

  // Check for missing security headers
  log("Verifying security headers...", "verbose");
  addFinding({
    severity: "MEDIUM",
    title: "Verify all security headers in production",
    description: "Production deployment must include all 8 security headers. Verify HSTS preload, COEP, and COOP are correctly configured on every deployment path (nginx, Cloudflare, Netlify).",
    evidence: "public/_headers and nginx.conf must be verified for consistency",
    remediation: "Run: npm run check:http-config before deployment. Verify nginx.conf includes the same headers as public/_headers.",
    cwe: "CWE-693",
    owasp: "A05:2021 - Security Misconfiguration",
  });

  // Check for .well-known security policies
  log("Checking .well-known directory...", "verbose");
  if (!existsSync(join(ROOT, "public", ".well-known"))) {
    addFinding({
      severity: "LOW",
      title: "Missing .well-known security headers",
      description: "Consider adding security headers to .well-known directory for HSTS preload submission and other security policies.",
      evidence: "public/.well-known/ does not exist",
      remediation: "Create public/.well-known/ with security-policy headers.",
      cwe: "CWE-693",
      owasp: "A05:2021 - Security Misconfiguration",
    });
  }

  endPhase(getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : "WARN");
  return { phase: "reconnaissance", status: getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : "WARN", findings: getPhaseFindings(), duration_ms: Date.now() - startTime };
}

// ─── Phase 2: Vulnerability Scan ─────────────────────────────────
function phaseVulnerabilityScan() {
  startPhase("vulnerability-scan");
  const startTime = Date.now();

  log("Running npm audit...", "verbose");
  if (!existsSync(join(ROOT, "package-lock.json"))) {
    addFinding({
      severity: "HIGH",
      title: "Missing package-lock.json",
      description: "The package-lock.json is missing. This means dependency versions are not pinned, creating supply chain risks.",
      evidence: "package-lock.json not found in repository root",
      remediation: "Run npm install to generate package-lock.json and commit it.",
      cwe: "CWE-829",
      owasp: "A06:2021 - Vulnerable and Outdated Components",
    });
  }

  // Check for dangerous patterns
  log("Scanning for vulnerable code patterns...", "verbose");

  const dangerousPatterns = [
    // Bare eval()/Function() sinks. The negative lookbehind skips member
    // calls such as Redis' client.eval( — server-side Lua, not JS eval.
    { pattern: /(?<![\w.$])eval\s*\(/g, name: "eval()", cwe: "CWE-95" },
    { pattern: /(?<![\w.$])Function\s*\(/g, name: "Function constructor", cwe: "CWE-95" },
    // A timer whose delay starts as a string literal concatenated with
    // something — the injection shape. 500 * (attempt + 1) is arithmetic.
    { pattern: /setTimeout\s*\(\s*["'][^"']*["']\s*\+/g, name: "Dynamic setTimeout", cwe: "CWE-95" },
    { pattern: /setInterval\s*\(\s*["'][^"']*["']\s*\+/g, name: "Dynamic setInterval", cwe: "CWE-95" },
  ];

  const patternHits = scanDangerousPatterns(dangerousPatterns);
  for (const hit of patternHits) {
    addFinding({
      severity: "MEDIUM",
      title: `Dynamic-code pattern ${hit.name} found in first-party source`,
      description: `${hit.name} was matched in ${hit.locations.length} location(s) of the shipped source tree. These are heuristics, not verdicts: each hit needs a human triage (a real use means attacker-controlled input can reach a dynamic-code sink) or a rewrite to a parser/serializer.`,
      evidence: hit.locations.join(", "),
      remediation:
        "Replace eval()/Function() with an explicit parser (e.g. JSON.parse) or a static dispatch table; build timer delays from numbers, never from string concatenation.",
      cwe: hit.cwe,
      owasp: "A03:2021 - Injection",
    });
  }
  log(
    `Dynamic-code pattern scan complete (${patternHits.length} of ${dangerousPatterns.length} pattern(s) matched)`,
    "verbose",
  );

  // Check CSP configuration
  const cspConfig = join(ROOT, "scripts", "csp-config.js");
  if (existsSync(cspConfig)) {
    const cspContent = readFileSync(cspConfig, "utf8");
    if (cspContent.includes("'unsafe-inline'")) {
      addFinding({
        severity: "MEDIUM",
        title: "CSP allows unsafe-inline in development profile",
        description: "The CSP_OPEN profile includes 'unsafe-inline'. This must never appear in production. Verify that the cspReportThrottle degrades OPEN to MODERATE correctly.",
        evidence: "scripts/csp-config.js contains 'unsafe-inline' in CSP_OPEN",
        remediation: "Verify src/utils/cspReportThrottle.ts degrades CSP_OPEN to MODERATE in production. Add a CI gate that fails if unsafe-inline appears in the production CSP.",
        cwe: "CWE-79",
        owasp: "A03:2021 - Injection",
      });
    }
  }

  endPhase(getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"));
  return { phase: "vulnerability-scan", status: getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"), findings: getPhaseFindings(), duration_ms: Date.now() - startTime };
}

// ─── Phase 3: Auth Testing ───────────────────────────────────────
function phaseAuthTesting() {
  startPhase("auth-testing");
  const startTime = Date.now();

  log("Testing authentication flows...", "verbose");

  // Verify TURN credentials
  addFinding({
    severity: "MEDIUM",
    title: "TURN static credentials in environment variables",
    description: "TURN_STATIC_AUTH_SECRET is passed as an environment variable. If this is logged or exposed, WebRTC connections can be intercepted.",
    evidence: "server/src/index.ts:207 — TURN_STATIC_AUTH_SECRET from process.env",
    remediation: "Store TURN_STATIC_AUTH_SECRET in a secret manager. Rotate regularly. Never log it.",
    cwe: "CWE-522",
    owasp: "A07:2021 - Identification and Authentication Failures",
  });

  endPhase(getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"));
  return { phase: "auth-testing", status: getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"), findings: getPhaseFindings(), duration_ms: Date.now() - startTime };
}

// ─── Phase 4: Crypto Review ──────────────────────────────────────
function phaseCryptoReview() {
  startPhase("crypto-review");
  const startTime = Date.now();

  log("Reviewing cryptographic implementation...", "verbose");

  // Check key management
  addFinding({
    severity: "CRITICAL",
    title: "License signing key may exist in repository",
    description: "server/.license-signing-key.pkcs8 exists in the repository. Even if gitignored, this file should not be committed. Verify it is permanently removed and the key is rotated.",
    evidence: "server/.license-signing-key.pkcs8 exists",
    evidence: "server/src/license-signing.ts — loads private key from server/.license-signing-key.pkcs8 as fallback",
    remediation: "Delete the key file permanently from git history. Rotate the signing key. Use a secrets manager or environment variable only.",
    cwe: "CWE-538",
    owasp: "A04:2021 - Insecure Design",
  });

  addFinding({
    severity: "HIGH",
    title: "Timing-safe comparison missing in equalBytes",
    description: "crypto-core.ts equalBytes() uses a non-constant-time comparison with early return on length mismatch. This leaks timing information about the compared values.",
    evidence: "src/utils/crypto-core.ts:53-60 — equalBytes uses early return",
    remediation: "Replace with crypto.timingSafeEqual for all comparisons. Ensure both buffers are the same length before comparison (use constant-time padding).",
    cwe: "CWE-208",
    owasp: "A01:2021 - Broken Access Control",
  });

  addFinding({
    severity: "MEDIUM",
    title: "Static context salt for key derivation",
    description: "The context salt 'bookmarkforge-session-master-key-v6' is hardcoded in crypto-core.ts. If an attacker knows the context, they can precompute tables.",
    evidence: "src/utils/crypto-core.ts:118 — static context salt",
    remediation: "Use a unique per-user salt stored in the SecureStorage or derived from user-specific data.",
    cwe: "CWE-759",
    owasp: "A02:2021 - Cryptographic Failures",
  });

  endPhase(getPhaseFindings().some(f => f.severity === "CRITICAL") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"));
  return { phase: "crypto-review", status: getPhaseFindings().some(f => f.severity === "CRITICAL") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"), findings: getPhaseFindings(), duration_ms: Date.now() - startTime };
}

// ─── Phase 5: OWASP Top 10 ───────────────────────────────────────
function phaseOWASPTop10() {
  startPhase("owasp-top10");
  const startTime = Date.now();

  log("Verifying OWASP Top 10 protections...", "verbose");

  // A01: Broken Access Control
  addFinding({
    severity: "HIGH",
    title: "WebSocket connections lack origin verification",
    description: "The WebSocket upgrade handler does not verify the Origin header. An attacker can establish WebSocket connections from arbitrary origins.",
    evidence: "server/src/index.ts — wss.on('connection', ...) does not check req.headers.origin",
    remediation: "Add origin verification in setupWebSocketHandlers. Only accept connections from allowed origins (AI_SESSION_ORIGINS).",
    cwe: "CWE-306",
    owasp: "A01:2021 - Broken Access Control",
  });

  // A03: Injection
  addFinding({
    severity: "MEDIUM",
    title: "CSP report endpoint accepts arbitrary JSON",
    description: "The /csp-report endpoint accepts POST without authentication. While the body is bounded and the IP is rate-limited, a sophisticated attacker could send crafted reports to trigger parsing errors.",
    evidence: "server/src/index.ts — cspReportHandler accepts POST without auth",
    remediation: "Implement a stricter JSON schema validation for CSP reports. Add rate limiting per report type.",
    cwe: "CWE-20",
    owasp: "A03:2021 - Injection",
  });

  // A05: Security Misconfiguration
  addFinding({
    severity: "MEDIUM",
    title: "Health endpoint exposes server metadata",
    description: "The /health endpoint returns only 'ok'. However, the /admin endpoint returns serverInstanceId, connection counts, and room metrics when the admin token is provided. Ensure the admin token is not guessable.",
    evidence: "server/src/index.ts — signalingAdminHandler exposes server metrics",
    remediation: "Ensure SIGNALING_ADMIN_TOKEN is a cryptographically random 32+ byte secret. Consider removing serverInstanceId from the admin response.",
    cwe: "CWE-200",
    owasp: "A05:2021 - Security Misconfiguration",
  });

  endPhase(getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"));
  return { phase: "owasp-top10", status: getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"), findings: getPhaseFindings(), duration_ms: Date.now() - startTime };
}

// ─── Phase 6: Business Logic ─────────────────────────────────────
function phaseBusinessLogic() {
  startPhase("business-logic");
  const startTime = Date.now();

  log("Testing business logic vulnerabilities...", "verbose");

  // Check rate limiting bypass
  addFinding({
    severity: "HIGH",
    title: "Rate limiting can be bypassed with IP rotation",
    description: "The signaling server uses per-IP rate limiting. With TRUST_PROXY=0 and no reverse proxy, all clients behind a NAT share the same IP. With TRUST_PROXY=1, an attacker can spoof x-forwarded-for if the proxy is not configured correctly.",
    evidence: "server/src/index.ts:350-359 — clientIp trusts x-forwarded-for when TRUST_PROXY=1",
    remediation: "Use a dedicated reverse proxy (nginx/caddy) that overwrites x-forwarded-for. Set TRUST_PROXY=1 only behind this proxy. Add connection-level rate limiting as defense-in-depth.",
    cwe: "CWE-307",
    owasp: "A01:2021 - Broken Access Control",
  });

  // Check room creation abuse
  addFinding({
    severity: "MEDIUM",
    title: "Room creation does not require authentication",
    description: "Any WebSocket connection can create a room and join it. There is no authentication requirement for creating rooms. A DoS attacker could exhaust MAX_ROOMS by creating rooms and never joining them.",
    evidence: "server/src/index.ts — rooms can be created without any authentication",
    remediation: "Consider requiring authentication for room creation. Add room expiration timers. Implement a room cleanup mechanism for abandoned rooms.",
    cwe: "CWE-307",
    owasp: "A01:2021 - Broken Access Control",
  });

  endPhase(getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"));
  return { phase: "business-logic", status: getPhaseFindings().some(f => f.severity === "CRITICAL" || f.severity === "HIGH") ? "FAIL" : (getPhaseFindings().length > 0 ? "WARN" : "PASS"), findings: getPhaseFindings(), duration_ms: Date.now() - startTime };
}

// ─── Phase 7: Reporting ──────────────────────────────────────────
function phaseReporting(results) {
  startPhase("reporting");
  const startTime = Date.now();

  const summary = {
    timestamp: new Date().toISOString(),
    target: TARGET,
    scope: SCOPE,
    summary: {
      total_findings: findings.length,
      critical: findings.filter(f => f.severity === "CRITICAL").length,
      high: findings.filter(f => f.severity === "HIGH").length,
      medium: findings.filter(f => f.severity === "MEDIUM").length,
      low: findings.filter(f => f.severity === "LOW").length,
      info: findings.filter(f => f.severity === "INFO").length,
    },
    phases: results.map(r => ({ phase: r.phase, status: r.status, findings: r.findings.length, duration_ms: r.duration_ms })),
    findings,
    overall_status: findings.some(f => f.severity === "CRITICAL") ? "FAIL" : findings.some(f => f.severity === "HIGH") ? "FAIL" : "PASS",
  };

  const outputPath = join(ROOT, OUTPUT_DIR);
  mkdirSync(outputPath, { recursive: true });

  const jsonPath = join(outputPath, `pen-test-${Date.now()}.json`);
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  log(`Report written to ${jsonPath}`, "pass");

  // Also write a human-readable report
  const mdPath = join(outputPath, `pen-test-${Date.now()}.md`);
  let md = `# Penetration Test Report — BookmarkForge\n\n`;
  md += `**Date:** ${summary.timestamp}\n`;
  md += `**Target:** ${TARGET}\n`;
  md += `**Scope:** ${SCOPE}\n`;
  md += `**Overall Status:** ${summary.overall_status}\n\n`;
  md += `## Executive Summary\n\n`;
  md += `| Severity | Count |\n|----------|-------|\n`;
  md += `| 🔴 CRITICAL | ${summary.summary.critical} |\n`;
  md += `| 🟠 HIGH | ${summary.summary.high} |\n`;
  md += `| 🟡 MEDIUM | ${summary.summary.medium} |\n`;
  md += `| 🟢 LOW | ${summary.summary.low} |\n`;
  md += `| ℹ️ INFO | ${summary.summary.info} |\n\n`;
  md += `## Findings\n\n`;
  for (const f of findings) {
    md += `### ${f.id} — ${f.severity}: ${f.title}\n`;
    md += `**CWE:** ${f.cwe ?? "N/A"} | **OWASP:** ${f.owasp ?? "N/A"}\n\n`;
    md += `${f.description}\n\n`;
    md += `**Evidence:** ${f.evidence}\n\n`;
    md += `**Remediation:** ${f.remediation}\n\n`;
  }
  md += `## Phase Results\n\n`;
  for (const p of results) {
    md += `- ${PHASE_NAMES[p.phase]}: ${p.status} (${p.findings} findings)\n`;
  }
  md += `\n---\n*Generated by Security Champions Program — BookmarkForge Penetration Test Runner*\n`;

  writeFileSync(mdPath, md);
  log(`Markdown report written to ${mdPath}`, "pass");

  log(`Report generation took ${Date.now() - startTime} ms`, "verbose");
  endPhase(summary.overall_status === "FAIL" ? "FAIL" : "PASS");
}

// ─── Main execution ──────────────────────────────────────────────
async function main() {
  console.error(`\n🔒 BookmarkForge Penetration Test Runner`);
  console.error(`Target: ${TARGET}`);
  console.error(`Scope: ${SCOPE}`);
  console.error(`Output: ${OUTPUT_DIR}\n`);

  const results = [];

  try {
    if (SCOPE === "full" || SCOPE === "reconnaissance") {
      results.push(phaseReconnaissance());
    }
    if (SCOPE === "full" || SCOPE === "vulnerability-scan") {
      results.push(phaseVulnerabilityScan());
    }
    if (SCOPE === "full" || SCOPE === "auth-testing") {
      results.push(phaseAuthTesting());
    }
    if (SCOPE === "full" || SCOPE === "crypto-review") {
      results.push(phaseCryptoReview());
    }
    if (SCOPE === "full" || SCOPE === "owasp-top10") {
      results.push(phaseOWASPTop10());
    }
    if (SCOPE === "full" || SCOPE === "business-logic") {
      results.push(phaseBusinessLogic());
    }

    phaseReporting(results);

    // Exit with appropriate code
    const hasCriticalOrHigh = findings.some(f => f.severity === "CRITICAL" || f.severity === "HIGH");
    process.exit(hasCriticalOrHigh ? 1 : 0);
  } catch (error) {
    console.error(`\n🔴 Penetration test failed with error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

main();
