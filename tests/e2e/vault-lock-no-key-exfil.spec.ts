import { test, expect } from "@playwright/test";
import { setupVault, lockVault, unlockVault } from "./vault-helpers";
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
 * S9 — no API-key exfiltration after lock (E2E)
 *
 * Flow: open the app → configure the vault → configure an OpenAI API key +
 * provider → verify the key DOES travel to the cloud while unlocked (control,
 * proves the network detector works) → lock the vault via the Lock Vault
 * button → attempt BOTH the non-streaming and the STREAMING cloud paths →
 * assert:
 *   1. Each attempt is rejected with the S9 "Vault is locked" guard error.
 *   2. ZERO requests carrying the key leave the browser after the lock
 *      (checked on Authorization header, x-api-key header, POST body and URL
 *      query for every outbound request, cloud OR local).
 * → unlock through the real UI → cloud AI works again (key rehydrated in
 * memory, the SAME key, and the network path re-armed).
 *
 * Shared helpers live in ./ai-guard-helpers.ts (env pinning, OpenAI mock,
 * key-leak detector, aiCall/streamAiCall).
 */

test.describe("S9 - no API key exfiltration after lock", () => {
  const TEST_API_KEY = "sk-e2e-exfil-key-987654";
  const OPENAI_REPLY = "Mock reply from OpenAI";

  test("unlocked sends the key; after lock neither text nor stream leaks it", async ({
    page,
  }) => {
    // Deterministic environment — see ai-guard-helpers for the rationale.
    await pinDeterministicEnv(page);
    await mockOpenAI(page);

    // --- Network detector: capture EVERY outbound request and flag any that
    // carries the API key (headers, body or URL). Registered before the first
    // AI call so nothing can slip through.
    const detector = createKeyLeakDetector(page, TEST_API_KEY);

    // --- 1. UI: configure the vault ---
    await setupVault(page);

    // --- 2. Configure API key + cloud provider via the production path ---
    await configureOpenAICloud(page, TEST_API_KEY);
    // Note: setApiKey() also fetches /models with the key, so the counter is
    // already > 0 here. The controls below assert INCREMENTS over this
    // baseline so each flow is provably observed by the detector.
    const requestsWithKeyAfterSetup = detector.count();
    expect(requestsWithKeyAfterSetup).toBeGreaterThan(0);

    // --- 3. CONTROL (unlocked, NON-STREAMING): cloud AI works AND the key
    // travels. Asserting an INCREMENT over the setup baseline proves the
    // detector observes the generateText path itself — if it failed, the
    // whole "no leak after lock" assertion would be vacuous.
    const unlocked = await aiCall(page, { complexity: "complex" });
    expect(
      unlocked.ok,
      `control: cloud AI should succeed while unlocked — ${!unlocked.ok ? unlocked.error : ""}`,
    ).toBe(true);
    if (unlocked.ok) {
      expect(unlocked.provider).toBe("openai");
      expect(unlocked.text).toContain(OPENAI_REPLY);
    }
    expect(
      detector.count(),
      "control: generateText must carry the key while unlocked (detector must observe it)",
    ).toBeGreaterThan(requestsWithKeyAfterSetup);
    const requestsWithKeyAfterTextControl = detector.count();

    // --- 3b. CONTROL (unlocked, STREAMING): the SSE path also carries the key
    // while unlocked — so the detector provably covers the streaming flow too.
    const unlockedStream = await streamAiCall(page, { complexity: "complex" });
    expect(
      unlockedStream.ok,
      `control: cloud streaming should succeed while unlocked — ${!unlockedStream.ok ? unlockedStream.error : ""}`,
    ).toBe(true);
    if (unlockedStream.ok) {
      expect(unlockedStream.provider).toBe("openai");
      expect(unlockedStream.text).toContain(OPENAI_REPLY);
    }
    expect(
      detector.count(),
      "control: streaming must also carry the key while unlocked (detector must observe it)",
    ).toBeGreaterThan(requestsWithKeyAfterTextControl);
    const requestsWithKeyUnlocked = detector.count();

    // --- 4. UI: lock the vault via the Lock Vault button ---
    await lockVault(page);

    // --- 5. Non-streaming cloud path is rejected by the S9 guard ---
    const lockedText = await aiCall(page, { complexity: "complex" });
    expect(lockedText.ok, `text path must fail after lock`).toBe(false);
    if (!lockedText.ok) {
      expect(lockedText.error ?? "").toMatch(/vault is locked/i);
      // S9 memory-hygiene invariant: the guard branch fired because the vault
      // is actually locked and the decrypted key is gone from memory.
      expect(lockedText.diag.vaultLocked).toBe(true);
      expect(lockedText.diag.apiKey).toBeNull();
    }

    // --- 6. STREAMING cloud path is rejected by the S9 guard too ---
    const lockedStream = await streamAiCall(page, { complexity: "complex" });
    expect(
      lockedStream.ok,
      `streaming path must fail after lock — ${JSON.stringify(lockedStream)}`,
    ).toBe(false);
    if (!lockedStream.ok) {
      expect(lockedStream.error ?? "").toMatch(/vault is locked/i);
      expect(lockedStream.diag.vaultLocked).toBe(true);
      expect(lockedStream.diag.apiKey).toBeNull();
    }

    // --- 7. THE invariant: after the lock, ZERO requests carried the key.
    // requestsWithKey must not have grown since the last unlocked control.
    expect(
      detector.count(),
      `after lock, no request may carry the API key. Leaks: ${detector.details().join(" | ")}`,
    ).toBe(requestsWithKeyUnlocked);

    // --- 8. Unlock the vault through the real UI with the correct password.
    await unlockVault(page);

    // --- 9. Cloud AI works again: the key is rehydrated in memory on unlock
    // (VaultIntegration re-decrypts + re-seeds ProviderConfiguration's
    // openAIProvider copy). Verify BOTH flows and the memory-hygiene
    // invariants (the SAME key restored, vault unlocked).
    const rehydratedText = await aiCall(page, { complexity: "complex" });
    expect(
      rehydratedText.ok,
      `cloud AI must work again after unlock — ${!rehydratedText.ok ? rehydratedText.error : ""} diag=${JSON.stringify(rehydratedText.diag)}`,
    ).toBe(true);
    if (rehydratedText.ok) {
      expect(rehydratedText.provider).toBe("openai");
      expect(rehydratedText.text).toContain(OPENAI_REPLY);
    }
    expect(rehydratedText.diag.vaultLocked).toBe(false);
    expect(rehydratedText.diag.apiKey).toBe(TEST_API_KEY);

    const rehydratedStream = await streamAiCall(page, { complexity: "complex" });
    expect(
      rehydratedStream.ok,
      `cloud streaming must work again after unlock — ${!rehydratedStream.ok ? rehydratedStream.error : ""}`,
    ).toBe(true);
    if (rehydratedStream.ok) {
      expect(rehydratedStream.provider).toBe("openai");
      expect(rehydratedStream.text).toContain(OPENAI_REPLY);
    }
    expect(rehydratedStream.diag.vaultLocked).toBe(false);
    expect(rehydratedStream.diag.apiKey).toBe(TEST_API_KEY);

    // The unlocked rehydrated calls legitimately send the key again — the
    // no-leak invariant is specifically about the LOCKED window, which ended
    // at step 7. Sanity: the rehydration really re-armed the network path.
    expect(
      detector.count(),
      "after unlock, the key travels again (rehydration re-armed cloud AI)",
    ).toBeGreaterThan(requestsWithKeyUnlocked);
  });
});
