# ADR-042: CSS-only user themes (D4)

- **Status:** accepted (implemented; this record formalizes the existing decision)
- **Date:** 2026-09-02 (retro-documented from `src/services/ThemeService.ts` and its adversarial suite)

## Context

Visual personalization was a risk surface with no recorded decision:
a "user theme" is, as far as the browser is concerned, CSS controlled by the
user (or by a future import) injected into the app's document —
the same document that displays the decrypted vault. The classic vectors of
CSS as an execution/exfiltration channel (external `@import`, `url()`,
`expression()`, `behavior:`, `-moz-binding`, `javascript:` schemes) can
turn an innocent theme into a leak channel: a network request with data
encoded in the URL is silent exfiltration in a local-first app whose
production CSP is the only remaining defensive line. The "D4" decision of the
ADR-042 series fixes the theming model as **CSS-only with fail-closed
sanitization**.

## Decision

1. **A theme is pure CSS, nothing else.** The data model is exclusively a
   stylesheet: no JS, no HTML, no external URLs. Any
   construct that could load an external resource or execute code is
   outside the allowed language by design, not by output filtering.
2. **Fail-closed sanitization (`sanitizeThemeCss`).** The service rejects the
   whole theme if it finds any of the forbidden constructs:
   `@import`, `url(`, `expression(`, `behavior:`, `javascript:`,
   `-moz-binding`. The prior normalization (`normalizeCssForSafety`) neutralizes
   the syntactic evasions a browser would treat as equivalent:
   comments (`u/**/rl(`), CSS hexadecimal escapes (`u\72 l(`), identifier escapes, and
   discards escapes toward invalid code points
   (NUL, > 0x10FFFF, surrogates). Without a valid theme there is no application:
   denial is the default answer.
3. **Volume limit.** Maximum **64 KB** of CSS per theme: it bounds the
   hashing/parsing cost and eliminates the "50 MB theme" class as a
   UI-thread degradation vector.
4. **Injection via `textContent`, never `innerHTML`.** The theme is applied to a
   dedicated `<style id="bookmarkforge-user-theme" data-bookmarkforge-theme="user">`,
   created once and reused, via `textContent` — escaping to
   markup is structurally impossible, not a code style rule.
5. **Local, re-sanitized persistence.** The CSS is stored in localStorage
   (`forge_user_theme_css`) only after passing the sanitizer, and `load()`
   **re-sanitizes on read**: a theme poisoned by external manipulation of the
   storage (devtools, another tab) does not come back to life — it fails as `null` and is not
   applied. Opt-in and 100% local: there is no theme synchronization.
6. **Adversarial coverage anchored to the suite.** `ThemeService.test.ts`
   exercises the known evasions (CSS escapes, comment obfuscation,
   legacy IE/Gecko vectors, volume limit) and the complete
   apply/clear/persist/load cycle, including the corrupted-theme-in-storage
   case.

## Consequences

- The personalization surface is inert by construction: the worst case
  for a malicious theme is invalid CSS that is not applied — never a
  network request, never code execution.
- New rules (e.g. allowing internal `url(#fragment)`, data-URIs) are
  ADR-level changes: every new permission reopens an exfiltration channel in
  an app whose trust budget is zero by design.
- The dedicated `<style>` makes cascade reasoning trivial (one node, one
  identity, removal = clean state) and avoids threading the theme through component
  DOM.
- Numbering: the ADR-042 series remains implicit prose except for this
  D4 decision, now formalized. ADR-042 is not part of the anchor catalog
  (`scripts/audit-anchors.mjs`); its protection is the adversarial unit suite
  already in `src/tests/services/ThemeService.test.ts`.
