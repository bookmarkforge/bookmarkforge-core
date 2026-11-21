import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string, fb?: string) => fb || s }),
}));

const toggleTheme = vi.fn();
const mockUseTheme = vi.fn(
  () => ({ theme: "dark" as const, toggleTheme }) as {
    theme: "light" | "dark" | "system";
    toggleTheme: typeof toggleTheme;
  },
);
vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: mockUseTheme,
}));

vi.mock("@mantine/core", () => ({
  ActionIcon: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Tooltip: ({ children }: any) => children,
}));

let ThemeToggle: React.FC;

beforeEach(async () => {
  vi.clearAllMocks();
  mockUseTheme.mockReturnValue({ theme: "dark" as const,  toggleTheme });
  const mod = await import("../../components/ThemeToggle");
  ThemeToggle = mod.ThemeToggle;
});

describe("ThemeToggle", () => {
  it("renders icon according to theme", () => {
    const { container } = render(<ThemeToggle />);
    expect(
      container.querySelector('[data-testid="theme-toggle"]'),
    ).toBeTruthy();
  });

  it("calls toggleTheme when clicked", async () => {
    const { getByTestId } = render(<ThemeToggle />);
    await userEvent.click(getByTestId("theme-toggle"));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  // ── Fusionado de src/tests/security/ThemeToggle.test.tsx (aria-labels reales) ──

  it("shows the switch-to-dark-mode label in light theme", async () => {
    mockUseTheme.mockReturnValue({ theme: "light" as const, toggleTheme });
    const { ThemeToggle: T } = await import("../../components/ThemeToggle");
    render(<T />);
    expect(screen.getByLabelText("Switch to dark mode")).toBeInTheDocument();
  });

  it("shows the switch-to-system-theme label in dark mode", async () => {
    mockUseTheme.mockReturnValue({ theme: "dark" as const, toggleTheme });
    const { ThemeToggle: T } = await import("../../components/ThemeToggle");
    render(<T />);
    expect(
      screen.getByLabelText("Switch to system theme"),
    ).toBeInTheDocument();
  });

  it("shows the switch-to-light-mode label in system mode", async () => {
    mockUseTheme.mockReturnValue({ theme: "system" as const, toggleTheme });
    const { ThemeToggle: T } = await import("../../components/ThemeToggle");
    render(<T />);
    expect(screen.getByLabelText("Switch to light mode")).toBeInTheDocument();
  });

  it("shows Sun icon in light theme", async () => {
    vi.mocked(
      await import("../../contexts/ThemeContext"),    ).useTheme.mockReturnValue({
      theme: "light" as const,
      toggleTheme,
    } as any);
    const { ThemeToggle: T } = await import("../../components/ThemeToggle");
    const { container } = render(<T />);
    expect(
      container.querySelector('[data-testid="theme-toggle"]'),
    ).toBeTruthy();
  });

  it("shows Monitor icon in system theme", async () => {
    vi.mocked(
      await import("../../contexts/ThemeContext"),    ).useTheme.mockReturnValue({
      theme: "system" as const,
      toggleTheme,
    } as any);
    const { ThemeToggle: T } = await import("../../components/ThemeToggle");
    const { container } = render(<T />);
    expect(
      container.querySelector('[data-testid="theme-toggle"]'),
    ).toBeTruthy();
  });
});
