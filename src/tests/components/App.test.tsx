import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("../../hooks/useReducedMotion", () => ({
  useReducedMotion: () => false,
}));
vi.mock("../../components/AppInitializer", () => ({
  AppInitializer: () => <div>Initializer</div>,
}));
vi.mock("../../components/app", () => ({
  AppContent: () => <div>AppContent</div>,
}));
vi.mock("../../components/app/CaptureApp", () => ({
  CaptureApp: () => <div>CaptureApp</div>,
}));
vi.mock("../../components/ErrorBoundary", () => ({
  ErrorBoundaryWrapper: ({ children }: any) => <>{children}</>,
}));
vi.mock("@mantine/core", () => ({
  MantineProvider: ({ children }: any) => <>{children}</>,
  createTheme: (t: any) => t,
}));
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

describe("App", () => {
  it("should render without crashing", async () => {
    const App = (await import("../../App")).default;
    const { container } = render(<App />);
    expect(container).toBeTruthy();
  });
});
