import { describe, it, expect, vi, afterEach } from "vitest";
import { downloadBlob } from "../../utils/download";

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("revokes the ObjectURL even when clicking the download fails", () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    const anchor = {
      setAttribute: vi.fn(),
      click: vi.fn(() => {
        throw new Error("navigation failed");
      }),
    };
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL,
    });
    vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

    expect(() => downloadBlob(new Blob(["data"]), "export.txt")).toThrow(
      "navigation failed",
    );
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("sets the filename and revokes the URL after a successful click", () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const anchor = {
      setAttribute: vi.fn(),
      click,
    };
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:success"),
      revokeObjectURL,
    });
    vi.spyOn(document, "createElement").mockReturnValue(anchor as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    vi.spyOn(document.body, "removeChild").mockImplementation((node) => node);

    downloadBlob(new Blob(["data"]), "export.txt");
    vi.runAllTimers();

    expect(anchor.setAttribute).toHaveBeenCalledWith("download", "export.txt");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:success");
  });
});
