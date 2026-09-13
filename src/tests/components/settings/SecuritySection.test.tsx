import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s, i18n: { language: "en" } }),
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
    Lock: mock("Lock"),
    Key: mock("Key"),
    Save: mock("Save"),
    Loader2: mock("Loader2"),
    Unlock: mock("Unlock"),
    Shield: mock("Shield"),
    Eye: mock("Eye"),
    Trash2: mock("Trash2"),
    AlertTriangle: mock("AlertTriangle"),
  };
});

const mockSanitize = vi.fn((val: string) => val);
vi.mock("../../../services/SanitizationService", () => ({
  sanitizeUserInput: mockSanitize,
}));

const safeStorage = vi.hoisted(() => ({
  safeGet: vi.fn(),
  safeSet: vi.fn(),
  safeRemove: vi.fn(),
}));
vi.mock("../../../store/safeStorage", () => ({
  safeGet: (k: string) => safeStorage.safeGet(k),
  safeSet: (k: string, v: string) => safeStorage.safeSet(k, v),
  safeRemove: (k: string) => safeStorage.safeRemove(k),
}));

const mockNuclearForget = vi.hoisted(() => vi.fn());
vi.mock("../../../services/NuclearForgetService", () => ({
  nuclearForgetService: { nuclearForget: mockNuclearForget },
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: mockToast, success: vi.fn() } }));

describe("SecuritySection", () => {
  let SecuritySection: React.FC<{
    vaultKey: string;
    setVaultKey: (k: string) => void;
    isUpdatingPassword: boolean;
    onUpdatePassword: () => void;
    autoLockEnabled: boolean;
    setAutoLockEnabled: (e: boolean) => void;
  }>;

  const defaultProps = {
    vaultKey: "",
    setVaultKey: vi.fn(),
    isUpdatingPassword: false,
    onUpdatePassword: vi.fn(),
    autoLockEnabled: false,
    setAutoLockEnabled: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    safeStorage.safeGet.mockReturnValue("false");
    // First-line window.confirm gate: default to accepting so the
    // password form reveals; individual tests override to reject.
    window.confirm = vi.fn(() => true);
    const mod = await import("../../../components/settings/SecuritySection");
    SecuritySection = mod.SecuritySection;
  });

  it("renders master password title", () => {
    render(<SecuritySection {...defaultProps} />);
    expect(screen.getByText("app_masterPassword")).toBeTruthy();
  });

  it("renders password-type input", () => {
    const { getByLabelText } = render(<SecuritySection {...defaultProps} />);
    const input = getByLabelText(
      "app_masterPasswordPlaceholder",
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("password");
  });

  it("shows vault key input", () => {
    render(<SecuritySection {...defaultProps} vaultKey="test-pass" />);
    expect(screen.getByDisplayValue("test-pass")).toBeTruthy();
  });

  it("update button disabled when < 12 chars (MIN_PASSWORD_LENGTH)", () => {
    render(<SecuritySection {...defaultProps} vaultKey="short" />);
    expect(screen.getByText("app_updatePassword")).toBeDisabled();
  });

  it("update button enabled when >= 12 chars (MIN_PASSWORD_LENGTH)", () => {
    render(<SecuritySection {...defaultProps} vaultKey="password12345" />);
    expect(screen.getByText("app_updatePassword")).not.toBeDisabled();
  });

  it("calls onUpdatePassword when clicked", async () => {
    const onUpdate = vi.fn();
    render(
      <SecuritySection {...defaultProps} vaultKey="password12345" onUpdatePassword={onUpdate} />,
    );
    await userEvent.click(screen.getByText("app_updatePassword"));
    expect(onUpdate).toHaveBeenCalled();
  });

  it("passes the password unsanitized (H-01: do not corrupt the password)", () => {
    const setVaultKey = vi.fn();
    render(<SecuritySection {...defaultProps} setVaultKey={setVaultKey} />);
    const input = screen.getByLabelText(
      "app_masterPasswordPlaceholder",
    ) as HTMLInputElement;
    // A password containing characters a sanitizer would rewrite (and
    // leading/trailing spaces a trim() would strip) must reach setVaultKey
    // byte-identical — vault unlock compares exact bytes.
    const tricky = ' pa<ss>&\"word-\\n`x` ';
    fireEvent.change(input, { target: { value: tricky } });
    expect(setVaultKey).toHaveBeenCalledWith(tricky);
    expect(mockSanitize).not.toHaveBeenCalled();
  });

  it("renders auto-lock toggle and changes state", async () => {
    const setAutoLockEnabled = vi.fn();
    render(
      <SecuritySection
        {...defaultProps}
        setAutoLockEnabled={setAutoLockEnabled}
      />,
    );
    await userEvent.click(screen.getByLabelText("app_disableAutoLockLabel"));
    expect(setAutoLockEnabled).toHaveBeenCalledWith(true);
  });

  it("persists the telemetry opt-in only to the error-reporting scope", () => {
    render(<SecuritySection {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("app_telemetryOptInLabel"));
    // The legacy settings shortcut is intentionally limited to the
    // error-reporting purpose; analytics and client events need their own
    // explicit choices in the consent banner.
    expect(safeStorage.safeSet).toHaveBeenCalledWith(
      "forge_consent_error_reporting",
      "true",
    );
    expect(safeStorage.safeSet).not.toHaveBeenCalledWith(
      "forge_consent_analytics",
      "true",
    );
    expect(safeStorage.safeSet).not.toHaveBeenCalledWith(
      "forge_consent_client_events",
      "true",
    );
    // Legacy keys are cleared so a stale "true" cannot resurface an opt-in
    // the user just turned off.
    expect(safeStorage.safeRemove).toHaveBeenCalledWith("bmf_local_error_storage");
    expect(safeStorage.safeRemove).toHaveBeenCalledWith("bmf_telemetry_optin");
  });

  // ── Danger Zone / Nuclear Forget ─────────────────────────────────────

  it("renders the Danger Zone block", () => {
    render(<SecuritySection {...defaultProps} />);
    expect(screen.getByText("app_dangerZone")).toBeTruthy();
    expect(screen.getByText("app_nuclearForgetTitle")).toBeTruthy();
  });

  it("does not reveal the form if the user cancels the first confirm", async () => {
    window.confirm = vi.fn(() => false);
    render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    expect(window.confirm).toHaveBeenCalled();
    expect(
      screen.queryByLabelText("app_nuclearForgetPassword"),
    ).toBeNull();
  });

  it("shows the password confirm when pressing Erase everything", async () => {
    render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    expect(
      screen.getByLabelText("app_nuclearForgetPassword"),
    ).toBeTruthy();
    expect(screen.getByText("app_nuclearForgetConfirm")).toBeTruthy();
    expect(screen.getByText("app_cancel")).toBeTruthy();
  });

  it("disables Confirm erase without a password", async () => {
    render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    expect(screen.getByText("app_nuclearForgetConfirm")).toBeDisabled();
  });

  it("calls nuclearForget with password and confirm when confirming", async () => {
    // Success path calls window.location.reload() (browser side-effect
    // covered by the E2E spec) — here we assert the service contract only.
    mockNuclearForget.mockResolvedValue({ wiped: [], failed: [] });
    render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    await userEvent.type(
      screen.getByLabelText("app_nuclearForgetPassword"),
      "master-pass",
    );
    await userEvent.click(screen.getByText("app_nuclearForgetConfirm"));
    expect(mockNuclearForget).toHaveBeenCalledWith({
      password: "master-pass",
      confirm: true,
    });
  });

  it("shows error toast if nuclearForget fails", async () => {
    mockNuclearForget.mockRejectedValue(new Error("wrong password"));
    render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    await userEvent.type(
      screen.getByLabelText("app_nuclearForgetPassword"),
      "wrong",
    );
    await userEvent.click(screen.getByText("app_nuclearForgetConfirm"));
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalled());
  });

  it("cancels and clears the form when pressing Cancel", async () => {
    render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    await userEvent.type(
      screen.getByLabelText("app_nuclearForgetPassword"),
      "abc",
    );
    await userEvent.click(screen.getByText("app_cancel"));
    expect(
      screen.queryByLabelText("app_nuclearForgetPassword"),
    ).toBeNull();
  });

  it("ignores a nuclearForget failure after unmount (no toast)", async () => {
    let rejectForget: (e: Error) => void = () => {};
    mockNuclearForget.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectForget = reject;
        }),
    );
    const { unmount } = render(<SecuritySection {...defaultProps} />);
    await userEvent.click(screen.getByText("app_nuclearForgetAction"));
    await userEvent.type(
      screen.getByLabelText("app_nuclearForgetPassword"),
      "wrong",
    );
    await userEvent.click(screen.getByText("app_nuclearForgetConfirm"));
    await vi.waitFor(() => expect(mockNuclearForget).toHaveBeenCalled());
    unmount();
    rejectForget(new Error("wrong password"));
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockToast).not.toHaveBeenCalled();
  });
});
