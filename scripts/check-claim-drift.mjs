#!/usr/bin/env node
/**
 * scripts/check-claim-drift.mjs — factual claim-drift gate.
 *
 * Motivation: user-visible strings repeatedly drifted from real code behavior
 * (a "12-word seed" vs the real 24-word phrase; "minimum 8 characters" vs the
 * enforced 12; PBKDF2 advertised while the vault uses Argon2id V4 per
 * ADR-019; a 14-day money-back line vs refundDays: 30). All were caught by
 * manual audits. This gate makes the whole drift class detectable in CI: it
 * extracts the truth from src/constants/config.ts + src/constants/pricing.ts
 * and scans the user-visible surface for numbers that contradict it.
 *
 * Scanned surface:
 *   public/locales/*.json            (i18n files)
 *   public/*.html                    (landing, help, legal, localized pages)
 *   src/data/SupportKnowledge*.ts    (support-chat knowledge base)
 *
 * That surface is a glob, so all 30 landings are scanned — but a glob is a
 * property of the discovery code, not a contract. `landingCoverageFailures`
 * pins it against the locale registry: a landing the registry declares and
 * that exists under the scanned root must be inside the surface, so a
 * discovery that narrowed to a literal list (the shape these gates used to
 * have, five of them left behind at 6 languages) fails loudly instead of
 * reporting "no drift" over a shrinking corpus.
 *
 * Rules (each cites its truth source):
 *   recovery-words    — word-count claims must equal RecoveryService's phrase
 *                       length (24; bip39.generateMnemonic(256), 256/8 = 24).
 *   password-min      — minimum-password claims must equal
 *                       SECURITY_CONFIG.MIN_PASSWORD_LENGTH.
 *   devices           — device-count claims must equal some tier's maxDevices
 *                       in PRICING_CONFIG (tier-aware: "1 device" on Free and
 *                       "3 devices" on Pro are both valid).
 *   free-bookmarks    — bookmark-cap claims must equal some tier's maxBookmarks.
 *   free-bookmark-cap — FREE-tier bookmark claims must equal the free tier's
 *                       maxBookmarks (scalar anchor, fail-closed) and must
 *                       NOT use "unlimited" wording (that is Pro's promise):
 *                       same scalar + free/pro disambiguator design as
 *                       free-device-count, so the 1000 cap can't regress to
 *                       Infinity in copy without a red build.
 *   prohibited-kdf    — PBKDF2 must not appear in user-visible security copy
 *                       (vault KDF is Argon2id V4; PBKDF2 is legacy read-only).
 *   refund-window     — refund-window claims must equal
 *                       PRICING_CONFIG.lifetimeVersioned.refundDays.
 *   prices            — USD price tags on static pages must exist in
 *                       PRICING_CONFIG tier prices.
 *   upgrade-prices    — upgrade price tags must equal
 *                       upgradePriceNew/upgradePriceOwner.
 *   argon2-memory     — MiB parameters claimed for the vault KDF must match
 *                       ARGON2_PARAMS_{DESKTOP,MOBILE} in argon2-kdf.ts.
 *   auto-backup-hours — auto-backup interval claims must equal
 *                       AUTO_BACKUP_INTERVAL_MS in BackupService.ts.
 *   backup-stale-hours— stale-backup banner claims must equal
 *                       BACKUP_STALE_MS in StorageStatus.tsx.
 *   sync-devices      — hyphenated sync claims ("3-device sync") are covered
 *                       by the devices rule (3 is a tier maxDevices value).
 *
 * Design constraints:
 *   - Plain Node (no TS toolchain): truth extraction is regex-based and
 *     FAIL-CLOSED — if a constant cannot be located (refactor renamed it),
 *     every claim of that class is reported as drift with an explicit
 *     "truth missing" message instead of the gate silently passing.
 *   - Tier-aware verdicts: a numeric claim is valid if it matches ANY tier's
 *     configured value, so adding a tier never breaks existing true claims.
 *
 * Exit codes: 0 = no drift, 1 = drift found, 2 = usage / IO error.
 *
 * Usage:
 *   node scripts/check-claim-drift.mjs                 # gate mode
 *   node scripts/check-claim-drift.mjs --root <dir>    # scan a different tree
 *   node scripts/check-claim-drift.mjs --json          # machine-readable report
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const DEFAULT_ROOT = process.cwd();
/** RecoveryService truth: bip39.generateMnemonic(256) → 24 words. */
const RECOVERY_WORDS = 24;
// ── CLI ──────────────────────────────────────────────────────────────────────
let ROOT = DEFAULT_ROOT;
let JSON_OUTPUT = false;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--root" && process.argv[i + 1]) {
    ROOT = process.argv[++i];
  } else if (process.argv[i] === "--json") {
    JSON_OUTPUT = true;
  } else if (process.argv[i] === "--help" || process.argv[i] === "-h") {
    console.log("Usage: node scripts/check-claim-drift.mjs [--root <dir>] [--json]");
    process.exit(0);
  } else if (process.argv[i].startsWith("-")) {
    console.error(`check-claim-drift: unknown flag ${process.argv[i]}`);
    process.exit(2);
  }
}

// ── Truth extraction ─────────────────────────────────────────────────────────
/**
 * Pull the enforced constants out of the source files. Every field ends up in
 * one of two shapes:
 *   - scalar (minPasswordLength, refundDays): null = NOT FOUND = fail-closed.
 *   - set (deviceCounts, bookmarkCaps, prices, upgradePrices): a claim is
 *     valid iff it is a member, so tier variety never breaks true claims.
 */
export function extractTruth(configSrc, pricingSrc, extras = {}) {
  const truth = {
    minPasswordLength: null,
    recoveryWords: RECOVERY_WORDS,
    deviceCounts: new Set(),
    freeDeviceCap: null,
    bookmarkCaps: new Set(),
    freeBookmarkCap: null,
    refundDays: null,
    prices: new Set(),
    upgradePrices: new Set(),
    b2bYearlyPrices: new Set(),
    argonMiB: new Set(),
    autoBackupHours: null,
    backupStaleHours: null,
  };

  const minPw = configSrc.match(/MIN_PASSWORD_LENGTH:\s*(\d+)/);
  if (minPw) truth.minPasswordLength = Number(minPw[1]);

  for (const m of pricingSrc.matchAll(/maxDevices:\s*(\d+)/g)) {
    truth.deviceCounts.add(Number(m[1]));
  }
  // Free tier's device cap: maxDevices inside the tier object whose id is
  // "free". Under the any-device policy that number is 0 (unlimited installs,
  // per-device vaults); it is a SCALAR (not a set) so the free-device-count
  // rule below is fail-closed: Free copy may ONLY claim this exact number.
  const freeTier = pricingSrc.match(/id:\s*"free"[\s\S]*?maxDevices:\s*(\d+)/);
  if (freeTier) truth.freeDeviceCap = Number(freeTier[1]);
  for (const m of pricingSrc.matchAll(/maxBookmarks:\s*(\d+)/g)) {
    truth.bookmarkCaps.add(Number(m[1]));
  }
  // Free tier's bookmark cap: maxBookmarks inside the tier object whose id is
  // "free". SCALAR (not a set) so the free-bookmark-cap rule is fail-closed:
  // Free copy may only claim this exact number, and "unlimited" wording (the
  // Pro promise) never passes.
  const freeBookmarkTier = pricingSrc.match(/id:\s*"free"[\s\S]*?maxBookmarks:\s*(\d+)/);
  if (freeBookmarkTier) truth.freeBookmarkCap = Number(freeBookmarkTier[1]);
  const refund = pricingSrc.match(/refundDays:\s*(\d+)/);
  if (refund) truth.refundDays = Number(refund[1]);
  // Tier price lines are indented exactly 6 spaces ("      price: 79,") —
  // anchors out unrelated "price" mentions elsewhere in the file.
  for (const m of pricingSrc.matchAll(/^\s{6}price:\s*(\d+(?:\.\d+)?),\s*$/gm)) {
    truth.prices.add(Number(m[1]));
  }
  // Early-bird display price ("earlyBirdPrice: 59") is advertised on the
  // landing pages — a true claim, so it belongs in the valid set too.
  for (const m of pricingSrc.matchAll(/earlyBirdPrice:\s*(\d+(?:\.\d+)?)/g)) {
    truth.prices.add(Number(m[1]));
  }
  // B2B annual license prices ("pricePerYear: 2500") appear on the legal
  // page as dollar amounts — true claims, accepted by the prices rule.
  truth.b2bYearlyPrices = new Set();
  for (const m of pricingSrc.matchAll(/pricePerYear:\s*(\d+(?:\.\d+)?)/g)) {
    truth.b2bYearlyPrices.add(Number(m[1]));
  }
  for (const m of pricingSrc.matchAll(/upgradePrice(?:New|Owner):\s*(\d+(?:\.\d+)?)/g)) {
    truth.upgradePrices.add(Number(m[1]));
  }

  // Argon2id memory cost: KiB values (with digit separators) → MiB.
  for (const m of (extras.kdfSrc ?? "").matchAll(
    /ARGON2_PARAMS_(?:DESKTOP|MOBILE)\s*=\s*\{[^}]*?m:\s*([\d_]+)/g,
  )) {
    const kib = Number(m[1].replace(/_/g, ""));
    if (Number.isFinite(kib) && kib % 1024 === 0) truth.argonMiB.add(kib / 1024);
  }
  truth.autoBackupHours = extractHoursFromMs(extras.backupSrc, "AUTO_BACKUP_INTERVAL_MS");
  truth.backupStaleHours = extractHoursFromMs(extras.storageStatusSrc, "BACKUP_STALE_MS");

  return truth;
}

/**
 * Hours from an "<NAME> = N * 60 * 60 * 1000" declaration (plain-millisecond
 * form accepted as a fallback when it divides into whole hours).
 * null = not located = fail-closed.
 */
function extractHoursFromMs(src, name) {
  if (!src) return null;
  const product = src.match(
    new RegExp(String.raw`${name}\s*=\s*(\d+)\s*\*\s*60\s*\*\s*60\s*\*\s*1000`),
  );
  if (product) return Number(product[1]);
  const plain = src.match(new RegExp(String.raw`${name}\s*=\s*(\d{7,})\b`));
  if (plain && Number(plain[1]) % 3_600_000 === 0) return Number(plain[1]) / 3_600_000;
  return null;
}

/** Serialize Sets for reports/tests. */
export function truthSummary(t) {
  return {
    // Do not emit the password policy through the JSON/console diagnostic path.
    // The policy remains enforced and is still surfaced in drift errors.
    recoveryWords: t.recoveryWords,
    deviceCounts: [...t.deviceCounts].sort((a, b) => a - b),
    freeDeviceCap: t.freeDeviceCap,
    bookmarkCaps: [...t.bookmarkCaps].sort((a, b) => a - b),
    freeBookmarkCap: t.freeBookmarkCap,
    refundDays: t.refundDays,
    prices: [...t.prices].sort((a, b) => a - b),
    upgradePrices: [...t.upgradePrices].sort((a, b) => a - b),
    b2bYearlyPrices: [...t.b2bYearlyPrices].sort((a, b) => a - b),
    argonMiB: [...t.argonMiB].sort((a, b) => a - b),
    autoBackupHours: t.autoBackupHours,
    backupStaleHours: t.backupStaleHours,
  };
}

// ── Surface discovery ────────────────────────────────────────────────────────
/** Collect the user-visible claim surface as { path, kind } entries. */
export function discoverSurface(root) {
  const files = [];

  const localesDir = join(root, "public", "locales");
  if (existsSync(localesDir)) {
    for (const f of readdirSync(localesDir)) {
      if (f.endsWith(".json")) files.push({ path: join(localesDir, f), kind: "locale" });
    }
  }

  const publicDir = join(root, "public");
  if (existsSync(publicDir)) {
    for (const f of readdirSync(publicDir)) {
      if (f.endsWith(".html")) files.push({ path: join(publicDir, f), kind: "html" });
    }
  }

  const dataDir = join(root, "src", "data");
  if (existsSync(dataDir)) {
    for (const f of readdirSync(dataDir)) {
      if (/^SupportKnowledge.*\.ts$/.test(f)) {
        files.push({ path: join(dataDir, f), kind: "ts" });
      }
    }
  }

  return files;
}

/** OS-independent form of a path: discovery builds with join(), synthetic
 * tests build with forward slashes, and both must compare equal. */
function posixPath(value) {
  return String(value).split(sep).join("/");
}

/**
 * Landing coverage pin — is every registered landing inside the scanned
 * surface? Returns failure strings (empty = covered).
 *
 * Derived from the locale registry rather than from a second hand-kept list:
 * the registry is the single source for what a landing page IS (file, path,
 * locale), so the pin cannot drift from the pages it is supposed to cover.
 *
 * A page that does not exist under `root` is skipped on purpose: page
 * existence is check:page-figures / check:landings-fresh's business, and a
 * synthetic fixture tree legitimately holds a subset. What is asserted here is
 * COVERAGE — an existing landing page that the scanner would not read.
 *
 * Pure and parameterised so the suite can drive it with synthetic surfaces;
 * `registryLandingFiles` supplies the real list.
 */
export function landingCoverageFailures(surface, landingFiles, root) {
  const scanned = new Set(surface.map((f) => posixPath(f.path)));
  const failures = [];
  for (const rel of landingFiles) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    if (!scanned.has(posixPath(abs))) {
      failures.push(
        `${rel}: landing page declared by the locale registry exists but is outside ` +
          "the scanned surface — discoverSurface() must cover every locale",
      );
    }
  }
  return failures;
}

/**
 * Landing files declared by `<root>/scripts/landing-registry.mjs`, or null
 * when that tree has no registry (synthetic fixtures in the suite): the pin
 * then does not apply — the same convention as the optional corpus entries in
 * check-license-claims. Null is not a pass: it means "nothing to pin here",
 * and the repo tree always has the registry.
 */
export async function registryLandingFiles(root) {
  const registry = join(root, "scripts", "landing-registry.mjs");
  if (!existsSync(registry)) return null;
  const mod = await import(pathToFileURL(registry).href);
  return mod.LANDING_LOCALES.map((l) => l.file);
}

// ── Claim patterns ───────────────────────────────────────────────────────────
/**
 * Multilingual unit nouns. Unicode escapes keep it readable; explicit
 * alternatives cover the language-specific unit nouns. NOTE: CJK nouns are
 * split deliberately — 文字/字符/字/자 are CHARACTER counters (password rule),
 * while 単語/词/단어 are WORD counters (recovery rule). Mixing them would make
 * a Japanese "12文字" password line trip the 24-word recovery rule.
 */
const CHAR_UNIT =
  "characters?|caractères?|caracteres?|caratteri|Zeichen|Charaktere?|znak(?:ů|ova|ów|ov[ai])?|karakter(?:ler)?|tegn|tecken|teikn|merkkiä|文字|字符|글자|символ(?:ов|а|ів|ы)?|характер(?:а|и)?|χαρακτήρες|chars?\\b|अक्षर|ตัวอักษร|حرف|أحرف|תווים|자(?![가-힣])";
const WORD_UNIT =
  "words?|WORDS?|mots?|palabras?|palavras?|parole|Wörter|woorden|ord(?:ene)?|sanaa|sanat|słowa|słowo|単語|词|词语|單詞|단어|cuvinte|slova|slov(?:o|á)?|слов(?:а|о)?|слів|дум(?:и|ите)?|kelime|kata|كلمات|كلمة|מילים|शब्द|từ";
const DEVICE_UNIT =
  "devices?|Devices?|Geräte[ns]?|dispositiv\w*|dispositivos?|dispositius?|dispositifs?|设备(?:数量)?|デバイス|기기|устройств\w*|zařízení(?:ch)?|eszköz(?:ön)?|perangkat|enheter|appareils?";
/**
 * Free/pro disambiguators for the free-device rule: a line counts as FREE-tier
 * copy if it names Free (any of the 30 locales' "free/gratis/gratuit/kostenlos/…"
 * or a locale JSON key like app_freeTier*) and does NOT lean on the paid tiers
 * (pro/unlock) — "Free forever. Pro unlocks 3-device sync" must not be
 * treated as Free copy.
 */
const FREE_TIER_CONTEXT =
  "free|gratis|gratuit[oa]?|gratuit|kostenlos|免费|無料|무료|бесплатн|ücretsiz|مجانا?|grátis|app_freeTier|app_free";
const PRO_TIER_CONTEXT =
  "pro\b|pro\.|unlock|unlocks|desbloque|débloque|freischalt|premium\b|app_pro";
const BOOKMARK_UNIT =
  "bookmarks?|Bookmarks?|marcadores?|marcadors?|Lesezeichen|ブックマーク|书签|즐겨찾기|закладок|záložky|könyvjelző|penanda";
/**
 * "Unlimited" wording in the bookmark domain (the PRO promise). The
 * free-bookmark-cap rule treats any of these in Free-tier copy as drift
 * regardless of numbers — the cap is 1000, never unlimited. Covers the 30
 * locales' main families: unlimited/unlimited/unlimited/unlimited/unlimited/
 * unlimited/unlimited/unlimited/no limit/sin límites.
 */
const UNLIMITED_CONTEXT =
  "unlimited|ilimitad|illimitat|illimité|unbegrenz|onbeperkt|ogr?aniczen|neomezen|korlátlan|無制限|无限|無限|무제한|безлимит|неограничен|sınırsız|غير محدود|sin límite|no limit";
const MONEY_BACK =
  "refund|money[- ]back|reembolso|devoluci|garant|guarantee|rückerstatt|remboursement|rimbors";

/** Hour unit nouns across locales (backup interval + stale-age claims). */
const HOUR_UNIT =
  "hours?|hrs?|horas?|Stunden?|heures?|ore|godzin\\w*|hodin\\w*|óra|uur|tuntia|時間|小时|小時|시간|час\\w*|годин\\w*|ساعات?|ชั่วโมง|giờ";

/**
 * Backup context gate: the hour rules only fire on lines that talk about
 * backups (the claim classes they police). In locale JSON the English key
 * name (…Backup…) sits on the same line as the localized value, so the gate
 * also works for the 30 languages.
 */
const BACKUP_CONTEXT_RE = new RegExp(
  String.raw`backup|back-up|sicherung|sauvegard|cop[ií]a|respald\w*|kopie|kopi\w*|záloh\w*|копи\w*|архив|백업|バックアップ|备份|สำรอง|نسخ|sao lưu`,
  "iu",
);

/**
 * "<qualifier> N hours" — interval wording (every/cada/alle/toutes les/…).
 * Boundaries are Unicode-letter lookarounds, NOT \b: \b is ASCII-\w based, so
 * "über"/"älter" (non-ASCII first letter) could never match a \b…\b pair.
 */
const NB_L = String.raw`(?<![\p{L}\p{N}])`;
const NB_R = String.raw`(?![\p{L}\p{N}])`;

const INTERVAL_QUALIFIER =
  NB_L +
  String.raw`(?:every|cada|toutes?|tous|alle|ogni|elke|co)` +
  NB_R +
  String.raw`\s*(?:les\s+)?\s*` +
  String.raw`|кажд\S*|кожн\S*|всеки|كل|ทุก|mỗi|每`;

/** "<qualifier> N hours" — stale-age wording (over/more than/older than/…). */
const STALE_QUALIFIER =
  NB_L +
  String.raw`(?:over|more than|older than|más de|über|älter als|plus de|più di|mais de|meer dan|více než|starší než|hơn)` +
  NB_R +
  String.raw`\s*` +
  String.raw`|старше|более|больше(?:\s+ніж)?|більше(?:\s+ніж)?|повече от|超过|超過|أكثر من|มากกว่า`;
/** CJK/Korean stale wording puts the qualifier AFTER the number (48時間以上). */
const STALE_CJK_SUFFIX = String.raw`以上|超過|超过|이상`;

/** Statically known-safe lines (never a factual security/pricing claim). */
const BASELINE_ALLOWLIST = [
  // AI model download sizes / hardware floors are factual about model files.
  /modelGemma2b/i,
  /app_size\d/i,
  /ai_modelDownloadWarning/,
  /WebLLM (is not available|cannot run)/,
  /app_diagWebLLMBlockerRAM/,
  // Time-window UI copy is backed by its own code constants, not pricing.
  /ephemeral_\d+days/,
  // Safari's IndexedDB eviction window is a browser fact, not our constant.
  // NOTE: the backup hour claims (app_backupStaleWarning, backup_bannerStale
  // Desc, app_onboardingBackupDesc) are deliberately NOT allowlisted — they
  // are policed by the auto-backup-hours / backup-stale-hours rules against
  // their own code constants.
  /app_evictionRiskDesc/,
  // "100% offline" is a capability claim, not a price.
  /100\s*%\s*offline/i,
];

/**
 * Rules fire per matched line. verdict(match, truth) returns null (ok) or a
 * drift description string.
 */
export function buildRules(truth) {
  return [
    {
      id: "recovery-words",
      description: `recovery-phrase word count must equal ${truth.recoveryWords} (RecoveryService)`,
      re: new RegExp(String.raw`(\d+)[\s\-]+(?:${WORD_UNIT})\b`, "u"),
      verdict(m) {
        const n = Number(m[1]);
        if (n === truth.recoveryWords) return null;
        return `claims ${n}-word phrase; RecoveryService enforces ${truth.recoveryWords} words`;
      },
    },
    {
      id: "password-min",
      description:
        "character-count claims in security copy must equal SECURITY_CONFIG.MIN_PASSWORD_LENGTH",
      // Unqualified on purpose: a "<N> characters" shape in user-visible copy
      // is virtually always the password policy (or a string we must allow
      // explicitly). Qualifier-based matching missed half the 30 locales
      // ("alespoň", "legalább", "vähintään", "поне", …).
      re: new RegExp(String.raw`(\d+)\s*个?\s*(?:${CHAR_UNIT})`, "iu"),
      verdict(m) {
        if (truth.minPasswordLength == null) {
          return "MIN_PASSWORD_LENGTH missing from src/constants/config.ts (refactor?) — fail-closed";
        }
        const n = Number(m[1]);
        if (n === truth.minPasswordLength) return null;
        return `claims ${n}-character minimum; code enforces ${truth.minPasswordLength}`;
      },
    },
    {
      id: "devices",
      description: "device-count claims must equal some tier maxDevices in pricing.ts",
      // [-\s] separator: also catches hyphenated sync claims ("3-device sync").
      re: new RegExp(String.raw`(\d+)[-\s]+(?:${DEVICE_UNIT})`, "iu"),
      verdict(m) {
        const n = Number(m[1]);
        if (truth.deviceCounts.has(n)) return null;
        return `claims ${n} device(s); pricing.ts maxDevices values: ${fmtSet(truth.deviceCounts)}`;
      },
    },
    {
      id: "free-device-count",
      description: `Free-tier device-count claims must equal the free tier's maxDevices (${truth.freeDeviceCap ?? "MISSING"}) — any-device policy`,
      // Scoped to lines that plausibly describe the FREE tier (see the
      // FREE_TIER_CONTEXT / PRO_TIER_CONTEXT disambiguators above): "free"-named
      // copy without a pro/unlock lean. This is what makes the
      // any-device positioning non-regressible — reverting Free to "1 device"
      // in any marketing surface fails the gate here.
      context: new RegExp(String.raw`(?:${FREE_TIER_CONTEXT})`, "iu"),
      antiContext: new RegExp(String.raw`(?:${PRO_TIER_CONTEXT})`, "iu"),
      re: new RegExp(String.raw`(\d+)[-\s]+(?:${DEVICE_UNIT})`, "iu"),
      verdict(m) {
        if (truth.freeDeviceCap == null) {
          return "free tier maxDevices missing from src/constants/pricing.ts (refactor?) — fail-closed";
        }
        const n = Number(m[1]);
        if (n === truth.freeDeviceCap) return null;
        return `Free-tier copy claims ${n} device(s); the free tier sets maxDevices: ${truth.freeDeviceCap} (any-device policy)`;
      },
    },
    {
      id: "free-bookmarks",
      description: "bookmark-cap claims must equal some tier maxBookmarks in pricing.ts",
      // Word boundary after the unit: "© 2026 BookmarkForge" must not read
      // as "2026 bookmarks" (BookmarkForge starts with "Bookmark").
      re: new RegExp(String.raw`(\d{1,3}(?:[.,\s]\d{3})+|\d{3,})\s+(?:${BOOKMARK_UNIT})\b`, "iu"),
      verdict(m) {
        const n = Number(m[1].replace(/[.,\s]/g, ""));
        if (truth.bookmarkCaps.has(n)) return null;
        return `claims ${m[1]} bookmarks; pricing.ts maxBookmarks values: ${fmtSet(truth.bookmarkCaps)}`;
      },
    },
    {
      id: "free-bookmark-cap",
      description: `Free-tier bookmark claims must equal the free tier's maxBookmarks (${truth.freeBookmarkCap ?? "MISSING"}) and must not say "unlimited" — scalar anchor, any-device-era policy`,
      // Same design as free-device-count: lines plausibly describing FREE
      // (free/gratis/… or app_freeTier* key names) without a pro/unlock lean.
      // Pro's mixed lines ("Free forever. Pro unlocks unlimited bookmarks")
      // stay with the tier-aware free-bookmarks/devices rules.
      context: new RegExp(String.raw`(?:${FREE_TIER_CONTEXT})`, "iu"),
      antiContext: new RegExp(String.raw`(?:${PRO_TIER_CONTEXT})`, "iu"),
      // Branch 1: "unlimited" wording in the bookmark/save domain — drift
      // regardless of numbers (the cap is 1000, never unlimited).
      re: new RegExp(
        String.raw`(?:${UNLIMITED_CONTEXT})[^.\n]{0,80}?(?:${BOOKMARK_UNIT}|saves?|guardad\w*|speicher\w*)|(?:${BOOKMARK_UNIT}|saves?|guardad\w*|speicher\w*)[^.\n]{0,80}?(?:${UNLIMITED_CONTEXT})`,
        "iu",
      ),
      // Branch 2: a concrete count that isn't the free scalar.
      re2: new RegExp(String.raw`(\d{1,3}(?:[.,\s]\d{3})+|\d{3,})\s+(?:${BOOKMARK_UNIT})\b`, "iu"),
      verdict(m) {
        if (truth.freeBookmarkCap == null) {
          return "free tier maxBookmarks missing from src/constants/pricing.ts (refactor?) — fail-closed";
        }
        // Branch 1 (no digits): unlimited wording is the drift itself.
        if (!/\d/.test(m[0])) {
          return `Free-tier copy claims unlimited bookmarks; the free tier sets maxBookmarks: ${truth.freeBookmarkCap} (unlimited is the Pro promise)`;
        }
        const n = Number(m[1].replace(/[.,\s]/g, ""));
        if (n === truth.freeBookmarkCap) return null;
        return `Free-tier copy claims ${m[1]} bookmarks; the free tier sets maxBookmarks: ${truth.freeBookmarkCap}`;
      },
    },
    {
      id: "prohibited-kdf",
      description: "PBKDF2 must not appear in user-visible security copy (vault = Argon2id V4)",
      re: /PBKDF2/i,
      verdict() {
        return "PBKDF2 named in user-visible copy; the vault KDF is Argon2id V4 (ADR-019) — PBKDF2 is legacy read-only";
      },
    },
    {
      id: "refund-window",
      description: `refund-window claims must equal PRICING_CONFIG refundDays (${truth.refundDays ?? "MISSING"})`,
      re: new RegExp(
        String.raw`(\d+)\s*[- ]?\s*(?:days?|días?|dias?|tage|jours?)[^.]{0,60}?(?:${MONEY_BACK})`,
        "iu",
      ),
      re2: new RegExp(
        String.raw`(?:${MONEY_BACK})[^.]{0,60}?(\d+)\s*[- ]?\s*(?:days?|días?|dias?|tage|jours?)`,
        "iu",
      ),
      verdict(m) {
        if (truth.refundDays == null) {
          return "refundDays missing from src/constants/pricing.ts (refactor?) — fail-closed";
        }
        const n = Number(m[1]);
        if (n === truth.refundDays) return null;
        return `claims a ${n}-day refund window; pricing.ts sets refundDays: ${truth.refundDays}`;
      },
    },
    {
      id: "prices",
      description: "USD price tags in user-visible copy must exist in PRICING_CONFIG",
      re: /\$\s?([\d][\d.,]*)\b/,
      verdict(m) {
        const n = parseDollar(m[1]);
        if (n == null) return null; // not a price-shaped number
        // Upgrade ($35/$89) and B2B annual ($2,500…) amounts are legit
        // dollar claims on the pages — accept the union of truth sets.
        if (
          truth.prices.has(n) ||
          truth.upgradePrices.has(n) ||
          truth.b2bYearlyPrices.has(n)
        ) {
          return null;
        }
        return `price $${n} not in PRICING_CONFIG prices: ${fmtSet(truth.prices)} (upgrade: ${fmtSet(truth.upgradePrices)}, b2b/year: ${fmtSet(truth.b2bYearlyPrices)})`;
      },
    },
    {
      id: "upgrade-prices",
      description: "upgrade prices must equal upgradePriceNew/upgradePriceOwner",
      re: /\$\s?(\d+)\s*(?:for|para|für|pour)\s+(?:v2|v3|new|existing|owners?|customers?|actuales?|Bestandskunden|neue)/i,
      verdict(m) {
        const n = Number(m[1]);
        if (truth.upgradePrices.has(n)) return null;
        return `upgrade price $${n} not in pricing.ts upgrade prices: ${fmtSet(truth.upgradePrices)}`;
      },
    },
    {
      id: "argon2-memory",
      description:
        "vault-KDF MiB claims must match ARGON2_PARAMS_{DESKTOP,MOBILE} in argon2-kdf.ts",
      re: /(\d+)\s*MiB\b/i,
      verdict(m) {
        const n = Number(m[1]);
        if (truth.argonMiB.has(n)) return null;
        if (truth.argonMiB.size === 0) {
          return `${n} MiB claimed but ARGON2_PARAMS_{DESKTOP,MOBILE} not found in src/utils/argon2-kdf.ts (refactor?) — fail-closed`;
        }
        return `claims ${n} MiB for the vault KDF; argon2-kdf.ts sets ARGON2_PARAMS memory: {${fmtSet(truth.argonMiB)}} MiB (desktop, mobile)`;
      },
    },
    {
      id: "auto-backup-hours",
      description: `auto-backup interval claims must equal AUTO_BACKUP_INTERVAL_MS in BackupService.ts (${truth.autoBackupHours ?? "MISSING"} hours)`,
      context: BACKUP_CONTEXT_RE,
      re: new RegExp(
        String.raw`(?:${INTERVAL_QUALIFIER})\s*(\d+)\s*(?:${HOUR_UNIT})|(\d+)\s*(?:${HOUR_UNIT})\s*(?:ごと|마다)`,
        "iu",
      ),
      verdict(m) {
        if (truth.autoBackupHours == null) {
          return "AUTO_BACKUP_INTERVAL_MS missing from src/services/BackupService.ts (refactor?) — fail-closed";
        }
        const n = Number(m[1] || m[2]);
        if (n === truth.autoBackupHours) return null;
        return `claims auto-backups run every ${n} hours; BackupService.ts sets AUTO_BACKUP_INTERVAL_MS = ${truth.autoBackupHours} hours`;
      },
    },
    {
      id: "backup-stale-hours",
      description: `stale-backup claims must equal BACKUP_STALE_MS in StorageStatus.tsx (${truth.backupStaleHours ?? "MISSING"} hours)`,
      context: BACKUP_CONTEXT_RE,
      re: new RegExp(
        String.raw`(?:${STALE_QUALIFIER})\s*(\d+)\s*(?:${HOUR_UNIT})`,
        "iu",
      ),
      re2: new RegExp(
        String.raw`(\d+)\s*(?:${HOUR_UNIT})\s*(?:${STALE_CJK_SUFFIX})`,
        "iu",
      ),
      verdict(m) {
        if (truth.backupStaleHours == null) {
          return "BACKUP_STALE_MS missing from src/components/StorageStatus.tsx (refactor?) — fail-closed";
        }
        const n = Number(m[1]);
        if (n === truth.backupStaleHours) return null;
        return `claims a backup goes stale after ${n} hours; StorageStatus.tsx sets BACKUP_STALE_MS = ${truth.backupStaleHours} hours`;
      },
    },
  ];
}

function fmtSet(set) {
  return [...set].sort((a, b) => a - b).join(", ") || "(none)";
}

/**
 * Parse a dollar amount with locale-aware separators:
 *   "79" → 79   "59.99" → 59.99   "2,500" → 2500   "1,234.56" → 1234.56
 * Returns null for shapes that are not a price (e.g. trailing separator).
 */
export function parseDollar(raw) {
  const s = raw.replace(/\s/g, "");
  if (!/^\d+([.,]\d+)*$/.test(s)) return null;
  if (/^\d{1,3}(,\d{3})+([.]\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^\d{1,3}(\.\d{3})+([,]\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s.replace(",", "."));
}

// ── Allowlist ────────────────────────────────────────────────────────────────
/**
 * Competitor pricing comparison (help.html pricing FAQ): dollar amounts that
 * describe OTHER products' subscriptions, not BookmarkForge's.
 *
 * These amounts are STRIPPED from the line rather than skipping the line:
 * a sentence mixing a competitor price with our own ("Raindrop is $28/y but
 * Pro is $49") must still be checked. Adding a competitor name is the
 * documented extension point — the allowlist lives here, not in a skip-list
 * that would let our own price hide behind a competitor's name.
 */
/**
 * Diagnostic/example boxes quote runtime values ("Vault: 847 bookmarks,
 * 12 docs") — samples of output, not product claims. Line-level skip is safe
 * because the same line cannot contain a real product claim by construction.
 */
const DIAGNOSTIC_EXAMPLE_RE = /class="diag-box"|Vault:\s*\d+|diagnostic/i;

/** Competitor-adjacent price tokens, e.g. "Raindrop Pro $28–38/y". */
const COMPETITOR_PRICE_RE =
  /\b(?:Raindrop(?:\.io)?|Instapaper|Readwise|Capacities|Pinboard|Pocket|Diigo)[^$]*?\$\s?[\d][\d.,]*/gi;

function isAllowed(text) {
  if (BASELINE_ALLOWLIST.some((re) => re.test(text))) return true;
  if (DIAGNOSTIC_EXAMPLE_RE.test(text)) return true;
  return false;
}

/** Pre-process a line: mask competitor prices so our own still get scanned. */
function neutralizeCompetitorPrices(text) {
  if (!/\$/.test(text)) return text;
  return text.replace(COMPETITOR_PRICE_RE, (m) => "$".repeat(m.length));
}

// ── Scanning ─────────────────────────────────────────────────────────────────
/** Scan one file; returns [{ rule, line, lineNo, match, drift }] hits. */
export function scanFile(filePath, kind, rules) {
  const src = readFileSync(filePath, "utf8");
  const hits = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (isAllowed(line)) continue;
    line = neutralizeCompetitorPrices(line);
    for (const rule of rules) {
      if (rule.appliesTo && !rule.appliesTo.kinds.includes(kind)) continue;
      if (rule.context && !rule.context.test(line)) continue;
      if (rule.antiContext && rule.antiContext.test(line)) continue;
      const m = line.match(rule.re) || (rule.re2 ? line.match(rule.re2) : null);
      if (!m) continue;
      const drift = rule.verdict(m);
      if (drift) {
        hits.push({
          rule: rule.id,
          line: line.trim().slice(0, 200),
          lineNo: i + 1,
          match: m[0],
          drift,
        });
      }
    }
  }
  return hits;
}

/**
 * Scan the whole surface. `sources` lets tests inject config/pricing sources;
 * in gate mode they are read from src/constants/.
 */
export function scanSurface({ root = DEFAULT_ROOT, sources } = {}) {
  const configPath = join(root, "src", "constants", "config.ts");
  const pricingPath = join(root, "src", "constants", "pricing.ts");
  const configSrc = sources?.configSrc ?? readFileSync(configPath, "utf8");
  const pricingSrc = sources?.pricingSrc ?? readFileSync(pricingPath, "utf8");
  // Optional truth sources: a missing file yields undefined → the rules built
  // on it are fail-closed (they only bite if matching claims exist).
  const readOptional = (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  };
  const truth = extractTruth(configSrc, pricingSrc, {
    kdfSrc: sources?.kdfSrc ?? readOptional(join(root, "src", "utils", "argon2-kdf.ts")),
    backupSrc:
      sources?.backupSrc ?? readOptional(join(root, "src", "services", "BackupService.ts")),
    storageStatusSrc:
      sources?.storageStatusSrc ??
      readOptional(join(root, "src", "components", "StorageStatus.tsx")),
  });

  // Open Core export: BackupService is a proprietary module the export replaces
  // with a placeholder pair, so its AUTO_BACKUP_INTERVAL_MS truth physically
  // cannot be in this tree. The export embeds the enforced constants in the
  // generated declaration's banner (see pro-boundary.mjs), so the truth source
  // here is the placeholder — the gate stays fail-closed (a placeholder with no
  // pinned constant still fails any matching claim) and no rule is weakened.
  if (truth.autoBackupHours == null) {
    const placeholderDecl = readOptional(join(root, "src", "services", "BackupService.d.ts"));
    if (placeholderDecl?.includes("Open Core placeholder")) {
      truth.autoBackupHours = extractHoursFromMs(placeholderDecl, "AUTO_BACKUP_INTERVAL_MS");
    }
  }

  const rules = buildRules(truth);
  const results = [];
  for (const f of discoverSurface(root)) {
    const hits = scanFile(f.path, f.kind, rules);
    if (hits.length) results.push({ file: f.path, kind: f.kind, hits });
  }
  return { truth, results };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  let report;
  try {
    report = scanSurface({ root: ROOT });
  } catch (err) {
    console.error(`check-claim-drift: ${err.message}`);
    process.exit(2);
  }

  // Coverage pin (top-level await: the registry is ESM and belongs to `--root`).
  const declaredLandings = await registryLandingFiles(ROOT);
  const coverage = declaredLandings
    ? landingCoverageFailures(discoverSurface(ROOT), declaredLandings, ROOT)
    : [];
  const claims = report.results.reduce((n, r) => n + r.hits.length, 0);
  const total = claims + coverage.length;
  if (JSON_OUTPUT) {
    console.log(
      JSON.stringify(
        { ...report, coverage, truth: truthSummary(report.truth), total },
        replacerSets,
        2,
      ),
    );
    process.exit(total ? 1 : 0);
  }

  if (total === 0) {
    console.log(
      `check-claim-drift: OK — ${discoverSurface(ROOT).length} files scanned, no factual drift ` +
        `(` +
        `devices={${fmtSet(report.truth.deviceCounts)}}, bookmarkCaps={${fmtSet(report.truth.bookmarkCaps)}}, ` +
        `refundDays=${report.truth.refundDays}, prices={${fmtSet(report.truth.prices)}}, ` +
          `argon2MiB={${fmtSet(report.truth.argonMiB)}}, autoBackup=${report.truth.autoBackupHours}h, ` +
          `staleAfter=${report.truth.backupStaleHours}h)`,
    );
    process.exit(0);
  }

  if (coverage.length) {
    console.error(`check-claim-drift: ${coverage.length} landing coverage gap(s):\n`);
    for (const gap of coverage) console.error(`  - ${gap}`);
    console.error("");
  }
  if (claims) {
    console.error(`check-claim-drift: ${claims} drifted claim(s) in ${report.results.length} file(s):\n`);
    for (const r of report.results) {
      for (const h of r.hits) {
        console.error(`  ${r.file}:${h.lineNo}  [${h.rule}]  ${h.drift}`);
        console.error(`    > ${h.line}`);
      }
    }
    console.error(
      "\nFix the STRINGS (preferred) or, if the CODE changed, update the truth source",
    );
    console.error(
      "(src/constants/config.ts / src/constants/pricing.ts) — never silence a true claim.",
    );
  }
  process.exit(1);
}

function replacerSets(_key, value) {
  if (value instanceof Set) return [...value].sort((a, b) => a - b);
  return value;
}
