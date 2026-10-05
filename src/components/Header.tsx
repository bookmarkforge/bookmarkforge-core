import React, { useCallback } from "react";
import {
  Search,
  Settings as SettingsIcon,
  Lock,
  Download,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSecurityStore } from "../hooks/useSecurityStore";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { toast } from "sonner";
import { SoundToggle } from "./SoundToggle";
import { Modal, Tooltip } from "@mantine/core";

interface HeaderProps {
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  isDark: boolean;
  theme: "light" | "dark" | "system";
  toggleTheme: () => void;
  setThemeMode: (mode: "light" | "dark" | "system") => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  aiStatus: {
    provider: string;
    model: string;
    isLocal: boolean;
    isConfigured: boolean;
  };
}

const Header = function Header({
  isDark: _isDark,
  theme: _theme,
  toggleTheme: _toggleTheme,
  setThemeMode: _setThemeMode,
  onOpenSettings,
  onOpenSearch,
  aiStatus,
}: HeaderProps) {
  const { t } = useTranslation();
  const { setForceSetup } = useSecurityStore();
  const { isInstallable, installPWA } = usePWAInstall();
  const [showLockConfirm, setShowLockConfirm] = React.useState(false);

  const handleLockVault = useCallback(() => {
    setShowLockConfirm(true);
  }, []);

  const confirmLockVault = useCallback(() => {
    // Clear the UI/session state immediately; the vault then flushes its lock
    // audit before dropping the device key asynchronously.
    setShowLockConfirm(false);
    setForceSetup(true);
    toast.info(t("app_vaultLocked"));
  }, [setForceSetup, t]);

  return (
    <header className="sticky top-0 z-30 ds-bg-topbar ds-border-b">
      <div className="flex items-center justify-between px-4 md:px-6 py-2.5 gap-4">
        {/* Right Actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* AI Status Badge */}
          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 ds-radius-toggle ds-bg-hover ds-border-inactive">
            <div
              className="size-1.5 rounded-full"
              style={{
                background: aiStatus.isConfigured
                  ? aiStatus.isLocal
                    ? "var(--color-success)"
                    : "var(--accent-primary)"
                  : "var(--text-muted)",
              }}
            />
            <span className="text-[9px] font-semibold uppercase tracking-wider ds-text-secondary">
              {aiStatus.isConfigured
                ? aiStatus.model
                : t("app_disconnected", "Offline")}
            </span>
          </div>

          {/* Search Button */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="p-2 ds-ghost-btn-icon ds-radius-item"
            title={t("app_search")}
            aria-label={t("app_search")}
            data-tour-id="tour-search"
          >
            <Search className="size-4" />
          </button>

          {/* Install Button */}
          {isInstallable && (
            <button
              onClick={installPWA}
              className="p-2 ds-ghost-bg ds-radius-item ds-text-accent"
              title={t("app_installApp", { defaultValue: "Install App" })}
              aria-label={t("app_installApp", { defaultValue: "Install App" })}
              data-testid="pwa-install-button"
            >
              <Download className="size-4" />
            </button>
          )}

          {/* Sound Toggle */}
          <SoundToggle />

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Language Selector */}
          <LanguageSelector />

          {/* Settings Button */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2 ds-ghost-btn-icon"
            data-testid="settings-button"
            data-tour-id="tour-settings"
            aria-label={t("app_settings", "Settings")}
          >
            <SettingsIcon className="size-4" />
          </button>

          {/* Divider */}
          <div
            className="hidden sm:block w-px h-4 mx-0.5 ds-bg-divider"
            aria-hidden="true"
          />

          {/* Lock Vault Button — uses Mantine <Tooltip> for screen-reader
              accessible label, instead of a hand-rolled hover tooltip that
              is invisible to assistive tech. The native <button> already
              fires onClick on Enter and Space, so no onKeyDown handler is
              required (binding both risks double-fire). */}
          <Tooltip
            label={t("app_vaultLockedDesc")}
            position="bottom"
            withArrow
            classNames={{ tooltip: "max-w-xs line-clamp-3" }}
          >
            <button
              type="button"
              onClick={handleLockVault}
              className="flex items-center gap-1.5 p-2 bg-transparent border-none cursor-pointer ds-ghost-btn-icon ds-radius-item"
              aria-label={t("app_lockVault")}
            >
              <Lock className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>
      <Modal
        opened={showLockConfirm}
        onClose={() => setShowLockConfirm(false)}
        title={t("app_confirm", "Confirm")}
        centered
      >
        <p className="text-sm ds-text-secondary mb-5">
          {t("app_confirmLockVault")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="truncate px-3 py-2 text-sm ds-ghost-btn ds-radius-button"
            onClick={() => setShowLockConfirm(false)}
          >
            {t("app_cancel", "Cancel")}
          </button>
          <button
            type="button"
            className="truncate px-3 py-2 text-sm ds-radius-button bg-[var(--accent-primary)] text-[var(--text-on-accent)]"
            onClick={confirmLockVault}
          >
            {t("app_confirm", "Confirm")}
          </button>
        </div>
      </Modal>
    </header>
  );
};

export { Header };
export default Header;
