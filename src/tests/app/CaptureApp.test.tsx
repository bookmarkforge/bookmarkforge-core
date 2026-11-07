import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
const mockSecurityStore = vi.hoisted(() => ({
  isLocked: false,
  forceSetup: false,
}));
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => mockSecurityStore,
}));
vi.mock("../../components/Capture", () => ({
  Capture: () => <div data-testid="capture">Capture</div>,
}));
vi.mock("../../components/SecurityManager", () => ({
  SecurityManager: () => (
    <div data-testid="security-manager">SecurityManager</div>
  ),
}));

const { CaptureApp } = await import("../../components/app/CaptureApp");

describe("CaptureApp", () => {
  afterEach(() => {
    localStorage.removeItem("forge_has_master_password");
  });

  it("renders Capture when unlocked", () => {
    mockSecurityStore.isLocked = false;
    mockSecurityStore.forceSetup = false;
    const { getByTestId } = render(<CaptureApp />);
    expect(getByTestId("capture")).toBeTruthy();
  });

  it("renders SecurityManager when locked with password", () => {
    localStorage.setItem("forge_has_master_password", "true");
    mockSecurityStore.isLocked = true;
    mockSecurityStore.forceSetup = false;
    const { getByTestId } = render(<CaptureApp />);
    expect(getByTestId("security-manager")).toBeTruthy();
  });
});
