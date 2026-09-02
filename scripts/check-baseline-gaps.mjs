#!/usr/bin/env node
/**
 * scripts/check-baseline-gaps.mjs — untracked baseline reference gate.
 *
 * Fails when a `toHaveScreenshot` call in a Playwright spec (tests/e2e)
 * references a baseline PNG that is NOT tracked in git. This is the
 * "silent baseline gap" failure class that twice broke the nightly
 * text-fit suite on fresh checkouts: the spec compared against files the
 * repo had never committed, and a first run auto-writes the "expected"
 * baseline — silently passing with an unreviewed image.
 *
 * How it works (no Playwright/browser needed, seconds in CI):
 *
 *   1. Collect every tracked `*.png` under `tests/e2e/*.spec.ts-snapshots/`
 *      via `git ls-files`. Playwright appends `-{project}-{platform}` to
 *      the name argument (e.g. `foo.png` → `foo-chromium-win32.png`), so
 *      each tracked file is normalized to its canonical (name-argument)
 *      form before comparison.
 *
 *   2. Scan each `tests/e2e/*.spec.ts` and derive the EXACT set of
 *      canonical basenames its `toHaveScreenshot` calls will compare:
 *        - string literal names (`"vault-lock-screen.png"`) → exact.
 *        - template literals (`text-fit-${view}-${locale}.png`) → resolved
 *          per call site of the enclosing helper function: view/suffix
 *          literals come from the call-site arguments, the locale domain
 *          comes from `loadLocaleCodes("critical"|"nightly"|…)` loops
 *          (mirroring the derivation in src/constants/locales.ts), and a
 *          guard like `if (VISUAL_BACKSTOP_LOCALES.has(locale))` is
 *          constant-folded by intersecting with the same-file set const.
 *      A hole that cannot be statically resolved is an ERROR (exit 2):
 *      the gate refuses to pass vacuously — being unable to see a
 *      reference relationship must fail loudly (ADR-028).
 *
 *   3. Any derived baseline not present in the tracked set → FAIL (exit 1)
 *      naming the spec line and the missing file. The mirror direction
 *      (tracked but never referenced) is deliberately NOT a failure — the
 *      drift gate (`check-baseline-drift`) owns that review.
 *
 * Usage:
 *   node scripts/check-baseline-gaps.mjs                # repo root
 *   node scripts/check-baseline-gaps.mjs --root <dir>   # test override
 *
 * Exit codes:
 *   0 — every toHaveScreenshot reference resolves to a tracked baseline
 *   1 — reference(s) to baselines not present in git (details on stderr)
 *   2 — unresolvable static analysis / usage / IO error (fail loud)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";

let ROOT = process.env.CHECK_BASELINE_GAPS_ROOT ?? process.cwd();

// ── git helpers (mirror check-baseline-drift.mjs) ──────────────────────────
function gitArgs(args) {
  return ["-C", ROOT, "-c", `safe.directory=${ROOT}`, ...args];
}

function gitOk(args) {
  const res = spawnSync("git", gitArgs(args), { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(
      `[check-baseline-gaps] git ${args.join(" ")} failed: ${(res.stderr ?? "").toString().trim()}`,
    );
    return undefined;
  }
  return res.stdout ?? "";
}

// ── canonical name normalization ─────────────────────────────────────────────
// Playwright snapshots get `-{projectName}-{platform}` appended to the name
// argument. The canonical form is the name-argument form, so `foo.png` and
// `foo-chromium-win32.png` are the same baseline across platforms/projects.
const PLATFORM_SUFFIX_RE =
  /-(chromium|firefox|webkit)-(win32|wow64|win64|windows|linux|ubuntu|darwin|macos|macosx|mac|freebsd|openbsd|netbsd|solaris|aix)(\.png)$/i;

function canonicalName(fileName) {
  return fileName.replace(PLATFORM_SUFFIX_RE, "$3");
}

// ── locale domains from src/constants/locales.ts ─────────────────────────────
/**
 * Extract the canonical locale lists the way the TS module derives them:
 * SUPPORTED comes from the SUPPORTED_LANGUAGES registry, CRITICAL from its
 * literal array, NIGHTLY = SUPPORTED − CRITICAL (the module computes it at
 * init with the same Set difference), SMALL from its literal array. A
 * structural change to locales.ts that breaks extraction FAILS LOUD (exit 2)
 * instead of silently passing with an empty domain.
 */
export function extractLocaleDomains(source) {
  const supported = [];
  const m = source.match(/SUPPORTED_LANGUAGES\s*=\s*\[/);
  if (!m) throw new Error("SUPPORTED_LANGUAGES array not found in locales.ts");
  const close = source.indexOf("]", m.index);
  const block = source.slice(m.index, close === -1 ? m.index + 8000 : close);
  const codeRe = /code:\s*"([a-z]{2})"/g;
  let h;
  while ((h = codeRe.exec(block)) !== null) supported.push(h[1]);
  if (supported.length === 0) {
    throw new Error("no codes found in SUPPORTED_LANGUAGES block");
  }

  const literalArray = (label) => {
    // The `(?::[^=]*)?` piece tolerates the `: ReadonlyArray<LocaleCode>`
    // type annotation between the const name and `=`. The `\s*` inside the
    // element group tolerates the `[\n  "en", …` formatting.
    const re = new RegExp(
      `${label}(?::[^=]*)?\\s*=\\s*\\[((?:\\s*\"[a-z]{2}\"\\s*,?\\s*)*)\\]`,
    );
    const mm = source.match(re);
    if (!mm) throw new Error(`${label} literal not found in locales.ts`);
    return [...mm[1].matchAll(/\"([a-z]{2})\"/g)].map((x) => x[1]);
  };

  const critical = literalArray("CRITICAL_LOCALE_CODES");
  const small = literalArray("SMALL_FALLBACK_LOCALES");
  const criticalSet = new Set(critical);
  const nightly = supported.filter((code) => !criticalSet.has(code));

  // Mirror the module's own self-consistency invariant so a split drift in
  // locales.ts cannot silently shrink a domain this gate relies on.
  if (critical.length === 0 || critical.length + nightly.length !== supported.length) {
    throw new Error(
      `CRITICAL + NIGHTLY ≠ SUPPORTED in locales.ts (critical=${critical.length}, nightly=${nightly.length}, supported=${supported.length})`,
    );
  }
  return {
    critical,
    nightly,
    all: supported,
    small,
    scope(scopeName) {
      const found = this[scopeName];
      if (!Array.isArray(found)) {
        throw new Error(`unknown loadLocaleCodes scope "${scopeName}"`);
      }
      return found;
    },
  };
}

// ── code masking (strings/comments are not structure) ────────────────────────
/** Mark every index inside a comment or string literal so structural scans
 *  (keywords, braces, parens, `for` loops) never match inside prose. */
function buildCodeMask(raw) {
  const mask = new Uint8Array(raw.length);
  let inBlock = false;
  let inLine = false;
  let str = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (str !== null) {
      mask[i] = 1;
      if (c === "\\") {
        mask[i + 1] = 1;
        i += 1;
        continue;
      }
      if (c === str) str = null;
      continue;
    }
    if (inLine) {
      mask[i] = 1;
      if (c === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      mask[i] = 1;
      if (c === "*" && raw[i + 1] === "/") {
        mask[i + 1] = 1;
        i += 1;
        inBlock = false;
      }
      continue;
    }
    if (c === "/" && raw[i + 1] === "/") {
      inLine = true;
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 1;
      continue;
    }
    if (c === "/" && raw[i + 1] === "*") {
      inBlock = true;
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      mask[i] = 1;
      continue;
    }
  }
  return mask;
}

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/;

/** Next index (≥ from) that is unmasked (in-code). */
function nextCode(raw, mask, from) {
  for (let i = from; i < raw.length; i++) {
    if (mask[i] === 0) return i;
  }
  return -1;
}

/** First code-space occurrence of `ch` within `span` chars of `from`. */
function findNextCodeChar(raw, mask, from, ch, span) {
  const limit = Math.min(raw.length, from + span);
  for (let i = nextCode(raw, mask, from); i !== -1 && i < limit; i = nextCode(raw, mask, i + 1)) {
    if (raw[i] === ch) return i;
  }
  return -1;
}

/** Is `c` or the region around a keyword a word boundary? */
function isIdentChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

/** Find the next occurrence of `kw` (word-bounded) at an unmasked index. */
function findKeyword(raw, mask, kw, from) {
  for (let i = nextCode(raw, mask, from); i !== -1; i = nextCode(raw, mask, i + 1)) {
    if (raw.startsWith(kw, i) && !isIdentChar(raw[i - 1]) && !isIdentChar(raw[i + kw.length])) {
      return i;
    }
  }
  return -1;
}

/** Index of the matching code-space close for `open` starting at openIdx. */
function matchCode(raw, mask, openIdx, openChar, closeChar) {
  let depth = 0;
  for (let i = nextCode(raw, mask, openIdx); i !== -1; i = nextCode(raw, mask, i + 1)) {
    if (raw[i] === openChar) depth += 1;
    else if (raw[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Skip whitespace/comments from `i`. (Mask arg kept for signature parity.) */
function skipWs(raw, _mask, i) {
  while (i < raw.length) {
    const c = raw[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    if (c === "/" && raw[i + 1] === "/") {
      const nl = raw.indexOf("\n", i);
      i = nl === -1 ? raw.length : nl + 1;
      continue;
    }
    if (c === "/" && raw[i + 1] === "*") {
      const end = raw.indexOf("*/", i + 2);
      i = end === -1 ? raw.length : end + 2;
      continue;
    }
    return i;
  }
  return i;
}

function readIdent(raw, i) {
  const m = IDENT_RE.exec(raw.slice(i));
  return m ? { name: m[0], end: i + m[0].length } : null;
}

function lineAt(raw, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < raw.length; i++) {
    if (raw[i] === "\n") line += 1;
  }
  return line;
}

// ── argument / template parsing (self-contained on raw slices) ──────────────
/** Split a balanced `(…)` region's content into top-level comma terms. */
function splitTerms(content) {
  const terms = [];
  let depth = 0;
  let cur = "";
  let str = null;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (str !== null) {
      cur += c;
      if (c === "\\") {
        cur += content[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      str = c;
      cur += c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth -= 1;
    if (c === "," && depth === 0) {
      terms.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  terms.push(cur.trim());
  return terms;
}

/** Read a quoted string or template literal at `i`; returns value/parts. */
function readStringLike(raw, i, quote) {
  let j = i + 1;
  let out = "";
  const templateParts = [];
  while (j < raw.length) {
    const c = raw[j];
    if (c === "\\") {
      out += c + (raw[j + 1] ?? "");
      templateParts.push({ text: c + (raw[j + 1] ?? "") });
      j += 2;
      continue;
    }
    if (quote === "`" && c === "$" && raw[j + 1] === "{") {
      // Template hole `${…}` — collect raw text with brace-depth tracking.
      // Depth starts at 1: we are already inside the `{` of `${`, so a
      // top-level `}` (depth → 0) is the hole's closing brace.
      let depth = 1;
      let hole = "";
      let k = j + 2;
      while (k < raw.length) {
        if (raw[k] === "{") depth += 1;
        else if (raw[k] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        hole += raw[k];
        k += 1;
      }
      templateParts.push({ hole: hole.trim() });
      out += "\u0000";
      j = k + 1;
      continue;
    }
    if (c === quote) {
      return { value: out, parts: templateParts, end: j + 1 };
    }
    out += c;
    templateParts.push({ text: c });
    j += 1;
  }
  return { value: out, parts: templateParts, end: -1 }; // unterminated
}

// ── per-file static analysis ─────────────────────────────────────────────────
export function analyzeSpec(raw, specBase, locales) {
  const mask = buildCodeMask(raw);
  const functions = [];
  const loopDomains = new Map();
  const setConsts = new Map();

  // 1. Loop domains: `for (const X of loadLocaleCodes("scope"))`.
  for (let i = findKeyword(raw, mask, "for", 0); i !== -1; i = findKeyword(raw, mask, "for", i + 3)) {
    const slice = raw.slice(i, i + 200);
    const m = slice.match(
      /for\s*\(\s*const\s+(\w+)\s+of\s+loadLocaleCodes\(\s*["'](\w+)["']\s*\)\s*\)/,
    );
    if (m) loopDomains.set(m[1], locales.scope(m[2]));
  }

  // 2. Value-set consts: `const X = new Set([…])`, `const X = […]`,
  //    `const X = "literal"` (string literals only — the resolution the
  //    guard-folder and template resolver are allowed to see).
  for (let i = findKeyword(raw, mask, "const", 0); i !== -1; i = findKeyword(raw, mask, "const", i + 5)) {
    const nameMatch = readIdent(raw, skipWs(raw, mask, i + "const".length));
    if (!nameMatch) continue;
    // ANCHORED (`^`) at the identifier end so a value from a LATER line
    // (e.g. the next const's `= new Set([...])`) can never be attributed to
    // this const — that mis-attribution made the nightly backstop const go
    // missing and let an empty `locale` array shadow the loop domain.
    const slice = raw.slice(nameMatch.end, nameMatch.end + 300);
    const setArr = slice.match(
      /^(?::[^=]*)?\s*=\s*(?:new\s+Set(?:<[^>]+>)?\s*\(\s*)?\[((?:\s*["'][^"']*["']\s*,?\s*)*)\]/,
    );
    if (setArr) {
      setConsts.set(nameMatch.name, [...setArr[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
      continue;
    }
    const lit = slice.match(/^(?::[^=]*)?\s*=\s*["']([^"']*)["']/);
    if (lit) setConsts.set(nameMatch.name, [lit[1]]);
  }

  // 3. Function declarations: `async function NAME(params) { … }`.
  for (let i = findKeyword(raw, mask, "function", 0); i !== -1; i = findKeyword(raw, mask, "function", i + 8)) {
    const nameMatch = readIdent(
      raw,
      skipWs(raw, mask, i + "function".length),
    );
    if (!nameMatch) continue;
    const openParen = skipWs(raw, mask, nameMatch.end);
    if (raw[openParen] !== "(") continue;
    const closeParen = matchCode(raw, mask, openParen, "(", ")");
    if (closeParen === -1) continue;
    const paramTerms = splitTerms(raw.slice(openParen + 1, closeParen));
    const params = paramTerms
      .filter((t) => t.length > 0)
      .map((t) => {
        // Space-tolerant: `nameSuffix = ""` (with spaces) must parse — the
        // `\s*` before the optional `=` group was a real gap.
        const mm = t.match(
          /^([A-Za-z_$][\w$]*)(?::[^=]*)?\s*(?:=\s*((?:["'][^"']*["'])|[^\s,]+))?$/,
        );
        if (!mm) return { name: t.replace(/:/g, "").split(" ")[0] ?? "", default: undefined };
        let def = undefined;
        if (mm[2] !== undefined) {
          const lit = mm[2].match(/^["']([^"']*)["']$/);
          def = lit ? lit[1] : undefined;
        }
        return { name: mm[1], default: def };
      });
    // The return-type annotation (`): Promise<ViewAudit> {`) sits between
    // the parens and the body brace — scan forward (bounded) for the first
    // code-space `{` rather than requiring it immediately.
    const openBrace = findNextCodeChar(raw, mask, closeParen + 1, "{", 600);
    if (openBrace === -1) continue;
    const closeBrace = matchCode(raw, mask, openBrace, "{", "}");
    if (closeBrace === -1) continue;
    functions.push({
      name: nameMatch.name,
      params,
      blockStart: openBrace,
      blockEnd: closeBrace,
      line: lineAt(raw, i),
    });
  }    // 4. toHaveScreenshot call sites (first argument only matters).
  const calls = [];
  for (let i = findKeyword(raw, mask, "toHaveScreenshot", 0); i !== -1; i = findKeyword(raw, mask, "toHaveScreenshot", i + "toHaveScreenshot".length)) {
    const openParen = skipWs(raw, mask, i + "toHaveScreenshot".length);
    if (raw[openParen] !== "(") continue;
    const closeParen = matchCode(raw, mask, openParen, "(", ")");
    const args = closeParen === -1 ? [] : splitTerms(raw.slice(openParen + 1, closeParen));
    const arg0 = args[0] ?? "";
    const enclosing = functions
      .filter((f) => f.blockStart < i && i < f.blockEnd)
      .sort((a, b) => a.blockStart - b.blockStart)
      .at(-1);
    calls.push({
      idx: i,
      line: lineAt(raw, i),
      arg0,
      enclosing,
      rawArgStart: skipWs(raw, mask, openParen + 1),
      rawArgEnd: closeParen === -1 ? raw.length : closeParen,
    });
  }

  // 5. Call sites of each helper function (to bind params per call).
  const callsitesOf = new Map();
  for (const fn of functions) {
    const sites = [];
    for (let i = findKeyword(raw, mask, fn.name, fn.blockEnd); i !== -1; i = findKeyword(raw, mask, fn.name, i + fn.name.length)) {
      const openParen = skipWs(raw, mask, i + fn.name.length);
      if (raw[openParen] !== "(") continue;
      if (i + fn.name.length === fn.blockStart) continue; // declaration
      const closeParen = matchCode(raw, mask, openParen, "(", ")");
      if (closeParen === -1) continue;
      const terms = splitTerms(raw.slice(openParen + 1, closeParen));
      sites.push({
        line: lineAt(raw, i),
        terms,
      });
    }
    callsitesOf.set(fn.name, sites);
  }

  // 6. Guard folding helper: `if (CONST.has(param)) { … call … }` blocks
  //    inside a function whose call is inside that block intersect the
  //    param's domain with the const's values (backstop-locale gating).
  function applyGuards(fn, callIdx, bindings) {
    if (!fn) return;
    for (let i = nextCode(raw, mask, fn.blockStart); i !== -1 && i < fn.blockEnd; i = nextCode(raw, mask, i + 1)) {
      if (!raw.startsWith("if", i) || isIdentChar(raw[i + 2])) continue;
      const openParen = skipWs(raw, mask, i + 2);
      if (raw[openParen] !== "(") continue;
      const closeParen = matchCode(raw, mask, openParen, "(", ")");
      if (closeParen === -1) continue;
      const cond = raw.slice(openParen + 1, closeParen).trim();
      const cm = cond.match(/^([A-Za-z_$][\w$]*)\.has\(\s*([A-Za-z_$][\w$]*)\s*\)$/);
      if (!cm) continue;
      const constValues = setConsts.get(cm[1]);
      const target = cm[2];
      if (!constValues || constValues.length === 0) continue;
      const openBrace = skipWs(raw, mask, closeParen + 1);
      if (raw[openBrace] !== "{") continue;
      const closeBrace = matchCode(raw, mask, openBrace, "{", "}");
      if (closeBrace === -1 || callIdx <= openBrace || callIdx >= closeBrace) continue;
      const current = bindings.get(target);
      if (!current || current === "unresolved") continue;
      // Only fold when both sides look like 2-letter locale codes — never
      // intersect an arbitrary value-set const into a domain by accident.
      const twoLetter = (arr) => arr.every((v) => /^[a-z]{2}$/.test(v));
      if (!twoLetter([...current]) || !twoLetter(constValues)) continue;
      // Keep the binding a Set: callers rely on `.size` (an empty array's
      // `.size` is undefined, which silently bypassed the guard-emptied path).
      bindings.set(target, new Set([...current].filter((v) => constValues.includes(v))));
    }
  }

  // 7. Resolve one template hole to a value set (Set of strings) or
  //    `"unresolved"`. Identifier lookup: fn-param binding first, then
  //    loop domains, then value-set consts, then literal consts.
  function resolveIdentifier(id, bindings, localConsts) {
    if (bindings.has(id)) return bindings.get(id);
    if (localConsts.has(id)) return localConsts.get(id);
    // Loop variables (e.g. `for (const locale of loadLocaleCodes("nightly"))`)
    // must win over any equally-named const so a locale domain is never
    // shadowed by a coincidental set const capture.
    if (loopDomains.has(id)) return new Set(loopDomains.get(id));
    if (setConsts.has(id)) return new Set(setConsts.get(id));
    return "unresolved";
  }

  /**
   * Evaluate the name argument of one toHaveScreenshot call.
   * Returns { names: Set<string>, resolved: boolean, note?: string }.
   * `names` is empty when the guard legitimately empties a domain.
   */
  function evalName(call) {
    const debugExit = (r) => r;
    const arg = call.arg0;
    const first = arg[0];
    const result = { names: new Set(), resolved: true };

    // String literal
    if (first === '"' || first === "'") {
      const lit = readStringLike(arg, 0, first);
      if (lit.end === -1) return debugExit({ ...result, resolved: false, why: "unterminated string" });
      result.names.add(lit.value);
      return debugExit(result);
    }

    // Template literal
    if (first === "`") {
      const lit = readStringLike(arg, 0, "`");
      if (lit.end === -1) return debugExit({ ...result, resolved: false, why: "unterminated template" });

      const fn = call.enclosing;
      // Build the per-callsite binding maps for the enclosing helper.
      const contexts =
        fn && callsitesOf.get(fn.name)?.length > 0
          ? callsitesOf.get(fn.name).map((site) => {
            const bindings = new Map();
            fn.params.forEach((p, idx) => {
              const term = site.terms[idx];
              if (term === undefined) {
                if (p.default !== undefined) bindings.set(p.name, new Set([p.default]));
                else bindings.set(p.name, "unresolved");
                return;
              }
              if (term[0] === '"' || term[0] === "'" || term[0] === "`") {
                const t = readStringLike(term, 0, term[0]);
                bindings.set(p.name, new Set([t.value]));
              } else {
                // Identifier argument — resolve through the caller context.
                bindings.set(p.name, resolveIdentifier(term, new Map(), new Map()));
              }
            });
            // Constant-fold `if (SET.has(localeParam))` guards enclosing the
            // call inside the helper.
            applyGuards(fn, call.idx, bindings);
            return bindings;
          })
        : [new Map()];

      let anyUnresolved = false;
      for (const bindings of contexts) {
        // Fold guard intersecting the leading hole when the whole template
        // is locale-driven; the per-context bindings above already applied
        // guards inside the helper. For direct calls (no helper), guards
        // inside the current function are folded here:
        if (!fn) applyGuards(nearestFrame(functions, call.idx), call.idx, bindings);

        const nameParts = lit.parts.map((p) =>
          p.hole !== undefined ? { hole: p.hole } : { text: p.text },
        );
        const expansions = [""];
        let holeSeen = false;
        for (const part of nameParts) {
          if (part.text !== undefined) {
            for (let k = 0; k < expansions.length; k++) expansions[k] += part.text;
            continue;
          }
          holeSeen = true;
          const hole = part.hole.trim();
          const idMatch = hole.match(/^([A-Za-z_$][\w$]*)$/);
          let values;
          if (idMatch) values = resolveIdentifier(idMatch[1], bindings, new Map());
          else values = "unresolved";
          if (values === "unresolved") {
            anyUnresolved = true;
            break;
          }
          if (values.size === 0) {
            // Guard legitimately emptied this context (e.g. a backstop set
            // with no matching locale) → this call never runs here.
            return debugExit({ ...result, names: new Set(), resolved: true, note: "guard-emptied" });
          }
          const next = [];
          for (const e of expansions) {
            for (const v of values) next.push(e + v);
          }
          expansions.length = 0;
          expansions.push(...next);
        }
        if (!holeSeen) anyUnresolved = true; // template without ${…}: treat as unresolvable
        for (const name of expansions) {
          result.names.add(name);
        }
      }
      // ANY unresolvable hole on ANY context must fail loud — a partial
      // resolution would silently drop part of the reference surface
      // (ADR-028: the negative path must stay demonstrably catchable).
      if (anyUnresolved) {
        return debugExit({ ...result, resolved: false, why: "unresolvable template hole(s)" });
      }
      result.resolved = result.names.size > 0;
      return debugExit(result);
    }

    // Anything else (identifier in parens, expression…) — analyzer can't
    // see the reference, so fail loud rather than pass vacuously.
    return { ...result, resolved: false, why: `unsupported name argument: ${arg.slice(0, 60)}` };
  }

  const derived = new Map(); // canonical name -> { line, why }
  let callsSeen = 0;
  let guardEmptiedCalls = 0;
  let unresolved = [];
  for (const call of calls) {
    callsSeen += 1;
    const r = evalName(call);
    if (!r.resolved) {
      unresolved.push({ line: call.line, why: r.why ?? "cannot statically resolve" });
      continue;
    }
    if (r.note === "guard-emptied") {
      // The guard set legitimately emptied every context (e.g. an empty
      // backstop const) — this call never reaches a screenshot. Not an
      // analyzer failure, and it contributes no references.
      guardEmptiedCalls += 1;
      continue;
    }
    for (const name of r.names) {
      if (!derived.has(name)) derived.set(name, { line: call.line });
    }
  }

  if (
    callsSeen > 0 &&
    derived.size === 0 &&
    unresolved.length === 0 &&
    guardEmptiedCalls === 0
  ) {
    unresolved.push({
      line: calls[0].line,
      why: "derived zero baseline names — analyzer cannot see the reference relationship",
    });
  }

  return { derived, unresolved, callsSeen, specBase };
}

/** Nearest function whose body contains `idx`. */
function nearestFrame(functions, idx) {
  return functions
    .filter((f) => f.blockStart < idx && idx < f.blockEnd)
    .sort((a, b) => a.blockStart - b.blockStart)
    .at(-1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: check-baseline-gaps.mjs [--root <dir>]");
      process.exit(0);
    } else {
      console.error(`[check-baseline-gaps] unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.root) ROOT = args.root;

  if (gitOk(["rev-parse", "--is-inside-work-tree"]) === undefined) {
    console.error("[check-baseline-gaps] not inside a git work tree (or git unavailable)");
    process.exit(2);
  }

  // Tracked baselines, normalized to canonical (name-argument) form.
  const trackedOut = gitOk(["ls-files", "--", "tests/e2e"]);
  if (trackedOut === undefined) process.exit(2);
  const tracked = new Map();
  for (const line of trackedOut.split(/\r?\n/).filter(Boolean)) {
    const m = line.match(/^(.*?)\.spec\.ts-snapshots\/([^/]+\.png)$/);
    if (!m) continue;
    // specBase must match analyzeSpec's specBase (`<file>` from
    // `<file>.spec.ts`), hence the basename without the trailing `.spec`.
    const basename_ = m[1].split("/").pop().split("\\").pop();
    const specBase = basename_.replace(/\.spec$/, "");
    tracked.set(`${specBase}:${canonicalName(m[2])}`, line);
  }

  // Locale domains (fail loud if the module shape changed).
  const localesPath = join(ROOT, "src", "constants", "locales.ts");
  if (!existsSync(localesPath)) {
    console.error(`[check-baseline-gaps] missing ${relative(ROOT, localesPath)} — cannot resolve locale domains`);
    process.exit(2);
  }
  let locales;
  try {
    locales = extractLocaleDomains(readFileSync(localesPath, "utf8"));
  } catch (error) {
    console.error(`[check-baseline-gaps] cannot derive locale domains from locales.ts: ${error.message}`);
    process.exit(2);
  }

  const e2eRoot = join(ROOT, "tests", "e2e");
  let specFiles = [];
  try {
    specFiles = readdirSync(e2eRoot)
      .filter((f) => f.endsWith(".spec.ts"))
      .sort();
  } catch {
    console.error(`[check-baseline-gaps] missing tests/e2e — nothing to check`);
    process.exit(2);
  }

  const analyzerErrors = [];
  const failures = [];
  let namesChecked = 0;
  let specsWithCalls = 0;

  for (const specFile of specFiles) {
    const raw = readFileSync(join(e2eRoot, specFile), "utf8");
    const specBase = specFile.replace(/\.spec\.ts$/, "");
    const analysis = analyzeSpec(raw, specBase, locales);
    if (analysis.callsSeen > 0) specsWithCalls += 1;
    for (const u of analysis.unresolved) {
      analyzerErrors.push(
        `[check-baseline-gaps] ERROR ${specFile}:${u.line} — ${u.why}`,
      );
    }
    for (const [name, info] of [...analysis.derived.entries()].sort()) {
      namesChecked += 1;
      const key = `${specBase}:${name}`;
      if (tracked.has(key)) {
        console.log(`[check-baseline-gaps] ok ${specFile}:${info.line} → ${name}`);
      } else {
        failures.push({ specFile, line: info.line, name });
        console.error(
          `[check-baseline-gaps] FAIL ${specFile}:${info.line} — toHaveScreenshot references ` +
            `tests/e2e/${specBase}.spec.ts-snapshots/${name} which is NOT tracked in git. ` +
            `Commit the baseline (or gate the toHaveScreenshot) before merging — a fresh ` +
            `checkout would compare against an auto-written, unreviewed image.`,
        );
      }
    }
  }

  if (analyzerErrors.length > 0) {
    for (const e of analyzerErrors) console.error(e);
    console.error("[check-baseline-gaps] static analysis could not resolve every reference — failing loud (ADR-028)");
    process.exit(2);
  }

  if (failures.length > 0) {
    console.error(
      `[check-baseline-gaps] totals: ${namesChecked} references across ${specsWithCalls} spec(s), ` +
        `${failures.length} referencing baselines not tracked in git`,
    );
    process.exit(1);
  }
  console.log(
    `[check-baseline-gaps] totals: ${namesChecked} references across ${specsWithCalls} spec(s) — all tracked in git`,
  );
  process.exit(0);
}

// Only run main when invoked directly (analyzer pieces stay importable).
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  return entry.split(/[\\/]/).pop() === import.meta.url.split("/").pop();
}

if (isDirectInvocation()) {
  try {
    main();
  } catch (error) {
    console.error(`[check-baseline-gaps] FATAL: ${error?.message ?? String(error)}`);
    process.exit(2);
  }
}