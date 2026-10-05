import { describe, expect, it } from "vitest";
import {
  scanServerLogIpPrivacy,
  scanServerLogIpPrivacyText,
} from "../check-server-log-ip-privacy.mjs";

describe("check-server-log-ip-privacy", () => {
  it("passes the current server source", () => {
    expect(scanServerLogIpPrivacy(["server/src"])).toEqual([]);
  });

  it("detects raw IP fields in structured log payloads", () => {
    const source = `console.error(JSON.stringify({ event: "x", ip: clientIp }));`;
    expect(scanServerLogIpPrivacyText(source)).toHaveLength(1);
  });

  it("allows anonymized IP hash fields", () => {
    const source = `console.error(JSON.stringify({ event: "x", ipHash }));`;
    expect(scanServerLogIpPrivacyText(source)).toEqual([]);
  });

  it("does not reject internal clientIp variables outside log payloads", () => {
    const source = `const clientIp = readAddress(req);\nreturn clientIp;`;
    expect(scanServerLogIpPrivacyText(source)).toEqual([]);
  });
});
