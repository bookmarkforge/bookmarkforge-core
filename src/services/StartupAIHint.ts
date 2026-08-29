/**
 * StartupAIHint — runs the real SupportDiagnostics probes automatically at
 * app startup when the user is offline OR has no AI provider configured, and
 * shows a sonner toast/banner recommending the Help Center.
 *
 * The message is tailored with the live probe results: if local AI (Ollama)
 * or WebLLM is available, the toast points the user to it; otherwise it
 * recommends configuring an AI provider. The toast action navigates to the
 * Help Center (SupportChat at "/chat").
 *
 * Safe to call multiple times: the session guard prevents re-running the
 * probes more than once per page load, and sonner's toast `id` dedupes the
 * banner itself.
 */
import { checkNetwork, checkOllama, checkWebLLM } from "./SupportDiagnostics";
import { toast } from "sonner";
import i18n from "../i18n";
import { logger } from "../utils/logger";

/** True once the hint has been shown for this page load. */
let shownThisSession = false;

/**
 * Navigates to the Help Center by dispatching the `bmf:navigate` custom
 * event — MainApp listens for it and calls `setActiveTab("chat")`, which
 * routes to "/chat" (the SupportChat route).
 */
function dispatchNavigateToHelp(): void {
  if (typeof window === "undefined") {return;}
  window.dispatchEvent(
    new CustomEvent("bmf:navigate", { detail: { tab: "chat" } }),
  );
}

/**
 * Checks the trigger conditions and, when offline or without a configured AI
 * provider, runs the diagnostics probes and shows the Help Center
 * recommendation. Never throws.
 */
export async function maybeShowStartupAIHint(): Promise<void> {
  if (shownThisSession || typeof window === "undefined") {return;}

  // Trigger condition: the user is offline OR no AI provider is configured
  // (provider info mirrors useAIStatus: isConfigured is false without an
  // API key / configured local AI).
  const online = navigator.onLine ?? true;
  let providerConfigured = false;
  try {
    const { aiManager } = await import("./ai/ProviderManager");
    providerConfigured = aiManager.getProviderInfo().isConfigured === true;
  } catch (err) {
    logger.warn("[StartupAIHint] Provider info unavailable", { error: err });
  }

  if (online && providerConfigured) {return;}

  // Run the real probes to tailor the recommendation (offline status,
  // Ollama reachability, WebLLM readiness).
  const [network, ollama, webLlm] = await Promise.all([
    checkNetwork(),
    checkOllama(),
    checkWebLLM(),
  ]);

  // Re-check the guard: the awaits above could overlap with another call.
  if (shownThisSession) {return;}
  shownThisSession = true;

  const offline = !network.online;
  const title = offline
    ? i18n.t(
        "app_startupAiOffline",
        "You appear to be offline. Cloud AI and web search are unavailable, but local features keep working.",
      )
    : i18n.t("app_startupAiNoProvider", "No AI provider is configured yet.");

  const hint = ollama.available
    ? i18n.t(
        "app_startupAiOllamaAvailable",
        "Local AI (Ollama) is running and ready to use.",
      )
    : webLlm.canRun
      ? i18n.t(
          "app_startupAiWebLlmAvailable",
          "Local AI (WebLLM) can run right in your browser.",
        )
      : i18n.t(
          "app_startupAiSetupHint",
          "Set up an API key in Settings or configure local AI to use the AI assistant.",
        );

  toast.warning(`${title} ${hint}`, {
    id: "startup-ai-hint",
    duration: 15000,
    className: "max-w-[calc(100vw-2rem)] whitespace-normal break-words",
    action: {
      label: i18n.t("app_startupAiOpenHelp", "Open Help Center"),
      onClick: dispatchNavigateToHelp,
    },
  });

  logger.info("[StartupAIHint] Help Center recommendation shown", {
    offline,
    providerConfigured,
    ollamaAvailable: ollama.available,
    webLlmReady: webLlm.canRun,
  });
}
