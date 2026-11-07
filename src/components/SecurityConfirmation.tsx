/// <reference types="vite/client" />

import React from "react";
import { useTranslation } from "react-i18next";
import {
  IconShield,
  IconKey,
  IconSkipForward,
} from "./icons/InlineSecurityIcons";
import { LanguageSelector } from "./LanguageSelector";

interface SecurityConfirmationProps {
  onConfirm: () => void;
  onSetupPassword: () => void;
}

export const SecurityConfirmation: React.FC<SecurityConfirmationProps> = ({
  onConfirm,
  onSetupPassword,
}) => {
  const { t } = useTranslation();

  return (
    <main className="fixed inset-0 z-[100] flex items-center justify-center ds-bg-primary">
      <div
        className="w-full max-w-md p-8 shadow-2xl ds-radius-card ds-bg-card ds-border relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="security-confirmation-title"
        aria-describedby="security-confirmation-description"
        aria-label={t("app_security_title") || "Secure your vault"}
      >
        {/* Language selector — top-right corner */}
        <div className="absolute top-3 end-3">
          <LanguageSelector />
        </div>

        <div className="flex flex-col items-center text-center mb-8">
          <div
            className="size-16 flex items-center justify-center mb-4 ds-radius-widget"
            style={{
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-glow)",
            }}
          >
            <IconShield className="size-8 ds-text-accent" />
          </div>
          <h1
            id="security-confirmation-title"
            className="text-2xl font-semibold mb-2 ds-text-primary line-clamp-2"
          >
            {t("app_security_title") || "Secure your vault"}
          </h1>
          <p id="security-confirmation-description" className="text-sm ds-text-secondary">
            {t("app_security_desc") ||
              "Protect your bookmarks and documents with a master password."}
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={onSetupPassword}
            aria-label={t("app_setup_password") || "Set up password"}
            className="truncate w-full py-4 btn-primary ds-shadow-accent font-semibold transition-all flex items-center justify-center gap-2 ds-radius-card"
          >
            <IconKey className="size-5" />
            {t("app_setup_password") || "Set up password"}
          </button>

          <button
            onClick={onConfirm}
            aria-label={t("app_skip_password") || "Skip password"}
            className="truncate w-full py-3 min-h-11 text-sm font-medium transition-all flex items-center justify-center gap-2 ds-radius-card ds-bg-card ds-border ds-text-secondary hover:ds-bg-secondary"
          >
            <IconSkipForward className="size-5" />
            {t("app_skip_password") || "Skip password"}
          </button>
        </div>

        <div className="mt-8 pt-6 text-center ds-divider-t">
          <p className="text-xs leading-relaxed ds-text-muted">
            {t("app_vault_security_note")}
          </p>
        </div>
      </div>
    </main>
  );
};
