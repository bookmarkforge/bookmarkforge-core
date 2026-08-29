import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";

describe("OptimizedSkeleton", () => {
  let Skeleton: any, SkeletonText: any, SkeletonCard: any, SkeletonAvatar: any;

  beforeEach(async () => {
    const mod = await import("../../components/OptimizedSkeleton");
    Skeleton = mod.Skeleton;
    SkeletonText = mod.SkeletonText;
    SkeletonCard = mod.SkeletonCard;
    SkeletonAvatar = mod.SkeletonAvatar;
  });

  describe("Skeleton", () => {
    it("renders a div with skeleton-shimmer class", () => {
      const { container } = render(<Skeleton />);
      expect(
        Array.from(container.children).find((el) => el.tagName !== "STYLE")!
          .className,
      ).toContain("skeleton-shimmer");
    });

    it("applies width and height", () => {
      const { container } = render(<Skeleton width={100} height={50} />);
      const el = Array.from(container.children).find(
        (el) => el.tagName !== "STYLE",
      ) as HTMLElement;
      expect(el.style.width).toBe("100px");
      expect(el.style.height).toBe("50px");
    });

    it("applies borderRadius circle", () => {
      const { container } = render(<Skeleton circle />);
      expect(
        (
          Array.from(container.children).find(
            (el) => el.tagName !== "STYLE",
          ) as HTMLElement
        ).style.borderRadius,
      ).toBe("50%");
    });

    it("renders count elements", () => {
      const { container } = render(<Skeleton count={4} />);
      expect(container.querySelectorAll(".skeleton-shimmer").length).toBe(4);
    });

    it("applies className", () => {
      const { container } = render(<Skeleton className="extra" />);
      expect(
        Array.from(container.children).find((el) => el.tagName !== "STYLE")!
          .className,
      ).toContain("extra");
    });
  });

  describe("SkeletonText", () => {
    it("renders the correct lines", () => {
      const { container } = render(<SkeletonText lines={2} />);
      expect(container.querySelectorAll(".skeleton-shimmer").length).toBe(2);
    });

    it("last line has a smaller width", () => {
      const { container } = render(
        <SkeletonText lines={2} lastLineWidth="50%" />,
      );
      const items = container.querySelectorAll(".skeleton-shimmer");
      expect((items[1] as HTMLElement).style.width).toBe("50%");
    });
  });

  describe("SkeletonCard", () => {
    it("renders with default image", () => {
      const { container } = render(<SkeletonCard />);
      expect(
        container.querySelectorAll(".skeleton-shimmer").length,
      ).toBeGreaterThan(0);
    });
  });

  describe("SkeletonAvatar", () => {
    it("renders circular avatar", () => {
      const { container } = render(<SkeletonAvatar size={50} />);
      expect(
        (
          Array.from(container.children).find(
            (el) => el.tagName !== "STYLE",
          ) as HTMLElement
        ).style.borderRadius,
      ).toBe("50%");
      expect(
        (
          Array.from(container.children).find(
            (el) => el.tagName !== "STYLE",
          ) as HTMLElement
        ).style.width,
      ).toBe("50px");
    });
  });
});
