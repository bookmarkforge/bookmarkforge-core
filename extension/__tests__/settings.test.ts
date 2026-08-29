import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "./setup";

/** Mock chrome.storage.sync for the settings tests. */
function mockStorage() {
  const store = new Map<string, unknown>();
  (globalThis as any).chrome.storage = {
    sync: {
      get: vi.fn(
        (keys: string | string[] | Record<string, unknown>) => {
          if (typeof keys === "string") {
            return Promise.resolve({ [keys]: store.get(keys) ?? null });
          }
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const k of keys) {
              result[k] = store.get(k) ?? null;
            }
            return Promise.resolve(result);
          }
          return Promise.resolve({});
        },
      ),
      set: vi.fn((items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          store.set(k, v);
        }
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) store.delete(k);
        return Promise.resolve();
      }),
    },
  };
  return store;
}

const DEFAULT_URL = "https://bookmarkforge.com";

describe("popup.js — settings panel", () => {
  let storageMap: Map<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.resetModules();

    storageMap = mockStorage();

    (globalThis as any).chrome.tabs.create.mockReset();
    (globalThis as any).chrome.tabs.query.mockReset();

    // DOM for the new settings panel + original elements
    document.body.innerHTML = `
      <div id="pageTitle">Loading...</div>
      <div id="pageUrl">Loading...</div>
      <button id="saveBtn">Save to BookmarkForge</button>
      <div id="status" style="display:none"></div>
      <button id="settingsToggle" aria-expanded="false" aria-controls="settingsPanel">⚙ Settings</button>
      <div id="settingsPanel" role="region" aria-labelledby="settingsLabel" style="display:none">
        <div id="settingsLabel" class="settings-label">BookmarkForge URL</div>
        <div class="settings-current">
          Current: <span id="currentUrlDisplay">…</span>
        </div>
        <input type="url" id="customUrlInput" class="settings-input" placeholder="https://bookmarkforge.com" autocomplete="off" spellcheck="false">
        <button id="saveUrlBtn" class="settings-btn">Save</button>
        <button id="resetUrlBtn" class="settings-btn settings-btn-secondary">Reset</button>
        <div id="urlStatus" class="url-status" style="display:none" role="status" aria-live="polite"></div>
      </div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Default behavior ────────────────────────────────────────────

  it("displays the default URL when no custom URL is stored", async () => {
    await import("../popup.js");
    await vi.runAllTimersAsync();

    const display = document.getElementById("currentUrlDisplay");
    await vi.waitFor(() => {
      expect(display?.textContent).toBe(DEFAULT_URL);
    });
  });

  it("save button still opens capture tab with default URL", async () => {
    await import("../popup.js");
    await vi.runAllTimersAsync();

    // Simulate active tab
    const queryCallback =
      (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([
      { title: "Test", url: "https://example.com/page" },
    ]);

    document.getElementById("saveBtn")?.click();
    await vi.waitFor(() => expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled());

    const url = (globalThis as any).chrome.tabs.create.mock.calls[0][0]
      .url;
    expect(url).toContain(DEFAULT_URL);
  });

  // ── Custom URL save ─────────────────────────────────────────────

  it("saves a valid custom URL and updates the display", async () => {
    await import("../popup.js");
    await vi.runAllTimersAsync();

    // Open settings
    document.getElementById("settingsToggle")?.click();

    // Type a custom URL
    const input = document.getElementById(
      "customUrlInput",
    ) as HTMLInputElement;
    input.value = "https://my-forge.example.com";
    document.getElementById("saveUrlBtn")?.click();

    // Wait for the async save
    await vi.runAllTimersAsync();

    // The display must update
    const display = document.getElementById("currentUrlDisplay");
    await vi.waitFor(() => {
      expect(display?.textContent).toBe(
        "https://my-forge.example.com",
      );
    });

    // chrome.storage.sync.set must have been called
    expect(
      (globalThis as any).chrome.storage.sync.set,
    ).toHaveBeenCalledWith({
      bookmarkforge_base_url: "https://my-forge.example.com",
    });
  });

  it("custom URL is used for the capture link after saving", async () => {
    // Pre-populate storage
    storageMap.set(
      "bookmarkforge_base_url",
      "https://my-forge.example.com",
    );

    await import("../popup.js");
    await vi.runAllTimersAsync();

    const queryCallback =
      (globalThis as any).chrome.tabs.query.mock.calls[0][1];
    queryCallback([{ title: "T", url: "https://example.com" }]);

    document.getElementById("saveBtn")?.click();
    await vi.waitFor(() => expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled());

    const url = (globalThis as any).chrome.tabs.create.mock.calls[0][0]
      .url;
    expect(url).toContain("https://my-forge.example.com/capture#");
    expect(url).not.toContain(DEFAULT_URL);
  });

  // ── URL validation ──────────────────────────────────────────────

  it.each([
    ["not-a-url"],
    ["ftp://files.example.com"],
    ["http://insecure.example.com"],
    ["   "],
    ["javascript:alert(1)"],
  ])("rejects invalid URL: %s", async (invalidUrl) => {
    await import("../popup.js");
    await vi.runAllTimersAsync();

    document.getElementById("settingsToggle")?.click();
    const input = document.getElementById(
      "customUrlInput",
    ) as HTMLInputElement;
    input.value = invalidUrl;
    document.getElementById("saveUrlBtn")?.click();

    await vi.runAllTimersAsync();

    // Error message must appear
    const urlStatus = document.getElementById("urlStatus");
    expect(urlStatus?.textContent).toMatch(
      /valid HTTPS|Enter a valid/,
    );

    // chrome.storage.sync.set must NOT have been called with the invalid URL
    const setCalls = (
      (globalThis as any).chrome.storage.sync.set as ReturnType<
        typeof vi.fn
      >
    ).mock.calls.filter(
      (c: unknown[]) =>
        (c[0] as Record<string, string>)?.bookmarkforge_base_url ===
        invalidUrl,
    );
    expect(setCalls).toHaveLength(0);
  });

  it("strips trailing slashes from saved URLs", async () => {
    await import("../popup.js");
    await vi.runAllTimersAsync();

    document.getElementById("settingsToggle")?.click();
    const input = document.getElementById(
      "customUrlInput",
    ) as HTMLInputElement;
    input.value = "https://example.com/path///";
    document.getElementById("saveUrlBtn")?.click();

    await vi.runAllTimersAsync();

    expect(
      (globalThis as any).chrome.storage.sync.set,
    ).toHaveBeenCalledWith({
      bookmarkforge_base_url: "https://example.com/path",
    });
  });

  // ── Reset ───────────────────────────────────────────────────────

  it("reset button clears stored URL and reverts display to default", async () => {
    storageMap.set(
      "bookmarkforge_base_url",
      "https://custom.example.com",
    );

    await import("../popup.js");
    await vi.runAllTimersAsync();

    document.getElementById("settingsToggle")?.click();
    document.getElementById("resetUrlBtn")?.click();

    await vi.runAllTimersAsync();

    // chrome.storage.sync.remove must have been called
    expect(
      (globalThis as any).chrome.storage.sync.remove,
    ).toHaveBeenCalledWith("bookmarkforge_base_url");

    // Display must revert to default
    const display = document.getElementById("currentUrlDisplay");
    await vi.waitFor(() => {
      expect(display?.textContent).toBe(DEFAULT_URL);
    });

    // Input must show default
    const input = document.getElementById(
      "customUrlInput",
    ) as HTMLInputElement;
    await vi.waitFor(() => expect(input.value).toBe(DEFAULT_URL));
  });

  // ── Settings panel toggle ───────────────────────────────────────

  it("settings toggle opens and closes the panel", async () => {
    await import("../popup.js");
    await vi.runAllTimersAsync();

    const toggle = document.getElementById("settingsToggle")!;
    const panel = document.getElementById("settingsPanel")!;

    // Initially hidden (CSS class-based; popup.js toggles .is-open, not style.display)
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // Open
    toggle.click();
    expect(panel.classList.contains("is-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Close
    toggle.click();
    expect(panel.classList.contains("is-open")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  // ── Storage unavailable ─────────────────────────────────────────

  it("falls back to default URL when storage.sync.get rejects", async () => {
    (globalThis as any).chrome.storage.sync.get = vi.fn(() =>
      Promise.reject(new Error("Storage unavailable")),
    );

    await import("../popup.js");
    await vi.runAllTimersAsync();

    const display = document.getElementById("currentUrlDisplay");
    await vi.waitFor(() => {
      expect(display?.textContent).toBe(DEFAULT_URL);
    });
  });

  it("shows error when storage.sync.set rejects", async () => {
    (globalThis as any).chrome.storage.sync.set = vi.fn(() =>
      Promise.reject(new Error("Storage full")),
    );

    await import("../popup.js");
    await vi.runAllTimersAsync();

    document.getElementById("settingsToggle")?.click();
    const input = document.getElementById(
      "customUrlInput",
    ) as HTMLInputElement;
    input.value = "https://valid.example.com";
    document.getElementById("saveUrlBtn")?.click();

    await vi.runAllTimersAsync();

    const urlStatus = document.getElementById("urlStatus");
    expect(urlStatus?.textContent).toBe(
      "Could not save. Try again.",
    );
  });
});
