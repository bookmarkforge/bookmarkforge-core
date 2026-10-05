// S0/R1 fix: Same fragment-hash pattern as background.js so PWA URLs never
// leak via GET params to third-party logs / browser history / Referer headers.

const DEFAULT_BASE_URL = "https://bookmarkforge.com";
const STORAGE_KEY = "bookmarkforge_base_url";

const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const pageTitleEl = document.getElementById("pageTitle");
const pageUrlEl = document.getElementById("pageUrl");

// Settings elements
const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");
const customUrlInput = document.getElementById("customUrlInput");
const saveUrlBtn = document.getElementById("saveUrlBtn");
const urlStatusEl = document.getElementById("urlStatus");
const currentUrlDisplay = document.getElementById("currentUrlDisplay");
let urlDisplayRequest = 0;

// ── Base URL helpers ────────────────────────────────────────────────

async function getBaseUrl() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (typeof stored === "string" && stored.length > 0) {
      const trimmed = globalThis.BookmarkForgeCaptureUrl.normalizeBaseUrl(stored);
      if (globalThis.BookmarkForgeCaptureUrl.isValidBaseUrl(trimmed)) {
        return trimmed;
      }
    }
  } catch (_err) {
    /* storage unavailable — use default */
  }
  return DEFAULT_BASE_URL;
}

async function saveBaseUrl(url) {
  const trimmed = globalThis.BookmarkForgeCaptureUrl.normalizeBaseUrl(url);
  if (!globalThis.BookmarkForgeCaptureUrl.isValidBaseUrl(trimmed)) {
    showUrlStatus("Enter a valid HTTPS URL (e.g. https://bookmarkforge.com)", "error");
    return false;
  }
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: trimmed });
    showUrlStatus("Saved!", "success");
    return true;
  } catch (_err) {
    showUrlStatus("Could not save. Try again.", "error");
    return false;
  }
}

function showUrlStatus(msg, type) {
  if (!urlStatusEl) return;
  urlStatusEl.textContent = msg;
  urlStatusEl.className = `url-status url-status-${type}`;
  // Visibility toggled via the HTML `hidden` attribute so we don't need
  // `'unsafe-inline'` on the extension's CSP for inline style. The
  // built-in browser rule `[hidden] { display: none }` matches our
  // baseline; popup.css does not override `.url-status { display: ... }`.
  urlStatusEl.hidden = false;
  if (type === "success") {
    setTimeout(() => { urlStatusEl.hidden = true; }, 2000);
  }
}

async function refreshUrlDisplay() {
  const request = ++urlDisplayRequest;
  const url = await getBaseUrl();
  // Ignore an older read that started before a reset/save completed.
  if (request !== urlDisplayRequest) return;
  if (currentUrlDisplay) {
    currentUrlDisplay.textContent = url;
  }
  if (customUrlInput && url !== DEFAULT_BASE_URL) {
    customUrlInput.value = url;
  }
}

// ── Settings panel ──────────────────────────────────────────────────

if (settingsToggle && settingsPanel) {
  settingsToggle.addEventListener("click", () => {
    // Read state from the `.is-open` class so we don't need to set
    // inline `style.display`. The CSS rule `.settings-panel.is-open`
    // (in popup.css) overrides the default `display: none`.
    const isOpen = settingsPanel.classList.contains("is-open");
    settingsPanel.classList.toggle("is-open", !isOpen);
    settingsToggle.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) {
      refreshUrlDisplay();
      if (customUrlInput && customUrlInput.value === "") {
        getBaseUrl().then((url) => { customUrlInput.value = url; });
      }
    }
  });
}

if (saveUrlBtn) {
  saveUrlBtn.addEventListener("click", async () => {
    const url = customUrlInput ? customUrlInput.value : "";
    const saved = await saveBaseUrl(url);
    if (saved) {
      refreshUrlDisplay();
    }
  });
}

const resetUrlBtn = document.getElementById("resetUrlBtn");
if (resetUrlBtn) {
  resetUrlBtn.addEventListener("click", async () => {
    urlDisplayRequest += 1;
    try {
      await chrome.storage.sync.remove(STORAGE_KEY);
    } catch (_err) {
      /* best-effort */
    }
    if (customUrlInput) {
      customUrlInput.value = DEFAULT_BASE_URL;
    }
    // Update the display synchronously as well. A previously pending
    // refreshUrlDisplay() must not be allowed to put the removed URL back
    // into the UI after reset completes.
    if (currentUrlDisplay) {
      currentUrlDisplay.textContent = DEFAULT_BASE_URL;
    }
    showUrlStatus("Reset to default.", "success");
  });
}

// ── Main popup logic ────────────────────────────────────────────────

if (!saveBtn || !statusEl || !pageTitleEl || !pageUrlEl) {
  console.error("[BookmarkForge] popup: missing required DOM elements");
} else {
  // Pre-load the current base URL for display.
  refreshUrlDisplay();

  let currentTab = null;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) {
      showStatus("Unable to read current tab", "error");
      console.error("[BookmarkForge] tabs.query error:", chrome.runtime.lastError.message);
      return;
    }
    if (tabs && tabs[0]) {
      currentTab = tabs[0];
      pageTitleEl.textContent = currentTab.title || "Untitled";
      pageUrlEl.textContent = currentTab.url || "";
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (!currentTab || !currentTab.url) {
      showStatus("No page URL found", "error");
      return;
    }

    let pageUrl;
    try {
      pageUrl = new URL(currentTab.url);
    } catch {
      showStatus("Invalid page URL", "error");
      return;
    }
    if (!["http:", "https:"].includes(pageUrl.protocol)) {
      showStatus("This page cannot be captured", "error");
      return;
    }

    const baseUrl = await getBaseUrl();

    // Fragment hash — not transmitted to the server.
    const bfUrl = globalThis.BookmarkForgeCaptureUrl.buildCaptureUrl(baseUrl, {
      url: currentTab.url,
      title: currentTab.title || "",
    });

    saveBtn.disabled = true;
    chrome.tabs.create({ url: bfUrl }, (createdTab) => {
      saveBtn.disabled = false;
      if (chrome.runtime.lastError) {
        showStatus("Could not open BookmarkForge", "error");
        console.error("[BookmarkForge] tabs.create error:", chrome.runtime.lastError.message);
        return;
      }
      if (createdTab) {
        showStatus("BookmarkForge opened! Your page is being saved automatically.", "success");
      }
    });
  });
}

function showStatus(msg, type) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className = `status status-${type}`;
  // Visibility toggled via the HTML `hidden` attribute so we don't need
  // `'unsafe-inline'` on the extension's CSP for inline style. The
  // built-in browser rule `[hidden] { display: none }` matches our
  // baseline; popup.css does not override `.status { display: ... }`.
  statusEl.hidden = false;
}
