import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { skipPassword } from "./vault-helpers";

/**
 * End-to-end coverage for the optional mutual-pairing layer on WebRTC P2P
 * sync (ADR-073, audit 2026-11-05 M2). Two real vaults in separate browser
 * contexts exchange SDP through the service API — the same path the QR UI
 * drives — and the specs prove:
 *
 *  1. "verify" mode: both devices derive the SAME 6-digit SAS, sync does NOT
 *     start until BOTH sides confirm, then completes.
 *  2. "code" mode: the client is refused without the host's pairing code,
 *     succeeds with it, and completes after mutual confirmation.
 *  3. Fail-closed: a wrong pairing code kills the session on BOTH peers
 *     before a single sync document is exchanged.
 *
 * The QR-only legacy path is already covered by vault-sync-real.spec.ts.
 */

type PairProbe = {
  state: string;
  message?: string;
  /** Latched: the service auto-disconnects ~2 s after "completed", so a
   * poll can miss the live state — same contract as SyncStateSnapshot. */
  everCompleted: boolean;
  sas: string | null;
  pairingEvents: string[];
};

interface PairWindow extends Window {
  __bfPairProbe?: PairProbe;
}

async function installPairProbe(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const probe: PairProbe = {
      state: "disconnected",
      everCompleted: false,
      sas: null,
      pairingEvents: [],
    };
    (window as PairWindow).__bfPairProbe = probe;
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    webRTCSyncService.registerCallbacks(
      (nextState, message) => {
        probe.state = nextState;
        probe.message = message;
        if (nextState === "completed") {
          probe.everCompleted = true;
        }
      },
      () => undefined,
      (event) => {
        probe.pairingEvents.push(event.type);
        if (event.type === "sas") {
          probe.sas = event.code;
        }
      },
    );
  });
}

async function readProbe(page: Page): Promise<PairProbe> {
  return page.evaluate(() => {
    const probe = (window as PairWindow).__bfPairProbe;
    return probe ?? { state: "unknown", everCompleted: false, sas: null, pairingEvents: [] };
  });
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
      installPairProbe(hostPage),
      installPairProbe(clientPage),
    ]);
    return { hostContext, clientContext, hostPage, clientPage };
  } catch (error) {
    await Promise.all([hostContext.close(), clientContext.close()]);
    throw error;
  }
}

async function hostOffer(
  hostPage: Page,
  pairing?: "verify" | "code",
): Promise<string> {
  return hostPage.evaluate(async (mode) => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    return webRTCSyncService.startHost(
      mode ? { pairing: mode } : undefined,
    );
  }, pairing);
}

async function clientAnswer(
  clientPage: Page,
  offer: string,
  pairingCode?: string,
): Promise<string> {
  return clientPage.evaluate(
    async ([encodedOffer, code]) => {
      const { webRTCSyncService } = await import(
        "/src/services/WebRTCSyncService"
      );
      return webRTCSyncService.startClient(
        encodedOffer,
        code ? { pairingCode: code } : undefined,
      );
    },
    [offer, pairingCode] as const,
  );
}

async function deliverAnswer(hostPage: Page, answer: string): Promise<void> {
  await hostPage.evaluate(async (encodedAnswer) => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    await webRTCSyncService.processClientAnswer(encodedAnswer);
  }, answer);
}

async function confirmPairing(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    webRTCSyncService.confirmPairing();
  });
}

async function hostPairingCode(hostPage: Page): Promise<string> {
  const code = await hostPage.evaluate(async () => {
    const { webRTCSyncService } = await import(
      "/src/services/WebRTCSyncService"
    );
    return webRTCSyncService.getPairingCode();
  });
  if (!code) {
    throw new Error("Host did not expose a pairing code in code mode");
  }
  return code;
}

async function waitForSas(page: Page): Promise<string> {
  await expect
    .poll(async () => (await readProbe(page)).sas, {
      timeout: 20_000,
      intervals: [100, 250, 500],
    })
    .toBeTruthy();
  const sas = (await readProbe(page)).sas;
  if (!sas) {
    throw new Error("SAS probe reported truthy but read back null");
  }
  return sas;
}

async function waitForCompleted(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const probe = await readProbe(page);
        return probe.everCompleted || probe.state === "completed"
          ? "completed"
          : probe.state;
      },
      { timeout: 30_000, intervals: [100, 250, 500] },
    )
    .toBe("completed");
}

async function waitForPairingState(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readProbe(page)).state, {
      timeout: 20_000,
      intervals: [100, 250, 500],
    })
    .toBe("pairing");
}

test.describe("P2P mutual pairing (ADR-073)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Manual LAN WebRTC harness is Chromium-only (see vault-sync-real.spec.ts).",
  );

  test("verify mode: matching SAS gates sync until both sides confirm", async ({
    browser,
  }) => {
    const { hostContext, clientContext, hostPage, clientPage } =
      await openVaultPair(browser);
    try {
      const offer = await hostOffer(hostPage, "verify");
      // The offer must advertise the pairing mode to new clients.
      const advertised = await hostPage.evaluate(async (encoded) => {
        const { webRTCSyncService } = await import(
          "/src/services/WebRTCSyncService"
        );
        return webRTCSyncService.describeOfferPairing(encoded);
      }, offer);
      expect(advertised).toBe("verify");

      const answer = await clientAnswer(clientPage, offer);
      await deliverAnswer(hostPage, answer);

      const [hostSas, clientSas] = await Promise.all([
        waitForSas(hostPage),
        waitForSas(clientPage),
      ]);
      expect(clientSas).toBe(hostSas);
      expect(hostSas).toMatch(/^\d{6}$/);

      // The pairing gate must hold: state stays "pairing" and no sync
      // document flows while either side has not confirmed.
      await waitForPairingState(hostPage);
      await waitForPairingState(clientPage);
      await hostPage.waitForTimeout(2_000);
      for (const probe of [await readProbe(hostPage), await readProbe(clientPage)]) {
        expect(probe.state).toBe("pairing");
        expect(probe.everCompleted).toBe(false);
      }

      await confirmPairing(hostPage);
      await confirmPairing(clientPage);

      await Promise.all([
        waitForCompleted(hostPage),
        waitForCompleted(clientPage),
      ]);
    } finally {
      await Promise.all([hostContext.close(), clientContext.close()]);
    }
  });

  test("code mode: client needs the host's pairing code, then syncs", async ({
    browser,
  }) => {
    const { hostContext, clientContext, hostPage, clientPage } =
      await openVaultPair(browser);
    try {
      const offer = await hostOffer(hostPage, "code");
      const advertised = await hostPage.evaluate(async (encoded) => {
        const { webRTCSyncService } = await import(
          "/src/services/WebRTCSyncService"
        );
        return webRTCSyncService.describeOfferPairing(encoded);
      }, offer);
      expect(advertised).toBe("code");
      const pairingCode = await hostPairingCode(hostPage);
      expect(pairingCode).toMatch(/^[0-9A-Z]{12}$/);

      // Fail-closed: no typed code → startClient refuses the offer.
      await expect(clientAnswer(clientPage, offer)).rejects.toThrow(
        /pairing code/i,
      );

      const answer = await clientAnswer(clientPage, offer, pairingCode);
      await deliverAnswer(hostPage, answer);

      const [hostSas, clientSas] = await Promise.all([
        waitForSas(hostPage),
        waitForSas(clientPage),
      ]);
      expect(clientSas).toBe(hostSas);

      await confirmPairing(hostPage);
      await confirmPairing(clientPage);
      await Promise.all([
        waitForCompleted(hostPage),
        waitForCompleted(clientPage),
      ]);
    } finally {
      await Promise.all([hostContext.close(), clientContext.close()]);
    }
  });

  test("code mode: a wrong pairing code fails closed on both peers", async ({
    browser,
  }) => {
    const { hostContext, clientContext, hostPage, clientPage } =
      await openVaultPair(browser);
    try {
      const offer = await hostOffer(hostPage, "code");
      const realCode = await hostPairingCode(hostPage);
      // Same length/format, different secret: flip the first symbol to the
      // next alphabet character so normalization still accepts it.
      const wrongCode =
        (realCode[0] === "Z" ? "Y" : "Z") + realCode.slice(1);
      expect(wrongCode).not.toBe(realCode);

      const answer = await clientAnswer(clientPage, offer, wrongCode);
      await deliverAnswer(hostPage, answer);

      // The hello MAC check must kill the session on BOTH ends before any
      // sync document is exchanged.
      for (const page of [hostPage, clientPage]) {
        await expect
          .poll(async () => (await readProbe(page)).state, {
            timeout: 20_000,
            intervals: [100, 250, 500],
          })
          .toBe("error");
        const probe = await readProbe(page);
        expect(probe.everCompleted).toBe(false);
        expect(probe.sas).toBeNull();
      }
    } finally {
      await Promise.all([hostContext.close(), clientContext.close()]);
    }
  });
});
