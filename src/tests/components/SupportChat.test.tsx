import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { agentService } from "../../services/ai/AgentService";

vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string) => fb || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

vi.mock("../../services/ai/AgentService", () => ({
  agentService: {
    supportChat: vi.fn().mockResolvedValue("Respuesta mock"),
  },
}));

// The diagnostics tab probes Ollama/WebLLM through the real services; mock
// them so the probe results are deterministic under fake timers (no real
// network calls to localhost:11434).
const mockAiManager = {
  isOllamaAvailable: vi.fn().mockResolvedValue(true),
  getOllamaSettings: vi.fn().mockReturnValue({
    url: "http://localhost:11434/api/generate",
    model: "llama3.2",
  }),
};
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: mockAiManager,
}));

const mockWebLLMService = {
  getCapabilityBlocker: vi.fn().mockResolvedValue(null),
  canRunLocalLLM: vi.fn().mockResolvedValue(true),
  isModelLoaded: vi.fn().mockReturnValue(true),
  getCurrentModel: vi.fn().mockReturnValue("llama3.2"),
};
// AgentService resolves the Pro RAG service through the pro-access loader;
// mocking it here also keeps the real loader (and its transitive graph:
// LicenseService → ai/utils → src/i18n.ts) out of this suite, whose partial
// react-i18next mock cannot survive the real i18n module.
vi.mock("../../services/pro-access", () => ({
  loadGlobalRAGService: () => Promise.resolve(null),
  // The diagnostics tab probes WebLLM through the loader too; the same
  // double backs it so the ready/blocked rows render deterministically.
  loadWebLLMService: () => Promise.resolve(mockWebLLMService),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));
vi.mock("../../services/ai/WebLLMService", () => ({
  webLLMService: mockWebLLMService,
}));

vi.mock("../../data/SupportKnowledge", () => ({
  SUPPORT_KNOWLEDGE: {
    en: {
      FAQ_EXTENDED: {
        "How to create a document?": "Use the create button.",
        "How to export?": "Go to File > Export.",
      },
    },
    es: {
      FAQ_EXTENDED: {
        "How to create a document?": "Use the create button.",
        "How to export?": "Go to File > Export.",
      },
    },
  },
}));

vi.mock("@mantine/core", () => ({
  Paper: ({ children, ...props }: any) => (
    <div data-testid="paper" {...props}>
      {children}
    </div>
  ),
  TextInput: ({ leftSection, rightSection, ...props }: any) => (
    <div data-testid="text-input">
      {leftSection}
      <input {...props} data-testid="text-input-field" />
      {rightSection}
    </div>
  ),
  Button: ({ children, onClick, ...props }: any) => (
    <button data-testid="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Tabs: ({ children, value, onChange, ...props }: any) => (
    <div data-testid="tabs" data-value={value} {...props}>
      {children}
      {React.Children.map(children, (child: any) =>
        child?.type?.displayName === "TabsList"
          ? React.cloneElement(child, { onChange })
          : child,
      )}
    </div>
  ),
  TabsList: ({ children, onChange, ...props }: any) => (
    <div data-testid="tabs-list" {...props}>
      {React.Children.map(children, (child: any) =>
        child
          ? React.cloneElement(child, {
              onClick: () => onChange?.(child.props.value),
            })
          : child,
      )}
    </div>
  ),
  TabsTab: ({ children, value, onClick, ...props }: any) => (
    <button data-testid={`tab-${value}`} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  TabsPanel: ({ children, value, ...props }: any) => (
    <div data-testid={`panel-${value}`} {...props}>
      {children}
    </div>
  ),
  Stack: ({ children, ...props }: any) => (
    <div data-testid="stack" {...props}>
      {children}
    </div>
  ),
  Group: ({ children, ...props }: any) => (
    <div data-testid="group" {...props}>
      {children}
    </div>
  ),
  Text: ({ children, ...props }: any) => (
    <span data-testid="text" {...props}>
      {children}
    </span>
  ),
  Title: ({ children, ...props }: any) => (
    <h2 data-testid="title" {...props}>
      {children}
    </h2>
  ),
  ScrollArea: ({ children, ...props }: any) => (
    <div data-testid="scroll-area" {...props}>
      {children}
    </div>
  ),
  Accordion: ({ children, ...props }: any) => (
    <div data-testid="accordion" {...props}>
      {children}
    </div>
  ),
  AccordionItem: ({ children, value, ...props }: any) => (
    <div data-testid={`accordion-item-${value}`} {...props}>
      {children}
    </div>
  ),
  AccordionControl: ({ children, ...props }: any) => (
    <div data-testid="accordion-control" {...props}>
      {children}
    </div>
  ),
  AccordionPanel: ({ children, ...props }: any) => (
    <div data-testid="accordion-panel" {...props}>
      {children}
    </div>
  ),
  Loader: () => <div data-testid="loader" />,
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
    Bot: mock("Bot"),
    HelpCircle: mock("HelpCircle"),
    Sparkles: mock("Sparkles"),
    BookOpen: mock("BookOpen"),
    Activity: mock("Activity"),
    CheckCircle2: mock("CheckCircle2"),
    AlertCircle: mock("AlertCircle"),
    ChevronDown: mock("ChevronDown"),
    ChevronUp: mock("ChevronUp"),
    RefreshCw: mock("RefreshCw"),
    MessageCircle: mock("MessageCircle"),
    Copy: mock("Copy"),
    Check: mock("Check"),
    Trash2: mock("Trash2"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

import SupportChat from "../../components/SupportChat";

describe("SupportChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders without errors", () => {
    const { container } = render(<SupportChat />);
    expect(container).toBeTruthy();
  });

  it("shows the chat section by default", () => {
    render(<SupportChat />);
    expect(screen.getByTestId("icon-MessageCircle")).toBeTruthy();
  });

  it("renders chat button", () => {
    render(<SupportChat />);
    const chatBtns = screen.getAllByText(/AI Assistant/i);
    expect(chatBtns.length).toBeGreaterThan(0);
  });

  it("renders faq button", async () => {
    render(<SupportChat />);
    const faqBtns = screen.getAllByText(/Knowledge Base/i);
    expect(faqBtns.length).toBeGreaterThan(0);
  });

  it("renders diagnostics button", async () => {
    render(<SupportChat />);
    expect(screen.getByTestId("icon-Activity")).toBeTruthy();
  });

  it("renders message input in chat", async () => {
    render(<SupportChat />);
    expect(screen.getByDisplayValue("")).toBeTruthy();
  });

  it("renders quick actions", async () => {
    render(<SupportChat />);
    expect(screen.getByText("Tutorials")).toBeTruthy();
    expect(screen.getByText("Backups")).toBeTruthy();
  });

  it("renders FAQ when switching to faq tab", async () => {
    render(<SupportChat />);
    const faqBtn = screen.getAllByText(/Knowledge Base/i)[0];
    await userEvent.click(faqBtn!);
    expect(screen.getByText("How to create a document?")).toBeTruthy();
  });

  it("switches to the diagnostics tab", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    expect(screen.getAllByTestId("icon-RefreshCw").length).toBeGreaterThan(0);
  });

  // --- Branch: messages initialization from localStorage ---
  it("loads messages from localStorage if they exist", async () => {
    const saved = JSON.stringify([
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi there!" },
    ]);
    localStorage.setItem("bmf_support_history", saved);
    render(<SupportChat />);
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByText("Hi there!")).toBeTruthy();
  });

  it("uses welcome message when there is no localStorage history", async () => {
    localStorage.removeItem("bmf_support_history");
    render(<SupportChat />);
    expect(screen.getByText("app_supportChatWelcome")).toBeTruthy();
  });

  // --- Branch: handleSend empty input ---
  it("does not send a message when the input is empty", async () => {
    render(<SupportChat />);
    const sendBtn = screen.getAllByTestId("icon-Send")[0]!.closest("button")!;
    await userEvent.click(sendBtn);
    expect(agentService.supportChat).not.toHaveBeenCalled();
  });

  it("does not send a message when the input has only spaces", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "   ");
    const sendBtn = screen.getAllByTestId("icon-Send")[0]!.closest("button")!;
    await userEvent.click(sendBtn);
    expect(agentService.supportChat).not.toHaveBeenCalled();
  });

  // --- Branch: handleSend with custom query (quick actions) ---
  it("sends message via handleSend with customQuery from a quick action", async () => {
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByText("Tutorials"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText("app_supportChatTutorials")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- Branch: getSupportResponse keyword matching ---
  it("detects greeting in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hello there");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("hello there")).toBeTruthy();
  });

  it("detects hola in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hola mundo");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("hola mundo")).toBeTruthy();
  });

  it("detects privacy keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "privacy settings");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("privacy settings")).toBeTruthy();
  });

  it("detects security in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "seguridad");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("seguridad")).toBeTruthy();
  });

  it("detects editor keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "editor options");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("editor options")).toBeTruthy();
  });

  it("detects note in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "nota nueva");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("nota nueva")).toBeTruthy();
  });

  it("detects bookmark keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "bookmark manager");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("bookmark manager")).toBeTruthy();
  });

  it("detects link in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "add a link");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("add a link")).toBeTruthy();
  });

  it("detects rag keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "how does rag work");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("how does rag work")).toBeTruthy();
  });

  it("detects theme keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "dark theme");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("dark theme")).toBeTruthy();
  });

  it("detects topic in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "cambiar tema");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("cambiar tema")).toBeTruthy();
  });

  it("detects tutorial keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "tutorial guide");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("tutorial guide")).toBeTruthy();
  });

  it("detects shortcut keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "keyboard shortcuts");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("keyboard shortcuts")).toBeTruthy();
  });

  it("detects keyboard in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "atajos de teclado");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("atajos de teclado")).toBeTruthy();
  });

  it("detects backup keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "create a backup");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("create a backup")).toBeTruthy();
  });

  it("detects copy in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hacer copia");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("hacer copia")).toBeTruthy();
  });

  it("detects ai keywords in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "setup ai");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("setup ai")).toBeTruthy();
  });

  it("detects gemini in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "gemini provider");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("gemini provider")).toBeTruthy();
  });

  it("detects slow/error keywords in query (troubleshoot)", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "app is slow");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("app is slow")).toBeTruthy();
  });

  it("detects problem in query", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "tengo un problema");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("tengo un problema")).toBeTruthy();
  });

  // --- Branch: default fallback via agentService ---
  it("llama agentService.supportChat para queries sin match conocido", async () => {
    vi.mocked(agentService.supportChat).mockResolvedValueOnce(
      "AI response text",
    );
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "quantum computing");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(agentService.supportChat).toHaveBeenCalledWith(
      "quantum computing",
      "en",
    );
  });

  it("shows agentService response in chat", async () => {
    vi.mocked(agentService.supportChat).mockResolvedValueOnce(
      "Custom AI answer",
    );
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "quantum computing");
    input.focus();
    await userEvent.keyboard("{Enter}");
    const response = await screen.findByText("Custom AI answer");
    expect(response).toBeTruthy();
  });

  it("shows fallback when agentService fails", async () => {
    vi.mocked(agentService.supportChat).mockRejectedValueOnce(
      new Error("API Error"),
    );
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "quantum computing");
    input.focus();
    await userEvent.keyboard("{Enter}");
    const fallback = await screen.findByText("app_supportChatDefault");
    expect(fallback).toBeTruthy();
  });

  // --- Branch: clearHistory ---
  it("clears history when clicking clear history", async () => {
    render(<SupportChat />);
    const clearBtn = screen.getByTitle("Clear History");
    await userEvent.click(clearBtn);
    expect(screen.getByText("app_supportChatWelcome")).toBeTruthy();
    expect(screen.queryByText("tutorials")).toBeNull();
  });

  it("keeps a newer chat request active after clearing a pending AI response", async () => {
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    vi.mocked(agentService.supportChat)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "first unknown request");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(agentService.supportChat).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByTitle("Clear History"));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    const nextInput = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(nextInput, "second unknown request");
    fireEvent.keyDown(nextInput, { key: "Enter" });
    expect(agentService.supportChat).toHaveBeenCalledTimes(2);
    const sendButton = screen.getByRole("button", { name: "Send" });
    expect(sendButton).toBeDisabled();

    await act(async () => {
      resolveFirst("late first response");
      await Promise.resolve();
    });
    expect(screen.queryByText("late first response")).toBeNull();
    expect(sendButton).toBeDisabled();

    await act(async () => {
      resolveSecond("second response");
      await Promise.resolve();
    });
    expect(await screen.findByText("second response")).toBeTruthy();
    // The composer is enabled again once text is entered for a follow-up.
    await userEvent.type(nextInput, "follow up");
    expect(sendButton).not.toBeDisabled();
  });

  // --- Branch: tab switching ---
  it("switches to faq tab and shows FAQ items", async () => {
    render(<SupportChat />);
    const faqBtn = screen.getAllByText(/Knowledge Base/i)[0];
    await userEvent.click(faqBtn!);
    expect(screen.getByText("How to create a document?")).toBeTruthy();
    expect(screen.getByText("How to export?")).toBeTruthy();
  });

  it("switches to the chat tab from faq", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getAllByText(/Knowledge Base/i)[0]!);
    expect(screen.getByText("How to create a document?")).toBeTruthy();
    await userEvent.click(screen.getAllByText(/AI Assistant/i)[0]!);
    expect(screen.getByTestId("icon-MessageCircle")).toBeTruthy();
  });

  it("switches to diagnostics tab and shows pending results", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    expect(screen.getAllByTestId("icon-RefreshCw").length).toBeGreaterThan(0);
  });

  // --- Branch: FAQ toggle ---
  it("opens and closes FAQ item", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getAllByText(/Knowledge Base/i)[0]!);
    const faqBtn = screen.getByText("How to create a document?");
    await userEvent.click(faqBtn);
    expect(screen.getByText("Use the create button.")).toBeTruthy();
    await userEvent.click(faqBtn);
  });

  it("opens one FAQ and closes when opening another", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getAllByText(/Knowledge Base/i)[0]!);
    const faq1 = screen.getByText("How to create a document?");
    const faq2 = screen.getByText("How to export?");
    await userEvent.click(faq1);
    expect(screen.getByText("Use the create button.")).toBeTruthy();
    await userEvent.click(faq2);
    expect(screen.getByText("Go to File > Export.")).toBeTruthy();
  });

  // --- Branch: FAQ "Go to AI Assistant" button ---
  it("navigates to chat from FAQ via Go to AI Assistant button", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getAllByText(/Knowledge Base/i)[0]!);
    const goToAiBtn = screen.getByText("Go to AI Assistant");
    await userEvent.click(goToAiBtn);
    expect(screen.getByTestId("icon-MessageCircle")).toBeTruthy();
  });

  // --- Branch: send button disabled states ---
  it("send button disabled when input is empty", async () => {
    render(<SupportChat />);
    const sendBtn = screen.getAllByTestId("icon-Send")[0]!.closest("button")!;
    expect(sendBtn).toBeDisabled();
  });

  it("send button enabled when input has text", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hello");
    const sendBtn = screen.getAllByTestId("icon-Send")[0]!.closest("button")!;
    expect(sendBtn).not.toBeDisabled();
  });

  // --- Branch: Enter key sends message ---
  it("sends message with Enter key", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hello");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("does not send with a key other than Enter", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hello");
    input.focus();
    await userEvent.keyboard("a");
    expect(screen.queryByText("hello")).toBeNull();
  });

  // --- Branch: isTyping indicator ---
  it("shows typing indicator after sending a message", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hello");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getAllByTestId("icon-Bot").length).toBeGreaterThan(0);
  });

  // --- Branch: quick action buttons ---
  it("sends Privacy query via quick action", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByText("Privacy"));
    expect(screen.getByText("privacy")).toBeTruthy();
  });

  it("sends Local AI query via quick action", async () => {
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByText("Local AI"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText("app_supportChatAiSetup")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends Backups query via quick action", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByText("Backups"));
    expect(screen.getByText("backup")).toBeTruthy();
  });

  // --- Branch: user vs assistant message rendering ---
  it("renders user message with correct styling", () => {
    localStorage.setItem(
      "bmf_support_history",
      JSON.stringify([{ role: "user", content: "test message" }]),
    );
    render(<SupportChat />);
    expect(screen.getByText("test message")).toBeTruthy();
  });

  it("renders assistant message with Bot icon", () => {
    localStorage.setItem(
      "bmf_support_history",
      JSON.stringify([
        { role: "assistant", content: "Hello!", isTranslationKey: false },
      ]),
    );
    render(<SupportChat />);
    expect(screen.getByText("Hello!")).toBeTruthy();
    expect(screen.getAllByTestId("icon-Bot").length).toBeGreaterThan(0);
  });

  it("renders assistant message with translation key", async () => {
    localStorage.setItem(
      "bmf_support_history",
      JSON.stringify([
        {
          role: "assistant",
          content: "app_supportChatWelcome",
          isTranslationKey: true,
        },
      ]),
    );
    render(<SupportChat />);
    expect(screen.getByText("app_supportChatWelcome")).toBeTruthy();
  });

  // --- Branch: localStorage persistence ---
  it("saves messages to localStorage on send", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "saved message");
    input.focus();
    await userEvent.keyboard("{Enter}");
    const stored = JSON.parse(
      localStorage.getItem("bmf_support_history") || "[]",
    );
    expect(stored.some((m: any) => m.content === "saved message")).toBeTruthy();
  });

  // --- Branch: diagnostics auto-run ---
  it("runs diagnostics automatically when switching to the diagnostics tab", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    expect(screen.getAllByTestId("icon-RefreshCw").length).toBeGreaterThan(0);
  });

  // --- Branch: runDiagnostics manual ---
  it("runs diagnostics manually via the Re-evaluate button", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    const reevalBtn = screen.getByText("Re-evaluate");
    await userEvent.click(reevalBtn);
    expect(screen.getAllByTestId("icon-RefreshCw").length).toBeGreaterThan(0);
  });

  // --- Branch: diagnostics results pending status ---
  it("shows pending status in diagnostics", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    expect(screen.getAllByText("Verifying status...").length).toBeGreaterThan(
      0,
    );
  });

  // --- Branch: diagnostics results after completion ---
  it("shows completed diagnostics results", async () => {
    // The diagnostics auto-run resolves after a 2000ms timer; use fake
    // timers so this test does not burn 2.5s of real wall-clock time.
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.queryByText("Verifying status...")).toBeNull();
      expect(
        screen.getAllByTestId("icon-CheckCircle2").length,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // --- Branch: diagnostics refresh button ---
  it("renders refresh button in diagnostics", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    expect(screen.getByText("Refresh App (F5)")).toBeTruthy();
  });

  // --- Branch: send button click handler ---
  it("sends message via the Send button", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "via button");
    const sendBtn = screen.getAllByTestId("icon-Send")[0]!.closest("button")!;
    await userEvent.click(sendBtn);
    expect(screen.getByText("via button")).toBeTruthy();
  });

  // --- Branch: agentService with different languages ---
  it("calls agentService with the current lang", async () => {
    vi.mocked(agentService.supportChat).mockResolvedValueOnce("Response");
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "unknown query");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(agentService.supportChat).toHaveBeenCalledWith(
      "unknown query",
      "en",
    );
  });

  it("handles multi-message flow", async () => {
    vi.mocked(agentService.supportChat).mockResolvedValue("AI reply");
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "first message");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("first message")).toBeTruthy();
  });

  // --- Branch: diagnose navigator.gpu detection ---
  it("detects webgpu status in diagnostics", async () => {
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      const webGpuDiag = screen.getByText(/Local AI Capability/);
      expect(webGpuDiag).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- Branch: diagnostics new checks (network, Ollama, WebLLM) ---
  it("shows network, Ollama and WebLLM rows in diagnostics", async () => {
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText("Network Status")).toBeTruthy();
      expect(screen.getByText("Local AI (Ollama)")).toBeTruthy();
      expect(screen.getByText("Local AI (WebLLM)")).toBeTruthy();
      // All probes mocked to succeed: Ollama reachable + WebLLM ready.
      expect(screen.getByText(/Ollama is reachable/)).toBeTruthy();
      expect(screen.getByText(/WebLLM is ready/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows offline and Ollama/WebLLM errors when they fail", async () => {
    vi.useFakeTimers();
    try {
      mockAiManager.isOllamaAvailable.mockResolvedValue(false);
      mockWebLLMService.getCapabilityBlocker.mockResolvedValue(
        "webgpu-unavailable",
      );
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        get: () => false,
      });
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText(/You are offline/)).toBeTruthy();
      expect(screen.getByText(/Ollama is not running/)).toBeTruthy();
      // The blocker enum must reach the user as the SPECIFIC cause, not the
      // generic fallback — this is the end of the thread that starts at
      // WebLLMService.getCapabilityBlocker().
      expect(
        screen.getByText(
          /WebLLM cannot run: this browser does not support WebGPU/,
        ),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.mocked(mockAiManager.isOllamaAvailable).mockResolvedValue(true);
      vi.mocked(mockWebLLMService.getCapabilityBlocker).mockResolvedValue(
        null,
      );
      delete (navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it("names insufficient device memory as the WebLLM blocker cause", async () => {
    // Second rung of the ladder: the enum -> message mapping must be
    // cause-specific, not collapsed into one string for every blocker.
    vi.useFakeTimers();
    try {
      mockAiManager.isOllamaAvailable.mockResolvedValue(true);
      mockWebLLMService.getCapabilityBlocker.mockResolvedValue(
        "insufficient-memory",
      );
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(
        screen.getByText(
          /WebLLM cannot run: at least 4 GB of device memory is required/,
        ),
      ).toBeTruthy();
      expect(
        screen.queryByText(/does not support WebGPU/),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.mocked(mockWebLLMService.getCapabilityBlocker).mockResolvedValue(null);
    }
  });

  it("falls back to the generic WebLLM message when the probe produced no verdict", async () => {
    // A rejected probe yields no blocker enum (SupportDiagnostics drops it),
    // so the UI must show the honest generic message instead of guessing a
    // specific cause it does not know.
    vi.useFakeTimers();
    try {
      mockAiManager.isOllamaAvailable.mockResolvedValue(true);
      mockWebLLMService.getCapabilityBlocker.mockRejectedValue(
        new Error("probe crashed"),
      );
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(
        screen.getByText(
          /WebLLM cannot run: WebGPU or sufficient RAM is required/,
        ),
      ).toBeTruthy();
    } finally {
      vi.useRealTimers();
      vi.mocked(mockWebLLMService.getCapabilityBlocker).mockResolvedValue(null);
    }
  });

  // --- Branch: send button disabled while typing ---
  it("disables send button while typing", async () => {
    vi.mocked(agentService.supportChat).mockImplementation(
      () => new Promise(() => {}),
    );
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "slow query");
    input.focus();
    await userEvent.keyboard("{Enter}");
    const sendBtn = screen.getAllByTestId("icon-Send")[0]!.closest("button")!;
    expect(sendBtn).toBeDisabled();
  });

  // --- Branch: FAQ with es language fallback ---
  it("uses English FAQ when language is not supported", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getAllByText(/Knowledge Base/i)[0]!);
    expect(screen.getByText("How to create a document?")).toBeTruthy();
  });

  // --- Branch: handleSend called with customQuery bypasses input ---
  it("handleSend with customQuery does not use input", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "different text");
    // The custom query wins: the typed input value is NOT sent.
    fireEvent.click(screen.getByText("Tutorials"));
    expect(screen.getByText("getting started")).toBeTruthy();
    expect(screen.queryByText("different text")).toBeNull();
  });

  // --- Branch: diagnostics with isDiagnosing true disables button ---
  it("disables Re-evaluate button while diagnosing", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    const reevalBtn = screen.getByText("Re-evaluate");
    await userEvent.click(reevalBtn);
    expect(reevalBtn.closest("button")).toBeDisabled();
  });

  // --- Branch: export keyword ---
  it("detects export in query for backup", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "export data");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("export data")).toBeTruthy();
  });

  // --- Branch: local ai keyword ---
  it("detects local ai in query for RAG", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "local ai setup");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("local ai setup")).toBeTruthy();
  });

  // --- Branch: ollama keyword ---
  it("detects ollama in query for AI setup", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "ollama config");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("ollama config")).toBeTruthy();
  });

  // --- Branch: "marcador" keyword (Spanish chat match) --- [i18n-allow]
  it("detects bookmark in query for bookmarks", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "agregar marcador");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("agregar marcador")).toBeTruthy();
  });

  // --- Branch: note keyword ---
  it("detects note in query for editor", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "create note");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("create note")).toBeTruthy();
  });

  // --- Branch: chat keyword ---
  it("detects chat in query for RAG", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "chat feature");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("chat feature")).toBeTruthy();
  });

  // --- Branch: guia keyword ---
  it("detects guide in query for tutorials", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "guia de uso");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("guia de uso")).toBeTruthy();
  });

  // --- Branch: privacidad keyword ---
  it("detects privacy in query for privacy", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "configurar privacidad");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("configurar privacidad")).toBeTruthy();
  });

  // --- Branch: error keyword ---
  it("detects error in query for troubleshoot", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "error message");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("error message")).toBeTruthy();
  });

  // --- Branch: hi keyword ---
  it("detects hi in query for greeting", async () => {
    render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "hi");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("hi")).toBeTruthy();
  });

  // --- Branch: copy report button ---
  it("renders Copy Report button in diagnostics", async () => {
    render(<SupportChat />);
    await userEvent.click(screen.getByTestId("icon-Activity"));
    expect(screen.getByText("Copy Report")).toBeTruthy();
  });

  it("copies the report as readable JSON to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      fireEvent.click(screen.getByText("Copy Report"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      const text = writeText.mock.calls[0]![0] as string;
      // readable JSON (pretty-printed) with the results
      expect(() => JSON.parse(text)).not.toThrow();
      const report = JSON.parse(text);
      expect(report.app).toBe("BookmarkForge");
      expect(report.results).toBeInstanceOf(Array);
      expect(report.results.length).toBeGreaterThan(0);
      expect(report.results.some((r: any) => r.status === "ok")).toBe(true);
    } finally {
      vi.useRealTimers();
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
  });

  it("shows Copied state after copying the report", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      fireEvent.click(screen.getByText("Copy Report"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("Copied!")).toBeTruthy();
    } finally {
      vi.useRealTimers();
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
  });

  it("uses execCommand fallback when clipboard is unavailable", async () => {
    const execSpy = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execSpy,
    });
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      fireEvent.click(screen.getByText("Copy Report"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(execSpy).toHaveBeenCalledWith("copy");
      expect(screen.getByText("Copied!")).toBeTruthy();
    } finally {
      vi.useRealTimers();
      delete (document as unknown as Record<string, unknown>).execCommand;
    }
  });

  it("does not show Copied if execCommand returns false", async () => {
    const execSpy = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execSpy,
    });
    vi.useFakeTimers();
    try {
      render(<SupportChat />);
      fireEvent.click(screen.getByTestId("icon-Activity"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      fireEvent.click(screen.getByText("Copy Report"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(execSpy).toHaveBeenCalledWith("copy");
      expect(screen.queryByText("Copied!")).toBeNull();
      expect(screen.getByText("Copy Report")).toBeTruthy();
    } finally {
      vi.useRealTimers();
      delete (document as unknown as Record<string, unknown>).execCommand;
    }
  });

  it("discards the resolved AI response after unmount", async () => {
    let resolveChat: (value: string) => void;
    vi.mocked(agentService.supportChat).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveChat = resolve;
      }),
    );
    const { unmount } = render(<SupportChat />);
    const input = screen.getByPlaceholderText("Type a message...");
    await userEvent.type(input, "qrzx sin keyword conocido");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(agentService.supportChat).toHaveBeenCalled();

    unmount();
    await act(async () => {
      resolveChat!("respuesta tardía");
    });

    // The late response must not render anywhere after unmount.
    expect(screen.queryByText("respuesta tardía")).toBeNull();
  });
});
