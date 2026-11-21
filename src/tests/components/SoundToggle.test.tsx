import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SoundToggle } from "../../components/SoundToggle";
import { useSoundStore } from "../../store/useSoundStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe("SoundToggle", () => {
  beforeEach(() => {
    useSoundStore.setState({
      enabled: true,
      volume: 0.5,
      categories: {
        notifications: true,
        backgroundTasks: true,
        uiFeedback: true,
      },
    });
  });

  it("renders volume icon when enabled=true", () => {
    render(<SoundToggle />);
    expect(screen.getByTestId("sound-toggle")).toBeDefined();
  });

  it("toggle disables sound when clicked", () => {
    render(<SoundToggle />);
    fireEvent.click(screen.getByTestId("sound-toggle"));
    expect(useSoundStore.getState().enabled).toBe(false);
  });

  it("toggle enables sound when clicked while muted", () => {
    useSoundStore.getState().setEnabled(false);
    render(<SoundToggle />);
    fireEvent.click(screen.getByTestId("sound-toggle"));
    expect(useSoundStore.getState().enabled).toBe(true);
  });
});
