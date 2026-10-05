/**
 * Multiuser WebRTC sync through the SELF-HOSTED signaling server
 * (dynamic audit, Phase C — docs/AUDIT-DINAMICA.md §5).
 *
 * This spec automates what the audit plan calls "escalado de peers" against
 * the real local signaling server (server/src/index.ts):
 *
 *   - Three isolated browser contexts (separate IndexedDB vaults) join the
 *     SAME room with the same 64-hex room secret and replicate via RxDB
 *     WebRTC replication (SyncService.startP2PSync), exactly like the app's
 *     collaboration flow does.
 *   - Each context seeds a distinct document; the assertion is that all
 *     three converge to the union (4 documents) AND that each context
 *     reports a live peer connection (connectedPeers ≥ 1, health healthy).
 *   - The `/admin` endpoint of the signaling server is verified in both
 *     states: fail-closed without the token (503 / 401) and — while the
 *     room is live — reporting `connections ≥ 3`, `rooms ≥ 1` and a
 *     `roomMetrics[]` entry for OUR room with `peers ≥ 3` and
 *     `secretPresent: true`. That last assertion is also the proof the sync
 *     actually went through the LOCAL server rather than the public
 *     rxdb.info/PubNub fallbacks.
 *
 *   - A-2: the room name is NOT the readable room id. It is
 *     HMAC-SHA256(roomSecret, `bookmarkforge-sync-topic:v1:${roomId}:${collection}`),
 *     so every server/relay (including the public fallbacks) sees an opaque
 *     64-hex string. This spec derives the expected topic with the app's own
 *     `deriveSyncTopic` from inside the page (never a duplicated copy of the
 *     derivation) and asserts /admin reports exactly that room — and that no
 *     room name on the wire contains the plaintext room id.
 *
 * Runtime wiring (see playwright.multiuser.config.ts and the nightly
 * config): the Vite dev server is started with VITE_P2P_SIGNALING_URL
 * pointing at the local signaling server, and the signaling server is
 * started as a second Playwright webServer with SIGNALING_ADMIN_TOKEN set.
 * The spec reads the signaling URL from the app's own env registry
 * (`env.p2pSignalingUrl`) so the `/admin` verification is guaranteed to hit
 * the same server the app is talking to.
 */
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  readSyncTopic,
  skipPassword,
  startP2PSync,
} from "./vault-helpers";

/** Must match the webServer env fallback in the Playwright configs. */
const ADMIN_TOKEN = process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token";

const HOST_DOCS = [
  { id: "e2e-ms-host-a", title: "multiuser-host-alpha" },
  { id: "e2e-ms-host-b", title: "multiuser-host-beta" },
];
const PEER_C_DOCS = [
  { id: "e2e-ms-peer-c", title: "multiuser-peer-charlie" },
];
const PEER_D_DOCS = [
  { id: "e2e-ms-peer-d", title: "multiuser-peer-delta" },
];
const EXPECTED_TITLES = [
  ...HOST_DOCS.map((d) => d.title),
  ...PEER_C_DOCS.map((d) => d.title),
  ...PEER_D_DOCS.map((d) => d.title),
];

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

async function readDocumentTitles(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    const docs = await db.documents.find().exec();
    return docs.map((doc) => String(doc.title));
  });
}

async function syncSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const { syncService } = await import("/src/services/SyncService.ts");
    return {
      isSyncing: syncService.isSyncing,
      currentRoomId: syncService.currentRoomId,
      connectedPeers: syncService.connectedPeers,
      syncHealth: syncService.syncHealth,
      lastSyncTime: syncService.lastSyncTime,
      dedupe: syncService.getDedupeStats(),
    };
  });
}

/** Read the signaling URL the app is actually configured with. */
async function readSignalingUrl(page: Page): Promise<string> {
  const url = await page.evaluate(async () => {
    const { env } = await import("/src/env.config.ts");
    return env.p2pSignalingUrl ?? null;
  });
  if (!url) {
    throw new Error(
      "VITE_P2P_SIGNALING_URL is not set for this run — the multiuser spec " +
        "must run with the local signaling server wired in (see playwright.multiuser.config.ts).",
    );
  }
  return url;
}

/** Convert ws://… to http://… for the /admin HTTP requests. */
function httpBase(signalingUrl: string): string {
  return signalingUrl.replace(/^ws:/, "http:");
}

async function openTriplet(browser: Browser): Promise<{
  contexts: BrowserContext[];
  pages: Page[];
}> {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(pages.map((page) => skipPassword(page)));
    return { contexts, pages };
  } catch (error) {
    await Promise.all(
      contexts.map((context) => context.close().catch(() => undefined)),
    );
    throw error;
  }
}

async function attachDiagnostics(
  testInfo: TestInfo,
  phase: string,
  pages: Page[],
  httpBaseUrl: string,
): Promise<void> {
  const snapshots = await Promise.all(
    pages.map((page) =>
      syncSnapshot(page).catch((error) => ({ error: String(error) })),
    ),
  );
  let admin: unknown = null;
  try {
    const response = await fetch(`${httpBaseUrl}/admin`, {
      headers: { "x-signaling-admin-token": ADMIN_TOKEN },
    });
    admin = {
      status: response.status,
      body:
        response.status === 200
          ? await response.json()
          : await response.text(),
    };
  } catch (error) {
    admin = { error: String(error) };
  }
  try {
    await testInfo.attach("multiuser-signaling-diagnostics.json", {
      body: JSON.stringify({ phase, snapshots, admin }, null, 2),
      contentType: "application/json",
    });
  } catch (error) {
    // The attachment must not mask the primary failure after teardown.
    console.warn("[vault-sync-signaling] diagnostic attachment failed:", error);
  }
}

test.describe("multiuser WebRTC sync via the local signaling server", () => {
  test.describe.configure({ mode: "serial" });

  test("three contexts converge and /admin reports the live room", async ({
    browser,
    request,
  }) => {
    const { contexts, pages } = await openTriplet(browser);
    const [host, peerC, peerD] = pages;
    const hostPage = host!;
    const peerCPage = peerC!;
    const peerDPage = peerD!;
    const roomId = `e2e-ms-${randomBytes(8).toString("hex")}`;
    const roomSecret = randomBytes(32).toString("hex");
    let phase = "opened three vault contexts";
    try {
      // ── Auth matrix against the REAL local signaling server ──
      // This run boots the server WITH SIGNALING_ADMIN_TOKEN configured, so
      // the endpoint is enabled: missing and wrong tokens both fail closed
      // with 401. (503 is the separate "endpoint disabled" state, returned
      // only when the server has NO admin token configured at all — verified
      // by signaling-server.test.ts.)
      phase = "reading the app's signaling URL";
      const signalingUrl = await readSignalingUrl(hostPage);
      const base = httpBase(signalingUrl);

      phase = "verifying /admin fails closed without a token";
      const noToken = await request.get(`${base}/admin`);
      expect(noToken.status()).toBe(401);

      phase = "verifying /admin rejects a wrong token";
      const wrongToken = await request.get(`${base}/admin`, {
        headers: { "x-signaling-admin-token": "wrong-admin-token" },
      });
      expect(wrongToken.status()).toBe(401);

      phase = "verifying /admin reports an empty server before the room exists";
      const empty = await request.get(`${base}/admin`, {
        headers: { "x-signaling-admin-token": ADMIN_TOKEN },
      });
      expect(empty.status()).toBe(200);
      const emptyMetrics = (await empty.json()) as {
        trustProxy: boolean;
        roomMetrics: Array<{ roomId: string }>;
      };
      expect(emptyMetrics.trustProxy).toBe(false);
      expect(
        emptyMetrics.roomMetrics.some((room) => room.roomId === roomId),
      ).toBe(false);

      // ── Seed distinct data per context ──
      phase = "seeding distinct documents in each context";
      await Promise.all([
        seedDocuments(hostPage, [
          documentRecord(HOST_DOCS[0]!.id, HOST_DOCS[0]!.title, "2026-08-15T00:00:10.000Z"),
          documentRecord(HOST_DOCS[1]!.id, HOST_DOCS[1]!.title, "2026-08-15T00:00:11.000Z"),
        ]),
        seedDocuments(peerCPage, [
          documentRecord(PEER_C_DOCS[0]!.id, PEER_C_DOCS[0]!.title, "2026-08-15T00:00:12.000Z"),
        ]),
        seedDocuments(peerDPage, [
          documentRecord(PEER_D_DOCS[0]!.id, PEER_D_DOCS[0]!.title, "2026-08-15T00:00:13.000Z"),
        ]),
      ]);

      // ── Join the same room with the same secret from all three ──
      phase = "starting P2P sync in all three contexts";
      await Promise.all([
        startP2PSync(hostPage, roomId, roomSecret),
        startP2PSync(peerCPage, roomId, roomSecret),
        startP2PSync(peerDPage, roomId, roomSecret),
      ]);

      // ── Convergence: every context must hold the union of all seeds ──
      phase = "waiting for three-way convergence";
      const converged = async (page: Page): Promise<boolean> => {
        const titles = await readDocumentTitles(page);
        return EXPECTED_TITLES.every((title) => titles.includes(title));
      };
      for (const page of pages) {
        await expect
          .poll(() => converged(page), {
            timeout: 90_000,
            intervals: [250, 500, 1_000],
          })
          .toBe(true);
      }

      // ── Each context must be a live peer of the mesh ──
      phase = "verifying live peer connections";
      for (const page of pages) {
        const snapshot = await syncSnapshot(page);
        expect(snapshot.isSyncing).toBe(true);
        expect(snapshot.connectedPeers).toBeGreaterThanOrEqual(1);
        expect(snapshot.syncHealth).toBe("healthy");
      }

      // ── /admin must now report the live room with 3 peers ──
      phase = "deriving the keyed room names";
      const documentsTopic = await readSyncTopic(
        hostPage,
        roomId,
        roomSecret,
        "documents",
      );
      const bookmarksTopic = await readSyncTopic(
        hostPage,
        roomId,
        roomSecret,
        "bookmarks",
      );
      // Per-collection rooms stay distinct, and the keyed names are opaque.
      expect(documentsTopic).not.toBe(bookmarksTopic);
      expect(documentsTopic).toMatch(/^[0-9a-f]{64}$/);
      expect(bookmarksTopic).toMatch(/^[0-9a-f]{64}$/);

      phase = "verifying /admin reports the live room";
      const live = await request.get(`${base}/admin`, {
        headers: { "x-signaling-admin-token": ADMIN_TOKEN },
      });
      expect(live.status()).toBe(200);
      const liveMetrics = (await live.json()) as {
        connections: number;
        rooms: number;
        trustProxy: boolean;
        roomMetrics: Array<{
          roomId: string;
          peers: number;
          secretPresent: boolean;
        }>;
      };
      expect(liveMetrics.connections).toBeGreaterThanOrEqual(3);
      expect(liveMetrics.rooms).toBeGreaterThanOrEqual(1);
      // A-2: the room name on the wire is the keyed HMAC topic, so the server
      // must report THAT room — and no room name may contain the plaintext
      // room id (the whole point of the change: relays never learn the
      // capability).
      expect(
        liveMetrics.roomMetrics.some((room) => room.roomId.includes(roomId)),
      ).toBe(false);
      const documentsRoom = liveMetrics.roomMetrics.find(
        (room) => room.roomId === documentsTopic,
      );
      expect(documentsRoom).toBeDefined();
      expect(documentsRoom?.peers).toBeGreaterThanOrEqual(3);
      expect(documentsRoom?.secretPresent).toBe(true);
      // Each collection replicates in its own collection-scoped room so peers
      // never mix schemas; the bookmarks room must exist too.
      expect(
        liveMetrics.roomMetrics.some((room) => room.roomId === bookmarksTopic),
      ).toBe(true);

      // ── Evidence for the audit ──
      try {
        await test.info().attach("multiuser-admin-evidence.json", {
          body: JSON.stringify(
            {
              roomId,
              documentsTopic,
              bookmarksTopic,
              convergedTitles: EXPECTED_TITLES,
              liveMetrics,
              trustProxy: liveMetrics.trustProxy,
            },
            null,
            2,
          ),
          contentType: "application/json",
        });
      } catch (error) {
        console.warn(
          "[vault-sync-signaling] evidence attachment failed:",
          error,
        );
      }
    } catch (error) {
      try {
        const signalingUrl = await readSignalingUrl(hostPage).catch(() => null);
        await attachDiagnostics(
          test.info(),
          phase,
          pages,
          signalingUrl ? httpBase(signalingUrl) : "http://127.0.0.1:8899",
        );
      } catch (diagnosticError) {
        console.warn(
          "[vault-sync-signaling] diagnostic attachment failed:",
          diagnosticError,
        );
      }
      throw error;
    } finally {
      await Promise.all(
        contexts.map((context) => context.close().catch(() => undefined)),
      );
    }
  });
});
