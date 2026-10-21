import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";

import { usePreferencesStore } from "../store/usePreferencesStore";
import { analyticsService } from "../services/AnalyticsService";

export type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setThemeMode: (mode: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const storeTheme = usePreferencesStore((s) => s.theme);
  const setStoreTheme = usePreferencesStore((s) => s.setTheme);
  const [theme, setTheme] = useState<Theme>(storeTheme);

  useEffect(() => {
    setTheme(storeTheme);
  }, [storeTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    let actualTheme = theme;
    if (theme === "system") {
      actualTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    root.setAttribute("data-theme", actualTheme);

    if (actualTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.add("light");
    }
  }, [theme]);

  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        const root = document.documentElement;
        const systemTheme = mediaQuery.matches ? "dark" : "light";

        // Update data-theme attribute for Cruip Gray theme
        root.setAttribute("data-theme", systemTheme);

        // Update class for compatibility
        root.classList.remove("dark", "light");
        if (systemTheme === "dark") {
          root.classList.add("dark");
        } else {
          root.classList.add("light");
        }
      };
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    return undefined;
  }, [theme]);

  const toggleTheme = () => {
    const next =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    analyticsService.track("theme_changed", { theme: next, mode: "toggle" });
    setTheme(next);
    setStoreTheme(next);
  };

  const setThemeMode = (newTheme: Theme) => {
    analyticsService.track("theme_changed", { theme: newTheme, mode: "select" });
    setTheme(newTheme);
    setStoreTheme(newTheme);
  };

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
