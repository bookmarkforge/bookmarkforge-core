import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

const { KeyboardShortcuts } =
  await import("../../components/KeyboardShortcuts");

describe("KeyboardShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not render initially", () => {
    const { container } = render(<KeyboardShortcuts />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("opens with Ctrl+/", async () => {
    render(<KeyboardShortcuts />);
    await userEvent.keyboard(`{Control>}/{/Control}`);
    expect(document.querySelector("h2")).toBeTruthy();
  });

  it("closes with second Ctrl+/", async () => {
    render(<KeyboardShortcuts />);
    await userEvent.keyboard(`{Control>}/{/Control}`);
    await userEvent.keyboard(`{Control>}/{/Control}`);
    expect(document.querySelector("h2")).toBeFalsy();
  });

  it("closes with the X button", async () => {
    render(<KeyboardShortcuts />);
    await userEvent.keyboard(`{Control>}/{/Control}`);
    const closeBtn = document.querySelector("button");
    await userEvent.click(closeBtn!);
    expect(document.querySelector("h2")).toBeFalsy();
  });

  it("shows the shortcuts list", async () => {
    render(<KeyboardShortcuts />);
    await userEvent.keyboard(`{Control>}/{/Control}`);
    expect(document.querySelector("kbd")).toBeTruthy();
    // Real shortcut entries rendered to the user.
    const kbdEntries = Array.from(document.querySelectorAll("kbd")).map(
      (el) => el.textContent,
    );
    expect(kbdEntries).toContain("Ctrl + K");
    expect(kbdEntries).toContain("Ctrl + Shift + P");
  });

  it("renders the panel title when opened", async () => {
    render(<KeyboardShortcuts />);
    expect(document.querySelector("h2")).toBeFalsy();
    await userEvent.keyboard(`{Control>}/{/Control}`);
    expect(document.querySelector("h2")?.textContent).toBe(
      "keyboardShortcuts",
    );
  });
});
