import { describe, it, expect } from "vitest";
import {
  hexMappedIpv4ToDotted,
  normalizeIpv4,
  isPrivateIpv4,
  isLoopbackHost,
  isPrivateIpv6Host,
  isPrivateHost,
} from "../../utils/ipSecurity";

describe("hexMappedIpv4ToDotted", () => {
  it("converts valid hex tail to dotted quad", () => {
    expect(hexMappedIpv4ToDotted("a00:1")).toBe("10.0.0.1");
    expect(hexMappedIpv4ToDotted("7f00:1")).toBe("127.0.0.1");
    expect(hexMappedIpv4ToDotted("c0a8:1")).toBe("192.168.0.1");
  });

  it("returns null for invalid input", () => {
    expect(hexMappedIpv4ToDotted("nothex")).toBeNull();
    expect(hexMappedIpv4ToDotted("abcd")).toBeNull();
    expect(hexMappedIpv4ToDotted("")).toBeNull();
    expect(hexMappedIpv4ToDotted("a00")).toBeNull();
    expect(hexMappedIpv4ToDotted("a00:1:2")).toBeNull();
    expect(hexMappedIpv4ToDotted("zz:yy")).toBeNull();
  });
});

describe("normalizeIpv4", () => {
  it("returns host unchanged for non-IP hostnames", () => {
    expect(normalizeIpv4("example.com")).toBe("example.com");
    expect(normalizeIpv4("localhost")).toBe("localhost");
  });

  it("strips embedded credentials", () => {
    expect(normalizeIpv4("user:pass@127.0.0.1")).toBe("127.0.0.1");
  });

  it("normalizes hex octets", () => {
    expect(normalizeIpv4("0x7f.0x0.0x0.0x1")).toBe("127.0.0.1");
    expect(normalizeIpv4("0x0.0x0.0x0.0x0")).toBe("0.0.0.0");
  });

  it("normalizes octal octets", () => {
    expect(normalizeIpv4("0177.0.0.1")).toBe("127.0.0.1");
  });

  it("normalizes short forms", () => {
    expect(normalizeIpv4("127.1")).toBe("127.0.0.1");
    expect(normalizeIpv4("127.0.1")).toBe("127.0.0.1");
    expect(normalizeIpv4("10.1")).toBe("10.0.0.1");
    expect(normalizeIpv4("192.168.1")).toBe("192.168.0.1");
  });

  it("normalizes bare integers", () => {
    expect(normalizeIpv4("2130706433")).toBe("127.0.0.1");
    expect(normalizeIpv4("0")).toBe("0.0.0.0");
    expect(normalizeIpv4("4294967295")).toBe("255.255.255.255");
  });

  it("normalizes hex bare integers", () => {
    expect(normalizeIpv4("0x7f000001")).toBe("127.0.0.1");
  });

  it("normalizes octal bare integers", () => {
    expect(normalizeIpv4("017700000001")).toBe("127.0.0.1");
  });

  it("returns original host for invalid mixed input", () => {
    expect(normalizeIpv4("not.an.ip")).toBe("not.an.ip");
    expect(normalizeIpv4("a.not.1.1")).toBe("a.not.1.1");
    expect(normalizeIpv4("256.256.256.256")).toBe("256.256.256.256");
    expect(normalizeIpv4("256.1")).toBe("256.1");
    expect(normalizeIpv4("1.2.3.999")).toBe("1.2.3.999");
    expect(normalizeIpv4("4294967296")).toBe("4294967296");
  });
});

describe("isPrivateIpv4", () => {
  it("detects exact loopback and zeros", () => {
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("0.0.0.0")).toBe(true);
    expect(isPrivateIpv4("255.255.255.255")).toBe(true);
  });

  it("detects RFC 1918 ranges", () => {
    expect(isPrivateIpv4("10.0.0.1")).toBe(true);
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("192.168.1.1")).toBe(true);
  });

  it("detects link-local and CGNAT", () => {
    expect(isPrivateIpv4("169.254.1.1")).toBe(true);
    expect(isPrivateIpv4("100.64.0.1")).toBe(true);
  });

  it("detects TEST-NET and IETF ranges", () => {
    expect(isPrivateIpv4("192.0.0.1")).toBe(true);
    expect(isPrivateIpv4("192.0.2.1")).toBe(true);
    expect(isPrivateIpv4("198.18.0.1")).toBe(true);
    expect(isPrivateIpv4("198.51.100.1")).toBe(true);
    expect(isPrivateIpv4("203.0.113.1")).toBe(true);
  });

  it("detects multicast and reserved", () => {
    expect(isPrivateIpv4("224.0.0.1")).toBe(true);
    expect(isPrivateIpv4("239.255.255.255")).toBe(true);
    expect(isPrivateIpv4("240.0.0.1")).toBe(true);
    expect(isPrivateIpv4("255.255.255.254")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("1.1.1.1")).toBe(false);
    expect(isPrivateIpv4("93.184.216.34")).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("detects plain localhost", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
  });

  it("detects trailing-dot FQDN", () => {
    expect(isLoopbackHost("localhost.")).toBe(true);
  });

  it("detects IPv6 loopback", () => {
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0:0:0:0:0:0:0:1")).toBe(true);
    expect(isLoopbackHost("::")).toBe(true);
  });

  it("detects IPv4-mapped IPv6", () => {
    expect(isLoopbackHost("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::ffff:7f00:1")).toBe(true);
    expect(isLoopbackHost("[::ffff:127.0.0.1]")).toBe(true);
  });

  it("rejects an unparseable mapped IPv6 loopback tail", () => {
    expect(isLoopbackHost("::ffff:not-an-ip")).toBe(false);
  });

  it("detects numeric IPv4 forms", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.1")).toBe(true);
    expect(isLoopbackHost("0x7f000001")).toBe(true);
    expect(isLoopbackHost("0177.0.0.1")).toBe(true);
    expect(isLoopbackHost("2130706433")).toBe(true);
  });

  it("rejects non-loopback hosts", () => {
    expect(isLoopbackHost("example.com")).toBe(false);
    expect(isLoopbackHost("8.8.8.8")).toBe(false);
    expect(isLoopbackHost("[::2]")).toBe(false);
  });
});

describe("isPrivateIpv6Host", () => {
  it("detects loopback and unspecified", () => {
    expect(isPrivateIpv6Host("::1")).toBe(true);
    expect(isPrivateIpv6Host("::")).toBe(true);
  });

  it("detects ULA ranges", () => {
    expect(isPrivateIpv6Host("fc00::1")).toBe(true);
    expect(isPrivateIpv6Host("fd00::1")).toBe(true);
  });

  it("detects link-local and site-local", () => {
    expect(isPrivateIpv6Host("fe80::1")).toBe(true);
    expect(isPrivateIpv6Host("fec0::1")).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isPrivateIpv6Host("2001:db8::1")).toBe(false);
    expect(isPrivateIpv6Host("2606:4700:4700::1111")).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it("detects localhost", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("LOCALHOST")).toBe(true);
  });

  it("detects IPv4 private hosts", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.0.0.1")).toBe(true);
    expect(isPrivateHost("192.168.1.1")).toBe(true);
  });

  it("detects IPv6 private hosts", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("fc00::1")).toBe(true);
    expect(isPrivateHost("fe80::1")).toBe(true);
  });

  it("detects IPv4-mapped IPv6 private hosts", () => {
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("::ffff:7f00:1")).toBe(true);
  });

  it("fails closed for an unparseable mapped IPv6 host", () => {
    expect(isPrivateHost("::ffff:not-an-ip")).toBe(true);
  });

  it("allows public hosts", () => {
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
    expect(isPrivateHost("[2001:db8::1]")).toBe(false);
  });
});
