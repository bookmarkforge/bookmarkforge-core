import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("@mantine/core", () => ({
  MantineProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mantine-provider">{children}</div>
  ),
  createTheme: vi.fn(() => ({})),
}));

import MantineThemeProvider from "../../components/MantineThemeProvider";

describe("MantineThemeProvider", () => {
  it("renders the children inside MantineProvider", () => {
    render(
      <MantineThemeProvider>
        <span>Hello World</span>
      </MantineThemeProvider>,
    );
    expect(screen.getByText("Hello World")).toBeTruthy();
    expect(screen.getByTestId("mantine-provider")).toBeTruthy();
  });
});
