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
  MANUAL_SOURCE_PATHS,
  runManualFiguresGate,
} from "../check-manual-figures.mjs";
import { LANDING_CODES, MANUAL_FILES, manualSourcePath } from "../landing-registry.mjs";

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
    [manualSourcePath("es")]: "nada\n",
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
      [manualSourcePath("en")]: "nada\n",
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
      [manualSourcePath("en")]:
        "**Early Bird:** first 200 buyers pay $49. Regular price is $79.\n",
    });
    const { failures } = runManualFiguresGate(root);
    expect(failures.some((f) => f.includes(`${MANUAL_FILES.en}.md`) && f.includes("price 49"))).toBe(true);
  });

  it("fails when the truth constant moves and manuals no longer match it", () => {
    // The code changes 48h → 7d (168h); the manual still says 48 → must fail.
    const root = makeRoot({
      "src/constants/license.ts": "cacheTtlMs: 168 * 60 * 60 * 1000,",
      [manualSourcePath("en")]: "- Re-validation every 48 hours when connected\n",
    });
    const { failures } = runManualFiguresGate(root);
    expect(failures.some((f) => f.includes("re-validation claims 48 hours"))).toBe(true);
  });

  it("reports missing manuals instead of silently shrinking coverage", () => {
    // Build the full 30-manual set, then remove two: the gate must demand the
    // complete family, not silently shrink coverage to what happens to exist.
    const root = makeRoot(
      Object.fromEntries(
        LANDING_CODES.map((code) => [manualSourcePath(code), "nada\n"]),
      ),
    );
    rmSync(join(root, "docs", `${MANUAL_FILES.zh}.md`), { force: true });
    rmSync(join(root, "docs", `${MANUAL_FILES.ja}.md`), { force: true });
    const { missing } = runManualFiguresGate(root);
    expect(missing).toHaveLength(2);
    expect(missing.join(" ")).toContain(`${MANUAL_FILES.zh}.md`);
  });
});

describe("check-manual-figures: coverage comes from the locale registry", () => {
  it("derives MANUAL_SOURCE_PATHS from the MANUAL_FILES registry (endonym per locale)", () => {
    // The mapping is a lookup, not a copy: "es" owns docs/manual-de-usuario-es.md
    // (the Spanish master, the only manual with the full pricing chapter),
    // "de" owns docs/benutzerhandbuch-de.md, "ja" owns docs/user-manual-ja.md.
    // Pinning the derivation means the list can never fall behind the locale
    // set or the rename again — the failure mode that left this gate
    // validating a shrinking corpus while the pages grew.
    expect(MANUAL_SOURCE_PATHS).toEqual(
      LANDING_CODES.map((code) => manualSourcePath(code)),
    );
    // 1:1 with the registry: no locale unpoliced, no manual demanded twice.
    expect(MANUAL_SOURCE_PATHS).toHaveLength(LANDING_CODES.length);
    expect(new Set(MANUAL_SOURCE_PATHS).size).toBe(LANDING_CODES.length);
  });

  it("demands the manual of every registry locale (a new locale cannot go unpoliced)", () => {
    // Spanish master present, no other manual: the gate must ask for exactly
    // the registry's remaining locales — not for a hardcoded subset that
    // happens to match today (and would silently stay at 6 if the registry
    // moved).
    const root = makeRoot({});
    const { missing } = runManualFiguresGate(root);
    expect(missing).toHaveLength(LANDING_CODES.length - 1);
    for (const code of LANDING_CODES) {
      if (code === "es") continue;
      expect(missing.join("\n"), `missing manual for ${code}`).toContain(
        `${MANUAL_FILES[code]}.md`,
      );
    }
  });
});
