// Shared capture URL builder used by the app bookmarklet and extension.
  // This file intentionally supports both MV3 module import and Firefox MV2
  // classic-script loading by exposing a small global namespace.
  (function exposeCaptureUrlBuilder(global) {
    // / self-hosted fix (2026-11-07): any HTTPS host is accepted.
    // The base URL is a user-chosen setting (chrome.storage.sync is only
    // writable by this extension or the user's own synced browser profile),
    // and BookmarkForge's core promise is "your bookmarks, your server" —
    // a host-pinned allowlist made every self-hosted domain unusable. The
    // remaining guards still apply: https only (http:// is rejected for
    // EVERY host, loopback included — there is no http exception), no
    // userinfo (credential theft), no empty/dash-leading hostname, and no
    // query string or fragment (they would corrupt the /capture#… URL the
    // builder appends).
    function normalizeBaseUrl(baseUrl) {
      return String(baseUrl || "").trim().replace(/\/+$/, "");
    }

    // Single source of truth for the custom base-URL validation shared by
    // background.js and popup.js. Both used to inline this regex; a future
    // change to one copy would silently diverge from the other.
    //
    // Uses WHATWG URL parsing instead of regex to avoid bypasses via
    // backslash normalization, tab/newline injection, or userinfo tricks
    // that regexes commonly miss.
    function isValidBaseUrl(value) {
      var normalized = normalizeBaseUrl(String(value || ""));
      if (!normalized) return false;
      try {
        var parsed = new URL(normalized);
        if (parsed.protocol !== "https:") return false;
        if (parsed.hostname === "" || parsed.hostname.startsWith("-")) return false;
        // Reject userinfo (user:pass@) before ANY acceptance path — a vector
        // for credential theft that also applies to loopback URLs.
        if (parsed.username || parsed.password) return false;
        // A query string or fragment on the BASE url would corrupt the
        // capture URL (buildCaptureUrl appends its own /capture#… suffix),
        // so both are rejected. A path prefix (self-hosted subpath installs)
        // stays valid.
        if (parsed.search || parsed.hash) return false;
        // Allow loopback for local development. WHATWG URL serializes IPv6
        // loopback with brackets, so the hostname is "[::1]".
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") return true;
        // Any other HTTPS host is a valid self-hosted BookmarkForge
        // instance chosen by the user.
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
    // Build via the WHATWG URL API instead of string concatenation: the
    // hash setter percent-encodes stray characters and guarantees a single
    // well-formed fragment, so an exotic (but validated) base can never
    // produce a broken capture URL.
    var capture = new URL(base + "/capture");
    capture.hash = "url=" + url + "&title=" + title + "&text=" + text;
    return capture.toString();
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
