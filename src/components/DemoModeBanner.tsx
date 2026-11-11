import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical, Loader2 } from "lucide-react";
import { safeGet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { destroyAllDatabases } from "./app-initializer/initUtils";
import { logger } from "../utils/logger";

/**
 * Persistent "you are in demo mode" strip, shown for the whole session while
 * `forge_demo_active` is set. The demo vault IS the app's only vault, so
 * without this strip a visitor who arrived via `?demo=true` would be trapped:
 * every cold start re-unlocks the sample data and there is no way back to
 * creating a real vault.
 *
 * "Create your vault" wipes the demo database (and every local flag, via
 * safeClear inside destroyAllDatabases) and reloads onto the lock screen,
 * where the normal create-vault flow runs. The confirm copy says the demo
 * data is erased — it always is, that is the point of the exit.
 */
export const DemoModeBanner: React.FC = () => {
  const { t } = useTranslation();
  const [exiting, setExiting] = useState(false);
  // Read once at mount: the flag only flips on boot (?demo=) or on this exit.
  const [isDemo] = useState(
    () => safeGet(STORAGE_KEYS.DEMO_ACTIVE) === "true",
  );

  if (!isDemo) {return null;}

  const handleCreateVault = async () => {
    if (
      !window.confirm(
        t(
          "app_demoModeConfirm",
          "This erases the demo vault and everything in it, then starts fresh so you can create your own. Continue?",
        ),
      )
    ) {
      return;
    }
    setExiting(true);
    try {
      await destroyAllDatabases("reset");
    } catch (error) {
      // Even on failure the reload lands on the lock screen; a half-wiped
      // demo vault is still demo data, never user data.
      logger.warn("[DemoModeBanner] demo teardown failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    window.location.href = "/app";
  };

  return (
    <div
      role="status"
      className="flex w-full items-center justify-center gap-3 px-4 py-1.5 text-xs font-medium bg-amber-500/95 text-black border-b border-amber-600"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">
        {t(
          "app_demoModeText",
          "You're exploring demo data — nothing here is yours yet.",
        )}
      </span>
      <button
        type="button"
        onClick={() => void handleCreateVault()}
        disabled={exiting}
        className="shrink-0 truncate inline-flex items-center gap-1.5 rounded-md ds-bg-black px-2.5 py-1 text-[11px] font-bold text-white transition-colors disabled:opacity-60"
      >
        {exiting ? (
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        ) : null}
        {t("app_demoModeCta", "Create your vault")}
      </button>
    </div>
  );
};
