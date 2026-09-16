import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Real react-i18next behavior with no translations loaded:
    // t(key, defaultValue) → defaultValue (string u objeto {defaultValue}).
    t: (s: string, opts?: any) =>
      (typeof opts === "string" ? opts : opts?.defaultValue) || s,
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
    X: mock("X"),
    Smartphone: mock("Smartphone"),
    Monitor: mock("Monitor"),
    Scan: mock("Scan"),
    Wifi: mock("Wifi"),
    Shield: mock("Shield"),
    Loader2: mock("Loader2"),
    CheckCircle2: mock("CheckCircle2"),
    AlertTriangle: mock("AlertTriangle"),
    Lightbulb: mock("Lightbulb"),
    AlertCircle: mock("AlertCircle"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-qr-code", () => ({
  default: ({ value }: any) => <div data-testid="qr-code" data-value={value} />,
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: function () {
    return {
      decodeFromVideoDevice: (_: any, _2: any, _cb: any) =>
        Promise.resolve({ stop: vi.fn() }),
    };
  },
}));

const mockWebRTC = {
  registerCallbacks: vi.fn(),
  disconnect: vi.fn(),
  startHost: vi.fn().mockResolvedValue("offer-sdp"),
  processClientAnswer: vi.fn(),
  startClient: vi.fn().mockResolvedValue("answer-sdp"),
};
// WebRTC feature detection reads globalThis directly (the Pro module is no
// longer imported by the component), so tests steer it by (un)defining
// RTCPeerConnection.
const stubRTCPeerConnection = (supported: boolean) => {
  const g = globalThis as { RTCPeerConnection?: unknown };
  if (supported) {
    g.RTCPeerConnection = class {};
  } else {
    delete g.RTCPeerConnection;
  }
};
stubRTCPeerConnection(true);

vi.mock("../../services/pro-access", () => ({
  // The modal resolves the Pro service through the pro-access loader, so
  // the double is installed at the loader instead of at the Pro module.
  loadWebRTCSyncService: () => Promise.resolve(mockWebRTC),
}));

vi.mock("../../hooks/useFocusTrap", () => ({ useFocusTrap: () => null }));

describe("P2PSyncModal", () => {
  let P2PSyncModal: React.FC<{ isOpen: boolean; onClose: () => void }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/sync/P2PSyncModal");
    P2PSyncModal = mod.P2PSyncModal;
  });

  it("returns null when !isOpen", () => {
    const { container } = render(
      <P2PSyncModal isOpen={false} onClose={vi.fn()} />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("shows title when open", () => {
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("Secure P2P Sync")).toBeTruthy();
  });

  it("shows host and client options", () => {
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("This is the host")).toBeTruthy();
    expect(screen.getByText("Link this device")).toBeTruthy();
  });

  it("starts host flow when clicking host", async () => {
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    expect(mockWebRTC.startHost).toHaveBeenCalled();
  });

  it("shows the fallback banner and disables flows when WebRTC is unavailable", async () => {
    stubRTCPeerConnection(false);
    try {
      render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
      expect(
        screen.getByText(
          "WebRTC is not supported by this browser, so P2P sync is unavailable.",
        ),
      ).toBeTruthy();
      const hostButton = screen
        .getByText("This is the host")
        .closest("button");
      const clientButton = screen
        .getByText("Link this device")
        .closest("button");
      expect(hostButton).toBeDisabled();
      expect(clientButton).toBeDisabled();
      await userEvent
        .click(screen.getByText("This is the host"))
        .catch(() => undefined);
      expect(mockWebRTC.startHost).not.toHaveBeenCalled();
    } finally {
      stubRTCPeerConnection(true);
    }
  });

  it("changes state when clicking client", async () => {
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("Link this device"));
    expect(screen.getByText("Secure P2P Sync")).toBeTruthy();
    // Fusionado de src/tests/security/P2PSyncModal.test.tsx: el flujo client
    // must show the QR scanner (preserved coverage branch).
    await waitFor(() =>
      expect(screen.getByLabelText("QR Scanner")).toBeInTheDocument(),
    );
  });

  it("calls onClose when clicking X", async () => {
    const onClose = vi.fn();
    render(<P2PSyncModal isOpen={true} onClose={onClose} />);
    await userEvent.click(screen.getByTestId("icon-X"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows QR when ready_to_share", async () => {
    let stateCb: (s: string) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation((cb: any) => {
      stateCb = cb;
    });
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    stateCb("ready_to_share");
    await waitFor(() =>
      expect(screen.getByTestId("qr-code")).toBeInTheDocument(),
    );
  });

  // ── Fusionado de src/tests/security/P2PSyncModal.test.tsx (branch coverage) ──

  it("disconnects and closes via the close button", async () => {
    const onClose = vi.fn();
    render(<P2PSyncModal isOpen={true} onClose={onClose} />);
    // The Pro service resolves asynchronously after mount; flush so the
    // close path has a service to disconnect.
    await act(async () => {});
    fireEvent.click(screen.getByLabelText("Close"));
    expect(mockWebRTC.disconnect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows spinner in gathering state", async () => {
    let stateCb: (s: string, m?: string) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation((cb: any) => {
      stateCb = cb;
    });
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    stateCb("gathering");
    await waitFor(() =>
      expect(
        screen.getByText("Generating secure tunnel..."),
      ).toBeInTheDocument(),
    );
  });

  it("shows progress bar in syncing state", async () => {
    let stateCb: (s: string) => void = () => {};
    let progressCb: (p: number) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation(
      (scb: any, pcb: any) => {
        stateCb = scb;
        progressCb = pcb;
      },
    );
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    stateCb("syncing");
    progressCb(42);
    await waitFor(() => {
      expect(screen.getByText("Syncing vaults...")).toBeInTheDocument();
      expect(screen.getByText("42%")).toBeInTheDocument();
    });
  });

  it("shows completed state with green check", async () => {
    let stateCb: (s: string) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation((cb: any) => {
      stateCb = cb;
    });
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    stateCb("completed");
    await waitFor(() =>
      expect(screen.getByText("Sync Successful!")).toBeInTheDocument(),
    );
  });

  it("shows error message when syncState is error", async () => {
    let stateCb: (s: string, m?: string) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation((cb: any) => {
      stateCb = cb;
    });
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    stateCb("error", "Connection refused");
    await waitFor(() =>
      expect(screen.getByText("Connection refused")).toBeInTheDocument(),
    );
  });

  it("shows Scan Answer button when host is in ready_to_share", async () => {
    let stateCb: (s: string) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation((cb: any) => {
      stateCb = cb;
    });
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    stateCb("ready_to_share");
    await waitFor(() =>
      expect(screen.getByText("Step 2: Scan answer")).toBeInTheDocument(),
    );
  });

  it("handles startHost error gracefully", async () => {
    mockWebRTC.startHost.mockRejectedValueOnce(new Error("Host start failed"));
    render(<P2PSyncModal isOpen={true} onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("This is the host"));
    await waitFor(() =>
      expect(screen.getByText("Host start failed")).toBeInTheDocument(),
    );
  });

  it("discards service callbacks after unmount", async () => {
    let stateCb: (s: string, m?: string) => void = () => {};
    mockWebRTC.registerCallbacks.mockImplementation((cb: any) => {
      stateCb = cb;
    });
    const { unmount } = render(
      <P2PSyncModal isOpen={true} onClose={vi.fn()} />,
    );
    // Flush the async Pro-service load so callbacks register before
    // unmounting (the component can only disconnect what it loaded).
    await act(async () => {});
    unmount();
    expect(mockWebRTC.disconnect).toHaveBeenCalled();
    // A stale service emission after unmount must be swallowed.
    await act(async () => {
      stateCb("error", "late connection error");
    });
    expect(screen.queryByText("late connection error")).toBeNull();
  });

  it("discards the host flow error after unmount", async () => {
    let rejectHost: (reason: Error) => void;
    mockWebRTC.startHost.mockReturnValueOnce(
      new Promise<string>((_, reject) => {
        rejectHost = reject;
      }),
    );
    const { unmount } = render(
      <P2PSyncModal isOpen={true} onClose={vi.fn()} />,
    );
    await userEvent.click(screen.getByText("This is the host"));
    unmount();
    await act(async () => {
      rejectHost!(new Error("late host failure"));
    });
    expect(screen.queryByText("late host failure")).toBeNull();
  });
});
