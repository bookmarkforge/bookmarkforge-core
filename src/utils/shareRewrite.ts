/**
 * shareRewrite.ts
 *
 * Pure URL-rewrite logic for the PWA `share_target` / `web+bookmark:`
 * protocol handler / browser-extension bookmark deliveries.
 *
 * Extracted from `App.tsx` (P74) so the PROD-only module-load side effect
 * (`captureShareParamsToHashOnce`) is a thin wrapper over testable pure
 * logic. No `window` access here — callers pass the parsed URL parts.
 */

interface ShareRewriteResult {
  /** Pathname to render after the rewrite (may be forced to /capture). */
  path: string;
  /** Remaining query-string params (any url/title/text/add already moved out). */
  search: string;
  /** Fragment-hash params to persist (url/title/text promoted into here). */
  hash: string;
  /** True when the URL actually needs rewriting (a delivery happened). */
  rewrote: boolean;
}

/**
 * Compute the fragment-only rewrite for an incoming delivery URL.
 *
 * Semantics:
 *  - `?url=` / `?title=` / `?text=` (mobile `share_target` form) are
 *    promoted from the search string into the fragment hash.
 *  - `?add=` (protocol handler + extension) is mapped to `#url=` and forces
 *    the pathname to `/capture`.
 *  - P74: a `share_target` delivery (`#url=` present) also forces `/capture`
 *    so mobile "Share to BookmarkForge" lands in the capture UI instead of
 *    the dashboard with a dangling hash. The extension already targets
 *    `/capture#url=…` directly, so its hash-only case returns `rewrote:false`.
 */
export function computeShareRewrite(
  searchString: string,
  hashString: string,
  pathname: string,
): ShareRewriteResult {
  const sp = new URLSearchParams(searchString);
  const hp = new URLSearchParams(hashString.replace(/^#/, ""));

  let path = pathname;
  let rewrote = false;

  // Promote `?url=`, `?title=`, `?text=` from the search string into the
  // existing fragment-hash params (npm share-sheet `share_target` form).
  for (const k of ["url", "title", "text"]) {
    const v = sp.get(k);
    if (v !== null && v.length > 0) {
      hp.set(k, v);
      sp.delete(k);
      rewrote = true;
    }
  }

  // P74: a share_target delivery means a bookmark is being handed to the
  // app — route to the capture UI just like `?add=` does below. Without
  // this the params would sit unused in the hash while the dashboard
  // rendered, making mobile "Share to BookmarkForge" appear to do nothing.
  // (The extension already targets `/capture#url=…` directly, so it never
  // hits this branch.) Note `rewrote` must be set so the caller does not
  // early-return before applying the path change (the hash-only
  // `/app#url=…` edge case).
  if (hp.has("url") && path !== "/capture") {
    path = "/capture";
    rewrote = true;
  }

  // `?add=…` arrives from the `web+bookmark:` protocol handler and the
  // browser extension. The Capture route reads `#url=` (matched to
  // `params.url` in `src/components/Capture.tsx`), so map `?add=` to
  // `#url=` and force the pathname to `/capture` so the route branch in
  // `App()` mounts `<CaptureApp>` on first render.
  const add = sp.get("add");
  if (add !== null && add.length > 0) {
    hp.set("url", add);
    hp.delete("add");
    sp.delete("add");
    if (path !== "/capture") {
      path = "/capture";
    }
    rewrote = true;
  }

  return {
    path,
    search: sp.toString(),
    hash: hp.toString(),
    rewrote,
  };
}
