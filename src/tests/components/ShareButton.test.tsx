import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
  }),
}));

vi.mock("lz-string", () => ({
  default: { compressToEncodedURIComponent: vi.fn(() => "compressed") },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock("react-qr-code", () => ({
  default: () => <svg data-testid="qr-code" />,
}));

const hashStringMock = vi.fn().mockResolvedValue("abc123hash");
vi.mock("../../utils/crypto-core", () => ({
  hashString: hashStringMock,
}));

const loggerErrorMock = vi.fn();
vi.mock("../../utils/logger", () => ({
  logger: { error: loggerErrorMock },
}));

const { ShareButton } = await import("../../components/ShareButton");
const { toast } = await import("sonner");

describe("ShareButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn() },
    });
    hashStringMock.mockResolvedValue("abc123hash");
  });

  it("renders share button", () => {
    const { getByText } = render(
      <ShareButton documentId="doc1" title="Test" content={[]} />,
    );
    expect(getByText("Publish")).toBeTruthy();
  });

  it("opens modal when clicked", async () => {
    const { getByText, findByTestId } = render(
      <ShareButton documentId="doc1" title="Test" content={[]} />,
    );
    await userEvent.click(getByText("Publish"));
    const qr = await findByTestId("qr-code");
    expect(qr).toBeTruthy();
  });

  it("shows the generated URL in the modal input", async () => {
    render(<ShareButton documentId="doc1" title="Test" content={[]} />);
    await userEvent.click(screen.getByText("Publish"));

    const urlInput = await screen.findByLabelText("app_shareUrl");
    expect((urlInput as HTMLInputElement).value).toContain("shared?data=compressed");
  });

  it("copies the link to the clipboard when clicking Copy", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<ShareButton documentId="doc1" title="Test" content={[]} />);
    await userEvent.click(screen.getByText("Publish"));

    const copyBtn = await screen.findByTitle("Copy link");
    await userEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("shared?data=compressed"));
    expect(toast.success).toHaveBeenCalled();
  });

  it("closes the modal when clicking X", async () => {
    render(<ShareButton documentId="doc1" title="Test" content={[]} />);
    await userEvent.click(screen.getByText("Publish"));

    await screen.findByTestId("qr-code");
    // The X close button is the only button without a title attribute
    const buttons = screen.getAllByRole("button");
    const closeBtn = buttons.find((btn) => !btn.getAttribute("title"));
    if (closeBtn) await userEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByTestId("qr-code")).toBeNull();
    });
  });

  it("disables the button during sharing", async () => {
    // Delay hash resolution to keep isSharing=true
    let resolveHash: (value: string) => void;
    hashStringMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveHash = resolve;
      }),
    );

    render(<ShareButton documentId="doc1" title="Test" content={[]} />);
    const publishBtn = screen.getByText("Publish").closest("button")!;
    await userEvent.click(publishBtn);

    await waitFor(() => {
      expect(publishBtn.disabled).toBe(true);
    });

    resolveHash!("abc123");
  });

  it("shows error toast when hash generation fails", async () => {
    hashStringMock.mockRejectedValue(new Error("crypto failed"));

    render(<ShareButton documentId="doc1" title="Test" content={[]} />);
    await userEvent.click(screen.getByText("Publish"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
      expect(loggerErrorMock).toHaveBeenCalled();
    });
  });

  it("discards the resolved share after unmount without toasts or logs", async () => {
    let resolveHash: (value: string) => void;
    hashStringMock.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveHash = resolve;
      }),
    );

    const { unmount } = render(
      <ShareButton documentId="doc1" title="Test" content={[]} />,
    );
    await userEvent.click(screen.getByText("Publish"));
    unmount();

    await act(async () => {
      resolveHash!("abc123");
    });

    expect(toast.error).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("discards the resolved copy after unmount", async () => {
    let resolveWrite: (value: void) => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { unmount } = render(
      <ShareButton documentId="doc1" title="Test" content={[]} />,
    );
    await userEvent.click(screen.getByText("Publish"));
    await screen.findByTestId("qr-code");
    const copyBtn = screen.getByTitle("Copy link");
    await userEvent.click(copyBtn);
    unmount();

    await act(async () => {
      resolveWrite!();
    });

    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows a warning when the content is too large", async () => {
    const LZString = await import("lz-string");
    // Make the compression mock return a very long string to trigger the >2000 check
    (LZString.default.compressToEncodedURIComponent as any).mockReturnValueOnce(
      "x".repeat(2100),
    );

    render(
      <ShareButton
        documentId="doc1"
        title="Test"
        content={[]}
      />,
    );
    await userEvent.click(screen.getByText("Publish"));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalled();
    });
  });
});
