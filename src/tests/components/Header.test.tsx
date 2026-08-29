import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";

const mockI18n = vi.hoisted(() => ({
  language: "en",
  on: vi.fn(),
  off: vi.fn(),
  changeLanguage: vi.fn(),
}));

const mockSetForceSetup = vi.hoisted(() => vi.fn());

const mockPWAInstall = vi.hoisted(() => ({
  isInstallable: false,
  installPWA: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const t = (s: string) => s;
    return { t, i18n: mockI18n };
  },
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => ({ setForceSetup: mockSetForceSetup }),
}));

vi.mock("../../hooks/usePWAInstall", () => ({
  usePWAInstall: () => mockPWAInstall,
}));

vi.mock("../../components/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = ({ className, ...props }: any) => (
      <svg data-testid={`icon-${name}`} className={className} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Search: mock("Search"),
    Settings: mock("Settings"),
    Lock: mock("Lock"),
    Globe: mock("Globe"),
    Download: mock("Download"),
    Volume2: mock("Volume2"),
    VolumeX: mock("VolumeX"),
  };
});

const mockToastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: mockToastInfo } }));

describe("Header", () => {
  let Header: React.FC<any>;
  const setActiveTab = vi.fn();
  const onOpenSearch = vi.fn();
  const onOpenSettings = vi.fn();
  const defaultProps = {
    isDark: false,
    theme: "light" as const,
    toggleTheme: vi.fn(),
    setThemeMode: vi.fn(),
    onOpenSettings,
    onOpenSearch,
    aiStatus: {
      provider: "local",
      model: "llama",
      isLocal: true,
      isConfigured: true,
    },
  };

  beforeEach(async () => {
    cleanup();
    vi.clearAllMocks();
    mockI18n.language = "en";
    mockPWAInstall.isInstallable = false;
    const mod = await import("../../components/Header");
    Header = (props: any) => (
      <MantineProvider>
        <mod.Header {...props} />
      </MantineProvider>
    );
  });

  it("renders without crashing", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
  });

  it("calls onOpenSearch on search click", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByTitle("app_search"));
    expect(onOpenSearch).toHaveBeenCalled();
  });

  it("calls onOpenSearch on search Enter key", async () => {
    render(<Header {...defaultProps} />);
    screen.getByTitle("app_search").focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenSearch).toHaveBeenCalled();
  });

  it("calls onOpenSettings on settings click", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByTestId("settings-button"));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("calls onOpenSettings on settings Enter key", async () => {
    render(<Header {...defaultProps} />);
    screen.getByTestId("settings-button").focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("shows AI badge as configured local", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText("llama")).toBeTruthy();
  });

  it("shows AI badge as configured non-local", () => {
    render(
      <Header
        {...{
          ...defaultProps,
          aiStatus: {
            provider: "openai",
            model: "gpt-4",
            isLocal: false,
            isConfigured: true,
          },
        }}
      />,
    );
    expect(screen.getByText("gpt-4")).toBeTruthy();
  });

  it("shows AI badge as disconnected", () => {
    render(
      <Header
        {...{
          ...defaultProps,
          aiStatus: {
            provider: "",
            model: "",
            isLocal: false,
            isConfigured: false,
          },
        }}
      />,
    );
    expect(screen.getByText(/app_disconnected/i)).toBeTruthy();
  });

  it("opens and closes language selector", async () => {
    render(<Header {...defaultProps} />);
    expect(screen.queryByText("English")).toBeNull();
    await userEvent.click(screen.getByLabelText("app_language"));
    expect(screen.getByText("English")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("English")).toBeNull();
  });

  it("changes language on item click", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_language"));
    await userEvent.click(screen.getByText("Deutsch"));
    expect(mockI18n.changeLanguage).toHaveBeenCalledWith("de");
  });

  it("changes language on item Enter key", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_language"));
    const item = screen.getByText("Italiano").closest("button")!;
    item.focus();
    await userEvent.keyboard("{Enter}");
    expect(mockI18n.changeLanguage).toHaveBeenCalledWith("it");
  });

  it("shows checkmark for the current language", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_language"));
    expect(screen.getByText("app_selected")).toBeTruthy();
  });

  // NOTE: `i18n.on('languageChanged')` subscription tests were removed.
  // LanguageSelector intentionally relies on useTranslation()'s reactive
  // re-render (see src/components/LanguageSelector.tsx), so the component
  // no longer registers a manual subscription to i18n.on/off.

  it("renders ThemeToggle", () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId("theme-toggle")).toBeTruthy();
  });

  it("renders divider on desktop", () => {
    render(<Header {...defaultProps} />);
    const dividers = document.querySelectorAll(".w-px");
    expect(dividers.length).toBeGreaterThan(0);
  });

  it("shows install button when installable", () => {
    mockPWAInstall.isInstallable = true;
    render(<Header {...defaultProps} />);
    expect(screen.getByLabelText("app_installApp")).toBeTruthy();
  });

  it("hides install button when not installable", () => {
    mockPWAInstall.isInstallable = false;
    render(<Header {...defaultProps} />);
    expect(screen.queryByLabelText("app_installApp")).toBeNull();
  });

  it("locks vault after accessible confirmation", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_lockVault"));
    await userEvent.click(screen.getByRole("button", { name: "app_confirm" }));
    expect(mockSetForceSetup).toHaveBeenCalledWith(true);
    expect(mockToastInfo).toHaveBeenCalled();
  });

  it("cancels vault lock from the dialog", async () => {
    render(<Header {...defaultProps} />);
    await userEvent.click(screen.getByLabelText("app_lockVault"));
    await userEvent.click(screen.getByRole("button", { name: "app_cancel" }));
    expect(mockSetForceSetup).not.toHaveBeenCalled();
  });

  it("opens the confirmation dialog on lock button Enter key", async () => {
    render(<Header {...defaultProps} />);
    screen.getByLabelText("app_lockVault").focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "app_confirm" })).toBeTruthy();
    expect(mockSetForceSetup).not.toHaveBeenCalled();
  });
});
