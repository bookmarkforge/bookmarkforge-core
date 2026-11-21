import { useEffect, useRef } from "react";
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
  // Store callbacks in refs to avoid re-registering the keydown listener
  // when the caller passes new function references (inline arrows).
  const setShowOmnibarRef = useRef(setShowOmnibar);
  setShowOmnibarRef.current = setShowOmnibar;
  const toggleThemeRef = useRef(toggleTheme);
  toggleThemeRef.current = toggleTheme;
  const setShowSettingsRef = useRef(setShowSettings);
  setShowSettingsRef.current = setShowSettings;
  const setActiveTabRef = useRef(setActiveTab);
  setActiveTabRef.current = setActiveTab;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore auto-repeat so holding a key doesn't toggle repeatedly.
      if (e.repeat) {return;}
      // Omnibar shortcuts stay global (standard Cmd/Ctrl+K behavior), but
      // the remaining shortcuts must not hijack keys while the user types.
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowOmnibarRef.current((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "p" && e.shiftKey) {
        e.preventDefault();
        setShowOmnibarRef.current((prev) => !prev);
      }
      if (isEditableTarget(e.target)) {return;}
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        toggleThemeRef.current();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettingsRef.current((prev) => !prev);
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
        if (tab) {setActiveTabRef.current(tab);}
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
};
