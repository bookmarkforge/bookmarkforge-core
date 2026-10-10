// @vitest-environment node
/**
 * scripts/__tests__/check-landing-free-plan.test.mjs
 *
 * Tests for the Free-plan integrity gate (scripts/check-landing-free-plan.mjs):
 *   - cap-number normalization (thousand separators, Arabic-Indic digits),
 *   - device-noun matching across scripts (Latin, CJK, Hebrew, Arabic,
 *     Devanagari, Thai) — the word-forms the historical regression hid in,
 *   - the wedge matcher against the real per-locale keyword table,
 *   - source checkers (primary plans[0], secondary priceFree*),
 *   - MUTATION regressions: the exact copy that once shipped (the fiction in
 *     24 locales, hidden from the generic numeric gate) must fail today,
 *   - a freeze test on the REAL repo tree (the same battery CI runs).
 */
import { describe, expect, it } from "vitest";
import {
  checkFreeCardContent,
  checkLandingHtml,
  checkPrimarySource,
  checkSecondarySource,
  findDeviceCountClaim,
  isWedgeLine,
  normalizeCapNumbers,
  validateSecondaryCoverage,
  WEDGE_TABLE,
} from "../check-landing-free-plan.mjs";
import { LANDING_CODES, PRIMARY_LOCALE_CODES } from "../landing-registry.mjs";

// ── Rule A: cap normalization ────────────────────────────────────────────────
describe("normalizeCapNumbers", () => {
  it("collapses every thousand-separator shape to 1000", () => {
    expect(normalizeCapNumbers("1,000 bookmarks")).toBe("1000 bookmarks");
    expect(normalizeCapNumbers("1.000 marcadores")).toBe("1000 marcadores");
    expect(normalizeCapNumbers("1 000 закладок")).toBe("1000 закладок");
    expect(normalizeCapNumbers("1,000件のブックマーク")).toBe("1000件のブックマーク");
  });

  it("maps Arabic-Indic digits to ASCII", () => {
    // ١٠٠٠ → 1000; ١ جهاز → 1 جهاز
    expect(normalizeCapNumbers("\u0661\u0660\u0660\u0660")).toBe("1000");
    expect(normalizeCapNumbers("\u0661 \u062C\u0647\u0627\u0632")).toBe(
      "1 \u062C\u0647\u0627\u0632",
    );
  });

  it("never touches numbers that are not thousand-shaped", () => {
    expect(normalizeCapNumbers("3 devices")).toBe("3 devices");
    expect(normalizeCapNumbers("v1.5")).toBe("v1.5");
  });
});

// ── Rule A: device nouns across scripts ─────────────────────────────────────
describe("findDeviceCountClaim", () => {
  it.each([
    // Latin stems (primary locales + Nordic/Central European)
    ["1 device", "en"],
    ["1 dispositivo", "es"],
    ["1 appareil", "fr"],
    ["1 Gerät", "de"],
    ["1 dispositivo", "pt"],
    ["1 dispositivo", "it"],
    ["1 000 zařízení", "cs"],
    ["1 eszköz", "hu"],
    ["1 urządzenie", "pl"],
    ["1 enhet", "sv"],
    // Cyrillic
    ["1 устройство", "ru"],
    ["1 пристрій", "uk"],
    // Greek
    ["1 συσκευή", "el"],
    // CJK — the forms the historical fiction actually shipped in
    ["1台设备", "zh"],
    ["1 デバイス", "ja"],
    ["1 기기", "ko"],
    // Hebrew / Arabic / Devanagari / Thai
    ["מכשיר אחד עם מספר 1", "he"],
    ["1 \u062C\u0647\u0627\u0632", "ar"],
    ["1 डिवाइस", "hi"],
    ["1 อุปกรณ์", "th"],
    // Southeast Asia
    ["1 thiết bị", "vi"],
    ["1 perangkat", "id"],
    ["1 cihaz", "tr"],
  ])("catches %q (device fiction)", (line) => {
    expect(findDeviceCountClaim(line)).not.toBeNull();
  });

  it("never flags the 1,000 cap in any locale shape", () => {
    expect(findDeviceCountClaim("1,000 bookmarks, notes, documents")).toBeNull();
    expect(findDeviceCountClaim("1.000 marcadores, notas y documentos")).toBeNull();
    expect(findDeviceCountClaim("1 000 закладок, заметок и документов")).toBeNull();
    expect(findDeviceCountClaim("1,000件のブックマーク、メモ、ドキュメント")).toBeNull();
    expect(findDeviceCountClaim("1,000个书签、笔记和文档")).toBeNull();
    expect(findDeviceCountClaim("1,000 बुकमार्क, नोट्स और दस्तावेज़")).toBeNull();
  });

  it("still fails nonsense like '1,000 devices'", () => {
    expect(findDeviceCountClaim("1,000 devices")).not.toBeNull();
  });

  it("flags Arabic-Indic digit device claims (١ جهاز)", () => {
    expect(findDeviceCountClaim("\u0661 \u062C\u0647\u0627\u0632")).not.toBeNull();
  });

  it("does not fire without a number", () => {
    // "any device" wordings are the CORRECT copy — must stay clean.
    expect(findDeviceCountClaim("Works on any device — each keeps its own vault")).toBeNull();
    expect(findDeviceCountClaim("Funciona en cualquier dispositivo")).toBeNull();
    expect(findDeviceCountClaim("どのデバイスでも動作")).toBeNull();
    expect(findDeviceCountClaim("تعمل على أي جهاز")).toBeNull();
  });
});

// ── Rule B: wedge matcher against the real per-locale table ─────────────────
describe("wedge matcher", () => {
  // The real wedge line of every locale, extracted from the live landings.
  const LIVE_WEDGES = {
    en: "Smart search (full-text + semantic) — included free; Raindrop charges yearly for this",
    es: "Búsqueda inteligente (texto completo + semántica) — incluida gratis; Raindrop cobra cada año por esto",
    fr: "Recherche intelligente (texte intégral + sémantique) — incluse gratuitement ; Raindrop la fait payer chaque année",
    de: "Intelligente Suche (Volltext + semantisch) — gratis inklusive; Raindrop verlangt dafür jährlich Geld",
    pt: "Pesquisa inteligente (texto integral + semântica) — incluída grátis; o Raindrop cobra todos os anos por isto",
    it: "Ricerca intelligente (testo completo + semantica) — inclusa gratis; Raindrop la fa pagare ogni anno",
    ar: "بحث ذكي (نص كامل + دلالي) — مشمول مجانًا؛ Raindrop يتقاضى مقابل هذا اشتراكًا سنويًا",
    bg: "Интелигентно търсене (пълнотекстово + семантично) — включено безплатно; Raindrop го таксува годишно",
    cs: "Chytré vyhledávání (plnotextové + sémantické) — zdarma; Raindrop za něj účtuje roční předplatné",
    da: "Smart søgning (fuldtekst + semantisk) — inkluderet gratis; Raindrop opkræver årligt betaling for dette",
    el: "Έξυπνη αναζήτηση (πλήρες κείμενο + σημασιολογική) — δωρεάν· το Raindrop χρεώνει ετήσια συνδρομή γι' αυτή",
    fi: "Älykäs haku (kokoteksti + semanttinen) — sisältyy ilmaiseksi; Raindrop perii siitä vuosimaksun",
    he: "חיפוש חכם (טקסט מלא + סמנטי) — כלול בחינם; Raindrop גובה על זה תשלום שנתי",
    hi: "स्मार्ट खोज (पूर्ण पाठ + सिमेंटिक) — मुफ़्त शामिल; Raindrop इसके लिए सालाना पैसे लेता है",
    hr: "Pametno pretraživanje (cjelovit tekst + semantičko) — uključeno besplatno; Raindrop za to naplaćuje godišnje",
    hu: "Okos keresés (teljes szöveges + szemantikus) — ingyenesen tartalmazza; a Raindrop évente fizetést kér érte",
    id: "Pencarian pintar (teks penuh + semantik) — termasuk gratis; Raindrop menagihnya tiap tahun",
    ja: "スマート検索（全文 + セマンティック）— 無料で搭載。Raindropはこれに年額を課しています",
    ko: "스마트 검색(전문 + 시맨틱) — 무료 포함. Raindrop은 이 기능에 연간 요금을 받습니다",
    nl: "Slim zoeken (volledige tekst + semantisch) — gratis inbegrepen; Raindrop rekent hiervoor jaarlijks",
    no: "Smart søk (fulltekst + semantisk) — inkluderet gratis; Raindrop krever årlig betaling for dette",
    pl: "Inteligentne wyszukiwanie (pełnotekstowe + semantyczne) — wliczone bezpłatnie; Raindrop pobiera za to opłatę roczną",
    ro: "Căutare inteligentă (text integral + semantică) — inclusă gratuit; Raindrop taxează asta anual",
    ru: "Умный поиск (полнотекстовый + семантический) — включён бесплатно; Raindrop берёт за это годовую плату",
    sv: "Smart sökning (hela texten + semantisk) — ingår gratis; Raindrop tar årsavgift för detta",
    th: "การค้นหาอัจฉริยะ (แบบเต็มข้อความ + ความหมาย) — รวมฟรี; Raindrop เก็บเงินรายปีสำหรับฟีเจอร์นี้",
    tr: "Akıllı arama (tam metin + anlamsal) — ücretsiz dahil; Raindrop bunun için yıllık ücret alıyor",
    uk: "Розумний пошук (повнотекстовий + семантичний) — включено безкоштовно; Raindrop бере за це річну плату",
    vi: "Tìm kiếm thông minh (toàn văn + ngữ nghĩa) — miễn phí; Raindrop thu phí hàng năm cho tính năng này",
    zh: "智能搜索（全文 + 语义）— 免费包含；Raindrop 对此功能每年收费",
  };

  it("table covers exactly the 30 locales", () => {
    expect(Object.keys(WEDGE_TABLE).sort()).toEqual(
      Object.keys(LIVE_WEDGES).sort(),
    );
  });

  it.each(Object.entries(LIVE_WEDGES))(
    "recognizes the real %s wedge line",
    (lang, line) => {
      expect(isWedgeLine(line, lang)).toBe(true);
    },
  );

  it("rejects non-wedge lines: brand mention without search+smart", () => {
    expect(isWedgeLine("Import from Raindrop in one click", "en")).toBe(false);
    expect(isWedgeLine("P2P sync between devices", "en")).toBe(false);
    expect(isWedgeLine("1,000 bookmarks, notes, documents", "en")).toBe(false);
  });

  it("rejects smart search without the competitor anchor", () => {
    expect(isWedgeLine("Smart search (full-text + semantic) included free", "en")).toBe(false);
  });
});

// ── Card-level checks ────────────────────────────────────────────────────────
describe("checkFreeCardContent", () => {
  const CLEAN_PRIMARY = {
    description:
      "Free forever: 1,000 bookmarks plus the smart search others charge yearly for. At 1,000 your vault stays whole — reading, search and export never stop; only new saves pause.",
    features: [
      "Smart search (full-text + semantic) — included free; Raindrop charges yearly for this",
      "1,000 bookmarks, notes, documents",
      "Works on any device — each keeps its own vault",
    ],
  };

  it("clean primary card passes with wedge at slot 0", () => {
    expect(checkFreeCardContent(CLEAN_PRIMARY, "en", 0)).toEqual([]);
  });

  it("clean secondary card passes with wedge at slot 1", () => {
    const secondary = {
      description: "個人用アーカイブとして（1,000件のブックマーク、どのデバイスでも動作）",
      features: [
        "1,000件のブックマーク、メモ、ドキュメント",
        "スマート検索（全文 + セマンティック）— 無料で搭載。Raindropはこれに年額を課しています",
        "独自のAPIキーでAI（プロバイダーに支払い）",
      ],
    };
    expect(checkFreeCardContent(secondary, "ja", 1)).toEqual([]);
  });

  it("demoted wedge fails wedge-position", () => {
    const problems = checkFreeCardContent(
      { ...CLEAN_PRIMARY, features: [...CLEAN_PRIMARY.features].reverse() },
      "en",
      0,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].rule).toBe("wedge-position");
  });

  it("removed wedge fails wedge-missing", () => {
    const problems = checkFreeCardContent(
      {
        description: CLEAN_PRIMARY.description,
        features: ["1,000 bookmarks, notes, documents", "Knowledge graph"],
      },
      "en",
      0,
    );
    expect(problems.some((p) => p.rule === "wedge-missing")).toBe(true);
  });

  it("device fiction in the description fails device-count", () => {
    const problems = checkFreeCardContent(
      {
        description: "Free forever: 1,000 bookmarks on 1 device.",
        features: CLEAN_PRIMARY.features,
      },
      "en",
      0,
    );
    expect(problems.some((p) => p.rule === "device-count")).toBe(true);
  });
});

// ── Mutation regressions: the historical fiction must fail ──────────────────
describe("mutation regressions (historical drift)", () => {
  // The exact shapes that shipped in ~24 locales and hid from the numeric
  // gate — every one must be caught on the Free card today.
  const FICTIONS = [
    "1台设备拥有独立保险库", // zh
    "1つのデバイスで動作", // ja
    "1 기기에서만 사용", // ko
    "يعمل على جهاز واحد", // ar — «one device»
    "עובד על מכשיר 1", // he
    "1 dispositivo", // es/pt/it
    "1 appareil", // fr
    "1 Gerät", // de
    "1 устройство", // ru
    "1 डिवाइस", // hi
  ];

  it.each(FICTIONS)("fiction %q fails the card check", (fiction) => {
    const problems = checkFreeCardContent(
      {
        description: `Free archive (${fiction} — each keeps its own vault)`,
        features: ["1,000 bookmarks"],
      },
      "en", // language only affects the wedge matcher; rule A is script-wide
      1,
    );
    expect(problems.some((p) => p.rule === "device-count")).toBe(true);
  });

  it("dropping the wedge from a secondary source fails", () => {
    const problems = checkSecondarySource("ru", {
      priceFreeDesc: "Для личного архива (1 000 закладок)",
      priceFreeItems: [
        "1 000 закладок, заметок и документов",
        "AI с вашим API-ключом (вы платите провайдеру)",
        "Граф знаний",
      ],
    });
    expect(problems.some((p) => p.rule === "wedge-missing")).toBe(true);
  });

  it("demoting the wedge in a primary source fails", () => {
    const t = {
      pricing: {
        plans: [
          {
            name: "Free",
            description: "Free forever: 1,000 bookmarks.",
            features: [
              { included: true, text: "1,000 bookmarks, notes, documents" },
              {
                included: true,
                text: "Smart search (full-text + semantic) — included free; Raindrop charges yearly for this",
              },
            ],
          },
        ],
      },
    };
    const problems = checkPrimarySource("en", t);
    expect(problems.some((p) => p.rule === "wedge-position")).toBe(true);
  });
});

// ── Freeze: the REAL repo tree must pass (the battery CI runs) ──────────────
describe("freeze on the real repo tree", () => {
  it("renders clean Free cards for a sample of locales across scripts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "..", "..");
    for (const [file, lang, slot] of [
      ["landing.html", "en", 0],
      ["es.html", "es", 0],
      ["ja.html", "ja", 1],
      ["ar.html", "ar", 1],
      ["he.html", "he", 1],
      ["ru.html", "ru", 1],
      ["th.html", "th", 1],
      ["zh.html", "zh", 1],
    ]) {
      const html = readFileSync(join(root, "public", file), "utf8");
      expect(checkLandingHtml(html, lang, slot), file).toEqual([]);
    }
  });

  it("primary + secondary sources are clean", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "..", "..");
    for (const lang of ["en", "es", "de"]) {
      const t = JSON.parse(
        readFileSync(join(root, "scripts", "translations", `${lang}.json`), "utf8"),
      );
      expect(checkPrimarySource(lang, t), lang).toEqual([]);
    }
    const T = JSON.parse(
      readFileSync(join(root, "scripts", "landing-translations.json"), "utf8"),
    );
    for (const [lang, t] of Object.entries(T)) {
      expect(checkSecondarySource(lang, t), lang).toEqual([]);
    }
  });
});

// ── The primary/secondary split vs its artifact ──────────────────────────────
describe("validateSecondaryCoverage", () => {
  /** A file covering exactly the registry's non-primary locales. */
  const secondaries = Object.fromEntries(
    LANDING_CODES.filter((lang) => !PRIMARY_LOCALE_CODES.includes(lang)).map(
      (lang) => [lang, {}],
    ),
  );

  it("accepts the registry's secondary set", () => {
    expect(validateSecondaryCoverage({ landingTranslations: secondaries })).toEqual(
      [],
    );
  });

  it("fails a locale the registry knows but the artifact does not", () => {
    const incomplete = { ...secondaries };
    delete incomplete.ja;
    const violations = validateSecondaryCoverage({ landingTranslations: incomplete });
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('"ja"');
    expect(violations[0].rule).toBe("secondary-coverage");
  });

  it("fails an entry for a primary locale (its source is the full file)", () => {
    const violations = validateSecondaryCoverage({
      landingTranslations: { ...secondaries, es: {} },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain("primary locale");
  });

  it("fails an entry for a locale the registry does not know", () => {
    const violations = validateSecondaryCoverage({
      landingTranslations: { ...secondaries, xx: {} },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain("not a landing locale");
  });

  it("the real artifact covers exactly the 24 secondaries", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "..", "..");
    const T = JSON.parse(
      readFileSync(join(root, "scripts", "landing-translations.json"), "utf8"),
    );
    expect(Object.keys(T)).toHaveLength(LANDING_CODES.length - PRIMARY_LOCALE_CODES.length);
    expect(validateSecondaryCoverage({ landingTranslations: T })).toEqual([]);
  });
});
