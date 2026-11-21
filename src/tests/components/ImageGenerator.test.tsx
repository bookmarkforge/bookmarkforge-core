import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import React from "react";

const mockGenerateImage = vi.fn();
vi.mock("../../services/imageService", () => ({
  generateImage: mockGenerateImage,
}));

const mockToast = { error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { Image: mock("Image"), Loader2: mock("Loader2") };
});

const { ImageGenerator } = await import("../../components/ImageGenerator");

describe("ImageGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the generate image button", () => {
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    expect(screen.getByText("generateImage")).toBeTruthy();
  });

  it("clicking the button shows the modal with textarea", async () => {
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });
    expect(screen.getByTestId("modal-cancel-btn")).toBeTruthy();
    expect(screen.getByTestId("modal-generate-btn")).toBeTruthy();
  });

  it("typing a prompt and clicking generate calls generateImage", async () => {
    mockGenerateImage.mockResolvedValue("data:image/png;base64,abc");
    const onGenerated = vi.fn();

    render(<ImageGenerator onImageGenerated={onGenerated} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "a cute cat" } });
    fireEvent.click(screen.getByTestId("modal-generate-btn"));

    expect(mockGenerateImage).toHaveBeenCalledWith("a cute cat");
    await waitFor(() => {
      expect(onGenerated).toHaveBeenCalledWith("data:image/png;base64,abc");
    });
  });

  it("pressing Enter in the textarea submits", async () => {
    mockGenerateImage.mockResolvedValue("data:image/png;base64,xyz");
    const onGenerated = vi.fn();

    render(<ImageGenerator onImageGenerated={onGenerated} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "a landscape" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(mockGenerateImage).toHaveBeenCalledWith("a landscape");
    await waitFor(() => {
      expect(onGenerated).toHaveBeenCalledWith("data:image/png;base64,xyz");
    });
  });

  it("Shift+Enter in textarea does NOT submit (allows new line)", async () => {
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it("Cancel button closes the modal without generating", async () => {
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("modal-cancel-btn"));

    await waitFor(() => {
      expect(screen.queryByLabelText("enterImageDescription")).toBeNull();
    });
    expect(mockGenerateImage).not.toHaveBeenCalled();
  });

  it("generate button disabled when textarea is empty", async () => {
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    const modalBtn = screen.getByTestId(
      "modal-generate-btn",
    ) as HTMLButtonElement;
    expect(modalBtn.disabled).toBe(true);
  });

  it("shows error toast when generateImage fails", async () => {
    mockGenerateImage.mockRejectedValue(new Error("fail"));
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.click(screen.getByTestId("modal-generate-btn"));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("app_errorGeneratingImage");
    });
  });

  it("discards the resolved generation after unmount", async () => {
    let resolveGen: (value: string) => void;
    mockGenerateImage.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveGen = resolve;
      }),
    );
    const onGenerated = vi.fn();

    const { unmount } = render(
      <ImageGenerator onImageGenerated={onGenerated} />,
    );
    fireEvent.click(screen.getByText("generateImage"));
    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });
    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "a cat" } });
    fireEvent.click(screen.getByTestId("modal-generate-btn"));

    unmount();
    await act(async () => {
      resolveGen!("data:image/png;base64,late");
    });

    expect(onGenerated).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("does not show a toast if generation fails after unmount", async () => {
    let rejectGen: (reason: Error) => void;
    mockGenerateImage.mockReturnValue(
      new Promise<string>((_, reject) => {
        rejectGen = reject;
      }),
    );
    const onGenerated = vi.fn();

    const { unmount } = render(
      <ImageGenerator onImageGenerated={onGenerated} />,
    );
    fireEvent.click(screen.getByText("generateImage"));
    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });
    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "a cat" } });
    fireEvent.click(screen.getByTestId("modal-generate-btn"));

    unmount();
    await act(async () => {
      rejectGen!(new Error("late boom"));
    });

    expect(mockToast.error).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("text with only whitespace does not submit", async () => {
    render(<ImageGenerator onImageGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText("generateImage"));

    await waitFor(() => {
      expect(screen.getByLabelText("enterImageDescription")).toBeTruthy();
    });

    const textarea = screen.getByLabelText("enterImageDescription");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(mockGenerateImage).not.toHaveBeenCalled();
  });
});
