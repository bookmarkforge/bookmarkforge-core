/**
 * ssrfCorpus.ts — Shared deterministic corpus for differential fuzzing of the
 * SSRF chain (P81: sanitizeUrl/isPrivateHost gates; P82: firewall/gate 3).
 * Living in one place keeps each gate's tests from drifting apart over time.
 *
 * Includes: IPv4 bases for private/special/public-boundary ranges plus every
 * browser-style obfuscation form (dotted, trailing-dot, short, integer, hex,
 * case-mixed hex), IPv6 hosts (loopback/ULA/link-local/site-local/mapped/
 * global) and special hostnames.
 */

export const ipv4Bases: Array<[number, number, number, number]> = [
  // Privadas / especiales
  [0, 0, 0, 0], [0, 1, 2, 3],
  [10, 0, 0, 1], [10, 255, 255, 255],
  [127, 0, 0, 1], [127, 0, 0, 2], [127, 1, 2, 3], [127, 255, 255, 255],
  [172, 16, 0, 1], [172, 31, 255, 255],
  [192, 168, 1, 1], [192, 168, 255, 255],
  [169, 254, 1, 1], [169, 254, 169, 254],
  [100, 64, 0, 1], [100, 127, 255, 255],
  [192, 0, 0, 9], [192, 0, 2, 1],
  [198, 18, 0, 1], [198, 51, 100, 1],
  [203, 0, 113, 1],
  [224, 0, 0, 1], [239, 255, 255, 255],
  [240, 0, 0, 1], [255, 255, 255, 255],
  // Public boundaries (must never be blocked)
  [8, 8, 8, 8], [1, 1, 1, 1], [9, 9, 9, 9],
  [172, 15, 0, 1], [172, 32, 0, 1],
  [100, 63, 0, 1], [100, 128, 0, 1],
  [198, 17, 0, 1], [203, 0, 112, 1], [223, 255, 255, 255],
  [192, 0, 1, 1],
];

/**
 * Browser-style forms that resolve to the SAME IPv4 (hex/integer/short
 * round-trip correctly; per-part octal does NOT, which is why it is excluded).
 */
export function ipv4Forms(a: number, b: number, c: number, d: number): string[] {
  const dotted = `${a}.${b}.${c}.${d}`;
  const value = a * 16777216 + b * 65536 + c * 256 + d;
  return [
    dotted,
    `${dotted}.`, // trailing-dot FQDN
    `${a}.${b * 65536 + c * 256 + d}`, // short 2 partes
    `${a}.${b}.${c * 256 + d}`, // short 3 partes
    `${value}`, // entero desnudo
    `0x${value.toString(16)}`, // hex
    `0X${value.toString(16).toUpperCase()}`, // hex case-mixed
  ];
}

export const ipv6UrlHosts: string[] = [
  "[::1]", "[::]", "[0:0:0:0:0:0:0:1]", "[0:0:0:0:0:0:0:0]",
  "[fc00::1]", "[fd12:3456:789a::1]",
  "[fe80::1]", "[fe81::1]", "[fec0::1]", "[fef0::1]",
  "[fc0::1]", // 0fc0:: — reserved 0800::/5 space (NOT ULA fc00::/7);
  // ambos gates lo permiten consistentemente (ninguna regex lo matchea)
  "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:192.168.1.1]",
  "[::ffff:c0a8:101]", "[::ffff:0:0]", "[::ffff:8.8.8.8]",
  "[::ffff:808:808]", // 8.8.8.8 in hex — public hexMappedIpv4ToDotted path
  "[2001:4860:4860::8888]", "[2001:db8::1]",
];

export const hostnameUrls: string[] = [
  "http://localhost/", "http://localhost./", "http://LOCALHOST/",
  "http://user:pass@10.0.0.1/", "http://user@127.0.0.1:8080/",
];

export const allUrls: string[] = [
  ...hostnameUrls,
  ...ipv6UrlHosts.map((h) => `http://${h}/`),
  ...ipv4Bases.flatMap(([a, b, c, d]) =>
    ipv4Forms(a, b, c, d).map((h) => `http://${h}/`),
  ),
];
