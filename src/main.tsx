import "./polyfills";
// P50: Self-host Inter variable font (wght axis) via @fontsource-variable.
// Privacy-first, no Google CDN. Single variable file per unicode subset
// replaces 56 static files (960 KB → 14 files / 464 KB).
import "@fontsource-variable/inter/wght.css";
import React from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./i18n";
// Boot-time env validation — registered FIRST so no other module reads
// `import.meta.env.X` before the registry has checked required keys.
import { envBoot } from "./utils/env-boot";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import {
  validateEnvVars,
  getEnvironmentInfo,
  assertValidForBuild,
} from "./constants/config";
import { logger } from "./utils/logger";
import {
  isFirewallEnabled,
  getWhitelistedOrigins,
  configureNetworkFirewall,
} from "./utils/networkFirewall";
import { secureStorage } from "./services/SecureStorage";
import { setupApiInterceptors } from "./services/api";
import { securityVault } from "./services/SecurityVault";
import { reportWebVitals } from "./utils/webVitals";
import { initCrisisHandler } from "./telemetry/crisisHandler";
import { applyUserCspProfile } from "./utils/cspReportThrottle";
import { initLicenseStore } from "./store/useLicenseStore";
import { initSwIntegrityBridge } from "./utils/swIntegrityBridge";

import i18n from "./i18n";

// Security headers are enforced via HTTP by the production nginx server.
// CSP and X-Frame-Options are set at the server level. See nginx.conf and
// Dockerfile.

// HIGH-severity fix (post-review): apply user CSP profile BEFORE React
// mount. This injects a `<meta http-equiv="Content-Security-Policy">` tag
// override that tightens (or relaxes) the runtime policy based on
// `localStorage["forge_csp_profile"]`. Resources loaded AFTER this point
// follow the new CSP. This is defense-in-depth: the static _headers
// already ship MODERATE; STRICT is opt-in via Settings → Security.
applyUserCspProfile();

// Wire the network firewall to the REAL SecureStorage.
// Without this DI, the module-level no-op defaults mean the user's
// whitelist (Settings → Network Permissions) is never persisted —
// the firewall only ever saw the preset origins. Must run before any
// firewalledFetch/WebSocket call (all external traffic goes through it)
// and before getWhitelistedOrigins() below.
// AuditLogService removed for Core export
const auditLog = {
  record: async () => {
    // Intentional silence: audit log removed for Core export
  },
};
configureNetworkFirewall({ secureStorage, auditLog });

// Setup API interceptors (auth, logging, error transformation, security)
try {
  setupApiInterceptors(() => securityVault.getSessionToken());
} catch (err) {
  logger.error("[Main] Failed to setup API interceptors", { error: err });
}

// Setup global error handler + production monitors (privacy-first, local-only).
// initCrisisHandler wires window.onerror/unhandledrejection reporting AND
// integrity/CSP/storage monitors in one entry point.
initCrisisHandler();

// Boot the Pro license store (reads cached state; re-validates in the
// background within offline grace, see src/services/LicenseService.ts).
initLicenseStore();

// HIGH-severity fix (post-review): assertValidForBuild actually called.
// In PROD, throws if any server-side/provider key is accidentally bundled into
// the client bundle. Cloud AI credentials are supplied by the user at runtime
// from the encrypted vault and calls go directly to the selected provider.
if (envBoot.isProd) {
  try {
    assertValidForBuild();
  } catch (e: unknown) {
    logger.error(
      "[Main] Production build validation failed \u2014 refusing to boot",
      { error: e instanceof Error ? e.message : String(e) },
    );
    // Render a minimal fall-through UI explaining the issue rather than a
    // blank page; in PWAs the SW may cache, so we keep this conservative.
    // MEDIUM #9 (third review pass): build the DOM with createElement +
    // textContent so that error messages cannot be interpreted as HTML
    // by the browser (defense in depth even though error messages are
    // typically plain text).
    const root = document.getElementById("root");
    if (root) {
      root.replaceChildren();
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "padding:24px;font-family:system-ui;max-width:640px;margin:40px auto;background:#0f1c2e;color:#e2e8f0;";
      const h1 = document.createElement("h1");
      h1.style.color = "#ef4444";
      h1.textContent = "BookmarkForge: build validation failed";
      const p1 = document.createElement("p");
      p1.textContent =
        "The current build exposes private keys or configuration in the browser bundle. The app refused to load.";
      const p2 = document.createElement("p");
      p2.style.opacity = "0.7";
      p2.textContent = "Please contact support@proton.me.";
      const pre = document.createElement("pre");
      pre.style.cssText =
        "font-size:11px;opacity:0.5;color:#94a3b8;margin-top:16px;white-space:pre-wrap;";
      pre.textContent = String(e instanceof Error ? e.message : e);
      wrap.append(h1, p1, p2, pre);
      root.appendChild(wrap);
    }
    throw e;
  }
}

// Validate environment variables early (warning-only outside PROD)
const envValidation = validateEnvVars();
if (envValidation.warnings.length > 0 && envBoot.isDev) {
  logger.warn("[EnvValidation] Configuration warnings", {
    warnings: envValidation.warnings,
  });
}

// Log environment info in development
if (envBoot.isDev) {
  logger.info("[Environment] Runtime configuration", getEnvironmentInfo());
}

// Initialize network firewall
if (isFirewallEnabled()) {
  getWhitelistedOrigins().then((origins) => {
    logger.info("[NetworkFirewall] Active — whitelisted origins:", origins);
  });
} else {
  logger.warn("[NetworkFirewall] DISABLED via VITE_DISABLE_NETWORK_FIREWALL");
}

// Register Service Worker EARLY (so the app shell is precached even while the
// user is still on the lock screen, before MainApp mounts).
//
// The update prompt UI lives ONLY in <ReloadPrompt /> (MainApp), which
// consumes the refresh state via useRegisterSW. This registration is kept
// purely for early precaching and the offline-ready log; onNeedRefresh is
// intentionally omitted so a single `needRefresh` event cannot produce two
// prompts (toast + banner) with two independent skipWaiting+reload paths.
registerSW({
  onOfflineReady() {
    logger.info("[SW] Application ready for offline use");
  },
});

// ADR-039: the service worker verifies every asset it serves against the
// integrity manifest embedded at build time (vite.config.ts
// integrityManifestPlugin). A mismatch never reaches the page as executable
// code (the SW answers 504); this bridge replays the notification onto the
// SAME window contract the app already reacts to — bundle-integrity-failed —
// so the AppInitializer recovery screen and telemetry/productionMonitor fire.
initSwIntegrityBridge();

// Request persistent storage to prevent browser from clearing AI models and DB
if (navigator.storage && navigator.storage.persist) {
  navigator.storage
    .persist()
    .then((persistent) => {
      if (persistent) {
        logger.info("[Storage] Persistent storage granted");
      } else {
        logger.warn(
          "[Storage] Persistent storage denied - data may be cleared under pressure",
        );
      }
    })
    .catch((err) => {
      logger.warn("[Storage] Failed to request persistent storage", {
        error: err,
      });
    });
}

window.addEventListener("unhandledrejection", (event) => {
  if (event.reason && event.reason.name === "QuotaExceededError") {
    navigator.storage
      ?.estimate()
      .then((estimate) => {
        logger.error("[Storage] Quota exceeded - user needs to free up space", {
          error: event.reason,
          quota: estimate.quota,
          usage: estimate.usage,
        });
      })
      .catch(() => {
        logger.error("[Storage] Quota exceeded", { error: event.reason });
      });
    toast.error(
      i18n.t("app_quotaExceeded", {
        defaultValue:
          "Storage quota exceeded. Please free up space to continue saving data.",
      }),
      {
        duration: 10000,
      },
    );
  }
});

// Core Web Vitals monitoring (production only to avoid dev noise)
if (!envBoot.isDev) {
  reportWebVitals((metric) => {
    if (metric.rating === "poor" || metric.rating === "needs-improvement") {
      logger.warn(
        `[WebVital] ${metric.name}: ${metric.value}${metric.unit} (${metric.rating})`,
      );
    }
  });
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element not found");
}
createRoot(rootElement).render(
  React.createElement(StrictMode, null, React.createElement(App, null)),
);
