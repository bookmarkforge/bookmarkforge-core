import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => opts?.defaultValue || key,
  }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => <svg data-testid={`icon-${name}`} {...props} />;
    Icon.displayName = name;
    return Icon;
  };
  return { Loader2: mock("Loader2"), Image: mock("Image") };
});

vi.mock("../../services/SanitizationService", () => ({
  sanitizeUrl: (url: string) => url,
}));

vi.mock("../../services/MetadataService", () => ({
  metadataService: { fetchMetadata: vi.fn() },
}));

import { BookmarkPreview } from "../../components/bookmarks/BookmarkPreview";
import { metadataService } from "../../services/MetadataService";

const fetchMetadataMock = () =>
  metadataService.fetchMetadata as ReturnType<typeof vi.fn>;

describe("BookmarkPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMetadataMock().mockResolvedValue({});
  });

  it("shows loading spinner while the metadata fetch is pending", async () => {
    fetchMetadataMock().mockImplementation(() => new Promise(() => {}));
    render(<BookmarkPreview url="https://example.com" />);
    expect(await screen.findByTestId("icon-Loader2")).toBeTruthy();
  });

  it("shows empty state when there is no ogData", async () => {
    render(<BookmarkPreview url="https://example.com" />);
    expect(await screen.findByText("app_noPreview")).toBeTruthy();
  });

  it("shows preview with title and description", async () => {
    fetchMetadataMock().mockResolvedValue({
      title: "Example Title",
      description: "A great description",
    });
    render(<BookmarkPreview url="https://example.com" />);
    expect(await screen.findByText("Example Title")).toBeTruthy();
    expect(screen.getByText("A great description")).toBeTruthy();
  });

  it("omits the image by zero-knowledge design (placeholder instead)", async () => {
    fetchMetadataMock().mockResolvedValue({
      title: "With Image",
      image: "https://example.com/og.png",
    });
    render(<BookmarkPreview url="https://example.com" />);
    expect(await screen.findByText("With Image")).toBeTruthy();
    // Image preview is deliberately skipped (zero-knowledge:
    // the URL is not fetched from third-party image CDNs). The loader discards
    // meta.image even if metadataService returns it.
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("icon-Image")).toBeTruthy();
  });

  it("shows the URL as title when there is no ogData.title", async () => {
    fetchMetadataMock().mockResolvedValue({
      description: "Desc only",
    });
    render(<BookmarkPreview url="https://fallback.com" />);
    expect(await screen.findByText("https://fallback.com")).toBeTruthy();
  });

  it("does not show description when ogData.description is undefined", async () => {
    fetchMetadataMock().mockResolvedValue({
      title: "Title Only",
    });
    render(<BookmarkPreview url="https://example.com" />);
    expect(await screen.findByText("Title Only")).toBeTruthy();
    expect(screen.queryByText("app_noPreview")).toBeNull();
  });

  it("resets the view to empty when the URL is removed", async () => {
    fetchMetadataMock().mockResolvedValue({
      title: "Stale Title",
    });
    const { rerender } = render(<BookmarkPreview url="https://example.com" />);
    expect(await screen.findByText("Stale Title")).toBeTruthy();

    rerender(<BookmarkPreview url="" />);
    await waitFor(() => {
      expect(screen.queryByText("Stale Title")).toBeNull();
    });
    expect(screen.getByText("app_noPreview")).toBeTruthy();
  });

  it("aborts the pending fetch on unmount", async () => {
    fetchMetadataMock().mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<BookmarkPreview url="https://example.com" />);
    await waitFor(() => {
      expect(fetchMetadataMock()).toHaveBeenCalled();
    });
    const signal = fetchMetadataMock().mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
