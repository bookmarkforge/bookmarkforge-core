#!/usr/bin/env node
/**
 * scripts/check-npm-alias-references.mjs — no `npm run` alias drift.
 *
 * `check:documented-npm-commands` guards the operator docs (README, AGENTS,
 * CONTRIBUTING, OPEN-CORE, docs/, .github/) against teaching a command the
 * manifest cannot run. `check-script-reachability` guards the CI/infra corpus
 * the same way. Neither reads the tests, and that is exactly where the last
 * drift lived: an e2e spec told the reader to run an alias that package.json
 * had dropped, and a chain fixture named a gate that never existed as a
 * script. A comment is documentation too — the reader copies it.
 *
 * This gate widens the corpus to tests (tests/, src/tests/, scripts/, incl.
 * scripts/__tests__) and keeps the signal high by only reading INVOCATIONS,
 * never prose:
 *
 *   - Markdown: fenced code blocks and inline code spans.
 *   - YAML: `run:` scalars and `run: |` / `run: >` block scalars.
 *   - Code: string/template literals whose shell segment starts with
 *     `npm run`, plus commands written in backticks inside comments (the
 *     way e2e specs document how to run them).
 *   - Shell: non-comment lines, split on `&&`, `||` and `;`.
 *
 * Consequently `the first npm run rebaselines (exit 1)` in a test title, or
 * `npm run ${nombre}` in a template, is not a reference. Interpolations are
 * skipped rather than resolved: a placeholder is not an alias.
 *
 * Fixtures that deliberately name fictional scripts (the suites for the other
 * gates) declare them per file with the npm-alias-fixtures pragma, a
 * comma-separated alias list on one comment line.
 *
 * The pragma is scoped to the file, and a listed alias the file no longer
 * references fails as stale — an exemption has to keep paying rent.
 *
 * Usage:
 *   node scripts/check-npm-alias-references.mjs            # verify
 *   node scripts/check-npm-alias-references.mjs --json     # machine-readable
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCAN_ROOTS = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "OPEN-CORE.md",
  "docs",
  ".github",
  "tests",
  "src/tests",
  "scripts",
];

export const FIXTURE_PRAGMA = "npm-alias-fixtures:";

const MARKDOWN = new Set([".md"]);
const YAML = new Set([".yml", ".yaml"]);
const CODE = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx"]);
const SHELL = new Set([".sh"]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-extension",
  "coverage",
  "test-results",
  "test-results-visual",
  "playwright-report",
]);

const ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };

/** One shell segment: `npm run <alias>` at its start (quotes already trimmed). */
const NPM_RUN_SEGMENT = /^npm run(?:-script)?\s+([A-Za-z0-9:_-]+)(?=$|\s)/;

/** Every file this gate reads, repo-relative and stable-ordered. */
export function collectFiles(root) {
  const found = [];
  const walk = (absolute, relativePath) => {
    let info;
    try {
      info = statSync(absolute);
    } catch {
      return; // an optional root that is absent is simply not a source
    }
    if (info.isDirectory()) {
      if (SKIP_DIRS.has(relativePath.split("/").at(-1))) return;
      for (const entry of readdirSync(absolute).sort()) {
        walk(join(absolute, entry), `${relativePath}/${entry}`);
      }
      return;
    }
    const extension = extname(absolute).toLowerCase();
    if (
      MARKDOWN.has(extension) ||
      YAML.has(extension) ||
      CODE.has(extension) ||
      SHELL.has(extension)
    ) {
      found.push(relativePath);
    }
  };
  for (const source of SCAN_ROOTS) walk(resolve(root, source), source);
  return [...new Set(found)].sort();
}

/** Aliases declared as fixtures by this file's pragma(s). */
export function fixtureAliases(text) {
  const found = new Set();
  for (const line of String(text).split("\n")) {
    // Only a real comment line is a pragma: test data may embed the marker
    // inside a string literal, and that is a fixture, not a declaration.
    if (!line.trim().startsWith("//")) continue;
    const at = line.indexOf(FIXTURE_PRAGMA);
    if (at === -1) continue;
    const rest = line.slice(at + FIXTURE_PRAGMA.length).replaceAll("-->", "").replaceAll("*/", "");
    for (const token of rest.split(",")) {
      // Accept a trailing reason after the alias: "check:a — why".
      const alias = token.trim().match(/^[A-Za-z0-9:_-]+/)?.[0];
      if (alias) found.add(alias);
    }
  }
  return found;
}

/**
 * Shell segments of a snippet, keeping only those that invoke npm at the
 * start. `${…}` is blanked first so a placeholder never becomes an alias.
 */
export function snippetAliases(snippet) {
  // A placeholder is not an alias: keep a non-word sentinel between the
  // spaces so `npm run ${x} is …` never resolves to the next English word.
  const cleaned = String(snippet).replaceAll(/\$\{[^}]*\}/g, " {} ");
  const aliases = [];
  for (const raw of cleaned.split(/&&|\|\||;|\r?\n/)) {
    const segment = raw
      .trim()
      .replace(/^[$>]\s*/, "")
      .replace(/^["'`]+/, "");
    const match = segment.match(NPM_RUN_SEGMENT);
    if (!match) continue;
    const alias = match[1];
    if (alias.startsWith("$") || alias.startsWith("-")) continue;
    aliases.push(alias);
  }
  return aliases;
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

/** Fenced blocks plus inline code spans; prose outside code is not a command. */
function markdownSnippets(text) {
  const snippets = [];
  let fence = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (fence) {
      if (trimmed.startsWith(fence)) fence = null;
      else snippets.push({ snippet: line, index: offset });
    } else {
      const open = trimmed.match(/^(```+|~~~+)/);
      if (open) fence = open[1].slice(0, 3);
      else {
        for (const match of line.matchAll(/`([^`\n]+)`/g)) {
          snippets.push({ snippet: match[1], index: offset + match.index });
        }
      }
    }
    offset += line.length + 1;
  }
  return snippets;
}

/** `run:` scalars and block scalars (`run: |`, `run: >`). */
function yamlSnippets(text) {
  const snippets = [];
  const lines = text.split("\n");
  const offsets = [];
  let cursor = 0;
  for (const line of lines) {
    offsets.push(cursor);
    cursor += line.length + 1;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const withoutComment = line.replace(/\s+#.*$/, "");
    const match = withoutComment.match(/^\s*(?:-\s*)?run:\s*(.*)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const baseIndent = line.length - line.trimStart().length;
      for (let next = index + 1; next < lines.length; next += 1) {
        const candidate = lines[next];
        const indent = candidate.length - candidate.trimStart().length;
        if (candidate.trim() !== "" && indent <= baseIndent) break;
        snippets.push({ snippet: candidate, index: offsets[next] });
      }
    } else {
      snippets.push({ snippet: value, index: offsets[index] });
    }
  }
  return snippets;
}

/**
 * String/template literals (a segment starting with `npm run` is an
 * invocation) and backticked commands inside comments. Comments are otherwise
 * prose; a regex literal is not a command string.
 */
function codeSnippets(text) {
  const snippets = [];
  const pushBackticks = (chunk, base) => {
    for (const match of chunk.matchAll(/`([^`\n]+)`/g)) {
      snippets.push({ snippet: match[1], index: base + match.index });
    }
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      pushBackticks(text.slice(index, stop), index);
      index = stop;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end === -1 ? text.length : end + 2;
      pushBackticks(text.slice(index, stop), index);
      index = stop;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      let scan = index + 1;
      let buffer = "";
      while (scan < text.length) {
        const current = text[scan];
        if (current === "\\") {
          // Decode the escapes that change the shape of a command: `\n`
          // separates two invocations, and quoting must not merge them.
          const escape = text[scan + 1] ?? "";
          buffer += ESCAPES[escape] ?? escape;
          scan += 2;
          continue;
        }
        if (current === quote) break;
        if (quote === "`" && current === "$" && text[scan + 1] === "{") {
          let depth = 1;
          scan += 2;
          while (scan < text.length && depth > 0) {
            if (text[scan] === "{") depth += 1;
            else if (text[scan] === "}") depth -= 1;
            scan += 1;
          }
          buffer += " {} ";
          continue;
        }
        buffer += current;
        scan += 1;
      }
      pushBackticks(buffer, index);
      snippets.push({ snippet: buffer, index });
      index = scan + 1;
      continue;
    }
    index += 1;
  }
  return snippets;
}

/** Non-comment shell lines. */
function shellSnippets(text) {
  const snippets = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("#")) snippets.push({ snippet: line, index: offset });
    offset += line.length + 1;
  }
  return snippets;
}

/** Every real invocation the file makes, with its line. */
export function scanFile(file, text) {
  const extension = extname(file).toLowerCase();
  const snippets = MARKDOWN.has(extension)
    ? markdownSnippets(text)
    : YAML.has(extension)
      ? yamlSnippets(text)
      : CODE.has(extension)
        ? codeSnippets(text)
        : shellSnippets(text);
  const references = [];
  for (const { snippet, index } of snippets) {
    for (const alias of snippetAliases(snippet)) {
      references.push({ alias, file, line: lineAt(text, index) });
    }
  }
  return references;
}

/** Everything the CLI and the tests read, so both share one code path. */
export function checkNpmAliasReferences({ root = process.cwd(), scripts }) {
  const files = collectFiles(root);
  const references = [];
  const pragmas = new Map();
  for (const file of files) {
    const text = readFileSync(resolve(root, file), "utf8");
    const declared = fixtureAliases(text);
    if (declared.size > 0) pragmas.set(file, declared);
    references.push(...scanFile(file, text));
  }

  const missing = references.filter(
    ({ alias, file }) => !Object.hasOwn(scripts, alias) && !pragmas.get(file)?.has(alias),
  );
  const seen = new Set();
  const uniqueMissing = missing.filter((item) => {
    const key = `${item.file}:${item.line}:${item.alias}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const stale = [];
  for (const [file, aliases] of [...pragmas].sort(([a], [b]) => a.localeCompare(b))) {
    const referenced = new Set(
      references.filter((reference) => reference.file === file).map(({ alias }) => alias),
    );
    for (const alias of aliases) {
      if (!referenced.has(alias)) stale.push({ alias, file });
    }
  }

  return {
    ok: uniqueMissing.length === 0 && stale.length === 0,
    files,
    references,
    missing: uniqueMissing.sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.alias.localeCompare(b.alias),
    ),
    stale,
  };
}

function main() {
  const root = resolve(process.env.NPM_ALIAS_REFERENCES_ROOT ?? process.cwd());
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const scripts = packageJson.scripts ?? {};
  const result = checkNpmAliasReferences({ root, scripts });
  const unique = new Set(result.references.map(({ alias }) => alias));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...result, files: result.files.length }, null, 2));
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  console.log(
    `[check:npm-alias-references] scanned ${result.files.length} file(s): ` +
      `${result.references.length} reference(s), ${unique.size} unique alias(es)`,
  );
  for (const item of result.missing) {
    console.error(
      `[check:npm-alias-references] FAIL ${item.file}:${item.line}: ` +
        `npm run ${item.alias} is not declared in package.json — declare the alias, ` +
        `correct the reference, or list the fixture in a "${FIXTURE_PRAGMA}" pragma`,
    );
  }
  for (const item of result.stale) {
    console.error(
      `[check:npm-alias-references] FAIL ${item.file}: the "${FIXTURE_PRAGMA}" pragma ` +
        `lists "${item.alias}", which the file no longer references — remove the entry`,
    );
  }
  if (!result.ok) {
    console.error(
      "[check:npm-alias-references] a documented or tested command nobody can run is " +
        "the same failure as a gate that does not exist",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `ok: ${Object.keys(scripts).length} declared script(s), ` +
      `${result.references.length} reference(s) all resolvable`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
