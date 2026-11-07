/* Theme bootstrap — applies the visitor's saved theme BEFORE first paint.
 *
 * WHY: landing.js is loaded with `defer`, so on every landing navigation the
 * page painted in the default theme first and only then switched to the saved
 * one — a visible flash on each hop between landings, and the reason "the theme
 * doesn't stick" reads as true even though localStorage does persist it.
 *
 * WHY NOT INLINE: the shipped CSP is `script-src 'self'` (no 'unsafe-inline',
 * no hashes), so an inline <script> in <head> would be blocked — the exact trap
 * public/help.css documents for stylesheets. A tiny external file is the only
 * pre-paint hook this policy allows, and it is render-blocking by design.
 *
 * Keep this file tiny and dependency-free: it runs before anything else, and
 * every landing <head> waits on it. landing.js re-runs the same logic after
 * load (and syncs the toggle icons/aria state), so the two must agree on the
 * storage key and on the "no attribute = dark" convention.
 */
(function () {
  try {
    var saved = localStorage.getItem('bmf_landing_theme');
    var theme =
      saved === 'light' || saved === 'dark'
        ? saved
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark';
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (_e) {
    /* Storage disabled (private mode): keep the default theme. */
  }
})();
