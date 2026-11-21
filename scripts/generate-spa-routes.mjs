#!/usr/bin/env node
/**
 * scripts/generate-spa-routes.mjs — write the SPA-shell rewrite rules into the
 * three hand-maintained host configs from the one route source
 * (scripts/app-routes.mjs), so a route added to AppRoutes.tsx is mirrored here
 * instead of retyped in three syntaxes.
 *
 * public/nginx.conf is deliberately NOT one of them: scripts/nginx-render.mjs
 * owns that file wholesale and builds the same alternation from the same source.
 *
 * Only the shell rules are written back — headers, public rewrites, redirects
 * and non-SPA locations stay byte-identical, line endings included.
 * check:spa-routes is the gate; this script only writes.
 *
 * Usage: node scripts/generate-spa-routes.mjs
 * (`build:landings` and `check:spa-routes` are the wired entry points.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { APP_SHELL, isDynamicRuleSource, readClientRoutes, shellRules } from "./app-routes.mjs";

const ROOT = process.cwd();

const spaPaths = shellRules(readClientRoutes());

const isComment = (line) => {
  const text = line.trim();
  return text === "" || text.startsWith("#") || text.startsWith("!");
};

/** Read a config with CRLF folded to LF, so the surgery below stays simple. */
function read(path) {
  const raw = readFileSync(join(ROOT, path), "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), eol: raw.includes("\r\n") ? "\r\n" : "\n" };
}

/** Write back with the file's own line endings, so only edited lines move. */
function write(path, text, eol) {
  const body = eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
  writeFileSync(join(ROOT, path), body, "utf8");
}

// ── vercel.json ──────────────────────────────────────────────────────────────
{
  const path = "vercel.json";
  const { text, eol } = read(path);
  const json = JSON.parse(text);
  const others = (json.rewrites ?? []).filter((rule) => rule.destination !== APP_SHELL);
  const shell = spaPaths.map((source) => ({ source, destination: APP_SHELL }));
  json.rewrites = [...others, ...shell];
  write(path, `${JSON.stringify(json, null, 2)}\n`, eol);
}

// ── public/_redirects ────────────────────────────────────────────────────────
{
  const path = "public/_redirects";
  const { text, eol } = read(path);
  // Keep every row that is not a shell rule, comments included.
  const kept = text.split("\n").filter((line) => {
    if (isComment(line)) return true;
    const [, target, status] = line.trim().split(/\s+/);
    return !(target === APP_SHELL && Number(status) === 200);
  });
  // Reinsert above the first dynamic rule: Cloudflare reads every row after a
  // splat or placeholder as dynamic and drops the file's tail once the
  // 100-rule cap is reached (see the ordering contract in the file's header).
  const firstDynamic = kept.findIndex(
    (line) => !isComment(line) && isDynamicRuleSource(line.trim().split(/\s+/)[0]),
  );
  const rules = spaPaths.map((path) => `${path} ${APP_SHELL} 200`);
  kept.splice(firstDynamic === -1 ? kept.length : firstDynamic, 0, ...rules);
  write(path, kept.join("\n"), eol);
}

// ── netlify.toml ─────────────────────────────────────────────────────────────
{
  const path = "netlify.toml";
  const { text, eol } = read(path);
  const blocks = text.split(/(?=\[\[redirects\]\])/);
  const kept = blocks.filter((block) => !block.includes(`to = "${APP_SHELL}"`));
  const rules = spaPaths
    .map((path) => `[[redirects]]\n  from = "${path}"\n  to = "${APP_SHELL}"\n  status = 200\n`)
    .join("");
  write(path, kept.join("") + rules, eol);
}

console.log(`[generate-spa-routes] ${spaPaths.length} spa rules written`);
