import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ErrorBoundaryWrapper } from "../../components/ErrorBoundary";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string, d?: string) => d || s }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../../utils/logger";

vi.mock("../../i18n", () => ({
  default: { t: (s: string, d?: string) => d || s },
}));

const errorReporter = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../telemetry/errorReporter", () => ({
  errorReporter,
}));

// ErrorBoundary renders hand-rolled inline SVGs (not lucide-react) so the
// eager entry graph never statically imports the ui-runtime vendor chunk.
// The copy button is located by its `title` instead of a mocked icon.
const ThrowingChild: any = ({ error }: { error?: Error }) => {
  throw error || new Error("test error");
};

function GoodChild() {
  return <span>all good</span>;
}

describe("ErrorBoundaryWrapper (class)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders children without error", () => {
    render(
      <ErrorBoundaryWrapper>
        <GoodChild />
      </ErrorBoundaryWrapper>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
  });

  it("captura error con getDerivedStateFromError", () => {
    const error = new Error("test error");
    const state = ErrorBoundaryWrapper.getDerivedStateFromError(error);
    expect(state.hasError).toBe(true);
    expect(state.error).toBe(error);
  });

  it("shows error UI when there is an error", () => {
    render(
      <ErrorBoundaryWrapper>
        <ThrowingChild />
      </ErrorBoundaryWrapper>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  it("shows reload button in error state", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload },
      writable: true,
      configurable: true,
    });
    render(
      <ErrorBoundaryWrapper>
        <ThrowingChild />
      </ErrorBoundaryWrapper>,
    );
    const reloadBtn = screen.getByText("Reload Application");
    await userEvent.click(reloadBtn);
    expect(reload).toHaveBeenCalled();
  });

  it("shows the error message from the catch", () => {
    render(
      <ErrorBoundaryWrapper>
        <ThrowingChild />
      </ErrorBoundaryWrapper>,
    );
    expect(screen.getAllByText(/test error/).length).toBeGreaterThan(0);
  });

  it("shows copy button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(
      <ErrorBoundaryWrapper>
        <ThrowingChild />
      </ErrorBoundaryWrapper>,
    );
    const copyBtn = screen.getByTitle("Copy");
    await userEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalled();
  });

  it("componentDidCatch logs the error", () => {
    render(
      <ErrorBoundaryWrapper>
        <ThrowingChild />
      </ErrorBoundaryWrapper>,
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("handles error without stack trace", () => {
    const ThrowNoStack: any = () => {
      const err = new Error("no stack");
      delete (err as any).stack;
      throw err;
    };
    render(
      <ErrorBoundaryWrapper>
        <ThrowNoStack />
      </ErrorBoundaryWrapper>,
    );
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });

  // ── Fusionado de src/tests/security/ErrorBoundary.test.tsx ──

  it("reports the error via the error reporter", () => {
    render(
      <ErrorBoundaryWrapper>
        <ThrowingChild />
      </ErrorBoundaryWrapper>,
    );
    expect(errorReporter.reportError).toHaveBeenCalledTimes(1);
  });

  it("shows 'Unknown error' when the message is empty", () => {
    const ThrowEmpty: any = () => {
      throw new Error("");
    };
    render(
      <ErrorBoundaryWrapper>
        <ThrowEmpty />
      </ErrorBoundaryWrapper>,
    );
    expect(screen.getByText("Unknown error")).toBeInTheDocument();
  });

  it("copies the message to the clipboard when there is no stack", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const ThrowNoStack: any = () => {
      const err = new Error("Sin stack");
      delete (err as any).stack;
      throw err;
    };
    render(
      <ErrorBoundaryWrapper>
        <ThrowNoStack />
      </ErrorBoundaryWrapper>,
    );
    await userEvent.click(screen.getByTitle("Copy"));
    expect(writeText).toHaveBeenCalledWith("Sin stack");
  });
});
