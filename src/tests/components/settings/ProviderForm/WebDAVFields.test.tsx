import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
  return { Globe: mock("Globe") };
});

const mockT = vi.fn(
  (key: string, options?: any) => options?.defaultValue || key,
);

describe("WebDAVFields", () => {
  let WebDAVFields: React.FC<{
    url: string;
    username: string;
    password: string;
    onUrlChange: (v: string) => void;
    onUsernameChange: (v: string) => void;
    onPasswordChange: (v: string) => void;
    t: any;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../../components/settings/ProviderForm/WebDAVFields");
    WebDAVFields = mod.WebDAVFields;
  });

  it("renders URL label", () => {
    render(
      <WebDAVFields
        url=""
        username=""
        password=""
        onUrlChange={vi.fn()}
        onUsernameChange={vi.fn()}
        onPasswordChange={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("webdavUrlLabel")).toBeTruthy();
  });

  it("shows current values", () => {
    render(
      <WebDAVFields
        url="https://example.com"
        username="user"
        password="pass"
        onUrlChange={vi.fn()}
        onUsernameChange={vi.fn()}
        onPasswordChange={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByDisplayValue("https://example.com")).toBeTruthy();
    expect(screen.getByDisplayValue("user")).toBeTruthy();
    expect(screen.getByDisplayValue("pass")).toBeTruthy();
  });

  it("calls onUrlChange", () => {
    const fn = vi.fn();
    render(
      <WebDAVFields
        url=""
        username=""
        password=""
        onUrlChange={fn}
        onUsernameChange={vi.fn()}
        onPasswordChange={vi.fn()}
        t={mockT}
      />,
    );
    fireEvent.change(screen.getByLabelText("webdavUrlLabel"), {
      target: { value: "new-url" },
    });
    expect(fn).toHaveBeenCalledWith("new-url");
  });

  it("calls onPasswordChange", () => {
    const fn = vi.fn();
    render(
      <WebDAVFields
        url=""
        username=""
        password=""
        onUrlChange={vi.fn()}
        onUsernameChange={vi.fn()}
        onPasswordChange={fn}
        t={mockT}
      />,
    );
    fireEvent.change(screen.getByLabelText("passwordLabel"), {
      target: { value: "new-pass" },
    });
    expect(fn).toHaveBeenCalledWith("new-pass");
  });
});
