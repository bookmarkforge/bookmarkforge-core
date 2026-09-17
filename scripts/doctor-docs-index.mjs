#!/usr/bin/env node
/**
 * scripts/doctor-docs-index.mjs
 *
 * Re-derives the intended state of docs/docs-state-index.md from the
 * repository itself and then asserts that the on-disk index matches.
 *
 * Current behavior:
 *  - Reads docs/docs-state-index.md
 *  - Re-derives ADR coverage from the ADR files that exist in docs/
 *  - Checks that every file referenced in the index actually exists
 *  - Fails if the on-disk index does not match the generated canonical form
 *
 * This script intentionally does not delete or rewrite docs files by default.
 * Use `--update` only when you want the canonical form written back.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = path.resolve(ROOT, 'docs/docs-state-index.md');
const ADR_FILES = fs
  .readdirSync(path.resolve(ROOT, 'docs'))
  .filter((name) => /^ADR-\d+-/.test(name) && name.endsWith('.md'))
  .sort((a, b) => a.localeCompare(b));

const KNOWN_DOC_FILES = new Set([
  'docs/legacy-schema-version-map.md',
  'docs/ROPA.md',
  'docs/api.md',
  'docs/audit.md',
  'docs/SELF-HOSTING.md',
  'docs/index.md',
  'docs/docs-state-index.md',
  'docs/launch-day-smoke.md',
  'docs/support-data-loss-runbook.md',
  'docs/scripts-inventory-scanner-limits.md',
  'docs/edge-case-hardening-vault-audit.md',
  'docs/pricing-decision.md',
  'docs/onboarding-emails.md',
  'docs/ios-manual-test-script.md',
  'docs/ios-day0-session-sheet.md',
  'docs/p2p-sync-manual-test-script.md',
  'docs/p2p-sync-session-prep.md',
  'docs/audit-report-2026-09-02.md',
  'docs/audit-report-2026-09-04.md',
  'docs/architecture.md',
  'docs/drill-run-2026-08-31-rollback-docker.md',
  'docs/deployment-runbook.md',
  'docs/github-secrets-and-push-runbook.md',
  'docs/google-search-runbook.md',
  'docs/history-attribution.md',
  'docs/internal-security-checklist.md',
  'docs/launch-checklist.md',
  'docs/legacy-compatibility-plan.md',
  'docs/legal-closing-package.md',
  'docs/openapi.yaml',
  'docs/ops-nightly.md',
  'docs/operations.md',
  'docs/que-nos-falta.md',
  'docs/release-note-r3-4.md',
  'docs/sast-triage.md',
  'docs/security.md',
  'docs/server-api-index.md',
  'docs/staging-smoke.md',
  ...ADR_FILES.map((f) => 'docs/' + f),
]);

function parseStateIndex(markdownText) {
  const lines = markdownText.split('\n');
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Documento | Estado | Nota |')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (trimmed.startsWith('|---')) {
        continue;
      }
      if (trimmed.startsWith('|')) {
        const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 3) {
          rows.push({
            file: cells[0].replace(/`/g, '').trim(),
            state: cells[1].trim(),
            note: cells[2].trim(),
          });
        } else {
          break;
        }
      } else {
        inTable = false;
      }
    }
  }

  return rows;
}

function generateCanonicalIndex() {
  const rows = [];

  const plainDocs = [
    { file: 'docs/audit.md', state: 'vivo', note: 'Fuente principal de auditoría continua y ledger de hallazgos.' },
    { file: 'docs/audit-report-2026-09-02.md', state: 'archivo', note: 'Informe de auditoría puntual (hallazgos B-1, M-1 y derivados), absorbido por `docs/audit.md`. Se conserva como evidencia.' },
    { file: 'docs/audit-report-2026-09-04.md', state: 'archivo', note: 'Re-verificación puntual, absorbida por `docs/audit.md`. Se conserva como evidencia.' },
    { file: 'docs/operations.md', state: 'vivo', note: 'Operaciones, SLOs de referencia, drills, gates nocturnos, evidencia.' },
    { file: 'docs/ops-nightly.md', state: 'vivo', note: 'Operaciones nocturnas, anclas de auditoría, gates.' },
    { file: 'docs/launch-checklist.md', state: 'vivo', note: 'Checklist de lanzamiento; fuente de varios gates automatizados.' },
    { file: 'docs/legal-closing-package.md', state: 'vivo', note: 'Paquete de cierre legal: relleno del ROPA, DPAs por proveedor, orden de firma y plantillas. Evidencia del punto 5 del launch-checklist.' },
    { file: 'docs/security.md', state: 'vivo', note: 'Controles de seguridad, RGPD, configuración obligatoria de producción.' },
    { file: 'docs/ROPA.md', state: 'vivo', note: 'Inventario RGPD; contiene campos operativos/legales por completar.' },
    { file: 'docs/architecture.md', state: 'vivo', note: 'Arquitectura y decisiones pendientes.' },
    { file: 'docs/api.md', state: 'vivo', note: 'Vista general de la API del servidor acompañante.' },
    { file: 'docs/openapi.yaml', state: 'vivo', note: 'Especificación OpenAPI 3.1.0 del servidor acompañante.' },
    { file: 'docs/server-api-index.md', state: 'vivo', note: 'Índice detallado de endpoints del servidor.' },
    { file: 'docs/legacy-compatibility-plan.md', state: 'vivo', note: 'Plan de compatibilidad/migración de formatos old.' },
    { file: 'docs/legacy-schema-version-map.md', state: 'vivo', note: 'Registro versionado de esquemas RxDB activos; se genera desde src/db/schema.ts para diagnóstico de compatibilidad sin acceso al vault.' },
    { file: 'docs/internal-security-checklist.md', state: 'vivo', note: 'Checklist interno de seguridad.' },
    { file: 'docs/github-secrets-and-push-runbook.md', state: 'vivo', note: 'Runbook de secretos y push.' },
    { file: 'docs/google-search-runbook.md', state: 'vivo', note: 'Runbook de Google Search: Search Console, envío del sitemap y cobertura noindex de /app.' },
    { file: 'docs/sast-triage.md', state: 'vivo', note: 'Guía de triaje SAST.' },
    { file: 'docs/staging-smoke.md', state: 'vivo', note: 'Notas de smoke de staging.' },
    { file: 'docs/release-note-r3-4.md', state: 'vivo', note: 'Notas de release.' },
    { file: 'docs/que-nos-falta.md', state: 'vivo', note: 'Resumen de deudas pendientes.' },
    { file: 'docs/index.md', state: 'vivo', note: 'Índice de navegación de la documentación.' },
    { file: 'docs/docs-state-index.md', state: 'vivo', note: 'Inventario autoritativo del estado documental (este mismo archivo).' },
    { file: 'docs/SELF-HOSTING.md', state: 'vivo', note: 'Guía interna de self-hosting; no entra en el export público.' },
    { file: 'docs/launch-day-smoke.md', state: 'vivo', note: 'Runbook del smoke del día de lanzamiento.' },
    { file: 'docs/support-data-loss-runbook.md', state: 'vivo', note: 'Procedimiento ante pérdida de datos reportada por soporte.' },
    { file: 'docs/scripts-inventory-scanner-limits.md', state: 'vivo', note: 'Límites del escáner de inventario de scripts.' },
    { file: 'docs/edge-case-hardening-vault-audit.md', state: 'vivo', note: 'Auditoría de casos límite del vault.' },
    { file: 'docs/pricing-decision.md', state: 'vivo', note: 'Decisión de precios y reparto Free/Pro.' },
    { file: 'docs/onboarding-emails.md', state: 'vivo', note: 'Secuencia de emails de onboarding.' },
    { file: 'docs/ios-manual-test-script.md', state: 'vivo', note: 'Guion de prueba manual en iPhone.' },
    { file: 'docs/ios-day0-session-sheet.md', state: 'vivo', note: 'Hoja de sesión del día 0 en iOS.' },
    { file: 'docs/p2p-sync-manual-test-script.md', state: 'vivo', note: 'Guion de prueba manual del sync P2P.' },
    { file: 'docs/p2p-sync-session-prep.md', state: 'vivo', note: 'Preparación de la sesión de sync P2P.' },
    { file: 'docs/history-attribution.md', state: 'archivo', note: 'Atribución histórica; útil como registro, no como fuente principal actual.' },
    { file: 'docs/drill-run-2026-08-31-rollback-docker.md', state: 'archivo', note: 'Evidencia concreta de un drill histórico; el estado vivo lo tiene `docs/operations.md`.' },
    { file: 'docs/deployment-runbook.md', state: 'vivo', note: 'Checklist operativo para desplegar el checkout actual y cerrar A11-2 con probes públicas.' },
    { file: 'docs/ADR-001-check-static-brand.md', state: 'vivo', note: 'ADR de registro de gate; útil como registro, sin circuito activo actual.' },
  ];

  for (const entry of plainDocs) {
    rows.push(entry);
  }

  for (const file of ADR_FILES) {
    if (rows.some((r) => r.file === 'docs/' + file)) {
      continue;
    }
    rows.push({ file: 'docs/' + file, state: 'vivo', note: 'ADR oficial del proyecto.' });
  }

  rows.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return 0;
  });

  const tableRows = rows.map((r) => `| \`${r.file}\` | ${r.state} | ${r.note} |`);
  return [
    '# Inventario de documentos — BookmarkForge',
    '',
    'Este archivo es la fuente de verdad sobre el estado de la documentación del repositorio. No es una guía operativa. Su función es permitir retirar, archivar o renombrar documentos con trazabilidad y sin romper referencias vivas.',
    '',
    '## Convención de estados',
    '',
    '| Estado | Significado |',
    '|---|---|',
    '| `vivo` | Documento activo que el repositorio lee en CI, gates, README o flujos reales. |',
    '| `transitorio` | Documento útil pero pendiente de consolidar, migrar o desduplicar. |',
    '| `archivo` | Documento histórico valioso pero fuera del camino crítico; se conserva, no se enlaza como fuente principal. |',
    '| `retirable` | Documento obsoleto, duplicado o ya absorbido por otro; puede eliminarse una vez que no tenga referencias vivas. |',
    '',
    'Decisión: **esta fase solo retira documentos con estado `retirable` y referencias vivas confirmadas como inexistentes o ya actualizadas.**',
    '',
    '## Estado actual',
    '',
    '| Documento | Estado | Nota |',
    '|---|---|---|',
    ...tableRows,
    '',
    'Los documentos en estado `archivo` (`history-attribution`, los dos informes de auditoría fechados y la evidencia del drill de rollback) se conservan a propósito: el repositorio mantiene evidencia histórica y `docs/audit.md` ya los resume. Enfocamos la retirada solo en documentos `retirable` que no sean necesarios para la cadena histórica.',
    '',
    '### Familias que no se listan una por una',
    '',
    '| Familia | Archivos | Estado | Nota |',
    '|---|---|---|---|',
    '| `docs/ADR-*.md` | * (en la tabla) | vivo | Registro de decisiones; `check:audit-drift` los lee por token. |',
    '| `docs/manual-usuario-<locale>.md` | 30 | vivo | Fuente de los manuales de usuario. |',
    '| `docs/manual-usuario-<locale>.pdf` | 30 | vivo | Entregable generado desde el `.md`. |',
    '| `docs/manual-usuario-*-styled.html` | 0 en git | — | Intermedio de `npm run docs:pdf:localized`; dejó de versionarse en 2026-09 y está en `.gitignore`. |',
    '',
    '## Decisión para esta fase (2026-09-17)',
    '',
    'Esta fase **sí retira**, porque la auditoría de la ronda 6 encontró material que ya no describía el repositorio:',
    '',
    '- Retirados 30 `docs/manual-usuario-*-styled.html` (intermedios regenerables, absorbidos por `npm run docs:pdf:localized`); la familia pasa a `.gitignore`.',
    '- Retirada la cadena E2E `e2e:ai-upstream` (config, spec y stub) por no tener sujeto tras la retirada del proxy de IA.',
    '- Reclasificados a `archivo` los dos informes de auditoría fechados, antes `vivo`.',
    '- No se retira ningún `.md`: el repositorio conserva evidencia histórica.',
    '',
    'Si en el futuro un documento pasa a `retirable`, este índice debe actualizarse antes de tocar el filesystem, y la retirada debe incluir:',
    '1. Actualización de `docs/docs-state-index.md`.',
    '2. Búsqueda de referencias locales en `docs/`, `.github/`, `scripts/`, `src/tests/`, `AGENTS.md` y `CONTRIBUTING.md`.',
    '3. Confirmación de que el documento retirado era realmente alcanzable desde los canales vivos antes de borrarlo.',
    '',
    '## Registro de cambios',
    '',
    '- **2026-09-17 —** ronda 11 de auditoría: cobertura del sitemap de 61 URLs alineada con los 30 artefactos de landing y sus rutas `_redirects`/nginx mediante `check:sitemap-coverage`; `docs/google-search-runbook.md` actualizado. Producción está desfasada: `/` sirve el conversor antiguo y las probes de landings/sitemap devuelven 404; queda A11-2 abierto hasta desplegar este checkout. Detalle en `docs/audit.md` → "Ronda 11".',
    '- **2026-09-17 —** ronda 10 de auditoría: cierre de A9-1 — `scripts/nginx-render.mjs` ya no puede destruir `public/_headers` ni `public/sitemap.xml` (pasan a quirúrgicos con guardas y `--write` all-or-nothing; dueño único por archivo documentado en el runbook de Google Search). Drift preexistente corregido en `docs/google-search-runbook.md` (el sitemap real tiene 61 URLs, no 13, y es manual). Detalle en `docs/audit.md` → "Ronda 10".',
    '- **2026-09-17 —** ronda 9 de auditoría: retirada de la superficie muerta del proxy de IA en la capa operativa (nginx generado, smoke de producción, sonda `API_DEGRADADO` y prueba de carga) y de los dos mocks `ai-mock*`; `docs/operations.md`, `docs/architecture.md` y `docs/launch-checklist.md` actualizados para no describir una prueba de carga con fase de IA. Hallazgo cerrado A9-1 en la ronda 10 (`nginx-render --write` sobre `public/_headers`/`public/sitemap.xml`). Detalle en `docs/audit.md` → "Ronda 9".',
    '- **2026-09-17 —** ronda 6 de auditoría: reescritura de `README.md`, `docs/api.md`, `docs/openapi.yaml`, `docs/server-api-index.md` y `docs/SELF-HOSTING.md` para eliminar la documentación fantasma del proxy de IA retirado; alta de la familia `-styled.html` como no versionada; reclasificación de los informes de auditoría fechados. Detalle en `docs/audit.md` → "Ronda 6".',
    '- **2026-09 (fase previa) —** se crea `docs/docs-state-index.md` como índice autoritativo de estado documental; sin retiradas en esa fase.',
  ].join('\n');
}

function writeCanonicalIndex() {
  const canonical = generateCanonicalIndex();
  fs.writeFileSync(INDEX_PATH, canonical, 'utf8');
}

function main() {
  const updateMode = process.argv.includes('--update');

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`Error: expected ${INDEX_PATH} to exist.`);
    process.exit(1);
  }

  const onDisk = fs.readFileSync(INDEX_PATH, 'utf8');
  const canonical = generateCanonicalIndex();

  if (onDisk !== canonical) {
    if (updateMode) {
      writeCanonicalIndex();
      console.log('docs/docs-state-index.md updated to canonical form.');
      process.exit(0);
    }

    console.error('Error: docs/docs-state-index.md has manual drift from the canonical generated form.');
    console.error('Regenerate with: node scripts/doctor-docs-index.mjs --update');
    console.error('--- on-disk vs canonical byte length:', onDisk.length, canonical.length);
    console.error('--- on-disk line count:', onDisk.split('\n').length);
    console.error('--- canonical line count:', canonical.split('\n').length);

    const onDiskRows = parseStateIndex(onDisk);
    const canonicalRows = parseStateIndex(canonical);
    const onDiskSet = new Set(onDiskRows.map((r) => r.file));
    const canonicalSet = new Set(canonicalRows.map((r) => r.file));

    const missingFromDisk = [...canonicalSet].filter((f) => !onDiskSet.has(f));
    const missingFromCanonical = [...onDiskSet].filter((f) => !canonicalSet.has(f));
    const stateChangedRows = [];
    for (const row of onDiskRows) {
      const canonicalRow = canonicalRows.find((r) => r.file === row.file);
      if (!canonicalRow || canonicalRow.state !== row.state) {
        stateChangedRows.push({ file: row.file, onDisk: row.state, canonical: canonicalRow?.state ?? 'missing' });
      }
    }

    if (missingFromDisk.length) {
      console.error('Rows present in canonical but missing from on-disk index:', missingFromDisk.join(', '));
    }
    if (missingFromCanonical.length) {
      console.error('Rows present in on-disk index but missing from canonical:', missingFromCanonical.join(', '));
    }
    if (stateChangedRows.length) {
      console.error('Rows with state differences:', JSON.stringify(stateChangedRows, null, 2));
    }

    if (onDisk === canonical) {
      console.log('docs/docs-state-index.md matches canonical generated form.');
    } else {
      console.error('docs/docs-state-index.md does not match canonical generated form.');
      console.error('Regenerate with: node scripts/doctor-docs-index.mjs --update');
    }

    process.exit(2);
  }

  const rows = parseStateIndex(onDisk);
  const knownFiles = new Set(rows.map((r) => r.file));

  for (const file of knownFiles) {
    if (!KNOWN_DOC_FILES.has(file)) {
      console.error(`Error: docs/docs-state-index.md includes unexpected file: ${file}`);
      process.exit(3);
    }
    if (!fs.existsSync(path.resolve(ROOT, file))) {
      console.error(`Error: docs/docs-state-index.md references missing file: ${file}`);
      process.exit(4);
    }
  }

  for (const file of KNOWN_DOC_FILES) {
    if (!knownFiles.has(file)) {
      console.error(`Error: known file ${file} missing from docs/docs-state-index.md`);
      process.exit(5);
    }
  }

  if (onDisk === canonical) {
    console.log('docs/docs-state-index.md matches canonical generated form.');
  } else {
    console.error('docs/docs-state-index.md does not match canonical generated form.');
    console.error('Regenerate with: node scripts/doctor-docs-index.mjs --update');
  }

  const retirableRows = rows.filter((r) => r.state === 'retirable');
  if (retirableRows.length > 0) {
    console.error('Current index has retirable files; this script does not permit retirement without additional review.');
    console.error('Retirable:', retirableRows.map((r) => r.file).join(', '));
    process.exit(6);
  }

  console.log('docs-state-index checks OK');
  console.log('ADR files considered:', ADR_FILES.length);
  console.log('Known docs files:', KNOWN_DOC_FILES.size);
  console.log('Parsed rows:', rows.length);
}

main();
