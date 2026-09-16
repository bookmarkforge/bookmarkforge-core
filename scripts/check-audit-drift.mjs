/**
 * scripts/check-audit-drift.mjs — audit drift gate (batch-29).
 *
 * Convierte el hallazgo de scripts/gen-audit-report.mjs (auditoría de
 * placeholders e inglés sin traducir) en un gate de CI con baseline, mismo
 * patrón que scripts/check-i18n-quality.mjs:
 *
 *   node scripts/check-audit-drift.mjs            # gate — falla si delta > 0
 *   node scripts/check-audit-drift.mjs --fix      # rebaseline al estado actual
 *   node scripts/check-audit-drift.mjs --strict-discovery # zero-discoveries policy
 *   node scripts/check-audit-drift.mjs --strict   # compatibility spelling
 *
 * Además, encadena la gate de regresión-anchors (scripts/audit-anchors.mjs)
 * que falla si algún hardening-test del post-audit ha sido removido. Los
 * anclajes son decisiones de seguridad (ADR-026 / ADR-027) y no pueden
 * desaparecer sin un cambio explícito en la ADR — exactamente el tipo de
 * regresión silenciosa que este gate atrapa. La lista canónica vive en
 * scripts/audit-anchors.mjs (importada), no aquí, para evitar duplicación.
 *
 * La auditoría reporta 0 claves afectadas hoy; el baseline se commitea en ese
 * nivel para que el PR que reintroduzca un placeholder crudo (A) o inglés sin
 * traducir (B) rompa CI, mientras mantener el status quo pasa. La
 * clasificación vive SOLO en scripts/audit-core.mjs — compartida con el
 * generador del informe — así cualquier cambio de umbral se refleja en ambos.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAudit } from "./audit-core.mjs";
import {
  runAuditAnchors,
  strictDiscoveryRequested,
} from "./audit-anchors.mjs";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "scripts", "audit-drift-baseline.json");

const { files, perLang, total, unique, all29 } = runAudit();

let baseline = { locales: {}, unique: 0, updatedAt: null };
if (existsSync(BASELINE_PATH)) {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

let failures = 0;

// Totales por-locale: placeholders (A) + inglés sin traducir (B). Una
// regresión en cualquier locale (valores rotos NETOS nuevos) empuja el conteo
// por encima de su baseline. Un locale nuevo sin entrada en el baseline parte
// de 0 — si trae issues, falla (comportamiento deseado).
for (const [lang, counts] of Object.entries(perLang)) {
  const prev = baseline.locales?.[lang]?.issues ?? 0;
  const issues = counts.a + counts.b;
  const delta = issues - prev;
  if (issues > prev) {
    console.error(
      `[check-audit-drift] FAIL ${lang}: ${issues} (baseline ${prev}, delta +${delta}) — ` +
        `placeholders A=${counts.a}, untranslated B=${counts.b}`,
    );
    failures += 1;
  } else {
    console.log(
      `[check-audit-drift] ok ${lang}: ${issues} (baseline ${prev}, delta ${delta})`,
    );
  }
}

// Claves únicas afectadas en total: una clave rota nueva se ve aquí aunque
// solo toque un idioma (la línea per-locale ya falla también). Esta métrica
// NO caza movimientos net-cero (una clave que se repara en un locale y se
// rompe en otro donde ya había issues no cambia unique ni ningún conteo
// per-locale) — es una métrica de causa raíz informativa, no cobertura
// adicional. Los deltas se miden por-local: un bug que aterriza en un
// locale limpio (0→1) se detecta por la línea per-locale.
if (unique > baseline.unique) {
  console.error(
    `[check-audit-drift] FAIL unique keys: ${unique} (baseline ${baseline.unique})`,
  );
  failures += 1;
} else {
  console.log(
    `[check-audit-drift] ok unique: ${unique} (baseline ${baseline.unique})`,
  );
}

console.log(
  `[check-audit-drift] totals: ${total} values across ${unique} keys, ${all29} broken in all ${files.length} locales`,
);

// ---------------------------------------------------------------------------
// Regression anchors — chained here so a single `npm run check:audit-drift`
// covers both gates and `npm run check:audit-drift:fix` refreshes both
// baselines. Adding or removing an anchor is an ADR-level change, not a
// baseline action; see scripts/audit-anchors.mjs for the catalog.
// ---------------------------------------------------------------------------
const fixMode = process.argv.includes("--fix");
const strictDiscovery = strictDiscoveryRequested(process.argv);
const anchorReport = runAuditAnchors({
  fix: fixMode,
  strictDiscovery,
});
for (const present of anchorReport.present) {
  // Open Core export: an anchor whose subject is entirely replaced by the Pro
  // boundary resolves to nothing. That is an explicit skip — visible, counted
  // separately, and never mistaken for a real resolution.
  if (present.proBoundarySkip) {
    console.log(
      `[check-audit-drift] anchor SKIP ${present.id} — subject replaced by the Open Core Pro boundary in this tree`,
    );
    continue;
  }
  const matchLabel =
    present.matches.length === 1
      ? present.matches[0]
      : `${present.matches.length} files`;
  console.log(
    `[check-audit-drift] anchor ok ${present.id} — ${matchLabel}`,
  );
}
for (const missing of anchorReport.failures) {
  if (missing.type === "malformed-catalog") {
    console.error(
      `[check-audit-drift] anchor FAIL malformed catalog ${missing.id} — ` +
        `${missing.description}: ${missing.glob}`,
    );
  } else if (missing.type === "catalog-inflation") {
    console.error(
      `[check-audit-drift] anchor FAIL catalog inflation ${missing.id} — ` +
        missing.description,
    );
  } else if (missing.type === "strict-discovery") {
    console.error(
      `[check-audit-drift] FAIL strict discovery — ${missing.description}: ` +
        missing.matches.join(", "),
    );
  } else {
    console.error(
      `[check-audit-drift] anchor FAIL ${missing.id} (${missing.adr}) — ` +
        `no file matches ${missing.glob} (${missing.description})`,
    );
  }
  failures += 1;
}
// Surface new canonical-shape regression tests that are not in the anchor
// catalog. Default mode is advisory; `--strict` makes these discoveries fatal.
for (const d of anchorReport.discovered ?? []) {
  const basename = d.split("/").pop() ?? d;
  console.log(
    `[check-audit-drift] anchor NEW ${basename} discovered — not yet anchored (add to scripts/audit-anchors.mjs ANCHORS[] to formalize)`,
  );
}
const missingAnchorCount = anchorReport.failures.filter(
  (failure) => !failure.type,
).length;
const proBoundarySkips = anchorReport.present.filter(
  (present) => present.proBoundarySkip,
).length;
const discoveryPolicy = strictDiscovery ? "strict" : "advisory";
console.log(
  `[check-audit-drift] anchor totals: ${anchorReport.present.length}/${anchorReport.total} present ` +
    `(${proBoundarySkips} skipped by the Open Core Pro boundary), ${missingAnchorCount} missing, ` +
    `${anchorReport.discovered?.length ?? 0} discovered (${discoveryPolicy})`,
);

if (process.argv.includes("--fix")) {
  const next = {
    locales: Object.fromEntries(
      Object.entries(perLang).map(([lang, counts]) => [
        lang,
        { issues: counts.a + counts.b },
      ]),
    ),
    unique,
    total,
    all29,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `[check-audit-drift] baseline updated: ${Object.keys(perLang).length} locales, unique=${unique}`,
  );
}

if (failures > 0) {
  console.error(`[check-audit-drift] ${failures} failure(s)`);
  process.exit(1);
}
