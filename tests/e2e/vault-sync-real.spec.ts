import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { skipPassword } from "./vault-helpers";
import {
  installSyncStateProbe,
  captureHandshakeEvidence,
  classifyHandshake,
  type SyncWindow as SharedSyncWindow,
} from "./webrtc-handshake-diagnostics";

interface SyncWindow extends SharedSyncWindow {
  __bookmarkForgeChunkInterrupted?: boolean;
  __bookmarkForgePersistenceInterruptStarted?: boolean;
  __bookmarkForgePersistenceInterruptFinished?: boolean;
}

type InterruptionPlan =
  | { kind: "chunk"; chunkIndex: number }
  | { kind: "persistence" };

type ConvergenceMetrics = {
  caseId: string;
  interruption: InterruptionPlan;
  status: "passed" | "failed";
  phase: string;
  startedAt: string;
  elapsedMs: number;
  interruptionObservedMs: number | null;
  persistenceStartedMs: number | null;
  persistenceFinishedMs: number | null;
  retryStartedMs: number | null;
  completedMs: number | null;
  recoveryMs: number | null;
  hostDocumentCount: number | null;
  clientDocumentCount: number | null;
  converged: boolean;
};

const CONFLICT_ID = "e2e-sync-conflict-document";
const HOST_ONLY_ID = "e2e-sync-host-only-document";
const CLIENT_ONLY_ID = "e2e-sync-client-only-document";
const TOMBSTONE_ID = "e2e-sync-tombstone-document";
const BOOKMARK_TOMBSTONE_ID = "e2e-sync-tombstone-bookmark";
const PRIVATE_ID = "e2e-sync-private-document";
const PRIVATE_BOOKMARK_ID = "e2e-sync-private-bookmark";
const RETRY_ID = "e2e-sync-retry-document";

function documentRecord(
  id: string,
  title: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    folderId: "root",
    title,
    blocks: [],
    textContent: title,
    tags: [],
    links: [],
    processed: false,
    isPrivate: false,
    isDeleted: false,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt,
    ...overrides,
  };
}

function bookmarkRecord(
  id: string,
  title: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    url: `https://example.com/${id}`,
    title,
    tags: [],
    relatedLinks: [],
    processed: false,
    isPrivate: false,
    isDeleted: false,
    visitCount: 0,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt,
    ...overrides,
  };
}

type PrivacyTombstoneCase = {
  caseId: string;
  collection: "documents" | "bookmarks";
  mode: "tombstone" | "private";
  hostRecord: Record<string, unknown>;
  clientRecord: Record<string, unknown>;
  expectedHost: Record<string, unknown>;
  expectedClient: Record<string, unknown>;
};

const PRIVACY_AND_TOMBSTONE_CASES: PrivacyTombstoneCase[] = [
  {
    caseId: "document-tombstone",
    collection: "documents",
    mode: "tombstone",
    hostRecord: documentRecord(
      TOMBSTONE_ID,
      "deleted-on-host",
      "2026-08-15T00:00:10.000Z",
      { isDeleted: true },
    ),
    clientRecord: documentRecord(
      TOMBSTONE_ID,
      "stale-live-copy",
      "2026-08-15T00:00:09.000Z",
    ),
    expectedHost: { isDeleted: true },
    expectedClient: { isDeleted: true },
  },
  {
    caseId: "bookmark-tombstone",
    collection: "bookmarks",
    mode: "tombstone",
    hostRecord: bookmarkRecord(
      BOOKMARK_TOMBSTONE_ID,
      "deleted-bookmark-on-host",
      "2026-08-15T00:00:10.000Z",
      { isDeleted: true },
    ),
    clientRecord: bookmarkRecord(
      BOOKMARK_TOMBSTONE_ID,
      "stale-live-bookmark",
      "2026-08-15T00:00:09.000Z",
    ),
    expectedHost: { isDeleted: true },
    expectedClient: { isDeleted: true },
  },
  {
    caseId: "document-private-protection",
    collection: "documents",
    mode: "private",
    hostRecord: documentRecord(
      PRIVATE_ID,
      "host-private-document",
      "2026-08-15T00:00:11.000Z",
      { isPrivate: true },
    ),
    clientRecord: documentRecord(
      PRIVATE_ID,
      "remote-public-overwrite-attempt",
      "2026-08-15T00:00:12.000Z",
    ),
    expectedHost: { title: "host-private-document", isPrivate: true },
    expectedClient: {
      title: "remote-public-overwrite-attempt",
      isPrivate: false,
    },
  },
  {
    caseId: "bookmark-private-protection",
    collection: "bookmarks",
    mode: "private",
    hostRecord: bookmarkRecord(
      PRIVATE_BOOKMARK_ID,
      "host-private-bookmark",
      "2026-08-15T00:00:11.000Z",
      { isPrivate: true },
    ),
    clientRecord: bookmarkRecord(
      PRIVATE_BOOKMARK_ID,
      "remote-public-bookmark-attempt",
      "2026-08-15T00:00:12.000Z",
    ),
    expectedHost: { title: "host-private-bookmark", isPrivate: true },
    expectedClient: {
      title: "remote-public-bookmark-attempt",
      isPrivate: false,
    },
  },
];

async function seedDocuments(
  page: Page,
  records: Record<string, unknown>[],
): Promise<void> {
  await page.evaluate(async (docs) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    for (const doc of docs) {
      await db.documents.upsert(doc);
    }
  }, records);
}

async function seedBookmarks(
  page: Page,
  records: Record<string, unknown>[],
): Promise<void> {
  await page.evaluate(async (bookmarks) => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    for (const bookmark of bookmarks) {
      // urlHash is required by the v6 bookmarks schema (SHA-256 of url).
      // The migration v5→v6 backfills it from plaintext url, but fresh
      // inserts must compute it themselves. Use the same async SHA-256
      // the app uses via crypto.subtle so seeded bookmarks match what a
      // real capture would store.
      if (typeof bookmark.url === "string" && !bookmark.urlHash) {
        const data = new TextEncoder().encode(bookmark.url);
        const digest = await crypto.subtle.digest("SHA-256", data);
        bookmark.urlHash = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
      }
      await db.bookmarks.upsert(bookmark);
    }
  }, records);
}

async function readSyncDiagnostics(
  page: Page,
): Promise<Record<string, unknown>> {
  const evidence = await captureHandshakeEvidence(page);
  const documents = await page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const docs = await db.documents.find().exec();
    return {
      documents: docs.slice(0, 100).map((document) => ({
        id: document.id,
        title: document.title,
        updatedAt: document.updatedAt,
      })),
      documentCount: docs.length,
    };
  });
  return {
    ...evidence,
    classification: classifyHandshake(evidence),
    ...documents,
  };
}

async function attachSyncDiagnostics(
  testInfo: TestInfo,
  hostPage: Page,
  clientPage: Page,
  phase: string,
): Promise<void> {
  const [host, client] = await Promise.all(
    [hostPage, clientPage].map(async (page) => {
      try {
        return await readSyncDiagnostics(page);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  await testInfo.attach("webrtc-sync-diagnostics.json", {
    body: JSON.stringify({ phase, host, client }, null, 2),
    contentType: "application/json",
  });
}

async function attachConvergenceMetrics(
  testInfo: TestInfo,
  metrics: ConvergenceMetrics,
): Promise<void> {
  try {
    await testInfo.attach("webrtc-convergence-metrics.json", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
  } catch (error) {
    // Metrics must not replace the primary E2E failure when Playwright cannot
    // write an attachment after a browser teardown.
    console.warn("[vault-sync-real] metric attachment failed:", error);
  }
}

async function installPersistenceInterruption(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const collection = db.documents as unknown as {
      upsert: (document: Record<string, unknown>) => Promise<unknown>;
    };
    const originalUpsert = collection.upsert.bind(collection);
    let interrupted = false;
    collection.upsert = async (document) => {
      if (!interrupted) {
        interrupted = true;
        (window as SyncWindow).__bookmarkForgePersistenceInterruptStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
        const { webRTCSyncService } = await import(
          "/src/services/WebRTCSyncService"
        );
        const internals = webRTCSyncService as unknown as {
          dataChannel?: { close: () => void } | null;
        };
        internals.dataChannel?.close();
      }
      const result = await originalUpsert(document);
      (window as SyncWindow).__bookmarkForgePersistenceInterruptFinished = true;
      return result;
    };
  });
}

async function startHostAndClient(
  hostPage: Page,
  clientPage: Page,
  interruption?: InterruptionPlan,
): Promise<void> {
  const offer = await hostPage.evaluate(async () => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    return webRTCSyncService.startHost();
  });
  if (interruption?.kind === "chunk") {
    const { chunkIndex } = interruption;
    await hostPage.evaluate(async (targetChunkIndex) => {
      const { webRTCSyncService } = await import(
        "/src/services/WebRTCSyncService"
      );
      const internals = webRTCSyncService as unknown as {
        dataChannel?: { send: (data: string) => void; close: () => void } | null;
      };
      const channel = internals.dataChannel;
      if (!channel) {
        throw new Error("Host data channel was not created before interruption hook");
      }
      const originalSend = channel.send.bind(channel);
      let interrupted = false;
      channel.send = (data: string) => {
        originalSend(data);
        const message = JSON.parse(data) as { type?: string; index?: number };
        if (
          !interrupted &&
          message.type === "sync_chunk" &&
          message.index === targetChunkIndex
        ) {
          interrupted = true;
          setTimeout(() => {
            channel.close();
            (window as SyncWindow).__bookmarkForgeChunkInterrupted = true;
          }, 0);
        }
      };
    }, chunkIndex);
  } else if (interruption?.kind === "persistence") {
    await installPersistenceInterruption(clientPage);
  }
  const answer = await clientPage.evaluate(async (encodedOffer) => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    return webRTCSyncService.startClient(encodedOffer);
  }, offer);

  await hostPage.evaluate(async (encodedAnswer) => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    await webRTCSyncService.processClientAnswer(encodedAnswer);
  }, answer);
}

async function readDocuments(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const docs = await db.documents.find().exec();
    return docs.map((doc) => doc.toJSON() as Record<string, unknown>);
  });
}

async function readBookmarks(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const bookmarks = await db.bookmarks.find().exec();
    return bookmarks.map((bookmark) =>
      bookmark.toJSON() as Record<string, unknown>,
    );
  });
}

async function closeContext(context: BrowserContext): Promise<void> {
  await context.close();
}

async function openVaultPair(browser: Browser): Promise<{
  hostContext: BrowserContext;
  clientContext: BrowserContext;
  hostPage: Page;
  clientPage: Page;
}> {
  const hostContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const clientPage = await clientContext.newPage();
  try {
    await Promise.all([skipPassword(hostPage), skipPassword(clientPage)]);
    await Promise.all([
      installSyncStateProbe(hostPage),
      installSyncStateProbe(clientPage),
    ]);
    return { hostContext, clientContext, hostPage, clientPage };
  } catch (error) {
    await Promise.all([closeContext(hostContext), closeContext(clientContext)]);
    throw error;
  }
}

async function waitForCompleted(
  hostPage: Page,
  clientPage: Page,
): Promise<void> {
  for (const page of [hostPage, clientPage]) {
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const probe = (window as SyncWindow).__bookmarkForgeSyncState;
            // The service schedules a post-completion disconnect ~2 s after
            // "completed" (maybeScheduleDisconnectAfterSync), so under
            // parallel main-thread starvation the poll can miss the brief
            // "completed" window and observe only "disconnected". The
            // probe's latch proves completion regardless of when the poll
            // samples.
            return probe?.everCompleted || probe?.state === "completed"
              ? "completed"
              : (probe?.state ?? "unknown");
          }),
        { timeout: 30_000, intervals: [100, 250, 500] },
      )
      .toBe("completed");
  }
}

const CROSS_BROWSER_SYNC = process.env.WEBRTC_CROSS_BROWSER === "true";

test.describe("real two-vault WebRTC sync", () => {
  test.skip(
    ({ browserName }) =>
      !CROSS_BROWSER_SYNC && browserName !== "chromium",
    "The manual LAN WebRTC harness is opt-in outside Chromium; set WEBRTC_CROSS_BROWSER=true for compatibility certification runs.",
  );

  test("replicates both vaults and resolves a newer concurrent document version", async ({
    browser,
  }) => {
    const { hostContext, clientContext, hostPage, clientPage } =
      await openVaultPair(browser);

    let phase = "opened vault pair";
    try {
      phase = "seeding host documents";
      await seedDocuments(hostPage, [
        documentRecord(
          CONFLICT_ID,
          "host-newer-version",
          "2026-08-15T00:00:10.000Z",
        ),
        documentRecord(
          HOST_ONLY_ID,
          "host-only-document",
          "2026-08-15T00:00:11.000Z",
        ),
      ]);
      phase = "seeding client documents";
      await seedDocuments(clientPage, [
        documentRecord(
          CONFLICT_ID,
          "client-older-version",
          "2026-08-15T00:00:09.000Z",
        ),
        documentRecord(
          CLIENT_ONLY_ID,
          "client-only-document",
          "2026-08-15T00:00:12.000Z",
        ),
      ]);

      phase = "establishing WebRTC connection";
      await startHostAndClient(hostPage, clientPage);

      phase = "waiting for sync completion";
      await waitForCompleted(hostPage, clientPage);

      phase = "verifying converged documents";
      const [hostDocuments, clientDocuments] = await Promise.all([
        readDocuments(hostPage),
        readDocuments(clientPage),
      ]);
      for (const documents of [hostDocuments, clientDocuments]) {
        const byId = new Map(documents.map((doc) => [doc.id, doc]));
        expect(byId.get(CONFLICT_ID)?.title).toBe("host-newer-version");
        expect(byId.get(HOST_ONLY_ID)?.title).toBe("host-only-document");
        expect(byId.get(CLIENT_ONLY_ID)?.title).toBe("client-only-document");
      }
    } catch (error) {
      try {
        await attachSyncDiagnostics(test.info(), hostPage, clientPage, phase);
      } catch (diagnosticError) {
        // Preserve the assertion/connection failure as the primary error if
        // IndexedDB is already unavailable while collecting diagnostics.
        console.warn(
          "[vault-sync-real] diagnostic attachment failed:",
          diagnosticError,
        );
      }
      throw error;
    } finally {
      await Promise.all([closeContext(hostContext), closeContext(clientContext)]);
    }
  });

  for (const scenario of PRIVACY_AND_TOMBSTONE_CASES) {
    test(`syncs ${scenario.mode} invariants for ${scenario.collection}`, async ({
      browser,
    }) => {
      const { hostContext, clientContext, hostPage, clientPage } =
        await openVaultPair(browser);
      let phase = `opened vault pair for ${scenario.caseId}`;
      try {
        phase = `seeding ${scenario.caseId}`;
        const hostDocuments = scenario.collection === "documents"
          ? [scenario.hostRecord]
          : [];
        const clientDocuments = scenario.collection === "documents"
          ? [scenario.clientRecord]
          : [];
        const hostBookmarks = scenario.collection === "bookmarks"
          ? [scenario.hostRecord]
          : [];
        const clientBookmarks = scenario.collection === "bookmarks"
          ? [scenario.clientRecord]
          : [];
        await Promise.all([
          seedDocuments(hostPage, hostDocuments),
          seedDocuments(clientPage, clientDocuments),
          seedBookmarks(hostPage, hostBookmarks),
          seedBookmarks(clientPage, clientBookmarks),
        ]);

        phase = `syncing ${scenario.caseId}`;
        await startHostAndClient(hostPage, clientPage);
        await waitForCompleted(hostPage, clientPage);

        phase = `verifying ${scenario.caseId}`;
        const [hostDocumentRecords, clientDocumentRecords, hostBookmarkRecords, clientBookmarkRecords] =
          await Promise.all([
            readDocuments(hostPage),
            readDocuments(clientPage),
            readBookmarks(hostPage),
            readBookmarks(clientPage),
          ]);
        const hostRecords = scenario.collection === "documents"
          ? hostDocumentRecords
          : hostBookmarkRecords;
        const clientRecords = scenario.collection === "documents"
          ? clientDocumentRecords
          : clientBookmarkRecords;
        const hostRecord = hostRecords.find((record) => record.id === scenario.hostRecord.id);
        const clientRecord = clientRecords.find((record) => record.id === scenario.clientRecord.id);

        expect(hostRecord).toMatchObject(scenario.expectedHost);
        expect(clientRecord).toMatchObject(scenario.expectedClient);
      } catch (error) {
        try {
          await attachSyncDiagnostics(test.info(), hostPage, clientPage, phase);
        } catch (diagnosticError) {
          console.warn(
            "[vault-sync-real] diagnostic attachment failed:",
            diagnosticError,
          );
        }
        throw error;
      } finally {
        await Promise.all([closeContext(hostContext), closeContext(clientContext)]);
      }
    });
  }

  const interruptionScenarios: Array<{
    id: string;
    label: string;
    plan: InterruptionPlan;
  }> = [
    {
      id: "initial-chunk",
      label: "initial chunk",
      plan: { kind: "chunk", chunkIndex: 0 },
    },
    {
      id: "intermediate-chunk",
      label: "intermediate chunk",
      plan: { kind: "chunk", chunkIndex: 1 },
    },
    {
      id: "indexeddb-persistence",
      label: "IndexedDB persistence",
      plan: { kind: "persistence" },
    },
  ];

  for (const scenario of interruptionScenarios) {
    test(`recovers after interruption during ${scenario.label}`, async ({
      browser,
    }) => {
      const { hostContext, clientContext, hostPage, clientPage } =
        await openVaultPair(browser);
      const startedAt = Date.now();
      let interruptionObservedAt: number | null = null;
      let persistenceStartedAt: number | null = null;
      let persistenceFinishedAt: number | null = null;
      let retryStartedAt: number | null = null;
      let completedAt: number | null = null;
      let hostDocumentCount: number | null = null;
      let clientDocumentCount: number | null = null;
      let converged = false;
      let status: ConvergenceMetrics["status"] = "failed";
      let phase = "opened vault pair";
      try {
        phase = "seeding a multi-chunk retry document";
        await seedDocuments(hostPage, [
          documentRecord(
            RETRY_ID,
            "retry-after-interruption",
            "2026-08-15T00:00:20.000Z",
            {
              textContent: "retry-payload-".repeat(5_000),
            },
          ),
        ]);

        phase = `interrupting during ${scenario.label}`;
        await startHostAndClient(hostPage, clientPage, scenario.plan);
        if (scenario.plan.kind === "chunk") {
          await expect
            .poll(
              async () =>
                hostPage.evaluate(
                  () =>
                    (window as SyncWindow).__bookmarkForgeChunkInterrupted ??
                    false,
                ),
              { timeout: 15_000, intervals: [100, 250, 500] },
            )
            .toBe(true);
          interruptionObservedAt = Date.now();
          await expect
            .poll(
              async () =>
                hostPage.evaluate(
                  () =>
                    (window as SyncWindow).__bookmarkForgeSyncState?.state ??
                    "unknown",
                ),
              { timeout: 15_000, intervals: [100, 250, 500] },
            )
            .toMatch(/error|disconnected/);
        } else {
          await expect
            .poll(
              async () =>
                clientPage.evaluate(
                  () =>
                    (window as SyncWindow)
                      .__bookmarkForgePersistenceInterruptStarted ?? false,
                ),
              { timeout: 15_000, intervals: [100, 250, 500] },
            )
            .toBe(true);
          persistenceStartedAt = Date.now();
          interruptionObservedAt = persistenceStartedAt;
          await expect
            .poll(
              async () =>
                clientPage.evaluate(
                  () =>
                    (window as SyncWindow)
                      .__bookmarkForgePersistenceInterruptFinished ?? false,
                ),
              { timeout: 15_000, intervals: [100, 250, 500] },
            )
            .toBe(true);
          persistenceFinishedAt = Date.now();
        }

        phase = "retrying with a fresh session";
        retryStartedAt = Date.now();
        await startHostAndClient(hostPage, clientPage);
        await waitForCompleted(hostPage, clientPage);
        completedAt = Date.now();

        phase = "verifying retry convergence";
        const [hostDocuments, clientDocuments] = await Promise.all([
          readDocuments(hostPage),
          readDocuments(clientPage),
        ]);
        hostDocumentCount = hostDocuments.length;
        clientDocumentCount = clientDocuments.length;
        const retried = clientDocuments.find((doc) => doc.id === RETRY_ID);
        converged =
          retried?.title === "retry-after-interruption" &&
          retried?.textContent === "retry-payload-".repeat(5_000);
        expect(converged).toBe(true);
        status = "passed";
      } catch (error) {
        try {
          await attachSyncDiagnostics(test.info(), hostPage, clientPage, phase);
        } catch (diagnosticError) {
          console.warn(
            "[vault-sync-real] diagnostic attachment failed:",
            diagnosticError,
          );
        }
        throw error;
      } finally {
        const elapsed = (timestamp: number | null): number | null =>
          timestamp === null ? null : timestamp - startedAt;
        await attachConvergenceMetrics(test.info(), {
          caseId: scenario.id,
          interruption: scenario.plan,
          status,
          phase,
          startedAt: new Date(startedAt).toISOString(),
          elapsedMs: Date.now() - startedAt,
          interruptionObservedMs: elapsed(interruptionObservedAt),
          persistenceStartedMs: elapsed(persistenceStartedAt),
          persistenceFinishedMs: elapsed(persistenceFinishedAt),
          retryStartedMs: elapsed(retryStartedAt),
          completedMs: elapsed(completedAt),
          recoveryMs:
            retryStartedAt !== null && completedAt !== null
              ? completedAt - retryStartedAt
              : null,
          hostDocumentCount,
          clientDocumentCount,
          converged,
        });
        await Promise.all([closeContext(hostContext), closeContext(clientContext)]);
      }
    });
  }
});
