// MV3 (Chrome service worker) must import the shared builder explicitly;
// MV2 (Firefox) already loads capture-url.js first via background.scripts and
// runs in a page/event-page context where importScripts does NOT exist — an
// unconditional call would throw at startup and kill the whole background.
// The guard also makes a duplicate load a no-op on MV2.
if (
  typeof importScripts === "function" &&
  typeof globalThis.BookmarkForgeCaptureUrl === "undefined"
) {
  importScripts("./capture-url.js");
}

// S0/R1 fix: Use fragment hash (#url=…&title=…) instead of GET params (?url=…&title=…).
// Fragment hash is NEVER transmitted to the server, so URLs/titles never appear
// in CDN logs, browser history, or Referer headers.

const DEFAULT_BASE_URL = "https://bookmarkforge.com";
const STORAGE_KEY = "bookmarkforge_base_url";

// Capture only web pages. Block chrome://, file://, ftp://, view-source:, etc.
// Keep this policy aligned with extension/popup.js and the app capture route.
const SAFE_SCHEME = /^https?:/i;

/**
 * Returns the user-configured BookmarkForge base URL, or the default.
 * Validates that the stored value is a plausible https:// URL to prevent
 * accidental (or malicious) misconfiguration.
 */
async function getBaseUrl() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (typeof stored === "string" && stored.length > 0) {
      const trimmed = globalThis.BookmarkForgeCaptureUrl.normalizeBaseUrl(stored);
      if (globalThis.BookmarkForgeCaptureUrl.isValidBaseUrl(trimmed)) {
        return trimmed;
      }
      console.warn(
        "[BookmarkForge] Ignoring invalid custom URL:",
        stored.slice(0, 80),
      );
    }
  } catch (err) {
    console.debug("[BookmarkForge] storage.sync.get failed, using default:", err);
  }
  return DEFAULT_BASE_URL;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: "save-to-bookmarkforge",
      title: "Save to BookmarkForge",
      contexts: ["page", "link"],
    },
    () => {
      if (chrome.runtime.lastError) {
        // Menu may already exist on update; ignore duplicate id errors.
        console.debug("[BookmarkForge] contextMenus.create:", chrome.runtime.lastError.message);
      }
    },
  );
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    const url = info.linkUrl || info.pageUrl || tab?.url;
    const title = tab?.title || "";

    if (!url) return;

    // Block unsafe schemes (chrome://, file://, view-source:, etc.)
    if (!SAFE_SCHEME.test(url)) {
      console.warn("[BookmarkForge] Unsafe URL scheme blocked:", url.slice(0, 60));
      return;
    }

    const baseUrl = await getBaseUrl();

    // Fragment hash — stays in the browser, never reaches the server.
    const bfUrl = globalThis.BookmarkForgeCaptureUrl.buildCaptureUrl(baseUrl, {
      url,
      title,
    });

    chrome.tabs.create({ url: bfUrl }, (createdTab) => {
      if (chrome.runtime.lastError) {
        console.error("[BookmarkForge] tabs.create error:", chrome.runtime.lastError.message);
        return;
      }
      if (!createdTab) {
        console.warn("[BookmarkForge] tabs.create returned no tab");
      }
    });
  } catch (err) {
    console.error("[BookmarkForge] contextMenus.onClicked error:", err);
  }
});
