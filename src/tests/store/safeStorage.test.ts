// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  safeGet,
  safeSet,
  safeRemove,
  safeClear,
  safeSessionClear,
  createStorageAdapter,
  createSignedStorageAdapter,
  createSafeStorageAdapter,
} from "../../store/safeStorage";

describe("safeStorage", () => {
  beforeEach(() => {
    // Restore FIRST: a leftover Storage.prototype.clear spy from a previous
    // test would otherwise break the clear() calls below.
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  describe("safeGet", () => {
    it("returns null for a non-existent key", () => {
      expect(safeGet("nonexistent-key")).toBeNull();
    });

    it("returns the stored value for an existing key", () => {
      localStorage.setItem("test-key", "test-value");
      expect(safeGet("test-key")).toBe("test-value");
    });

    it("returns null when localStorage.getItem throws", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      expect(safeGet("any-key")).toBeNull();
    });

    it("returns a non-empty string value", () => {
      localStorage.setItem("str-key", "hello world");
      expect(safeGet("str-key")).toBe("hello world");
    });
  });

  describe("safeSet", () => {
    it("stores a value that can be retrieved", () => {
      safeSet("set-key", "set-value");
      expect(localStorage.getItem("set-key")).toBe("set-value");
    });

    it("overwrites an existing value", () => {
      safeSet("overwrite-key", "first");
      safeSet("overwrite-key", "second");
      expect(localStorage.getItem("overwrite-key")).toBe("second");
    });

    it("does not throw when localStorage.setItem throws", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      expect(() => safeSet("key", "value")).not.toThrow();
    });

    it("stores and retrieves a long string", () => {
      const long = "a".repeat(1024);
      safeSet("long-key", long);
      expect(localStorage.getItem("long-key")).toBe(long);
    });

    it("stores JSON-encoded data", () => {
      const data = JSON.stringify({ foo: "bar", count: 42 });
      safeSet("json-key", data);
      expect(JSON.parse(localStorage.getItem("json-key")!)).toEqual({
        foo: "bar",
        count: 42,
      });
    });
  });

  describe("safeRemove", () => {
    it("removes an existing key", () => {
      localStorage.setItem("remove-key", "value");
      safeRemove("remove-key");
      expect(localStorage.getItem("remove-key")).toBeNull();
    });

    it("does not throw when removing a non-existent key", () => {
      expect(() => safeRemove("nonexistent")).not.toThrow();
    });

    it("does not throw when localStorage.removeItem throws", () => {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      expect(() => safeRemove("any-key")).not.toThrow();
    });

    it("only removes the specified key", () => {
      localStorage.setItem("keep", "keep-value");
      localStorage.setItem("remove-me", "remove-value");
      safeRemove("remove-me");
      expect(localStorage.getItem("keep")).toBe("keep-value");
      expect(localStorage.getItem("remove-me")).toBeNull();
    });
  });

  describe("safeClear", () => {
    it("clears all localStorage keys", () => {
      localStorage.setItem("a", "1");
      localStorage.setItem("b", "2");
      safeClear();
      expect(localStorage.getItem("a")).toBeNull();
      expect(localStorage.getItem("b")).toBeNull();
    });

    it("does not throw when localStorage.clear throws", () => {
      vi.spyOn(Storage.prototype, "clear").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      expect(() => safeClear()).not.toThrow();
    });
  });

  describe("safeSessionClear", () => {
    it("clears all sessionStorage keys", () => {
      sessionStorage.setItem("s1", "v");
      safeSessionClear();
      expect(sessionStorage.getItem("s1")).toBeNull();
    });

    it("does not throw when sessionStorage.clear throws", () => {
      vi.spyOn(Storage.prototype, "clear").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      expect(() => safeSessionClear()).not.toThrow();
    });
  });
});

describe("createStorageAdapter", () => {
  const keyMap = { count: "forge_count", name: "forge_name" };
  const defaults = { count: 0, name: "" };

  beforeEach(() => {
    localStorage.clear();
  });

  it("serializes state with defaults when nothing is stored", () => {
    const adapter = createStorageAdapter(keyMap, defaults);
    // Our adapter is synchronous: cast the zustand StateStorage result (which
    // is typed string | null | Promise<string | null>) to string.
    const raw = adapter.getItem("ignored") as string;
    const parsed = JSON.parse(raw) as { state: Record<string, unknown> };
    expect(parsed.state.count).toBe(0);
    expect(parsed.state.name).toBe("");
  });

  it("reads stored values with type-aware parsing", () => {
    localStorage.setItem("forge_count", "42");
    localStorage.setItem("forge_name", "hello");
    const adapter = createStorageAdapter(keyMap, defaults);
    const parsed = JSON.parse(adapter.getItem("ignored") as string) as {
      state: Record<string, unknown>;
    };
    expect(parsed.state.count).toBe(42);
    expect(parsed.state.name).toBe("hello");
  });

  it("falls back to default for invalid numeric values", () => {
    localStorage.setItem("forge_count", "not-a-number");
    const adapter = createStorageAdapter(keyMap, defaults);
    const parsed = JSON.parse(adapter.getItem("ignored") as string) as {
      state: Record<string, unknown>;
    };
    expect(parsed.state.count).toBe(0);
  });

  it("persists changed fields on setItem", () => {
    const adapter = createStorageAdapter(keyMap, defaults);
    adapter.setItem("ignored", JSON.stringify({ state: { count: 7 } }));
    expect(localStorage.getItem("forge_count")).toBe("7");
    expect(localStorage.getItem("forge_name")).toBeNull();
  });

  it("persists booleans with boolean serialization", () => {
    const adapter = createStorageAdapter(
      { flag: "forge_flag" },
      { flag: false },
    );
    adapter.setItem("x", JSON.stringify({ state: { flag: true } }));
    expect(localStorage.getItem("forge_flag")).toBe("true");
    const parsed = JSON.parse(adapter.getItem("x") as string) as {
      state: Record<string, unknown>;
    };
    expect(parsed.state.flag).toBe(true);
  });

  it("uses custom serializers when provided", () => {
    const adapter = createStorageAdapter(
      { n: "forge_n" },
      { n: 0 },
      {
        read: {
          n: (raw: string | null, def: number) =>
            Number(String(raw ?? def).replace(/^x/, "")) + 1,
        },
        write: { n: (v: number) => `x${v}` },
      },
    );
    adapter.setItem("x", JSON.stringify({ state: { n: 5 } }));
    expect(localStorage.getItem("forge_n")).toBe("x5");
    const parsed = JSON.parse(adapter.getItem("x") as string) as {
      state: Record<string, unknown>;
    };
    expect(parsed.state.n).toBe(6);
  });

  it("ignores malformed JSON on setItem", () => {
    const adapter = createStorageAdapter(keyMap, defaults);
    expect(() => adapter.setItem("x", "{not-json")).not.toThrow();
  });

  it("removes all mapped keys on removeItem", () => {
    localStorage.setItem("forge_count", "1");
    localStorage.setItem("forge_name", "n");
    const adapter = createStorageAdapter(keyMap, defaults);
    adapter.removeItem("ignored");
    expect(localStorage.getItem("forge_count")).toBeNull();
    expect(localStorage.getItem("forge_name")).toBeNull();
  });
});

describe("createSignedStorageAdapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("signs on write and verifies on read", async () => {
    const adapter = createSignedStorageAdapter(
      async (v) => `${v}:sig`,
      async (stored) => {
        const idx = stored.lastIndexOf(":");
        return idx === -1 ? null : stored.slice(0, idx);
      },
    );
    await adapter.setItem("k", "secret");
    expect(localStorage.getItem("k")).toBe("secret:sig");
    expect(await adapter.getItem("k")).toBe("secret");
  });

  it("returns null when nothing is stored", async () => {
    const adapter = createSignedStorageAdapter(
      async (v) => v,
      async (stored) => stored,
    );
    expect(await adapter.getItem("missing")).toBeNull();
  });

  it("removes the key on removeItem", async () => {
    const adapter = createSignedStorageAdapter(
      async (v) => v,
      async (stored) => stored,
    );
    await adapter.setItem("k", "v");
    adapter.removeItem("k");
    expect(localStorage.getItem("k")).toBeNull();
  });
});

describe("createSafeStorageAdapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses the persist name when no storage key is provided", () => {
    const adapter = createSafeStorageAdapter();
    adapter.setItem("persist-key", "value");
    expect(localStorage.getItem("persist-key")).toBe("value");
    expect(adapter.getItem("persist-key")).toBe("value");
    adapter.removeItem("persist-key");
    expect(localStorage.getItem("persist-key")).toBeNull();
  });

  it("scopes all operations to a fixed storage key", () => {
    const adapter = createSafeStorageAdapter("fixed-key");
    adapter.setItem("ignored", "v");
    expect(localStorage.getItem("fixed-key")).toBe("v");
    expect(adapter.getItem("anything")).toBe("v");
    adapter.removeItem("anything");
    expect(localStorage.getItem("fixed-key")).toBeNull();
  });
});
