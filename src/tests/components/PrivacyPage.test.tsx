import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrivacyPage } from "../../components/PrivacyPage";

// PrivacyPage only needs i18n (initialized globally in setup.ts) and lucide
// icons, which render fine in jsdom. The same strings exist as translation
// fallbacks, so assertions below are stable regardless of locale loading.

describe("PrivacyPage", () => {
  it("renders the privacy policy and terms headings", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Privacy Policy & Terms of Service",
    );
    expect(
      screen.getByRole("heading", { name: "Privacy Policy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Terms of Service" }),
    ).toBeInTheDocument();
  });

  it("renders the back button with an accessible label and calls onBack", () => {
    const onBack = vi.fn();
    render(<PrivacyPage onBack={onBack} />);

    const back = screen.getByRole("button", { name: "Back to app" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders the contact email as a mailto link", () => {
    render(<PrivacyPage />);
    const links = screen.getAllByRole("link", {
      name: /bookmarkforge@proton\.me/,
    });
    // One link in the privacy section and one in the terms section.
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "mailto:bookmarkforge@proton.me");
    }
  });

  it("renders key policy sections (data, encryption, rights)", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { name: "2. Data We Do NOT Collect" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "4. Encryption" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "6. Your Rights" }),
    ).toBeInTheDocument();
  });

  it("renders the terms sections", () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole("heading", { name: "3. Local-First Nature" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "5. Limitation of Liability" }),
    ).toBeInTheDocument();
  });
});
