import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

import { TokenCatalog } from "../../components/dev/TokenCatalog";

describe("TokenCatalog", () => {
  it("renders the catalog header and section titles", () => {
    render(<TokenCatalog />);
    expect(
      screen.getByText("Design System · Token Catalog"),
    ).toBeInTheDocument();
    expect(screen.getByText("Semantic-state palette")).toBeInTheDocument();
    expect(screen.getByText("Accent / brand · cyan")).toBeInTheDocument();
    expect(screen.getByText("Typography utilities")).toBeInTheDocument();
    expect(screen.getByText("Buttons")).toBeInTheDocument();
  });

  it("renders interactive elements", () => {
    render(<TokenCatalog />);
    expect(screen.getByRole("button", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Outline" })).toBeInTheDocument();
  });

  it("renders badges", () => {
    render(<TokenCatalog />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Danger")).toBeInTheDocument();
  });
});
