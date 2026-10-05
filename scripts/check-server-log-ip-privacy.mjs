#!/usr/bin/env node
/**
 * Reject raw client/network IP fields in structured server logs.
 *
 * The signaling and API servers may use an address internally for rate
 * limiting, but structured logs must contain only an anonymized fingerprint
 * (for example `ipHash`). This gate scans JSON.stringify object payloads in
 * server source files, not arbitrary implementation variables, so using
 * `clientIp` internally remains valid while logging it is rejected.
 *
 * Usage:
 *   node scripts/check-server-log-ip-privacy.mjs
 *   node scripts/check-server-log-ip-privacy.mjs server/src/index.ts
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const DEFAULT_ROOT = resolve(ROOT, "server", "src");

// Deliberately reject both canonical names and common aliases. Hash fields
// are not included: `ipHash`, `clientIpHash`, and `remoteAddressHash` are
// approved anonymized representations.
const RAW_IP_FIELD_RE = /^(?:ip|clientIp|clientIP|remoteAddress|remoteIp|remoteIP|forwardedFor|xForwardedFor|x-forwarded-for|clientAddress|peerIp|peerIP)$/i;
const HASHED_IP_FIELD_RE = /(?:^|)(?:ip|address|forwarded|client|peer)(?:Hash|Fingerprint)$/i;

function collectSourceFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) return /\.(?:ts|tsx|mjs|cjs|js)$/.test(path) ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") return collectSourceFiles(child);
    return entry.isFile() && /\.(?:ts|tsx|mjs|cjs|js)$/.test(entry.name) ? [child] : [];
  });
}

function lineNumber(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function isStructuredLogPayload(text, offset) {
  const before = text.slice(Math.max(0, offset - 160), offset);
  return /(?:console\.(?:debug|info|warn|error)|logger\.(?:debug|info|warn|error))\s*\(/.test(before);
}

export function scanServerLogIpPrivacyText(text, file = "<inline>") {
  const violations = [];
  const stringifyRe = /JSON\.stringify\s*\(\s*\{/g;
  let match;
  while ((match = stringifyRe.exec(text)) !== null) {
    if (!isStructuredLogPayload(text, match.index)) continue;
    const start = match.index + match[0].length;
    const end = text.indexOf("})", start);
    const payload = end === -1 ? text.slice(start) : text.slice(start, end);
    const fieldRe = /(?:["']([^"']+)["']|([A-Za-z_$][\w$-]*))\s*:/g;
    let field;
    while ((field = fieldRe.exec(payload)) !== null) {
      const fieldName = field[1] ?? field[2] ?? "";
      if (HASHED_IP_FIELD_RE.test(fieldName)) continue;
      if (RAW_IP_FIELD_RE.test(fieldName)) {
        violations.push({
          file: relative(ROOT, file).replaceAll("\\", "/"),
          line: lineNumber(text, start + field.index),
          field: fieldName,
          reason: "structured server logs must use an anonymized IP hash (for example ipHash), never a raw IP field",
        });
      }
    }
  }
  return violations;
}

export function scanServerLogIpPrivacy(paths = [DEFAULT_ROOT]) {
  const violations = [];
  for (const input of paths) {
    const path = resolve(ROOT, input);
    if (!existsSync(path)) {
      violations.push({ file: input, line: 0, field: "<missing>", reason: "server log source path does not exist" });
      continue;
    }
    for (const file of collectSourceFiles(path)) {
      violations.push(...scanServerLogIpPrivacyText(readFileSync(file, "utf8"), file));
    }
  }
  return violations;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const paths = process.argv.slice(2);
  const violations = scanServerLogIpPrivacy(paths.length > 0 ? paths : [DEFAULT_ROOT]);
  if (violations.length > 0) {
    console.error("[check-server-log-ip-privacy] FAIL");
    for (const violation of violations) {
      console.error(`- ${violation.file}:${violation.line} field=${violation.field}: ${violation.reason}`);
    }
    process.exit(1);
  }
  console.log("[check-server-log-ip-privacy] structured server logs contain no raw IP fields");
}
