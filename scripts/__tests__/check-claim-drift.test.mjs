// @vitest-environment node
/**
 * scripts/__tests__/check-claim-drift.test.mjs
 *
 * Tests for the factual claim-drift gate (scripts/check-claim-drift.mjs):
 *   - truth extraction from src/constants/config.ts + pricing.ts shapes
 *     plus argon2-kdf.ts / BackupService.ts / StorageStatus.tsx extras,
 *     including FAIL-CLOSED behavior when a constant cannot be located,
 *   - every rule's verdict in both directions (true claim passes, drifted
 *     number fails) across the multilingual unit nouns the scanner knows,
 *   - the documented allowlist extension points (competitor pricing rows,
 *     diagnostic example boxes),
 *   - a freeze test on the REAL repo tree (the same battery CI runs),
 *   - CLI exit codes (0 clean / 1 drift / 2 usage-IO).
 *
 * The historical drifts this gate exists for (12-word seed, 8-char minimum,
 * PBKDF2 advertising, 14-day money-back) are all encoded here as regression
 * fixtures — deleting a rule without a successor must fail this suite.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRules,
  discoverSurface,
  extractTruth,
  landingCoverageFailures,
  parseDollar,
  registryLandingFiles,
  scanFile,
  scanSurface,
} from "../check-claim-drift.mjs";

// ── fixture sources: faithful mini-shapes of the real constants ─────────────
// Shape matters: the extractor reads tier prices at the exact 6-space indent
// the real pricing.ts uses, so the fixture mirrors that shape.
const MINI_CONFIG = `
export const SECURITY_CONFIG = {
  MIN_PASSWORD_LENGTH: 12,
};
`;
const MINI_PRICING = `
export const PRICING_CONFIG = {
  lifetimeVersioned: {
    refundDays: 30,
  },
  tiers: [
    {
      id: "free",
      price: 0,
      limitations: {
        maxBookmarks: 1000,
        maxDevices: 0,
      },
    },
    {
      id: "pro",
      price: 79,
      earlyBirdPrice: 59,
      limitations: {
        maxBookmarks: Infinity,
        maxDevices: 3,
      },
    },
  ],
  b2b: [{ pricePerYear: 2500 }, { pricePerYear: 5000 }, { pricePerYear: 7500 }],
  upgrades: { upgradePriceNew: 89, upgradePriceOwner: 35 },
};
`;

// Mini-shapes of the three extra truth sources (argon2-kdf.ts, BackupService.ts,
// StorageStatus.tsx) — the new rules read them through `extractTruth` extras.
const MINI_KDF = `
const ARGON2_PARAMS_DESKTOP = {
  t: 3,
  m: 131_072, // 128 MiB — OWASP recommended for sensitive data
  p: 1,
  dkLen: 32,
} as const;
const ARGON2_PARAMS_MOBILE = {
  t: 3,
  m: 65_536, // 64 MiB — above OWASP interactive minimum
  p: 1,
  dkLen: 32,
} as const;
`;
const MINI_BACKUP = `const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours`;
const MINI_STORAGE = `export const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;`;

const EXTRAS = {
  kdfSrc: MINI_KDF,
  backupSrc: MINI_BACKUP,
  storageStatusSrc: MINI_STORAGE,
};

const TRUTH = extractTruth(MINI_CONFIG, MINI_PRICING, EXTRAS);
const RULES = buildRules(TRUTH);

/** Run the rule set over one synthetic file; returns hits. */
function hitsFor(content, kind = "ts") {
  const dir = mkdtempSync(join(tmpdir(), "claim-drift-"));
  const file = join(dir, `fixture.${kind === "html" ? "html" : "txt"}`);
  writeFileSync(file, content);
  try {
    return scanFile(file, kind, RULES);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Assert exactly one hit from `ruleId`, or none when `expectDrift` is false. */
function expectClaim(content, ruleId, { expectDrift = true, kind = "ts" } = {}) {
  const hits = hitsFor(content, kind).filter((h) => h.rule === ruleId);
  if (expectDrift) {
    expect(hits, `expected drift for: ${content}`).toHaveLength(1);
    return hits[0];
  }
  expect(hits, `expected NO drift for: ${content}`).toHaveLength(0);
  return null;
}

// ── truth extraction ─────────────────────────────────────────────────────────
describe("extractTruth", () => {
  it("extracts scalars and tier sets from the real file shapes", () => {
    expect(TRUTH.minPasswordLength).toBe(12);
    expect(TRUTH.refundDays).toBe(30);
    expect(TRUTH.recoveryWords).toBe(24);
    expect(TRUTH.freeDeviceCap).toBe(0);
    expect(TRUTH.freeBookmarkCap).toBe(1000);
    expect([...TRUTH.deviceCounts].sort((a, b) => a - b)).toEqual([0, 3]);
    expect([...TRUTH.bookmarkCaps]).toEqual([1000]);
    expect([...TRUTH.prices].sort((a, b) => a - b)).toEqual([0, 59, 79]);
    expect([...TRUTH.upgradePrices].sort((a, b) => a - b)).toEqual([35, 89]);
    expect([...TRUTH.b2bYearlyPrices].sort((a, b) => a - b)).toEqual([2500, 5000, 7500]);
    expect([...TRUTH.argonMiB].sort((a, b) => a - b)).toEqual([64, 128]);
    expect(TRUTH.autoBackupHours).toBe(24);
    expect(TRUTH.backupStaleHours).toBe(48);
  });

  it("is FAIL-CLOSED for the new sources when extras are omitted", () => {
    const t = extractTruth(MINI_CONFIG, MINI_PRICING);
    expect(t.argonMiB.size).toBe(0);
    expect(t.autoBackupHours).toBeNull();
    expect(t.backupStaleHours).toBeNull();
  });

  it("does not mistake a non-KiB argon2 memory value for MiB", () => {
    const t = extractTruth(MINI_CONFIG, MINI_PRICING, {
      kdfSrc: `const ARGON2_PARAMS_DESKTOP = { m: 12345 };`,
    });
    expect(t.argonMiB.size).toBe(0);
  });

  it("accepts a plain-millisecond interval that divides into whole hours", () => {
    const t = extractTruth(MINI_CONFIG, MINI_PRICING, {
      backupSrc: `const AUTO_BACKUP_INTERVAL_MS = 86400000;`,
    });
    expect(t.autoBackupHours).toBe(24);
  });

  it("is FAIL-CLOSED: missing MIN_PASSWORD_LENGTH yields null, not a guess", () => {
    const t = extractTruth("export const OTHER = 1;", MINI_PRICING);
    expect(t.minPasswordLength).toBeNull();
  });

  it("is FAIL-CLOSED: missing refundDays yields null", () => {
    const t = extractTruth(MINI_CONFIG, "export const X = 1;");
    expect(t.refundDays).toBeNull();
  });

  it("is FAIL-CLOSED: a free tier without maxDevices yields a null freeDeviceCap", () => {
    const t = extractTruth(
      MINI_CONFIG,
      `export const PRICING_CONFIG = { tiers: [{ id: "pro", limitations: { maxDevices: 3 } }] };`,
    );
    expect(t.freeDeviceCap).toBeNull();
  });

  it("anchors freeDeviceCap to the tier whose id is free, not the first tier", () => {
    const t = extractTruth(
      MINI_CONFIG,
      `export const PRICING_CONFIG = { tiers: [
        { id: "pro", limitations: { maxDevices: 3 } },
        { id: "free", limitations: { maxDevices: 0 } },
      ] };`,
    );
    expect(t.freeDeviceCap).toBe(0);
  });

  it("anchors freeBookmarkCap to the tier whose id is free, not the first tier", () => {
    const t = extractTruth(
      MINI_CONFIG,
      `export const PRICING_CONFIG = { tiers: [
        { id: "pro", limitations: { maxBookmarks: 5000 } },
        { id: "free", limitations: { maxBookmarks: 1000 } },
      ] };`,
    );
    expect(t.freeBookmarkCap).toBe(1000);
  });

  it("is FAIL-CLOSED: a free tier without maxBookmarks yields a null freeBookmarkCap", () => {
    const t = extractTruth(
      MINI_CONFIG,
      `export const PRICING_CONFIG = { tiers: [{ id: "pro", limitations: { maxBookmarks: Infinity } }] };`,
    );
    expect(t.freeBookmarkCap).toBeNull();
  });

  it("does not mistake Infinity for the free bookmark cap either", () => {
    expect(TRUTH.freeBookmarkCap).not.toBe(Infinity);
  });

  it("does not mistake Infinity for a bookmark cap", () => {
    expect([...TRUTH.bookmarkCaps]).not.toContain(Infinity);
  });
});

// ── recovery-words ───────────────────────────────────────────────────────────
describe("rule: recovery-words", () => {
  it.each([
    "Generate your 24-word recovery phrase and store it offline.",
    "Frase de recuperación de 24 palabras — guárdala en papel.",
    "Notieren Sie Ihren Wiederherstellungssatz mit 24 Wörtern.",
    "Frase seed di 24 parole mostrata una sola volta.",
    "frase de 24 palavras",
  ])("accepts true 24-word claims: %s", (line) => {
    expectClaim(line, "recovery-words", { expectDrift: false });
  });

  it.each([
    "a 12-word seed phrase",
    "frase de 12 palabras",
    "12 Wörter",
    "frase seed di 12 parole",
    "48-word phrase",
  ])("rejects drifted word counts: %s", (line) => {
    const hit = expectClaim(line, "recovery-words");
    expect(hit.drift).toMatch(/RecoveryService enforces 24/);
  });

  it("regression: the historical 12-word bug fires with file/line info", () => {
    const hit = expectClaim("text: a 12-word seed phrase", "recovery-words");
    expect(hit.lineNo).toBe(1);
  });
});

// ── password-min ─────────────────────────────────────────────────────────────
describe("rule: password-min", () => {
  it.each([
    "Password must be at least 12 characters long.",
    "La contraseña debe tener al menos 12 caracteres.",
    "Passwort muss mindestens 12 Zeichen lang sein.",
    "La password deve avere almeno 12 caratteri.",
    "パスワードは少なくとも12文字である必要があります。",
    "密码必须至少12个字符。",
    "비밀번호는 최소 12자 이상이어야 합니다.",
    "Пароль должен содержать не менее 12 символов.",
    "Minimum 12 characters; we recommend a strong passphrase.",
  ])("accepts true 12-character claims: %s", (line) => {
    expectClaim(line, "password-min", { expectDrift: false });
  });

  it.each([
    "Password must be at least 8 characters long.",
    "al menos 8 caracteres",
    "mindestens 8 Zeichen",
    "almeno 8 caratteri",
    "Mínimo 8 caracteres.",
    "至少8个字符",
    "не менее 8 символов",
  ])("rejects drifted minimums: %s", (line) => {
    const hit = expectClaim(line, "password-min");
    expect(hit.drift).toMatch(/code enforces 12/);
  });

  it("is FAIL-CLOSED: with missing truth, ANY character-count claim fires", () => {
    const broken = buildRules(extractTruth("export const X = 1;", MINI_PRICING));
    const dir = mkdtempSync(join(tmpdir(), "claim-drift-fc-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, "at least 30 characters of text");
    try {
      const hits = scanFile(file, "ts", broken).filter((h) => h.rule === "password-min");
      expect(hits).toHaveLength(1);
      expect(hits[0].drift).toMatch(/fail-closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── devices / free-bookmarks ─────────────────────────────────────────────────
describe("rule: devices", () => {
  it("accepts tier-valid true claims (3 on Pro; digitless copy never claims)", () => {
    expectClaim("P2P sync across 3 devices", "devices", { expectDrift: false });
    expectClaim("Synchronisierung auf 3 Geräten", "devices", { expectDrift: false });
  });

  it("rejects the 1-device fiction and counts no tier grants", () => {
    // Free maxDevices is 0 (no per-device cap) since the fiction fix —
    // "1 device" copy must fail the gate, not pass.
    const one = expectClaim("1 device", "devices");
    expect(one.drift).toMatch(/claims 1 device/);
    const hit = expectClaim("sync across 5 devices", "devices");
    expect(hit.drift).toMatch(/maxDevices values: 0, 3/);
  });
});

describe("rule: free-device-count (any-device policy)", () => {
  it("rejects Free copy claiming 1 device in every surface kind", () => {
    const hit = expectClaim(
      'app_freeTierFeatures": "1,000 bookmarks, 1 device, full search",',
      "free-device-count",
    );
    expect(hit.drift).toMatch(
      /Free-tier copy claims 1 device.*maxDevices: 0 \(any-device policy\)/,
    );
    expectClaim(
      "<li>Free — $0 forever: 1,000 bookmarks, 1 device, smart search</li>",
      "free-device-count",
      { kind: "html" },
    );
    expectClaim(
      "<li>Gratis — 1.000 marcadores, 1 dispositivo, búsqueda inteligente</li>",
      "free-device-count",
      { kind: "html" },
    );
  });

  it("accepts Free copy that states the any-device truth without a count", () => {
    expectClaim(
      "<li>Free — 1,000 bookmarks on any device (each keeps its own vault)</li>",
      "free-device-count",
      { expectDrift: false, kind: "html" },
    );
    expectClaim(
      'app_freeTierFeatures": "1,000 bookmarks, 0 device caps, works everywhere",',
      "free-device-count",
      { expectDrift: false },
    );
  });

  it("does not treat Pro-leaning mixed lines as Free copy (anti-context)", () => {
    expectClaim(
      "<p>Free forever. Pro unlocks P2P sync across 3 devices.</p>",
      "free-device-count",
      { expectDrift: false, kind: "html" },
    );
    expectClaim(
      "Unlock everything: free to start, Pro adds 3-device sync",
      "free-device-count",
      { expectDrift: false },
    );
  });

  it("is FAIL-CLOSED: a missing free tier cap makes ANY Free device claim fire", () => {
    const t = extractTruth(MINI_CONFIG, MINI_PRICING, EXTRAS);
    t.freeDeviceCap = null;
    const rules = buildRules(t);
    const rule = rules.find((r) => r.id === "free-device-count");
    const drift = rule.verdict(["1"]);
    expect(drift).toMatch(/fail-closed/);
  });
});

describe("rule: free-bookmark-cap (free-cap policy)", () => {
  it("accepts Free copy claiming exactly the free-tier cap", () => {
    expectClaim(
      'app_freeTierFeatures": "1,000 bookmarks, notes, documents",',
      "free-bookmark-cap",
      { expectDrift: false },
    );
    expectClaim(
      "<li>Free — 1,000 bookmarks, smart search</li>",
      "free-bookmark-cap",
      { expectDrift: false, kind: "html" },
    );
    expectClaim(
      "<li>Gratis — 1.000 marcadores y búsqueda</li>",
      "free-bookmark-cap",
      { expectDrift: false, kind: "html" },
    );
  });

  it("rejects Free copy claiming a different cap in every surface kind", () => {
    const hit = expectClaim(
      "<li>Free — 500 bookmarks to start</li>",
      "free-bookmark-cap",
      { kind: "html" },
    );
    expect(hit.drift).toMatch(
      /Free-tier copy claims 500 bookmarks.*maxBookmarks: 1000/,
    );
    expectClaim(
      'app_freeTierFeatures": "2,000 bookmarks, full search",',
      "free-bookmark-cap",
    );
  });

  it.each([
    "<li>Free — unlimited bookmarks forever</li>",
    "<li>Gratis — marcadores ilimitados</li>",
    "<li>Unbegrenzte Lesezeichen im Free-Plan</li>",
  ])("rejects unlimited wording in Free copy: %s", (line) => {
    const hit = expectClaim(line, "free-bookmark-cap", { kind: "html" });
    expect(hit.drift).toMatch(/unlimited is the Pro promise/);
  });

  it("unlimited wording fires even when a count follows later", () => {
    const hit = expectClaim(
      "<li>Free — unlimited bookmarks (was 1,000)</li>",
      "free-bookmark-cap",
      { kind: "html" },
    );
    expect(hit.drift).toMatch(/unlimited bookmarks/);
  });

  it("does not treat Pro-leaning lines as Free copy (anti-context)", () => {
    expectClaim(
      'app_proUpgradeText": "Unlimited bookmarks, P2P sync across 3 devices…",',
      "free-bookmark-cap",
      { expectDrift: false },
    );
    expectClaim(
      "<p>Free forever. Pro unlocks unlimited bookmarks.</p>",
      "free-bookmark-cap",
      { expectDrift: false, kind: "html" },
    );
    expectClaim(
      "<li>Pro — unlimited bookmarks</li>",
      "free-bookmark-cap",
      { expectDrift: false, kind: "html" },
    );
  });

  it("is FAIL-CLOSED: a missing free tier cap makes ANY Free bookmark claim fire", () => {
    const t = extractTruth(MINI_CONFIG, MINI_PRICING, EXTRAS);
    t.freeBookmarkCap = null;
    const rules = buildRules(t);
    const rule = rules.find((r) => r.id === "free-bookmark-cap");
    const drift = rule.verdict(["1,000"]);
    expect(drift).toMatch(/fail-closed/);
  });
});

describe("rule: free-bookmarks", () => {
  it.each([
    "1,000 bookmarks, notes, documents",
    "1 000 marcadores", // space thousands separator
    "1.000 Lesezeichen", // dot thousands separator
    "1000 bookmarks",
  ])("accepts the free-tier cap: %s", (line) => {
    expectClaim(line, "free-bookmarks", { expectDrift: false });
  });

  it("rejects a changed cap (500 bookmarks)", () => {
    const hit = expectClaim("500 bookmarks to start", "free-bookmarks");
    expect(hit.drift).toMatch(/maxBookmarks values: 1000/);
  });

  it("does not read a copyright year as a bookmark count", () => {
    expectClaim("© 2026 BookmarkForge. All rights reserved.", "free-bookmarks", {
      expectDrift: false,
    });
  });
});

// ── prohibited-kdf ───────────────────────────────────────────────────────────
describe("rule: prohibited-kdf", () => {
  it("rejects PBKDF2 in user-visible copy (vault KDF is Argon2id V4)", () => {
    const hit = expectClaim(
      "It is used to generate the AES-GCM key via PBKDF2 with 600,000 iterations.",
      "prohibited-kdf",
    );
    expect(hit.drift).toMatch(/Argon2id V4/);
  });

  it("matches case-insensitively", () => {
    expectClaim("pbkdf2-derived key", "prohibited-kdf");
  });
});

// ── refund-window ────────────────────────────────────────────────────────────
describe("rule: refund-window", () => {
  it.each([
    "30-day refund via Whop",
    "We offer a 30-day money-back guarantee if the app doesn't meet your needs.",
    "reembolso en 30 días",
    "Ofrecemos una garantía de devolución de 30 días si la aplicación no cumple.",
    "money-back within 30 days of purchase",
    "30 días de garantía",
  ])("accepts true 30-day claims: %s", (line) => {
    expectClaim(line, "refund-window", { expectDrift: false });
  });

  it.each([
    "We offer a 14-day money-back guarantee.",
    "garantía de devolución de 14 días",
    "refund after 14 days",
  ])("rejects drifted windows: %s", (line) => {
    const hit = expectClaim(line, "refund-window");
    expect(hit.drift).toMatch(/refundDays: 30/);
  });

  it("is FAIL-CLOSED when refundDays cannot be located", () => {
    const broken = buildRules(extractTruth(MINI_CONFIG, "export const X = 1;"));
    expect(broken.find((r) => r.id === "refund-window").description).toMatch(/MISSING/);
  });
});

// ── prices ───────────────────────────────────────────────────────────────────
describe("rule: prices", () => {
  it("accepts tier, early-bird, upgrade and B2B yearly prices everywhere", () => {
    for (const line of [
      "one-time payment of $79",
      "$ 59 Early Bird",
      "Upgrade to v2 for $89 (new) or $35 (existing owners)",
      "Integration $2,500/y",
      "$7,500/y redistribution",
      "Get Pro $59",
    ]) {
      expectClaim(line, "prices", { expectDrift: false });
    }
  });

  it("rejects a price that exists in no truth set", () => {
    const hit = expectClaim("Get Pro $49 today", "prices");
    expect(hit.drift).toMatch(/not in PRICING_CONFIG/);
  });

  it("parses thousands separators as thousands, not decimals", () => {
    expect(parseDollar("2,500")).toBe(2500);
    expect(parseDollar("1.234")).toBe(1234); // European grouping
    expect(parseDollar("1,234.56")).toBe(1234.56);
    expect(parseDollar("59.99")).toBe(59.99);
    expect(parseDollar("79")).toBe(79);
  });
});

// ── upgrade-prices ───────────────────────────────────────────────────────────
describe("rule: upgrade-prices", () => {
  it("accepts the configured upgrade prices", () => {
    expectClaim("v2 costs $89 for new customers", "upgrade-prices", { expectDrift: false });
    expectClaim("v2 60% off — $35 for existing owners", "upgrade-prices", { expectDrift: false });
  });

  it("rejects unconfigured upgrade prices", () => {
    const hit = expectClaim("v2 costs $50 for existing owners", "upgrade-prices");
    expect(hit.drift).toMatch(/not in pricing\.ts upgrade prices/);
  });
});

// ── argon2-memory ────────────────────────────────────────────────────────
describe("rule: argon2-memory", () => {
  it.each([
    "Vault keys are hardened with 128 MiB of memory.",
    "El KDF de la bóveda usa 128 MiB de memoria.",
    "Der Tresor nutzt 64 MiB Argon2id-Speicher (mobil).",
  ])("accepts true MiB claims (desktop 128, mobile 64): %s", (line) => {
    expectClaim(line, "argon2-memory", { expectDrift: false });
  });

  it("rejects a MiB value no Argon2 profile configures", () => {
    const hit = expectClaim("Hardened with 256 MiB memory cost.", "argon2-memory");
    expect(hit.drift).toMatch(/memory: \{64, 128\} MiB/);
  });

  it("is FAIL-CLOSED when argon2-kdf.ts cannot be located", () => {
    const broken = buildRules(extractTruth(MINI_CONFIG, MINI_PRICING));
    const dir = mkdtempSync(join(tmpdir(), "claim-drift-argon-fc-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, "128 MiB of memory-hard KDF");
    try {
      const hits = scanFile(file, "ts", broken).filter((h) => h.rule === "argon2-memory");
      expect(hits).toHaveLength(1);
      expect(hits[0].drift).toMatch(/fail-closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── auto-backup-hours ────────────────────────────────────────────────────
describe("rule: auto-backup-hours", () => {
  it.each([
    "Export your data anytime as an encrypted backup. Auto-backups run every 24 hours.",
    '"app_onboardingBackupDesc": "Las copias automáticas se ejecutan cada 24 horas para protegerte."',
    '"app_onboardingBackupDesc": "Automatische Backups laufen alle 24 Stunden, um Datenverlust zu verhindern."',
    '"app_onboardingBackupDesc": "Des sauvegardes automatiques s\'exécutent toutes les 24 heures."',
    '"app_onboardingBackupDesc": "Автоматические резервные копии создаются каждые 24 часа."',
    '"app_onboardingBackupDesc": "自动备份每 24 小时运行一次。"',
    '"app_onboardingBackupDesc": "自動バックアップは24時間ごとに実行され、データ損失から保護します。"',
  ])("accepts true 24-hour auto-backup claims: %s", (line) => {
    expectClaim(line, "auto-backup-hours", { expectDrift: false });
  });

  it("rejects a drifted interval (every 12 hours)", () => {
    const hit = expectClaim("Auto-backups run every 12 hours.", "auto-backup-hours");
    expect(hit.drift).toMatch(/AUTO_BACKUP_INTERVAL_MS = 24 hours/);
  });

  it("does NOT fire on hour mentions without backup context", () => {
    expectClaim("Session expires in 2 hours of inactivity.", "auto-backup-hours", {
      expectDrift: false,
    });
    expectClaim("Session expires in 48 hours of inactivity.", "backup-stale-hours", {
      expectDrift: false,
    });
  });

  it("is FAIL-CLOSED when BackupService.ts cannot be located", () => {
    const broken = buildRules(extractTruth(MINI_CONFIG, MINI_PRICING));
    const dir = mkdtempSync(join(tmpdir(), "claim-drift-ab-fc-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, '"app_x": "Auto-backups run every 24 hours."');
    try {
      const hits = scanFile(file, "ts", broken).filter((h) => h.rule === "auto-backup-hours");
      expect(hits).toHaveLength(1);
      expect(hits[0].drift).toMatch(/fail-closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── backup-stale-hours ──────────────────────────────────────────────────
describe("rule: backup-stale-hours", () => {
  it.each([
    '"app_backupStaleWarning": "No backup in over 48 hours — export one now."',
    '"backup_bannerStaleDesc": "Your last backup is over 48 hours old. Export a fresh copy."',
    '"app_backupStaleWarning": "Sin respaldo en más de 48 horas: exporta uno ahora."',
    '"backup_bannerStaleDesc": "Tu último respaldo tiene más de 48 horas."',
    '"app_backupStaleWarning": "Keine Sicherung seit über 48 Stunden — exportieren Sie jetzt eine."',
    '"backup_bannerStaleDesc": "Ihre letzte Sicherung ist älter als 48 Stunden."',
    '"app_backupStaleWarning": "Votre dernière sauvegarde date de plus de 48 heures."',
    '"app_backupStaleWarning": "48時間以上バックアップがありません。今すぐエクスポートしてください。"',
  ])("accepts true 48-hour stale claims: %s", (line) => {
    expectClaim(line, "backup-stale-hours", { expectDrift: false });
  });

  it("rejects a drifted stale window (over 72 hours)", () => {
    const hit = expectClaim("No backup in over 72 hours — export one now.", "backup-stale-hours");
    expect(hit.drift).toMatch(/BACKUP_STALE_MS = 48 hours/);
  });

  it("is FAIL-CLOSED when StorageStatus.tsx cannot be located", () => {
    const broken = buildRules(extractTruth(MINI_CONFIG, MINI_PRICING));
    const dir = mkdtempSync(join(tmpdir(), "claim-drift-st-fc-"));
    const file = join(dir, "f.txt");
    writeFileSync(file, '"app_backupStaleWarning": "No backup in over 48 hours."');
    try {
      const hits = scanFile(file, "ts", broken).filter((h) => h.rule === "backup-stale-hours");
      expect(hits).toHaveLength(1);
      expect(hits[0].drift).toMatch(/fail-closed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── devices: hyphenated sync claims ─────────────────────────────────────
describe("rule: devices (hyphenated sync claims)", () => {
  it("accepts tier-valid hyphenated claims", () => {
    expectClaim("P2P sync across 3 devices", "devices", { expectDrift: false });
    expectClaim("3-device sync end-to-end", "devices", { expectDrift: false });
    expectClaim("Sincronización de 3 dispositivos", "devices", { expectDrift: false });
  });

  it("rejects hyphenated counts no tier grants", () => {
    const hit = expectClaim("5-device sync", "devices");
    expect(hit.drift).toMatch(/maxDevices values: 0, 3/);
  });
});

// ── allowlist extension points ───────────────────────────────────────────────
describe("allowlist extension points", () => {
  it("skips competitor pricing rows (documented extension point)", () => {
    expectClaim(
      "Compare: Raindrop Pro $28–38/y, Instapaper $60/y, Readwise $120/y.",
      "prices",
      { expectDrift: false, kind: "html" },
    );
  });

  it("still fires on our own price when the line also names a competitor", () => {
    expectClaim("Raindrop is $28/y but BookmarkForge Pro is $49", "prices", {
      kind: "html",
    });
  });

  it("skips diagnostic example boxes (runtime sample values)", () => {
    expectClaim('BookmarkForge v1.0.0 | Vault: 847 bookmarks, 12 docs', "free-bookmarks", {
      expectDrift: false,
    });
    expectClaim('<div class="diag-box">Vault: 500 bookmarks</div>', "free-bookmarks", {
      expectDrift: false,
      kind: "html",
    });
  });

  it("skips model-size and offline claims", () => {
    for (const line of [
      '"app_modelGemma2b": "Gemma-2B-IT (Google, ~2GB)"',
      "Works 100% offline via the Web Speech API.",
    ]) {
      expect(hitsFor(line).filter((h) => h.rule === "prices" || h.rule === "free-bookmarks")).toHaveLength(0);
    }
  });
});

// ── surface discovery + full scan ────────────────────────────────────────────
describe("scanSurface", () => {
  it("discovers locales, html pages and SupportKnowledge files", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-tree-"));
    try {
      mkdirSync(join(root, "public", "locales"), { recursive: true });
      mkdirSync(join(root, "src", "data"), { recursive: true });
      writeFileSync(join(root, "public", "locales", "en.json"), "{}");
      writeFileSync(join(root, "public", "landing.html"), "<p>x</p>");
      writeFileSync(join(root, "src", "data", "SupportKnowledge_fr.ts"), "export default {};");
      writeFileSync(join(root, "src", "data", "other.ts"), "export default {};");

      const surface = discoverSurface(root);
      expect(surface).toHaveLength(3);
      expect(surface.map((f) => f.kind).sort()).toEqual(["html", "locale", "ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports drift with file, line number and rule across a full tree", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-full-"));
    try {
      mkdirSync(join(root, "src", "constants"), { recursive: true });
      mkdirSync(join(root, "public", "locales"), { recursive: true });
      writeFileSync(join(root, "src", "constants", "config.ts"), MINI_CONFIG);
      writeFileSync(join(root, "src", "constants", "pricing.ts"), MINI_PRICING);
      writeFileSync(
        join(root, "public", "locales", "en.json"),
        '{\n  "a": "ok",\n  "b": "a 12-word seed phrase"\n}\n',
      );
      const report = scanSurface({ root });
      expect(report.results).toHaveLength(1);
      expect(report.results[0].hits[0].rule).toBe("recovery-words");
      expect(report.results[0].hits[0].lineNo).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── landing coverage pin (derived from the locale registry) ──────────────────
describe("landing coverage pin", () => {
  const ROOT = process.cwd();

  it("covers every landing the registry declares, on the real tree", async () => {
    // The pin's input is the registry itself, so this also proves the two
    // agree: a landing page the registry names is a page this gate must read.
    const declared = await registryLandingFiles(ROOT);
    expect(declared).not.toBeNull();
    expect(declared).toContain("public/landing.html");
    expect(declared.length).toBeGreaterThan(20);
    expect(landingCoverageFailures(discoverSurface(ROOT), declared, ROOT)).toEqual([]);
  });

  it("fires when existing landing pages fall outside the scanned surface", async () => {
    // Simulates the regression the pin exists for: discovery covering fewer
    // files than the locale set — the "still pinned at 6" shape that every
    // consumer of the registry used to have. The pages exist, so this is a
    // coverage gap, not a missing-page report.
    const declared = await registryLandingFiles(ROOT);
    const narrow = discoverSurface(ROOT).filter(
      (f) => !/public[\\/](ar|ja|zh)\.html$/.test(f.path),
    );
    const failures = landingCoverageFailures(narrow, declared, ROOT);
    expect(failures).toHaveLength(3);
    const joined = failures.join("\n");
    expect(joined).toContain("public/ar.html");
    expect(joined).toContain("public/ja.html");
    expect(joined).toContain("must cover every locale");
  });

  it("skips a declared landing that does not exist (page existence is another gate)", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-cov-"));
    try {
      expect(landingCoverageFailures([], ["public/nope.html"], root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not apply to a tree with no registry (synthetic fixtures)", async () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-noreg-"));
    try {
      expect(await registryLandingFiles(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── freeze test on the REAL repo (what CI actually runs) ─────────────────────
describe("real repo freeze", () => {
  it("the shipped surface has ZERO factual drift against the shipped constants", () => {
    const report = scanSurface();
    const total = report.results.reduce((n, r) => n + r.hits.length, 0);
    expect(total, JSON.stringify(report.results, null, 2)).toBe(0);
  });

  it("the real backup/kdf constants still match the values this suite pins", () => {
    const { truth } = scanSurface();
    expect([...truth.argonMiB].sort((a, b) => a - b)).toEqual([64, 128]);
    expect(truth.autoBackupHours).toBe(24);
    expect(truth.backupStaleHours).toBe(48);
  });

  it("the real constants still match the values this suite pins", () => {
    const configSrc = readFileSync(
      join(process.cwd(), "src", "constants", "config.ts"),
      "utf8",
    );
    const pricingSrc = readFileSync(
      join(process.cwd(), "src", "constants", "pricing.ts"),
      "utf8",
    );
    const t = extractTruth(configSrc, pricingSrc);
    // Pinned values — bump these ONLY together with the real constants,
    // the UI copy and the docs (the gate error message says the same).
    expect(t.minPasswordLength).toBe(12);
    expect(t.recoveryWords).toBe(24);
    expect(t.refundDays).toBe(30);
    expect([...t.deviceCounts].sort((a, b) => a - b)).toEqual([0, 5]);
    expect(t.freeBookmarkCap).toBe(2500);
    expect(t.prices.has(79)).toBe(true);
  });
});

// ── CLI smoke ────────────────────────────────────────────────────────────────
describe("CLI", () => {
  const SCRIPT = join(process.cwd(), "scripts", "check-claim-drift.mjs");

  it("exit 0 on a clean tree", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-cli0-"));
    try {
      mkdirSync(join(root, "src", "constants"), { recursive: true });
      mkdirSync(join(root, "public", "locales"), { recursive: true });
      writeFileSync(join(root, "src", "constants", "config.ts"), MINI_CONFIG);
      writeFileSync(join(root, "src", "constants", "pricing.ts"), MINI_PRICING);
      writeFileSync(join(root, "public", "locales", "en.json"), '{"k": "24-word phrase"}');
      const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
      expect(res.status).toBe(0);
      expect(res.stdout).toMatch(/OK — \d+ files scanned/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exit 1 with per-file diagnosis on a drifted tree", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-cli1-"));
    try {
      mkdirSync(join(root, "src", "constants"), { recursive: true });
      mkdirSync(join(root, "public", "locales"), { recursive: true });
      writeFileSync(join(root, "src", "constants", "config.ts"), MINI_CONFIG);
      writeFileSync(join(root, "src", "constants", "pricing.ts"), MINI_PRICING);
      writeFileSync(join(root, "public", "locales", "en.json"), '{"k": "8 characters minimum"}');
      const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/\[password-min\]/);
      expect(res.stderr).toMatch(/code enforces 12/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exit 2 when the truth sources are unreadable (fail-closed, not silent-pass)", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-cli2-"));
    try {
      const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
      expect(res.status).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exit 2 on an unknown flag", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "--bogus"], { encoding: "utf8" });
    expect(res.status).toBe(2);
  });

  it("exit 1 when a registry landing exists outside the scanned surface", () => {
    const root = mkdtempSync(join(tmpdir(), "claim-drift-clicov-"));
    try {
      mkdirSync(join(root, "src", "constants"), { recursive: true });
      mkdirSync(join(root, "public", "nested"), { recursive: true });
      mkdirSync(join(root, "scripts"), { recursive: true });
      writeFileSync(join(root, "src", "constants", "config.ts"), MINI_CONFIG);
      writeFileSync(join(root, "src", "constants", "pricing.ts"), MINI_PRICING);
      // Declared landing under a nested path: it EXISTS (so this is not
      // another gate's missing-page problem) but the non-recursive
      // public/*.html discovery cannot reach it — the gap the pin reports.
      writeFileSync(join(root, "public", "nested", "xx.html"), "<p>no figures here</p>");
      writeFileSync(
        join(root, "scripts", "landing-registry.mjs"),
        'export const LANDING_LOCALES = [{ file: "public/nested/xx.html" }];\n',
      );

      const res = spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/landing coverage gap/);
      expect(res.stderr).toContain("public/nested/xx.html");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
