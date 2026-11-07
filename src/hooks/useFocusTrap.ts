import { useEffect, useRef } from "react";

/**
 * useFocusTrap - Traps keyboard focus within a modal/dialog.
 * Essential for a11y to prevent users from tabbing behind the overlay.
 */
export function useFocusTrap(isActive: boolean, restoreFocus = true) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) {return;}

    const container = containerRef.current;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "textarea:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
      '[contenteditable="true"]',
    ].join(", ");

    const getFocusableElements = () => {
      return Array.from(
        container.querySelectorAll(focusableSelector),
      ) as HTMLElement[];
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") {return;}

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {return;}

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement!.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement!.focus();
        }
      }
    };

    // Focus the first element when the trap activates, remembering the
    // previously focused element to restore focus on deactivation.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const firstElement = getFocusableElements()[0];
    if (firstElement) {
      firstElement.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (
        restoreFocus &&
        previouslyFocused &&
        document.contains(previouslyFocused)
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isActive, restoreFocus]);

  return containerRef;
}
