import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NetworkPermissionsSection } from "../../components/settings/NetworkPermissionsSection";

const whitelist = vi.hoisted(() => ({
  origins: [] as string[],
  loading: false,
  add: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../hooks/useNetworkWhitelist", () => ({
  useNetworkWhitelist: () => whitelist,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }),
}));

describe("NetworkPermissionsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    whitelist.origins = [];
    whitelist.loading = false;
    whitelist.add.mockResolvedValue(undefined);
    whitelist.remove.mockResolvedValue(undefined);
  });

  it("shows the empty-state message when no origins", () => {
    render(<NetworkPermissionsSection />);
    expect(screen.getByText(/No whitelisted origins/)).toBeInTheDocument();
  });

  it("lists whitelisted origins with a remove button", () => {
    whitelist.origins = ["https://a.com", "https://b.com"];
    render(<NetworkPermissionsSection />);
    expect(screen.getByText("https://a.com")).toBeInTheDocument();
    expect(screen.getByText("https://b.com")).toBeInTheDocument();
  });

  it("adds an origin, trims and clears the input", async () => {
    render(<NetworkPermissionsSection />);
    const input = screen.getByLabelText(
      "https://example.com",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  https://x.com  " } });
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() =>
      expect(whitelist.add).toHaveBeenCalledWith("https://x.com"),
    );
    expect(input.value).toBe("");
  });

  it("does not add when input is empty", async () => {
    render(<NetworkPermissionsSection />);
    fireEvent.click(screen.getByText("Add"));
    expect(whitelist.add).not.toHaveBeenCalled();
  });

  it("adds on Enter key press", async () => {
    render(<NetworkPermissionsSection />);
    const input = screen.getByLabelText("https://example.com");
    fireEvent.change(input, { target: { value: "https://enter.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(whitelist.add).toHaveBeenCalledWith("https://enter.com"),
    );
  });

  it("removes an origin when the trash button is clicked", async () => {
    whitelist.origins = ["https://a.com"];
    render(<NetworkPermissionsSection />);
    fireEvent.click(screen.getByLabelText("Remove"));
    await waitFor(() =>
      expect(whitelist.remove).toHaveBeenCalledWith("https://a.com"),
    );
  });

  it("disables the add button while loading", () => {
    whitelist.loading = true;
    render(<NetworkPermissionsSection />);
    expect(screen.getByText("Add").closest("button")).toBeDisabled();
  });
});
