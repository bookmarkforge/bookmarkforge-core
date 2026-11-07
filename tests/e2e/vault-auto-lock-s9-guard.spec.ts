import { test, expect } from "@playwright/test";
import { setupVault, unlockVault } from "./vault-helpers";
import {
  pinDeterministicEnv,
  configureOpenAICloud,
  mockOpenAI,
  createKeyLeakDetector,
  aiCall,
  streamAiCall,
  OPENAI_REPLY,
} from "./ai-guard-helpers";

/**
 * S9 — AI lock guard via AUTO-LOCK (inactivity)
 *
 * Same guarantee as vault-lock-no-key-exfil.spec.ts (cloud AI is rejected
 * after a lock, zero key-carrying requests leave the browser), but the lock
 * is triggered by the auto-lock inactivity timer instead of the Lock Vault
 * button — proving the guard holds for every lock path, not just the manual
 * one. Auto-lock routes through setForceSetup(true) (the same entry the
 * button uses), so the S9 vault lock + key purge must fire identically.
 */

test.describe("S9 - AI guard via auto-lock", () => {
  const TEST_API_KEY = "sk-e2e-autolock-key-112233";

  test("auto-lock blocks cloud AI and leaks no key, unlock restores it", async ({
    page,
  }) => {
    // Auto-lock timeout: 15s (autoLockEnabled defaults to true). Must be set
    // BEFORE the app boots so useSettings reads it from localStorage. 15s (not
    // 2s) so the unlocked controls have time to run: the timer restarts on
    // every UI activity AND re-arms on unlock (isLocked flips false), so the
    // post-unlock rehydration check also needs the window.
    await page.addInitScript(() => {
      window.localStorage.setItem("auto_lock_timeout", "15000");
    });

    await pinDeterministicEnv(page);
    await mockOpenAI(page);

    // --- Network detector: no request may carry the key after the lock ---
    const detector = createKeyLeakDetector(page, TEST_API_KEY);

    // --- 1. UI: configure the vault ---
    await setupVault(page);

    // --- 2. Configure API key + cloud provider via the production path ---
    await configureOpenAICloud(page, TEST_API_KEY);

    // --- 3. CONTROL (unlocked): cloud AI works and the key travels ---
    const unlocked = await aiCall(page, { complexity: "complex" });
    expect(
      unlocked.ok,
      `control: cloud AI should succeed while unlocked — ${!unlocked.ok ? unlocked.error : ""}`,
    ).toBe(true);
    if (unlocked.ok) {
      expect(unlocked.provider).toBe("openai");
      expect(unlocked.text).toContain(OPENAI_REPLY);
    }
    const baseline = detector.count();
    expect(
      baseline,
      "control: the key MUST travel while unlocked (proves the detector works)",
    ).toBeGreaterThan(0);

    // --- 4. No activity → the 15s auto-lock timer fires → lock screen ---
    await expect(
      page.getByRole("heading", { name: "Vault is locked." }),
    ).toBeVisible({ timeout: 30_000 });

    // --- 5. Non-streaming cloud path is rejected by the S9 guard ---
    const lockedText = await aiCall(page, { complexity: "complex" });
    expect(lockedText.ok, `text path must fail after auto-lock`).toBe(false);
    if (!lockedText.ok) {
      expect(lockedText.error ?? "").toMatch(/vault is locked/i);
      // S9 memory-hygiene invariant: the vault is truly locked and the
      // decrypted key is gone from memory.
      expect(lockedText.diag.vaultLocked).toBe(true);
      expect(lockedText.diag.apiKey).toBeNull();
    }

    // --- 6. STREAMING cloud path is rejected by the S9 guard too ---
    const lockedStream = await streamAiCall(page, { complexity: "complex" });
    expect(
      lockedStream.ok,
      `streaming path must fail after auto-lock — ${JSON.stringify(lockedStream)}`,
    ).toBe(false);
    if (!lockedStream.ok) {
      expect(lockedStream.error ?? "").toMatch(/vault is locked/i);
      expect(lockedStream.diag.vaultLocked).toBe(true);
      expect(lockedStream.diag.apiKey).toBeNull();
    }

    // --- 7. THE invariant: after the auto-lock, ZERO requests carried the key.
    expect(
      detector.count(),
      `after auto-lock, no request may carry the API key. Leaks: ${detector.details().join(" | ")}`,
    ).toBe(baseline);

    // --- 8. Unlock through the real UI → cloud AI works again (key rehydrated)
    await unlockVault(page);
    const rehydrated = await aiCall(page, { complexity: "complex" });
    expect(
      rehydrated.ok,
      `cloud AI must work again after unlock — ${!rehydrated.ok ? rehydrated.error : ""}`,
    ).toBe(true);
    if (rehydrated.ok) {
      expect(rehydrated.provider).toBe("openai");
      expect(rehydrated.text).toContain(OPENAI_REPLY);
    }
    expect(rehydrated.diag.vaultLocked).toBe(false);
    expect(rehydrated.diag.apiKey).toBe(TEST_API_KEY);
    expect(
      detector.count(),
      "after unlock, the key travels again (rehydration re-armed cloud AI)",
    ).toBeGreaterThan(baseline);
  });
});
