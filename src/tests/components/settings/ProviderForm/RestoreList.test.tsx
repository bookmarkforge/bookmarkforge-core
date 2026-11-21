import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Database: mock("Database"),
    Download: mock("Download"),
    Loader2: mock("Loader2"),
  };
});

const mockT = vi.fn(
  (key: string, options?: any) => options?.defaultValue || key,
);

describe("RestoreList", () => {
  let RestoreList: React.FC<{
    files: any[];
    isLoading: boolean;
    isRestoring: boolean;
    onRestore: (id: string, name: string) => void;
    t: any;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../../components/settings/ProviderForm/RestoreList");
    RestoreList = mod.RestoreList;
  });

  it("returns null when files is empty", () => {
    const { container } = render(
      <RestoreList
        files={[]}
        isLoading={false}
        isRestoring={false}
        onRestore={vi.fn()}
        t={mockT}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("shows restore title", () => {
    render(
      <RestoreList
        files={[{ id: "1", name: "backup-1.bmf" }]}
        isLoading={false}
        isRestoring={false}
        onRestore={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("restoreFromCloud")).toBeTruthy();
  });

  it("shows loading state", () => {
    render(
      <RestoreList
        files={[{ id: "1", name: "backup-1.bmf" }]}
        isLoading={true}
        isRestoring={false}
        onRestore={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("loadingBackups")).toBeTruthy();
  });

  it("shows file name", () => {
    render(
      <RestoreList
        files={[{ id: "1", name: "my-backup.bmf" }]}
        isLoading={false}
        isRestoring={false}
        onRestore={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("my-backup.bmf")).toBeTruthy();
  });

  it("calls onRestore when clicked", async () => {
    const onRestore = vi.fn();
    render(
      <RestoreList
        files={[{ id: "f1", name: "backup.bmf" }]}
        isLoading={false}
        isRestoring={false}
        onRestore={onRestore}
        t={mockT}
      />,
    );
    await userEvent.click(screen.getByText("restore"));
    expect(onRestore).toHaveBeenCalledWith("f1", "backup.bmf");
  });
});
