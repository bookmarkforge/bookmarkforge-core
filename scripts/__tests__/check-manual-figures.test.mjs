// @vitest-environment node
/**
 * scripts/__tests__/check-manual-figures.test.mjs
 *
 * Adversarial suite for the manual-figures gate (ADR-049). The gate parses
 * canonical values from src/constants/{pricing,license,config}.ts and
 * src/services/RecoveryService.ts, then validates figure claims across the
 * 30 localized manuals. Tests pin:
 *
 *   - truth parsing from realistic source text (missing constant → throw);
 *   - allowed-value derivation, including the derived v3 owner price;
 *   - line rules (prices, devices, caps, recovery, refund, revalidation,
 *     discount) across multilingual phrasing;
 *   - noise immunity (P2P, list markers, v2/v3, years, 100%, AES-GCM);
 *   - a real AGPL-style fire drill: corrupting pricing.ts changes the
 *     allowed set and a stale manual line fails.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allowedValueSets,
  evaluateManual,
  loadTruth,
  MANUAL_LANGS,
  runManualFiguresGate,
} from "../check-manual-figures.mjs";
import { LANDING_CODES } from "../landing-registry.mjs";

let tmpRoot;

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

const PRICING_TS = `
export const PRICING_CONFIG = {
  lifetimeVersioned: {
    upgradeDiscountPct: 60,
    refundDays: 30,
  },
  tiers: [
    { id: "free", price: 0,
      limitations: { maxBookmarks: 1000, maxDevices: 0 } },
    { id: "pro", price: 79, originalPrice: 79, earlyBirdPrice: 59,
      regularPrice: 79, fullPrice: 99, upgradePriceNew: 89,
      upgradePriceOwner: 35,
      limitations: { maxBookmarks: Infinity, maxDevices: 3 } },
  ],
  earlyBird: { caps: { early: 200 } },
};
`;

const LICENSE_TS = `cacheTtlMs: 48 * 60 * 60 * 1000,`;
const RECOVERY_TS = `if (wordCount !== 24) throw`;
const CONFIG_TS = `MIN_PASSWORD_LENGTH: 12,`;

function makeRoot(files = {}) {
  tmpRoot = mkdtempSync(join(tmpdir(), "manual-figures-gate-"));
  const base = {
    "src/constants/pricing.ts": PRICING_TS,
    "src/constants/license.ts": LICENSE_TS,
    "src/services/RecoveryService.ts": RECOVERY_TS,
    "src/constants/config.ts": CONFIG_TS,
    "docs/manual-usuario.md": "nada\n",
  };
  for (const [rel, content] of Object.entries({ ...base, ...files })) {
    const p = join(tmpRoot, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return tmpRoot;
}

function truth(root) {
  return loadTruth(root);
}

function sets(root) {
  return allowedValueSets(truth(root));
}

describe("check-manual-figures: truth parsing", () => {
  it("parses the canonical constants from the real-shaped sources", () => {
    const t = truth(makeRoot());
    expect(t.freeMaxBookmarks).toBe(1000);
    expect(t.freeMaxDevices).toBe(0);
    expect(t.proMaxDevices).toBe(3);
    expect(t.proPrice).toBe(79);
    expect(t.proEarlyBirdPrice).toBe(59);
    expect(t.proRegularPrice).toBe(79);
    expect(t.proFullPrice).toBe(99);
    expect(t.upgradePriceNew).toBe(89);
    expect(t.upgradePriceOwner).toBe(35);
    expect(t.earlyBirdCapEarly).toBe(200);
    expect(t.refundDays).toBe(30);
    expect(t.upgradeDiscountPct).toBe(60);
    expect(t.revalidationHours).toBe(48);
    expect(t.recoveryWords).toBe(24);
    expect(t.minPasswordLength).toBe(12);
  });

  it("throws when a truth constant cannot be parsed (fail closed)", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "manual-figures-gate-"));
    const p = join(tmpRoot, "src", "constants", "pricing.ts");
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "// constant renamed, gate must refuse to guess\n");
    expect(() => loadTruth(tmpRoot)).toThrow(/cannot parse pricing constant/);
  });

  it("derives the v3 owner price from the discount (floor(99 * 0.4) = 39)", () => {
    const s = sets(makeRoot());
    expect(s.prices.has(39)).toBe(true);
    expect(s.prices.has(35)).toBe(true);
    expect(s.prices.has(40)).toBe(false);
  });
});

describe("check-manual-figures: claim rules", () => {
  const s = () =>
    sets(makeRoot({
      // extra manuals so scanManuals-style calls are not needed here
      "docs/manual-usuario-en.md": "nada\n",
    }));

  it("accepts canonical price lines across the ladder (es/en)", () => {
    const allowed = s();
    const src = [
      "| Precio | $0 | $79 (lifetime) | $99 (lifetime) |",
      "**Early Bird:** los primeros 200 compradores pagan $59 (o hasta 2026-12-31). Después $79.",
      "- v2 para nuevos: $89. v2 para v1 owners: $35",
      "- v3 para nuevos: $99. v3 para v1 owners: $39",
      "Early Bird: first 200 buyers pay $59. Regular price is $79.",
    ].join("\n");
    expect(evaluateManual(src, allowed, "m")).toEqual([]);
  });

  it("rejects a non-canonical price", () => {
    const allowed = s();
    const f = evaluateManual("| Precio | $0 | $69 (lifetime) |", allowed, "m");
    expect(f.some((x) => x.includes("price 69"))).toBe(true);
  });

  it("accepts device counts 3 and unlimited/no-cap phrasing, rejects others", () => {
    const allowed = s();
    expect(
      evaluateManual(
        [
          "| Dispositivos | Sin límite (cada dispositivo tiene su bóveda) | Hasta 3 + sincronización P2P |",
          "| Devices | No cap (each device has its own vault) | Up to 3 + P2P sync |",
          "| デバイス | 上限なし | 最大3台、P2P同期 |",
        ].join("\n"),
        allowed,
        "m",
      ),
    ).toEqual([]);
    const bad = evaluateManual("| Devices | Up to 5 devices |", allowed, "m");
    expect(bad.some((x) => x.includes("device count 5"))).toBe(true);
  });

  it("validates the free bookmark cap and rejects other hundreds", () => {
    const allowed = s();
    expect(
      evaluateManual("- **Free:** 1.000 marcadores...\n- Free支持**1,000个书签**", allowed, "m"),
    ).toEqual([]);
    const bad = evaluateManual("- **Free:** 2.000 marcadores", allowed, "m");
    expect(bad.some((x) => x.includes("bookmark cap 2000"))).toBe(true);
  });

  it("detects the EN hyphenated attributive form (24-word recovery phrase)", () => {
    const fails = evaluateManual(
      "we show a 30-word recovery phrase once.\n",
      sets(makeRoot()),
      "hyphen.md",
    );
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("recovery phrase claims 30 words");
  });

  it("rejects a wrong recovery-phrase word count", () => {
    const allowed = s();
    const bad = evaluateManual("2. **Frase de recuperación:** Guarda las 12 palabras.", allowed, "m");
    expect(bad.some((x) => x.includes("claims 12 words"))).toBe(true);
  });

  it("rejects a wrong refund window and a wrong revalidation window", () => {
    const allowed = s();
    const refund = evaluateManual("- **Reembolsos:** 14 días vía Whop.", allowed, "m");
    expect(refund.some((x) => x.includes("refund window claims 14"))).toBe(true);
    const reval = evaluateManual("- Re-validación cada 7 horas cuando hay conexión", allowed, "m");
    expect(reval.some((x) => x.includes("re-validation claims 7 hours"))).toBe(true);
  });

  it("rejects a wrong discount percentage only with discount context", () => {
    const allowed = s();
    const bad = evaluateManual("- Los dueños de v1 pagan un **30% de descuento**", allowed, "m");
    expect(bad.some((x) => x.includes("discount claims 30%"))).toBe(true);
    // "100% offline" carries no discount context → not a claim
    expect(
      evaluateManual("100%. Todas las funciones funcionan sin conexión.", allowed, "m"),
    ).toEqual([]);
  });

  it("parses prefix percents (Turkish %60) without version-attached artifacts", () => {
    const allowed = s();
    // The real public/tr.html line: "v2 %60 indirimli" is the canonical 60%
    // upgrade discount, but the old (\d+)\s?% scan paired the "2" of "v2"
    // with the percent sign and reported a phantom "2%" claim.
    expect(
      evaluateManual("- v1 için ömür boyu · Güvenlik sonsuza dek · v2 %60 indirimli", allowed, "m"),
    ).toEqual([]);
    const bad = evaluateManual("- v2 %30 indirimli", allowed, "m");
    expect(bad.some((x) => x.includes("discount claims 30%"))).toBe(true);
  });

  it("validates bookmark caps under every locale's noun (30-locale coverage)", () => {
    const allowed = s();
    // A missing noun demoted these cap lines to the early-bird SUPPLY rule:
    // "Early Bird" + the free cap read as "offer supply cap 1000" on 15
    // locales (the public/{ar,bg,…,tr}.html failures this pins).
    const src = [
      "Gratis plan: 1.000 bogmærker. Pro er engangskjøp på $59 Early Bird (deretter $79).",
      "Ücretsiz plan: 1.000 yer imi. Pro tek seferlik satın alma $59 Early Bird (sonra $79).",
      "Darmowy plan: 1 000 zakładek. Pro to jednorazowy zakup za $59 Early Bird (potem $79).",
      "Безплатен план: 1 000 отметки. Pro е еднократно закупуване за $59 Early Bird (после $79).",
      "무료 플랜: 1,000개 북마크. Pro는 일회성 구매 $59 Early Bird (이후 $79).",
      "خطة مجانية: 1,000 إشارة مرجعية. Pro شراء لمرة واحدة بـ $59 طلب مبكر (ثم 79$).",
    ].join("\n");
    expect(evaluateManual(src, allowed, "m")).toEqual([]);
    // …and the cap is still policed under those nouns
    const bad = evaluateManual("Darmowy plan: 3 000 zakładek", allowed, "m");
    expect(bad.some((x) => x.includes("bookmark cap 3000"))).toBe(true);
  });

  it("does not pair an offer keyword with counts from another JSON-LD value", () => {
    const allowed = s();
    // Compacted JSON-LD values are \u0000-joined segments; "Early Bird" in
    // one value must not police a founding-supply count in another.
    const segs = [
      '{ "supplyNote": "Only 500 founding members were ever sold" }',
      '{ "period": "Early Bird (then $79)" }',
    ].join("\u0000");
    expect(evaluateManual(segs, allowed, "m")).toEqual([]);
    // Same content on one line is one claim → still policed
    const merged = evaluateManual(segs.replaceAll("\u0000", " "), allowed, "m");
    expect(merged.some((x) => x.includes("offer supply cap 500"))).toBe(true);
  });

  it("is immune to noise: P2P, list markers, v2/v3, years, AES-GCM", () => {
    const allowed = s();
    const src = [
      "- **Sincronización P2P** entre tus dispositivos sin servidores centrales.",
      "1. Ve a Configuración",
      "2. Haz clic en **\"Get Pro Lifetime\"**",
      "- Los dueños de v1 mantienen v1 funcional para siempre",
      "Los primeros 200 compradores pagan $59 hasta 2026-12-31.",
      "3. Asegúrate de que ambos dispositivos estén en la misma red",
      "La bóveda se cifra con AES-GCM en tu dispositivo.",
    ].join("\n");
    expect(evaluateManual(src, allowed, "m")).toEqual([]);
  });
});

describe("check-manual-figures: fire drill on the real flow", () => {
  it("fails when a manual drifts from the code (stale early-bird price)", () => {
    const root = makeRoot({
      "docs/manual-usuario-en.md":
        "**Early Bird:** first 200 buyers pay $49. Regular price is $79.\n",
    });
    const { failures } = runManualFiguresGate(root);
    expect(failures.some((f) => f.includes("manual-usuario-en.md") && f.includes("price 49"))).toBe(true);
  });

  it("fails when the truth constant moves and manuals no longer match it", () => {
    // The code changes 48h → 7d (168h); the manual still says 48 → must fail.
    const root = makeRoot({
      "src/constants/license.ts": "cacheTtlMs: 168 * 60 * 60 * 1000,",
      "docs/manual-usuario-en.md": "- Re-validation every 48 hours when connected\n",
    });
    const { failures } = runManualFiguresGate(root);
    expect(failures.some((f) => f.includes("re-validation claims 48 hours"))).toBe(true);
  });

  it("reports missing manuals instead of silently shrinking coverage", () => {
    // Build the full 30-manual set, then remove two: the gate must demand the
    // complete family, not silently shrink coverage to what happens to exist.
    const root = makeRoot(
      Object.fromEntries(
        MANUAL_LANGS.filter(Boolean).map((lang) => [
          `docs/manual-usuario${lang}.md`,
          "nada\n",
        ]),
      ),
    );
    rmSync(join(root, "docs", "manual-usuario-zh.md"), { force: true });
    rmSync(join(root, "docs", "manual-usuario-ja.md"), { force: true });
    const { missing } = runManualFiguresGate(root);
    expect(missing).toHaveLength(2);
    expect(missing.join(" ")).toContain("manual-usuario-zh.md");
  });
});

describe("check-manual-figures: coverage comes from the locale registry", () => {
  it("derives MANUAL_LANGS from the registry (es is the master, others are suffixed)", () => {
    // The mapping is positional, not a copy: "es" owns docs/manual-usuario.md
    // (the only manual with the full pricing chapter), every other locale owns
    // docs/manual-usuario-<code>.md. Pinning the derivation means the list can
    // never fall behind the locale set again — the failure mode that left this
    // gate validating a shrinking corpus while the pages grew.
    expect(MANUAL_LANGS).toEqual([
      "",
      ...LANDING_CODES.filter((code) => code !== "es").map((code) => `-${code}`),
    ]);
    // 1:1 with the registry: no locale unpoliced, no manual demanded twice.
    expect(MANUAL_LANGS).toHaveLength(LANDING_CODES.length);
    expect(new Set(MANUAL_LANGS).size).toBe(LANDING_CODES.length);
  });

  it("demands the manual of every registry locale (a new locale cannot go unpoliced)", () => {
    // Master present, no localized manual: the gate must ask for exactly the
    // registry's remaining locales — not for a hardcoded subset that happens to
    // match today (and would silently stay at 6 if the registry moved).
    const root = makeRoot({});
    const { missing } = runManualFiguresGate(root);
    expect(missing).toHaveLength(LANDING_CODES.length - 1);
    for (const code of LANDING_CODES) {
      if (code === "es") continue;
      expect(missing.join("\n"), `missing manual for ${code}`).toContain(
        `manual-usuario-${code}.md`,
      );
    }
  });
});
