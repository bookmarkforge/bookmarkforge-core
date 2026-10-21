import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { skipPassword } from "./vault-helpers";

/**
 * Full-library export → import round-trip (JSON).
 *
 * Seeds a vault with bookmarks, documents (with AI summaries, tags, folder
 * membership, inter-document links) and a NESTED folder tree; exports the
 * whole library through the real ExportDialog UI (download captured), wipes
 * the three collections, re-imports the downloaded file through the real
 * ImportDialog UI, and verifies the vault matches the baseline record for
 * record — no silent loss.
 *
 * This guards the app's own "backup by JSON export" story: a user who
 * exports and later restores must get back exactly what they had. It also
 * pins the importer's field mapping for BMF self-exports (`summary` is the
 * exporter's field; it must not be treated as a legacy Notion
 * `description`).
 */
test.setTimeout(180_000);

const T = "2026-08-16T00:00:00.000Z";

const SEED = {
  bookmarks: [
    {
      id: "rt-bookmark-alpha",
      url: "https://roundtrip.example/alpha",
      title: "Roundtrip Alpha",
      summary: "AI summary for alpha",
      content: "Alpha body text without markup",
      tags: ["research", "web"],
      relatedLinks: ["https://roundtrip.example/beta"],
      visitCount: 7,
    },
    {
      id: "rt-bookmark-beta",
      url: "https://roundtrip.example/beta",
      title: "Roundtrip Beta",
      summary: "Beta summary with accented chars: ñ café",
      content: "Beta body",
      tags: ["web"],
      relatedLinks: [],
      visitCount: 0,
    },
    {
      id: "rt-bookmark-gamma",
      url: "https://roundtrip.example/gamma",
      title: "Roundtrip Gamma",
      summary: "",
      content: "Gamma body with unicode 🚀 日本語",
      tags: [],
      relatedLinks: [],
      visitCount: 1,
    },
  ],
  documents: [
    {
      id: "rt-doc-a",
      folderId: "rt-folder-projects",
      title: "Roundtrip Doc A",
      blocks: [],
      textContent: "Alpha document body — plain text.",
      summary: "Generated summary for doc A",
      tags: ["note", "work"],
      links: ["rt-doc-b"],
    },
    {
      id: "rt-doc-b",
      folderId: "rt-folder-personal",
      title: "Roundtrip Doc B",
      blocks: [],
      textContent: "Beta document body with unicode ñ 🚀 日本語.",
      summary: "",
      tags: [],
      links: [],
    },
  ],
  folders: [
    { id: "rt-folder-work", title: "Work", parentId: "root" },
    // Nested: Projects lives inside Work — the hierarchy must survive.
    { id: "rt-folder-projects", title: "Projects", parentId: "rt-folder-work" },
    { id: "rt-folder-personal", title: "Personal", parentId: "root" },
  ],
} as const;

type VaultSnapshot = Awaited<ReturnType<typeof snapshotVault>>;

async function seedVault(page: Page): Promise<void> {
  await page.evaluate(async (seed: any) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();

    const sha256Hex = async (text: string): Promise<string> => {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    };

    for (const folder of seed.folders) {
      await db.folders.insert({
        id: folder.id,
        title: folder.title,
        parentId: folder.parentId,
        createdAt: seed.createdAt,
      } as never);
    }
    for (const bookmark of seed.bookmarks) {
      await db.bookmarks.insert({
        ...bookmark,
        urlHash: await sha256Hex(bookmark.url),
        processed: true,
        isPrivate: false,
        isDeleted: false,
        createdAt: seed.createdAt,
        updatedAt: seed.createdAt,
      } as never);
    }
    for (const document of seed.documents) {
      await db.documents.insert({
        ...document,
        processed: true,
        isPrivate: false,
        isDeleted: false,
        createdAt: seed.createdAt,
        updatedAt: seed.createdAt,
      } as never);
    }
  }, { ...SEED, createdAt: T });
}

async function snapshotVault(page: Page): Promise<{
  bookmarks: Array<{
    title: string;
    url: string;
    summary: string;
    content: string;
    tags: string[];
    relatedLinks: string[];
    visitCount: number;
  }>;
  documents: Array<{
    id: string;
    title: string;
    folderId: string;
    summary: string;
    textContent: string;
    tags: string[];
    links: string[];
  }>;
  folders: Array<{ title: string; parentId: string }>;
}> {
  return page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const bookmarks = await db.bookmarks.find().exec();
    const documents = await db.documents.find().exec();
    const folders = await db.folders.find().exec();
    return {
      bookmarks: bookmarks
        .map((b) => ({
          title: b.title,
          url: b.url,
          summary: b.summary ?? "",
          content: b.content ?? "",
          tags: [...(b.tags ?? [])].sort(),
          relatedLinks: [...(b.relatedLinks ?? [])].sort(),
          visitCount: b.visitCount ?? 0,
        }))
        .sort((a, b) => a.url.localeCompare(b.url)),
      documents: documents
        .map((d) => ({
          id: d.id,
          title: d.title,
          folderId: d.folderId ?? "root",
          summary: d.summary ?? "",
          textContent: d.textContent ?? "",
          tags: [...(d.tags ?? [])].sort(),
          links: [...(d.links ?? [])],
        }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      folders: folders
        .map((f) => ({ title: f.title, parentId: f.parentId ?? "root" }))
        .sort(
          (a, b) =>
            a.title.localeCompare(b.title) ||
            a.parentId.localeCompare(b.parentId),
        ),
    };
  });
}

/** DB-level equality sans regenerated ids and remapped link ids (checked separately). */
function comparableContent(snapshot: VaultSnapshot): unknown {
  return {
    bookmarks: snapshot.bookmarks,
    documents: snapshot.documents.map(({ id: _id, links: _links, ...rest }) => rest),
    folders: snapshot.folders,
  };
}

/**
 * The Import/Export cards only render inside the "Intelligence Center" modal
 * (Dashboard.tsx) "Data" tab; the modal opens with "stats" selected and is
 * mounted by MainApp only on the `show_analysis` action, which the Omnibar's
 * "Intelligence Center" command triggers. Idempotent: when the shell is
 * already on the modal (e.g. after an import), the Omnibar path re-shows it
 * harmlessly on the same tab.
 */
async function openDataTab(page: Page): Promise<void> {
  // The tab is localized as "Data Sovereignty" (app_dataManagement); the
  // Dashboard tab strip is its only home.
  const dataTab = page.getByRole("button", {
    name: "Data Sovereignty",
    exact: true,
  });
  if (!(await dataTab.isVisible().catch(() => false))) {
    // Header search button opens the Omnibar (Ctrl+K equivalent).
    await page
      .getByRole("button", { name: "Search", exact: true })
      .click({ timeout: 30_000 });
    await page
      .getByRole("option", { name: "Intelligence Center" })
      .click({ timeout: 30_000 });
  }
  await expect(dataTab).toBeVisible({ timeout: 30_000 });
  await dataTab.click({ timeout: 15_000 });
}

async function exportJsonViaUi(page: Page): Promise<string> {
  await openDataTab(page);
  const exportDialog = page.getByRole("dialog", { name: /export/i });
  // HomeDashboard also has an "Open Importer"/importer area behind the
  // modal; only the visible card inside the Intelligence Center is tappable.
  await page
    .getByRole("button", { name: "Open Exporter", exact: true })
    .locator("visible=true")
    .click({ timeout: 30_000 });
  await expect(exportDialog).toBeVisible({ timeout: 30_000 });

  // "Export entire library": folders are only included when explicitly
  // requested, so check the option (the round-trip must carry them).
  await page.locator("#includeFolders").check({ timeout: 15_000 });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await exportDialog
    .getByRole("button", { name: "Export", exact: true })
    .click({ timeout: 15_000 });
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  mkdirSync("test-results/roundtrip", { recursive: true });
  const target = join(
    "test-results",
    "roundtrip",
    download.suggestedFilename(),
  );
  await download.saveAs(target);

  // Leave the shell clean for the next phase.
  await exportDialog
    .getByRole("button", { name: "Close", exact: true })
    .click({ timeout: 15_000 });
  return target;
}

async function wipeLibrary(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const bookmarks = await db.bookmarks.find().exec();
    await db.bookmarks.bulkRemove(bookmarks.map((b) => b.id));
    const documents = await db.documents.find().exec();
    await db.documents.bulkRemove(documents.map((d) => d.id));
    const folders = await db.folders.find().exec();
    await db.folders.bulkRemove(folders.map((f) => f.id));
  });
}

async function importJsonViaUi(page: Page, filePath: string): Promise<void> {
  await openDataTab(page);
  const importDialog = page.getByRole("dialog", { name: /import/i });
  await page
    .getByRole("button", { name: "Open Importer", exact: true })
    .locator("visible=true")
    .click({ timeout: 30_000 });
  await expect(importDialog).toBeVisible({ timeout: 30_000 });
  await importDialog.locator('input[type="file"]').setInputFiles(filePath);

  // The dialog only shows "Import Complete" after every record was
  // processed — the strongest UI-level signal that nothing was dropped.
  await expect(
    importDialog.getByRole("heading", { name: "Import Complete" }),
  ).toBeVisible({ timeout: 60_000 });

  // Close the (still open) result dialog so the next phase interacts with
  // the dashboard, not the backdrop.
  await importDialog
    .getByRole("button", { name: "Close", exact: true })
    .click({ timeout: 15_000 });
}

test("export → wipe → re-import: bookmarks, documents and folders survive without loss", async ({
  page,
}) => {
  test.slow();
  await skipPassword(page);
  await seedVault(page);

  const baseline = await snapshotVault(page);
  expect(baseline.bookmarks).toHaveLength(3);
  expect(baseline.documents).toHaveLength(2);
  expect(baseline.folders).toHaveLength(3);

  // EXPORT — the user-facing UI path (real download, not a service call).
  const exportPath = await exportJsonViaUi(page);

  // The file itself must carry the whole library (silent drops in the
  // exporter would hide here, before the import is even involved).
  const exported = JSON.parse(readFileSync(exportPath, "utf8"));
  expect(exported.metadata.totalBookmarks).toBe(3);
  expect(exported.metadata.totalDocuments).toBe(2);
  expect(exported.metadata.totalFolders).toBe(3);
  expect(exported.data.bookmarks).toHaveLength(3);
  expect(exported.data.documents).toHaveLength(2);
  expect(exported.data.folders).toHaveLength(3);

  // WIPE — the three collections, leaving the vault itself alive.
  await wipeLibrary(page);
  const emptied = await snapshotVault(page);
  expect(emptied.bookmarks).toHaveLength(0);
  expect(emptied.documents).toHaveLength(0);
  expect(emptied.folders).toHaveLength(0);

  // RE-IMPORT — through the real ImportDialog UI.
  await importJsonViaUi(page, exportPath);

  // VERIFY — DB-level, record-for-record equality with the baseline.
  const restored = await snapshotVault(page);
  expect(comparableContent(restored)).toEqual(comparableContent(baseline));

  // Bookmarks: every field survived (summary regression: the importer used
  // to read only the legacy `description` field and dropped AI summaries).
  const byUrl = new Map(restored.bookmarks.map((b) => [b.url, b]));
  expect(byUrl.get("https://roundtrip.example/alpha")).toMatchObject({
    title: "Roundtrip Alpha",
    summary: "AI summary for alpha",
    content: "Alpha body text without markup",
    tags: ["research", "web"],
    relatedLinks: ["https://roundtrip.example/beta"],
    visitCount: 7,
  });
  expect(byUrl.get("https://roundtrip.example/beta")?.summary).toContain(
    "ñ café",
  );
  expect(
    byUrl.get("https://roundtrip.example/gamma")?.content,
  ).toContain("🚀 日本語");

  // Documents: text, summary, tags and FOLDER MEMBERSHIP survived (folder
  // ids are stable across the round-trip, so folderId is comparable).
  const byTitle = new Map(restored.documents.map((d) => [d.title, d]));
  const docA = byTitle.get("Roundtrip Doc A")!;
  const docB = byTitle.get("Roundtrip Doc B")!;
  expect(docA).toMatchObject({
    folderId: "rt-folder-projects",
    summary: "Generated summary for doc A",
    textContent: "Alpha document body — plain text.",
    tags: ["note", "work"],
  });
  expect(docB.folderId).toBe("rt-folder-personal");
  expect(docB.textContent).toContain("🚀 日本語");

  // Inter-document links: ids are regenerated on import, so verify the link
  // graph (not ids): A still links exactly one doc, which is the new B.
  expect(docA.links).toHaveLength(1);
  expect(docB.links).toEqual([]);
  const restoredIds = new Set(restored.documents.map((d) => d.id));
  expect(restoredIds.has(docA.links[0]!)).toBe(true);
  expect(docA.links[0]).not.toBe("rt-doc-b");
  expect(
    restored.documents.find((d) => d.id === docA.links[0])?.title,
  ).toBe("Roundtrip Doc B");

  // Folders: the NESTED hierarchy survived (Work → Projects stays nested).
  // Folder ids are stable across the round-trip (unlike document ids), and
  // parentId stores the parent's ID, not its title — so the hierarchy is
  // asserted against the seeded ids directly.
  const folderByTitle = new Map(restored.folders.map((f) => [f.title, f]));
  expect(folderByTitle.get("Work")?.parentId).toBe("root");
  expect(folderByTitle.get("Projects")?.parentId).toBe("rt-folder-work");
  expect(folderByTitle.get("Personal")?.parentId).toBe("root");
});

test("a second export after the round-trip is identical (no drift)", async ({
  page,
}) => {
  test.slow();
  await skipPassword(page);
  await seedVault(page);

  const firstPath = await exportJsonViaUi(page);
  const first = JSON.parse(readFileSync(firstPath, "utf8"));

  await wipeLibrary(page);
  await importJsonViaUi(page, firstPath);

  const secondPath = await exportJsonViaUi(page);
  const second = JSON.parse(readFileSync(secondPath, "utf8"));

  // Ids are regenerated for bookmarks/documents, document link ids are
  // remapped, and `processed` flips (seed true → imported false). Everything
  // user-facing must be identical across the second generation; folders keep
  // their ids, so even those match exactly.
  const strip = (
    record: Record<string, unknown>,
    keys: string[],
  ): Record<string, unknown> => {
    const copy = { ...record };
    for (const key of keys) {
      delete copy[key];
    }
    return copy;
  };
  const normalize = (data: {
    bookmarks: Array<Record<string, unknown>>;
    documents: Array<Record<string, unknown>>;
    folders: Array<Record<string, unknown>>;
  }) => ({
    bookmarks: data.bookmarks
      .map((b) => strip(b, ["id", "urlHash", "processed"]))
      .sort((a, b) => String(a.url).localeCompare(String(b.url))),
    documents: data.documents
      .map((d) => strip(d, ["id", "processed", "links"]))
      .sort((a, b) => String(a.title).localeCompare(String(b.title))),
    folders: [...data.folders].sort(
      (a, b) =>
        String(a.title).localeCompare(String(b.title)) ||
        String(a.parentId ?? "").localeCompare(String(b.parentId ?? "")),
    ),
  });

  expect(normalize(second.data)).toEqual(normalize(first.data));
  expect(second.metadata.totalBookmarks).toBe(3);
  expect(second.metadata.totalDocuments).toBe(2);
  expect(second.metadata.totalFolders).toBe(3);
});