import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { ThemeProvider, useTheme } from "../../contexts/ThemeContext";
import { usePreferencesStore } from "../../store/usePreferencesStore";

function TestConsumer() {
  const { theme, isDark, toggleTheme, setThemeMode } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="isDark">{String(isDark)}</span>
      <button data-testid="toggle" onClick={toggleTheme}>
        Toggle
      </button>
      <button data-testid="setLight" onClick={() => setThemeMode("light")}>
        Light
      </button>
      <button data-testid="setDark" onClick={() => setThemeMode("dark")}>
        Dark
      </button>
    </div>
  );
}

function TestOutsideProvider() {
  return <div data-testid="outside">{useTheme().theme}</div>;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset Zustand store to default state — ThemeProvider reads from
    // usePreferencesStore, NOT from localStorage directly.
    usePreferencesStore.setState({
      theme: "light",
    });
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("data-theme");
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders children correctly", () => {
    render(
      <ThemeProvider>
        <div data-testid="child">Hello</div>
      </ThemeProvider>,
    );
    expect(screen.getByTestId("child")).toBeDefined();
    expect(screen.getByText("Hello")).toBeDefined();
  });

  it('uses the default "light" theme when there is no saved or system preference', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(screen.getByTestId("isDark").textContent).toBe("false");
  });

  it("reads the saved theme from the preferences store", () => {
    // ThemeProvider reads from usePreferencesStore (Zustand), not localStorage
    usePreferencesStore.setState({ theme: "dark" });
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("isDark").textContent).toBe("true");
  });

  it("uses the system preference if the theme is system and the system is dark", () => {
    // Set store to "system" so ThemeProvider defers to matchMedia.
    // Note: theme stays "system" in the store; isDark resolves via matchMedia.
    usePreferencesStore.setState({ theme: "system" });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    // theme stays "system" in the store, but isDark resolves via matchMedia
    expect(screen.getByTestId("isDark").textContent).toBe("true");
  });

  it("toggleTheme switches from light to dark", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("light");
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("isDark").textContent).toBe("true");
  });

  it("toggleTheme switches from dark to system", () => {
    usePreferencesStore.setState({ theme: "dark" });
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("system");
  });

  it("toggleTheme switches from system to light", () => {
    usePreferencesStore.setState({ theme: "system" });
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("toggle").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("setThemeMode switches to a specific theme", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("setDark").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    act(() => {
      screen.getByTestId("setLight").click();
    });
    expect(screen.getByTestId("theme").textContent).toBe("light");
  });

  it("persists the theme in the store and localStorage when changing", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    act(() => {
      screen.getByTestId("setDark").click();
    });
    // setThemeMode calls setStoreTheme → Zustand persist → localStorage
    expect(usePreferencesStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("bookmarkforge-theme")).toBe("dark");
    act(() => {
      screen.getByTestId("setLight").click();
    });
    expect(usePreferencesStore.getState().theme).toBe("light");
    expect(localStorage.getItem("bookmarkforge-theme")).toBe("light");
  });

  it("updates the data-theme attribute on <html>", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    act(() => {
      screen.getByTestId("setDark").click();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("updates the dark class on <html> when the theme is dark", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    act(() => {
      screen.getByTestId("setDark").click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    act(() => {
      screen.getByTestId("setLight").click();
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("useTheme", () => {
  it("throws if used outside ThemeProvider", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestOutsideProvider />)).toThrow(
      "useTheme must be used within a ThemeProvider",
    );
    consoleSpy.mockRestore();
  });

  it("returns the context inside ThemeProvider", () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toBeDefined();
    expect(screen.getByTestId("toggle")).toBeDefined();
  });
});
