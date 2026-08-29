import { describe, it, expect } from "vitest";
import { createAdapter } from "../../services/integrations/cloudSync";

const DRIVE_TOKEN = process.env.VITE_DRIVE_TEST_TOKEN;
const DROPBOX_TOKEN = process.env.VITE_DROPBOX_TEST_TOKEN;
const ONEDRIVE_TOKEN = process.env.VITE_ONEDRIVE_TEST_TOKEN;

describe.runIf(DRIVE_TOKEN)("cloudSync real adapter — Google Drive", () => {
  const adapter = createAdapter("drive", DRIVE_TOKEN!);

  it("listFiles returns a normalized file list", async () => {
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    if (files.length > 0) {
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});

describe.runIf(DROPBOX_TOKEN)("cloudSync real adapter — Dropbox", () => {
  const adapter = createAdapter("dropbox", DROPBOX_TOKEN!);

  it("listFiles returns a normalized file list", async () => {
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    if (files.length > 0) {
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});

describe.runIf(ONEDRIVE_TOKEN)("cloudSync real adapter — OneDrive", () => {
  const adapter = createAdapter("onedrive", ONEDRIVE_TOKEN!);

  it("listFiles returns a normalized file list", async () => {
    const files = await adapter.listFiles();
    expect(Array.isArray(files)).toBe(true);
    if (files.length > 0) {
      expect(files[0]).toHaveProperty("id");
      expect(files[0]).toHaveProperty("name");
      expect(files[0]).toHaveProperty("modifiedTime");
    }
  });
});
