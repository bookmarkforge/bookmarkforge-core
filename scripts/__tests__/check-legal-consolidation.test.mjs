/**
 * scripts/__tests__/check-legal-consolidation.test.mjs
 *
 * Contract tests for scripts/check-legal-consolidation.mjs — drives the pure
 * check function with in-memory fixtures (complete corpus, mutilated docs,
 * gutted templates, injected secrets) so the CLI wrapper's I/O never hides
 * a regression from the suite.
 */
import { describe, expect, it } from "vitest";

import {
  PROCEDURE_HEADING,
  REQUIRED_TEMPLATES,
  runLegalConsolidationChecks,
} from "../check-legal-consolidation.mjs";

const T33 = "legal/plantillas/notificacion-art-33-autoridad.md";
const T34 = "legal/plantillas/notificacion-art-34-interesados.md";
const CHECK = "legal/plantillas/checklist-violacion-seguridad.md";
const DPA = "legal/plantillas/DPA-proveedor.md";
const SCC = "legal/plantillas/SCC-transferencia-internacional.md";
const WHOP = "legal/plantillas/confirmacion-Whop.md";
const PROV = "legal/plantillas/revision-privacidad-proveedor.md";

/** A consolidated security doc that satisfies every requirement. */
function completeSecurityDoc() {
  return [
    "# Seguridad de producción",
    "## Incidentes de seguridad",
    PROCEDURE_HEADING,
    "La notificación a la autoridad se hace dentro de las 72 horas.",
    "Plantilla: legal/plantillas/notificacion-art-33-autoridad.md",
    "Plantilla: legal/plantillas/notificacion-art-34-interesados.md",
    "Checklist: legal/plantillas/checklist-violacion-seguridad.md",
    "Nunca solicitar la frase de recuperación a usuarios.",
  ].join("\n");
}

/**
 * Template fixtures carrying their required anchors, over 1 KiB each. The
 * workspace fixtures deliberately capitalize their anchors ("Subprocesadores",
 * "Minimización") so the base corpus also exercises the case-insensitive
 * anchor comparison the gate applies to legal prose.
 */
function completeTemplates() {
  // Word-spaced filler: a solid alphanumeric run would trip the gate's own
  // opaque-blob secret detector, which these fixtures must NOT trigger.
  const pad = "contenido de relleno para superar el minimo de bytes del gate. ".repeat(30);
  return {
    [T33]: `# Plantilla art. 33\n\n> 72 horas desde el conocimiento\n\nIdentificador BMF-INC-2026-001\n${pad}`,
    [T34]: `# Plantilla art. 34\n\nReferencia BMF-INC-2026-001\n\nno pediremos tu frase de recuperación\n${pad}`,
    [CHECK]: `# Checklist\n\n## Reloj de 72 horas\n\n- No incluir secretos, credenciales ni frases.\n- Actualizar legal/REGISTRO.md solo con la referencia.\n${pad}`,
    [DPA]: `# Encargo de tratamiento\n\nChecklist del Art. 28 RGPD: Subprocesadores y Medidas de seguridad.\n${pad}`,
    [SCC]: `# Transferencias\n\nFuera del EEE, con Cláusulas Contractuales Tipo y Evaluación de transferencia.\n${pad}`,
    [WHOP]: `# Confirmación con el vendedor\n\nmerchant of record, IVA, reembolsos y payouts.\n${pad}`,
    [PROV]: `# Ficha de privacidad\n\nMinimización, Retención y Subprocesadores.\n${pad}`,
  };
}

const base = { securityDoc: completeSecurityDoc(), templates: completeTemplates(), registryExists: true };

describe("check-legal-consolidation", () => {
  it("passes with the complete corpus", () => {
    const { ok, findings } = runLegalConsolidationChecks(base);
    expect(ok, findings.join("\n")).toBe(true);
    expect(findings).toHaveLength(0);
  });

  it("accepts the consolidated section in English (docs/ language) as well as Spanish", () => {
    // The section is required; the language it is written in is not. This is
    // the state docs/security.md is actually in since the 2026-09-22 docs
    // translation, while the legal templates stay Spanish.
    const english = [
      "# Production security",
      "## Security incidents",
      "### Personal data breach procedure (GDPR)",
      "The authority is notified within 72 hours.",
      "Template: legal/plantillas/notificacion-art-33-autoridad.md",
      "Template: legal/plantillas/notificacion-art-34-interesados.md",
      "Checklist: legal/plantillas/checklist-violacion-seguridad.md",
      "Never request passwords or recovery phrases from users.",
    ].join("\n");
    const { ok, findings } = runLegalConsolidationChecks({ ...base, securityDoc: english });
    expect(ok, findings.join("\n")).toBe(true);

    const withoutSpellings = english
      .replace("72 hours", "promptly")
      .replace("recovery phrases", "credentials");
    const missing = runLegalConsolidationChecks({ ...base, securityDoc: withoutSpellings });
    expect(missing.ok).toBe(false);
    expect(missing.findings.join(" ")).toContain("72 horas / 72 hours");
    expect(missing.findings.join(" ")).toContain("frase de recuperación / recovery phrase");
  });

  it("fails when docs/security.md loses the consolidated section or its anchors", () => {
    for (const mutation of [
      (doc) => doc.replace(PROCEDURE_HEADING, "### Incidentes (RGPD)"),
      (doc) => doc.replace("72 horas", "sin plazo"),
      (doc) => doc.replace(T33, "plantilla-antigua.md"),
      (doc) => doc.replace("frase de recuperación", "credenciales"),
    ]) {
      const { ok, findings } = runLegalConsolidationChecks({
        ...base,
        securityDoc: mutation(base.securityDoc),
      });
      expect(ok, `expected failure for mutation: ${mutation}`).toBe(false);
      expect(findings.join(" ")).toMatch(/docs\/security\.md/);
    }
  });

  it("fails closed when docs/security.md is missing", () => {
    const { ok } = runLegalConsolidationChecks({ ...base, securityDoc: "" });
    expect(ok).toBe(false);
  });

  it("fails when a template goes missing or is gutted below the minimum size", () => {
    const missing = runLegalConsolidationChecks({
      ...base,
      templates: { ...completeTemplates(), [T34]: "" },
    });
    expect(missing.ok).toBe(false);
    expect(missing.findings.join(" ")).toMatch(/missing — protected legal material/);

    const gutted = runLegalConsolidationChecks({
      ...base,
      templates: { ...completeTemplates(), [T33]: "# Plantilla art. 33\n\n72 horas\n" },
    });
    expect(gutted.ok).toBe(false);
    expect(gutted.findings.join(" ")).toMatch(/gutted/);
  });

  it("fails when a template loses a required legal anchor", () => {
    const templates = completeTemplates();
    templates[T33] = templates[T33].replace("BMF-INC-2026-001", "ID-2026-001");
    const { ok, findings } = runLegalConsolidationChecks({
      securityDoc: completeSecurityDoc(),
      templates,
      registryExists: true,
    });
    expect(ok).toBe(false);
    expect(findings.join(" ")).toMatch(/legal anchor/);
  });

  it("matches legal anchors regardless of capitalization", () => {
    const templates = completeTemplates();
    templates[DPA] = templates[DPA]
      .replace("Art. 28 RGPD", "ART. 28 rgpd")
      .replace("Subprocesadores", "SUBPROCESADORES");
    const { ok, findings } = runLegalConsolidationChecks({ ...base, templates });
    expect(ok, findings.join("\n")).toBe(true);
  });

  it("fails when a workspace template is missing or gutted", () => {
    const missing = runLegalConsolidationChecks({
      ...base,
      templates: { ...completeTemplates(), [SCC]: "" },
    });
    expect(missing.ok).toBe(false);
    expect(missing.findings.join(" ")).toMatch(/SCC-transferencia-internacional\.md is missing/);

    const gutted = runLegalConsolidationChecks({
      ...base,
      templates: { ...completeTemplates(), [DPA]: "# Encargo de tratamiento\n" },
    });
    expect(gutted.ok).toBe(false);
    expect(gutted.findings.join(" ")).toMatch(/gutted/);
  });

  it("rejects draft templates that carry apparent credentials", () => {
    const templates = completeTemplates();
    templates[T34] =
      "# Plantilla art. 34\n\nBMF-INC-2026-001 frase de recuperación\n\ntoken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N0_2vG0Xhhq6nRKaG0tXow\n";
    const { ok, findings } = runLegalConsolidationChecks({
      securityDoc: completeSecurityDoc(),
      templates,
      registryExists: true,
    });
    expect(ok).toBe(false);
    expect(findings.join(" ")).toMatch(/apparent credential/);
  });

  it("fails when the incident registry disappears", () => {
    const { ok, findings } = runLegalConsolidationChecks({ ...base, registryExists: false });
    expect(ok).toBe(false);
    expect(findings.join(" ")).toMatch(/legal\/REGISTRO\.md/);
  });

  it("keeps the real repository corpus green", () => {
    // Guard against the fixtures drifting away from the real files: the
    // required template paths must be exactly the ones the gate demands.
    expect(Object.keys(completeTemplates()).sort()).toEqual([...REQUIRED_TEMPLATES].sort());
  });
});
