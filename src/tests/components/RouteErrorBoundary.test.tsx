import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("../../i18n", () => ({ default: { t: (s: string) => s } }));

describe("RouteErrorBoundary", () => {
  let RouteErrorBoundary: typeof import("../../components/errors/RouteErrorBoundary").RouteErrorBoundary;
  let withErrorBoundary: typeof import("../../components/errors/RouteErrorBoundary").withErrorBoundary;

  beforeEach(async () => {
    const mod = await import("../../components/errors/RouteErrorBoundary");
    RouteErrorBoundary = mod.RouteErrorBoundary;
    withErrorBoundary = mod.withErrorBoundary;
  });

  it("should render children when no error", () => {
    render(
      <RouteErrorBoundary>
        <div>Test Content</div>
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("Test Content")).toBeDefined();
  });

  it("should catch error and show error UI", () => {
    const Buggy = () => {
      throw new Error("Test error");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <Buggy />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("componentError")).toBeDefined();
    expect(screen.getByText("sectionError")).toBeDefined();
  });

  it("should show custom fallback when provided", () => {
    const Buggy = () => {
      throw new Error("Custom fallback test");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary fallback={<div>Custom Fallback</div>}>
        <Buggy />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("Custom Fallback")).toBeDefined();
  });

  it("should call onError callback when error occurs", () => {
    const onError = vi.fn();
    const Buggy = () => {
      throw new Error("Callback test");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary onError={onError}>
        <Buggy />
      </RouteErrorBoundary>,
    );
    expect(onError).toHaveBeenCalled();
  });

  it("should show reset button when showReset is true", () => {
    const Buggy = () => {
      throw new Error("Reset test");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary showReset>
        <Buggy />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("reset")).toBeDefined();
  });

  it("should NOT show reset button when showReset is false", () => {
    const Buggy = () => {
      throw new Error("No reset test");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <Buggy />
      </RouteErrorBoundary>,
    );
    expect(screen.queryByText("reset")).toBeNull();
  });

  it("withErrorBoundary HOC should wrap component", () => {
    const Safe = () => <div>Safe Component</div>;
    const Wrapped = withErrorBoundary(Safe);
    render(<Wrapped />);
    expect(screen.getByText("Safe Component")).toBeDefined();
  });

  it("withErrorBoundary HOC catches errors", () => {
    const Buggy = () => {
      throw new Error("HOC error");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Wrapped = withErrorBoundary(Buggy);
    render(<Wrapped />);
    expect(screen.getByText("componentError")).toBeDefined();
  });

  it("withErrorBoundary passes boundaryProps", () => {
    const Buggy = () => {
      throw new Error("Props error");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Wrapped = withErrorBoundary(Buggy, { showReset: true });
    render(<Wrapped />);
    expect(screen.getByText("reset")).toBeDefined();
  });

  it("displays error message in the error UI", () => {
    const Buggy = () => {
      throw new Error("Visible error msg");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <Buggy />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText("Visible error msg")).toBeDefined();
  });

  it("reset button calls onReset callback", () => {
    const onReset = vi.fn();
    const Buggy = () => {
      throw new Error("Reset callback test");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary showReset onReset={onReset}>
        <Buggy />
      </RouteErrorBoundary>,
    );
    fireEvent.click(screen.getByText("reset"));
    expect(onReset).toHaveBeenCalled();
  });

  it("reset button clears error and re-renders children", () => {
    const Buggy = () => {
      throw new Error("Reset clears error");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    function Wrapper() {
      const [showBuggy, setShowBuggy] = React.useState(true);
      return (
        <RouteErrorBoundary
          showReset
          onReset={() => setShowBuggy(false)}
        >
          {showBuggy ? <Buggy /> : <div>Recovered</div>}
        </RouteErrorBoundary>
      );
    }

    render(<Wrapper />);
    expect(screen.getByText("componentError")).toBeDefined();
    fireEvent.click(screen.getByText("reset"));
    expect(screen.getByText("Recovered")).toBeDefined();
  });

  it("goBack button calls window.history.back", () => {
    const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const Buggy = () => {
      throw new Error("GoBack test");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <RouteErrorBoundary>
        <Buggy />
      </RouteErrorBoundary>,
    );
    fireEvent.click(screen.getByText("goBack"));
    expect(backSpy).toHaveBeenCalled();
    backSpy.mockRestore();
  });
});
