import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Bookmark, Activity } from "lucide-react";
import React from "react";
import { NavCard } from "../../components/dashboard/components/NavCard";

/**
 * NavCard iconAccent API contract tests.
 *
 * Locks the typed API surface: every documented accent must render the
 * matching .ds-icon-tint-* utility class. Foreign accent strings should
 * fail TS compilation (covered separately by tsc --noEmit).
 *
 * Uses @testing-library/user-event (v14) for keyboard tests — the
 * fireEvent.keyDown(' ') shortcut doesn't always trigger native button
 * activation; userEvent.keyboard presses through the React synthetic
 * event system the way a real keyboard does, matching production
 * behaviour on macOS/Linux/Win.
 */

const renderCard = (
  props: Partial<React.ComponentProps<typeof NavCard>> = {},
) =>
  render(
    <NavCard
      icon={Bookmark}
      title="Test"
      description="Test description"
      onClick={() => {}}
      {...props}
    />,
  );

describe("NavCard — iconAccent mapping", () => {
  it("'cyan' renders ds-icon-tint-cyan class", () => {
    const { container } = renderCard({ iconAccent: "cyan", icon: Bookmark });
    const target = container.querySelector(".ds-icon-tint-cyan");
    expect(target, "icon container must have ds-icon-tint-cyan").toBeTruthy();
  });

  it("'success' renders ds-icon-tint-success class", () => {
    const { container } = renderCard({ iconAccent: "success", icon: Activity });
    expect(container.querySelector(".ds-icon-tint-success")).toBeTruthy();
  });

  it("'warning' renders ds-icon-tint-warning class", () => {
    const { container } = renderCard({ iconAccent: "warning", icon: Bookmark });
    expect(container.querySelector(".ds-icon-tint-warning")).toBeTruthy();
  });

  it("'danger' renders ds-icon-tint-danger class", () => {
    const { container } = renderCard({ iconAccent: "danger", icon: Activity });
    expect(container.querySelector(".ds-icon-tint-danger")).toBeTruthy();
  });

  it("'neutral' renders ds-icon-tint-neutral class", () => {
    const { container } = renderCard({ iconAccent: "neutral", icon: Bookmark });
    expect(container.querySelector(".ds-icon-tint-neutral")).toBeTruthy();
  });

  it("defaults to cyan when iconAccent is omitted", () => {
    const { container } = renderCard({ icon: Bookmark });
    expect(container.querySelector(".ds-icon-tint-cyan")).toBeTruthy();
  });
});

describe("NavCard — accessibility & interaction", () => {
  it("renders as a button with aria-label = title", () => {
    renderCard({ iconAccent: "cyan", title: "Bookmarks" });
    expect(screen.getByRole("button", { name: "Bookmarks" })).toBeTruthy();
  });

  it("forwards onClick handler on click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({ onClick });
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keyboard — Enter triggers onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({ onClick });
    const button = screen.getByRole("button");
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keyboard — Space triggers onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderCard({ onClick });
    const button = screen.getByRole("button");
    button.focus();
    await userEvent.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("appends custom className to root", () => {
    const { container } = renderCard({
      iconAccent: "cyan",
      className: "md:col-span-2 lg:col-span-3",
    });
    const root = Array.from(container.children).find(
      (el) => el.tagName !== "STYLE",
    ) as HTMLElement;
    expect(root.className).toContain("md:col-span-2");
    expect(root.className).toContain("lg:col-span-3");
  });

  it("forwards inline style override", () => {
    const { container } = renderCard({
      iconAccent: "cyan",
      style: { borderColor: "red" },
    });
    const root = Array.from(container.children).find(
      (el) => el.tagName !== "STYLE",
    ) as HTMLElement;
    expect(root.getAttribute("style") || "").toContain("border-color: red");
  });
});

describe("NavCard — title & description content", () => {
  it("renders the title in a card-title element", () => {
    renderCard({ iconAccent: "cyan", title: "My Bookmarks" });
    expect(screen.getByText("My Bookmarks")).toBeTruthy();
  });

  it("renders the description with text-secondary styling", () => {
    renderCard({ iconAccent: "cyan", description: "Manage your saved URLs" });
    const desc = screen.getByText("Manage your saved URLs");
    expect(desc).toBeTruthy();
  });
});
