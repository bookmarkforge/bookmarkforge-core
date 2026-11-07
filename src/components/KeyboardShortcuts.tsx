import React, { useEffect, useState } from "react";
import { X, Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";

export const KeyboardShortcuts: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  const { t } = useTranslation();

  const shortcuts = [
    { key: "Ctrl + /", description: t("app_showShortcuts", "View keyboard shortcuts") },
    { key: "Ctrl + K", description: t("app_globalSearch", "Open Omnibar / Global Search") },
    { key: "Ctrl + Shift + P", description: t("app_commandPalette", "Open Command Palette") },
    { key: "Ctrl + Shift + B", description: t("app_quickCapture", "Quick Capture bookmark") },
    { key: "Ctrl + Shift + V", description: t("app_voiceCommands", "Start voice commands") },
    { key: "Ctrl + D", description: t("app_toggleDarkMode", "Toggle Dark Mode") },
    { key: "Ctrl + ,", description: t("app_settings", "Open Settings") },
    { key: "Ctrl + 1-6", description: t("app_switchTabs", "Switch views: Dashboard, Editor, Docs, Bookmarks, Graph, Canvas") },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="ds-modal-overlay z-50 p-4">
      <div className="bg-white dark:bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto border border-[var(--divider)] dark:border-[var(--divider)]">
        <div className="flex items-center justify-between p-4 border-b border-[var(--divider)] dark:border-[var(--divider)]">
          <div className="flex items-center gap-2">
            <Keyboard className="size-5 text-[var(--text-muted)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)]">
              {t("keyboardShortcuts")}
            </h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-md hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="p-4 space-y-2">
          {shortcuts.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between py-2 border-b border-[var(--divider)] dark:border-[var(--divider)]/50 last:border-0"
            >
              <span className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)]">
                {shortcut.description}
              </span>
              <kbd className="px-2 py-1 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-md text-xs font-mono text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
