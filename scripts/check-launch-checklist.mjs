#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Progress gate for the pre-launch checklist (docs/launch-checklist.md).
//
// Verifies everything that can be checked from the repository and reports the
// rest as manual. Default mode is informational (exit 0). With --strict the
// gate exits 1 when any 🔴 blocking item is not completed, so it can be wired
// into CI as a release gate.
//
// Security Champions Program integration:
// - `check:security-internal` is a mandatory gate on every PR
// - Penetration tests are run monthly and before production launch
// - The security gates above run as steps inside the `Typecheck, lint, tests
// and security gates` job, which must pass before merge

const ROOT = process.cwd();
const read = (path) =>
  existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : null;
const has = (path) => existsSync(join(ROOT, path));
const readJson = (path) => {
  const text = read(path);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const REQUIRED_RULESET_CHECKS = [
  // Required-check contexts = JOB NAMES from ci.yml/sast.yml.
  // "Enforce mandatory security gates" was a STEP name inside the quality
  // job: such a context would never show up and would block every merge.
  // Those gates (check:security-internal, check:server-log-ip-privacy,
  // check:blindeo) run inside the quality job, already required here.
  "Typecheck, lint, tests and security gates",
  "Playwright E2E",
  "Production build and repository checks",
  "Dependency review",
  "CodeQL analysis",
  "Semgrep analysis",
];

const EXPORT_ONLY_FIELDS = ["id", "source", "source_type", "node_id", "_links", "created_at", "updated_at"];

export function verifyRuleset(parsed) {
  if (parsed == null || typeof parsed !== "object") return { ok: false, note: "ruleset missing or invalid JSON" };
  // The file is the direct payload of POST /repos/{owner}/{repo}/rulesets;
  // export fields (id, source, source_type…) do not belong in the creation body.
  const exportFields = EXPORT_ONLY_FIELDS.filter((field) => field in parsed);
  if (exportFields.length) {
    return { ok: false, note: `invalid export fields in the payload: ${exportFields.join(", ")}` };
  }
  const checks =
    parsed?.rules
      ?.find((rule) => rule.type === "required_status_checks")
      ?.parameters?.required_status_checks ?? [];
  const contexts = checks.map((check) => check.context);
  const missing = REQUIRED_RULESET_CHECKS.filter((context) => !contexts.includes(context));
  if (missing.length) {
    return { ok: false, note: `missing mandatory checks: ${missing.join(", ")}` };
  }
  return { ok: true, note: "mandatory checks present (import/activation in GitHub = manual)" };
}

export function verifySloRpoRto(text) {
  if (text == null) return { ok: false, note: "docs/operations.md does not exist" };
  const ok = ["RPO:", "RTO:", "SLOs", "99.9%"].every((needle) => text.includes(needle));
  return ok
    ? { ok: true, note: "baselines documented (quarterly official sign-off = manual)" }
    : { ok: false, note: "RPO/RTO/SLOs missing from docs/operations.md" };
}

export function verifySast(workflowText, gateExists) {
  const ok =
    gateExists &&
    workflowText != null &&
    workflowText.includes("CodeQL analysis") &&
    workflowText.includes("Semgrep analysis");
  return ok
    ? { ok: true, note: "sast.yml + scripts/check-sarif-severity.mjs present" }
    : { ok: false, note: "sast.yml or the severity gate missing" };
}

export function verifyErrorReporting(pkg, reporter) {
  if (!pkg?.dependencies?.["@sentry/browser"]) {
    return { ok: false, note: "@sentry/browser missing from dependencies" };
  }
  if (!reporter) return { ok: false, note: "src/telemetry/remoteErrorReporter.ts missing" };
  if (!reporter.includes("beforeSend")) {
    return { ok: false, note: "remoteErrorReporter without a scrubbing beforeSend" };
  }
  // ADR-030: consent lives in ConsentService. Accept either the legacy direct
  // key marker or a delegation to the purpose-scoped gate ("sentry").
  const hasConsentGate =
    reporter.includes("CONSENT_ERROR_REPORTING") ||
    /isPurposeConsented\s*\(\s*["']sentry["']\s*\)/.test(reporter);
  if (!hasConsentGate) {
    return { ok: false, note: "remoteErrorReporter without an opt-in consent gate" };
  }
  if (!reporter.includes("initRemoteErrorReporting") || !reporter.includes("sentry.init")) {
    return { ok: false, note: "remoteErrorReporter without conditional initialization" };
  }
  return { ok: true, note: "@sentry/browser + scrubbing beforeSend + opt-in (disabled by default)" };
}

export function verifyLoadTest(pkg, scriptExists, scriptText = "") {
  const scripts = JSON.stringify(pkg?.scripts ?? {});
  const hasScript = /(test:load|load:companion|load:server)/i.test(scripts);
  if (!hasScript || !scriptExists) {
    return { ok: false, note: "no companion-server load test (pending)" };
  }
  // The test must cover the surface that scales with users and pin measurable
  // budgets. AI-proxy coverage is no longer required: the server does not
  // proxy providers (the browser calls the user's provider directly), so
  // there is no generation endpoint to measure.
  const text = scriptText ?? "";
  const coversSignaling = /\bjoin\b/i.test(text) && /relay|signal/i.test(text);
  const hasBudgets = /p95|percentile/i.test(text) && /(BUDGETS|SLO)/i.test(text);
  const hasSaturation = /saturat/i.test(text);
  // The server must stay alive after the burst: that is the liveness budget.
  const hasLiveness = /\/health/i.test(text);
  const ok = coversSignaling && hasBudgets && hasSaturation && hasLiveness;
  return ok
    ? { ok: true, note: "load test (WS signaling + saturation) with budgets detected" }
    : { ok: false, note: "incomplete load test: signaling, budgets, saturation or liveness missing" };
}

export function verifyContracts(docs) {
  // Only a real spec header counts (e.g. "openapi: 3.1.0"). A mention like
  // "Sin Swagger/OpenAPI" in the audit must not be mistaken for a contract.
  const specHeader = /(?:^|\n)\s*(?:openapi|swagger)\s*:\s*["']?\d+\.\d+/i;
  const ok = (docs ?? []).some((text) => specHeader.test(text));
  return ok
    ? { ok: true, note: "OpenAPI/Swagger contracts detected" }
    : { ok: false, note: "no versioned contracts (pending)" };
}

export function verifyDrill(pkg, drillExists) {
  const ok = drillExists && Boolean(pkg?.scripts?.["drill:backup-restore"]);
  return ok
    ? { ok: true, note: "monthly drill present (quarterly simulation = manual)" }
    : { ok: false, note: "restore drill missing" };
}

export function verifyExtensions(manifestsExist) {
  return manifestsExist
    ? { ok: true, note: "manifests present (store publishing = manual)" }
    : { ok: false, note: "extension manifests missing" };
}

export function verifyEnvGates(pkg) {
  const gates = ["check:http-config", "check:compose-config", "check:runtime-config", "check:docker-context"];
  const missing = gates.filter((gate) => !pkg?.scripts?.[gate]);
  return missing.length === 0
    ? { ok: true, note: "configuration gates present (deployment inspection = manual)" }
    : { ok: false, note: `missing gates: ${missing.join(", ")}` };
}

export function verifyDastDisabled(text) {
  if (text == null) return { ok: false, note: "dast-nightly.yml no existe" };
  const disabled = text.includes("if: ${{ false }}");
  const digestPending = text.includes("REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST");
  if (!disabled) return { ok: false, note: "the authenticated steps are NOT disabled" };
  return {
    ok: true,
    note: digestPending
      ? "safely disabled (ZAP image digest and image pending verification; activation = manual)"
      : "safely disabled (activation = manual)",
  };
}

export function verifyProdConfig(text) {
  if (text == null) return { ok: false, note: "docs/security.md does not exist" };
  // The tokens are the configuration the server ACTUALLY enforces in
  // production today. Only variables with runtime readers are checked;
  // retired flags from old subsystems are not included.
  const ok = ["NODE_ENV=production", "AI_SESSION_ORIGINS", "ENFORCE_SIGNAL_HMAC", "LICENSE_SIGNING_PRIVATE_KEY_FILE"].every(
    (needle) => text.includes(needle),
  );
  return ok
    ? { ok: true, note: "mandatory config documented (deployment verification = manual)" }
    : { ok: false, note: "mandatory config missing from docs/security.md" };
}

export function verifyPreflightScripts(pkg) {
  const scripts = [
    "typecheck:prod",
    "lint",
    "test",
    "build:ci",
    "check",
    "check:security-internal",
    "check:secrets-in-commit",
    "check:audit",
    // ADR-058: the release preflight must own the gate that refuses to prepare
    // a release against an unconfirmed repository target.
    "check:release-target",
  ];
  const missing = scripts.filter((script) => !pkg?.scripts?.[script]);
  return missing.length === 0
    ? { ok: true, note: "preflight complete in package.json" }
    : { ok: false, note: `missing scripts: ${missing.join(", ")}` };
}

export function verifyRopa(text) {
  if (text == null) return { ok: false, note: "docs/ROPA.md does not exist" };
  const pending = (text.match(/COMPLETAR/g) ?? []).length;
  return pending === 0
    ? { ok: true, note: "ROPA with no pending fields" }
    : { ok: false, note: `${pending} ⚠ COMPLETAR fields left in docs/ROPA.md` };
}

export function verifyZapFailLevels(text) {
  if (text == null) return { ok: false, note: ".zap/baseline.conf does not exist" };
  const levels = text.match(/^FAIL_LEVELS=(.*)$/m)?.[1] ?? "";
  const ok = levels.includes("High") && levels.includes("Critical");
  return ok ? { ok: true, note: `FAIL_LEVELS=${levels}` } : { ok: false, note: "FAIL_LEVELS without High+Critical" };
}

export function hasBlockerFailures(results) {
  return results.some((result) => result.section === "blocker" && result.ok === false);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const strict = process.argv.includes("--strict");
  const pkg = readJson("package.json");
  const docs = ["architecture.md", "api.md", "operations.md", "security.md", "audit.md", "openapi.yaml"]
    .map((file) => read(`docs/${file}`))
    .filter((text) => text != null);

  const items = [
    { id: 2, section: "blocker", title: "main protection: ruleset with mandatory checks", run: () => verifyRuleset(readJson(".github/rulesets/main-protection.json")) },
    { id: 3, section: "blocker", title: "RPO/RTO and SLOs documented", run: () => verifySloRpoRto(read("docs/operations.md")) },
    { id: 4, section: "blocker", title: "Owner and alerting channel", manual: true },
    { id: 5, section: "blocker", title: "GDPR legal closure", run: () => verifyRopa(read("docs/ROPA.md")) },
    { id: 6, section: "external", title: "Pentest", manual: true },
    { id: 7, section: "external", title: "Manual WCAG and privacy review", manual: true },
    { id: 8, section: "external", title: "Independent SAST (CodeQL + Semgrep) in CI", run: () => verifySast(read(".github/workflows/sast.yml"), has("scripts/check-sarif-severity.mjs")) },
    { id: 9, section: "p1", title: "Error reporting with PII scrubbing and opt-in", run: () => verifyErrorReporting(pkg, read("src/telemetry/remoteErrorReporter.ts")) },
    { id: 10, section: "p1", title: "Business analytics decision", manual: true },
    { id: 11, section: "p1", title: "Companion-server load test", run: () => verifyLoadTest(pkg, has("scripts/load-test-server.mjs"), read("scripts/load-test-server.mjs") ?? "") },
    { id: 12, section: "p1", title: "Versioned contracts with integrations", run: () => verifyContracts(docs) },
    { id: 13, section: "p1", title: "Quarterly disaster simulation (monthly drill)", run: () => verifyDrill(pkg, has("scripts/drill-backup-restore.mjs")) },
    { id: 14, section: "p1", title: "Extension publishing checklist", run: () => verifyExtensions(has("extension/manifest.json") && has("extension/manifest-firefox.json")) },
    { id: 15, section: "env", title: "Secrets, environments and deploy permissions", manual: true },
    { id: 16, section: "env", title: "Real staging and production security (gates)", run: () => verifyEnvGates(pkg) },
    { id: 17, section: "env", title: "Authenticated DAST safely disabled", run: () => verifyDastDisabled(read(".github/workflows/dast-nightly.yml")) },
    { id: 18, section: "env", title: "Mandatory production configuration documented", run: () => verifyProdConfig(read("docs/security.md")) },
  ];

  const gates = [
    { title: "Release preflight (scripts in package.json)", run: () => verifyPreflightScripts(pkg) },
    { title: "ZAP FAIL_LEVELS includes High + Critical", run: () => verifyZapFailLevels(read(".zap/baseline.conf")) },
  ];

  const evaluate = (item) => {
    if (item.manual) return { ok: null, note: "manual (not verifiable from the repo)" };
    try {
      return item.run() ?? { ok: false, note: "no result" };
    } catch (error) {
      return { ok: false, note: `error: ${error.message}` };
    }
  };

  const results = items.map((item) => ({ id: item.id, section: item.section, title: item.title, ...evaluate(item) }));
  const gateResults = gates.map((gate) => ({ title: gate.title, ...evaluate(gate) }));

  const sections = [
    ["blocker", "🔴 Blocker (P0)"],
    ["external", "🟠 External validation"],
    ["p1", "🟡 First quarter"],
    ["env", "🟢 Environment verification"],
  ];
  console.log("[check-launch-checklist] Pre-launch progress report");
  for (const [section, header] of sections) {
    console.log(`\n${header}`);
    for (const result of results.filter((r) => r.section === section)) {
      const status = result.ok === null ? "MANUAL" : result.ok ? "PASS  " : "FAIL  ";
      console.log(`  [${status}] ${result.id}. ${result.title} — ${result.note}`);
    }
  }
  console.log("\nGates");
  for (const result of gateResults) {
    console.log(`  [${result.ok ? "PASS  " : "FAIL  "}] ${result.title} — ${result.note}`);
  }
  const verified = results.filter((r) => r.ok !== null);
  const done = verified.filter((r) => r.ok).length;
  const pending = verified.filter((r) => !r.ok).length;
  const manual = results.filter((r) => r.ok === null).length;
  const blockerFails = results.filter((r) => r.section === "blocker" && r.ok === false);
  console.log(
    `\nSummary: ${done}/${verified.length} verifiables completed · ${pending} pending · ${manual} manual`,
  );
  if (strict) {
    if (blockerFails.length) {
      console.error(
        `[check-launch-checklist] STRICT FAIL: ${blockerFails.length} unfinished blocker(s): ${blockerFails
          .map((r) => r.id)
          .join(", ")}`,
      );
      process.exit(1);
    }
    console.log("[check-launch-checklist] strict: blockers completed");
  } else {
    console.log("[check-launch-checklist] report mode (use --strict to fail on blockers)");
  }
}
