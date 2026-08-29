import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectUrlRegistry } from "../../utils/objectUrlRegistry";

describe("ObjectUrlRegistry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks created URLs and revokes them all exactly once", () => {
    const createObjectURL = vi.fn(() => "blob:image");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const registry = new ObjectUrlRegistry();

    expect(registry.create(new Blob(["image"]))).toBe("blob:image");
    expect(registry.size).toBe(1);
    registry.revokeAll();
    registry.revokeAll();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  it("revokes URLs removed from the current editor value", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce("blob:kept")
        .mockReturnValueOnce("blob:removed"),
      revokeObjectURL,
    });
    const registry = new ObjectUrlRegistry();
    registry.create(new Blob(["kept"]));
    registry.create(new Blob(["removed"]));

    registry.revokeUnreferenced({ image: "blob:kept" });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:removed");
    expect(revokeObjectURL).not.toHaveBeenCalledWith("blob:kept");
    expect(registry.size).toBe(1);
  });

  it("ignores non-object leaves while traversing an editor value", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:img"),
      revokeObjectURL,
    });
    const registry = new ObjectUrlRegistry();
    registry.create(new Blob(["image"]));

    // The nested null/0 leaves hit the non-object guard inside collect.
    // The blob is still revoked because it is not referenced by this value.
    registry.revokeUnreferenced({ alt: null, count: 0 });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:img");
    expect(registry.size).toBe(0);
  });

  it("requires an exact URL value rather than a substring match", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:img"),
      revokeObjectURL,
    });
    const registry = new ObjectUrlRegistry();
    registry.create(new Blob(["image"]));

    registry.revokeUnreferenced({ alt: "blob:img-preview" });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:img");
    expect(registry.size).toBe(0);
  });

  it("retains every tracked URL when the editor value cannot be inspected", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:img"),
      revokeObjectURL,
    });
    const registry = new ObjectUrlRegistry();
    registry.create(new Blob(["image"]));

    // Object.values() invokes this throwing getter, which aborts the
    // traversal inside revokeUnreferenced and must NOT revoke anything.
    const hostile = {
      get image() {
        throw new Error("inspection failed");
      },
    };
    expect(() => registry.revokeUnreferenced(hostile)).not.toThrow();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });

  it("ignores duplicate individual revocations", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:one"),
      revokeObjectURL,
    });
    const registry = new ObjectUrlRegistry();
    const url = registry.create(new Blob(["one"]));

    registry.revoke(url);
    registry.revoke(url);

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });
});
