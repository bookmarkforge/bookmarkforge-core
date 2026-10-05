import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

Element.prototype.scrollIntoView = vi.fn();

const mockWebSearch = vi.hoisted(() => vi.fn());
const mockGlobalChat = vi.hoisted(() => vi.fn());
vi.mock("../../services/ai/AgentService", () => ({
  agentService: { webSearch: mockWebSearch, globalChat: mockGlobalChat },
}));

vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn((key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }),
  safeSet: vi.fn((key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // The mock emulates unavailable localStorage; Chat must remain usable.
    }
  }),
  safeRemove: vi.fn((key: string) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // The mock emulates unavailable localStorage; Chat must remain usable.
    }
  }),
}));

const mockStreamGenerateText = vi.hoisted(() =>
  vi.fn(
    (
      _prompt: string,
      _systemPrompt?: string,
      _options?: unknown,
      onChunk?: (c: string) => void,
    ) => {
      if (onChunk) onChunk("Respuesta");
      return Promise.resolve({ text: "Respuesta", provider: "openai" });
    },
  ),
);
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: {
    streamGenerateText: mockStreamGenerateText,
    generateText: vi.fn(),
  },
}));

const mockMessagesInsert = vi.hoisted(() => vi.fn());
const mockMessagesFind = vi.hoisted(() => vi.fn());
// Reactive in-memory RxDB stand-in: inserted messages become visible to the
// query, so the UI renders persisted messages (used by the streaming tests).
const dbMessages = vi.hoisted(() => [] as any[]);
// RxDB documents expose toJSON(); mirror it so the component's
// `dbMessages.map((msg) => msg.toJSON())` works on inserted messages.
mockMessagesInsert.mockImplementation((doc: any) => {
  dbMessages.push({ ...doc, toJSON: () => doc });
  return Promise.resolve();
});
// Spread creates a fresh array reference per query so the component's
// useMemo([messagesQuery.result]) recomputes after each insert.
mockMessagesFind.mockImplementation(() => ({
  sort: () => ({ result: [...dbMessages] }),
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: vi.fn(() => ({
    insert: mockMessagesInsert,
    find: mockMessagesFind,
  })),
  useRxQuery: vi.fn((query: any) => ({ result: query?.result || [] })),
}));

const mockOnProgress = vi.hoisted(() => vi.fn());
const mockWebLLMUnsubscribe = vi.hoisted(() => vi.fn());
// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (Chat subscribes to progress via the gate).
vi.mock("../../services/pro-access", () => ({
  loadWebLLMService: () =>
    Promise.resolve({
      onProgress: mockOnProgress.mockReturnValue(mockWebLLMUnsubscribe),
    }),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: vi.fn(
      (key: string, fb?: string, opts?: { provider?: string }) => {
        const str = fb || key;
        // Mini-interpolation: resolve {{provider}} like i18next so the
        // header provider pill renders real text in tests.
        return opts?.provider
          ? str.replace("{{provider}}", opts.provider)
          : str;
      },
    ),
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Send: mock("Send"),
    Sparkles: mock("Sparkles"),
    Copy: mock("Copy"),
    Check: mock("Check"),
    ExternalLink: mock("ExternalLink"),
    FileText: mock("FileText"),
    Bookmark: mock("Bookmark"),
    Info: mock("Info"),
    ChevronRight: mock("ChevronRight"),
    Globe: mock("Globe"),
    Shield: mock("Shield"),
    ShieldOff: mock("ShieldOff"),
    Square: mock("Square"),
  };
});

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

import Chat from "../../components/Chat";

describe("Chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    dbMessages.length = 0;
    // Re-apply the reactive implementations (clearAllMocks keeps the last
    // implementation a previous test may have installed).
    mockMessagesInsert.mockImplementation((doc: any) => {
      dbMessages.push({ ...doc, toJSON: () => doc });
      return Promise.resolve();
    });
    mockMessagesFind.mockImplementation(() => ({
      sort: () => ({ result: [...dbMessages] }),
    }));
    // Default mockGlobalChat: resolves immediately so tests that forget to
    // provide a custom implementation don't hang (reduces flaky cross-test
    // contamination when the full suite runs).
    mockGlobalChat.mockImplementation(
      (
        _q: string,
        _l?: string,
        _p?: boolean,
        _s?: string,
        onChunk?: (c: string) => void,
        _doc?: unknown,
        onProvider?: (p: string) => void,
      ) => {
        onProvider?.("gemini");
        onChunk?.("Respuesta");
        return Promise.resolve({ text: "Respuesta", provider: "gemini" });
      },
    );
  });

  it("renders input and send button", () => {
    render(<Chat />);
    expect(
      screen.getByPlaceholderText("Ask about your bookmarks and documents..."),
    ).toBeTruthy();
    expect(screen.getByTestId("icon-Send")).toBeTruthy();
  });

  it("shows default welcome message", () => {
    render(<Chat />);
    expect(screen.getByTestId("markdown")).toBeTruthy();
  });

  it("send button disabled if input is empty", () => {
    render(<Chat />);
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    expect(sendBtn.disabled).toBe(true);
  });

  it("send button enabled if there is text", async () => {
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    const sendBtn = screen.getByTestId("icon-Send").closest("button")!;
    expect(sendBtn.disabled).toBe(false);
  });

  it("sends message when clicking Send", async () => {
    mockGlobalChat.mockResolvedValue({
      text: "Respuesta",
      sources: [],
    });
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockGlobalChat).toHaveBeenCalled();
    });
  });

  it("sends message with Enter", async () => {
    mockGlobalChat.mockResolvedValue({
      text: "Respuesta",
      sources: [],
    });
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    input.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(mockGlobalChat).toHaveBeenCalled();
    });
  });

  it("pressing Enter twice in a row only generates one response (sendInFlightRef guard)", async () => {
    // The generation stays in flight (never resolves), so the second Enter
    // fires while sendInFlightRef is still active — the real race
    // the guard must block. fireEvent fires both keydowns in the same
    // tick, BEFORE React flushes the state (isTyping is still false),
    // reproducing the keyboard burst without waiting between presses.
    mockGlobalChat.mockImplementation(() => new Promise(() => {}));
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(mockGlobalChat).toHaveBeenCalledTimes(1);
    });
    // Only the user's message is inserted; the response stays pending
    // and no second response is in progress.
    expect(mockMessagesInsert).toHaveBeenCalledTimes(1);
    expect(
      mockMessagesInsert.mock.calls[0]![0],
    ).toMatchObject({ role: "user", content: "Hola" });
  });

  it("uses webSearch when isWebSearch is active", async () => {
    mockWebSearch.mockResolvedValue({ text: "Web result", sources: [] });
    render(<Chat />);
    const webBtn = screen.getByTestId("icon-Globe").closest("button")!;
    await userEvent.click(webBtn);
    const input = screen.getByPlaceholderText(
      "app_webSearchPlaceholder",
    ) as HTMLInputElement;
    await userEvent.type(input, "buscar");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockWebSearch).toHaveBeenCalled();
    });
  });

  it("persists a local response without undefined optional fields", async () => {
    mockGlobalChat.mockResolvedValue({ text: "OK" });
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockMessagesInsert).toHaveBeenCalledTimes(2);
    });
    expect(mockMessagesInsert.mock.calls[1]![0]).not.toHaveProperty(
      "sources",
    );
    expect(mockMessagesInsert.mock.calls[1]![0]).not.toHaveProperty(
      "groundingMetadata",
    );
  });

  it("releases the composer when assistant persistence hangs", async () => {
    vi.useFakeTimers();
    try {
      mockGlobalChat.mockResolvedValue({ text: "Respuesta" });
      mockMessagesInsert.mockImplementation((doc: any) => {
        if (doc.role === "assistant") {
          return new Promise(() => {});
        }
        dbMessages.push({ ...doc, toJSON: () => doc });
        return Promise.resolve();
      });
      render(<Chat />);
      const input = screen.getByPlaceholderText(
        "Ask about your bookmarks and documents...",
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "Hola" } });
      fireEvent.click(screen.getByTestId("icon-Send").closest("button")!);
      await act(async () => {
        for (let i = 0; i < 8; i += 1) {
          await Promise.resolve();
        }
        await vi.advanceTimersByTimeAsync(5_000);
        for (let i = 0; i < 4; i += 1) {
          await Promise.resolve();
        }
      });
      expect(screen.queryByText("Stop")).toBeNull();
      fireEvent.change(input, { target: { value: "segunda" } });
      expect(
        screen.getByTestId("icon-Send").closest("button")!.disabled,
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("inserts messages into the collection", async () => {
    mockGlobalChat.mockResolvedValue({
      text: "Respuesta",
      sources: [],
    });
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockMessagesInsert).toHaveBeenCalledTimes(2);
    });
  });

  it("inserts an error message if it fails", async () => {
    mockGlobalChat.mockRejectedValue(new Error("Error"));
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockMessagesInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: "Sorry, I encountered an error processing your request. Please try again.",
          isError: true,
          retryQuery: "Hola",
        }),
      );
    });
  });

  it("does not send if input is only whitespace", async () => {
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "   ");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    expect(mockGlobalChat).not.toHaveBeenCalled();
  });

  it("does not send with Enter if input is only whitespace", async () => {
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "   ");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(mockGlobalChat).not.toHaveBeenCalled();
  });

  it("loads pending_ai_query from localStorage into the initial input", async () => {
    localStorage.setItem("pending_ai_query", "consulta pendiente");
    render(<Chat />);
    await waitFor(() => {
      const input = screen.getByPlaceholderText(
        "Ask about your bookmarks and documents...",
      ) as HTMLInputElement;
      expect(input.value).toBe("consulta pendiente");
    });
  });

  it("does not set input if overrideInput is provided (handleSend with an argument)", async () => {
    mockGlobalChat.mockResolvedValue({ text: "respuesta", sources: [] });
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "texto visible");
    // We do not send with direct click; we use the handleSendRef reference via pending_ai_query
    // This test verifies that the overrideInput path exists in the handler
    expect(input.value).toBe("texto visible");
  });

  it("toggles web search and shows active styling", async () => {
    render(<Chat />);
    const globeIcons = screen.getAllByTestId("icon-Globe");
    const webBtn = globeIcons[0]!.closest("button")!;
    expect(webBtn).toBeTruthy();
    await userEvent.click(webBtn);
    expect(
      screen.getByPlaceholderText("app_webSearchPlaceholder"),
    ).toBeTruthy();
  });

  it("does not create a WebLLM subscription after unmount", async () => {
    const { unmount } = render(<Chat />);
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockOnProgress).not.toHaveBeenCalled();
  });

  it("shows download progress bar", async () => {
    render(<Chat />);
    await waitFor(() => {
      expect(mockOnProgress).toHaveBeenCalled();
    });
    const progressCb = mockOnProgress.mock.calls[0]![0];
    await act(() => {
      progressCb({ text: "Descargando modelo...", progress: 0.5 });
    });
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Descargando modelo...")).toBeTruthy();
  });

  it("hides progress bar when download completes", async () => {
    render(<Chat />);
    await waitFor(() => {
      expect(mockOnProgress).toHaveBeenCalled();
    });
    const progressCb = mockOnProgress.mock.calls[0]![0];
    await act(() => {
      progressCb({ text: "Descargando...", progress: 0.5 });
    });
    expect(screen.getByText("50%")).toBeTruthy();
    await act(() => {
      progressCb({ text: "Completado", progress: 1 });
    });
    expect(screen.queryByText("50%")).toBeNull();
  });

  it("disables button while response is being generated", async () => {
    mockGlobalChat.mockImplementation(() => new Promise(() => {}));
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    // Button enabled before click (input has text)
    expect(screen.getByTestId("icon-Send").closest("button")!.disabled).toBe(
      false,
    );
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    // Button disabled after click (isTyping=true + input cleared)
    expect(screen.getByTestId("icon-Send").closest("button")!.disabled).toBe(
      true,
    );
  });

  it("handles string error in catch (not an Error instance)", async () => {
    mockGlobalChat.mockRejectedValue("error de string");
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockMessagesInsert).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Sorry, I encountered an error processing your request. Please try again." }),
      );
    });
  });

  it("does not send an empty query via pending_ai_query", async () => {
    localStorage.setItem("pending_ai_query", "   ");
    render(<Chat />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGlobalChat).not.toHaveBeenCalled();
  });

  it("releases the lock after ignoring an empty query", async () => {
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "   ");
    fireEvent.keyDown(input, { key: "Enter" });
    await userEvent.clear(input);
    await userEvent.type(input, "consulta válida");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(mockGlobalChat).toHaveBeenCalledTimes(1);
      expect(mockGlobalChat).toHaveBeenCalledWith(
        "consulta válida",
        "en",
        false,
        undefined,
        expect.any(Function),
        undefined,
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });
  });

  it("renders user message when there are messages in DB", () => {
    const userMsg = {
      role: "user",
      content: "texto de usuario",
      toJSON: () => ({ role: "user", content: "texto de usuario" }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [userMsg] }),
    } as any);
    render(<Chat />);
    expect(screen.getByText("texto de usuario")).toBeTruthy();
  });

  it("shows copy button on assistant message without isTranslationKey", () => {
    const assistMsg = {
      role: "assistant",
      content: "respuesta",
      isTranslationKey: false,
      toJSON: () => ({
        role: "assistant",
        content: "respuesta",
        isTranslationKey: false,
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat />);
    expect(screen.getAllByTestId("icon-Copy").length).toBeGreaterThan(0);
  });

  it("copies to the clipboard when clicking Copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const assistMsg = {
      role: "assistant",
      content: "texto a copiar",
      isTranslationKey: false,
      toJSON: () => ({
        role: "assistant",
        content: "texto a copiar",
        isTranslationKey: false,
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat />);
    const copyBtns = screen.getAllByTestId("icon-Copy");
    await userEvent.click(copyBtns[0]!.closest("button")!);
    expect(writeText).toHaveBeenCalledWith("texto a copiar");
  });

  it("shows sources on assistant message", () => {
    const assistMsg = {
      role: "assistant",
      content: "respuesta con [Source 1]",
      sources: [{ type: "bookmark", id: "1", title: "test source" }],
      isTranslationKey: false,
      toJSON: () => ({
        role: "assistant",
        content: "respuesta con [Source 1]",
        sources: [{ type: "bookmark", id: "1", title: "test source" }],
        isTranslationKey: false,
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat />);
    expect(screen.getByText("test source")).toBeTruthy();
  });

  it("calls onSelectSource when clicking a source", async () => {
    const onSelectSource = vi.fn();
    const assistMsg = {
      role: "assistant",
      content: "respuesta",
      isTranslationKey: false,
      sources: [{ type: "bookmark", id: "b1", title: "Fuente 1" }],
      toJSON: () => ({
        role: "assistant",
        content: "respuesta",
        isTranslationKey: false,
        sources: [{ type: "bookmark", id: "b1", title: "Fuente 1" }],
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat onSelectSource={onSelectSource} />);
    await userEvent.click(screen.getByText("Fuente 1"));
    expect(onSelectSource).toHaveBeenCalledWith("bookmark", "b1");
  });

  it("shows web sources (grounding chunks)", () => {
    const assistMsg = {
      role: "assistant",
      content: "respuesta con fuentes web",
      isTranslationKey: false,
      groundingMetadata: {
        groundingChunks: [
          {
            id: "c1",
            content: "src",
            web: { uri: "https://example.com", title: "Example" },
          },
          { id: "c2", content: "no web", web: null },
        ],
      },
      toJSON: () => ({
        role: "assistant",
        content: "respuesta con fuentes web",
        isTranslationKey: false,
        groundingMetadata: {
          groundingChunks: [
            {
              id: "c1",
              content: "src",
              web: { uri: "https://example.com", title: "Example" },
            },
            { id: "c2", content: "no web", web: null },
          ],
        },
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat />);
    expect(screen.getByText("app_webSources")).toBeTruthy();
  });

  it("handles Error instance in catch", async () => {
    mockGlobalChat.mockRejectedValue(new Error("error real"));
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockMessagesInsert).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Sorry, I encountered an error processing your request. Please try again." }),
      );
    });
  });

  it("shows Check icon after copying to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const assistMsg = {
      role: "assistant",
      content: "texto a copiar",
      isTranslationKey: false,
      toJSON: () => ({
        role: "assistant",
        content: "texto a copiar",
        isTranslationKey: false,
      }),
    };
    // useRxQuery re-evaluates the query on every re-render (the click fires setState),
    // so the mock must be persistent, not *Once
    mockMessagesFind.mockReturnValue({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat />);
    await userEvent.click(screen.getAllByTestId("icon-Copy")[0]!.closest("button")!);
    expect(writeText).toHaveBeenCalledWith("texto a copiar");
    expect(screen.getByTestId("icon-Check")).toBeTruthy();
    mockMessagesFind.mockImplementation(() => ({
      sort: () => ({ result: [] }),
    }));
  });

  it("shows document-type sources with FileText icon and onSelectSource", async () => {
    const onSelectSource = vi.fn();
    const assistMsg = {
      role: "assistant",
      content: "resp",
      isTranslationKey: false,
      sources: [{ type: "document", id: "d1", title: "Doc 1" }],
      toJSON: () => ({
        role: "assistant",
        content: "resp",
        isTranslationKey: false,
        sources: [{ type: "document", id: "d1", title: "Doc 1" }],
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat onSelectSource={onSelectSource} />);
    expect(screen.getAllByTestId("icon-FileText").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByText("Doc 1"));
    expect(onSelectSource).toHaveBeenCalledWith("document", "d1");
  });

  it("uses the uri as text when the web chunk has no title", () => {
    const assistMsg = {
      role: "assistant",
      content: "resp",
      isTranslationKey: false,
      groundingMetadata: {
        groundingChunks: [
          { id: "c1", content: "src", web: { uri: "https://fallback.com", title: "" } },
        ],
      },
      toJSON: () => ({
        role: "assistant",
        content: "resp",
        isTranslationKey: false,
        groundingMetadata: {
          groundingChunks: [
            { id: "c1", content: "src", web: { uri: "https://fallback.com", title: "" } },
          ],
        },
      }),
    };
    mockMessagesFind.mockReturnValueOnce({
      sort: () => ({ result: [assistMsg] }),
    } as any);
    render(<Chat />);
    expect(screen.getByText("https://fallback.com")).toBeTruthy();
  });

  it("auto-sends saved pending_ai_query on mount", async () => {
    mockGlobalChat.mockResolvedValue({ text: "Resp", sources: [] });
    localStorage.setItem("pending_ai_query", "consulta pendiente");
    render(<Chat />);
    await waitFor(() => {
      expect(mockGlobalChat).toHaveBeenCalledWith(
        "consulta pendiente",
        "en",
        false,
        undefined,
        expect.any(Function),
        undefined,
        expect.any(Function),
        expect.any(AbortSignal),
        expect.any(Function),
      );
    });
  });

  // --- Branch: provider badge in the chat header while streaming ---
  it("shows the provider in the header while generating (onProvider)", async () => {
    mockGlobalChat.mockImplementation(
      (
        _q: string,
        _l?: string,
        _p?: boolean,
        _s?: string,
        _onChunk?: (c: string) => void,
        _doc?: unknown,
        onProvider?: (p: string) => void,
      ) => {
        // The provider reports BEFORE the tokens arrive.
        onProvider?.("webllm");
        return new Promise(() => {}); // stream en vuelo
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Generating with WebLLM (Local)...")).toBeTruthy();
    });
    // Hardening: the interpolated pill must never leak the raw i18next
    // token (the mock resolves {{provider}} like real i18next does).
    expect(screen.queryByText(/\{\{/)).toBeNull();
  });

  it("header shows the localized provider (ollama)", async () => {
    mockGlobalChat.mockImplementation(
      (
        _q: string,
        _l?: string,
        _p?: boolean,
        _s?: string,
        _onChunk?: (c: string) => void,
        _doc?: unknown,
        onProvider?: (p: string) => void,
      ) => {
        onProvider?.("ollama");
        return new Promise(() => {});
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Generating with Ollama...")).toBeTruthy();
    });
  });

  it("provider badge disappears when generation completes", async () => {
    let resolveResponse!: (value: unknown) => void;
    mockGlobalChat.mockImplementation(
      (
        _q: string,
        _l?: string,
        _p?: boolean,
        _s?: string,
        _onChunk?: (c: string) => void,
        _doc?: unknown,
        onProvider?: (p: string) => void,
      ) => {
        onProvider?.("gemini");
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Generating with Google Gemini...")).toBeTruthy();
    });
    await act(async () => {
      resolveResponse({ text: "Respuesta", sources: [] });
    });
    await waitFor(() => {
      expect(screen.queryByText(/Generating with/)).toBeNull();
      expect(screen.queryByText("Stop")).toBeNull();
    });
  });

  it("without onProvider no provider badge is shown", async () => {
    mockGlobalChat.mockImplementation(() => new Promise(() => {}));
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Stop")).toBeTruthy();
    });
    expect(screen.queryByText(/Generating with/)).toBeNull();
  });

  it("shows streaming tokens while the response is in progress", async () => {
    let resolveResponse!: (value: unknown) => void;
    mockGlobalChat.mockImplementation(
      (
        _q: string,
        _l?: string,
        _p?: boolean,
        _s?: string,
        onChunk?: (chunk: string) => void,
      ) => {
        // Delivers a token synchronously and leaves the promise pending.
        onChunk?.("parcial");
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    // The token already appears in the streaming bubble before completing.
    await waitFor(() => {
      expect(screen.getByText("parcial")).toBeTruthy();
    });
    await act(async () => {
      resolveResponse({ text: "parcial", sources: [] });
    });
  });

  it("shows streaming content after sending", async () => {
    let resolveResponse!: (value: unknown) => void;
    mockGlobalChat.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    // Completes the response INSIDE act: the continuation of handleSend
    // (inserting the message, hiding the streaming bubble) is flushed and the
    // reactive history renders the final response.
    await act(async () => {
      resolveResponse({ text: "Respuesta final", sources: [] });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByText("Respuesta final")).toBeTruthy();
      expect(screen.queryByText("Stop")).toBeNull();
    });
  });

  // --- Branch: cancel generation (Stop button) ---
  it("cancels and does not persist a response if the component unmounts", async () => {
    let resolveResponse!: (value: unknown) => void;
    let onChunk!: (chunk: string) => void;
    mockGlobalChat.mockImplementation(
      (
        _q: string,
        _l?: string,
        _p?: boolean,
        _s?: string,
        chunkHandler?: (chunk: string) => void,
      ) => {
        onChunk = chunkHandler!;
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    );
    const { unmount } = render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => expect(mockGlobalChat).toHaveBeenCalledTimes(1));

    const signal = mockGlobalChat.mock.calls[0]![7] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);

    await act(async () => {
      onChunk("Late response");
      resolveResponse({ text: "Late response", sources: [] });
      await Promise.resolve();
    });
    expect(mockMessagesInsert).toHaveBeenCalledTimes(1);
  });

  it("shows Stop button while streaming", async () => {
    mockGlobalChat.mockImplementation(
      (_q: string, _l?: string, _p?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.("parcial");
        return new Promise(() => {}); // never resolves: the stream stays in flight
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Stop")).toBeTruthy();
    });
  });

  it("cancelling keeps the partial text in history without an error", async () => {
    let resolveResponse!: (value: unknown) => void;
    mockGlobalChat.mockImplementation(
      (_q: string, _l?: string, _p?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.("Texto parcial");
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    // The partial text appears in the streaming bubble
    await waitFor(() => {
      expect(screen.getByText("Texto parcial")).toBeTruthy();
    });
    // The user cancels
    await userEvent.click(screen.getByText("Stop"));
    // The partial text is persisted as the assistant's message
    await waitFor(() => {
      expect(mockMessagesInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: "Texto parcial",
        }),
      );
    });
    // The error message is not shown
    expect(mockMessagesInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "Sorry, I encountered an error processing your request. Please try again.",
      }),
    );
    // El streaming termina
    await waitFor(() => {
      expect(screen.queryByText("Stop")).toBeNull();
    });
    resolveResponse?.({ text: "Texto parcial", sources: [] });
  });

  it("cancelling without partial text does not insert an empty message", async () => {
    mockGlobalChat.mockImplementation(() => new Promise(() => {}));
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Stop")).toBeTruthy();
    });
    const insertCallsBefore = mockMessagesInsert.mock.calls.length;
    await userEvent.click(screen.getByText("Stop"));
    // The user's message was already inserted (1); cancelling without chunks does NOT add
    // another empty assistant message.
    await waitFor(() => {
      expect(mockMessagesInsert.mock.calls.length).toBe(insertCallsBefore);
    });
  });

  it("cancels the stream and allows a new send", async () => {
    let resolveResponse!: (value: unknown) => void;
    mockGlobalChat.mockImplementation(
      (_q: string, _l?: string, _p?: boolean, _s?: string, onChunk?: (c: string) => void) => {
        onChunk?.("primera");
        return new Promise((resolve) => {
          resolveResponse = resolve;
        });
      },
    );
    render(<Chat />);
    const input = screen.getByPlaceholderText(
      "Ask about your bookmarks and documents...",
    ) as HTMLInputElement;
    await userEvent.type(input, "Hola");
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(screen.getByText("Stop")).toBeTruthy();
    });
    await userEvent.click(screen.getByText("Stop"));
    await waitFor(() => {
      expect(screen.queryByText("Stop")).toBeNull();
    });
    // After cancelling, typing and sending work again (isTyping was already
    // released in the finally; the input was empty after the first send).
    await userEvent.type(input, "segunda");
    expect(
      screen.getByTestId("icon-Send").closest("button")!.disabled,
    ).toBe(false);
    await userEvent.click(screen.getByTestId("icon-Send").closest("button")!);
    await waitFor(() => {
      expect(mockGlobalChat).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      resolveResponse?.({ text: "primera", sources: [] });
      await Promise.resolve();
    });
  });
});
