import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const runNow = vi.fn().mockResolvedValue({ status: "completed", repaired: 2, failed: 0, skipped: 0, operations: [], report: { issues: [] } });
const setEnabled = vi.fn();
const subscribe = vi.fn(() => () => {});
const getStatus = vi.fn(() => ({ enabled: true, waitingForIdle: false, isRunning: false, lastRunAt: null, lastResult: null, consecutiveFailures: 0, pausedUntil: null, lastSkippedReason: null }));
const getHistory = vi.fn(() => []);

vi.mock("../../../services/ai/IntelligentMaintenanceService", () => ({
  intelligentMaintenanceService: { runNow, setEnabled, subscribe, getStatus, getHistory },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
vi.mock("lucide-react", () => ({
  BrainCircuit: () => <svg />,
  Loader2: () => <svg />,
  ShieldCheck: () => <svg />,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, fallbackOrOptions?: unknown) => typeof fallbackOrOptions === "string" ? fallbackOrOptions : (_key) }) }));

describe("IntelligentMaintenanceSection", () => {
  it("toggles automatic maintenance and runs a manual check", async () => {
    const { IntelligentMaintenanceSection } = await import("../../../components/settings/IntelligentMaintenanceSection");
    render(<IntelligentMaintenanceSection />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole("button", { name: /Check and repair now/i }));
    expect(runNow).toHaveBeenCalledTimes(1);
  });
});
