import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SRSReviewCard } from "../../../components/dashboard/components/SRSReviewCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

describe("SRSReviewCard", () => {
  it("renders title and description with counter", () => {
    const { getByText } = render(
      <SRSReviewCard dueCardsCount={5} onStartReview={vi.fn()} />,
    );
    expect(getByText("app_srsDueTitle")).toBeTruthy();
    expect(getByText("app_srsDueDesc")).toBeTruthy();
  });

  it("calls onStartReview when clicked", async () => {
    const onStart = vi.fn();
    const { container } = render(
      <SRSReviewCard dueCardsCount={3} onStartReview={onStart} />,
    );
    await userEvent.click(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!,
    );
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("llama onStartReview con Enter", () => {
    const onStart = vi.fn();
    const { container } = render(
      <SRSReviewCard dueCardsCount={3} onStartReview={onStart} />,
    );
    fireEvent.keyDown(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!,
      { key: "Enter" },
    );
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("llama onStartReview con Space", () => {
    const onStart = vi.fn();
    const { container } = render(
      <SRSReviewCard dueCardsCount={3} onStartReview={onStart} />,
    );
    fireEvent.keyDown(
      Array.from(container.children).find((el) => el.tagName !== "STYLE")!,
      { key: " " },
    );
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("has role button and tabIndex 0", () => {
    const { container } = render(
      <SRSReviewCard dueCardsCount={0} onStartReview={vi.fn()} />,
    );
    const el = Array.from(container.children).find(
      (el) => el.tagName !== "STYLE",
    )!;
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("tabindex")).toBe("0");
  });
});
