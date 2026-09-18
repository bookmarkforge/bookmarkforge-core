import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("react-i18next", () => {
  // Mirrors the real t(): the fallback is the source string, and the
  // interpolation map replaces its {{placeholders}}.
  const t = (
    key: string,
    fallback?: unknown,
    options?: Record<string, unknown>,
  ) => {
    let out = typeof fallback === "string" ? fallback : key;
    const vars =
      options ??
      (typeof fallback === "object" && fallback !== null
        ? (fallback as Record<string, unknown>)
        : undefined);
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        out = out.replaceAll(`{{${name}}}`, String(value));
      }
    }
    return out;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../../mocks/motion");
  return createMotionMock();
});

const { FirstRunChecklist } = await import(
  "../../../components/dashboard/components/FirstRunChecklist"
);

function renderChecklist(
  props?: Partial<ComponentProps<typeof FirstRunChecklist>>,
) {
  const handlers = {
    onCaptureBookmark: vi.fn(),
    onCreateDocument: vi.fn(),
    onTrySearch: vi.fn(),
    onDismiss: vi.fn(),
  };
  const view = render(
    <FirstRunChecklist
      bookmarkCount={0}
      documentCount={0}
      searchTried={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

describe("FirstRunChecklist", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("is a labelled region with the three value-loop steps", () => {
    renderChecklist();
    expect(
      screen.getByRole("region", { name: "Your first two minutes" }),
    ).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(screen.getByText("Save your first bookmark")).toBeTruthy();
    expect(screen.getByText("Write or import a note")).toBeTruthy();
    expect(screen.getByText("Find it again")).toBeTruthy();
  });

  it("counts progress out of the three steps", () => {
    renderChecklist({ bookmarkCount: 4, searchTried: true });
    expect(screen.getByText("2 of 3 done")).toBeTruthy();
  });

  it("marks a completed step without relying on colour alone", () => {
    renderChecklist({ bookmarkCount: 1 });
    // The done step keeps its title and gains a readable "Done" label, so the
    // completed state is exposed to assistive tech, not just visually.
    expect(screen.getByText("Save your first bookmark")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("treats a missing count as not started", () => {
    renderChecklist({ bookmarkCount: undefined, documentCount: undefined });
    expect(screen.getByText("0 of 3 done")).toBeTruthy();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("routes each step to its own surface", () => {
    const { onCaptureBookmark, onCreateDocument, onTrySearch } =
      renderChecklist();

    fireEvent.click(
      screen.getByText("Save your first bookmark").closest("button")!,
    );
    fireEvent.click(
      screen.getByText("Write or import a note").closest("button")!,
    );
    fireEvent.click(screen.getByText("Find it again").closest("button")!);

    expect(onCaptureBookmark).toHaveBeenCalledTimes(1);
    expect(onCreateDocument).toHaveBeenCalledTimes(1);
    expect(onTrySearch).toHaveBeenCalledTimes(1);
  });

  it("exposes the dismissal as a named button", () => {
    const { onDismiss } = renderChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Hide this checklist" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
