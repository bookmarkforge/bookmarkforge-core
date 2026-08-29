import { useEffect } from "react";
import { TabType } from "./useTabManager";

/**
 * Returns true when the keyboard event originated from an editable element
 * (input, textarea, contenteditable). Global shortcuts that would hijack
 * text-editing keys must be suppressed in that case.
 */
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {return false;}
  if (target.isContentEditable) {return true;}
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
};

export const useKeyboardShortcuts = (
  setShowOmnibar: React.Dispatch<React.SetStateAction<boolean>>,
  toggleTheme: () => void,
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>,
  setActiveTab: (tab: TabType) => void,
) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding a key doesn't toggle repeatedly.
      if (e.repeat) {return;}
      // Omnibar shortcuts stay global (standard Cmd/Ctrl+K behavior), but
      // the remaining shortcuts must not hijack keys while the user types.
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowOmnibar((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && e.shiftKey) {
        e.preventDefault();
        setShowOmnibar((prev) => !prev);
      }
      if (isEditableTarget(e.target)) {return;}
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        toggleTheme();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings((prev) => !prev);
      }
      // Tab switching shortcuts
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "6") {
        e.preventDefault();
        const tabs: TabType[] = [
          "dashboard",
          "editor",
          "documents",
          "bookmarks",
          "graph",
          "canvas",
        ];
        const tab = tabs[parseInt(e.key) - 1];
        if (tab) {setActiveTab(tab);}
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setShowOmnibar, toggleTheme, setShowSettings, setActiveTab]);
};
