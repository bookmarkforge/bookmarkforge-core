import React, { useEffect } from "react";
import {
  detectHostileEnvironment,
  detectDebuggerAsync,
  initTabCounting,
} from "../../utils/environmentDetection";
import { initDevToolsProtection } from "../../utils/devtoolsProtection";
import {
  verifyBuildIdentity,
  startScriptInjectionGuard,
  stopScriptInjectionGuard,
} from "../../utils/bundleIntegrity";
import { securityVault } from "../../services/SecurityVault";
// A-1 / ADR-046: the cross-tab salt listener. Imported statically on purpose —
// this module is already reachable eagerly through SecurityVault (which owns the
// announce side and is what the pre-unlock screen runs), so a dynamic import
// here would be indirection, not lazy loading.
import {
  startVaultKdfSaltSync,
  stopVaultKdfSaltSync,
} from "../../services/security-vault/kdf-salt-sync";
import { auditLog } from "../../services/AuditLogService";
import { toast } from "sonner";
import i18n from "../../i18n";
import { logger } from "../../utils/logger";
import { loadBackupService } from "../../services/pro-access";
import { useSecurityStore } from "../../hooks/useSecurityStore";
import { safeGet, safeSet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { observabilityHub } from "../../observability/ObservabilityHub";
import { logRateLimited } from "../../utils/boundedLog";

export function AppInitializer() {
  const unlock = useSecurityStore((state) => state.unlock);
  const isLocked = useSecurityStore((state) => state.isLocked);
  const isResetting = React.useMemo(() => {
    const params =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
    return params?.get("reset") === "true";
  }, []);

  useEffect(() => {
    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "true") {
      const performReset = async () => {
        try {
          const { destroyAllDatabases } = await import("./initUtils");
          await destroyAllDatabases();
        } catch (_e: unknown) {
          logger.error("[AppInitializer] Error destroying DB during reset", {
            error: _e instanceof Error ? (_e as Error).message : String(_e),
          });
        }
        if (cancelled) {return;}
        await new Promise<void>((resolve) => {
          delayTimer = setTimeout(resolve, 1500);
        });
        if (cancelled) {return;}
        const url = new URL(window.location.href);
        url.searchParams.delete("reset");
        if (params.get("demo") === "true") {url.searchParams.set("demo", "true");}
        window.location.href = url.toString();
      };
      performReset();
    }
    return () => {
      cancelled = true;
      if (delayTimer) {clearTimeout(delayTimer);}
    };
  }, []);

  useEffect(() => {
    observabilityHub.init();
    return () => observabilityHub.dispose();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let delayTimer: ReturnType<typeof setTimeout> | undefined;
    if (isResetting) {return;}
    const params = new URLSearchParams(window.location.search);
    const isDemoParam = params.get("demo") === "true";
    const isAlreadyDemo = safeGet(STORAGE_KEYS.DEMO_ACTIVE) === "true";

    if ((isDemoParam || isAlreadyDemo) && isLocked) {
      const initDemo = async () => {
        try {
          safeSet(STORAGE_KEYS.DEMO_ACTIVE, "true");
          await securityVault.setMasterPasswordFlag();
          const { initDemoDatabase } = await import("./initUtils");
          await initDemoDatabase("demo_vault_password_2026");
          if (!cancelled) {unlock();}
          if (isDemoParam && !cancelled) {
            const url = new URL(window.location.href);
            url.searchParams.delete("demo");
            window.history.replaceState({}, "", url.toString());
          }
        } catch (err: unknown) {
          logger.error("[AppInitializer] Demo mode failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
      initDemo();
    }
    return () => {
      cancelled = true;
      if (delayTimer) {clearTimeout(delayTimer);}
    };
  }, [isLocked, unlock, isResetting]);

  useEffect(() => {
    if (isResetting) {return;}
    const isDev = import.meta.env.DEV;
    // Test/CI escape hatch: VITE_TEST_BUILD silences hostile-environment
    // audit entries and the related console noise, while detection itself
    // stays fully intact. Production builds never set this flag, so PROD
    // behavior is unchanged — it exists purely so headless preview/smoke-
    // test runs don't pollute the audit log with expected automation noise.
    // Match env.config's parseBool semantics ("1"/"yes"/"on" all mean
    // true) so CI workflows that set VITE_TEST_BUILD=1 get the escape
    // hatch too, not just the literal string "true".
    const rawTestBuild = import.meta.env.VITE_TEST_BUILD;
    const isTestBuild =
      rawTestBuild === "true" ||
      rawTestBuild === "1" ||
      rawTestBuild === "yes" ||
      rawTestBuild === "on";
    const env = detectHostileEnvironment();
    // Single predicate shared by the console-error and audit-record gates
    // so the two can never drift apart.
    const shouldReportSuspiciousEnv =
      env.isSuspicious &&
      !isDev &&
      !import.meta.env.VITE_DEV_MODE &&
      !isTestBuild;
    if (shouldReportSuspiciousEnv) {
      logger.error("[Security] Hostile environment detected", {
        environment: env,
      });
    }
    // preventIframeEmbedding() removed — CSP frame-ancestors 'none'
    // already prevents framing; the JS redirect was redundant and could
    // break legitimate embeds (webview/kiosk).
    initTabCounting();
    if (import.meta.env.PROD) {
      initDevToolsProtection();
      // Deferred: deeper debugger probe (5M iterations) via
      // requestIdleCallback so it never blocks first paint.
      detectDebuggerAsync().then((detected) => {
        if (detected && !isTestBuild) {
          logger.warn("[Security] Debugger detected (async probe)");
          auditLog
            .record({
              action: "suspicious_environment_detected",
              target: "environment",
              result: "denied",
              origin: "AppInitializer",
              context: { reasons: "Debugger detected (async probe)" },
            })
            .catch((error: unknown) => {
              logRateLimited(
                "warn",
                "app-initializer-debugger-audit",
                "Failed to persist debugger-detection audit entry",
                { error: error instanceof Error ? error.message : String(error) },
              );
            });
        }
      });
    }

    // Log suspicious environment to audit log
    if (shouldReportSuspiciousEnv) {
      auditLog
        .record({
          action: "suspicious_environment_detected",
          target: "environment",
          result: "denied",
          origin: "AppInitializer",
          context: {
            reasons: env.reasons.join(", "),
            devToolsOpen: String(env.details.devToolsOpen),
            consoleTampered: String(env.details.consoleTampered),
            debuggerDetected: String(env.details.debuggerDetected),
            prototypeTampered: String(env.details.prototypeTampered),
          },
        })
        .catch((error) => {
          logger.warn("[AppInitializer] auditLog.record failed", { error });
        });
    }
  }, [isResetting]);

  useEffect(() => {
    if (isResetting) {return;}
    const migrateData = async () => {
      try {
        await securityVault.migrateFromLocalStorage();
        logger.info(
          "[Security] Successfully migrated sensitive data to IndexedDB",
        );
      } catch (error) {
        logger.error(
          "[Security] Failed to migrate sensitive data to IndexedDB",
          { error },
        );
      }
    };
    migrateData();
  }, [isResetting]);

  useEffect(() => {
    if (isResetting || isLocked || import.meta.env.DEV) {return;}
    let cancelled = false;
    let service: { start: () => void; stop: () => void } | undefined;
    import("../../services/GarbageCollectionService")
      .then(({ garbageCollectionService }) => {
        if (cancelled) {return;}
        service = garbageCollectionService;
        service.start();
        logger.info("[GarbageCollection] Service started");
      })
      .catch((error: unknown) => {
        logger.warn("[AppInitializer] Garbage collection unavailable", {
          error,
        });
      });
    return () => {
      cancelled = true;
      service?.stop();
      if (service) {
        logger.info("[GarbageCollection] Service stopped");
      }
    };
  }, [isLocked, isResetting]);

  useEffect(() => {
    if (isResetting || isLocked) {return;}
    // P93: the demo vault must never auto-seed a real user's vault. Only
    // schedule it when the user EXPLICITLY opted into demo mode (same gate
    // as the demo-unlock path above) — and the guard inside createDemoVault
    // is the second line of defense.
    const params = new URLSearchParams(window.location.search);
    const isDemoParam = params.get("demo") === "true";
    const isAlreadyDemo = safeGet(STORAGE_KEYS.DEMO_ACTIVE) === "true";
    if (!isDemoParam && !isAlreadyDemo) {return;}
    const timer = setTimeout(() => {
      import("./demoVault")
        .then(({ createDemoVault }) => createDemoVault())
        .catch((error: unknown) => {
          logger.warn("[AppInitializer] createDemoVault failed", { error });
        });
    }, 1000);
    return () => clearTimeout(timer);
  }, [isLocked, isResetting]);

  useEffect(() => {
    if (isResetting || isLocked) {return;}
    let cancelled = false;
    const syncController = new AbortController();
    const runPostUnlock = async () => {
      try {
        // BackupService is Pro: resolved behind the hasProAccess gate. A
        // Free user skips the auto-backup attempt entirely (no chunk fetch).
        const backup = await loadBackupService();
        if (cancelled) {return;}
        await backup.runAutoBackup();
        if (cancelled) {return;}
        logger.info("[AppInitializer] Auto-backup completed on unlock");
      } catch (err) {
        if (!cancelled) {
          logger.warn("[AppInitializer] Auto-backup failed silently", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (cancelled) {return;}
      try {
        const { crossPollinationService } =
          await import("../../services/ai/CrossPollinationService");
        if (cancelled) {return;}
        const digest = await crossPollinationService.tryRunDigest(
          i18n.language,
          syncController.signal,
        );
        if (!cancelled && digest) {
          logger.info("[AppInitializer] Weekly digest generated", {
            title: digest.title,
          });
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn("[AppInitializer] Weekly digest auto-generation failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (cancelled) {return;}
      try {
        const hasCloudConfig =
          await securityVault.hasSecret("cloud_sync_config");
        if (cancelled || !hasCloudConfig) {return;}
        const configEncrypted =
          await securityVault.decryptSecret("cloud_sync_config");
        if (cancelled) {return;}
        const config = JSON.parse(configEncrypted);
        const { cloudSyncService, registerLocalBackupProvider } =
          await import("../../services/integrations/cloudSync");
        if (cancelled) {return;}
        registerLocalBackupProvider(cloudSyncService);
        await cloudSyncService.init(config);
        if (cancelled) {return;}
        logger.info("[AppInitializer] Cloud sync initialized");
        if (safeGet(STORAGE_KEYS.AUTO_SYNC_CLOUD) === "true") {
          cloudSyncService
            .sync({ signal: syncController.signal })
            .then((result) => {
              if (!cancelled && !result.success) {
                logger.warn("[AppInitializer] Auto cloud sync failed", {
                  error: result.errors?.join(", ") || "Unknown sync error",
                });
              }
            })
            .catch((syncErr: unknown) => {
              if (!cancelled) {
                logger.warn("[AppInitializer] Auto cloud sync failed", {
                  error:
                    syncErr instanceof Error ? syncErr.message : String(syncErr),
                });
              }
            });
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn("[AppInitializer] Cloud sync init failed silently", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    const timer = setTimeout(() => {
      if (!cancelled) {
        void runPostUnlock();
      }
    }, 2000);
    return () => {
      cancelled = true;
      syncController.abort();
      clearTimeout(timer);
    };
  }, [isLocked, isResetting]);

  useEffect(() => {
    if (isResetting || isLocked) {return;}
    let cancelled = false;
    let service: { start: () => void; stop: () => void } | undefined;
    import("../../services/BroadcastBridgeService")
      .then(({ broadcastBridgeService }) => {
        if (cancelled) {return;}
        service = broadcastBridgeService;
        service.start();
      })
      .catch((error: unknown) => {
        logger.warn("[AppInitializer] Broadcast bridge unavailable", {
          error,
        });
      });
    return () => {
      cancelled = true;
      service?.stop();
    };
  }, [isLocked, isResetting]);

  useEffect(() => {
    // A-1 / ADR-046: while this tab is unlocked, follow the vault's KDF salt so
    // a rotation performed in a sibling tab reaches this tab's crypto layer
    // instead of leaving it writing under the salt the vault just retired.
    // Unlocked-only by design: reading the stored salt needs the device key,
    // and a locked tab has nothing to write with — its next unlock provisions
    // the current salt anyway. Both calls are idempotent, so StrictMode's
    // mount/unmount/mount cycle is harmless.
    if (isResetting || isLocked) {return;}
    startVaultKdfSaltSync(async (result) => {
      // A sibling rotation changes both the password and the salt. Adopting
      // only the salt would leave this tab able to write ciphertext that the
      // new password cannot decrypt. Fail closed and require an explicit
      // unlock with the current password instead.
      if (result.status === "adopted" && !securityVault.isLocked()) {
        await securityVault.lock();
        // SECURITY: the crypto lock alone leaves the React shell rendered
        // behind a dead vault (useSecurityStore has no lock listener) — the
        // user sees a fully interactive UI whose every write throws. Drive
        // the UI lock transition explicitly so the unlock screen returns.
        useSecurityStore.getState().lock();
        toast.info(
          i18n.t(
            "securityVaultChangedInAnotherTab",
          "The vault changed in another tab. Unlock again to continue.",
          ),
          { id: "vault-changed-in-another-tab" },
        );
      }
    });
    return () => stopVaultKdfSaltSync();
  }, [isLocked, isResetting]);

  // Startup AI hint: when the user is offline or has no AI provider
  // configured, run the real SupportDiagnostics probes and recommend the
  // Help Center. Delayed well past the auto-backup/digest work (2s) so its
  // toast never piles up with other startup notifications.
  useEffect(() => {
    if (isResetting || isLocked) {return;}
    const timer = setTimeout(() => {
      import("../../services/StartupAIHint")
        .then(({ maybeShowStartupAIHint }) => maybeShowStartupAIHint())
        .catch((error: unknown) => {
          logger.warn("[AppInitializer] Startup AI hint unavailable", {
            error,
          });
        });
    }, 4500);
    return () => clearTimeout(timer);
  }, [isLocked, isResetting]);

  // Audit Log + Bundle Integrity
  useEffect(() => {
    if (isResetting) {return;}

    // Defer build identity check to avoid race with Toaster mount
    if (import.meta.env.PROD) {
      // Start the runtime script-injection guard: monitors <head> for
      // unexpected <script> elements injected after boot.
      startScriptInjectionGuard();

      const timer = setTimeout(() => {
        const identityOk = verifyBuildIdentity();
        if (!identityOk) {
          logger.error("[AppInitializer] Build identity verification failed");
          toast.error(
            i18n.t(
              "app_bundleIntegrityFailedGeneric",
              "Security Alert: Application integrity check failed. Please reload.",
            ),
            { duration: Infinity, id: "build-identity-failed" },
          );
          auditLog
            .record({
              action: "bundle_integrity_failed",
              target: "build_identity",
              result: "failure",
              origin: "AppInitializer",
              context: { reason: "Build hash mismatch" },
            })
            .catch((error) => {
              logger.warn("[AppInitializer] auditLog.record failed", { error });
            });
        }
      }, 500);
      return () => {
        clearTimeout(timer);
        stopScriptInjectionGuard();
      };
    }

    // Listen for bundle integrity failures (from async checkBundleIntegrity)
    const handleIntegrityFailure = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        mismatchedFiles: string[];
        checkedAt: string;
      };

      const fileCount = detail.mismatchedFiles?.length || 0;
      const message =
        fileCount > 0
          ? i18n.t(
              "app_bundleIntegrityFailed",
              `Security Alert: ${fileCount} file(s) may have been tampered with. Please reload the app.`,
            )
          : i18n.t(
              "app_bundleIntegrityFailedGeneric",
              "Security Alert: Application integrity check failed. Please reload.",
            );

      logger.error("[AppInitializer] Bundle integrity failure", {
        mismatchedFiles: detail.mismatchedFiles,
        checkedAt: detail.checkedAt,
      });

      // Show toast alert (sonner queues even before Toaster mounts)
      toast.error(message, {
        duration: Infinity, // Never auto-dismiss for security alerts
        id: "bundle-integrity-failed",
      });

      // Also log to audit
      auditLog
        .record({
          action: "bundle_integrity_failed",
          target: "bundle",
          result: "failure",
          origin: "AppInitializer",
          context: {
            fileCount: String(fileCount),
            checkedAt: detail.checkedAt,
          },
        })
        .catch((error) => {
          logger.warn("[AppInitializer] auditLog.record failed", { error });
        });
    };

    window.addEventListener("bundle-integrity-failed", handleIntegrityFailure);

    return () => {
      window.removeEventListener(
        "bundle-integrity-failed",
        handleIntegrityFailure,
      );
    };
  }, [isResetting]);

  return isResetting ? (
    <div className="fixed inset-0 z-[9999] bg-[var(--bg-primary)] flex flex-col items-center justify-center text-white font-sans">
      <div className="size-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <h2 className="text-xl font-semibold mb-2">
        {i18n.t("app_resetting", "Resetting...")}
      </h2>
    </div>
  ) : null;
}
