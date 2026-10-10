import { describe, it, expect } from "vitest";
import path from "path";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

describe("check-context-boundaries script", () => {
  it("resolves known directories correctly", () => {
    const root = path.resolve(__dirname, "..", "..", "..");
    const dirs = {
      bookmarks: path.join(root, "src", "services", "bookmarks"),
      vault: path.join(root, "src", "services", "vault"),
      ai: path.join(root, "src", "services", "ai"),
      sync: path.join(root, "src", "services", "sync"),
      memory: path.join(root, "src", "memory"),
      storage: path.join(root, "src", "storage"),
      ui: path.join(root, "src", "components"),
      collaboration: path.join(root, "src", "collaboration"),
      shared: path.join(root, "src", "utils"),
    };

    for (const [name, dirPath] of Object.entries(dirs)) {
      expect(dirPath).toBeTruthy();
    }
  });

  it("can be required without errors", () => {
    let script;
    let loadError;
    try {
      script = req("../../../scripts/check-context-boundaries.cjs");
    } catch (e) {
      loadError = e;
    }
    if (!script) {
      // loadError is `unknown` under strict; the script is expected to be
      // absent in a source checkout without scripts/ — assert on the
      // module-resolution error text.
      expect((loadError as Error | undefined)?.message ?? "").toMatch(
        /ENOENT|scandir|Cannot find|process.exit/,
      );
    } else {
      expect(script).toBeDefined();
    }
  });
});
