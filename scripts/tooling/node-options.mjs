/**
 * scripts/tooling/node-options.mjs — building NODE_OPTIONS values safely.
 *
 * NODE_OPTIONS is not an array: Node parses it as a command line, so a value is
 * split on whitespace and quotes/escapes are interpreted. A path handed to it
 * raw therefore breaks in two ways, and both are silent at the call site:
 *
 *   - a checkout whose path contains a space (`D:\Nueva carpeta\bookmark7`)
 *     splits the option — `--require=D:\Nueva carpeta\…\loader.cjs` preloads
 *     "D:\Nueva" and the real file is never loaded. A checkout without a space
 *     works, so the breakage only shows up on someone else's machine;
 *   - a backslash inside double quotes is an escape, so a raw Windows path
 *     loses its separators even when it IS quoted.
 *
 * `quoteNodeOptionPath` normalizes the separators to `/` (accepted on every
 * supported platform) and wraps the value in double quotes, which is what keeps
 * a preload alive under a path with spaces.
 *
 * Fail-closed: a path that is empty or carries a quote/line break cannot be
 * expressed in NODE_OPTIONS at all, and a silently wrong option is exactly the
 * failure this module exists to prevent — so it throws instead of emitting
 * something that splits differently than it reads.
 *
 * Caller: scripts/build-ci.mjs, for the win32/arm64 Rollup WASM preload
 * (`rollup-wasm-loader.cjs`). The failure mode is documented at that call site.
 */

/**
 * A path as a NODE_OPTIONS value: separators normalized, double-quoted.
 *
 * @param {string} path Absolute path of the module to preload.
 * @returns {string} The quoted option value, e.g.
 *   `"D:/Nueva carpeta/bookmark7/scripts/rollup-wasm-loader.cjs"`.
 */
export function quoteNodeOptionPath(path) {
  const value = String(path ?? "");
  if (value.trim().length === 0) {
    throw new Error("[node-options] quoteNodeOptionPath needs a path to quote");
  }
  if (/["\n\r]/.test(value)) {
    throw new Error(
      "[node-options] this path contains a quote or a line break and cannot be " +
        `expressed as a NODE_OPTIONS value: ${JSON.stringify(value)}`,
    );
  }
  return `"${value.replaceAll("\\", "/")}"`;
}
