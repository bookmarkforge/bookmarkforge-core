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
 *   2. The legal/plantillas/ templates still exist with real content: the
 *      three breach-notification templates the consolidated procedure refers
 *      to, plus the workspace templates legal/plantillas/README.md promises
 *      and the vendor rows of legal/REGISTRO.md depend on.
 *   3. The templates keep their load-bearing legal anchors: the 72-hour
 *      rule, the BMF-INC incident identifier, and the never-ask-for-secrets
 *      rule among them. Anchors are matched case-insensitively — Spanish
 *      prose capitalizes them freely at headings and sentence starts, and
 *      what must survive is their presence, not their casing.
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
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_LEGAL_EMAILS,
  CONTROLLER_EMAIL,
  CONTROLLER_OPERATOR,
  FOREIGN_CONTACT_RE,
  IDENTITY_SURFACES,
  SUBPROCESSOR_PARITY,
} from "./legal-identity.mjs";

const ROOT = process.cwd();

// ── Contract constants ────────────────────────────────────────────────

/**
 * Headings that anchor the consolidated procedure in docs/security.md. The
 * gate demands the SECTION, not a language: docs/ was translated to English
 * (2026-09-22) while the legal templates and their Spanish anchors stayed put,
 * so either spelling satisfies it.
 */
export const PROCEDURE_HEADINGS = [
  "### Procedimiento de violación de datos personales (RGPD)", // legacy ES
  "### Personal data breach procedure (GDPR)", // EN (current docs language)
];

/** Legacy single-heading alias (the original constant name). */
export const PROCEDURE_HEADING = PROCEDURE_HEADINGS[0];

/**
 * Substrings the consolidated section must carry (art. 33 / art. 34 / vault).
 * Each entry is a GROUP of accepted spellings: the requirement is met when any
 * one of them is present, so a translated document is enforced on substance
 * (the 72-hour clock, both template paths, the never-ask-for-secrets rule)
 * instead of on the language it is written in.
 */
export const SECURITY_DOC_REQUIREMENTS = [
  ["72 horas", "72 hours"],
  ["legal/plantillas/notificacion-art-33-autoridad.md"],
  ["legal/plantillas/notificacion-art-34-interesados.md"],
  ["legal/plantillas/checklist-violacion-seguridad.md"],
  ["frase de recuperación", "recovery phrase"],
];

/**
 * Breach-notification templates whose procedure docs/security.md consolidates.
 * Losing one of these is exactly the ADR-026 failure this gate exists for:
 * protected compliance material gone without an equivalent replacement.
 */
export const BREACH_TEMPLATES = [
  "legal/plantillas/notificacion-art-33-autoridad.md",
  "legal/plantillas/notificacion-art-34-interesados.md",
  "legal/plantillas/checklist-violacion-seguridad.md",
];

/**
 * Legal-workspace templates promised by legal/plantillas/README.md and relied
 * on by the vendor rows of legal/REGISTRO.md (encargo de tratamiento,
 * transferencias internacionales, confirmación con Whop, ficha de privacidad
 * por proveedor). They guard the same failure mode one step earlier: a
 * template announced but never written, or silently gutted, leaves the
 * register pointing at nothing.
 */
export const WORKSPACE_TEMPLATES = [
  "legal/plantillas/DPA-proveedor.md",
  "legal/plantillas/SCC-transferencia-internacional.md",
  "legal/plantillas/confirmacion-Whop.md",
  "legal/plantillas/revision-privacidad-proveedor.md",
];

/** Templates that must exist and stay non-trivial. */
export const REQUIRED_TEMPLATES = [...BREACH_TEMPLATES, ...WORKSPACE_TEMPLATES];

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
  "legal/plantillas/DPA-proveedor.md": [
    "Art. 28 RGPD",
    "subprocesadores",
    "medidas de seguridad",
  ],
  "legal/plantillas/SCC-transferencia-internacional.md": [
    "Cláusulas Contractuales Tipo",
    "EEE",
    "evaluación de transferencia",
  ],
  "legal/plantillas/confirmacion-Whop.md": ["merchant of record", "IVA", "payouts"],
  "legal/plantillas/revision-privacidad-proveedor.md": [
    "minimización",
    "retención",
    "subprocesadores",
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
    if (!PROCEDURE_HEADINGS.some((heading) => securityDoc.includes(heading))) {
      findings.push(
        `docs/security.md lost the consolidated section: "${PROCEDURE_HEADINGS.join(" / ")}"`,
      );
    }
    for (const requirement of SECURITY_DOC_REQUIREMENTS) {
      const alternatives = Array.isArray(requirement) ? requirement : [requirement];
      if (!alternatives.some((spelling) => securityDoc.includes(spelling))) {
        findings.push(
          `docs/security.md consolidation is incomplete: missing "${alternatives.join(" / ")}"`,
        );
      }
    }
  }

  for (const templatePath of REQUIRED_TEMPLATES) {
    const content = templates[templatePath] ?? "";
    if (!content) {
      findings.push(
        `${templatePath} is missing — protected legal material without a replacement (ADR-026/ADR-060).`,
      );
      continue;
    }
    if (Buffer.byteLength(content, "utf8") < MIN_TEMPLATE_BYTES) {
      findings.push(
        `${templatePath} shrank below ${MIN_TEMPLATE_BYTES} bytes — the template appears gutted.`,
      );
    }
    const normalized = content.toLowerCase();
    for (const anchor of TEMPLATE_REQUIREMENTS[templatePath] ?? []) {
      if (!normalized.includes(anchor.toLowerCase())) {
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

// ── Consistency logic (identity · sub-processors · evidence) ──────────

/**
 * The municipality is the one part of the establishment that reads the same
 * in every language ("Castrelos" is a place name, not a word). The country
 * is translated per notice ("Spain" / "España" / "Espagne" / "Spanien" /
 * "Espanha" / "Spagna"), so it is not part of the contract.
 */
const CONTROLLER_LOCALITY_MARKER = "Castrelos";

/**
 * Extract the sub-processor list of a legal notice: the first <ul> block
 * after the section-13 heading. Returns "" when the section is missing.
 */
export function extractSubProcessorBlock(html) {
  const heading = html.search(/<h2>\s*13\./);
  if (heading < 0) return "";
  const listStart = html.indexOf("<ul>", heading);
  const listEnd = html.indexOf("</ul>", listStart);
  if (listStart < 0 || listEnd < 0) return "";
  return html.slice(listStart, listEnd + "</ul>".length);
}

/**
 * The `evidence_ref` values of the register's master table: the backticked
 * folder paths (e.g. `proveedores/whop/`).
 */
export function extractEvidenceRefs(register) {
  return [...register.matchAll(/`(proveedores\/[^`]+)`/g)].map((match) =>
    match[1].replace(/\/+$/, ""),
  );
}

/**
 * @param {object} inputs
 * @param {Record<string, string>} inputs.surfaces      identity surface path → contents
 * @param {string} inputs.register                      legal/REGISTRO.md contents
 * @param {Record<string, string>} inputs.noticeBlocks   locale → sub-processor list block
 * @param {string[]} inputs.evidenceDirs                existing folders under legal/ (relative)
 * @returns {{ ok: boolean, findings: string[] }}
 */
export function runLegalConsistencyChecks({
  surfaces,
  register,
  noticeBlocks,
  evidenceDirs,
}) {
  const findings = [];

  for (const path of IDENTITY_SURFACES) {
    const content = surfaces[path] ?? "";
    if (!content) {
      findings.push(`${path} is missing — a legal surface that names no controller.`);
      continue;
    }
    if (!content.includes(CONTROLLER_EMAIL)) {
      findings.push(
        `${path} does not carry the canonical contact address (${CONTROLLER_EMAIL}).`,
      );
    }
    if (!content.includes(CONTROLLER_OPERATOR)) {
      findings.push(
        `${path} does not name the controller operator (${CONTROLLER_OPERATOR}).`,
      );
    }
    if (!content.includes(CONTROLLER_LOCALITY_MARKER)) {
      findings.push(
        `${path} does not state the controller's establishment (${CONTROLLER_LOCALITY_MARKER}).`,
      );
    }
    for (const address of content.match(FOREIGN_CONTACT_RE) ?? []) {
      if (!ALLOWED_LEGAL_EMAILS.includes(address)) {
        findings.push(
          `${path} carries a divergent contact address: ${address} (allowed: ${ALLOWED_LEGAL_EMAILS.join(", ")}).`,
        );
      }
    }
  }

  for (const row of SUBPROCESSOR_PARITY) {
    if (!register.includes(row.id)) {
      findings.push(
        `legal/REGISTRO.md has no row ${row.id} — the sub-processor contract lost a counterparty.`,
      );
      continue;
    }
    if (!register.includes(row.register)) {
      findings.push(
        `legal/REGISTRO.md row ${row.id} lost its marker "${row.register}".`,
      );
    }
    for (const [locale, marker] of Object.entries(row.notices)) {
      const block = noticeBlocks[locale] ?? "";
      if (!block) {
        findings.push(
          `the ${locale} legal notice has no sub-processor list — the notice cannot state its recipients.`,
        );
        continue;
      }
      if (!block.includes(marker)) {
        findings.push(
          `the ${locale} legal notice does not name the sub-processor of ${row.id} (expected "${marker}").`,
        );
      }
    }
  }

  const known = new Set((evidenceDirs ?? []).map((dir) => dir.replace(/\/+$/, "")));
  for (const ref of new Set(extractEvidenceRefs(register))) {
    if (!known.has(ref)) {
      findings.push(
        `legal/REGISTRO.md points its evidence_ref at "${ref}", which does not exist under legal/.`,
      );
    }
  }

  return { ok: findings.length === 0, findings };
}

/** Every directory under legal/, relative to legal/ ("proveedores/whop"). */
function listEvidenceDirs(root) {
  const dirs = [];
  const walk = (relative) => {
    const absolute = relative ? join(root, relative) : root;
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      dirs.push(child);
      walk(child);
    }
  };
  walk("");
  return dirs;
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

  const countIntact = (paths) =>
    paths.filter((p) => (templates[p] ?? "").length > 0).length;

  // ── Consistency: identity · sub-processor parity · evidence folders ──
  const surfaces = {};
  for (const path of IDENTITY_SURFACES) {
    const absolute = join(ROOT, ...path.split("/"));
    surfaces[path] = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  }
  const register = surfaces[REGISTRY_PATH] ?? "";
  const noticeBlocks = {};
  for (const locale of Object.keys(SUBPROCESSOR_PARITY[0].notices)) {
    const path =
      locale === "en"
        ? "public/privacy-and-terms.html"
        : `public/${locale}/privacy-and-terms.html`;
    const absolute = join(ROOT, ...path.split("/"));
    noticeBlocks[locale] = existsSync(absolute)
      ? extractSubProcessorBlock(readFileSync(absolute, "utf8"))
      : "";
  }
  const consistency = runLegalConsistencyChecks({
    surfaces,
    register,
    noticeBlocks,
    evidenceDirs: listEvidenceDirs(join(ROOT, "legal")),
  });

  if (!ok || !consistency.ok) {
    for (const finding of findings) {
      console.error(`[check:legal-consolidation] FAIL ${finding}`);
    }
    for (const finding of consistency.findings) {
      console.error(`[check:legal-consolidation] FAIL ${finding}`);
    }
    process.exit(1);
  }

  console.log(
    `[check:legal-consolidation] ok: procedure consolidated in docs/security.md, ` +
      `${countIntact(BREACH_TEMPLATES)}/${BREACH_TEMPLATES.length} breach templates, ` +
      `${countIntact(WORKSPACE_TEMPLATES)}/${WORKSPACE_TEMPLATES.length} workspace templates, ` +
      `registry present, ` +
      `${IDENTITY_SURFACES.length} identity surfaces consistent, ` +
      `${SUBPROCESSOR_PARITY.length} sub-processors declared in every published notice.`,
  );
}

const invokedDirectly =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("check-legal-consolidation.mjs");
if (invokedDirectly) {
  main();
}
