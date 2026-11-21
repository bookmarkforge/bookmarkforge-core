import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "check-i18n-quality.mjs",
);

function runIn(dir: string): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  try {
    const output = execSync(`node "${SCRIPT_PATH}"`, {
      cwd: dir,
      encoding: "utf-8",
    });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

async function scaffold(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
}

const json = (o: Record<string, unknown>) => JSON.stringify(o, null, 2);

function baseline(counts: Record<string, number>): string {
  return json({ locales: Object.fromEntries(
    Object.entries(counts).map(([l, issues]) => [l, { issues }]),
  ), updatedAt: "2026-08-12T00:00:00.000Z" });
}

const EN = {
  app_greeting: "Hello",
  app_publicDoc: "Public document",
  app_anthropic: "Anthropic Claude",
  app_supportChatHello: "Hello! I'm the BMF Concierge.",
  app_model: "WebLLM",
};

describe("check-i18n-quality.mjs — cross-script + untranslated detectors", () => {
  let cleanDir: string;
  let crossScriptFailDir: string;
  let koFailDir: string;
  let untranslatedFailDir: string;
  let allowlistPassDir: string;
  let baselinePassDir: string;
  let baselineNewFailDir: string;

  beforeAll(async () => {
    cleanDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-clean-"));
    crossScriptFailDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-cross-"),
    );
    koFailDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-ko-"));
    untranslatedFailDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-untr-"),
    );
    allowlistPassDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-allow-"),
    );
    baselinePassDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-base-"),
    );
    baselineNewFailDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-basenew-"),
    );

    // Clean: Hebrew, Japanese (kana+kanji is ONE script) and Spanish all pass.
    await scaffold(cleanDir, {
      "public/locales/en.json": json(EN),
      "public/locales/es.json": json({ app_greeting: "Hola", app_anthropic: "Anthropic Claude", app_supportChatHello: EN.app_supportChatHello, app_model: "WebLLM" }),
      "public/locales/he.json": json({ app_greeting: "שלום", app_anthropic: "Anthropic Claude", app_supportChatHello: EN.app_supportChatHello, app_model: "WebLLM" }),
      "public/locales/ja.json": json({ app_greeting: "ロード中...", app_anthropic: "Anthropic Claude", app_supportChatHello: EN.app_supportChatHello, app_model: "WebLLM" }),
      "scripts/i18n-quality-baseline.json": baseline({ es: 0, he: 0, ja: 0 }),
    });

    // Hebrew value with a Cyrillic fragment → cross-script flag.
    await scaffold(crossScriptFailDir, {
      "public/locales/en.json": json(EN),
      "public/locales/he.json": json({ app_greeting: "שלום привет", app_anthropic: "Anthropic Claude", app_supportChatHello: EN.app_supportChatHello, app_model: "WebLLM" }),
      "public/locales/ja.json": json({ app_greeting: "ロード中...", app_anthropic: "Anthropic Claude", app_supportChatHello: EN.app_supportChatHello, app_model: "WebLLM" }),
      "scripts/i18n-quality-baseline.json": baseline({ he: 0, ja: 0 }),
    });

    // Korean value with Han (simplified Chinese) characters → cross-script flag.
    await scaffold(koFailDir, {
      "public/locales/en.json": json(EN),
      "public/locales/ko.json": json({ app_greeting: "모두归档", app_anthropic: "Anthropic Claude", app_supportChatHello: EN.app_supportChatHello, app_model: "WebLLM" }),
      "scripts/i18n-quality-baseline.json": baseline({ ko: 0 }),
    });

    // Multi-word value identical to en → untranslated flag.
    await scaffold(untranslatedFailDir, {
      "public/locales/en.json": json(EN),
      "public/locales/es.json": json(EN),
      "scripts/i18n-quality-baseline.json": baseline({ es: 0 }),
    });

    // Brand labels, concierge family and single-token names never flag.
    await scaffold(allowlistPassDir, {
      "public/locales/en.json": json(EN),
      "public/locales/es.json": json(EN),
      "public/locales/zh.json": json(EN),
      "scripts/i18n-quality-baseline.json": baseline({ es: 1, zh: 1 }),
    });

    // Baseline already records the issue → gate stays green.
    await scaffold(baselinePassDir, {
      "public/locales/en.json": json(EN),
      "public/locales/es.json": json(EN),
      "scripts/i18n-quality-baseline.json": baseline({ es: 1 }),
    });

    // Baseline 1 but TWO untranslated keys → new issue → gate fails.
    await scaffold(baselineNewFailDir, {
      "public/locales/en.json": json({
        ...EN,
        app_second: "Another phrase",
      }),
      "public/locales/es.json": json({
        ...EN,
        app_second: "Another phrase",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ es: 1 }),
    });
  });

  afterAll(async () => {
    for (const dir of [
      cleanDir,
      crossScriptFailDir,
      koFailDir,
      untranslatedFailDir,
      allowlistPassDir,
      baselinePassDir,
      baselineNewFailDir,
    ]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes clean locales (incl. legit Japanese kana+kanji)", () => {
    const r = runIn(cleanDir);
    expect(r.exitCode).toBe(0);
  });

  it("flags Hebrew contaminated with Cyrillic as cross-script", () => {
    const r = runIn(crossScriptFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("cross-script mix");
    expect(r.stderr).toContain("app_greeting");
    expect(r.stderr).toContain("FAIL he");
  });

  it("flags Korean containing Han characters as cross-script", () => {
    const r = runIn(koFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("cross-script mix");
    expect(r.stderr).toContain("FAIL ko");
  });

  it("flags a multi-word value identical to the English reference", () => {
    const r = runIn(untranslatedFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("untranslated value (identical to en): app_publicDoc");
    expect(r.stderr).toContain("FAIL es");
  });

  it("never flags brands, concierge chat or single-token names", () => {
    const r = runIn(allowlistPassDir);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("untranslated value");
  });

  it("stays green when the baseline already records the known backlog", () => {
    const r = runIn(baselinePassDir);
    expect(r.exitCode).toBe(0);
  });

  it("fails when a NEW untranslated value exceeds the recorded baseline", () => {
    const r = runIn(baselineNewFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("untranslated value (identical to en): app_second");
  });
});

describe("check-i18n-quality.mjs — en.json brand-casing detector", () => {
  let brandFailDir: string;
  let brandPassDir: string;
  let prosePassDir: string;

  beforeAll(async () => {
    // Wrong-cased brand in the reference itself ("Api Designer", "Codeql")
    // must fail even though every locale is fine.
    brandFailDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-brandfail-"));
    await scaffold(brandFailDir, {
      "public/locales/en.json": json({
        ...EN,
        app_apiDesigner: "Api Designer",
        app_codeqlSpecialist: "Codeql Specialist",
      }),
      "public/locales/es.json": json({
        ...EN,
        app_apiDesigner: "Diseñador de API",
        app_codeqlSpecialist: "Especialista en CodeQL",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ es: 0 }),
    });

    // Canonical casing everywhere → clean.
    brandPassDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-brandpass-"));
    await scaffold(brandPassDir, {
      "public/locales/en.json": json({
        ...EN,
        app_apiDesigner: "API Designer",
        app_devopsEngineer: "DevOps Engineer",
      }),
      "public/locales/es.json": json({
        ...EN,
        app_apiDesigner: "Diseñador de API",
        app_devopsEngineer: "Ingeniero DevOps",
      }),
      // es has one known issue (app_publicDoc) recorded in the baseline.
      "scripts/i18n-quality-baseline.json": baseline({ es: 1 }),
    });

    // Lowercase "api"/"url"/"json" in URLs, placeholders and file
    // extensions is legitimate prose — must never flag.
    prosePassDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-brandprose-"));
    await scaffold(prosePassDir, {
      "public/locales/en.json": json({
        ...EN,
        app_ollamaUrlPlaceholder: "http://localhost:11434/api/generate",
        app_autoTagPrompt: "Title: {{title}}. URL: {{url}}.",
        app_backupNotice: "Create a backup (.json or .bmf) file.",
      }),
      "public/locales/es.json": json({
        ...EN,
        app_ollamaUrlPlaceholder: "http://localhost:11434/api/generate",
        app_autoTagPrompt: "Título: {{title}}. URL: {{url}}.",
        app_backupNotice: "Cree un archivo de respaldo (.json o .bmf).",
      }),
      // es has one known issue (app_publicDoc) recorded in the baseline.
      "scripts/i18n-quality-baseline.json": baseline({ es: 1 }),
    });
  });

  afterAll(async () => {
    for (const dir of [brandFailDir, brandPassDir, prosePassDir]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags wrong-cased brands in the en reference itself", () => {
    const r = runIn(brandFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("brand casing \"Api\" → \"API\"");
    expect(r.stderr).toContain("brand casing \"Codeql\" → \"CodeQL\"");
    expect(r.stderr).toContain("FAIL en");
  });

  it("passes canonical brand casing in en", () => {
    const r = runIn(brandPassDir);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("brand casing");
  });

  it("never flags lowercase api/url/json in URLs, placeholders or extensions", () => {
    const r = runIn(prosePassDir);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("brand casing");
  });
});

describe("check-i18n-quality.mjs — per-locale untranslated loanword exceptions", () => {
  let csLoanwordPassDir: string;
  let otherLocaleFailDir: string;

  beforeAll(async () => {
    const EN2 = { ...EN, app_qaTester: "QA Tester" };

    // cs legitimately keeps the English loanword "QA Tester" (its own desc
    // uses the same term) → per-locale exception, gate stays green.
    csLoanwordPassDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-cs-loan-"),
    );
    await scaffold(csLoanwordPassDir, {
      "public/locales/en.json": json(EN2),
      "public/locales/cs.json": json({
        ...EN,
        app_qaTester: "QA Tester",
      }),
      // cs has one known issue (app_publicDoc) recorded in the baseline; the
      // app_qaTester loanword is exempted per-locale, so it stays at 1.
      "scripts/i18n-quality-baseline.json": baseline({ cs: 1 }),
    });

    // The SAME value in a locale without the exception must still fail —
    // the per-locale carve-out never masks another locale's regression.
    otherLocaleFailDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-other-loan-"),
    );
    await scaffold(otherLocaleFailDir, {
      "public/locales/en.json": json(EN2),
      "public/locales/es.json": json({
        ...EN,
        app_qaTester: "QA Tester",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ es: 0 }),
    });
  });

  afterAll(async () => {
    for (const dir of [csLoanwordPassDir, otherLocaleFailDir]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes a cs loanword identical to en when cs has the exception", () => {
    const r = runIn(csLoanwordPassDir);
    expect(r.exitCode).toBe(0);
  });

  it("still fails the same value in a locale without the exception", () => {
    const r = runIn(otherLocaleFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("untranslated value (identical to en): app_qaTester");
    expect(r.stderr).toContain("FAIL es");
  });
});

describe("check-i18n-quality.mjs — embedded-Latin detector", () => {
  let heFailDir: string;
  let thFailDir: string;
  let csvCaseFailDir: string;
  let cjkBrandPassDir: string;
  let brandAllowlistPassDir: string;

  beforeAll(async () => {
    heFailDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-emb-he-"));
    thFailDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-emb-th-"));
    csvCaseFailDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-emb-csv-"));
    cjkBrandPassDir = await fs.mkdtemp(path.join(os.tmpdir(), "i18n-q-emb-cjk-"));
    brandAllowlistPassDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "i18n-q-emb-brand-"),
    );

    // Hebrew word with a Latin fragment glued in the middle (MT accident).
    await scaffold(heFailDir, {
      "public/locales/en.json": json(EN),
      "public/locales/he.json": json({
        app_greeting: "תAGים דומים",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ he: 0 }),
    });

    // Thai partial transliteration with a Latin tail ("บุ๊คมาrk"). [i18n-allow]
    await scaffold(thFailDir, {
      "public/locales/en.json": json(EN),
      "public/locales/th.json": json({
        app_greeting: "เลือกบุ๊คมาrk",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ th: 0 }),
    });

    // Mixed-case "Csv" glue (the CSV-family MT artifact) must flag even
    // though all-caps "CSV" is allowlisted.
    await scaffold(csvCaseFailDir, {
      "public/locales/en.json": json(EN),
      "public/locales/ru.json": json({
        app_greeting: "CsvСводка",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ ru: 0 }),
    });

    // Korean/Japanese brand+particle compounds, digit runs (P2P) and the
    // iOS brand are the legit exceptions — must never flag.
    await scaffold(cjkBrandPassDir, {
      "public/locales/en.json": json(EN),
      "public/locales/ko.json": json({
        app_greeting: "BookmarkForge는 북마크",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "public/locales/ja.json": json({
        app_greeting: "P2PコラボレーションとAIを起動中",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ ko: 0, ja: 0 }),
    });

    // Markdown/RAG/iOS-style brand tokens inside CJK text are legitimate.
    await scaffold(brandAllowlistPassDir, {
      "public/locales/en.json": json(EN),
      "public/locales/zh.json": json({
        app_greeting: "Markdownプレビュー",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "public/locales/ja.json": json({
        app_greeting: "iOSでのデータ損失のリスク",
        app_anthropic: "Anthropic Claude",
        app_supportChatHello: EN.app_supportChatHello,
        app_model: "WebLLM",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ zh: 0, ja: 0 }),
    });
  });

  afterAll(async () => {
    for (const dir of [
      heFailDir,
      thFailDir,
      csvCaseFailDir,
      cjkBrandPassDir,
      brandAllowlistPassDir,
    ]) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags Latin fragments glued inside Hebrew words", () => {
    const r = runIn(heFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("embedded Latin \"AG\" in non-Latin word");
    expect(r.stderr).toContain("FAIL he");
  });

  it("flags partial Thai transliterations (บุ๊คมาrk)", () => {
    const r = runIn(thFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("embedded Latin \"rk\" in non-Latin word");
    expect(r.stderr).toContain("FAIL th");
  });

  it("flags the mixed-case Csv glue even though CSV is allowlisted", () => {
    const r = runIn(csvCaseFailDir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("embedded Latin \"Csv\" in non-Latin word");
    expect(r.stderr).toContain("FAIL ru");
  });

  it("never flags Korean/Japanese brand+particle compounds or digit runs", () => {
    const r = runIn(cjkBrandPassDir);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("embedded Latin");
  });

  it("never flags Markdown/RAG/iOS brand tokens inside CJK text", () => {
    const r = runIn(brandAllowlistPassDir);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain("embedded Latin");
  });
});

describe("npm run check:i18n:fix integration", () => {
  let npmFixDir: string;

  /** Run the real npm script `check:i18n:fix` in the given cwd. */
  function runNpmIn(dir: string): {
    exitCode: number;
    stdout: string;
    stderr: string;
  } {
    try {
      const output = execSync("npm run check:i18n:fix", {
        cwd: dir,
        encoding: "utf-8",
      });
      return { exitCode: 0, stdout: output, stderr: "" };
    } catch (e: unknown) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return {
        exitCode: err.status ?? 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      };
    }
  }

  beforeAll(async () => {
    npmFixDir = await fs.mkdtemp(path.join(os.tmpdir(), "bmf-i18nfix-npm-"));

    // Locale files with one injected quality defect: es keeps the English
    // multi-word phrase "Public document" byte-identical to en (the other
    // EN values are brand/concierge/single-token and never flag).
    await scaffold(npmFixDir, {
      "public/locales/en.json": json(EN),
      "public/locales/es.json": json(EN),
      // Both baselines exist and record 0 issues — the drift is NEW.
      "scripts/i18n-backlog-baseline.json": json({
        total: Object.keys(EN).length,
        locales: { es: { untranslated: 0 } },
        updatedAt: "2026-08-12T00:00:00.000Z",
      }),
      "scripts/i18n-quality-baseline.json": baseline({ es: 0 }),
      // Mirror the real repo wiring: the npm script this test exercises.
      "package.json": json({
        scripts: {
          "check:i18n:fix":
            "node scripts/i18n-completeness.mjs --fix && node scripts/check-i18n-quality.mjs --fix",
        },
      }),
    });

    // Mirror the real repo layout: the npm scripts resolve
    // `node scripts/... --fix` relative to cwd, so the scaffold needs the
    // real scripts (check-i18n-quality imports audit-core.mjs).
    const scriptsSrc = path.join(process.cwd(), "scripts");
    await Promise.all([
      fs.copyFile(
        path.join(scriptsSrc, "i18n-completeness.mjs"),
        path.join(npmFixDir, "scripts", "i18n-completeness.mjs"),
      ),
      fs.copyFile(
        path.join(scriptsSrc, "check-i18n-quality.mjs"),
        path.join(npmFixDir, "scripts", "check-i18n-quality.mjs"),
      ),
      fs.copyFile(
        path.join(scriptsSrc, "audit-core.mjs"),
        path.join(npmFixDir, "scripts", "audit-core.mjs"),
      ),
    ]);
  });

  afterAll(async () => {
    await fs.rm(npmFixDir, { recursive: true, force: true });
  });

  it("fails before the fix; the first npm run rebaselines (exit 1 by design)", async () => {
    // Pre-fix: the quality gate fails on the untranslated value.
    const gate = runIn(npmFixDir);
    expect(gate.exitCode).toBe(1);
    expect(gate.stderr).toContain(
      "untranslated value (identical to en): app_publicDoc",
    );

    // First npm run: --fix rebaselines BOTH stages, but failures were
    // computed against the pre-change baseline, so the run still exits 1
    // (documented i18n:fix contract — re-run to confirm green).
    const first = runNpmIn(npmFixDir);
    expect(first.exitCode).toBe(1);
    expect(first.stdout).toContain("[i18n-completeness] baseline updated");
    expect(first.stdout).toContain("[check-i18n-quality] baseline updated");

    // The quality baseline now records the drift.
    const qBase = JSON.parse(
      await fs.readFile(
        path.join(npmFixDir, "scripts", "i18n-quality-baseline.json"),
        "utf-8",
      ),
    );
    expect(qBase.locales.es.issues).toBe(1);
  });

  it("second npm run exits 0 and leaves no residual drift (idempotent)", async () => {
    const second = runNpmIn(npmFixDir);
    expect(second.exitCode).toBe(0);

    // Both gate stages pass after the rebaseline.
    expect(runIn(npmFixDir).exitCode).toBe(0);

    // A further npm run changes nothing.
    const third = runNpmIn(npmFixDir);
    expect(third.exitCode).toBe(0);
    const qBase = JSON.parse(
      await fs.readFile(
        path.join(npmFixDir, "scripts", "i18n-quality-baseline.json"),
        "utf-8",
      ),
    );
    expect(qBase.locales.es.issues).toBe(1);
  });
});
