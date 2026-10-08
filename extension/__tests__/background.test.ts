import { describe, it, expect, vi, beforeEach } from "vitest";
import "./setup";

import "../background.js";

const installCallback =
  (globalThis as any).chrome.runtime.onInstalled.addListener.mock
    .calls[0][0];
const menuClickCallback =
  (globalThis as any).chrome.contextMenus.onClicked.addListener.mock
    .calls[0][0];

describe("background.js", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset storage to clean state between tests.
    (globalThis as any).chrome.storage.sync.clear();
  });

  it("survives without importScripts when the builder is preloaded (Firefox MV2)", async () => {
    // Firefox MV2 loads [capture-url.js, background.js] via background.scripts
    // and runs in a page/event-page context where importScripts does NOT
    // exist. The guard must skip the import (the global is already set) and
    // not throw at startup — a ReferenceError here would kill the entire
    // background script on Firefox.
    vi.resetModules();
    const testGlobal = globalThis as unknown as {
      importScripts: unknown;
    };
    const originalImportScripts = testGlobal.importScripts;
    testGlobal.importScripts = undefined;
    try {
      await expect(import("../background.js")).resolves.toBeDefined();
    } finally {
      testGlobal.importScripts = originalImportScripts;
    }
  });

  it("should create context menu item on install", async () => {
    await installCallback({ reason: "install" });

    expect(
      (globalThis as any).chrome.contextMenus.create,
    ).toHaveBeenCalledWith(
      {
        id: "save-to-bookmarkforge",
        title: "Save to BookmarkForge",
        contexts: ["page", "link"],
      },
      expect.any(Function),
    );
  });

  it("should open tab with fragment-hash URL using default base URL", async () => {
    await menuClickCallback(
      {
        menuItemId: "save-to-bookmarkforge",
        linkUrl: "https://example.com/link",
        pageUrl: "https://example.com/page",
      },
      { title: "Example" },
    );

    expect(
      (globalThis as any).chrome.tabs.create,
    ).toHaveBeenCalledWith(
      {
        url: expect.stringMatching(
          /^https:\/\/bookmarkforge\.com\/capture#/,
        ),
      },
      expect.any(Function),
    );

    const url = (globalThis as any).chrome.tabs.create.mock.calls[0][0]
      .url;
    expect(url).not.toContain("?");
    expect(url).toContain("#url=https%3A%2F%2Fexample.com%2Flink");
    expect(url).toContain("&title=Example");
  });

  it("should use custom base URL when configured in storage", async () => {
    await (globalThis as any).chrome.storage.sync.set({
      bookmarkforge_base_url: "https://my-forge.example.com",
    });

    await menuClickCallback(
      {
        menuItemId: "save-to-bookmarkforge",
        pageUrl: "https://example.com/page",
      },
      { title: "Custom" },
    );

    const url = (globalThis as any).chrome.tabs.create.mock.calls[0][0]
      .url;
    expect(url).toContain("https://my-forge.example.com/capture#");
    expect(url).not.toContain("bookmarkforgeapp.com");
  });

  it("should fall back to default URL when stored URL is invalid", async () => {
    // Store an invalid URL that fails the regex validation.
    await (globalThis as any).chrome.storage.sync.set({
      bookmarkforge_base_url: "not-a-valid-url",
    });

    await menuClickCallback(
      {
        menuItemId: "save-to-bookmarkforge",
        pageUrl: "https://example.com/page",
      },
      { title: "Example" },
    );

    const url = (globalThis as any).chrome.tabs.create.mock.calls[0][0]
      .url;
    // Must use the default URL, not the invalid stored one.
    expect(url).toContain("https://bookmarkforgeapp.com/capture#");
  });

  it("should block unsafe URL schemes", async () => {
    const unsafeUrls = [
      "chrome://extensions",
      "file:///C:/tmp/page.html",
      "view-source:https://example.com",
      "javascript:alert(1)",
    ];

    for (const unsafeUrl of unsafeUrls) {
      await menuClickCallback(
        {
          menuItemId: "save-to-bookmarkforge",
          linkUrl: unsafeUrl,
          pageUrl: "https://example.com/page",
        },
        { title: "Example" },
      );

      expect(
        (globalThis as any).chrome.tabs.create,
      ).not.toHaveBeenCalled();
      vi.clearAllMocks();
    }
  });

  it("should not create a tab when chrome.tabs.create returns null", async () => {
    (globalThis as any).chrome.tabs.create.mockImplementation(
      (_opts: unknown, cb: (tab: unknown) => void) => {
        cb(null);
      },
    );

    await menuClickCallback(
      {
        menuItemId: "save-to-bookmarkforge",
        pageUrl: "https://example.com/page",
      },
      { title: "Test" },
    );

    // Should not throw even when createdTab is null
    expect((globalThis as any).chrome.tabs.create).toHaveBeenCalled();
  });
});
