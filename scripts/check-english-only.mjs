/**
 * check-english-only.mjs — English-only source gate.
 *
 * Fails when non-English text regresses into the code positions that reach
 * developers or users, anywhere under src/:
 *
 *   1. i18n fallbacks — the second string argument of t("key", "...")
 *   2. log messages   — the first string argument of logger.* / console.*
 *   3. comments       — // and /* *\/ comments (JSDoc included)
 *   4. JSX text       — raw text nodes between JSX tags
 *   5. UI strings     — placeholder/title/aria-*\/alt\/label\/description
 *      attribute values and toast/alert/confirm/prompt first arguments
 *
 * Detection is deliberately conservative so it never flags legitimate
 * non-English that lives in DATA — language names (Ελληνικά, עברית,
 * हिन्दी, Tiếng Việt), slash-menu search keywords, bilingual AI prompts
 * (lang === "es" ? … : …), test fixtures — none of which sit in the three
 * code positions above:
 *
 *   - Non-English letters: accented Latin letters (Latin-1 supplement +
 *     Latin Extended) and non-Latin scripts (Greek, Cyrillic, Arabic,
 *     Hebrew, Devanagari, Thai, Vietnamese, CJK, Hangul). Typographic
 *     symbols (× – ≥ …) are not letters and are deliberately ignored.
 *   - Accent-less Spanish words: a curated list of unmistakably-Spanish
 *     tokens matched on accent-stripped text, so "configuracion" is caught
 *     even without its accent. Ambiguous cognates ("error", "version",
 *     "local", "mover") are excluded on purpose.
 *
 * A legitimate non-English occurrence in one of the three positions can be
 * marked with an inline `i18n-allow` pragma — inside the comment itself,
 * or on the line that contains the flagged string.
 *
 * Usage:
 *   node scripts/check-english-only.mjs        # CI gate (exit 1 on findings)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getCachedVerdict, putCachedVerdict, treeFingerprint } from "./gate-cache.mjs";

export const SRC_DIR = "src";
export const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "dist-extension"]);
export const PRAGMA = "i18n-allow";

const GATE_CACHE_NAME = "check-english-only";

// Letters that never appear in English prose. Ranges deliberately skip the
// two Latin-1 punctuation marks (× \u00D7 and ÷ \u00F7).
const NON_ENGLISH_LETTER =
  /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u1E00-\u1EFF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// Unmistakably-Spanish words (accent-stripped ASCII forms) — never valid
// English, so a match is a strong non-English signal even when the Spanish
// is written without its accents.
const SPANISH_WORDS = [
  // actions
  "aceptar", "cancelar", "cerrar", "abrir", "enviar", "recibir", "mostrar",
  "ocultar", "guardar", "guardado", "guardada", "guardados", "guardadas",
  "guardando", "borrar", "borrando", "borrado", "borrada", "eliminar",
  "eliminando", "eliminado", "eliminada", "editar", "editando", "editado",
  "editada", "crear", "creando", "creado", "creada", "agregar", "agregando",
  "agregado", "agregada", "buscar", "buscando", "busqueda", "descargar",
  "descargando", "descargado", "descargada", "descarga", "cargando", "cargar",
  "cargado", "cargada", "conectar", "conectando", "conectado", "conectada",
  "conexion", "conexiones", "procesar", "procesando", "procesado",
  "procesada", "procesa", "sincronizar", "sincronizando", "sincronizado",
  "sincronizada", "sincronizacion", "actualizar", "actualizando",
  "actualizado", "actualizada", "actualizacion", "actualizaciones",
  "seleccionar", "seleccionando", "seleccionado", "seleccionada",
  "selecciona", "seleccion", "verificar", "verificando", "verificado",
  "verificada", "verificacion", "compartir", "compartiendo", "compartido",
  "compartida", "copiar", "copiando", "copiado", "copiada", "filtrar",
  "ordenar", "agrupar", "subir", "imprimir", "pegar", "quitar", "importar",
  "exportar",
  // nouns
  "marcador", "marcadores", "carpeta", "carpetas", "usuario", "usuarios",
  "usuaria", "usuarias", "configuracion", "configuraciones", "configurar",
  "contrasena", "boveda", "bovedas", "notificacion", "notificaciones",
  "cuenta", "cuentas", "sesion", "sesiones", "titulo", "titulos",
  "contenido", "contenidos", "documento", "documentos", "archivo", "archivos",
  "enlace", "enlaces", "pagina", "paginas", "navegador", "navegadores",
  "dispositivo", "dispositivos", "sistema", "sistemas", "ventana", "ventanas",
  "boton", "botones", "tarea", "tareas", "seccion", "secciones", "lista",
  "listas", "clave", "claves", "idioma", "idiomas", "mensaje", "mensajes",
  "nombre", "nombres", "aplicacion", "aplicaciones", "informacion",
  "servidor", "servidores", "cliente", "versiones", "funcion", "funciones",
  "bienvenido", "bienvenida", "bienvenidos", "inicio", "soporte", "ayuda",
  "pendiente", "pendientes", "disponible", "disponibles", "direccion",
  "direcciones", "hola", "gracias", "palabra", "palabras", "texto", "textos",
  "traduccion", "traducciones", "traducir", "traducido", "traducida",
  // function words / adjectives (accent-stripped) — common in prose
  "para", "sobre", "desde", "hasta", "entre", "mediante", "aunque",
  "ademas", "despues", "antes", "durante", "mientras", "siempre",
  "nunca", "tambien", "varios", "varias", "nuevo", "nueva", "nuevos",
  "nuevas", "viejo", "vieja", "anterior", "siguiente", "primero",
  "primera", "segundo", "segunda", "tercero", "tercera", "ultimo",
  "ultima", "cada", "todos", "todas", "algunos", "algunas", "otro",
  "otra", "otros", "otras", "puede", "pueden", "debe", "deben",
  "deberia", "deberian", "hacer", "haciendo", "hace", "hacen", "hizo",
  "haria", "podria", "podrian", "tabla", "tablas", "caso", "casos",
  "detalle", "detalles", "nivel", "niveles", "etiqueta", "etiquetas",
  "fallo", "fallos", "falla", "fallas", "funciona", "funcionan",
  "problema", "problemas", "proceso", "procesos", "resultado",
  "resultados", "salida", "entrada", "llamada", "llamadas", "respuesta",
  "respuestas", "peticion", "peticiones", "dato", "datos", "espacio",
  "ruta", "rutas", "conjunto", "linea", "lineas", "codigo", "logica",
  "metodo", "ejemplo", "ejemplos", "futuro", "posible",
  "posibles", "imposible", "necesario", "necesaria", "importante",
  "correcto", "correcta", "incorrecto", "valido", "valida", "vacio",
  "vacia", "minimo", "maximo", "momento", "tiempo", "segunda",
  "inicial", "iniciales", "tercer", "demas", "demasiado", "igual",
  "crea", "crean", "reemplaza", "reemplazan", "dependen", "depende",
  "cuando", "donde", "identidad", "devuelve", "devuelven", "genera",
  "generan", "corren", "corre", "sigue", "siguen", "setea", "seteado",
  "estables", "estable", "firma", "licencia", "licencias",
  "internamente", "defensivo", "defensivos", "misma", "mismo", "mismas",
  "mismos", "solo", "nota", "hay", "analizar", "leer", "plegable",
  "numerada", "dos", "tres", "columnas", "cita", "insertar", "imagen",
];

const WORD_RES = SPANISH_WORDS.map((word) => [word, new RegExp(`\\b${word}\\b`)]);

export function analyzeText(text) {
  if (text.includes(PRAGMA)) return null;
  const letter = NON_ENGLISH_LETTER.exec(text);
  if (letter) return { signal: `non-English letters ("${letter[0]}")` };
  const stripped = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  for (const [word, re] of WORD_RES) {
    if (re.test(stripped)) return { signal: `Spanish word "${word}"` };
  }
  return null;
}

function truncate(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

/**
 * Collect every // and /* *\/ comment outside of string literals, template
 * literals and regex literals. String/regex awareness is what keeps URLs
 * ("https://…"), escaped regexes (/https?:\/\//) and template
 * interpolations from being misread as comments.
 */
export function scanComments(src) {
  // Comments carry their start INDEX; callers map to line numbers via
  // buildLineIndex (the scanner itself never tracks lines, so multi-line
  // templates / self-closing JSX tags can't skew the numbers).
  const comments = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j += 1;
      comments.push({ text: src.slice(i + 2, j), index: i });
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      comments.push({ text: src.slice(i + 2, j), index: i });
      i = Math.min(j + 2, n);
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote && src[j] !== "\n") {
        if (src[j] === "\\") j += 1;
        j += 1;
      }
      i = Math.min(j + 1, n);
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const t = src[j];
        if (t === "\\") { j += 2; continue; }
        if (t === "$" && src[j + 1] === "{") { depth += 1; j += 2; continue; }
        if (depth > 0) {
          if (t === "{") depth += 1;
          else if (t === "}") depth -= 1;
          j += 1;
          continue;
        }
        if (t === "`") break;
        j += 1;
      }
      i = Math.min(j + 1, n);
      continue;
    }
    if (c === "/") {
      // Heuristic: a / after an identifier, ), ], } or a digit is division;
      // otherwise treat it as a regex literal and skip to its closing slash.
      const prev = src[i - 1];
      if (!prev || !/[A-Za-z0-9_$)\]}]/.test(prev)) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const t = src[j];
          if (t === "\\") { j += 2; continue; }
          if (t === "[") inClass = true;
          else if (t === "]") inClass = false;
          else if (t === "/" && !inClass) break;
          else if (t === "\n") break;
          j += 1;
        }
        i = Math.min(j + 1, n);
        continue;
      }
    }
    i += 1;
  }
  return comments;
}

function skipWs(src, i) {
  while (i < src.length && /\s/.test(src[i])) i += 1;
  return i;
}

/** Read a single-quoted/double-quoted string starting at src[i]. */
function readQuoted(src, i) {
  const quote = src[i];
  let j = i + 1;
  let out = "";
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { out += src[j + 1] ?? ""; j += 2; continue; }
    if (c === quote) return { text: out, end: j + 1 };
    if (c === "\n") return null;
    out += c;
    j += 1;
  }
  return null;
}

/**
 * Read a template literal starting at src[i]. Returns the static prefix up
 * to the first ${ interpolation (dynamic parts can't be checked statically).
 */
function readTemplate(src, i) {
  let j = i + 1;
  let out = "";
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { out += src[j + 1] ?? ""; j += 2; continue; }
    if (c === "$" && src[j + 1] === "{") return { text: out, end: j };
    if (c === "`") return { text: out, end: j + 1 };
    out += c;
    j += 1;
  }
  return null;
}

/** First argument of a call, if it is a string/template literal. */
function firstStringArg(src, i) {
  const k = skipWs(src, i);
  const c = src[k];
  if (c === '"' || c === "'") return readQuoted(src, k);
  if (c === "`") return readTemplate(src, k);
  return null;
}

/** Second string argument of t("key", "fallback") at src[i] (after "t("). */
function fallbackStringArg(src, i) {
  const k = skipWs(src, i);
  if (src[k] !== '"' && src[k] !== "'") return null;
  const key = readQuoted(src, k);
  if (!key) return null;
  const afterKey = skipWs(src, key.end);
  if (src[afterKey] !== ",") return null;
  const k2 = skipWs(src, afterKey + 1);
  const c = src[k2];
  if (c === '"' || c === "'") return readQuoted(src, k2);
  if (c === "`") return readTemplate(src, k2);
  return null;
}

/**
 * Blank out string literals, template literals and comments (preserving
 * newlines and offsets) so raw-text scans never mistake HTML inside test
 * fixtures or attribute values for JSX text. Reuses the same scanner rules
 * as scanComments.
 */
export function maskNonCode(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k += 1) {
      if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
    }
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < n && src[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
      blank(i, Math.min(j + 2, n));
      i = Math.min(j + 2, n);
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote && src[j] !== "\n") {
        if (src[j] === "\\") j += 1;
        j += 1;
      }
      blank(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const t = src[j];
        if (t === "\\") { j += 2; continue; }
        if (t === "$" && src[j + 1] === "{") { depth += 1; j += 2; continue; }
        if (depth > 0) {
          if (t === "{") depth += 1;
          else if (t === "}") depth -= 1;
          j += 1;
          continue;
        }
        if (t === "`") break;
        j += 1;
      }
      blank(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }
    i += 1;
  }
  return out.join("");
}

export function buildLineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === "\n") starts.push(i + 1);
  }
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

export function scanFile(src) {
  const findings = [];
  const lineOf = buildLineIndex(src);

  // The pragma suppresses on the line that contains the flagged text.
  const lineHasPragma = (index) => {
    let start = src.lastIndexOf("\n", index - 1) + 1;
    if (start === 0 && index === 0) start = 0;
    let end = src.indexOf("\n", start);
    if (end === -1) end = src.length;
    return src.slice(start, end).includes(PRAGMA);
  };

  const fallbackRe = /\bt\s*\(/g;
  let m;
  while ((m = fallbackRe.exec(src))) {
    const arg = fallbackStringArg(src, m.index + m[0].length);
    if (!arg) continue;
    const hit = analyzeText(arg.text);
    if (hit && !lineHasPragma(m.index)) {
      findings.push({
        scope: "t() fallback",
        line: lineOf(m.index),
        fullText: arg.text,
        text: truncate(arg.text),
        signal: hit.signal,
      });
    }
  }

  const logRe = /\b(?:logger|console)\s*\.\s*(?:debug|info|warn|error|log|trace)\s*\(/g;
  while ((m = logRe.exec(src))) {
    const arg = firstStringArg(src, m.index + m[0].length);
    if (!arg) continue;
    const hit = analyzeText(arg.text);
    if (hit && !lineHasPragma(m.index)) {
      findings.push({
        scope: "log",
        line: lineOf(m.index),
        fullText: arg.text,
        text: truncate(arg.text),
        signal: hit.signal,
      });
    }
  }

  // ── UI string positions ───────────────────────────────────────────
  // User-facing text that should go through t(): raw JSX text nodes, UI-ish
  // attribute values (placeholders, titles, aria labels, alt text, …) and
  // toast/alert/confirm/prompt messages. Non-English here is a UI
  // regression, not just a source-text one — Spanish must not reach users
  // outside the locale files.

  // Raw text between JSX tags (same-line only). Runs on the code-only mask
  // so HTML inside test fixtures / string literals is never read as JSX.
  // The lookbehind skips arrow functions (`=>`); braces are excluded so
  // expression spans like `{count > 3 && <span>…` never match as text.
  const jsxTextRe = /(?<!=)>\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*)\s*</g;
  const codeOnly = maskNonCode(src);
  while ((m = jsxTextRe.exec(codeOnly))) {
    const text = m[1];
    const hit = analyzeText(text);
    if (hit && !lineHasPragma(m.index)) {
      findings.push({
        scope: "JSX text",
        line: lineOf(m.index),
        fullText: text,
        text: truncate(text),
        signal: hit.signal,
      });
    }
  }

  const uiAttrs = [
    "placeholder", "title", "aria-label", "aria-description",
    "aria-placeholder", "alt", "label", "helperText", "description",
  ];
  const attrRe = new RegExp(
    "\\b(" + uiAttrs.join("|") + ")\\s*=\\s*" +
      "(\"((?:\\\\.|[^\"\\\\])*)\"|'((?:\\\\.|[^'\\\\])*)')",
    "g",
  );
  while ((m = attrRe.exec(src))) {
    const text = m[3] ?? m[4];
    const hit = analyzeText(text);
    if (hit && !lineHasPragma(m.index)) {
      findings.push({
        scope: "UI attribute",
        line: lineOf(m.index),
        fullText: text,
        text: truncate(text),
        signal: hit.signal,
      });
    }
  }

  const uiCallRe =
    /\b(?:(?:toast|notification)\.(?:success|error|warning|info|loading|message|promise)|(?:window\.)?(?:alert|confirm|prompt))\s*\(/g;
  while ((m = uiCallRe.exec(src))) {
    const arg = firstStringArg(src, m.index + m[0].length);
    if (!arg) continue;
    const hit = analyzeText(arg.text);
    if (hit && !lineHasPragma(m.index)) {
      findings.push({
        scope: "UI call (toast/alert)",
        line: lineOf(m.index),
        fullText: arg.text,
        text: truncate(arg.text),
        signal: hit.signal,
      });
    }
  }

  for (const c of scanComments(src)) {
    const hit = analyzeText(c.text);
    if (hit) {
      findings.push({
        scope: "comment",
        line: lineOf(c.index),
        fullText: c.text,
        text: truncate(c.text),
        signal: hit.signal,
      });
    }
  }

  return findings;
}

export function walkFiles(dir = SRC_DIR, skipDirs = SKIP_DIRS) {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (skipDirs.has(name)) continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(name)) {
        files.push(p);
      }
    }
  })(dir);
  return files;
}

export function collectFindings(files) {
  const findings = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const f of scanFile(src)) findings.push({ file, ...f });
  }
  return findings;
}

// ── CLI wrapper ───────────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  // Verdict cache (scripts/gate-cache.mjs): the scan is deterministic in the
  // src/ tree, so a fingerprint match on the whole directory (every file the
  // scan could read, any extension) proves the PASS verdict still holds.
  // Only PASS is cached; BMF_GATE_CACHE_OFF=1 bypasses.
  const files = walkFiles();
  const fingerprint = treeFingerprint({
    root: join(process.cwd(), SRC_DIR),
    extensions: null,
    skipDirs: SKIP_DIRS,
    hash: true,
  });
  if (getCachedVerdict({ gateName: GATE_CACHE_NAME, fingerprint })) {
    console.log(
      `[check-english-only] ok (cached): src/ unchanged since the last pass — no non-English text in t() fallbacks, logs, comments or UI strings`,
    );
    process.exit(0);
  }
  const findings = collectFindings(files);
  for (const f of findings) {
    console.error(
      `[check-english-only] FAIL: ${f.file}:${f.line} ${f.scope} — "${f.text}" (${f.signal})`,
    );
  }
  if (findings.length > 0) {
    console.error(
      `[check-english-only] ${findings.length} non-English occurrence(s) in src/ — translate them to English or mark the line with ${PRAGMA}`,
    );
    process.exit(1);
  }
  console.log(
    `[check-english-only] ok: ${files.length} files scanned — no non-English text in t() fallbacks, logs, comments or UI strings`,
  );
  putCachedVerdict({ gateName: GATE_CACHE_NAME, fingerprint });
}
