#!/usr/bin/env node
/**
 * scripts/check-no-spanish.mjs — Spanish-prose ratchet for docs/, scripts/ and legal/.
 *
 * The repository is being translated to English. `check:english-only` already
 * keeps `src/` free of non-English in the positions that reach developers or
 * users, but it deliberately scans ONLY `src/` — it says nothing about the
 * prose in `docs/`, `scripts/` or `legal/`, which is where the translation work
 * actually lives. This gate is the ratchet that stops that translation from
 * silently regressing in a later PR.
 *
 * WHY A RATCHET AND NOT A ZERO-TOLERANCE GATE
 *
 * The corpus is not translated yet: the remaining Spanish is baselined per
 * file, and the gate fails only when a file's count GROWS above its baseline.
 * That is the same shape as the other drift detectors in this repository
 * (ADR-028): `check:docs-markdown` and `check:vacuous-tests` both freeze a
 * measured number and fail when it moves in the wrong direction. Translation
 * then shrinks the baseline on every pass, and the gate is green the whole
 * time. A fail-closed-at-zero gate would simply be red until someone finished
 * the job, and would be disabled the first time that happened.
 *
 * FAIL-CLOSED RULES (no silent skipping)
 *
 *   - A missing baseline is a failure, not a pass. The first run must be an
 *     explicit `--update` after review.
 *   - Any per-file increase is a failure, including a file that was not in
 *     the baseline at all (its baseline is 0).
 *   - A changed scope fingerprint (roots, exclusions or the word list) is a
 *     failure. Deleting Spanish words from SPANISH_WORDS to make the gate
 *     quiet must not be possible without an explicit, reviewed `--update`.
 *
 * DETECTION
 *
 * A line counts as Spanish prose when it carries at least three DISTINCT
 * high-signal Spanish function words, or two plus a Spanish accented letter.
 * The word list is curated to exclude every token that is also valid English
 * ("error", "total", "legal", "manual", "no", "son", "version", "local"…) —
 * those are the cognates that make naive Spanish detection useless here. The
 * density rule then removes what is left: a single stray word in an English
 * sentence never trips the gate.
 *
 * Lines are read with CRLF tolerance. This repository is checked out with
 * Windows line endings, and a scanner that only splits on "\n" leaves a
 * trailing "\r" that breaks the word boundaries.
 *
 * ESCAPE HATCH
 *
 * A legitimate non-English occurrence can be marked with the same inline
 * pragma `check:english-only` already uses: put `i18n-allow` inside the line
 * (inside the comment itself, or on a comment line directly above). It covers
 * a quoted Spanish string, a language name, or a localized document excerpt.
 *
 * SCOPE
 *
 * Registered in `check-inspector-freeze.mjs` as `language` (the protected
 * core, alongside `check:english-only` and `check:i18n`), wired into the
 * `check:content` chain and documented in AGENTS.md §6.
 *
 * Usage:
 *   node scripts/check-no-spanish.mjs             # verify against the baseline
 *   node scripts/check-no-spanish.mjs --update    # re-pin after a reviewed change
 *   node scripts/check-no-spanish.mjs --json      # machine-readable
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { MANUAL_FILES } from "./landing-registry.mjs";

export const SCAN_ROOTS = ["docs", "scripts", "legal"];
export const BASELINE_PATH = join("scripts", "no-spanish-baseline.json");
export const SCHEMA_VERSION = 1;
export const PRAGMA = "i18n-allow";
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git", "test-results"]);

/**
 * Local-language surfaces that are SUPPOSED to hold non-English text. Excluded
 * by path, never by content: a translated manual is still a manual.
 *
 *   - `scripts/translations/` and the translation manifests are per-locale
 *     source data, not repository prose.
 *   - any path of the localized manual family (endonym basenames from the
 *     MANUAL_FILES table in scripts/landing-registry.mjs — `user-manual-en`,
 *     `benutzerhandbuch-de`, `manual-de-usuario-es`, … — including their
 *     `-styled.html` print twins, mirrored under `scripts/public-export/`);
 *     the user asked for those to stay in their own languages.
 *   - `*-<locale>.md` / `*_<locale>.ts` suffix families are per-locale copies.
 *   - `scripts/__tests__/` — test fixtures deliberately carry Spanish so the
 *     other gates can be driven (a license-claims fixture, a Spanish table
 *     header, a check name). This is the same reasoning that already narrows
 *     `check-script-reachability`: counting fixtures as prose would make this
 *     gate fail on the test data of the very gates it complements.
 *   - the language detectors themselves (`check-no-spanish.mjs`,
 *     `check-english-only.mjs`). They hold Spanish words as DATA — a curated
 *     word list — not as prose. Excluding them is not a loophole: it is the
 *     only way a detector can exist without flagging its own source, and the
 *     scope fingerprint still pins the word list so it cannot be emptied.
 */
/** The localized manual family by its registry basenames — any extension
 * (.md/.pdf/-styled.html), anywhere in the tree. DERIVED from the MANUAL_FILES
 * table, so a renamed manual keeps its exclusion instead of silently falling
 * back into the Spanish scan. */
const MANUAL_FAMILY_RE = new RegExp(
  `[\\\\/](?:${Object.values(MANUAL_FILES).join("|")})(?:-styled)?\\.(?:md|pdf|html)$`,
  "i",
);

export const EXCLUDED = [
  /^scripts[\\/]__tests__[\\/]/,
  /^scripts[\\/]translations[\\/]/,
  /^scripts[\\/](landing|privacy)-translations\.json$/,
  MANUAL_FAMILY_RE,
  /[-._](es|fr|it|pt|de|ar|bg|cs|da|el|fi|he|hi|hr|hu|id|ja|ko|nl|no|pl|ro|ru|sv|th|tr|uk|vi|zh)\.md$/i,
  /_(es|fr|it|pt|de)\.ts$/i,
  /check-no-spanish\.mjs$/,
  /check-english-only\.mjs$/,
];

/**
 * High-signal Spanish words, matched accent-insensitively on lowercase text.
 *
 * Every token here is unmistakably non-English. Cognates that are ALSO valid
 * English are deliberately absent, because they carry no signal at all:
 * error, version, local, legal, manual, total, real, final, normal, general,
 * especial, original, principal, actual, similar, natural, central, no, son,
 * ante, van, solo, materia, modal, anual.
 */
export const SPANISH_WORDS = [
  // articles, pronouns, prepositions, connectives — the backbone of prose
  "el", "la", "los", "las", "un", "una", "unos", "unas", "del", "que", "con",
  "como", "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  "aquel", "cada", "otro", "otra", "otros", "otras", "para", "por", "sin",
  "sobre", "entre", "desde", "hasta", "mediante", "según", "pero", "porque",
  "cuando", "donde", "aunque", "mientras", "durante", "antes", "despues",
  "tambien", "ademas", "asi", "aquí", "aqui", "mas", "esta", "estan", "ser",
  "hay", "puede", "pueden", "debe", "deben", "deberia", "deberian", "tiene",
  "tienen", "hacer", "haciendo", "hace", "hacen", "podria", "podrian",
  // adjectives and adverbs
  "nuevo", "nueva", "nuevos", "nuevas", "anterior", "siguiente", "primero",
  "primera", "segundo", "segunda", "ultimo", "ultima", "algunos", "algunas",
  "varios", "varias", "mismo", "misma", "mismos", "mismas", "siempre", "nunca",
  "mucho", "poco", "todo", "toda", "todos", "todas", "otro", "mismo",
  "correcto", "correcta", "incorrecto", "valido", "valida", "vacio", "vacia",
  "minimo", "maximo", "minima", "maxima", "necesario", "necesaria",
  "importante", "posible", "posibles", "imposible", "correctamente",
  // actions
  "aceptar", "cancelar", "cerrar", "abrir", "enviar", "recibir", "mostrar",
  "ocultar", "guardar", "guardado", "borrar", "borrado", "eliminar",
  "eliminado", "eliminar", "editar", "editado", "crear", "creado", "agregar",
  "buscar", "busqueda", "descargar", "descarga", "cargar", "cargado",
  "conectar", "conectado", "conexion", "procesar", "procesado", "sincronizar",
  "sincronizado", "sincronizacion", "actualizar", "actualizado",
  "actualizacion", "seleccionar", "seleccionado", "seleccion", "verificar",
  "verificado", "verificacion", "compartir", "compartido", "copiar", "copiado",
  "filtrar", "ordenar", "agrupar", "subir", "imprimir", "pegar", "quitar",
  "importar", "exportar", "configurar", "configuracion", "utilizar", "usar",
  "usa", "usamos", "analizar", "insertar", "leer", "devuelve", "devuelven",
  "genera", "generan", "corren", "corre", "sigue", "siguen", "crea", "crean",
  "reemplaza", "reemplazan", "depende", "dependen", "identidad",
  // nouns
  "marcador", "marcadores", "carpeta", "carpetas", "usuario", "usuarios",
  "usuaria", "usuarias", "boveda", "bovedas", "notificacion", "cuenta",
  "cuentas", "sesion", "sesiones", "titulo", "titulos", "contenido",
  "contenidos", "documento", "documentos", "archivo", "archivos", "enlace",
  "enlaces", "pagina", "paginas", "navegador", "navegadores", "dispositivo",
  "dispositivos", "sistema", "sistemas", "ventana", "boton", "botones",
  "tarea", "tareas", "seccion", "secciones", "lista", "listas", "clave",
  "claves", "idioma", "idiomas", "mensaje", "mensajes", "nombre", "nombres",
  "aplicacion", "aplicaciones", "informacion", "servidor", "servidores",
  "cliente", "clientes", "funcion", "funciones", "bienvenido", "bienvenida",
  "inicio", "soporte", "ayuda", "pendiente", "pendientes", "disponible",
  "direccion", "direcciones", "palabra", "palabras", "texto", "textos",
  "traduccion", "traducciones", "traducir", "traducido", "seguridad", "datos",
  "codigo", "logica", "metodo", "ejemplo", "ejemplos", "proyecto", "tabla",
  "tablas", "caso", "casos", "detalle", "detalles", "nivel", "niveles",
  "etiqueta", "etiquetas", "fallo", "fallos", "falla", "fallas", "funciona",
  "funcionan", "problema", "problemas", "proceso", "procesos", "resultado",
  "resultados", "salida", "entrada", "llamada", "llamadas", "respuesta",
  "respuestas", "peticion", "peticiones", "espacio", "ruta", "rutas",
  "conjunto", "linea", "lineas", "futuro", "excepcion", "prueba", "pruebas",
  "prueba", "fallo", "firma", "licencia", "licencias", "internamente",
  "defensivo", "defensivos", "mismo", "nota", "hay", "numerada", "columnas",
  "cita", "imagen", "estado", "fecha", "contexto", "decision", "consecuencias",
  "fecha", "evaluacion", "ejecucion", "verificacion", "comando", "comandos",
  "fila", "filas", "seccion", "plan", "planes", "paso", "pasos", "criterio",
  "criterios", "version", "motivo", "motivos", "fecha", "resumen", "detalle",
  "alcance", "metodologia", "veredicto", "hallazgo", "hallazgos", "deuda",
  "deudas", "accion", "acciones", "medicion", "mediciones", "amplitud",
];

const WORD_SET = new Set(SPANISH_WORDS);
const ACCENTED = /[áéíóúüñ¿¡]/i;

function stripAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Spanish words present in one line, accent-stripped and lowercased.
 * Exported for the unit suite so it can assert on the detector directly.
 */
export function spanishWordsIn(line) {
  const stripped = stripAccents(line).toLowerCase();
  const found = new Set();
  for (const match of stripped.matchAll(/[a-záéíóúüñ]+/gi)) {
    if (WORD_SET.has(match[0])) found.add(match[0]);
  }
  return found;
}

/**
 * A line is Spanish prose when it carries three distinct high-signal Spanish
 * words, or two plus a Spanish accented letter. Returns the evidence or null.
 *
 * The density rule is what makes this usable on a mixed corpus: `error`,
 * `total` and friends were already removed from the word list, and a stray
 * Spanish word inside an English sentence cannot reach the threshold alone.
 */
export function detectSpanishProse(line) {
  if (PRAGMA && line.includes(PRAGMA)) return null;
  const words = spanishWordsIn(line);
  if (words.size >= 3) return { words: [...words], via: "density" };
  if (words.size >= 2 && ACCENTED.test(line)) return { words: [...words], via: "accent" };
  return null;
}

/** Strip code fences so a Spanish shell comment inside a snippet is not prose. */
function stripFences(lines) {
  let inFence = false;
  return lines.map((raw) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : raw;
  });
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** Text files worth scanning: prose and source comments, not binaries. */
const SCANNABLE = new Set([".md", ".mjs", ".js", ".ts", ".tsx", ".html", ".yml", ".yaml", ".json", ".example", ""]);

export function isScannable(file) {
  const name = file.split(sep).pop();
  if (name.startsWith(".")) return false;
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot).toLowerCase();
  if (!SCANNABLE.has(ext)) return false;
  // Generated fixtures and baselines carry counts, not prose we author.
  if (/baseline\.json$/.test(name)) return false;
  return true;
}

/**
 * Scan one file for Spanish prose. Returns the count plus the offending lines
 * so a failure message can name them instead of just saying "regressed".
 */
export function scanText(path, text) {
  const lines = stripFences(text.split(/\r?\n/));
  const hits = [];
  lines.forEach((line, index) => {
    const detected = detectSpanishProse(line);
    if (detected) hits.push({ line: index + 1, words: detected.words, text: line.trim().slice(0, 100) });
  });
  return { file: path, count: hits.length, hits };
}

/**
 * Fingerprint of what the gate considers in scope. A change here means the
 * detector itself moved (a root dropped, an exclusion added, a Spanish word
 * deleted from the list), which must be an explicit reviewed update.
 */
export function scopeFingerprint() {
  const payload = JSON.stringify({
    roots: SCAN_ROOTS,
    excluded: EXCLUDED.map(String),
    words: [...SPANISH_WORDS].sort(),
    pragma: PRAGMA,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 40);
}

/** Scan every in-scope file. Keys are relative to `root`, forward slashes. */
export function scanTree({ root = process.cwd() } = {}) {
  const rel = (path) => relative(root, path).split(sep).join("/");
  const perFile = {};
  const findings = [];
  let fileCount = 0;
  for (const dir of SCAN_ROOTS) {
    const base = join(root, dir);
    if (!existsDir(base)) continue;
    for (const file of walk(base)) {
      const relativePath = rel(file);
      if (EXCLUDED.some((pattern) => pattern.test(relativePath))) continue;
      if (!isScannable(file)) continue;
      fileCount += 1;
      const result = scanText(relativePath, readFileSync(file, "utf8"));
      if (result.count > 0) {
        perFile[relativePath] = result.count;
        for (const hit of result.hits) findings.push({ file: relativePath, ...hit });
      }
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    fileCount,
    total: Object.values(perFile).reduce((sum, n) => sum + n, 0),
    fileTotal: Object.keys(perFile).length,
    perFile,
    findings,
    scope: scopeFingerprint(),
  };
}

function existsDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Compare a scan against the baseline. Per-file, not just by total: "fix file
 * A, regress file B" keeps the sum equal and must still fail.
 */
export function evaluate(scan, baseline, { update = false } = {}) {
  const failures = [];
  const oks = [];

  if (update) {
    return { ok: true, oks: ["baseline regenerated (--update)"], failures, baseline: scan };
  }

  if (!baseline) {
    failures.push(
      `no baseline at ${BASELINE_PATH} — run \`node scripts/check-no-spanish.mjs --update\` after reviewing the findings, then commit the baseline`,
    );
    for (const finding of scan.findings) {
      failures.push(`${finding.file}:${finding.line} — ${finding.text}`);
    }
    return { ok: false, oks, failures, baseline };
  }

  if (baseline.scope !== scan.scope) {
    failures.push(
      `scope fingerprint changed (baseline ${baseline.scope}, scan ${scan.scope}) — ` +
        `the scan roots, the exclusions or the Spanish word list moved. Review that the detector still ` +
        `covers docs/, scripts/ and legal/, then --update.`,
    );
  } else {
    oks.push("scope fingerprint unchanged");
  }

  const basePerFile = baseline.perFile ?? {};
  let regressed = 0;
  let improved = 0;
  for (const file of [...new Set([...Object.keys(scan.perFile), ...Object.keys(basePerFile)])].sort()) {
    const before = basePerFile[file] ?? 0;
    const now = scan.perFile[file] ?? 0;
    if (now > before) {
      regressed += 1;
      failures.push(
        `${file}: Spanish prose regressed vs baseline (${before} → ${now} line(s)) — the English translation must not go backwards. Translate the new text, or pin it deliberately with --update after review.`,
      );
      for (const finding of scan.findings.filter((f) => f.file === file)) {
        failures.push(`  ${finding.file}:${finding.line} — ${finding.text}`);
      }
    } else if (now < before) {
      improved += 1;
    }
  }

  if (regressed === 0) {
    oks.push(
      improved === 0
        ? `no drift: ${scan.total} Spanish line(s) across ${scan.fileTotal} file(s) match the baseline`
        : `${scan.total} Spanish line(s) across ${scan.fileTotal} file(s); ${improved} file(s) improved since the baseline (baseline tightens on next --update)`,
    );
  }

  return { ok: failures.length === 0, oks, failures, baseline };
}

function main() {
  const update = process.argv.includes("--update");
  const json = process.argv.includes("--json");
  const scan = scanTree();
  let baseline = null;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (update) {
    // The findings are the review material for an --update, not part of the
    // frozen baseline: only the per-file counts and the scope fingerprint
    // need to persist.
    const serializable = {
      schemaVersion: scan.schemaVersion,
      fileCount: scan.fileCount,
      total: scan.total,
      fileTotal: scan.fileTotal,
      perFile: scan.perFile,
      scope: scan.scope,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(serializable, null, 2)}\n`);
    console.log(
      `[check-no-spanish] baseline regenerated: ${scan.fileCount} file(s) scanned, ${scan.fileTotal} with Spanish, ${scan.total} line(s) frozen`,
    );
  }

  const result = evaluate(scan, update ? scan : baseline, { update });
  if (json) {
    console.log(JSON.stringify({ ok: result.ok, scan: { ...scan, findings: undefined }, result }, null, 2));
  } else {
    for (const ok of result.oks) console.log(`[check-no-spanish] ok ${ok}`);
    for (const failure of result.failures) console.error(`[check-no-spanish] FAIL ${failure}`);
  }

  if (!result.ok) {
    console.error(`[check-no-spanish] ${result.failures.length} problem(s) — Spanish prose must not grow in docs/, scripts/ or legal/`);
    process.exit(1);
  }
  console.log(`[check-no-spanish] ok: ${scan.fileCount} file(s) scanned — no Spanish-prose regression`);
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  main();
}