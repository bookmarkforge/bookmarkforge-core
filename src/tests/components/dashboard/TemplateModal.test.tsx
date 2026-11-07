import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplateModal } from "../../../components/dashboard/components/TemplateModal";

vi.mock("react-i18next", (() => ({
  useTranslation: () => ({ t: (s: string) => s }),
})) as any);

const mockTemplates: any[] = [
  {
    id: "1",
    name: "Template A",
    description: "Desc A",
    tags: ["tag1", "tag2"],
  },
  { id: "2", name: "Template B", description: "Desc B", tags: ["tag3"] },
];

describe("TemplateModal", () => {
  it("renders when show is true", () => {
    const { getByText } = render(
      <TemplateModal
        show={true}
        templates={mockTemplates}
        onClose={vi.fn()}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    expect(getByText("app_templates")).toBeTruthy();
  });

  it("shows the templates", () => {
    const { getByText } = render(
      <TemplateModal
        show={true}
        templates={mockTemplates}
        onClose={vi.fn()}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    expect(getByText("Template A")).toBeTruthy();
    expect(getByText("Template B")).toBeTruthy();
    expect(getByText("Desc A")).toBeTruthy();
    expect(getByText("Desc B")).toBeTruthy();
  });

  it("does not render when show is false", () => {
    const { container } = render(
      <TemplateModal
        show={false}
        templates={mockTemplates}
        onClose={vi.fn()}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("calls onCreateFromTemplate when clicking a template", async () => {
    const onCreate = vi.fn();
    const { getByText } = render(
      <TemplateModal
        show={true}
        templates={mockTemplates}
        onClose={vi.fn()}
        onCreateFromTemplate={onCreate}
      />,
    );
    await userEvent.click(getByText("Template A"));
    expect(onCreate).toHaveBeenCalledWith(mockTemplates[0]);
  });

  it("shows template tags", () => {
    const templates = [
      {
        id: "1",
        name: "T1",
        description: "D1",
        category: "general",
        content: [],
        icon: "FileText",
        tags: ["tag1", "tag2"],
      },
    ];
    const { getByText } = render(
      <TemplateModal
        show={true}
        templates={templates}
        onClose={vi.fn()}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    expect(getByText("tag1")).toBeTruthy();
    expect(getByText("tag2")).toBeTruthy();
  });

  it("calls onClose when clicking the backdrop", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TemplateModal
        show={true}
        templates={mockTemplates}
        onClose={onClose}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    const backdrop = Array.from(container.children).find(
      (el) => el.tagName !== "STYLE",
    )!;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking the X button", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TemplateModal
        show={true}
        templates={mockTemplates}
        onClose={onClose}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    const buttons = container.querySelectorAll("button");
    const closeBtn = buttons[0];
    await userEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not propagate clicks from the modal to the backdrop", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <TemplateModal
        show={true}
        templates={mockTemplates}
        onClose={onClose}
        onCreateFromTemplate={vi.fn()}
      />,
    );
    const modalPanel = container.querySelector('[class*="max-w-4xl"]')!;
    await userEvent.click(modalPanel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
