import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";

let progressCallback: ((status: string, msg?: string) => void) | null = null;

vi.mock("../../services/ai/RAGEngine", () => ({
  onEmbeddingProgress: vi.fn(
    (cb: (status: string, msg?: string) => void) => {
      progressCallback = cb;
      return vi.fn(); // unsubscribe mock
    },
  ),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <svg data-testid="icon-loader" />,
}));

import { EmbeddingProgressIndicator } from "../../components/EmbeddingProgressIndicator";

describe("EmbeddingProgressIndicator", () => {
  it("does not render when the state is not loading", () => {
    render(<EmbeddingProgressIndicator />);
    expect(screen.queryByText(/Downloading/)).toBeNull();
  });

  it("shows when onEmbeddingProgress emits loading", async () => {
    render(<EmbeddingProgressIndicator />);
    await act(async () => {
      progressCallback!("loading", "Downloading model...");
    });
    expect(screen.getByText("Downloading model...")).toBeTruthy();
  });

  it("uses the default message when msg is undefined", async () => {
    render(<EmbeddingProgressIndicator />);
    await act(async () => {
      progressCallback!("loading");
    });
    expect(screen.getByText("Downloading model...")).toBeTruthy();
  });

  it("hides when onEmbeddingProgress emits another state", async () => {
    render(<EmbeddingProgressIndicator />);
    await act(async () => {
      progressCallback!("loading", "Working...");
    });
    expect(screen.getByText("Working...")).toBeTruthy();

    await act(async () => {
      progressCallback!("done");
    });
    expect(screen.queryByText("Working...")).toBeNull();
  });

  it("shows the Loader2 spinner during loading", async () => {
    render(<EmbeddingProgressIndicator />);
    await act(async () => {
      progressCallback!("loading", "Indexing...");
    });
    expect(screen.getByTestId("icon-loader")).toBeTruthy();
  });
});
