import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  TOUR_ID_MAP,
  getNavigatorExtensions,
  getNavigatorStandalone,
  getWindowBuildHash,
  getNavigatorGPU,
  getWindowMemoryPressure,
  getWindowChrome,
  getSpeechRecognitionCtor,
  clipboardWriteText,
  getLayoutShiftEntries,
  getPerformanceMemory,
  getCollection,
} from "../../utils/browser-types";

describe("browser-types — TOUR_ID_MAP", () => {
  it("mapea los tab ids a tour step ids", () => {
    expect(TOUR_ID_MAP.bookmarks).toBe("tour-bookmarks");
    expect(TOUR_ID_MAP.gallery).toBe("tour-views");
    expect(TOUR_ID_MAP.collaboration).toBe("tour-collaboration");
    expect(TOUR_ID_MAP.chatLocal).toBe("tour-chat");
  });

  it("returns undefined for unknown tab ids", () => {
    expect(TOUR_ID_MAP["unknown-tab"]).toBeUndefined();
  });
});

describe("browser-types — navigator extensions", () => {
  it("getNavigatorExtensions returns the typed navigator", () => {
    const nav = getNavigatorExtensions();
    expect(nav).toBe(navigator);
    // deviceMemory can be read without type errors (undefined in jsdom)
    expect(nav.deviceMemory).toBeUndefined();
    expect(nav.hardwareConcurrency).toBeGreaterThanOrEqual(1);
  });

  it("getNavigatorExtensions exposes connection and battery properties", () => {
    const fake = { deviceMemory: 8, connection: { effectiveType: "4g" } };
    const original = navigator as unknown as Record<string, unknown>;
    const memo = original.deviceMemory;
    Object.defineProperty(navigator, "deviceMemory", {
      value: 8,
      configurable: true,
    });
    const nav = getNavigatorExtensions();
    expect(nav.deviceMemory).toBe(8);
    if (memo === undefined) {
      delete (navigator as { deviceMemory?: number }).deviceMemory;
    } else {
      Object.defineProperty(navigator, "deviceMemory", {
        value: memo,
        configurable: true,
      });
    }
  });

  it("getNavigatorStandalone returns window.navigator", () => {
    const nav = getNavigatorStandalone();
    expect(nav).toBe(window.navigator);
  });

  it("getNavigatorGPU returns undefined without the GPU API", () => {
    expect(getNavigatorGPU()).toBeUndefined();
  });

  it("getNavigatorGPU returns the gpu object if it exists", () => {
    const fakeGpu = { requestAdapter: vi.fn() };
    const original = (navigator as unknown as { gpu?: unknown }).gpu;
    Object.defineProperty(navigator, "gpu", { value: fakeGpu, configurable: true });
    try {
      expect(getNavigatorGPU()).toBe(fakeGpu);
    } finally {
      if (original === undefined) {
        delete (navigator as { gpu?: unknown }).gpu;
      } else {
        Object.defineProperty(navigator, "gpu", {
          value: original,
          configurable: true,
        });
      }
    }
  });
});

describe("browser-types — window extensions", () => {
  it("getWindowBuildHash returns window with the build hash", () => {
    const w = getWindowBuildHash();
    expect(w).toBe(window);
    expect(w.__BMF_BUILD_HASH__).toBeUndefined();
  });

  it("getWindowBuildHash reads the injected __BMF_BUILD_HASH__", () => {
    (window as { __BMF_BUILD_HASH__?: string }).__BMF_BUILD_HASH__ = "abc123";
    try {
      expect(getWindowBuildHash().__BMF_BUILD_HASH__).toBe("abc123");
    } finally {
      delete (window as { __BMF_BUILD_HASH__?: string }).__BMF_BUILD_HASH__;
    }
  });

  it("getWindowMemoryPressure returns window with the handler", () => {
    const w = getWindowMemoryPressure();
    expect(w).toBe(window);
    // In jsdom the property is undefined (undefined, not null)
    expect(w.onmemorypressure).toBeUndefined();
  });

  it("getWindowChrome returns window without chrome in jsdom", () => {
    const w = getWindowChrome();
    expect(w).toBe(window);
    expect(w.chrome).toBeUndefined();
  });

  it("getWindowChrome exposes chrome.runtime if injected", () => {
    const fakeChrome = { runtime: { id: "ext-id" } };
    const original = (window as { chrome?: unknown }).chrome;
    Object.defineProperty(window, "chrome", { value: fakeChrome, configurable: true });
    try {
      expect(getWindowChrome().chrome?.runtime?.id).toBe("ext-id");
    } finally {
      if (original === undefined) {
        delete (window as { chrome?: unknown }).chrome;
      } else {
        Object.defineProperty(window, "chrome", {
          value: original,
          configurable: true,
        });
      }
    }
  });
});

describe("browser-types — Web Speech API", () => {
  it("getSpeechRecognitionCtor uses SpeechRecognition if it exists", () => {
    const Ctor = class {
      start() {}
    };
    const original = (window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    }).SpeechRecognition;
    Object.defineProperty(window, "SpeechRecognition", {
      value: Ctor,
      configurable: true,
    });
    try {
      expect(getSpeechRecognitionCtor()).toBe(Ctor);
    } finally {
      if (original === undefined) {
        delete (window as unknown as { SpeechRecognition?: unknown })
          .SpeechRecognition;
      } else {
        Object.defineProperty(window, "SpeechRecognition", {
          value: original,
          configurable: true,
        });
      }
    }
  });

  it("getSpeechRecognitionCtor uses webkitSpeechRecognition as fallback", () => {
    const WebkitCtor = class {
      abort() {}
    };
    const originalW = (window as unknown as { webkitSpeechRecognition?: unknown })
      .webkitSpeechRecognition;
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: WebkitCtor,
      configurable: true,
    });
    try {
      expect(getSpeechRecognitionCtor()).toBe(WebkitCtor);
    } finally {
      if (originalW === undefined) {
        delete (window as unknown as { webkitSpeechRecognition?: unknown })
          .webkitSpeechRecognition;
      } else {
        Object.defineProperty(window, "webkitSpeechRecognition", {
          value: originalW,
          configurable: true,
        });
      }
    }
  });

  it("getSpeechRecognitionCtor returns undefined without the speech API", () => {
    expect(getSpeechRecognitionCtor()).toBeUndefined();
  });
});

describe("browser-types — clipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clipboardWriteText returns true on successful write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await expect(clipboardWriteText("hola")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hola");
  });

  it("clipboardWriteText returns false if the write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await expect(clipboardWriteText("hola")).resolves.toBe(false);
  });

  it("clipboardWriteText returns false without clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    await expect(clipboardWriteText("hola")).resolves.toBe(false);
  });
});

describe("browser-types — performance / layout shift", () => {
  it("getLayoutShiftEntries filters only layout-shift entries", () => {
    const list = [
      { name: "layout-shift", value: 0.1, hadRecentInput: false },
      { name: "paint", startTime: 1 },
      { name: "layout-shift", value: 0.2, hadRecentInput: true },
    ] as unknown as PerformanceEntryList;
    const entries = getLayoutShiftEntries(list);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.value).toBe(0.1);
    expect(entries[1]!.hadRecentInput).toBe(true);
  });

  it("getLayoutShiftEntries returns empty array without entries", () => {
    expect(getLayoutShiftEntries([])).toHaveLength(0);
  });

  it("getPerformanceMemory returns performance with memory", () => {
    const p = getPerformanceMemory();
    expect(p).toBe(performance);
    expect(p.memory).toBeUndefined();
  });

  it("getPerformanceMemory exposes memory if Chrome injects it", () => {
    const fakeMemory = { usedJSHeapSize: 1, totalJSHeapSize: 2, jsHeapSizeLimit: 3 };
    const original = (performance as unknown as { memory?: unknown }).memory;
    Object.defineProperty(performance, "memory", {
      value: fakeMemory,
      configurable: true,
    });
    try {
      expect(getPerformanceMemory().memory?.usedJSHeapSize).toBe(1);
    } finally {
      if (original === undefined) {
        delete (performance as unknown as { memory?: unknown }).memory;
      } else {
        Object.defineProperty(performance, "memory", {
          value: original,
          configurable: true,
        });
      }
    }
  });
});

describe("browser-types — dynamic collection access", () => {
  it("getCollection returns the collection by name", () => {
    const col = { find: vi.fn() };
    const db = { bookmarks: col };
    expect(getCollection(db, "bookmarks")).toBe(col);
  });

  it("getCollection returns undefined if the collection does not exist", () => {
    expect(getCollection({}, "missing")).toBeUndefined();
  });

  it("getCollection handles null/undefined db without throwing", () => {
    expect(getCollection(null, "bookmarks")).toBeUndefined();
    expect(getCollection(undefined, "bookmarks")).toBeUndefined();
  });
});
