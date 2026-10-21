import {
  test,
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
  classifyHandshakeOutcome,
  type HandshakeEvidence,
} from "./webrtc-handshake-diagnostics";

/**
 * Opt-in per-browser WebRTC handshake diagnostics. Runs the real app handshake
 * in whatever project is selected (Chromium via playwright.nightly.config.ts,
 * Firefox/WebKit via playwright.browsers.config.ts), snapshots the SDP + ICE
 * evidence on both peers, classifies the handshake phase with the shared
 * classifier, and attaches `webrtc-handshake-diagnostics.json`. The test
 * passes when the evidence was captured even if the handshake itself failed —
 * that failure IS the classification (e.g. WebKit → `capability-missing`,
 * loopback Firefox → `gathering-blocked`). Only a harness failure to capture
 * makes the test fail.
 *
 * Run it with:
 *   WEBRTC_HANDSHAKE_DIAGNOSTICS=true npx playwright test \
 *     --config=playwright.browsers.config.ts \
 *     tests/e2e/webrtc-handshake-diagnostics.spec.ts
 */
const HANDSHAKE_DIAGNOSTICS = process.env.WEBRTC_HANDSHAKE_DIAGNOSTICS === "true";

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
    await Promise.all([hostContext.close(), clientContext.close()]);
    throw error;
  }
}

async function attemptHandshake(
  hostPage: Page,
  clientPage: Page,
): Promise<{ offerExchanged: boolean; answerExchanged: boolean }> {
  let offer = "";
  try {
    offer = await hostPage.evaluate(async () => {
      const { webRTCSyncService } = await import(
        "/src/services/WebRTCSyncService"
      );
      return webRTCSyncService.startHost();
    });
  } catch {
    // The failure is captured by the evidence snapshot, not thrown here.
  }
  const offerExchanged = offer.length > 0;
  let answer = "";
  if (offerExchanged) {
    try {
      answer = await clientPage.evaluate(async (encodedOffer) => {
        const { webRTCSyncService } = await import(
          "/src/services/WebRTCSyncService"
        );
        return webRTCSyncService.startClient(encodedOffer);
      }, offer);
    } catch {
      // See above: evidence snapshot carries the classification.
    }
  }
  const answerExchanged = answer.length > 0;
  if (answerExchanged) {
    try {
      await hostPage.evaluate(async (encodedAnswer) => {
        const { webRTCSyncService } = await import(
          "/src/services/WebRTCSyncService"
        );
        await webRTCSyncService.processClientAnswer(encodedAnswer);
      }, answer);
    } catch {
      // See above.
    }
  }
  return { offerExchanged, answerExchanged };
}

async function capturePeerEvidence(
  hostPage: Page,
  clientPage: Page,
): Promise<{ host: HandshakeEvidence; client: HandshakeEvidence }> {
  const [host, client] = await Promise.all([
    captureHandshakeEvidence(hostPage),
    captureHandshakeEvidence(clientPage),
  ]);
  return { host, client };
}

async function attachHandshakeDiagnostics(
  testInfo: TestInfo,
  browserName: string,
  exchange: { offerExchanged: boolean; answerExchanged: boolean },
  early: { host: HandshakeEvidence; client: HandshakeEvidence },
  terminal: { host: HandshakeEvidence; client: HandshakeEvidence },
): Promise<{ host: HandshakeEvidence; client: HandshakeEvidence }> {
  const outcome = (evidence: HandshakeEvidence, peer: "host" | "client") =>
    classifyHandshakeOutcome(
      evidence,
      peer === "host" ? terminal.host : terminal.client,
      exchange,
    );
  const payload = {
    generatedAt: new Date().toISOString(),
    browserName,
    exchange,
    early: {
      host: { ...early.host, classification: classifyHandshake(early.host) },
      client: {
        ...early.client,
        classification: classifyHandshake(early.client),
      },
    },
    terminal: {
      host: { ...terminal.host, classification: classifyHandshake(terminal.host) },
      client: {
        ...terminal.client,
        classification: classifyHandshake(terminal.client),
      },
    },
    outcome: {
      host: outcome(early.host, "host"),
      client: outcome(early.client, "client"),
    },
  };
  await testInfo.attach("webrtc-handshake-diagnostics.json", {
    body: JSON.stringify(payload, null, 2),
    contentType: "application/json",
  });
  return { host: early.host, client: early.client };
}

test.describe("per-browser WebRTC handshake diagnostics", () => {
  test.skip(
    !HANDSHAKE_DIAGNOSTICS,
    "Opt-in diagnostic; set WEBRTC_HANDSHAKE_DIAGNOSTICS=true to capture per-browser SDP/ICE evidence.",
  );

  test("captures SDP and ICE evidence and classifies the handshake", async ({
    browser,
    browserName,
  }, testInfo) => {
    const { hostContext, clientContext, hostPage, clientPage } =
      await openVaultPair(browser);
    try {
      const exchange = await attemptHandshake(hostPage, clientPage);
      // Mid-flight snapshot: ICE and the data channel should have settled for
      // a healthy engine, before the service's post-completion auto-disconnect
      // (~2 s after `completed`) tears the peer connection down.
      await hostPage.waitForTimeout(1200);
      const early = await capturePeerEvidence(hostPage, clientPage);
      // Terminal snapshot: catches the post-sync teardown (or the stuck/failed
      // state of a broken handshake).
      await hostPage.waitForTimeout(2300);
      const terminal = await capturePeerEvidence(hostPage, clientPage);
      const { host, client } = await attachHandshakeDiagnostics(
        testInfo,
        browserName,
        exchange,
        early,
        terminal,
      );
      console.log(
        `[handshake-diagnostics] ${browserName}: host=${classifyHandshakeOutcome(host, terminal.host, exchange)} client=${classifyHandshakeOutcome(client, terminal.client, exchange)}`,
      );
    } finally {
      await Promise.all([hostContext.close(), clientContext.close()]);
    }
  });
});
