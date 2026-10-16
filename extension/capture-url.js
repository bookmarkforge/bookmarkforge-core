// Shared capture URL builder used by the app bookmarklet and extension.
// This file intentionally supports both MV3 module import and Firefox MV2
// classic-script loading by exposing a small global namespace.
(function exposeCaptureUrlBuilder(global) {
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
      return parsed.protocol === "https:" &&
        parsed.hostname !== "" &&
        !parsed.hostname.startsWith("-");
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
