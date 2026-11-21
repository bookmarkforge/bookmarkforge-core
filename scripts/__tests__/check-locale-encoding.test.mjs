/**
 * scripts/__tests__/check-locale-encoding.test.mjs
 *
 * Contract pins for the locale payload encoding gate.
 *
 * The 2026-11-01 audit found two lossy passes over all 60 payload files. The
 * first swept every non-ASCII character into CP1252 mojibake (still valid
 * UTF-8, so no tool complained), the second replaced the remaining
 * undecodable bytes with U+FFFD. `i18n-completeness`, `check-i18n-quality`
 * and `check-code-i18n` stayed green throughout, because every one of them
 * compares STRUCTURE and none inspects the bytes.
 *
 * These tests pin both halves of the replacement: the gate must fail on each
 * of the three signatures, and it must not over-reject reviewed copy
 * (accents, RTL, CJK, emoji, multi-line strings) that fills the real files.
 *
 * Mojibake fixtures are BUILT, never pasted: a pasted mojibake literal is a
 * different string every time an editor touches the file, which is exactly
 * the class of accident this gate exists to catch.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CORRUPTION_RE,
  LOCALE_STORES,
  checkFile,
  findCorruption,
  isMojibake,
  toCp1252Bytes,
} from "../check-locale-encoding.mjs";

const roots = [];
afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop(), { recursive: true, force: true });
  }
});

/** Writes one fixture file with exact bytes and returns its path. */
function fixture(name, contents) {
  const root = mkdtempSync(join(tmpdir(), "bmf-locale-encoding-"));
  roots.push(root);
  const file = join(root, name);
  writeFileSync(file, contents);
  return file;
}

/**
 * Reproduces the corrupting pass: UTF-8 bytes read as CP1252. Feeding it clean
 * copy yields exactly the strings the real files carried.
 */
function corrupt(text) {
  return new TextDecoder("windows-1252").decode(new TextEncoder().encode(text));
}

describe("check-locale-encoding — detection", () => {
  it("flags a replacement character inside a value", () => {
    const findings = findCorruption({ app_semanticSearch: "La b\uFFFDsqueda sem\uFFFDntica" });
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe("app_semanticSearch");
    expect(findings[0].codePoint).toBe(0xfffd);
    expect(findings[0].kind).toBe("replacement");
  });

  it("flags a C1 control left by a latin-1 round-trip", () => {
    const findings = findCorruption({ a: { b: "الك\u0081تاب على هذا ال\u008fجهاز" } });
    expect(findings.map((finding) => finding.key)).toEqual(["a.b"]);
    expect(findings[0].codePoint).toBe(0x81);
    expect(findings[0].kind).toBe("control");
  });

  it("flags a corrupted key name, not only its value", () => {
    const findings = findCorruption({ "bad\uFFFDkey": "ok" });
    expect(findings.map((finding) => finding.key)).toEqual(["bad\uFFFDkey (key name)"]);
  });

  it("reports one finding per string, even with several bad code points", () => {
    expect(findCorruption({ a: "\uFFFD\uFFFD\uFFFD" })).toHaveLength(1);
  });

  it("accepts reviewed copy in every script the app ships", () => {
    for (const value of ["según", "Überschrift", "Ελληνικά", "עברית", "日本語", "한국어", "私密", "🚀"]) {
      expect(CORRUPTION_RE.test(value), `${value} was over-rejected`).toBe(false);
      expect(findCorruption({ key: value })).toEqual([]);
    }
  });

  it("flags every C0 control except the tab and newlines copy legitimately uses", () => {
    for (const bad of ["\u0000", "\u0001", "\u0007", "\u001f", "\u007f", "\u0085"]) {
      const findings = findCorruption({ a: `antes${bad}después` });
      expect(findings, `U+${bad.codePointAt(0).toString(16)} slipped through`).toHaveLength(1);
      expect(findings[0].kind).toBe("control");
    }
    for (const allowed of ["linea\nlinea", "col\tcol", "win\r\nwin"]) {
      expect(findCorruption({ a: allowed }), `${JSON.stringify(allowed)} was over-rejected`).toEqual([]);
    }
  });

  it("flags CP1252 mojibake that is still valid UTF-8", () => {
    for (const clean of ["건너뛰려면 Esc를 누르세요.", "— your data stays", "Привет"]) {
      const damaged = corrupt(clean);
      expect(damaged, `${clean} did not round-trip into mojibake`).not.toBe(clean);
      expect(isMojibake(damaged), `${clean} was not detected`).toBe(true);
      expect(findCorruption({ key: damaged }).map((finding) => finding.kind)).toEqual(["mojibake"]);
    }
  });

  it("flags CJK mojibake through the C1 byte CP1252 leaves undefined", () => {
    // 0x81 is one of the five bytes CP1252 does not define, so the damaged
    // string holds a C1 control instead of a character. Caught, but by the
    // control scan rather than the round-trip one.
    const damaged = corrupt("私密");
    expect(damaged).toContain("\u0081");
    expect(findCorruption({ key: damaged }).map((finding) => finding.kind)).toEqual(["control"]);
  });

  it("does not mistake reviewed accents for mojibake", () => {
    // Their CP1252 bytes are not valid UTF-8, which is exactly the tell.
    for (const value of [
      "La búsqueda semántica",
      "Überschrift 1",
      "узгоджено",
      "café — naïve",
      "日本語のテキスト",
    ]) {
      expect(isMojibake(value), `${value} was over-rejected`).toBe(false);
      expect(findCorruption({ key: value })).toEqual([]);
    }
  });

  it("flags the scars of an ad-hoc repair, where a symbol replaced a byte", () => {
    const scarred = [
      "\u00C5\u00BE", // "Å¾" for a Czech caron
      "\u00C4\u2020", // "Ä†" for a Polish accent
      "\u00C3\u2B50\u20AC\u0161", // "Ã⭐€š" — a star substituted for "â"
      "\u00C3\u00AF\u00C2\u00BF\u00C2\u00BD", // "Ã¯Â¿Â½" — a mojibaked U+FFFD
      "\u0112", // "Ē" for a Romanian breve
    ];
    for (const value of scarred) {
      expect(findCorruption({ key: value }), `${JSON.stringify(value)} slipped through`).toHaveLength(1);
    }
  });

  it("reports the CP1252 byte form it could not encode", () => {
    expect(toCp1252Bytes("ok")).toEqual(Uint8Array.from([0x6f, 0x6b]));
    expect(toCp1252Bytes("\u2014")).toEqual(Uint8Array.from([0x97]));
    expect(toCp1252Bytes("私密")).toBeNull();
  });
});

describe("check-locale-encoding — file statuses", () => {
  it("passes a clean payload", () => {
    const file = fixture("es.json", JSON.stringify({ app_search: "La búsqueda semántica" }));
    expect(checkFile(file)).toEqual({ file, status: "ok", findings: [] });
  });

  it("fails closed on bytes that are not UTF-8", () => {
    // "según" written as latin-1: 0xFA is not a valid UTF-8 lead byte.
    const file = fixture("es.json", Buffer.concat([
      Buffer.from('{"app_search":"seg'),
      Buffer.from([0xfa]),
      Buffer.from('n"}'),
    ]));
    expect(checkFile(file).status).toBe("encoding");
  });

  it("fails closed on a payload that no longer parses", () => {
    expect(checkFile(fixture("es.json", '{"a": "unterminated')).status).toBe("json");
  });

  it("reports the corrupted file as corrupt, not as clean", () => {
    const file = fixture("de.json", JSON.stringify({ editor_slash_h1: "\uFFFDSberschrift 1" }));
    const result = checkFile(file);
    expect(result.status).toBe("corrupt");
    expect(result.findings).toHaveLength(1);
  });

  it("catches a payload that is valid UTF-8 and valid JSON but mojibake", () => {
    // The failure mode a U+FFFD sweep cannot see: the bytes are fine, the text
    // is not. This shipped for two months without a red gate.
    const file = fixture("ko.json", JSON.stringify({ tour_escToSkip: corrupt("건너뛰려면 Esc를 누르세요.") }));
    const result = checkFile(file);
    expect(result.status).toBe("corrupt");
    expect(result.findings[0].kind).toBe("mojibake");
  });
});

describe("check-locale-encoding — the shipped stores", () => {
  it("every locale payload in the repository is strict UTF-8 with no corruption", () => {
    let scanned = 0;
    for (const store of LOCALE_STORES) {
      for (const name of readdirSync(store).filter((entry) => entry.endsWith(".json"))) {
        const result = checkFile(join(store, name));
        expect(
          result.status,
          `${store}/${name}: ${result.findings.map((finding) => `${finding.key} (${finding.kind})`).join(", ")}`,
        ).toBe("ok");
        scanned += 1;
      }
    }
    // Guard against a vacuous pass (e.g. a store moved or renamed).
    expect(scanned).toBeGreaterThanOrEqual(LOCALE_STORES.length * 20);
  });
});
