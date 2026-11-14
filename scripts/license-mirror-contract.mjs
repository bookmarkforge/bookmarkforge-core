/**
 * scripts/license-mirror-contract.mjs — license mirror drift contract.
 *
 * The public Core ships `api/` WITHOUT `server/`, so the serverless license
 * function cannot import the companion server's modules. Two files are
 * therefore maintained as declared copies:
 *
 *   api/license/_license-seats.ts    ↔  server/src/license-seats.ts
 *   api/license/_license-signing.ts  ↔  server/src/license-signing.ts
 *
 * Each api/ copy carries a header stating it is a mirror and must be kept in
 * sync — but nothing enforced it, so the copies could silently diverge (seat
 * accounting or signing canonicalization drifting between the hosted function
 * and the self-hosted signaling server). This module is the pure check:
 * comments and whitespace are stripped before comparing, because the two
 * copies legitimately carry different doc headers.
 *
 * api/license/_proxy-utils.ts is intentionally NOT a pair: its header (M7,
 *) documents that it is a reduced copy with no rate limiting.
 */

export const MIRROR_PAIRS = [
  {
    apiPath: "api/license/_license-seats.ts",
    serverPath: "server/src/license-seats.ts",
    label: "license-seats",
  },
  {
    apiPath: "api/license/_license-signing.ts",
    serverPath: "server/src/license-signing.ts",
    label: "license-signing",
  },
];

/**
 * Normalize a source file for mirror comparison: drop block comments, drop
 * line comments (a `//` preceded by `:` is left alone so `https://` inside
 * strings survives), then collapse all whitespace. Heuristic by design — the
 * gate compares code shape, not tokens; both copies are hand-maintained Type
 * *script sources* whose only legal difference is the doc header.
 *
 * @param {string} source
 * @returns {string}
 */
export function normalizeForMirrorCompare(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Assess mirror pairs against in-memory file contents.
 *
 * @param {object} files  map of repo-relative path → file content (utf8)
 * @returns {{ pair: string, apiPath: string, serverPath: string, status: "ok"|"missing"|"drift" }[]}
 */
export function assessLicenseMirrors(files) {
  return MIRROR_PAIRS.map((pair) => {
    const api = files[pair.apiPath];
    const server = files[pair.serverPath];
    if (api === undefined || server === undefined) {
      return { ...pair, status: "missing" };
    }
    const status =
      normalizeForMirrorCompare(api) === normalizeForMirrorCompare(server)
        ? "ok"
        : "drift";
    return { ...pair, status };
  });
}
