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
  // Contextos de required checks = NOMBRES DE JOB de ci.yml/sast.yml.
  // "Enforce mandatory security gates" era un nombre de STEP dentro del job
  // quality: un contexto así nunca aparecería y bloquearía todos los merges.
  // Esos gates (check:security-internal, check:server-log-ip-privacy,
  // check:blindeo) corren dentro del job quality, ya requerido aquí.
  "Typecheck, lint, tests and security gates",
  "Playwright E2E",
  "Production build and repository checks",
  "Dependency review",
  "CodeQL analysis",
  "Semgrep analysis",
];

const EXPORT_ONLY_FIELDS = ["id", "source", "source_type", "node_id", "_links", "created_at", "updated_at"];

export function verifyRuleset(parsed) {
  if (parsed == null || typeof parsed !== "object") return { ok: false, note: "ruleset ausente o JSON inválido" };
  // El archivo es el payload directo de POST /repos/{owner}/{repo}/rulesets;
  // los campos de export (id, source, source_type…) no pertenecen al body de creación.
  const exportFields = EXPORT_ONLY_FIELDS.filter((field) => field in parsed);
  if (exportFields.length) {
    return { ok: false, note: `campos de export no válidos en el payload: ${exportFields.join(", ")}` };
  }
  const checks =
    parsed?.rules
      ?.find((rule) => rule.type === "required_status_checks")
      ?.parameters?.required_status_checks ?? [];
  const contexts = checks.map((check) => check.context);
  const missing = REQUIRED_RULESET_CHECKS.filter((context) => !contexts.includes(context));
  if (missing.length) {
    return { ok: false, note: `faltan checks obligatorios: ${missing.join(", ")}` };
  }
  return { ok: true, note: "checks obligatorios presentes (importación/activación en GitHub = manual)" };
}

export function verifySloRpoRto(text) {
  if (text == null) return { ok: false, note: "docs/operations.md no existe" };
  const ok = ["RPO:", "RTO:", "SLOs", "99.9%"].every((needle) => text.includes(needle));
  return ok
    ? { ok: true, note: "baselines documentados (confirmación oficial trimestral = manual)" }
    : { ok: false, note: "faltan RPO/RTO/SLOs en docs/operations.md" };
}

export function verifySast(workflowText, gateExists) {
  const ok =
    gateExists &&
    workflowText != null &&
    workflowText.includes("CodeQL analysis") &&
    workflowText.includes("Semgrep analysis");
  return ok
    ? { ok: true, note: "sast.yml + scripts/check-sarif-severity.mjs presentes" }
    : { ok: false, note: "sast.yml o gate de severidad ausentes" };
}

export function verifyErrorReporting(pkg, reporter) {
  if (!pkg?.dependencies?.["@sentry/browser"]) {
    return { ok: false, note: "falta @sentry/browser en dependencies" };
  }
  if (!reporter) return { ok: false, note: "falta src/telemetry/remoteErrorReporter.ts" };
  if (!reporter.includes("beforeSend")) {
    return { ok: false, note: "remoteErrorReporter sin beforeSend sancador" };
  }
  // ADR-030: consent lives in ConsentService. Accept either the legacy direct
  // key marker or a delegation to the purpose-scoped gate ("sentry").
  const hasConsentGate =
    reporter.includes("CONSENT_ERROR_REPORTING") ||
    /isPurposeConsented\s*\(\s*["']sentry["']\s*\)/.test(reporter);
  if (!hasConsentGate) {
    return { ok: false, note: "remoteErrorReporter sin gate de consentimiento opt-in" };
  }
  if (!reporter.includes("initRemoteErrorReporting") || !reporter.includes("sentry.init")) {
    return { ok: false, note: "remoteErrorReporter sin inicialización condicional" };
  }
  return { ok: true, note: "@sentry/browser + beforeSend sancador + opt-in (desactivado por defecto)" };
}

export function verifyLoadTest(pkg, scriptExists, scriptText = "") {
  const scripts = JSON.stringify(pkg?.scripts ?? {});
  const hasScript = /(test:load|load:companion|load:server)/i.test(scripts);
  if (!hasScript || !scriptExists) {
    return { ok: false, note: "sin prueba de carga del companion server (pendiente)" };
  }
  // La prueba debe cubrir la superficie que escala con los usuarios y fijar
  // presupuestos medibles. Ya no se exige cobertura de un proxy de IA: el
  // servidor no proxya proveedores (el navegador llama al proveedor del
  // usuario directamente), así que no hay endpoint de generación que medir.
  const text = scriptText ?? "";
  const coversSignaling = /\bjoin\b/i.test(text) && /relay|signal/i.test(text);
  const hasBudgets = /p95|percentile/i.test(text) && /(BUDGETS|SLO)/i.test(text);
  const hasSaturation = /saturat/i.test(text);
  // El servidor debe seguir vivo tras la ráfaga: es el presupuesto de liveness.
  const hasLiveness = /\/health/i.test(text);
  const ok = coversSignaling && hasBudgets && hasSaturation && hasLiveness;
  return ok
    ? { ok: true, note: "prueba de carga (señalización WS + saturación) con presupuestos detectada" }
    : { ok: false, note: "prueba de carga incompleta: faltan señalización, presupuestos, saturación o liveness" };
}

export function verifyContracts(docs) {
  // Only a real spec header counts (e.g. "openapi: 3.1.0"). A mention like
  // "Sin Swagger/OpenAPI" in the audit must not be mistaken for a contract.
  const specHeader = /(?:^|\n)\s*(?:openapi|swagger)\s*:\s*["']?\d+\.\d+/i;
  const ok = (docs ?? []).some((text) => specHeader.test(text));
  return ok
    ? { ok: true, note: "contratos OpenAPI/Swagger detectados" }
    : { ok: false, note: "sin contratos versionados (pendiente)" };
}

export function verifyDrill(pkg, drillExists) {
  const ok = drillExists && Boolean(pkg?.scripts?.["drill:backup-restore"]);
  return ok
    ? { ok: true, note: "drill mensual presente (simulacro trimestral = manual)" }
    : { ok: false, note: "drill de restauración ausente" };
}

export function verifyExtensions(manifestsExist) {
  return manifestsExist
    ? { ok: true, note: "manifests presentes (publicación en tiendas = manual)" }
    : { ok: false, note: "faltan manifests de extensión" };
}

export function verifyEnvGates(pkg) {
  const gates = ["check:http-config", "check:compose-config", "check:runtime-config", "check:docker-context"];
  const missing = gates.filter((gate) => !pkg?.scripts?.[gate]);
  return missing.length === 0
    ? { ok: true, note: "gates de configuración presentes (inspección del despliegue = manual)" }
    : { ok: false, note: `faltan gates: ${missing.join(", ")}` };
}

export function verifyDastDisabled(text) {
  if (text == null) return { ok: false, note: "dast-nightly.yml no existe" };
  const disabled = text.includes("if: ${{ false }}");
  const digestPending = text.includes("REPLACE_WITH_VERIFIED_ZAP_IMAGE_DIGEST");
  if (!disabled) return { ok: false, note: "los pasos autenticados NO están deshabilitados" };
  return {
    ok: true,
    note: digestPending
      ? "deshabilitado de forma segura (digest e imagen ZAP pendientes de verificar; activación = manual)"
      : "deshabilitado de forma segura (activación = manual)",
  };
}

export function verifyProdConfig(text) {
  if (text == null) return { ok: false, note: "docs/security.md no existe" };
  // Los tokens son la configuración que el servidor REALMENTE exige en
  // producción hoy. Solo se comprueban variables que tienen lectores runtime;
  // no se incluyen flags retirados de subsistemas antiguos.
  const ok = ["NODE_ENV=production", "AI_SESSION_ORIGINS", "ENFORCE_SIGNAL_HMAC", "LICENSE_SIGNING_PRIVATE_KEY_FILE"].every(
    (needle) => text.includes(needle),
  );
  return ok
    ? { ok: true, note: "config obligatoria documentada (verificación del despliegue = manual)" }
    : { ok: false, note: "falta config obligatoria en docs/security.md" };
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
    ? { ok: true, note: "preflight completo en package.json" }
    : { ok: false, note: `faltan scripts: ${missing.join(", ")}` };
}

export function verifyRopa(text) {
  if (text == null) return { ok: false, note: "docs/ROPA.md no existe" };
  const pending = (text.match(/COMPLETAR/g) ?? []).length;
  return pending === 0
    ? { ok: true, note: "ROPA sin campos pendientes" }
    : { ok: false, note: `quedan ${pending} campos ⚠ COMPLETAR en docs/ROPA.md` };
}

export function verifyZapFailLevels(text) {
  if (text == null) return { ok: false, note: ".zap/baseline.conf no existe" };
  const levels = text.match(/^FAIL_LEVELS=(.*)$/m)?.[1] ?? "";
  const ok = levels.includes("High") && levels.includes("Critical");
  return ok ? { ok: true, note: `FAIL_LEVELS=${levels}` } : { ok: false, note: "FAIL_LEVELS sin High+Critical" };
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
    { id: 2, section: "blocker", title: "Protección de main: ruleset con checks obligatorios", run: () => verifyRuleset(readJson(".github/rulesets/main-protection.json")) },
    { id: 3, section: "blocker", title: "RPO/RTO y SLOs documentados", run: () => verifySloRpoRto(read("docs/operations.md")) },
    { id: 4, section: "blocker", title: "Responsable y canal de alertas", manual: true },
    { id: 5, section: "blocker", title: "Cierre legal RGPD", run: () => verifyRopa(read("docs/ROPA.md")) },
    { id: 6, section: "external", title: "Pentest", manual: true },
    { id: 7, section: "external", title: "Revisión manual WCAG y privacidad", manual: true },
    { id: 8, section: "external", title: "SAST independiente (CodeQL + Semgrep) en CI", run: () => verifySast(read(".github/workflows/sast.yml"), has("scripts/check-sarif-severity.mjs")) },
    { id: 9, section: "p1", title: "Registro de errores con redacción PII y opt-in", run: () => verifyErrorReporting(pkg, read("src/telemetry/remoteErrorReporter.ts")) },
    { id: 10, section: "p1", title: "Decisión de analítica de negocio", manual: true },
    { id: 11, section: "p1", title: "Prueba de carga del companion server", run: () => verifyLoadTest(pkg, has("scripts/load-test-server.mjs"), read("scripts/load-test-server.mjs") ?? "") },
    { id: 12, section: "p1", title: "Contratos versionados con integraciones", run: () => verifyContracts(docs) },
    { id: 13, section: "p1", title: "Simulacro de desastre trimestral (drill mensual)", run: () => verifyDrill(pkg, has("scripts/drill-backup-restore.mjs")) },
    { id: 14, section: "p1", title: "Checklist de publicación de extensiones", run: () => verifyExtensions(has("extension/manifest.json") && has("extension/manifest-firefox.json")) },
    { id: 15, section: "env", title: "Secretos, environments y permisos de despliegue", manual: true },
    { id: 16, section: "env", title: "Seguridad real de staging y producción (gates)", run: () => verifyEnvGates(pkg) },
    { id: 17, section: "env", title: "DAST autenticado deshabilitado de forma segura", run: () => verifyDastDisabled(read(".github/workflows/dast-nightly.yml")) },
    { id: 18, section: "env", title: "Configuración obligatoria de producción documentada", run: () => verifyProdConfig(read("docs/security.md")) },
  ];

  const gates = [
    { title: "Preflight de release (scripts en package.json)", run: () => verifyPreflightScripts(pkg) },
    { title: "FAIL_LEVELS de ZAP incluye High + Critical", run: () => verifyZapFailLevels(read(".zap/baseline.conf")) },
  ];

  const evaluate = (item) => {
    if (item.manual) return { ok: null, note: "manual (no verificable desde el repo)" };
    try {
      return item.run() ?? { ok: false, note: "sin resultado" };
    } catch (error) {
      return { ok: false, note: `error: ${error.message}` };
    }
  };

  const results = items.map((item) => ({ id: item.id, section: item.section, title: item.title, ...evaluate(item) }));
  const gateResults = gates.map((gate) => ({ title: gate.title, ...evaluate(gate) }));

  const sections = [
    ["blocker", "🔴 Bloqueante (P0)"],
    ["external", "🟠 Validación externa"],
    ["p1", "🟡 Primer trimestre"],
    ["env", "🟢 Verificación del entorno"],
  ];
  console.log("[check-launch-checklist] Informe de progreso de pre-lanzamiento");
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
    `\nResumen: ${done}/${verified.length} verificables completados · ${pending} pendientes · ${manual} manuales`,
  );
  if (strict) {
    if (blockerFails.length) {
      console.error(
        `[check-launch-checklist] STRICT FAIL: ${blockerFails.length} bloqueante(s) sin completar: ${blockerFails
          .map((r) => r.id)
          .join(", ")}`,
      );
      process.exit(1);
    }
    console.log("[check-launch-checklist] strict: bloqueantes completados");
  } else {
    console.log("[check-launch-checklist] modo informe (usa --strict para fallar con bloqueantes)");
  }
}
