import { describe, it, expect, vi } from "vitest";
import LZString from "lz-string";
import {
  minimizeSDP,
  encodeLocalDescription,
  parseEncodedPayload,
} from "../../../services/webrtc-sync/sdp-codec";
import { MAX_DESCRIPTION_ENCODED_CHARS } from "../../../services/webrtc-sync/protocol";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const FULL_SDP = [
  "v=0",
  "o=- 4611733050430660857 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=mid:0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "a=mid:1",
  "a=setup:actpass",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=ice-ufrag:someufrag",
  "a=ice-pwd:somepasswordpasswordpassword",
  "a=candidate:1 1 UDP 2130706431 192.168.1.10 51234 typ host",
  "a=candidate:2 1 UDP 1694498815 203.0.113.5 51234 typ srflx raddr 192.168.1.10 rport 51234",
  "a=candidate:3 1 UDP 16777215 198.51.100.7 51234 typ relay raddr 192.168.1.10 rport 51234",
  "",
].join("\r\n");

describe("minimizeSDP", () => {
  it("keeps session, application m-line and ICE credentials", () => {
    const out = minimizeSDP(FULL_SDP);
    expect(out).toContain("v=0\r\n");
    expect(out).toContain("m=application");
    expect(out).toContain("a=fingerprint:sha-256");
    expect(out).toContain("a=ice-ufrag:someufrag");
    expect(out).toContain("a=ice-pwd:somepasswordpasswordpassword");
    expect(out.endsWith("\r\n")).toBe(true);
  });

  it("drops media m-lines and their attributes", () => {
    const out = minimizeSDP(FULL_SDP);
    expect(out).not.toContain("m=audio");
    expect(out).not.toContain("a=rtpmap");
  });

  it("keeps only host candidates (privacy: no srflx/relay)", () => {
    const out = minimizeSDP(FULL_SDP);
    expect(out).toContain("typ host");
    expect(out).not.toContain("typ srflx");
    expect(out).not.toContain("typ relay");
  });
});

describe("encodeLocalDescription / parseEncodedPayload", () => {
  it("round-trips an offer description", () => {
    const encoded = encodeLocalDescription(
      { type: "offer", sdp: FULL_SDP },
      null,
    );
    expect(encoded.length).toBeGreaterThan(0);
    const parsed = parseEncodedPayload(encoded);
    expect(parsed.pairMalformed).toBe(false);
    expect(parsed.pair).toBeNull();
    expect(parsed.description?.type).toBe("offer");
    expect(parsed.description?.sdp).toContain("m=application");
    expect(parsed.description?.sdp).not.toContain("m=audio");
  });

  it("round-trips valid pairing metadata", () => {
    const pair = { v: 1 as const, m: "verify" as const, s: "a".repeat(32) };
    const encoded = encodeLocalDescription(
      { type: "offer", sdp: FULL_SDP },
      pair,
    );
    const parsed = parseEncodedPayload(encoded);
    expect(parsed.pairMalformed).toBe(false);
    expect(parsed.pair).toEqual(pair);
  });

  it("flags a present-but-malformed pair field instead of dropping it silently", () => {
    // Craft a payload whose `pair` fails the v1 contract.
    const desc = {
      type: "offer",
      sdp: minimizeSDP(FULL_SDP),
      pair: { v: 2, m: "verify", s: "a".repeat(32) },
    };
    const encoded = LZString.compressToEncodedURIComponent(
      JSON.stringify(desc),
    );
    const parsed = parseEncodedPayload(encoded);
    expect(parsed.description).not.toBeNull();
    expect(parsed.pair).toBeNull();
    expect(parsed.pairMalformed).toBe(true);
  });

  it("returns null description for garbage, oversized and empty input", () => {
    expect(parseEncodedPayload("").description).toBeNull();
    expect(parseEncodedPayload("!!!not-valid!!!").description).toBeNull();
    expect(
      parseEncodedPayload("x".repeat(MAX_DESCRIPTION_ENCODED_CHARS + 1))
        .description,
    ).toBeNull();
  });

  it("encodeLocalDescription refuses an invalid description", () => {
    expect(
      encodeLocalDescription({ type: "bogus", sdp: FULL_SDP }, null),
    ).toBe("");
    expect(
      encodeLocalDescription({ type: "offer", sdp: "" }, null),
    ).toBe("");
  });
});
