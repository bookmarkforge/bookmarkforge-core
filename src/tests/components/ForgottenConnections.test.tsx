import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
  }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    History: mock("History"),
    RefreshCw: mock("RefreshCw"),
    Sparkles: mock("Sparkles"),
    ExternalLink: mock("ExternalLink"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const mockFind = vi.fn();
const mockExec = vi.fn();
const mockInitDB = vi.fn();
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));

describe("ForgottenConnections", () => {
  let ForgottenConnections: React.FC<{ onSelect: (id: string) => void }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue([]);
    mockFind.mockReturnValue({ exec: mockExec });
    mockInitDB.mockResolvedValue({ bookmarks: { find: mockFind } });
    const mod = await import("../../components/ai/ForgottenConnections");
    ForgottenConnections = mod.ForgottenConnections;
  });

  it("returns null when there is no suggestion", async () => {
    mockExec.mockResolvedValue([]);
    const { container, unmount } = render(
      <ForgottenConnections onSelect={vi.fn()} />,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
    unmount();
  });

  it("shows title", async () => {
    render(<ForgottenConnections onSelect={vi.fn()} />);
    expect(await screen.findByText("app_forgottenConnection")).toBeTruthy();
  });

  it("ignores a query that finishes after unmount", async () => {
    let resolveQuery!: (bookmarks: unknown[]) => void;
    mockExec.mockReturnValue(
      new Promise((resolve) => {
        resolveQuery = resolve;
      }),
    );

    const { unmount } = render(<ForgottenConnections onSelect={vi.fn()} />);
    await waitFor(() => expect(mockFind).toHaveBeenCalled());
    unmount();

    await act(async () => {
      resolveQuery([]);
      await Promise.resolve();
    });

    expect(screen.queryByText("app_forgottenConnection")).toBeNull();
  });

  it("keeps only the most recent shuffle result", async () => {
    const initialBookmark = {
      id: "initial",
      title: "Initial",
      url: "https://initial.test",
      toJSON: () => ({
        id: "initial",
        title: "Initial",
        url: "https://initial.test",
        createdAt: "2024-01-01",
      }),
    };
    const firstShuffle = {
      id: "first",
      title: "First stale",
      url: "https://first.test",
      toJSON: () => ({
        id: "first",
        title: "First stale",
        url: "https://first.test",
        createdAt: "2024-01-01",
      }),
    };
    const latestShuffle = {
      id: "latest",
      title: "Latest",
      url: "https://latest.test",
      toJSON: () => ({
        id: "latest",
        title: "Latest",
        url: "https://latest.test",
        createdAt: "2024-01-01",
      }),
    };
    let resolveFirst!: (bookmarks: unknown[]) => void;
    let resolveLatest!: (bookmarks: unknown[]) => void;
    mockExec
      .mockResolvedValueOnce([initialBookmark])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveLatest = resolve;
        }),
      );

    render(<ForgottenConnections onSelect={vi.fn()} />);
    expect(await screen.findByText("Initial")).toBeTruthy();
    const shuffle = screen.getByTitle("app_shuffle");
    act(() => {
      fireEvent.click(shuffle);
      fireEvent.click(shuffle);
    });

    resolveLatest([latestShuffle]);
    await waitFor(() => expect(screen.getByText("Latest")).toBeTruthy());
    resolveFirst([firstShuffle]);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("First stale")).toBeNull();
    expect(screen.getByText("Latest")).toBeTruthy();
  });

  it("shows bookmark suggestion", async () => {
    const bookmark = {
      id: "b1",
      title: "Old Bookmark",
      url: "https://example.com",
      toJSON: () => ({
        id: "b1",
        title: "Old Bookmark",
        url: "https://example.com",
        createdAt: "2024-01-01",
      }),
    };
    mockExec.mockResolvedValue([bookmark]);
    render(<ForgottenConnections onSelect={vi.fn()} />);
    expect(await screen.findByText("Old Bookmark")).toBeTruthy();
    expect(await screen.findByText("https://example.com")).toBeTruthy();
  });

  it("calls onSelect when clicking Revisit", async () => {
    const onSelect = vi.fn();
    const bookmark = {
      id: "b1",
      title: "Test BM",
      url: "https://test.com",
      toJSON: () => ({
        id: "b1",
        title: "Test BM",
        url: "https://test.com",
        createdAt: "2024-01-01",
      }),
    };
    mockExec.mockResolvedValue([bookmark]);
    render(<ForgottenConnections onSelect={onSelect} />);
    await userEvent.click(await screen.findByText("app_revisit"));
    expect(onSelect).toHaveBeenCalledWith("b1");
  });

  it("has a shuffle button", async () => {
    const bookmark = {
      id: "b1",
      title: "Test",
      url: "https://t.com",
      toJSON: () => ({
        id: "b1",
        title: "Test",
        url: "https://t.com",
        createdAt: "2024-01-01",
      }),
    };
    mockExec.mockResolvedValue([bookmark]);
    render(<ForgottenConnections onSelect={vi.fn()} />);
    expect(await screen.findByTestId("icon-RefreshCw")).toBeTruthy();
  });
});
