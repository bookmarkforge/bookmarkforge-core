import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server as NetServer } from "node:net";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skipPassword } from "./vault-helpers";
import { mountRenderCrash } from "./crisis-helpers";

const ERROR_DB = "bookmarkforge-errors";
const ERROR_STORE = "errors";
const PREVIEW = process.env.CRISIS_PREVIEW === "1";
const QUOTA_FILL_CHUNK_BYTES = Number.parseInt(process.env.CRISIS_QUOTA_CHUNK_BYTES ?? "8192", 10);
const QUOTA_FILL_MAX_ITERATIONS = Number.parseInt(process.env.CRISIS_QUOTA_MAX_ITERATIONS ?? "4000", 10);
let companionPort = 0;
let companionUrl = "";
let adminToken = "";
const configuredCompanionPort = Number.parseInt(process.env.CRISIS_COMPANION_PORT ?? "0", 10);
const configuredAdminToken = process.env.CRISIS_ADMIN_TOKEN?.trim() ?? "";
const ADMIN_TOKEN_BYTES = 24;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIGNING_KEY = join(ROOT, "server", ".license-signing-key.pkcs8");
let companion: ChildProcess | null = null;
let companionLog = "";
let webhookServer: HttpServer | null = null;
let webhookPort = 0;
const webhookPayloads: Array<Record<string, unknown>> = [];

async function reserveCompanionPort(): Promise<number> {
  if (Number.isInteger(configuredCompanionPort) && configuredCompanionPort > 0) return configuredCompanionPort;
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function configureCompanionIdentity(): Promise<void> {
  companionPort = await reserveCompanionPort();
  adminToken = configuredAdminToken || randomBytes(ADMIN_TOKEN_BYTES).toString("hex");
  companionUrl = `http://127.0.0.1:${companionPort}`;
}
function startCompanion(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", join(ROOT, "server", "src", "index.ts")], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "test", PORT: String(companionPort), CLIENT_EVENTS_ADMIN_TOKEN: adminToken, CLIENT_EVENTS_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}/client-events-hook`, CLIENT_EVENTS_WEBHOOK_ALLOW_HTTP: "1", HOST: "127.0.0.1", TRUST_PROXY: "1", GEMINI_API_KEY: "e2e-ai-key", GEMINI_API_BASE: "http://127.0.0.1:9/v1beta/models", AI_SESSION_REQUIRE_LICENSE: "0", WHOP_LICENSE_API_URL: "http://127.0.0.1:9/license", WHOP_API_KEY: "e2e-license-key", LICENSE_PROVIDER_ALLOW_HTTP: "1", ...(existsSync(SIGNING_KEY) ? { LICENSE_SIGNING_PRIVATE_KEY_FILE: SIGNING_KEY } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    companion = child;
    child.stdout.on("data", (chunk) => { companionLog += String(chunk); });
    child.stderr.on("data", (chunk) => { companionLog += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => { if (companion === child) reject(new Error(`companion exited (${code})`)); });
    const deadline = Date.now() + 30_000;
    const poll = async (): Promise<void> => {
      try { if ((await fetch(`${companionUrl}/health`)).ok) return resolve(); } catch { /* booting */ }
      if (Date.now() > deadline) return reject(new Error(`companion did not start: ${companionLog.slice(-2000)}`));
      setTimeout(() => void poll(), 250);
    };
    void poll();
  });
}
async function startWebhookCapture(): Promise<void> {
  webhookServer = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => { try { webhookPayloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>); } catch { /* ignore malformed */ } res.writeHead(204); res.end(); });
  });
  await new Promise<void>((resolve, reject) => { webhookServer!.once("error", reject); webhookServer!.listen(0, "127.0.0.1", () => { const address = webhookServer!.address(); webhookPort = typeof address === "object" && address ? address.port : 0; resolve(); }); });
}
async function readStoredErrors(page: Page): Promise<Array<Record<string, unknown>>> { return page.evaluate(async ({ dbName, storeName }) => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(dbName, 1); request.onupgradeneeded = () => { const database = request.result; if (!database.objectStoreNames.contains(storeName)) { const store = database.createObjectStore(storeName, { keyPath: "id" }); store.createIndex("timestamp", "timestamp", { unique: false }); } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); try { if (!db.objectStoreNames.contains(storeName)) return []; return await new Promise<Array<Record<string, unknown>>>((resolve, reject) => { const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll(); request.onsuccess = () => resolve((request.result ?? []) as Array<Record<string, unknown>>); request.onerror = () => reject(request.error); }); } finally { db.close(); } }, { dbName: ERROR_DB, storeName: ERROR_STORE }); }
async function enableDiagnosticsOptIn(page: Page): Promise<void> { await page.evaluate(() => window.localStorage.setItem("bmf_local_error_storage", "true")); }
async function skipAndAlive(page: Page): Promise<void> { await skipPassword(page); await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 10_000 }); }

test.beforeAll(async () => { await configureCompanionIdentity(); await startWebhookCapture(); await startCompanion(); });
test.afterAll(async () => { companion?.kill(); companion = null; if (webhookServer) await new Promise<void>((resolve) => webhookServer!.close(() => resolve())); webhookServer = null; });

test("global error, unhandled rejection, CSP burst and quota pressure never kill the UI and are recorded locally", async ({ page }) => {
  await skipAndAlive(page); await enableDiagnosticsOptIn(page);
  await page.evaluate(() => { window.setTimeout(() => { throw new Error("E2E_CRISIS_GLOBAL_ERROR"); }, 0); });
  await expect.poll(() => readStoredErrors(page), { timeout: 10_000 }).toContainEqual(expect.objectContaining({ message: expect.stringContaining("E2E_CRISIS_GLOBAL_ERROR") }));
  await page.evaluate(() => { Promise.reject(new Error("E2E_CRISIS_REJECTION")); });
  await expect.poll(() => readStoredErrors(page), { timeout: 10_000 }).toContainEqual(expect.objectContaining({ message: expect.stringContaining("E2E_CRISIS_REJECTION") }));
  const errorSpike = await page.evaluate(() => new Promise<{ count: number; reason: string }>((resolve, reject) => { let timer = 0; const onSpike = (event: Event) => { window.clearTimeout(timer); const detail = (event as CustomEvent<{ count?: number; reason?: string }>).detail; resolve({ count: detail?.count ?? 0, reason: detail?.reason ?? "" }); }; timer = window.setTimeout(() => { window.removeEventListener("error-spike", onSpike); reject(new Error("error-spike no emitido")); }, 5_000); window.addEventListener("error-spike", onSpike, { once: true }); for (let i = 0; i < 3; i += 1) window.setTimeout(() => { throw new Error(`E2E_CRISIS_GLOBAL_SPIKE_${i}`); }, i * 25); }));
  expect(errorSpike.count).toBeGreaterThanOrEqual(3); expect(errorSpike.reason).toBe("spike"); await skipAndAlive(page);
  const cspSpike = await page.evaluate(() => new Promise<boolean>((resolve) => { const timer = window.setTimeout(() => resolve(false), 5_000); window.addEventListener("csp-violation-spike", () => { window.clearTimeout(timer); resolve(true); }, { once: true }); for (let i = 0; i < 10; i += 1) { try { document.dispatchEvent(new SecurityPolicyViolationEvent("securitypolicyviolation", { violatedDirective: "script-src", blockedURI: "https://evil.example/x.js", documentURI: window.location.href })); } catch { /* unsupported browser */ } } }));
  expect(cspSpike).toBe(true); await skipAndAlive(page);
  const realQuota = await page.evaluate(({ chunkBytes, maxIterations }) => { const safeChunkBytes = Number.isInteger(chunkBytes) && chunkBytes > 0 ? chunkBytes : 8192; const safeMaxIterations = Number.isInteger(maxIterations) && maxIterations > 0 ? maxIterations : 4000; const chunk = "x".repeat(safeChunkBytes); const fill = (key: string): DOMException | null => { try { localStorage.setItem(key, chunk); return null; } catch (error) { return error instanceof DOMException ? error : null; } }; let realError: DOMException | null = null; for (let i = 0; i < safeMaxIterations && !realError; i += 1) realError = fill(`bmf_e2e_fill_${i}`); if (!realError || realError.name !== "QuotaExceededError") throw new Error(`no real quota error: ${realError?.name ?? "none"}`); const second = fill("bmf_e2e_app_write"); if (!second || second.name !== "QuotaExceededError") throw new Error("quota proof write did not fail"); void (async () => { await Promise.resolve(); localStorage.setItem("bmf_e2e_collapse_write", chunk); })(); return { name: realError.name, message: realError.message, chunkBytes: safeChunkBytes, maxIterations: safeMaxIterations }; }, { chunkBytes: QUOTA_FILL_CHUNK_BYTES, maxIterations: QUOTA_FILL_MAX_ITERATIONS });
  expect(realQuota.name).toBe("QuotaExceededError"); await expect(page.getByText(/storage quota exceeded/i)).toBeVisible({ timeout: 10_000 }); await expect.poll(async () => (await readStoredErrors(page)).some((entry) => /quota/i.test(String(entry.message))), { timeout: 10_000 }).toBe(true); await skipAndAlive(page);
  await page.getByTestId("settings-button").click(); const settingsDialog = page.locator('[aria-labelledby="settings-dialog-title"]'); await expect(settingsDialog).toBeVisible(); await expect(page.getByTestId("settings-storage")).toBeVisible(); await expect(page.getByText(/Storage Manager/i)).toBeVisible(); await expect(page.getByText(/(degraded|read.only|quota|storage)/i).first()).toBeVisible(); const exportButton = page.getByRole("button", { name: /Export Backup|Export backup first/i }).first(); await expect(exportButton).toBeVisible(); await expect(exportButton).toBeEnabled(); const clearButton = page.getByRole("button", { name: /Clear AI (Models|cache)/i }).first(); await expect(clearButton).toBeVisible(); await expect(clearButton).toBeEnabled(); await clearButton.click(); await skipAndAlive(page); await page.keyboard.press("Escape");
  const clusterContexts = await Promise.all([0, 1, 2].map(async (index) => { const context = await page.context().browser()!.newContext(); const clientPage = await context.newPage(); await clientPage.goto("/"); await skipAndAlive(clientPage); await enableDiagnosticsOptIn(clientPage); await clientPage.evaluate((clientIndex) => window.dispatchEvent(new CustomEvent("bundle-integrity-spike", { detail: { count: 3, reason: `e2e-cluster-client-${clientIndex}` } })), index); return { context, clientPage }; }));
  try { await expect.poll(async () => { try { const response = await fetch(`${companionUrl}/api/client-events`, { headers: { "x-client-events-admin-token": adminToken } }); if (!response.ok) return false; const data = (await response.json()) as { recent?: Array<{ type: string; critical?: boolean }> }; return (data.recent ?? []).filter((entry) => entry.type === "bundle-integrity-spike" && entry.critical).length >= 3; } catch { return false; } }, { timeout: 15_000 }).toBe(true); await expect.poll(() => companionLog.includes('"event":"client_events_critical_threshold"'), { timeout: 15_000 }).toBe(true); expect(companionLog).toContain('"criticalClients":3'); await expect.poll(() => webhookPayloads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1); expect(webhookPayloads.at(-1)).toMatchObject({ alert: "client-events-critical-threshold", criticalClients: 3, threshold: 3, windowMs: 600_000 }); } finally { await Promise.all(clusterContexts.map(({ context }) => context.close())); }
  const spikeCount = await page.evaluate(() => new Promise<number>((resolve) => { const timer = window.setTimeout(() => resolve(0), 8_000); window.addEventListener("bundle-integrity-spike", (event) => { window.clearTimeout(timer); resolve((event as CustomEvent<{ count?: number }>).detail?.count ?? 0); }, { once: true }); for (let i = 0; i < 3; i += 1) window.dispatchEvent(new CustomEvent("bundle-integrity-failed", { detail: { mismatchedFiles: [`/assets/evil-${i}.js`], reason: "runtime-injection", checkedAt: new Date().toISOString() } })); })); expect(spikeCount).toBeGreaterThanOrEqual(3); await expect.poll(async () => (await readStoredErrors(page)).some((entry) => /integrity spike/i.test(String(entry.message))), { timeout: 10_000 }).toBe(true); await skipAndAlive(page);
  await page.route("**/*", async (route) => { if (route.request().resourceType() === "script" && /assets\//.test(route.request().url()) && !route.request().url().includes("index")) return route.abort("failed"); await route.continue(); }); await page.goto("/graph"); await expect(page.getByText(/Component Error|section encountered an error/i)).toBeVisible(); await expect(page.getByRole("button", { name: /Reset|Go Back/i }).first()).toBeVisible(); await skipAndAlive(page); await page.unroute("**/*"); await page.goto("/app"); await skipAndAlive(page);
  const crash = await mountRenderCrash(page, PREVIEW); expect(crash.error).toBeUndefined(); expect(crash.fallbackShown).toBe(true); expect(crash.headingShown).toBe(true); const reloadButton = page.getByRole("button", { name: /Reload Application/i }); await expect(reloadButton).toBeVisible(); await reloadButton.click(); await page.waitForLoadState("domcontentloaded"); await skipAndAlive(page); await expect(page.locator('[role="alert"]')).toBeHidden(); if (!PREVIEW) await expect.poll(async () => (await readStoredErrors(page)).some((entry) => /E2E_CRISIS_RENDER_ERROR/.test(String(entry.message))), { timeout: 10_000 }).toBe(true); await page.getByTestId("settings-button").click(); await expect(page.locator('[aria-labelledby="settings-dialog-title"]')).toBeVisible(); await page.keyboard.press("Escape");
});

test("production preview blocks a corrupted chunk through real SRI", async ({ page, browserName }) => {
  test.skip(!PREVIEW, "SRI artifact mutation only applies to production preview");
  const { readFile, writeFile, readdir } = await import("node:fs/promises"); const distDir = join(ROOT, "dist", "assets"); const assetNames = (await readdir(distDir)).filter((name) => /\.(?:js|css)$/.test(name)); test.skip(assetNames.length === 0, "production build has no hashed assets"); const assetName = assetNames.find((name) => /\.js$/.test(name)) ?? assetNames[0]; if (!assetName) throw new Error("production build has no assets"); const assetPath = join(distDir, assetName); const original = await readFile(assetPath); const corrupted = Buffer.concat([original, Buffer.from("\n/* E2E SRI corruption */\n")]);
  try { await writeFile(assetPath, corrupted); const sriBlocked = page.waitForEvent("console", (message) => /integrity|subresource integrity|blocked/i.test(message.text())).catch(() => null); await page.reload({ waitUntil: "domcontentloaded" }); const consoleMessage = await sriBlocked; expect(Boolean(consoleMessage), `the browser did not expose an SRI violation for ${assetName} (${browserName})`).toBe(true); } finally { await writeFile(assetPath, original); }
});
