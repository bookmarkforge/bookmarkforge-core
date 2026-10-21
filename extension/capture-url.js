// Shared capture URL builder used by the app bookmarklet and extension.
  // This file intentionally supports both MV3 module import and Firefox MV2
  // classic-script loading by exposing a small global namespace.
  (function exposeCaptureUrlBuilder(global) {
    // Audit M3: the default base URL is the only host allowed without
    // explicit user configuration. A user may override to a self-hosted
    // instance, but the override must be a host-pinned HTTPS URL that is
    // NOT a known phishing domain. The allowlist below is intentionally
    // narrow: it covers the production host, the www alias, and the
    // documented self-host domains. Arbitrary HTTPS hosts are rejected
    // to prevent an attacker with local browser access (or a malicious
    // chrome.storage.sync injection) from redirecting capture traffic
    // to an external server.
    const ALLOWED_HOSTS = Object.freeze([
      "bookmarkforgeapp.com",
      "www.bookmarkforgeapp.com",
      "bookmarkforge.dev",
      "www.bookmarkforge.dev",
      "localhost",
    ]);

    function normalizeBaseUrl(baseUrl) {
      return String(baseUrl || "").trim().replace(/\/+$/, "");
    }

    // Single source of truth for the custom base-URL validation shared by
    // background.js and popup.js. Both used to inline this regex; a future
    // change to one copy would silently diverge from the other.
    //
    // Uses WHATWG URL parsing instead of regex to avoid bypasses via
    // backslash normalization, tab/newline injection, or userinfo tricks
    // that regexes commonly miss. Audit M3: additionally restricts the
    // hostname to the allowlist above.
    function isValidBaseUrl(value) {
      var normalized = normalizeBaseUrl(String(value || ""));
      if (!normalized) return false;
      try {
        var parsed = new URL(normalized);
        if (parsed.protocol !== "https:") return false;
        if (parsed.hostname === "" || parsed.hostname.startsWith("-")) return false;
        // Allow loopback for local development.
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") return true;
        // Audit M3: host-pinned allowlist. Rejects arbitrary HTTPS hosts.
        if (!ALLOWED_HOSTS.includes(parsed.hostname)) return false;
        // Reject userinfo (user:pass@) — a vector for credential theft.
        if (parsed.username || parsed.password) return false;
        return true;
      } catch (_e) {
        return false;
      }
    }

  function buildCaptureUrl(baseUrl, values) {
    var base = normalizeBaseUrl(baseUrl);
    var url = encodeURIComponent(String(values && values.url || ""));
    var title = encodeURIComponent(String(values && values.title || ""));
    var text = encodeURIComponent(String(values && values.text || ""));
    return base + "/capture#url=" + url + "&title=" + title + "&text=" + text;
  }

  function createBookmarklet(baseUrl) {
    var serializedBase = JSON.stringify(normalizeBaseUrl(baseUrl));
    return "javascript:(function(){" +
      "var b=" + serializedBase + ";" +
      "var u=encodeURIComponent(window.location.href);" +
      "var t=encodeURIComponent(document.title||'');" +
      "var s=encodeURIComponent(((document.querySelector('meta[name=\\\"description\\\"]')||{}).content)||'');" +
      "window.open(b+'/capture#url='+u+'&title='+t+'&text='+s,'_blank');" +
      "})();";
  }

  global.BookmarkForgeCaptureUrl = Object.freeze({
    buildCaptureUrl: buildCaptureUrl,
    createBookmarklet: createBookmarklet,
    normalizeBaseUrl: normalizeBaseUrl,
    isValidBaseUrl: isValidBaseUrl,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
