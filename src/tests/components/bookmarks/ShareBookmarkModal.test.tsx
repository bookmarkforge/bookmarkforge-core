import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ShareBookmarkModal } from "../../../components/bookmarks/ShareBookmarkModal";

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_shareBookmark: "Share Bookmark",
    app_close: "Close",
    app_recipientEmail: "Recipient Email",
    app_recipientEmailPlaceholder: "email@example.com",
    app_preview: "Preview",
    app_cancel: "Cancel",
    app_sendEmail: "Send Email",
  };
  return map[key] || key;
});

const mockBookmark = {
  id: "bm-1",
  title: "Test Bookmark",
  url: "https://test.com",
};

describe("ShareBookmarkModal", () => {
  it("renders when there is a bookmark", () => {
    const { getByText } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail=""
        setShareEmail={vi.fn()}
        setSharingBookmark={vi.fn()}
        handleShare={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByText("Share Bookmark")).toBeTruthy();
    expect(getByText("Test Bookmark")).toBeTruthy();
    expect(getByText("https://test.com")).toBeTruthy();
  });

  it("renders the modal even when sharingBookmark is null", () => {
    const { getByText } = render(
      <ShareBookmarkModal
        sharingBookmark={null}
        shareEmail=""
        setShareEmail={vi.fn()}
        setSharingBookmark={vi.fn()}
        handleShare={vi.fn()}
        t={mockT}
      />,
    );
    expect(getByText("Share Bookmark")).toBeTruthy();
  });

  it("calls setShareEmail when typing in the input", () => {
    const setEmail = vi.fn();
    const { getByLabelText } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail=""
        setShareEmail={setEmail}
        setSharingBookmark={vi.fn()}
        handleShare={vi.fn()}
        t={mockT}
      />,
    );
    fireEvent.change(getByLabelText("Recipient Email"), {
      target: { value: "a@b.com" },
    });
    expect(setEmail).toHaveBeenCalledWith("a@b.com");
  });

  it("llama setSharingBookmark(null) al cerrar", async () => {
    const setSharing = vi.fn();
    const { getAllByRole } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail=""
        setShareEmail={vi.fn()}
        setSharingBookmark={setSharing}
        handleShare={vi.fn()}
        t={mockT}
      />,
    );
    const closeBtn = getAllByRole("button").find(
      (b) => b.getAttribute("aria-label") === "Close",
    );
    await userEvent.click(closeBtn!);
    expect(setSharing).toHaveBeenCalledWith(null);
  });

  it("calls handleShare on form submit", async () => {
    const handleShare = vi.fn();
    const { getByText } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail="a@b.com"
        setShareEmail={vi.fn()}
        setSharingBookmark={vi.fn()}
        handleShare={handleShare}
        t={mockT}
      />,
    );
    await userEvent.click(getByText("Send Email"));
    expect(handleShare).toHaveBeenCalled();
  });

  it("has an email input with required", () => {
    const { getByLabelText } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail=""
        setShareEmail={vi.fn()}
        setSharingBookmark={vi.fn()}
        handleShare={vi.fn()}
        t={mockT}
      />,
    );
    const input = getByLabelText("Recipient Email") as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.type).toBe("email");
  });

  it("renders cancel button", async () => {
    const setSharing = vi.fn();
    const { getByText } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail=""
        setShareEmail={vi.fn()}
        setSharingBookmark={setSharing}
        handleShare={vi.fn()}
        t={mockT}
      />,
    );
    await userEvent.click(getByText("Cancel"));
    expect(setSharing).toHaveBeenCalledWith(null);
  });

  it("uses 'Close' fallback if t returns an empty value", () => {
    const falsyT = vi.fn((key: string) => (key === "app_close" ? "" : key));
    const { getAllByRole } = render(
      <ShareBookmarkModal
        sharingBookmark={mockBookmark as any}
        shareEmail=""
        setShareEmail={vi.fn()}
        setSharingBookmark={vi.fn()}
        handleShare={vi.fn()}
        t={falsyT}
      />,
    );
    const closeBtn = getAllByRole("button").find(
      (b) => b.getAttribute("aria-label") === "Close",
    );
    expect(closeBtn).toBeTruthy();
  });
});
