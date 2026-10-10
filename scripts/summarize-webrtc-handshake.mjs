#!/usr/bin/env node
/**
 * scripts/summarize-webrtc-handshake.mjs — per-browser handshake diagnostics.
 *
 * Reads the Playwright JSON report produced by the opt-in diagnostic spec
 * (tests/e2e/webrtc-handshake-diagnostics.spec.ts), extracts every
 * `webrtc-handshake-diagnostics.json` attachment (SDP + ICE evidence +
 * classification per peer) and writes a per-browser summary so the handshake
 * can be classified from raw evidence before any human judgment:
 *
 *   playwright-report-browsers/webrtc-handshake-diagnostics.json
 *
 * Usage:
 *   npm run report:webrtc-handshake
 *   WEBRTC_PLAYWRIGHT_REPORT=playwright-report-browsers/results.json \
 *     WEBRTC_HANDSHAKE_SUMMARY=webrtc-handshake-diagnostics.json \
 *     node scripts/summarize-webrtc-handshake.mjs
 *
 * Exit codes: 0 — summary written (also when no attachments were found, with
 * a warning); 1 — the report could not be read/parsed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_PATH = resolve(
  process.env.WEBRTC_PLAYWRIGHT_REPORT ?? "playwright-report-browsers/results.json",
);
const OUTPUT_PATH = resolve(
  process.env.WEBRTC_HANDSHAKE_SUMMARY ??
    "playwright-report-browsers/webrtc-handshake-diagnostics.json",
);

function collectHandshakeAttachments(suites, output = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          for (const attachment of result.attachments ?? []) {
            if (attachment.name !== "webrtc-handshake-diagnostics.json") continue;
            const attachmentText =
              attachment.body !== undefined
                ? Buffer.from(attachment.body, "base64").toString("utf8")
                : attachment.path && existsSync(attachment.path)
                  ? readFileSync(attachment.path, "utf8")
                  : null;
            if (attachmentText === null) continue;
            try {
              output.push({
                ...JSON.parse(attachmentText),
                spec: spec.title,
                test: test.title,
                resultStatus: result.status,
              });
            } catch (error) {
              output.push({
                generatedAt: new Date().toISOString(),
                browserName: String(test.projectName ?? "unknown"),
                parseError: error instanceof Error ? error.message : String(error),
                spec: spec.title,
                test: test.title,
                resultStatus: result.status,
              });
            }
          }
        }
      }
    }
    collectHandshakeAttachments(suite.suites, output);
  }
  return output;
}

if (!existsSync(REPORT_PATH)) {
  console.warn(`[summarize-webrtc-handshake] report not found: ${REPORT_PATH}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
const attachments = collectHandshakeAttachments(report.suites);

const byBrowser = new Map();
for (const attachment of attachments) {
  const browserName = String(attachment.browserName ?? "unknown");
  const entry = byBrowser.get(browserName) ?? [];
  entry.push(attachment);
  byBrowser.set(browserName, entry);
}

const browsers = [...byBrowser.entries()]
  .map(([browserName, runs]) => {
    const latest = runs[runs.length - 1];
    const earlyHost = latest.early?.host;
    const terminalHost = latest.terminal?.host;
    return {
      browserName,
      runs: runs.length,
      classification: {
        host: latest.outcome?.host ?? "not-captured",
        client: latest.outcome?.client ?? "not-captured",
        hostEarly: earlyHost?.classification ?? "not-captured",
        clientEarly: latest.early?.client?.classification ?? "not-captured",
      },
      evidence: earlyHost
        ? {
            rtcSupported: earlyHost.rtcSupported,
            state: earlyHost.state,
            message: earlyHost.message ?? null,
            connectionState: earlyHost.connectionState,
            iceConnectionState: earlyHost.iceConnectionState,
            iceGatheringState: earlyHost.iceGatheringState,
            dataChannelState: earlyHost.dataChannelState,
            localCandidateCount: earlyHost.localCandidateCount,
            remoteCandidateCount: earlyHost.remoteCandidateCount,
          }
        : null,
      terminal: terminalHost
        ? {
            state: terminalHost.state,
            connectionState: terminalHost.connectionState,
            dataChannelState: terminalHost.dataChannelState,
          }
        : null,
      exchange: {
        offerExchanged: latest.exchange?.offerExchanged ?? false,
        answerExchanged: latest.exchange?.answerExchanged ?? false,
      },
      resultStatus: latest.resultStatus ?? "unknown",
    };
  })
  .sort((left, right) => left.browserName.localeCompare(right.browserName));

const summary = {
  generatedAt: new Date().toISOString(),
  reportPath: REPORT_PATH,
  attachmentsFound: attachments.length,
  browsers,
};

writeFileSync(OUTPUT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[summarize-webrtc-handshake] wrote ${OUTPUT_PATH}`);

console.log("\nPer-browser handshake classification (SDP/ICE evidence):");
console.log(
  "| Browser | Host outcome | Client outcome | Early (host) | Terminal (host) | Local cands | Offer/Answer |",
);
console.log(
  "| --- | --- | --- | --- | --- | --- | --- |",
);
for (const browser of browsers) {
  const evidence = browser.evidence;
  console.log(
    `| ${browser.browserName} | ${browser.classification.host} | ${browser.classification.client} | ` +
      `${browser.classification.hostEarly} | ${browser.terminal?.state ?? "—"}/${browser.terminal?.connectionState ?? "—"} | ` +
      `${evidence?.localCandidateCount ?? "—"} | ${browser.exchange.offerExchanged ? "offer" : "—"}/${browser.exchange.answerExchanged ? "answer" : "—"} |`,
  );
}

if (attachments.length === 0) {
  console.warn(
    "[summarize-webrtc-handshake] no handshake attachments found — run the diagnostic spec first: WEBRTC_HANDSHAKE_DIAGNOSTICS=true npx playwright test --config=playwright.browsers.config.ts tests/e2e/webrtc-handshake-diagnostics.spec.ts",
  );
}
