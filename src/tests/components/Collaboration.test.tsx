import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const mockCollaborationService = {
  generateSharePayload: vi.fn(),
  importSharedVault: vi.fn(),
  stop: vi.fn(),
};
vi.mock("../../services/CollaborationService", () => ({
  collaborationService: mockCollaborationService,
}));

vi.mock("../../hooks/useRxDB", () => ({ useRxDB: vi.fn(() => ({})) }));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Share2: mock("Share2"),
    Copy: mock("Copy"),
    Check: mock("Check"),
    Shield: mock("Shield"),
    Users: mock("Users"),
    Wifi: mock("Wifi"),
    WifiOff: mock("WifiOff"),
  };
});

describe("Collaboration", () => {
  let Collaboration: React.FC;
  let clipboardText: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    clipboardText = "";
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: vi.fn((text: string) => {
          clipboardText = text;
        }),
      },
    });
    mockCollaborationService.generateSharePayload.mockResolvedValue(
      "mock-payload-data",
    );
    mockCollaborationService.importSharedVault.mockResolvedValue(true);
    const mod = await import("../../components/Collaboration");
    Collaboration = mod.Collaboration;
  });

  it("renders the title", () => {
    render(<Collaboration />);
    expect(screen.getByText("app_collaborationTitle")).toBeTruthy();
  });

  it("shows sync inactive by default", () => {
    render(<Collaboration />);
    expect(screen.getByTestId("icon-WifiOff")).toBeTruthy();
  });

  it("generates share payload when clicking Share", async () => {
    render(<Collaboration />);
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[0]!, "mypassword");
    await userEvent.click(screen.getByText("app_share"));
    expect(mockCollaborationService.generateSharePayload).toHaveBeenCalledWith(
      "mypassword",
      expect.any(AbortSignal),
    );
  });

  it("ignores a second click while generating the payload", async () => {
    let resolvePayload: ((value: string) => void) | undefined;
    mockCollaborationService.generateSharePayload.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolvePayload = resolve;
      }),
    );
    render(<Collaboration />);
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[0]!, "mypassword");

    const shareButton = screen.getByText("app_share");
    await userEvent.click(shareButton);
    await userEvent.click(shareButton);

    expect(mockCollaborationService.generateSharePayload).toHaveBeenCalledTimes(1);
    resolvePayload?.("single-payload");
    await screen.findByText("single-payload");
  });

  it("discards a resolved share after unmount", async () => {
    let resolvePayload!: (value: string) => void;
    mockCollaborationService.generateSharePayload.mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePayload = resolve;
      }),
    );
    const { unmount } = render(<Collaboration />);
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[0]!, "pass");
    await userEvent.click(screen.getByText("app_share"));
    await waitFor(() => {
      expect(mockCollaborationService.generateSharePayload).toHaveBeenCalled();
    });

    unmount();
    resolvePayload("stale-payload");
    await act(async () => {});

    expect(mockToast.success).not.toHaveBeenCalledWith("app_sharePayloadGenerated");
  });

  it("discards a resolved import after unmount", async () => {
    let resolveImport!: (value: boolean) => void;
    mockCollaborationService.importSharedVault.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveImport = resolve;
      }),
    );
    const { unmount } = render(<Collaboration />);
    const textarea = screen.getByPlaceholderText("app_roomIdPlaceholder");
    await userEvent.type(textarea, "data");
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[1]!, "pass");
    await userEvent.click(screen.getByText("app_import"));
    await waitFor(() => {
      expect(mockCollaborationService.importSharedVault).toHaveBeenCalled();
    });

    unmount();
    resolveImport(true);
    await act(async () => {});

    expect(mockToast.success).not.toHaveBeenCalledWith("app_vaultImportedSuccessfully");
  });

  it("shows error if there is no password when sharing", async () => {
    render(<Collaboration />);
    await userEvent.click(screen.getByText("app_share"));
    expect(mockToast.error).toHaveBeenCalledWith("app_masterPasswordRequired");
  });

  it("shows generated payload", async () => {
    render(<Collaboration />);
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[0]!, "pass");
    await userEvent.click(screen.getByText("app_share"));
    await screen.findByText("mock-payload-data");
    expect(screen.getByText("mock-payload-data")).toBeTruthy();
  });

  it("copies payload to the clipboard", async () => {
    render(<Collaboration />);
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[0]!, "pass");
    await userEvent.click(screen.getByText("app_share"));
    const copyBtn = await screen.findByTestId("icon-Copy");
    await userEvent.click(copyBtn);
    expect(clipboardText).toBe("mock-payload-data");
  });

  it("imports vault successfully", async () => {
    render(<Collaboration />);
    const textarea = screen.getByPlaceholderText("app_roomIdPlaceholder");
    await userEvent.type(textarea, "import-data");
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[1]!, "importpass");
    await userEvent.click(screen.getByText("app_import"));
    expect(mockCollaborationService.importSharedVault).toHaveBeenCalled();
  });

  it("ignores a second import while the first is still in progress", async () => {
    let resolveImport: ((value: boolean) => void) | undefined;
    mockCollaborationService.importSharedVault.mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveImport = resolve;
      }),
    );
    render(<Collaboration />);
    const textarea = screen.getByPlaceholderText("app_roomIdPlaceholder");
    await userEvent.type(textarea, "import-data");
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[1]!, "importpass");

    const importButton = screen.getByText("app_import");
    await userEvent.click(importButton);
    await userEvent.click(importButton);

    expect(mockCollaborationService.importSharedVault).toHaveBeenCalledTimes(1);
    resolveImport?.(true);
    await screen.findByTestId("icon-Wifi");
  });

  it("validates empty fields on import", async () => {
    render(<Collaboration />);
    await userEvent.click(screen.getByText("app_import"));
    expect(mockToast.error).toHaveBeenCalledWith("app_missingFields");
  });

  it("shows active sync after successful import", async () => {
    render(<Collaboration />);
    const textarea = screen.getByPlaceholderText("app_roomIdPlaceholder");
    await userEvent.type(textarea, "data");
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[1]!, "pass");
    await userEvent.click(screen.getByText("app_import"));
    await screen.findByTestId("icon-Wifi");
    expect(screen.getByTestId("icon-Wifi")).toBeTruthy();
  });

  it("calls generateSharePayload with the correct password", async () => {
    mockCollaborationService.generateSharePayload.mockResolvedValue(
      "payload-data",
    );
    render(<Collaboration />);
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[0]!, "pass");
    await userEvent.click(screen.getByText("app_share"));
    await screen.findByText("payload-data");
    expect(screen.getByText("payload-data")).toBeTruthy();
  });

  it("llama importSharedVault con datos correctos", async () => {
    mockCollaborationService.importSharedVault.mockResolvedValue(true);
    render(<Collaboration />);
    const textarea = screen.getByPlaceholderText("app_roomIdPlaceholder");
    await userEvent.type(textarea, "data");
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[1]!, "pass");
    await userEvent.click(screen.getByText("app_import"));
    await screen.findByTestId("icon-Wifi");
    expect(screen.getByTestId("icon-Wifi")).toBeTruthy();
  });

  it("keeps WifiOff if import returns false", async () => {
    mockCollaborationService.importSharedVault.mockResolvedValue(false);
    render(<Collaboration />);
    const textarea = screen.getByPlaceholderText("app_roomIdPlaceholder");
    await userEvent.type(textarea, "data");
    const passwordInputs = screen.getAllByPlaceholderText("app_masterPassword");
    await userEvent.type(passwordInputs[1]!, "pass");
    await userEvent.click(screen.getByText("app_import"));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("icon-WifiOff")).toBeTruthy();
  });
});
