#!/usr/bin/env node
/**
 * scripts/check-legal-consolidation.mjs — GDPR breach-notification gate.
 *
 * docs/security.md's incident section consolidates the operational procedure
 * that previously lived ONLY in the private legal/plantillas/ templates
 * (art. 33 authority notification, art. 34 user communication, breach
 * checklist). ADR-026 forbids retiring protected compliance material without
 * an equivalent replacement; this gate makes that replacement verifiable:
 *
 *   1. docs/security.md keeps the consolidated GDPR procedure section
 *      (72-hour clock, both template paths, vault/credentials rules).
 *   2. The three legal/plantillas/ templates still exist with real content.
 *   3. The templates keep their load-bearing legal anchors: the 72-hour
 *      rule, the BMF-INC incident identifier, and the never-ask-for-secrets
 *      rule. Losing any of them would silently gut the procedure.
 *   4. legal/REGISTRO.md (incident registry) still exists.
 *   5. No template carries an obvious credential (JWT / long secret token)
 *      — the templates are drafts and must never hold real secrets.
 *
 * Like check-csp-sync.mjs, the check logic is a pure function
 * (`runLegalConsolidationChecks`) driven by in-memory fixtures in unit
 * tests; the CLI wrapper performs the file I/O.
 *
 * Usage: node scripts/check-legal-consolidation.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// ── Contract constants ────────────────────────────────────────────────

/** Heading that must anchor the consolidated procedure in docs/security.md. */
export const PROCEDURE_HEADING =
  "### Procedimiento de violación de datos personales (RGPD)";

/** Substrings the consolidated section must carry (art. 33 / art. 34 / vault). */
export const SECURITY_DOC_REQUIREMENTS = [
  "72 horas",
  "legal/plantillas/notificacion-art-33-autoridad.md",
  "legal/plantillas/notificacion-art-34-interesados.md",
  "legal/plantillas/checklist-violacion-seguridad.md",
  "frase de recuperación",
];

/** Templates that must exist and stay non-trivial. */
export const REQUIRED_TEMPLATES = [
  "legal/plantillas/notificacion-art-33-autoridad.md",
  "legal/plantillas/notificacion-art-34-interesados.md",
  "legal/plantillas/checklist-violacion-seguridad.md",
];

/** Minimum template size in bytes: a gutted stub must fail this gate. */
export const MIN_TEMPLATE_BYTES = 1024;

/** Legal anchors each template must keep. */
export const TEMPLATE_REQUIREMENTS = {
  "legal/plantillas/notificacion-art-33-autoridad.md": ["72 horas", "BMF-INC-"],
  "legal/plantillas/notificacion-art-34-interesados.md": ["BMF-INC-", "frase de recuperación"],
  "legal/plantillas/checklist-violacion-seguridad.md": [
    "72 horas",
    "No incluir secretos",
    "legal/REGISTRO.md",
  ],
};

/** The incident registry the checklist writes references into. */
export const REGISTRY_PATH = "legal/REGISTRO.md";

/**
 * Obvious credential shapes that must never appear inside a draft template.
 * Deliberately narrow (real JWTs / very long opaque tokens / known provider
 * key prefixes) so the `[●]` placeholders and markdown never trip it.
 */
const SECRET_PATTERNS = [
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT
  /(sk_live|pk_live|whsec|rk_live)_[A-Za-z0-9]{16,}/, // Stripe/Whop-style keys
  /[A-Za-z0-9+/]{120,}={0,2}/, // very long opaque base64 blobs
];

// ── Pure check logic (unit-testable with in-memory fixtures) ─────────

/**
 * @param {object} inputs
 * @param {string} inputs.securityDoc   contents of docs/security.md ("" = missing)
 * @param {Record<string, string>} inputs.templates  template path → contents ("" = missing)
 * @param {boolean} inputs.registryExists
 * @returns {{ ok: boolean, findings: string[] }}
 */
export function runLegalConsolidationChecks({
  securityDoc,
  templates,
  registryExists,
}) {
  const findings = [];

  if (!securityDoc) {
    findings.push("docs/security.md is missing — consolidated GDPR procedure lost.");
  } else {
    if (!securityDoc.includes(PROCEDURE_HEADING)) {
      findings.push(`docs/security.md lost the consolidated section: "${PROCEDURE_HEADING}"`);
    }
    for (const requirement of SECURITY_DOC_REQUIREMENTS) {
      if (!securityDoc.includes(requirement)) {
        findings.push(
          `docs/security.md consolidation is incomplete: missing "${requirement}"`,
        );
      }
    }
  }

  for (const templatePath of REQUIRED_TEMPLATES) {
    const content = templates[templatePath] ?? "";
    if (!content) {
      findings.push(`${templatePath} is missing — protected compliance material (ADR-026).`);
      continue;
    }
    if (Buffer.byteLength(content, "utf8") < MIN_TEMPLATE_BYTES) {
      findings.push(
        `${templatePath} shrank below ${MIN_TEMPLATE_BYTES} bytes — the template appears gutted.`,
      );
    }
    for (const anchor of TEMPLATE_REQUIREMENTS[templatePath] ?? []) {
      if (!content.includes(anchor)) {
        findings.push(`${templatePath} lost its legal anchor: "${anchor}"`);
      }
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        findings.push(
          `${templatePath} contains an apparent credential (JWT/long secret) — drafts must never hold real secrets.`,
        );
        break;
      }
    }
  }

  if (!registryExists) {
    findings.push(`${REGISTRY_PATH} is missing — incident references have no registry.`);
  }

  return { ok: findings.length === 0, findings };
}

// ── CLI wrapper ───────────────────────────────────────────────────────

function main() {
  // The open-core export deliberately excludes the private legal/ tree
  // (export-public-repo.mjs EXCLUDED_DIRS) while keeping docs/security.md.
  // There the gate skips explicitly instead of failing: consolidation is
  // enforced in the private source repo. A missing legal/ WITHOUT the
  // export manifest is still a hard failure (real regression upstream).
  const isPublicExport =
    !existsSync(join(ROOT, "legal")) &&
    existsSync(join(ROOT, "manifest.json"));
  if (isPublicExport) {
    console.log(
      "[check:legal-consolidation] skip: public export excludes the private legal/ tree; consolidation is enforced upstream.",
    );
    return;
  }

  const securityPath = join(ROOT, "docs", "security.md");
  const securityDoc = existsSync(securityPath)
    ? readFileSync(securityPath, "utf8")
    : "";

  const templates = {};
  for (const templatePath of REQUIRED_TEMPLATES) {
    const absolute = join(ROOT, ...templatePath.split("/"));
    templates[templatePath] = existsSync(absolute)
      ? readFileSync(absolute, "utf8")
      : "";
  }

  const registryExists = existsSync(join(ROOT, ...REGISTRY_PATH.split("/")));

  const { ok, findings } = runLegalConsolidationChecks({
    securityDoc,
    templates,
    registryExists,
  });

  const templateCount = REQUIRED_TEMPLATES.filter(
    (p) => (templates[p] ?? "").length > 0,
  ).length;

  if (!ok) {
    for (const finding of findings) {
      console.error(`[check:legal-consolidation] FAIL ${finding}`);
    }
    process.exit(1);
  }

  console.log(
    `[check:legal-consolidation] ok: procedure consolidated in docs/security.md, ` +
      `${templateCount}/${REQUIRED_TEMPLATES.length} templates intact, registry present.`,
  );
}

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("check-legal-consolidation.mjs");
if (invokedDirectly) {
  main();
}
