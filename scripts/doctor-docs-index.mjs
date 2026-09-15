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
  'docs/audit-report-2026-09-02.md',
  'docs/audit-report-2026-09-04.md',
  'docs/architecture.md',
  'docs/drill-run-2026-08-31-rollback-docker.md',
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
    { file: 'docs/audit-report-2026-09-02.md', state: 'vivo', note: 'Informe de auditoría concreto con hallazgos B-1, M-1 y derivados. Enlazado de forma activa.' },
    { file: 'docs/audit-report-2026-09-04.md', state: 'vivo', note: 'Informe de re-verificación; referencia el bloqueo legal del ROPA y gates.' },
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
    { file: 'docs/history-attribution.md', state: 'archivo', note: 'Atribución histórica; útil como registro, no como fuente principal actual.' },
    { file: 'docs/drill-run-2026-08-31-rollback-docker.md', state: 'archivo', note: 'Evidencia concreta de un drill histórico; el estado vivo lo tiene `docs/operations.md`.' },
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
    'Nota: `docs/drill-run-2026-08-31-rollback-docker.md` se clasifica como `archivo`, no como `retirable`, porque el repositorio tiende a mantener evidencia histórica. Esta fase **no lo retira**. Enfocamos la retirada solo en documentos que cumplan `retirable` y que además no sean necesarios para la cadena histórica.',
    '',
    '## Decisión para esta fase',
    '',
    'Esta fase **no retira archivos**. La clasificación confirma que:',
    '',
    '- No hay documentos en estado `retirable`.',
    '- Hay exactamente dos documentos en estado `archivo`: `docs/history-attribution.md` y `docs/drill-run-2026-08-31-rollback-docker.md`.',
    '- El resto está `vivo`.',
    '',
    'Si en el futuro un documento pasa a `retirable`, este índice debe actualizarse antes de tocar el filesystem, y la retirada debe incluir:',
    '1. Actualización de `docs/docs-state-index.md`.',
    '2. Búsqueda de referencias locales en `docs/`, `.github/`, `scripts/`, `src/tests/`, `AGENTS.md` y `CONTRIBUTING.md`.',
    '3. Confirmación de que el documento retirado era realmente alcanzable desde los canales vivos antes de borrarlo.',
    '',
    '## Registro de cambios de esta fase',
    '',
    '- Se crea `docs/docs-state-index.md` como índice autoritativo de estado documental.',
    '- No se eliminan documentos en esta fase porque la clasificación no encontró candidatos `retirable` sin valor histórico.',
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
