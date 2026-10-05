/**
 * ipSecurity.ts — Shared hostname/IP classification primitives.
 *
 * These helpers are the single source of truth for hostname/IP parsing and
 * private/loopback range classification across the SSRF defense chain:
 *   - SanitizationService.sanitizeUrl        (gate 1: URL validation)
 *   - MetadataService.isUrlAllowed           (gate 2: fetch-time re-validation)
 *   - networkFirewall isAlwaysAllowed/isLocalOrigin (gate 3: allow/proxy logic)
 *
 * Historically this logic lived in three copies with "keep in sync" notes,
 * which let bypasses drift between layers (fixed in P76-P79). Centralizing
 * here means a fix applies everywhere at once. Keep the exported semantics
 * stable — the fuzz corpus in SanitizationService.test.ts and the loopback
 * suite in networkFirewall.test.ts lock the behavior.
 */

/**
 * Converts a hex-form IPv4-mapped tail (e.g. "a00:1" for ::ffff:10.0.0.1)
 * into dotted-quad notation. Returns null when the tail is not two hex
 * groups. (Node/browsers normalize ::ffff:10.0.0.1 to ::ffff:a00:1, so the
 * naive dotted check alone misses mapped private ranges.)
 */
export function hexMappedIpv4ToDotted(tail: string): string | null {
  const groups = tail.split(":");
  if (groups.length !== 2) {return null;}
  const hi = Number.parseInt(groups[0]!, 16);
  const lo = Number.parseInt(groups[1]!, 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) {return null;}
  return [
    (hi >> 8) & 0xff,
    hi & 0xff,
    (lo >> 8) & 0xff,
    lo & 0xff,
  ].join(".");
}

/**
 * Normalizes non-dotted-decimal IPv4 hostnames (hex 0x7f000001, octal
 * 0177.0.0.1, bare integer 2130706433, short forms 127.1 / 127.0.1, or
 * embedded credentials) to dotted-decimal so private-range checks cannot be
 * bypassed. Non-IP hostnames are returned unchanged.
 */
export function normalizeIpv4(host: string): string {
  const credStripped = host.replace(/^[^@]*@/, "");
  if (!/^(\d|[1-9a-f])/i.test(credStripped)) {return host;}
  const parts = credStripped.split(".");
  if (parts.length < 1 || parts.length > 4) {return host;}

  const nums = parts.map((p) => {
    if (/^0x[0-9a-f]+$/i.test(p)) {return parseInt(p, 16);}
    if (/^0[0-7]+$/.test(p)) {return parseInt(p, 8);}
    if (/^\d+$/.test(p)) {return parseInt(p, 10);}
    return NaN;
  });
  if (nums.some((n) => Number.isNaN(n))) {return host;}

  if (parts.length === 1) {
    // Bare integer / hex / octal form (e.g. 2130706433, 0x7f000001)
    const n = nums[0]!;
    if (n < 0 || n > 0xffffffff) {return host;}
    return [
      (n >>> 24) & 255,
      (n >>> 16) & 255,
      (n >>> 8) & 255,
      n & 255,
    ].join(".");
  }

  // Short/dotted forms: all parts except the last are octets (0-255);
  // the last part may span the remaining bits (127.1 → 127.0.0.1,
  // 127.0.1 → 127.0.0.1, 0x7f.1 → 127.0.0.1).
  const leading = nums.slice(0, -1);
  if (leading.some((n) => n < 0 || n > 255)) {return host;}
  const last = nums[nums.length - 1]!;
  const remainingBits = 8 * (4 - leading.length);
  if (last < 0 || last >= 2 ** remainingBits) {return host;}

  let value = last;
  for (let i = 0; i < leading.length; i++) {
    value |= leading[i]! << (8 * (3 - i));
  }
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

/**
 * True when a dotted-decimal IPv4 host falls in a private or special-use
 * range that must never be fetched from a public client (RFC 1918,
 * loopback /8, link-local, CGNAT, TEST-NET, multicast, reserved).
 */
export function isPrivateIpv4(ip: string): boolean {
  const exact = ["127.0.0.1", "0.0.0.0", "255.255.255.255"];
  if (exact.includes(ip)) {return true;}
  const ranges = [
    /^0\./, // 0.0.0.0/8 "this network"
    /^10\./, // 10.0.0.0/8
    /^127\./, // 127.0.0.0/8 loopback
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^169\.254\./, // 169.254.0.0/16 link-local
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
    /^192\.0\.0\./, // 192.0.0.0/24 IETF protocol assignments
    // NOTE: also covers 192.0.0.9/.10 (anycast DNS) — intentional, per
    // OWASP SSRF guidance to block the whole special-use /24.
    /^192\.0\.2\./, // 192.0.2.0/24 TEST-NET-1
    /^198\.18\./, // 198.18.0.0/15 benchmarking
    /^198\.51\.100\./, // 198.51.100.0/24 TEST-NET-2
    /^203\.0\.113\./, // 203.0.113.0/24 TEST-NET-3
    /^2(2[4-9]|3[0-9])\./, // 224.0.0.0/4 multicast (224–239)
    /^2(4[0-9]|5[0-5])\./, // 240.0.0.0/4 reserved (240–255)
  ];
  return ranges.some((range) => range.test(ip));
}

/**
 * True when a hostname is a loopback address, including obfuscated forms:
 * trailing-dot FQDN ("localhost."), WHATWG-normalized short forms ("127.1"),
 * hex/octal/integer forms ("0x7f000001"), bracketed IPv6 ("[::1]"),
 * full-form IPv6 ("0:0:0:0:0:0:0:1"), and IPv4-mapped IPv6
 * ("::ffff:7f00:1" / "[::ffff:127.0.0.1]"). Used by networkFirewall for
 * allow-loopback and proxy-vs-direct decisions (Ollama at localhost:11434).
 */
export function isLoopbackHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  // Trailing dot (FQDN root): "localhost." is DNS-equivalent to "localhost".
  if (host.endsWith(".")) {host = host.slice(0, -1);}
  // URL.hostname keeps IPv6 brackets — strip them.
  if (host.startsWith("[") && host.endsWith("]")) {host = host.slice(1, -1);}

  if (host === "localhost" || host === "::1" || host === "::") {return true;}
  // Full-form IPv6 loopback / unspecified (parser usually compresses these).
  if (/^0(:0){6}:1$/.test(host) || /^0(:0){7}$/.test(host)) {return true;}

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:7f00:1 hex tail)
  if (host.startsWith("::ffff:")) {
    const tail = host.slice("::ffff:".length);
    if (tail.includes(".")) {return isLoopbackHost(tail);}
    const dotted = hexMappedIpv4ToDotted(tail);
    if (dotted) {return isLoopbackHost(dotted);}
    return false;
  }

  // Numeric IPv4 forms: dotted (hex/octal/decimal octets), short forms
  // ("127.1"), or bare integers ("2130706433"). Normalize to a dotted quad
  // and check the 127/8 loopback range. A host with letters (e.g.
  // "127.0.0.1.evil.com") is not numeric and falls through to false.
  const normalized = normalizeIpv4(host);
  const parts = normalized.split(".");
  if (parts.length !== 4) {return false;}
  if (parts.some((p) => !/^\d+$/.test(p) || Number(p) > 255)) {return false;}
  return Number(parts[0]) === 127;
}

const IPV6_PRIVATE_RANGES = [
  // Reserved 0::/8 (covers ::1, :: and the full 0:0:...:1 form). Textual
  // approximation: only matches hextets that literally start with "0";
  // compressed forms like "fc::1" (00fc::) are not detected — pre-existing,
  // and 0::/8 has no routable addresses (low risk).
  /^0:/,
  /^fc[0-9a-f]{2}:/, // ULA fc00::/8
  /^fd[0-9a-f]{2}:/, // ULA fd00::/8
  /^fe[89ab][0-9a-f]?:/, // Link-local fe80::/10
  /^fe[c-f][0-9a-f]?:/, // Site-local fec0::/10 (deprecated)
] as const;

/**
 * True when a (bracket-stripped, lowercased) IPv6 hostname falls in a
 * private or special-use range: reserved 0::/8, ULA, link-local or
 * site-local. Single source of truth shared by {@link isPrivateHost} and
 * SanitizationService.sanitizeUrl — keep the two gates on ONE range list so
 * a range edit cannot drift between them (the P81 differential fuzz asserts
 * gate equivalence on this corpus).
 */
export function isPrivateIpv6Host(bare: string): boolean {
  if (bare === "::1" || bare === "::") {return true;}
  return IPV6_PRIVATE_RANGES.some((range) => range.test(bare));
}

/**
 * True when a hostname resolves to a private or special-use address (IPv4
 * or IPv6, any obfuscated form): RFC 1918, loopback /8, link-local,
 * CGNAT, TEST-NET, multicast, reserved, IPv6 ULA/link-local/site-local,
 * and IPv4-mapped IPv6. Used by MetadataService as the fetch-time gate.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  // Trailing dot (FQDN root) and IPv6 brackets — strip before any checks.
  const bare = host.endsWith(".")
    ? host.slice(0, -1)
    : host.startsWith("[") && host.endsWith("]")
      ? host.slice(1, -1)
      : host;

  if (bare === "localhost") {return true;}

  if (bare.includes(":")) {
    if (isPrivateIpv6Host(bare)) {return true;}
    if (bare.startsWith("::ffff:")) {
      // IPv4-mapped IPv6 — check the embedded IPv4 (dotted or hex form)
      const tail = bare.slice("::ffff:".length);
      if (tail.includes(".")) {return isPrivateHost(tail);}
      const dotted = hexMappedIpv4ToDotted(tail);
      if (dotted) {return isPrivateHost(dotted);}
      // Unparseable mapped address — block conservatively (SSRF guard)
      return true;
    }
    return false;
  }

  // IPv4 — normalize obfuscated forms (defense-in-depth; the WHATWG parser
  // usually already normalized them), then apply the special-use ranges.
  // `\d+` (not `\d{1,3}`) keeps exact parity with the pre-refactor
  // MetadataService.isPrivateIP, which blocked private-range hosts with
  // over-wide octets (e.g. 10.1.1.4444).
  const normalized = normalizeIpv4(bare);
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) {return false;}
  return isPrivateIpv4(normalized);
}
