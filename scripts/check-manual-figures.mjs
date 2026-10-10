#!/usr/bin/env node
/**
 * scripts/check-manual-figures.mjs
 *
 * CI gate: the 30 localized user manuals must agree with the code on every
 * business figure. Born from the figure audit (2026-09-16) that followed the
 * AGPL license drift: the manuals were clean, but the same drift class had
 * already shipped twice ("1 device" for Free in pricing sources while the
 * code says any-device), so the one-off auditor is promoted to a gate.
 *
 * Sources of truth (parsed, not duplicated):
 *   - src/constants/pricing.ts   — Free/Pro tiers: bookmark caps,
 *     device counts, prices (early-bird ladder, upgrades),
 *     early-bird caps, refund days, upgrade discount percent.
 *   - src/constants/license.ts   — cacheTtlMs → Pro license re-validation
 *     window in hours.
 *   - src/services/RecoveryService.ts — the 24-word recovery phrase.
 *   - src/constants/config.ts    — MIN_PASSWORD_LENGTH.
 *
 * Surfaces scanned: the localized manual sources in docs/, one per locale of
 * scripts/landing-registry.mjs (MANUAL_SOURCE_PATHS is derived from that
 * registry's MANUAL_FILES table, not a hand-kept list — see its comment). The
 * PDFs and the -styled.html twins are generated FROM these by
 * docs:pdf:localized, so the Markdown set is the truth for the whole manual
 * family; the public export includes all of them. docs/manual-de-usuario-es.md
 * is the Spanish master: the only one carrying the full pricing chapter, so
 * tier-table-only claims are validated there; condensed manuals carry
 * §3.1/§6/§7-shaped prose lines.
 *
 * Validation is directional: every figure-bearing line found in a manual must
 * agree with the code. Absence is not an error here (claim presence is
 * check-claim-drift's job for app surfaces; manuals are validated on what
 * they say).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES, manualSourcePath } from "./landing-registry.mjs";

const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(THIS_DIR, "..");

/**
 * Manual source paths (docs-relative), DERIVED from the MANUAL_FILES table in
 * the landing locale registry (the same single source the pages, the PDF
 * generator, the exporter and the claim gate use) — the mapping is a lookup
 * through `manualSourcePath`, not a copy. Since the endonym rename each locale
 * owns its own basename: "es" is docs/manual-de-usuario-es.md (the Spanish
 * master, the only manual carrying the full pricing chapter), "de" is
 * docs/benutzerhandbuch-de.md, "ja" is docs/user-manual-ja.md.
 *
 * Deriving it is what keeps a new locale honest: the hand-written list this
 * replaced would have silently kept validating 30 manuals while the registry
 * moved on, exactly the drift that left five consumers behind at 6 languages
 * during the 6→30 expansion. Now a locale added to the registry fails THIS
 * gate until its manual exists (scanManuals reports the missing file) instead
 * of going unpoliced.
 */
export const MANUAL_SOURCE_PATHS = LANDING_CODES.map((code) =>
  manualSourcePath(code),
);

// ---------------------------------------------------------------------------
// Truth extraction (regex-parsed constants; no imports of app code)
// ---------------------------------------------------------------------------

function readSrc(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error(`[check-manual-figures] missing source of truth: ${rel}`);
  return readFileSync(p, "utf8");
}

export function loadTruth(root = REPO_ROOT) {
  const pricing = readSrc(root, join("src", "constants", "pricing.ts"));

  const num = (re) => {
    const m = pricing.match(re);
    if (!m) throw new Error(`[check-manual-figures] cannot parse pricing constant: ${re}`);
    return Number(m[1]);
  };

  const truth = {
    // Tier limitations (inside the tiers array)
    freeMaxBookmarks: num(/id:\s*"free"[\s\S]{0,4000}?maxBookmarks:\s*(\d+)/),
    freeMaxDevices: num(/id:\s*"free"[\s\S]{0,4000}?maxDevices:\s*(\d+)/),
    proMaxDevices: num(/id:\s*"pro"[\s\S]{0,4000}?maxDevices:\s*(\d+)/),
    proPrice: num(/id:\s*"pro",[\s\S]{0,200}?price:\s*(\d+)/),
    proEarlyBirdPrice: num(/earlyBirdPrice:\s*(\d+)/),
    proRegularPrice: num(/regularPrice:\s*(\d+)/),
    proFullPrice: num(/fullPrice:\s*(\d+)/),
    upgradePriceNew: num(/upgradePriceNew:\s*(\d+)/),
    upgradePriceOwner: num(/upgradePriceOwner:\s*(\d+)/),
    earlyBirdCapEarly: num(/caps:\s*{\s*early:\s*(\d+)/),
    refundDays: num(/refundDays:\s*(\d+)/),
    upgradeDiscountPct: num(/upgradeDiscountPct:\s*(\d+)/),
  };

  // 48h re-validation window: cacheTtlMs: 48 * 60 * 60 * 1000
  const license = readSrc(root, join("src", "constants", "license.ts"));
  const ttl = license.match(/cacheTtlMs:\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  truth.revalidationHours = ttl ? Number(ttl[1]) : null;
  if (!truth.revalidationHours) {
    throw new Error("[check-manual-figures] cannot parse cacheTtlMs hours from src/constants/license.ts");
  }

  // Recovery phrase length: `if (wordCount !== 24)` in RecoveryService
  const recovery = readSrc(root, join("src", "services", "RecoveryService.ts"));
  const words = recovery.match(/wordCount\s*!==\s*(\d+)/);
  truth.recoveryWords = words ? Number(words[1]) : null;
  if (!truth.recoveryWords) {
    throw new Error("[check-manual-figures] cannot parse recovery word count from RecoveryService.ts");
  }

  // Password minimum
  const config = readSrc(root, join("src", "constants", "config.ts"));
  const minPw = config.match(/MIN_PASSWORD_LENGTH:\s*(\d+)/);
  truth.minPasswordLength = minPw ? Number(minPw[1]) : null;
  if (!truth.minPasswordLength) {
    throw new Error("[check-manual-figures] cannot parse MIN_PASSWORD_LENGTH from src/constants/config.ts");
  }

  return truth;
}

// ---------------------------------------------------------------------------
// Allowed-value sets derived from truth
// ---------------------------------------------------------------------------

export function allowedValueSets(truth) {
  // Next-major owner price is derived from the discount (60% off majors):
  // floor(89 × 0.4) = 35 (v2 owner, matches upgradePriceOwner) and
  // floor(99 × 0.4) = 39 (v3 owner, per the frozen pricing decision). No
  // third source of truth is introduced and the set stays export-safe.
  const ownerPrice = (newPrice) =>
    Math.floor((newPrice * (100 - truth.upgradeDiscountPct)) / 100);

  return {
    // Prices a manual may quote (free, ladder, upgrades, derived owners)
    prices: new Set([
      0,
      truth.proPrice,
      truth.proEarlyBirdPrice,
      truth.proRegularPrice,
      truth.proFullPrice,
      truth.upgradePriceNew,
      truth.upgradePriceOwner,
      ownerPrice(truth.upgradePriceNew),
      ownerPrice(truth.proFullPrice),
    ]),
    // Device counts a manual may quote (Free "no limit" reads as 0-cap)
    deviceCounts: new Set([truth.freeMaxDevices, truth.proMaxDevices]),
    // Bookmark caps: Free cap only (Pro is unlimited — the word, not a number)
    bookmarkCaps: new Set([truth.freeMaxBookmarks]),
    // Supply caps: early-bird units
    supplyCaps: new Set([truth.earlyBirdCapEarly]),
    refundDays: truth.refundDays,
    revalidationHours: truth.revalidationHours,
    recoveryWords: truth.recoveryWords,
    minPasswordLength: truth.minPasswordLength,
    upgradeDiscountPct: truth.upgradeDiscountPct,
  };
}

// ---------------------------------------------------------------------------
// Manual parsing
// ---------------------------------------------------------------------------

/** Normalize thousands separators: "1,000"/"1 000"/"1.000" → 1000. */
export function normalizeNumberWord(text) {
  return text
    .replace(/(\d)[,\u00A0\u202F](\d{3})\b/g, "$1$2")
    .replace(/(\d) (\d{3})\b/g, "$1$2")
    .replace(/(\d)\.(\d{3})\b/g, "$1$2");
}

/** Pull integers out of a normalized line. ISO dates (2026-12-31) are
 * stripped first — their fragments (12, 31) are not claims — and standalone
 * year tokens (2026) are skipped. Everything else is a candidate figure. */
function lineNumbers(normalized) {
  const withoutDates = normalized.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  const out = [];
  for (const m of withoutDates.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = Number(m[0]);
    if (n === 2026) continue; // standalone Early Bird deadline year
    out.push(n);
  }
  return out;
}

/** Strip noise that would feed spurious numbers into line-based rules:
 * markdown list bullets ("3. ", "4. "), the P2P/P2P-sync brand token,
 * feature-major tokens (v2, v3, v1.x) and percent signs ("100%", "60%")
 * are handled by dedicated rules or are not tier figures at all. */
function stripNoise(normalized) {
  return normalized
    .replace(/^\s*\d+\.\s+/g, " ") // ordered-list markers
    .replace(/\bP2P\b/gi, " ") // peer-to-peer token: the "2" is not a count
    .replace(/\bv\d(?:\.\d+)?\b/gi, " ") // v1, v2, v3, v1.x product versions
    .replace(/\d+\s?%/g, " "); // percent figures: dedicated pct rule
}

/** Price tokens: "$59"-shaped only. Spoken prices ("28 dollars every
 * year") are the documented competitor convention on the public pages
 * (patch-landing-copy.mjs): competitor prices are deliberately written
 * without "$" so our own dollar claims stay the only price tags. Numbers
 * parsed locale-aware: "1,234" → 1234, "1.234" → 1234. */
const PRICE_DOLLAR_RE = /\$\s?(\d+(?:[.,]\d+)*)/gu;

/** Locale-aware price parse (same shapes as claim-drift's parseDollar). */
function parsePrice(raw) {
  const s = raw.replace(/\s/g, "");
  if (!/^\d+([.,]\d+)*$/.test(s)) return null;
  if (/^\d{1,3}(,\d{3})+([.]\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^\d{1,3}(\.\d{3})+([,]\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s.replace(",", "."));
}

function priceTokens(normalized) {
  const out = [];
  for (const m of normalized.matchAll(PRICE_DOLLAR_RE)) {
    const p = parsePrice(m[1]);
    if (p != null) out.push(p);
  }
  return out;
}

/** Multilingual device nouns (device/dispositivo/Gerät/端末/设备/...).
 * Word-bounded so AES-GCM ("cm"), Gerätebegrenzung (compound: the unlimited
 * marker inside it already carries the claim) etc. do not match. */
const DEVICE_RE =
  /\b(?:dispositivos?|dispositiu|devices?|ger[äa]te|appareils?|デバイス|端末|设备|裝置|устройств[аоы]|устройств|пристрой|기기|cihazlar?|dispozitiv|อุปกรณ์|thiết\s?bị|eszk[öo]z|urz[ąa]dzen|zařízení|enheter|apparater|laitteet|perangkat|peranti)\b/i;

/** Bookmarks nouns. */
const BOOKMARK_RE =
  /marcadores?|bookmarks?|Lesezeichen|marque-pages|segnalibri|ブックマーク|书签|заклад\w*|записей|oznak\w*|zakładk\w*| Bookmark|означ\w*|_bm/i;

/** "No device limit" markers. Matched against the RAW line: negated
 * compounds ("nu are limită de dispozitive", "ingen gräns för antal
 * enheter") lose the noun to word boundaries once the line is stripped. */
const UNLIMITED_RE =
  /ilimitad\w*|unlimited|illimit[ée]|unbegrenzt|無制限|无限|без ограничен|безлимит|bez omezen|geen limiet|ei rajoita|sin l[ií]mite|sem limite|f[ăa]r[ăa] limit[ăa]|nu are limit|sınırlamaz|korlátlan|nincs eszköz|nie ma limitu|ไม่มีจำกัด|ingen gr[æe]nse|ingen gr[äa]ns|utan gr[äa]ns|obegr[äa]nsad|no device limit|nessun limite|senza limiti|제한 없|制限なし/i;

/** Recovery-phrase word nouns. */
const RECOVERY_WORD_RE =
  /(?:palabras?|words?|W[öo]rter?|parole|mots?|slov\w*|単語|个恢复词|恢复词|слова|слов|كلمات|מילים|शब्द|คำ|từ|kelime|słowa)/i;

/** Offer-cap context: early-bird supply claims ("Early Bird 200").
 * On such lines, any explicitly-unit-ed count must be a canonical supply cap
 * (200 early birds). */
const OFFER_LIMIT_RE = /early\s?bird|pioneros?|gr[üu]nders?/i;

// ── Number↔unit pairing ───────────────────────────────────────────────────
/** The number and its unit noun must be ADJACENT (optional space/hyphen, or
 * the Romance numeral clitic "de", or the CJK classifier 个) — the same
 * precision model as check-claim-drift's number-anchored rules. "24 words"
 * pairs 24↔words; "12 months of updates" never feeds the word/day/hour
 * rules; "48h" without an hour noun pairs nothing. Two-sided so CJK
 * noun-after-number ("3台") and English "3 devices" both pair. */
function pairNumUnits(line, unitPattern) {
  // One-sided pairing (number before noun — covers "24 words", "3台",
  // "24个恢复词"), with Unicode boundaries on BOTH sides: no pairing inside
  // longer words ("2026 BookmarkForge" must not pair 2026↔Bookmark) and no
  // pairing of version-attached numbers ("v2 devices").
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(\\d+(?:[.,]\\d+)*)\\s*(?:(?:de|个)\\s+)?(?:${unitPattern})(?![\\p{L}])` +
      // hyphenated attributives: "24-word phrase", "3-device sync", "48-hour re-validation"
      `|(?<![\\p{L}\\p{N}])(\\d+)-(?:${unitPattern})(?![\\p{L}])`,
    "giu",
  );
  const out = [];
  const seen = new Set();
  for (const m of line.matchAll(re)) {
    const rawNum = m[1] ?? m[2]; // "24 words" vs "24-word" (hyphenated EN attributive)
    const n = parsePrice(rawNum); // locale-aware integer parse
    if (n == null || !Number.isInteger(n)) continue; // "3.1" section refs never pair
    if (n === 2026) continue; // standalone Early Bird deadline year
    if (seen.has(n)) continue;
    seen.add(n);
    out.push({ n, unit: m[0] });
  }
  return out;
}

/** Spoken ONE-TIME price claims: number + currency word + once-marker in
 * either order ("59 dollars once", "una vez 59 dólares"). Currency words
 * (dollars/dólares/Dollar/dollari) without the marker are NOT ours —
 * the competitor price is deliberately written that way on public pages
 * (patch-landing-copy.mjs), and manuals never use spoken prices. */
const ONCE_MARKERS = "once|una vez|une (?:seule )?fois|einmal|uma vez|una (?:sola )?volta|una volta";
const SPOKEN_ONCE_PRICE_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)*)\\s*(?:dollars?|d[óo]lares?|Dollar|dollari)\\s+(?:${ONCE_MARKERS})|(?:${ONCE_MARKERS})\\s+(\\d+(?:[.,]\\d+)*)\\s*(?:dollars?|d[óo]lares?|Dollar|dollari)`,
  "gi",
);

/** Device nouns (number-adjacent form). */
const DEVICE_UNITS =
  "dispositivos?|dispositiu|devices?|ger[äa]te|appareils?|デバイス|台|端末|设备|裝置|устройств\w*|пристрой|기기|대|cihazlar?|dispozitiv\w*|อุปกรณ์|thiết\s?bị|eszk[öo]z\w*|urz[ąa]dzen\w*|zař[íi]zen\w*|enheter|enheder|apparater|laitteet|perangkat(?:nya)?|peranti";

/** Bookmark nouns (number-adjacent form). */
const BOOKMARK_UNITS =
  "marcadores?|marcaje|bookmarks?|Lesezeichen|marque-pages|segnalibri|ブックマーク|个书签|书签|즐겨찾기|заклад\w*|записей|oznak\w*|zakładk\w*|záložk\w*|könyvjelző\w*|penanda|dau-mark\w*|dấu\s?trang";

/** Recovery word nouns (number-adjacent form). */
const WORD_UNITS =
  "palabras?|words?|W[öo]rter?|mots?|parole|slov\w*|słow\w*|単語|語|个恢复词|恢复词|단어|kelime|kurtarma|từ|คำ|كلمات|كلمة|מילים|शब्द|слов\w*|дум\w*";

/** Hour nouns (number-adjacent form). */
const HOUR_UNITS =
  "hours?|horas?|Stunden?|heures?|ore|godzin\w*|hodin\w*|óra|uur|tuntia|時間|小时|小時|시간|час\w*|годин\w*|ساعات?|ชั่วโมง|giờ";

/** Day nouns (number-adjacent form; CJK forms longest-first). */
const DAY_UNITS =
  "days?|días?|dias?|Tage|jours?|giorni|dn[íi]\w*|dage|päiv[äa]ä|gün|zile|дней|дня|днів|日間|日以内|日";

/**
 * The claim rules. Each rule: which lines it applies to (a guard on the
 * line), what it extracts, and what it must equal.
 */
export function evaluateManual(src, allowed, relLabel) {
  const failures = [];
  const lines = src.split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const normRaw = normalizeNumberWord(raw);
    const where = `${relLabel}:${idx + 1}`;

    // Discount-percentage claims (need the % figures stripNoise would drop):
    // only lines with discount context — "100% offline" / "100% Local-First"
    // are completeness marketing, not tier claims (lands on the compacted
    // JSON-LD line of the generated pages, which also carries offer copy).
    if (/descuento|discount|off\b|r[ée]duction|sconto|скидк|割引|折扣|indirim|kedvezm/i.test(normRaw)) {
      const discountLine = normRaw.replace(
        /100\s?%\s*(?:of\s?f\s?line|local\w*|privat\w*|sin\s+conexi[óo]n|lokal\w*|オフライン|ローカル)/gi,
        "",
      );
      for (const m of discountLine.matchAll(/(\d+)\s?%/g)) {
        const n = Number(m[1]);
        if (n !== allowed.upgradeDiscountPct) {
          failures.push(`${where}: discount claims ${n}%; pricing.ts says ${allowed.upgradeDiscountPct}%`);
        }
      }
    }

    const line = stripNoise(normRaw);
    const hasDevice = DEVICE_RE.test(line);
    const hasBookmark = BOOKMARK_RE.test(line);
    const hasRecovery = RECOVERY_WORD_RE.test(line);

    // Price tokens anywhere in a figure-bearing pricing line (dedup per line).
    const prices = [...new Set(priceTokens(line))];
    for (const p of prices) {
      if (!allowed.prices.has(p)) {
        failures.push(`${where}: price ${p} is not in the canonical ladder`);
      }
    }

    // Spoken one-time price claims ("59 dollars once", "59 dólares una vez").
    // The one-time marker is part of the claim pattern, so a competitor's
    // RECURRING spoken price ("28 dollars every year") never matches: on
    // competitor-named lines only ours carries the once-marker. The number
    // must be ours; the spoken competitor price is neutralized upstream
    // (check-page-figures) and does not exist on manual lines.
    for (const m of normRaw.matchAll(SPOKEN_ONCE_PRICE_RE)) {
      const p = parsePrice(m[1]);
      if (p != null && !allowed.prices.has(p)) {
        failures.push(`${where}: spoken one-time price ${m[1]} is not in the canonical ladder`);
      }
    }

    // Device-count claims: only on lines that talk about devices (but not
    // bookmarks — bookmark-cap lines may legitimately mention a device, e.g.
    // "1,000 bookmarks, no device limit") AND carry a count ("hasta 3",
    // "3台", "up to 3", "bis zu drei") or an unlimited marker. The unlimited
    // exemption reads the RAW line: negations like "nu are limită de
    // dispozitive" lose the noun to word boundaries on the stripped line.
    if (hasDevice && !hasBookmark && !UNLIMITED_RE.test(normRaw)) {
      for (const { n } of pairNumUnits(line, DEVICE_UNITS)) {
        if (!allowed.deviceCounts.has(n)) {
          failures.push(`${where}: device count ${n} is not canonical`);
        }
      }
    }

    // Bookmark-cap claims.
    if (hasBookmark) {
      for (const { n } of pairNumUnits(line, BOOKMARK_UNITS)) {
        if (!allowed.bookmarkCaps.has(n)) {
          failures.push(`${where}: bookmark cap ${n} is not canonical`);
        }
      }
    }

    // Offer-cap claims: early-bird supply lines. Supply counts are
    // unit-less in practice ("primeros 200 compradores", "Early Bird 200"),
    // and generic unit pairing poisons these lines with years, SLA hours and
    // section refs — so only loose round hundreds are policed here. Prices on
    // the same lines are already handled by the $-anchored price rule.
    if (OFFER_LIMIT_RE.test(line) && !hasBookmark && !hasDevice) {
      for (const n of [...new Set(lineNumbers(line))]) {
        if (n !== 100 && n % 100 === 0 && !allowed.supplyCaps.has(n) && n < 10000) {
          failures.push(`${where}: offer supply cap ${n} is not canonical`);
        }
      }
    }

    // Recovery-phrase word counts. Guarded on recovery context so password
    // policy lines ("minimum 12 characters") never feed this rule.
    if (
      hasRecovery &&
      /recuperaci[óo]n|recupero|recovery|wiederherstellung|r[ée]cup[ée]ration|ripristino|odzyskiwan|восстановлен|復元|リカバリー|恢复|회복|kurtar|recuperare|กู้คืน|phục\s?hồi/i.test(normRaw)
    ) {
      for (const { n } of pairNumUnits(line, WORD_UNITS)) {
        if (n !== allowed.recoveryWords && n >= 8 && n <= 64) {
          failures.push(`${where}: recovery phrase claims ${n} words; RecoveryService enforces ${allowed.recoveryWords}`);
        }
      }
    }

    // Re-validation hours ("cada 48 horas", "Re-validation every 48 hours",
    // "48時間ごとに再検証").
    if (/re-?\s?validaci[óo]n|re-?validation|再検証/i.test(line)) {
      for (const { n } of pairNumUnits(line, HOUR_UNITS)) {
        if (n !== allowed.revalidationHours) {
          failures.push(`${where}: license re-validation claims ${n} hours; code says ${allowed.revalidationHours}`);
        }
      }
    }

    // Refund window ("30 días vía Whop", "30-day refund", "Rückerstattung 30 Tage").
    if (/reembols\w*|refund|R[üu]ckerstattung|remboursement|rimbors|返金|退款|devoluci[óo]n/i.test(line)) {
      for (const { n } of pairNumUnits(line, DAY_UNITS)) {
        if (n !== allowed.refundDays) {
          failures.push(`${where}: refund window claims ${n} days; pricing.ts says ${allowed.refundDays}`);
        }
      }
    }
  });

  return failures;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export function scanManuals(root = REPO_ROOT) {
  const truth = loadTruth(root);
  const allowed = allowedValueSets(truth);
  const failures = [];
  const missing = [];

  for (const rel of MANUAL_SOURCE_PATHS) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const src = readFileSync(abs, "utf8");
    const label = rel.split(/[\\/]/).pop() ?? rel;
    failures.push(...evaluateManual(src, allowed, label));
  }
  return { truth, failures, missing };
}

export function runManualFiguresGate(root = REPO_ROOT) {
  const { truth, failures, missing } = scanManuals(root);
  return { truth, failures, missing };
}

function main() {
  let result;
  try {
    result = runManualFiguresGate(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (result.missing.length) {
    console.error(`[check-manual-figures] FAIL: missing manual source(s):`);
    for (const rel of result.missing) console.error(`  - ${rel}`);
    process.exit(1);
  }
  if (result.failures.length) {
    console.error(`[check-manual-figures] FAIL: ${result.failures.length} manual figure drift(s):`);
    for (const f of result.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `[check-manual-figures] ok: 30 manuals agree with code (freeCap=${result.truth.freeMaxBookmarks}, ` +
      `devices={${result.truth.freeMaxDevices},${result.truth.proMaxDevices}}, ` +
      `prices=${result.truth.proEarlyBirdPrice}/${result.truth.proRegularPrice}, ` +
      `refund=${result.truth.refundDays}d, revalidation=${result.truth.revalidationHours}h, ` +
      `recovery=${result.truth.recoveryWords}w, minPassword=${result.truth.minPasswordLength})`,
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  main();
}
