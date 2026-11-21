/**
 * A-3 E2E — public-relay mode: the `join` frame carries the opaque room, NEVER
 * the room secret.
 *
 * The room secret is the room capability: it keys the derived room name (A-2)
 * and every `signalAuth`. The self-hosted signaling server enforces it, so the
 * client must send it — but only to that server. Before A-3 the join frame
 * carried it to whatever relay the socket was opened against, which in a
 * deployment that never configured a server of its own (the default build)
 * meant the public rxdb.info / PubNub relays.
 *
 * Everything here is booted, not simulated at the module boundary:
 *
 *   - the build under test has NO configured signaling server
 *     (`VITE_P2P_SIGNALING_URL` empty, see playwright.public-relay.config.ts),
 *     so the app is in relay mode and dials the public relay;
 *   - a test relay stands in for that public relay inside the page
 *     (`page.routeWebSocket`, the only way to observe frames a browser sends to
 *     a third-party server), recording every frame the client emits;
 *   - the join frames it receives name the keyed HMAC topic (A-2) and contain
 *     no `roomSecret`/`secret` key and no occurrence of the secret value;
 *   - the readable room id appears in no frame at all;
 *   - every socket was opened against a PUBLIC relay host — never the
 *     deployment's own server.
 *
 * The positive control lives in the multiuser suite: with a configured server
 * (playwright.config.ts), vault-sync-signaling.spec.ts asserts that server's
 * /admin reports `secretPresent: true` for the room it just joined — i.e. the
 * secret really is transmitted to the server that has to enforce it. This spec
 * is the other half of that contract.
 */
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  readSyncTopic,
  skipPassword,
  startP2PSync,
} from "../e2e/vault-helpers";

/** The public relays the app falls back to when nothing is configured. */
const PUBLIC_RELAY_HOSTS = new Set(["signaling.rxdb.info", "signaling.pubnub.com"]);
/** Real relays greet every socket with `init`; ours does the same. */
const RELAY_PEER_ID = "public-relay-peer-1";

interface RelayedFrame {
  socket: string;
  raw: string;
  frame: Record<string, unknown> | null;
}

/** The keyed room names every replicating collection joins (A-2). */
async function deriveTopics(
  page: Page,
  roomId: string,
  roomSecret: string,
): Promise<{ documents: string; bookmarks: string }> {
  return {
    documents: await readSyncTopic(page, roomId, roomSecret, "documents"),
    bookmarks: await readSyncTopic(page, roomId, roomSecret, "bookmarks"),
  };
}

/** The signaling URL the app believes it is configured with. */
async function readConfiguredSignalingUrl(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const { env } = await import("/src/env.config.ts");
    return env.p2pSignalingUrl ?? null;
  });
}

async function attachEvidence(
  testInfo: TestInfo,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await testInfo.attach("public-relay-frames.json", {
      body: JSON.stringify(payload, null, 2),
      contentType: "application/json",
    });
  } catch (error) {
    // Evidence must never mask the primary failure.
    console.warn("[public-relay] evidence attachment failed:", error);
  }
}

test("relay mode joins with the keyed room and never sends the room secret", async ({
  page,
}, testInfo) => {
  const frames: RelayedFrame[] = [];
  const dialled: string[] = [];
  let phase = "installing the public-relay stand-in";

  await page.routeWebSocket(
    (url) => PUBLIC_RELAY_HOSTS.has(url.hostname),
    (relay) => {
      dialled.push(relay.url());
      relay.onMessage((message) => {
        const raw = typeof message === "string" ? message : message.toString("utf8");
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // A non-JSON frame is kept raw: it can still leak the secret by value.
        }
        frames.push({
          socket: relay.url(),
          raw,
          frame:
            parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : null,
        });
      });
      relay.send(JSON.stringify({ type: "init", yourPeerId: RELAY_PEER_ID }));
    },
  );

  const roomId = `e2e-relay-${randomBytes(8).toString("hex")}`;
  const roomSecret = randomBytes(32).toString("hex");
  const topics = { documents: "", bookmarks: "" };

  try {
    phase = "bootstrapping the vault (relay-mode build)";
    await skipPassword(page);

    phase = "asserting the app booted WITHOUT a configured signaling server";
    const configuredUrl = await readConfiguredSignalingUrl(page);
    expect(configuredUrl).toBeFalsy();

    phase = "deriving the keyed room names";
    Object.assign(topics, await deriveTopics(page, roomId, roomSecret));

    phase = "starting P2P sync (public-relay mode)";
    await startP2PSync(page, roomId, roomSecret);

    phase = "waiting for the public relay to receive the join frames";
    await expect
      .poll(() => frames.length, { timeout: 45_000, intervals: [100, 250, 500, 1_000] })
      .toBeGreaterThan(0);

    // The first frame to land can be the bookmarks join — wait for THIS
    // session's documents join too before judging, so the keyed-room check
    // below never races the order the joins happen to arrive in.
    await expect
      .poll(
        () =>
          frames.some(
            (entry) =>
              entry.frame?.type === "join" &&
              entry.frame?.room === topics.documents,
          ),
        { timeout: 45_000, intervals: [100, 250, 500, 1_000] },
      )
      .toBe(true);

    const joins = frames.filter((entry) => entry.frame?.type === "join");
    const evidence = {
      phase,
      configuredSignalingUrl: configuredUrl,
      roomId,
      roomSecretLength: roomSecret.length,
      topics,
      dialledSockets: dialled,
      frames: frames.map((entry) => entry.frame ?? { raw: entry.raw }),
    };
    // Attach before asserting: the evidence must survive a failure.
    await attachEvidence(testInfo, evidence);

    expect(joins.length).toBeGreaterThanOrEqual(1);
    const allowedRooms = new Set([topics.documents, topics.bookmarks]);
    for (const join of joins) {
      // ── The claim ───────────────────────────────────────────────────────
      // The room secret is not in the frame: not as a key, not anywhere in
      // the bytes the relay received.
      expect(Object.keys(join.frame ?? {})).not.toContain("roomSecret");
      expect(Object.keys(join.frame ?? {})).not.toContain("secret");
      expect(join.raw).not.toContain(roomSecret);
      // ── And what the relay does get is the keyed topic (A-2) ────────────
      expect(join.frame?.room).toMatch(/^[0-9a-f]{64}$/);
      expect(allowedRooms.has(String(join.frame?.room))).toBe(true);
    }
    // The replication really joined the app's own derived room, so the frames
    // above are this session's joins and not a stray protocol message.
    expect(joins.some((join) => join.frame?.room === topics.documents)).toBe(true);
    expect(dialled.length).toBeGreaterThan(0);

    // A-2: the readable room id never reaches any relay, in any frame.
    for (const entry of frames) expect(entry.raw).not.toContain(roomId);

    // The secret policy is per-origin, so what makes this run meaningful is
    // that every socket went to a public relay: no self-hosted server is
    // involved, and the frames above are therefore exactly the exposure A-3
    // closed.
    for (const url of dialled) {
      expect(PUBLIC_RELAY_HOSTS.has(new URL(url).hostname)).toBe(true);
    }
  } catch (error) {
    await attachEvidence(testInfo, {
      phase,
      failed: String(error),
      configuredSignalingUrl: await readConfiguredSignalingUrl(page).catch(() => null),
      roomId,
      topics,
      dialledSockets: dialled,
      frames: frames.map((entry) => entry.frame ?? { raw: entry.raw }),
    });
    throw error;
  }
});
