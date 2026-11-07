#!/usr/bin/env node
/**
 * scripts/capture-p2p-desk-drill.mjs
 *
 * Desktop half of docs/p2p-sync-session-prep.md, executed for real against a
 * running HTTPS server (default: the production `vite preview` on
 * https://192.168.0.22:4174). It produces the two captures the session sheet
 * assigns to the desktop BEFORE any phone is involved, exactly named per the
 * sheet convention:
 *
 *   evidence/p2p-desk/p2p-01-lan-warning-desk.png   (sheet §1.1)
 *   evidence/p2p-desk/p2p-03-offer-qr-desk.png      (sheet §2.1)
 *
 * What it does end to end:
 *   1. Creates a REAL drill vault through the production UI (11+ char
 *      password, recovery kit downloaded as evidence) — only on first run;
 *      afterwards the persistent profile (in .d/tmp/, git-ignored) reuses it
 *      through the real lock screen → unlock path.
 *   2. Seeds the sheet's desktop test data through the real UI (fresh vault
 *      only): bookmarks DESK-Alpha / DESK-Bravo + document DESK-Charlie.
 *   3. Opens the Secure P2P Sync modal via the real user path (Omnibar
 *      Ctrl+K → Intelligence Center → Data sub-tab), captures the same-LAN
 *      warning card and starts the host flow to render the offer QR.
 *
 * What it deliberately does NOT do: everything that needs the physical phone
 * (scan the QR, answer QR, sync progress/success, roles swap, offline cuts).
 * The manifest records those as pending-human steps.
 *
 * Usage:
 *   node scripts/capture-p2p-desk-drill.mjs
 *   DRILL_BASE_URL=https://192.168.0.22:4174 node scripts/capture-p2p-desk-drill.mjs
 *   DRILL_RESET=1 node scripts/capture-p2p-desk-drill.mjs   # wipe profile, full re-seed
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE = process.env.DRILL_BASE_URL || "https://192.168.0.22:4174";
const OUT_DIR = resolve(process.env.DRILL_OUT_DIR || "evidence/p2p-desk");
const PROFILE_DIR = resolve(".d/tmp/p2p-drill-profile"); // git-ignored scratch
const DRILL_PASSWORD = "correct-horse-42"; // drill-only throwaway vault

const steps = [];
const captures = [];
function step(id, ok, note) {
  steps.push({ id, ok, note });
  console.log(`${ok ? "✅" : "❌"} ${id} — ${note}`);
}

async function shot(_page, file, label, fullPage = true) {
  const path = join(OUT_DIR, file);
  await page.screenshot({ path, fullPage });
  captures.push({ file, label });
  console.log(`  📸 ${file} (${label})`);
}

async function visible(_page, locator, timeout) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

const T = (ms) => Math.round(ms * 2); // generous, KDF-aware budgets

mkdirSync(OUT_DIR, { recursive: true });
if (process.env.DRILL_RESET === "1") {
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  console.log("🔄 profile wiped (DRILL_RESET=1) — full vault re-seed this run");
}

// Persistent profile: the drill vault survives runs, so re-runs skip the
// 3-4 min create/seed and are fast + deterministic. Ephemeral contexts made
// every retry rebuild everything and flake independently (observed: the
// post-reload unlock passed twice then stalled once under KDF/AI load).
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  locale: "en-US", // session sheet's language check is the PHONE capture (p2p-02)
  ignoreHTTPSErrors: true, // self-signed drill certificate
  viewport: { width: 1280, height: 800 },
});

try {
  const page = context.pages()[0] ?? (await context.newPage());

  // Root-cause capture: the app's setup-error banner is a generic fallback,
  // so mirror vault-helpers.setupVault and surface the app's own events.
  const appErrors = [];
  const note = (kind, text) => {
    appErrors.push(`[${kind}] ${new Date().toISOString().slice(11, 23)} ${String(text).slice(0, 260)}`);
    if (appErrors.length > 30) appErrors.shift();
  };
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") note(m.type(), m.text());
  });
  page.on("pageerror", (err) => note("pageerror", err.message));
  const errTail = () =>
    appErrors.length ? `\nApp events:\n${appErrors.join("\n")}` : "";

  async function dismissOverlaysTolerant() {
    for (const name of [
      "Skip onboarding",
      "Skip tour",
      "Got it, remind me later",
      "Dismiss tip",
    ]) {
      const btn = page.getByRole("button", { name });
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: T(15_000), noWaitAfter: true }).catch(() => {});
      }
    }
  }

  async function answerConsentIfPresent() {
    const consentRegion = page.locator('[role="region"][aria-label="Privacy consent"]');
    if (await consentRegion.isVisible().catch(() => false)) {
      await page
        .getByRole("button", { name: "Accept All" })
        .click({ timeout: T(15_000), noWaitAfter: true })
        .catch(() => {});
      await consentRegion.waitFor({ state: "hidden", timeout: T(10_000) }).catch(() => {});
      step("consent-banner", true, "first-run privacy consent answered (production-only overlay)");
    }
  }

  async function unlockFromLockScreen() {
    await page
      .getByRole("heading", { name: "Vault is locked." })
      .waitFor({ state: "visible", timeout: T(60_000) });
    await page.getByLabel("Master Password").fill(DRILL_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    try {
      await page
        .getByTestId("settings-button")
        .waitFor({ state: "visible", timeout: T(120_000) });
    } catch {
      // One retry: under KDF/AI load the unlock can stall; a fresh reload
      // re-enters the same path the user would take.
      await page.reload({ timeout: T(30_000) });
      await page
        .getByRole("heading", { name: "Vault is locked." })
        .waitFor({ state: "visible", timeout: T(60_000) });
      await page.getByLabel("Master Password").fill(DRILL_PASSWORD);
      await page.getByRole("button", { name: "Unlock" }).click();
      await page
        .getByTestId("settings-button")
        .waitFor({ state: "visible", timeout: T(120_000) });
    }
  }

  async function addBookmark(title, url) {
    await page.getByTestId("add-bookmark-button").click();
    const input = page.getByTestId("quick-capture-input");
    await input.waitFor({ state: "visible", timeout: T(15_000) });
    await input.fill(url);
    await page.getByTestId("bookmark-title-input").fill(title);
    await page.getByTestId("save-bookmark-button").click();
    await page
      .getByTestId("close-quick-capture-button")
      .waitFor({ state: "hidden", timeout: T(60_000) });
  }

  async function openP2PModal() {
    // The P2P card lives in the Intelligence Center modal (Dashboard sub-tab
    // "Data"), reachable only via the Omnibar command: Ctrl+K →
    // "Intelligence Center" (Omnibar.tsx cmd-analysis → show_analysis →
    // MainApp setShowAnalysis). Deterministic flow: wait for the combobox
    // input (the omnibar mounts with autoFocus), type to filter, wait for
    // the option, click. No blind Enter fallback — it can fire another item.
    await page.keyboard.press("Control+k");
    const omniInput = page.locator('[role="combobox"]');
    await omniInput.waitFor({ state: "visible", timeout: T(15_000) });
    await omniInput.fill("Intelligence");
    const option = page.getByRole("option", { name: /Intelligence Center/i }).first();
    await option.waitFor({ state: "visible", timeout: T(20_000) });
    await option.click({ timeout: T(10_000) });
    await page
      .getByRole("heading", { name: "Intelligence Center" })
      .waitFor({ state: "visible", timeout: T(20_000) });
    step("intel-center", true, "Intelligence Center modal open (via Omnibar Ctrl+K)");

    // Sub-tab "Data" — real accessible name is app_dataManagement:
    // "Data Sovereignty" (locale value, NOT the code's "Data" fallback).
    await page
      .getByRole("button", { name: /Data Sovereignty/i })
      .click({ timeout: T(15_000) });
    const p2pCard = page.getByText("Secure P2P Sync", { exact: true });
    if (!(await visible(page, p2pCard, 5_000))) {
      throw new Error(`P2P card not visible inside the Data sub-tab${errTail()}`);
    }
    step("p2p-card", true, "Secure P2P Sync card visible");

    // Open the actual P2P modal — the LAN warning card lives inside it.
    await page
      .getByRole("button", { name: "Start Local Connection" })
      .click({ timeout: T(15_000) });
    await page
      .locator('[role="dialog"][aria-label="Secure P2P Sync"]')
      .waitFor({ state: "visible", timeout: T(20_000) });
  }

  // ── 1. Production app loads ────────────────────────────────────────────
  await page.goto(`${BASE}/`, { timeout: T(30_000) });
  const title = await page.title();
  step("app-load", title.includes("BookmarkForge"), `title: "${title}"`);

  // Boot-state discriminator — isVisible() RACES the app boot (SW + RxDB
  // take seconds; observed: the locked screen was up yet isVisible said
  // false). Wait for whichever state appears first, then branch.
  const lockedH = page.getByRole("heading", { name: "Vault is locked." });
  const secure = page.getByRole("heading", { name: "Secure your vault" });
  const shellBtn = page.getByTestId("settings-button");
  await Promise.race([
    lockedH.waitFor({ state: "visible", timeout: T(45_000) }).catch(() => "no"),
    secure.waitFor({ state: "visible", timeout: T(45_000) }).catch(() => "no"),
    shellBtn.waitFor({ state: "visible", timeout: T(45_000) }).catch(() => "no"),
  ]);
  const isLocked = await lockedH.isVisible().catch(() => false);
  const isFresh = await secure.isVisible().catch(() => false);
  const needsCreate = isFresh && !isLocked;

  if (needsCreate) {
    // ── 2a. First run: real vault creation through the production UI ────
    // (ported from tests/e2e/vault-helpers.ts setupVault; no durable-backend
    // guard here — that hook only exists in dev/test builds.)
    await page.getByRole("button", { name: "Set up password" }).click();
    await page
      .getByRole("heading", { name: "Setup Secure Vault" })
      .waitFor({ timeout: T(60_000) });

    const download = page.waitForEvent("download", { timeout: T(30_000) });
    await page.getByRole("button", { name: "Download Recovery Kit" }).click();
    const kit = await download;
    await kit.saveAs(join(OUT_DIR, "desk-recovery-kit.txt"));
    captures.push({ file: "desk-recovery-kit.txt", label: "sheet §2 recovery kit (drill vault)" });
    step("recovery-kit", true, "saved desk-recovery-kit.txt");

    const confirm = page.getByRole("checkbox", {
      name: "I have safely saved the recovery phrase",
    });
    await confirm.waitFor({ state: "visible", timeout: T(15_000) });
    await confirm.click();
    await page.getByLabel("Master Password").fill(DRILL_PASSWORD);
    await page.getByRole("button", { name: "Create Vault" }).click();

    const settingsButton = page.getByTestId("settings-button");
    const errorBanner = page.locator(".security-error-in");
    const outcome = await Promise.race([
      settingsButton
        .waitFor({ state: "visible", timeout: T(120_000) })
        .then(() => "unlocked"),
      errorBanner
        .waitFor({ state: "visible", timeout: T(120_000) })
        .then(async () => `error: ${(await errorBanner.textContent()) ?? ""}`),
    ]);
    if (outcome !== "unlocked") {
      throw new Error(`Vault setup failed — ${outcome}${errTail()}`);
    }
    step("vault-create", true, "unlocked shell reached (Argon2id done)");

    await dismissOverlaysTolerant();
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(800);
    await answerConsentIfPresent();

    // ── 3. Seed the sheet's DESK test data through the real UI ──────────
    await addBookmark("DESK-Alpha morning reads", "https://example.com/desk-alpha");
    step("seed-desk-alpha", true, "bookmark created via QuickCapture");
    await addBookmark("DESK-Bravo sync test", "https://example.com/desk-bravo");
    step("seed-desk-bravo", true, "bookmark created via QuickCapture");

    // Document (BlockNote editor; first line doubles as the title)
    await page.locator('[data-tab-id="documents"]').click();
    await page.getByTestId("new-document-button").click();
    const editor = page.locator(".bn-editor");
    await editor.waitFor({ state: "visible", timeout: T(30_000) });
    await editor.click();
    await page.keyboard.type("DESK-Charlie — desktop drill document for P2P sync.", {
      delay: 15,
    });
    step("seed-desk-charlie", true, "document typed in BlockNote editor");

    // ── 4. Persistence proof: reload → locked → unlock (real user path) ──
    await page.reload({ timeout: T(30_000) });
    await unlockFromLockScreen();
    step("unlock-after-reload", true, "drill vault persisted and re-unlocked (production)");
  } else {
    // ── 2b. Re-run: reuse the persistent drill vault ─────────────────────
    if (isLocked) {
      await unlockFromLockScreen();
      step("unlock-reuse", true, "drill vault re-unlocked from the persistent profile");
    } else {
      await shellBtn.waitFor({ state: "visible", timeout: T(120_000) });
      step("vault-already-open", true, "shell already unlocked in the persistent profile");
    }
    await answerConsentIfPresent();
    await dismissOverlaysTolerant();
  }

  await page.waitForTimeout(1_000);

  // ── 5. Real user path to the P2P card + sheet §1.1 capture ─────────────
  await openP2PModal();

  const lanCard = page
    .locator('[role="note"]')
    .filter({ hasText: /same Wi-Fi network/i });
  if (!(await visible(page, lanCard, T(20_000)))) {
    throw new Error(`P2P modal opened but the LAN warning card is not visible${errTail()}`);
  }
  await shot(page, "p2p-01-lan-warning-desk.png", "sheet §1.1 LAN warning (desktop)");
  step("p2p-01", true, "LAN warning card captured");

  // p2p-02 is the SAME modal on the phone in its system language — human step.

  // ── 6. §2.1 — host flow: offer QR over white background ───────────────
  await page.getByRole("button", { name: "This is the host" }).click();
  const scanMe = page.getByText("Step 1: Scan this QR", { exact: false });
  if (!(await visible(page, scanMe, T(30_000)))) {
    throw new Error(`Host flow did not reach the offer-QR step${errTail()}`);
  }
  await page.waitForTimeout(1_500); // lazy react-qr-code SVG mount
  const qrSvg = await page.locator("svg path").count();
  if (qrSvg < 10) {
    throw new Error(`Offer QR SVG looks empty (path count=${qrSvg})`);
  }
  await shot(page, "p2p-03-offer-qr-desk.png", "sheet §2.1 host offer QR (desktop)");
  step("p2p-03", true, `offer QR rendered (${qrSvg} path elements)`);

  // ── 7. Manifest — evidence index + what remains human-only ────────────
  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    build: "production (vite preview, VITE_DEV_HTTPS=1)",
    drillVaultPassword: DRILL_PASSWORD,
    persistentProfile: PROFILE_DIR,
    steps,
    captures,
    pendingHuman: [
      "p2p-02  LAN warning on the iPhone (system language — sheet §1.2)",
      "p2p-04  answer QR on the iPhone after scanning p2p-03 (sheet §2.2)",
      "p2p-05..09  syncing/success/convergence captures (sheet §2.3-2.6)",
      "Sections 3-7 of the session sheet (roles swap, incremental, LWW, offline, network limits)",
    ],
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nEvidence dir: ${OUT_DIR}`);
  console.log("Manifest: manifest.json — desktop side COMPLETE.");
  console.log("Next: run the iPhone session with docs/p2p-sync-session-prep.md in hand.");
} catch (error) {
  steps.push({ id: "FATAL", ok: false, note: String(error?.message ?? error) });
  try {
    const page = context.pages()[0];
    if (page) {
      await page.screenshot({ path: join(OUT_DIR, "p2p-99-error-state.png"), fullPage: true });
      console.log("  📸 p2p-99-error-state.png (failure evidence)");
    }
  } catch { /* best effort */ }
  writeFileSync(
    join(OUT_DIR, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE, ok: false, steps, captures }, null, 2)}\n`,
  );
  console.error(`\nDRILL CAPTURE FAILED: ${error?.message ?? error}`);
  console.error(`Partial evidence in ${OUT_DIR} — re-run reuses the profile (DRILL_RESET=1 for a full re-seed).`);
  process.exitCode = 1;
} finally {
  await context.close();
}
