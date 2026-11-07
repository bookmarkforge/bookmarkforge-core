/**
 * check-locale-encoding.mjs — locale payload encoding gate (2026-11-01 audit).
 *
 * Every existing i18n gate validates STRUCTURE (key parity, placeholder
 * parity, interpolation arguments) and none of them inspects the bytes a
 * translation actually carries. That blind spot shipped a real, released
 * defect: commits 44f85ea and 21dcfa8 pushed two lossy passes over all 60
 * payload files and nobody noticed, because `i18n-completeness`,
 * `check-i18n-quality` and `check-code-i18n` all stayed green.
 *
 * Three distinct signatures came out of those passes, and this gate rejects
 * all three for every JSON file under the locale stores:
 *
 *   1. REPLACEMENT — U+FFFD wherever bytes were already lost. Irreversible:
 *      the original character is gone, so it must be restored from history,
 *      never "repaired" in place.
 *   2. CONTROL — C0 (except TAB/LF/CR, which reviewed copy does use), DEL and
 *      the C1 block. A latin-1 round-trip leaves these where a CP1252 byte
 *      had no mapping.
 *   3. MOJIBAKE — text that is still valid UTF-8 but encodes, under CP1252,
 *      to a *different* string that decodes as UTF-8: "ê±´ë„ˆ" instead of
 *      "건너". Silently readable in a diff, unreadable on screen. This is the
 *      signature the U+FFFD sweep missed — 8,557 strings still carried it
 *      when the replacement characters were already gone.
 *
 * Plus the scars of the ad-hoc repairs that followed: a "©" or "⭐" standing
 * in for an em dash or for an undecodable byte ("Ã⭐€™", "ÄÆ’", "Ē").
 *
 * Scanned surfaces: `public/locales` (app strings, served at runtime through
 * i18next-http-backend) and `scripts/translations` (landing copy consumed by
 * build-landings.cjs). Both are source-of-truth data, so this gate cannot be
 * baselined: a replacement character is always irreversible data loss, and a
 * mojibake payload always means a lossy conversion ran over reviewed text.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Locale stores whose payloads are shipped to users. */
export const LOCALE_STORES = ["public/locales", "scripts/translations"];

/** U+FFFD, every C0 control except TAB/LF/CR, DEL, and the C1 block. */
export const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** Kept for callers that only ask "is this byte obviously lost?". */
export const CORRUPTION_RE = /[\uFFFD\u0080-\u009F]/;

/**
 * Characters only a hand-repair of mojibake produces: a CP1252 letter followed
 * by the byte it stood in for ("Ã©", "Ø¬"), the "â€" prefix of a smart-quote
 * mojibake, or a symbol substituted for a byte with no CP1252 mapping.
 */
export const MOJIBAKE_MARKER_RE = /[ÃÂÄÅØÙÐÑ×Ö][\u0080-\u00BF\u2018-\u2122\u2B50\u2B2F]|â€|Ē|Ã¯Â¿Â½/;

/**
 * CP1252 code points above U+007F whose byte differs from their code point.
 * Undefined CP1252 bytes (0x81, 0x8D, 0x8F, 0x90, 0x9D) are absent on purpose.
 */
const CP1252_EXTRA = new Map(
  Object.entries({
    "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86,
    "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
    "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95,
    "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
    "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
  }),
);

/**
 * Encodes a string as CP1252 bytes, or returns null when any character has no
 * CP1252 mapping (which already means "not a single-pass CP1252 casualty").
 */
export function toCp1252Bytes(text) {
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) {
      bytes.push(code);
      continue;
    }
    const extra = CP1252_EXTRA.get(ch);
    if (extra === undefined) return null;
    bytes.push(extra);
  }
  return Uint8Array.from(bytes);
}

/**
 * True when the text is CP1252-encoded UTF-8, i.e. a lossy UTF-8 read produced
 * a string that turns back into different, valid UTF-8. Reviewed accents are
 * not flagged: their CP1252 bytes are not valid UTF-8, so the decode fails.
 */
export function isMojibake(text) {
  if (text.length === 0) return false;
  const bytes = toCp1252Bytes(text);
  if (!bytes) return false;
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  return decoded !== text;
}

/**
 * Human-readable rendering of a corrupted code point, so a FAIL line names the
 * byte instead of printing an invisible control character into the log.
 */
export function describeChar(ch) {
  if (ch === "\uFFFD") return "U+FFFD REPLACEMENT CHARACTER";
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} control`;
}

/** Dotted path for nested keys; array positions render as `key[0]`. */
function walk(value, path, visit) {
  if (typeof value === "string") {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const keyPath = path ? `${path}.${key}` : key;
      visit(`${keyPath} (key name)`, key);
      walk(item, keyPath, visit);
    }
  }
}

/** Classifies one string; returns null when it is clean. */
function classifyText(text) {
  const replacement = text.indexOf("\uFFFD");
  if (replacement !== -1) {
    return { kind: "replacement", codePoint: 0xfffd, index: replacement };
  }
  const control = CONTROL_RE.exec(text);
  if (control) {
    return {
      kind: "control",
      codePoint: control[0].codePointAt(0),
      index: control.index,
    };
  }
  const marker = MOJIBAKE_MARKER_RE.exec(text);
  if (marker) {
    return {
      kind: "mojibake",
      codePoint: marker[0].codePointAt(0),
      index: marker.index,
    };
  }
  if (isMojibake(text)) {
    const index = [...text].findIndex((ch) => ch.codePointAt(0) > 0x7f);
    return {
      kind: "mojibake",
      codePoint: [...text][index].codePointAt(0),
      index: Math.max(index, 0),
    };
  }
  return null;
}

/**
 * Pure scan of one parsed payload. Returns findings as
 * `{ key, kind, codePoint }` so the caller decides how to report them.
 */
export function findCorruption(payload) {
  const findings = [];
  walk(payload, "", (key, text) => {
    const hit = classifyText(text);
    if (hit) findings.push({ key, kind: hit.kind, codePoint: hit.codePoint });
  });
  return findings;
}

/**
 * Checks one file. Returns `{ file, status, findings }` where status is
 * `ok`, `corrupt`, `json` or `encoding`.
 */
export function checkFile(file) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
  } catch {
    return { file, status: "encoding", findings: [] };
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { file, status: "json", findings: [] };
  }
  const findings = findCorruption(payload);
  return { file, status: findings.length > 0 ? "corrupt" : "ok", findings };
}

const REMEDY = {
  replacement:
    "a replacement character means the text was already lost; restore it from history rather than renaming the byte",
  control: "a control character means the payload went through a non-UTF-8 codec",
  mojibake:
    "this is CP1252 text read as UTF-8; re-decode it from the original bytes, do not retype it",
};

function main() {
  let scanned = 0;
  let parsed = 0;
  const problems = [];

  for (const store of LOCALE_STORES) {
    let names;
    try {
      names = readdirSync(store);
    } catch {
      console.error(`[check-locale-encoding] FAIL: missing locale store ${store}`);
      process.exitCode = 1;
      continue;
    }
    for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
      const file = join(store, name);
      scanned += 1;
      const result = checkFile(file);

      if (result.status === "encoding") {
        problems.push(`${file}: not valid UTF-8`);
        continue;
      }
      if (result.status === "json") {
        problems.push(`${file}: not valid JSON`);
        continue;
      }
      parsed += 1;
      for (const finding of result.findings) {
        const detail =
          finding.kind === "mojibake"
            ? "carries CP1252 mojibake"
            : `carries ${describeChar(String.fromCodePoint(finding.codePoint))}`;
        problems.push(`${file}: ${finding.key} ${detail} (${finding.kind})`);
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems.slice(0, 25)) {
      console.error(`[check-locale-encoding] FAIL: ${problem}`);
    }
    if (problems.length > 25) {
      console.error(`[check-locale-encoding] FAIL: … ${problems.length - 25} more`);
    }
    const kinds = new Set(problems.map((problem) => problem.replace(/^.*\((\w+)\)$/, "$1")));
    const advice = [...kinds]
      .map((kind) => REMEDY[kind])
      .filter(Boolean)
      .join("; ");
    console.error(
      `[check-locale-encoding] ${problems.length} encoding defect(s)${advice ? ` — ${advice}` : ""}`,
    );
    process.exit(1);
  }

  console.log(
    `[check-locale-encoding] ok: ${parsed}/${scanned} locale payload(s) are strict UTF-8 with no U+FFFD, no control characters and no CP1252 mojibake`,
  );
}

// Importable for tests; executes only when run as a script.
if (process.argv[1] && process.argv[1].endsWith("check-locale-encoding.mjs")) {
  main();
}
