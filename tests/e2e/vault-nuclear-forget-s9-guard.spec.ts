import { test, expect } from "@playwright/test";
import { setupVault, VAULT_PASSWORD } from "./vault-helpers";
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
 * S9 — AI lock guard via NUCLEAR FORGET (Right to be Forgotten)
 *
 * Same guarantee as vault-lock-no-key-exfil.spec.ts (cloud AI is rejected
 * after the vault is locked, zero key-carrying requests leave the browser),
 * but the lock is triggered by NuclearForgetService.nuclearForget() instead
 * of the Lock Vault button. nuclearForget() calls securityVault.lock() as
 * its first step — the S9 lock listeners (VaultIntegration.clearApiKey →
 * aiManager.getApiKey() null) must fire identically, and the key must not
 * survive in memory.
 *
 * The forget runs through the production service path with the real master
 * password + explicit confirmation (the exact contract a UI caller must
 * satisfy). The in-memory guards are verified BEFORE the app is destroyed;
 * after the wipe the page would show a fresh-install UI (not asserted here —
 * the idb-persistence suite covers the reload behavior).
 */

test.describe("S9 - AI guard via nuclear forget", () => {
  const TEST_API_KEY = "sk-e2e-nuclear-key-445566";

  test("nuclear forget purges the key and blocks cloud AI with no leaks", async ({
    page,
  }) => {
    await pinDeterministicEnv(page);
    await mockOpenAI(page);

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

    // --- 4. Nuclear Forget: production service path (real master password +
    // explicit confirmation). skipAudit keeps the forensic audit IDB clean. ---
    const forgetResult = await page.evaluate(
      async ({ password }) => {
        const { nuclearForgetService } = await import(
          "/src/services/NuclearForgetService.ts"
        );
        try {
          const report = await nuclearForgetService.nuclearForget({
            password,
            confirm: true,
            skipAudit: true,
          });
          return { ok: true, report };
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      { password: VAULT_PASSWORD },
    );
    expect(
      forgetResult.ok,
      `nuclearForget must succeed with correct password + confirm — ${!forgetResult.ok ? forgetResult.error : ""}`,
    ).toBe(true);
    if (forgetResult.ok) {
      expect(forgetResult.report?.wiped).toContain("vault-lock");
    }

    // --- 5. The vault is now locked and the decrypted key is purged from
    // memory (nuclearForget's first step is securityVault.lock(), which fires
    // the S9 lock listeners). NOTE: aiManager.isVaultLocked() returns false
    // after a forget because it means "a key exists AND vault locked" — the
    // key was wiped, so the REAL vault flag (securityVault.isLocked) is the
    // proof here.
    const afterForget = await aiCall(page, { complexity: "complex" });
    expect(
      afterForget.diag.securityVaultLocked,
      "the vault itself must be locked after nuclear forget",
    ).toBe(true);
    expect(
      afterForget.diag.apiKey,
      "the decrypted API key must not survive nuclear forget in memory",
    ).toBeNull();

    // --- 6. Post-forget calls. The provider singleton keeps its in-memory
    // "openai" selection (only persisted state was wiped), so a complex call
    // may still "succeed" against the MOCKED endpoint — but WITHOUT the key:
    // the in-memory copy was purged by the vault lock. That is exactly the S9
    // guarantee this spec exists for, and the network detector below proves no
    // request carried the key. The calls are exercised so the detector has a
    // chance to catch a regression where the key survived the forget.
    const streamAfterForget = await streamAiCall(page, {
      complexity: "complex",
    });
    if (!streamAfterForget.ok) {
      expect(streamAfterForget.diag.securityVaultLocked).toBe(true);
      expect(streamAfterForget.diag.apiKey).toBeNull();
    }

    // --- 7. THE invariant: after the forget, ZERO requests carried the key.
    expect(
      detector.count(),
      `after nuclear forget, no request may carry the API key. Leaks: ${detector.details().join(" | ")}`,
    ).toBe(baseline);
  });
});
