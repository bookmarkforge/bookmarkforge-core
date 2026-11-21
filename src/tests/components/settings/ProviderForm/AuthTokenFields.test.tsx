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
  return { Key: mock("Key") };
});

const mockT = vi.fn(
  (key: string, options?: any) => options?.defaultValue || key,
);

describe("AuthTokenFields", () => {
  let AuthTokenFields: React.FC<{
    authToken: string;
    onChange: (v: string) => void;
    t: any;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod =
      await import("../../../../components/settings/ProviderForm/AuthTokenFields");
    AuthTokenFields = mod.AuthTokenFields;
  });

  it("renders label", () => {
    render(<AuthTokenFields authToken="" onChange={vi.fn()} t={mockT} />);
    expect(screen.getByText("accessTokenKey")).toBeTruthy();
  });

  it("shows the current value", () => {
    render(
      <AuthTokenFields authToken="tok_123" onChange={vi.fn()} t={mockT} />,
    );
    expect(screen.getByDisplayValue("tok_123")).toBeTruthy();
  });

  it("calls onChange en input", () => {
    const onChange = vi.fn();
    render(<AuthTokenFields authToken="" onChange={onChange} t={mockT} />);
    fireEvent.change(screen.getByLabelText("accessTokenKey"), {
      target: { value: "new-token" },
    });
    expect(onChange).toHaveBeenCalledWith("new-token");
  });
});
